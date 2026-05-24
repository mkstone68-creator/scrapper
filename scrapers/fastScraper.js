const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const {
  resolveUrl, isSameOrigin, urlToFilePath, guessExt,
  rewriteHtml, rewriteCss, extractNextJsAssets, extractNextData,
  buildInternalPattern, sleep, normalizeUrl, fetchSitemapUrls,
} = require('../utils/helpers');

const MAX_PAGES = 5000;

const DEFAULT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Cache-Control': 'no-cache',
};

class FastScraper {
  constructor(config) {
    this.url = config.url;
    this.depth = parseInt(config.depth) || 3;
    this.maxDepth = this.depth >= 10 ? Infinity : this.depth;
    this.delay = parseInt(config.delay) || 300;
    this.timeout = parseInt(config.timeout) || 30000;
    this.aggressive = config.aggressive === true || config.aggressive === 'true';
    this.jobDir = config.jobDir;
    this.jobId = config.jobId;
    this.logger = config.logger;
    this.isCancelled = config.isCancelled || (() => false);

    this.baseUrl = this.url;
    this.visited = new Set();  // actually scraped
    this.queued = new Set();   // added to queue (dedup guard)
    this.queue = [];
    this.assets = new Set();
    this.failedUrls = new Set();
    this.totalPages = 0;
    this.processedPages = 0;
    this.apiCalls = [];

    this.limit = pLimit(this.aggressive ? 6 : 3);
    this.http = axios.create({
      timeout: this.timeout,
      headers: DEFAULT_HEADERS,
      maxRedirects: 10,
      validateStatus: s => s < 500,
    });
  }

  async run() {
    this.logger.info(`🔍 Mode Rapide (Axios+Cheerio) — Profondeur: ${this.maxDepth === Infinity ? '∞' : this.maxDepth}`);

    // Seed queue with start URL
    const startUrl = normalizeUrl(this.baseUrl);
    this.queued.add(startUrl);
    this.queue.push({ url: startUrl, depth: 0 });

    // Discover all URLs from sitemap before crawling
    await this.discoverFromSitemap();

    // Crawl loop
    while (this.queue.length > 0 && !this.isCancelled() && this.visited.size < MAX_PAGES) {
      const concurrency = this.aggressive ? 6 : 3;
      const batch = this.queue.splice(0, concurrency);
      await Promise.all(batch.map(item => this.limit(() => this.scrapePage(item))));
    }

    if (this.isCancelled()) return;

    // Retry failed pages once
    if (this.failedUrls.size > 0) {
      this.logger.info(`🔄 Retry de ${this.failedUrls.size} pages échouées...`);
      const retries = [...this.failedUrls];
      this.failedUrls.clear();
      await Promise.all(retries.map(url =>
        this.limit(() => this.scrapePage({ url, depth: 0 }))
      ));
    }

    this.logger.info(`📥 Téléchargement de ${this.assets.size} ressources...`);
    await this.downloadAssets();

    if (this.apiCalls.length > 0) {
      await fs.writeJson(path.join(this.jobDir, '_api_calls.json'), this.apiCalls, { spaces: 2 });
      this.logger.info(`🔌 ${this.apiCalls.length} appels API sauvegardés`);
    }
  }

  async discoverFromSitemap() {
    try {
      const sitemapUrls = await fetchSitemapUrls(this.baseUrl, this.http);
      if (sitemapUrls.size === 0) return;

      this.logger.info(`🗺️ Sitemap: ${sitemapUrls.size} URLs découvertes`);

      for (const u of sitemapUrls) {
        const norm = normalizeUrl(u);
        if (!this.queued.has(norm) && isSameOrigin(this.baseUrl, norm)) {
          this.queued.add(norm);
          this.queue.push({ url: norm, depth: 1 });
          this.totalPages++;
        }
      }
    } catch (err) {
      this.logger.warn(`⚠️ Sitemap inaccessible: ${err.message}`);
    }
  }

  async scrapePage({ url, depth }) {
    url = normalizeUrl(url);
    if (this.visited.has(url) || this.isCancelled()) return;
    this.visited.add(url);

    try {
      if (this.delay > 0) await sleep(this.delay);

      this.logger.info(`📄 [${depth}/${this.maxDepth === Infinity ? '∞' : this.maxDepth}] ${url}`);
      const res = await this.http.get(url, { responseType: 'text' });

      if (!res.headers['content-type']?.includes('text/html')) {
        this.assets.add(url);
        return;
      }

      const html = res.data;
      const $ = cheerio.load(html);

      await this.savePage(url, html, $);

      const nextData = extractNextData(html);
      if (nextData) {
        await fs.writeJson(path.join(this.jobDir, '_next_data.json'), nextData, { spaces: 2 });
        this.logger.info('📊 __NEXT_DATA__ extrait');
      }

      this.collectAssets($, url);

      if (depth < this.maxDepth && this.visited.size < MAX_PAGES) {
        this.collectLinks($, url, depth, html);
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
    const rewritten = rewriteHtml(html, pageUrl, this.jobDir, filePath);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, rewritten, 'utf8');
  }

  collectAssets($, pageUrl) {
    $('link[href], script[src], img[src], img[data-src], source[src], video[src], audio[src]').each((_, el) => {
      const el$ = $(el);
      const href = el$.attr('href') || el$.attr('src') || el$.attr('data-src');
      if (!href || href.startsWith('data:') || href.startsWith('#')) return;
      const abs = resolveUrl(pageUrl, href);
      if (abs) this.assets.add(abs);
    });

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

    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      for (const m of style.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi)) {
        const abs = resolveUrl(pageUrl, m[1]);
        if (abs) this.assets.add(abs);
      }
    });

    $('link[rel*="icon"], link[rel="manifest"], link[rel="preload"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        const abs = resolveUrl(pageUrl, href);
        if (abs) this.assets.add(abs);
      }
    });

    $('script:not([src])').each((_, el) => {
      const content = $(el).html() || '';
      extractNextJsAssets(content, pageUrl).forEach(a => this.assets.add(a));
      for (const m of content.matchAll(/fetch\(['"`]([^'"`]+)['"`]/g)) {
        if (m[1].startsWith('/api/') || m[1].includes('/api/')) {
          this.apiCalls.push({ page: pageUrl, endpoint: m[1] });
        }
      }
    });
  }

  collectLinks($, pageUrl, depth, html) {
    const addLink = (href) => {
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) return;
      try {
        const abs = resolveUrl(pageUrl, href);
        if (!abs) return;
        const norm = normalizeUrl(abs);
        if (!this.queued.has(norm) && isSameOrigin(this.baseUrl, abs)) {
          this.queued.add(norm);
          this.queue.push({ url: norm, depth: depth + 1 });
          this.totalPages++;
        }
      } catch {}
    };

    // Standard anchor links
    $('a[href]').each((_, el) => addLink($(el).attr('href')));

    // data-href, data-url, data-link attributes
    $('[data-href],[data-url],[data-link]').each((_, el) => {
      addLink($(el).attr('data-href') || $(el).attr('data-url') || $(el).attr('data-link'));
    });

    // Canonical & alternate links in <head>
    $('link[rel="canonical"],link[rel="alternate"]').each((_, el) => {
      addLink($(el).attr('href'));
    });

    // og:url meta
    const ogUrl = $('meta[property="og:url"]').attr('content');
    if (ogUrl) addLink(ogUrl);

    // Extract absolute internal URLs from inline script content
    const origin = new URL(pageUrl).origin;
    $('script:not([src])').each((_, el) => {
      const content = $(el).html() || '';
      // Match quoted path strings like "/some/path" or full URLs
      const re = /["'`]((?:https?:\/\/[^"'`\s]+|\/[a-zA-Z0-9\-_/]+))["'`]/g;
      let m;
      while ((m = re.exec(content)) !== null) {
        try {
          const abs = new URL(m[1], origin).href;
          if (isSameOrigin(this.baseUrl, abs)) addLink(abs);
        } catch {}
      }
    });
  }

  async downloadAssets() {
    const assets = [...this.assets];
    let downloaded = 0;

    await Promise.all(assets.map(assetUrl => this.limit(async () => {
      if (this.isCancelled()) return;
      try {
        const filePath = urlToFilePath(assetUrl, this.baseUrl, this.jobDir);
        if (!filePath) return;
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          downloaded++;
          return;
        }

        if (this.delay > 0) await sleep(Math.round(this.delay / 4));

        const res = await this.http.get(assetUrl, {
          responseType: 'arraybuffer',
          headers: { ...DEFAULT_HEADERS, Accept: '*/*' },
        });

        const contentType = res.headers['content-type'] || '';
        let data = Buffer.from(res.data);

        if (contentType.includes('text/css')) {
          let css = data.toString('utf8');
          css = rewriteCss(css, assetUrl, this.jobDir, filePath);
          data = Buffer.from(css, 'utf8');
          for (const m of css.matchAll(/url\(['"]?([^'")]+)['"]?\)/gi)) {
            if (!m[1].startsWith('data:')) {
              const abs = resolveUrl(assetUrl, m[1]);
              if (abs && !this.assets.has(abs)) this.assets.add(abs);
            }
          }
        }

        if (contentType.includes('javascript') || assetUrl.includes('.js')) {
          const jsStr = data.toString('utf8');
          extractNextJsAssets(jsStr, assetUrl).forEach(a => {
            if (!this.assets.has(a)) this.assets.add(a);
          });
        }

        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);

        downloaded++;
        const pct = 70 + Math.round((downloaded / assets.length) * 20);
        this.logger.progress(pct, `Assets: ${downloaded}/${assets.length}`);

      } catch {
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
