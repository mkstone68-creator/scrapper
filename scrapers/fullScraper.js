const { chromium } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const {
  resolveUrl, isSameOrigin, urlToFilePath, guessExt,
  rewriteHtml, rewriteCss, extractNextJsAssets, extractNextData,
  sleep, normalizeUrl, fetchSitemapUrls,
} = require('../utils/helpers');

const MAX_PAGES = 5000;

class FullScraper {
  constructor(config) {
    this.url = config.url;
    this.depth = parseInt(config.depth) || 3;
    this.maxDepth = this.depth >= 10 ? Infinity : this.depth;
    this.delay = parseInt(config.delay) || 500;
    this.timeout = parseInt(config.timeout) || 45000;
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
    this.interceptedRequests = [];
    this.apiCalls = [];
    this.failedUrls = new Set();
    this.retryUrls = new Map(); // url → retry count
    this.totalPages = 0;
    this.processedPages = 0;

    this.browser = null;
    this.context = null;

    this.pageLimit = pLimit(this.aggressive ? 4 : 2);
    this.downloadLimit = pLimit(this.aggressive ? 8 : 5);
  }

  async run() {
    this.logger.info('🎭 Mode Complet (Playwright) — Lancement du navigateur headless...');

    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.context = await this.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      viewport: { width: 1920, height: 1080 },
      locale: 'fr-FR',
      extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8' },
    });

    this.context.on('request', (request) => {
      const url = request.url();
      const type = request.resourceType();
      if (['stylesheet', 'script', 'image', 'font', 'media', 'other'].includes(type)) {
        if (!url.startsWith('data:') && !url.startsWith('blob:')) {
          this.assets.add(url);
        }
      }
      if (type === 'fetch' || type === 'xhr') {
        this.interceptedRequests.push({ url, method: request.method(), resourceType: type });
        if (url.includes('/api/') || url.includes('graphql')) {
          this.apiCalls.push({ url, method: request.method() });
        }
      }
    });

    try {
      // Seed queue with start URL
      const startUrl = normalizeUrl(this.baseUrl);
      this.queued.add(startUrl);
      this.queue.push({ url: startUrl, depth: 0 });

      // Discover all URLs from sitemap before starting crawl
      await this.discoverFromSitemap();

      // Crawl loop — process queue in parallel batches
      while (this.queue.length > 0 && !this.isCancelled() && this.visited.size < MAX_PAGES) {
        const concurrency = this.aggressive ? 4 : 2;
        const batch = this.queue.splice(0, concurrency);
        await Promise.all(batch.map(item => this.pageLimit(() => this.scrapePage(item))));
      }

      if (this.isCancelled()) return;

      // Retry failed pages once
      if (this.failedUrls.size > 0) {
        this.logger.info(`🔄 Retry de ${this.failedUrls.size} pages échouées...`);
        const retries = [...this.failedUrls];
        this.failedUrls.clear();
        await Promise.all(retries.map(url =>
          this.pageLimit(() => this.scrapePage({ url, depth: 0 }))
        ));
      }

      this.logger.info(`📥 Téléchargement de ${this.assets.size} ressources interceptées...`);
      await this.downloadAssets();
      await this.saveReports();

    } finally {
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }

  async discoverFromSitemap() {
    try {
      const http = axios.create({ timeout: 15000, maxRedirects: 5 });
      const sitemapUrls = await fetchSitemapUrls(this.baseUrl, http);

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

    const page = await this.context.newPage();

    try {
      if (this.delay > 0) await sleep(this.delay);

      this.logger.info(`🎭 [${depth}/${this.maxDepth === Infinity ? '∞' : this.maxDepth}] ${url}`);

      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      }).catch(() => null);

      if (!response) {
        this.failedUrls.add(url);
        return;
      }

      if (response.status() >= 400) {
        this.logger.warn(`⚠️ HTTP ${response.status()} — ${url}`);
        return;
      }

      await page.waitForTimeout(1200);
      await this.autoScroll(page);

      const html = await page.content();
      await this.savePage(url, html, page);

      // Extract __NEXT_DATA__
      const nextData = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (el) try { return JSON.parse(el.textContent); } catch {}
        return null;
      });
      if (nextData) {
        await fs.writeJson(path.join(this.jobDir, '_next_data.json'), nextData, { spaces: 2 });
      }

      await this.extractNextJsChunks(page, url);

      // Collect all internal links from DOM
      if (depth < this.maxDepth && this.visited.size < MAX_PAGES) {
        const links = await page.evaluate(() => {
          const found = new Set();
          // Standard anchor links
          document.querySelectorAll('a[href]').forEach(a => found.add(a.href));
          // data-href, data-url, data-link attributes
          document.querySelectorAll('[data-href],[data-url],[data-link]').forEach(el => {
            const v = el.dataset.href || el.dataset.url || el.dataset.link;
            if (v) found.add(new URL(v, location.href).href);
          });
          // Canonical / alternate links
          document.querySelectorAll('link[rel="canonical"],link[rel="alternate"]').forEach(el => {
            if (el.href) found.add(el.href);
          });
          // og:url
          const ogUrl = document.querySelector('meta[property="og:url"]');
          if (ogUrl?.content) found.add(ogUrl.content);
          return [...found].filter(Boolean);
        }).catch(() => []);

        // Also extract URLs from inline JS
        const scriptUrls = await this.extractUrlsFromScripts(page, url);
        scriptUrls.forEach(u => links.push(u));

        for (const link of links) {
          try {
            const norm = normalizeUrl(link);
            if (!this.queued.has(norm) && isSameOrigin(this.baseUrl, norm)) {
              this.queued.add(norm);
              this.queue.push({ url: norm, depth: depth + 1 });
              this.totalPages++;
            }
          } catch {}
        }
      }

      // Collect all asset URLs from DOM
      const domAssets = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('[src],[href],[data-src]').forEach(el => {
          const src = el.src || el.href || el.dataset?.src;
          if (src && !src.startsWith('javascript:') && !src.startsWith('#')) urls.add(src);
        });
        document.querySelectorAll('[srcset]').forEach(el => {
          el.srcset.split(',').forEach(s => {
            const u = s.trim().split(/\s+/)[0];
            if (u) urls.add(u);
          });
        });
        return [...urls];
      }).catch(() => []);

      domAssets.forEach(a => {
        if (!a.startsWith('data:') && !a.startsWith('blob:')) this.assets.add(a);
      });

      this.processedPages++;
      const pct = Math.min(75, Math.round((this.processedPages / Math.max(this.totalPages + 1, 3)) * 70));
      this.logger.progress(pct, `Pages: ${this.processedPages} | Queue: ${this.queue.length} | Assets: ${this.assets.size}`);

    } catch (err) {
      if (!this.visited.has(url)) this.failedUrls.add(url);
      this.logger.warn(`⚠️ Échec page: ${url} — ${err.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async extractUrlsFromScripts(page, baseUrl) {
    const urls = [];
    try {
      const scripts = await page.evaluate(() =>
        [...document.querySelectorAll('script:not([src])')].map(s => s.textContent)
      );
      const origin = new URL(baseUrl).origin;
      const re = /["'`](\/[a-zA-Z0-9\-_/]+)["'`]/g;
      for (const src of scripts) {
        let m;
        while ((m = re.exec(src)) !== null) {
          try {
            const abs = new URL(m[1], origin).href;
            if (isSameOrigin(baseUrl, abs)) urls.push(abs);
          } catch {}
        }
      }
    } catch {}
    return urls;
  }

  async autoScroll(page) {
    try {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 400;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 80);
          setTimeout(() => { clearInterval(timer); resolve(); }, 6000);
        });
      });
    } catch {}
  }

  async extractNextJsChunks(page, pageUrl) {
    try {
      const nextInfo = await page.evaluate(() => {
        const data = { buildId: null, chunks: [], pages: [] };
        const nextData = window.__NEXT_DATA__;
        if (nextData) {
          data.buildId = nextData.buildId;
          data.pages = nextData.pages || [];
        }
        if (window.__NEXT_LOADED_PAGES__) {
          data.pages = Object.keys(window.__NEXT_LOADED_PAGES__);
        }
        return data;
      });

      if (nextInfo.buildId) {
        this.logger.info(`🔑 Next.js Build ID: ${nextInfo.buildId}`);
        const buildBase = `${new URL(pageUrl).origin}/_next/static`;
        const chunkPaths = [
          `${buildBase}/chunks/main.js`,
          `${buildBase}/chunks/webpack.js`,
          `${buildBase}/chunks/pages/_app.js`,
          `${buildBase}/chunks/pages/_error.js`,
          `${buildBase}/${nextInfo.buildId}/_buildManifest.js`,
          `${buildBase}/${nextInfo.buildId}/_ssgManifest.js`,
        ];
        chunkPaths.forEach(cp => this.assets.add(cp));

        // Try to fetch build manifest to discover all routes
        try {
          const manifestUrl = `${buildBase}/${nextInfo.buildId}/_buildManifest.js`;
          const http = axios.create({ timeout: 10000 });
          const res = await http.get(manifestUrl, { responseType: 'text' });
          const pageMatches = [...res.data.matchAll(/["'](\/[^"']+)["']/g)];
          const origin = new URL(pageUrl).origin;
          for (const m of pageMatches) {
            try {
              const norm = normalizeUrl(`${origin}${m[1]}`);
              if (!this.queued.has(norm)) {
                this.queued.add(norm);
                this.queue.push({ url: norm, depth: 1 });
                this.totalPages++;
              }
            } catch {}
          }
        } catch {}
      }
    } catch {}
  }

  async savePage(pageUrl, html, page) {
    let filePath = urlToFilePath(pageUrl, this.baseUrl, this.jobDir);
    if (!filePath) return;

    const rewritten = rewriteHtml(html, pageUrl, this.jobDir, filePath);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, rewritten, 'utf8');

    if (this.aggressive && this.processedPages === 0) {
      try {
        const screenshotPath = filePath.replace(/\.html$/, '') + '_screenshot.png';
        await page.screenshot({ path: screenshotPath, fullPage: true });
        this.logger.info('📸 Screenshot sauvegardé');
      } catch {}
    }
  }

  async downloadAssets() {
    const http = axios.create({
      timeout: this.timeout,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*',
      },
      maxRedirects: 10,
      validateStatus: s => s < 500,
    });

    const assets = [...this.assets];
    let downloaded = 0;

    await Promise.all(assets.map(assetUrl => this.downloadLimit(async () => {
      if (this.isCancelled()) return;
      try {
        const filePath = urlToFilePath(assetUrl, this.baseUrl, this.jobDir);
        if (!filePath) return;
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) {
          downloaded++;
          return;
        }

        const res = await http.get(assetUrl, { responseType: 'arraybuffer' });
        const contentType = res.headers['content-type'] || '';
        let data = Buffer.from(res.data);

        if (contentType.includes('text/css')) {
          let css = data.toString('utf8');
          css = rewriteCss(css, assetUrl, this.jobDir, filePath);
          data = Buffer.from(css, 'utf8');
        }

        if (contentType.includes('javascript') || assetUrl.includes('.js')) {
          const jsStr = data.toString('utf8');
          extractNextJsAssets(jsStr, assetUrl).forEach(a => this.assets.add(a));
        }

        await fs.ensureDir(path.dirname(filePath));
        await fs.writeFile(filePath, data);

        downloaded++;
        const pct = 75 + Math.round((downloaded / assets.length) * 15);
        this.logger.progress(pct, `Assets: ${downloaded}/${assets.length}`);
      } catch {
        this.failedUrls.add(assetUrl);
      }
    })));

    this.logger.info(`✅ ${downloaded}/${assets.length} ressources téléchargées`);
  }

  async saveReports() {
    if (this.apiCalls.length > 0) {
      await fs.writeJson(path.join(this.jobDir, '_api_calls.json'), this.apiCalls, { spaces: 2 });
      this.logger.info(`🔌 ${this.apiCalls.length} appels API sauvegardés`);
    }

    if (this.interceptedRequests.length > 0) {
      await fs.writeJson(
        path.join(this.jobDir, '_network_log.json'),
        this.interceptedRequests.slice(0, 500),
        { spaces: 2 }
      );
    }

    if (this.failedUrls.size > 0) {
      await fs.writeFile(path.join(this.jobDir, '_failed_urls.txt'), [...this.failedUrls].join('\n'), 'utf8');
    }

    const summary = {
      url: this.baseUrl,
      mode: 'full (playwright)',
      pagesScraped: this.processedPages,
      assetsDownloaded: this.assets.size,
      apiCallsDetected: this.apiCalls.length,
      failedUrls: this.failedUrls.size,
      scrapedAt: new Date().toISOString(),
    };
    await fs.writeJson(path.join(this.jobDir, '_summary.json'), summary, { spaces: 2 });
    this.logger.info('📋 Rapport de scraping sauvegardé');
  }
}

module.exports = { FullScraper };
