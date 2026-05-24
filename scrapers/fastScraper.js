const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const {
  resolveUrl, isSameOrigin, urlToFilePath, guessExt,
  rewriteHtml, rewriteCss, extractNextJsAssets, extractNextData,
  buildInternalPattern, sleep, normalizeUrl
} = require('../utils/helpers');

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
};

class FastScraper {
  constructor(config) {
    this.url = config.url;
    this.depth = parseInt(config.depth) || 2;
    this.delay = parseInt(config.delay) || 500;
    this.timeout = parseInt(config.timeout) || 30000;
    this.aggressive = config.aggressive === true || config.aggressive === 'true';
    this.jobDir = config.jobDir;
    this.jobId = config.jobId;
    this.logger = config.logger;
    this.isCancelled = config.isCancelled || (() => false);

    this.baseUrl = this.url;
    this.visited = new Set();
    this.queue = [];
    this.assets = new Set();
    this.failedUrls = new Set();
    this.totalPages = 0;
    this.processedPages = 0;
    this.apiCalls = [];

    this.limit = pLimit(this.aggressive ? 5 : 3);
    this.http = axios.create({
      timeout: this.timeout,
      headers: DEFAULT_HEADERS,
      maxRedirects: 10,
      validateStatus: s => s < 500,
    });
  }

  async run() {
    this.logger.info(`🔍 Mode Rapide (Axios+Cheerio) — Profondeur: ${this.depth}`);
    
    // Start with root
    this.queue.push({ url: this.baseUrl, depth: 0 });

    while (this.queue.length > 0 && !this.isCancelled()) {
      const batch = this.queue.splice(0, this.aggressive ? 5 : 3);
      await Promise.all(batch.map(item => this.limit(() => this.scrapePage(item))));
    }

    if (this.isCancelled()) return;

    // Download all collected assets
    this.logger.info(`📥 Téléchargement de ${this.assets.size} ressources...`);
    await this.downloadAssets();

    // Save API calls log
    if (this.apiCalls.length > 0) {
      const apiLogPath = path.join(this.jobDir, '_api_calls.json');
      await fs.writeJson(apiLogPath, this.apiCalls, { spaces: 2 });
      this.logger.info(`🔌 ${this.apiCalls.length} appels API sauvegardés dans _api_calls.json`);
    }
  }

  async scrapePage({ url, depth }) {
    url = normalizeUrl(url);
    if (this.visited.has(url) || this.isCancelled()) return;
    this.visited.add(url);

    try {
      if (this.delay > 0) await sleep(this.delay);

      this.logger.info(`📄 [${depth}/${this.depth}] ${url}`);
      const res = await this.http.get(url, { responseType: 'text' });

      if (!res.headers['content-type']?.includes('text/html')) {
        this.assets.add(url);
        return;
      }

      const html = res.data;
      const $ = cheerio.load(html);

      // Save page
      await this.savePage(url, html, $);

      // Extract Next.js data
      const nextData = extractNextData(html);
      if (nextData) {
        const nextDataPath = path.join(this.jobDir, '_next_data.json');
        await fs.writeJson(nextDataPath, nextData, { spaces: 2 });
        this.logger.info('📊 __NEXT_DATA__ extrait');
      }

      // Collect assets from this page
      this.collectAssets($, url);

      // Collect internal links for crawling
      if (depth < this.depth) {
        this.collectLinks($, url, depth);
      }

      this.processedPages++;
      const pct = Math.min(80, Math.round((this.processedPages / Math.max(this.totalPages + 1, 5)) * 70));
      this.logger.progress(pct, `Pages: ${this.processedPages} | Queue: ${this.queue.length}`);

    } catch (err) {
      this.failedUrls.add(url);
      this.logger.warn(`⚠️ Échec: ${url} — ${err.message}`);
    }
  }

  async savePage(pageUrl, html, $) {
    let filePath = urlToFilePath(pageUrl, this.baseUrl, this.jobDir);
    if (!filePath) return;

    // Rewrite links to local paths
    const rewritten = rewriteHtml(html, pageUrl, this.jobDir, filePath);

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, rewritten, 'utf8');
  }

  collectAssets($, pageUrl) {
    const selectors = {
      'link[rel="stylesheet"]': 'href',
      'link[rel="preload"]': 'href',
      'script[src]': 'src',
      'img': 'src',
      'img': 'data-src',
      'source': 'src',
      'source': 'srcset',
      'video': 'src',
      'audio': 'src',
    };

    // Standard assets
    $('link[href], script[src], img[src], img[data-src], source[src], video[src], audio[src]').each((_, el) => {
      const el$ = $(el);
      const href = el$.attr('href') || el$.attr('src') || el$.attr('data-src');
      if (!href || href.startsWith('data:') || href.startsWith('#')) return;
      
      const abs = resolveUrl(pageUrl, href);
      if (abs) this.assets.add(abs);
    });

    // srcset
    $('[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset') || '';
      srcset.split(',').forEach(entry => {
        const src = entry.trim().split(/\s+/)[0];
        if (src) {
          const abs = resolveUrl(pageUrl, src);
          if (abs) this.assets.add(abs);
        }
      });
    });

    // Inline styles
    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      const matches = style.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi);
      for (const m of matches) {
        const abs = resolveUrl(pageUrl, m[1]);
        if (abs) this.assets.add(abs);
      }
    });

    // CSS files (will be parsed during download)
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const abs = resolveUrl(pageUrl, href);
        if (abs) this.assets.add(abs);
      }
    });

    // Favicon, manifest
    $('link[rel*="icon"], link[rel="manifest"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const abs = resolveUrl(pageUrl, href);
        if (abs) this.assets.add(abs);
      }
    });

    // Next.js chunk detection from inline scripts
    $('script:not([src])').each((_, el) => {
      const content = $(el).html() || '';
      const nextAssets = extractNextJsAssets(content, pageUrl);
      nextAssets.forEach(a => this.assets.add(a));

      // Detect API calls in JS
      const apiMatches = content.matchAll(/fetch\(['"`]([^'"`]+)['"`]/g);
      for (const m of apiMatches) {
        if (m[1].startsWith('/api/') || m[1].includes('/api/')) {
          this.apiCalls.push({ page: pageUrl, endpoint: m[1] });
        }
      }
    });
  }

  collectLinks($, pageUrl, depth) {
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return;

      const abs = resolveUrl(pageUrl, href);
      if (!abs) return;

      const normalized = normalizeUrl(abs);
      if (!this.visited.has(normalized) && isSameOrigin(this.baseUrl, abs)) {
        this.visited.add(normalized);
        this.queue.push({ url: normalized, depth: depth + 1 });
        this.totalPages++;
      }
    });
  }

  async downloadAssets() {
    const assets = [...this.assets];
    let downloaded = 0;

    await Promise.all(assets.map(assetUrl => this.limit(async () => {
      if (this.isCancelled()) return;

      try {
        // Skip if already downloaded as a page
        const filePath = urlToFilePath(assetUrl, this.baseUrl, this.jobDir);
        if (!filePath) return;
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          downloaded++;
          return;
        }

        if (this.delay > 0) await sleep(Math.round(this.delay / 3));

        const res = await this.http.get(assetUrl, {
          responseType: 'arraybuffer',
          headers: { ...DEFAULT_HEADERS, Accept: '*/*' },
        });

        const contentType = res.headers['content-type'] || '';
        let data = Buffer.from(res.data);

        // For CSS: rewrite urls inside
        if (contentType.includes('text/css')) {
          let css = data.toString('utf8');
          css = rewriteCss(css, assetUrl, this.jobDir, filePath);
          data = Buffer.from(css, 'utf8');

          // Parse CSS for more assets
          const urlMatches = css.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi);
          for (const m of urlMatches) {
            if (!m[1].startsWith('data:')) {
              const abs = resolveUrl(assetUrl, m[1]);
              if (abs && !this.assets.has(abs)) {
                this.assets.add(abs);
              }
            }
          }
        }

        // For JS: extract more Next.js assets
        if (contentType.includes('javascript') || assetUrl.includes('.js')) {
          const jsStr = data.toString('utf8');
          const moreAssets = extractNextJsAssets(jsStr, assetUrl);
          moreAssets.forEach(a => {
            if (!this.assets.has(a)) this.assets.add(a);
          });
        }

        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);

        downloaded++;
        const pct = 70 + Math.round((downloaded / assets.length) * 20);
        this.logger.progress(pct, `Assets: ${downloaded}/${assets.length}`);

      } catch (err) {
        this.failedUrls.add(assetUrl);
      }
    })));

    this.logger.info(`✅ ${downloaded}/${assets.length} ressources téléchargées`);

    if (this.failedUrls.size > 0) {
      this.logger.warn(`⚠️ ${this.failedUrls.size} ressources échouées`);
      await fs.writeFile(
        path.join(this.jobDir, '_failed_urls.txt'),
        [...this.failedUrls].join('\n'),
        'utf8'
      );
    }
  }
}

module.exports = { FastScraper };
