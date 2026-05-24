const { chromium } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs-extra');
const pLimit = require('p-limit');
const {
  resolveUrl, isSameOrigin, urlToFilePath, guessExt,
  rewriteHtml, rewriteCss, extractNextJsAssets, extractNextData,
  sleep, normalizeUrl
} = require('../utils/helpers');

class FullScraper {
  constructor(config) {
    this.url = config.url;
    this.depth = parseInt(config.depth) || 2;
    this.delay = parseInt(config.delay) || 800;
    this.timeout = parseInt(config.timeout) || 45000;
    this.aggressive = config.aggressive === true || config.aggressive === 'true';
    this.jobDir = config.jobDir;
    this.jobId = config.jobId;
    this.logger = config.logger;
    this.isCancelled = config.isCancelled || (() => false);

    this.baseUrl = this.url;
    this.visited = new Set();
    this.queue = [];
    this.assets = new Set();
    this.interceptedRequests = [];
    this.apiCalls = [];
    this.failedUrls = new Set();
    this.totalPages = 0;
    this.processedPages = 0;

    this.browser = null;
    this.context = null;

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
      extraHTTPHeaders: {
        'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8',
      },
    });

    // Intercept all network requests to collect assets
    this.context.on('request', (request) => {
      const url = request.url();
      const type = request.resourceType();

      if (['stylesheet', 'script', 'image', 'font', 'media', 'other'].includes(type)) {
        if (!url.startsWith('data:') && !url.startsWith('blob:')) {
          this.assets.add(url);
        }
      }

      if (type === 'fetch' || type === 'xhr') {
        this.interceptedRequests.push({
          url,
          method: request.method(),
          resourceType: type,
          headers: request.headers(),
        });

        if (url.includes('/api/') || url.includes('graphql')) {
          this.apiCalls.push({ url, method: request.method() });
        }
      }
    });

    try {
      this.queue.push({ url: normalizeUrl(this.baseUrl), depth: 0 });

      while (this.queue.length > 0 && !this.isCancelled()) {
        const item = this.queue.shift();
        await this.scrapePage(item);
      }

      if (this.isCancelled()) return;

      // Download all collected assets
      this.logger.info(`📥 Téléchargement de ${this.assets.size} ressources interceptées...`);
      await this.downloadAssets();

      // Save reports
      await this.saveReports();

    } finally {
      if (this.context) await this.context.close().catch(() => {});
      if (this.browser) await this.browser.close().catch(() => {});
    }
  }

  async scrapePage({ url, depth }) {
    url = normalizeUrl(url);
    if (this.visited.has(url) || this.isCancelled()) return;
    this.visited.add(url);

    const page = await this.context.newPage();

    try {
      if (this.delay > 0) await sleep(this.delay);

      this.logger.info(`🎭 [${depth}/${this.depth}] ${url}`);

      // Navigate and wait for full hydration
      const response = await page.goto(url, {
        waitUntil: 'networkidle',
        timeout: this.timeout,
      });

      if (!response) throw new Error('Pas de réponse');
      if (response.status() >= 400) {
        this.logger.warn(`⚠️ HTTP ${response.status()} — ${url}`);
        return;
      }

      // Extra wait for heavy SPAs
      await page.waitForTimeout(1500);

      // Scroll to trigger lazy loading
      await this.autoScroll(page);

      // Get fully rendered HTML
      const html = await page.content();

      // Save the page
      await this.savePage(url, html, page);

      // Extract Next.js data
      const nextData = await page.evaluate(() => {
        const el = document.getElementById('__NEXT_DATA__');
        if (el) try { return JSON.parse(el.textContent); } catch {}
        return null;
      });

      if (nextData) {
        await fs.writeJson(path.join(this.jobDir, '_next_data.json'), nextData, { spaces: 2 });
        this.logger.info('📊 __NEXT_DATA__ extrait depuis Playwright');
      }

      // Extract Next.js build ID and chunk map
      await this.extractNextJsChunks(page, url);

      // Collect internal links
      if (depth < this.depth) {
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(Boolean);
        });

        for (const link of links) {
          const norm = normalizeUrl(link);
          if (!this.visited.has(norm) && isSameOrigin(this.baseUrl, norm)) {
            this.visited.add(norm);
            this.queue.push({ url: norm, depth: depth + 1 });
            this.totalPages++;
          }
        }
      }

      // Collect all asset URLs from DOM
      const domAssets = await page.evaluate(() => {
        const urls = new Set();
        document.querySelectorAll('[src], [href], [data-src]').forEach(el => {
          const src = el.src || el.href || el.dataset?.src;
          if (src && !src.startsWith('javascript:') && !src.startsWith('#')) {
            urls.add(src);
          }
        });
        document.querySelectorAll('[srcset]').forEach(el => {
          el.srcset.split(',').forEach(s => {
            const url = s.trim().split(/\s+/)[0];
            if (url) urls.add(url);
          });
        });
        return Array.from(urls);
      });

      domAssets.forEach(a => {
        if (!a.startsWith('data:') && !a.startsWith('blob:')) {
          this.assets.add(a);
        }
      });

      this.processedPages++;
      const pct = Math.min(75, Math.round((this.processedPages / Math.max(this.totalPages + 1, 3)) * 70));
      this.logger.progress(pct, `Pages: ${this.processedPages} | Queue: ${this.queue.length} | Assets: ${this.assets.size}`);

    } catch (err) {
      this.failedUrls.add(url);
      this.logger.warn(`⚠️ Échec page: ${url} — ${err.message}`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  async autoScroll(page) {
    try {
      await page.evaluate(async () => {
        await new Promise(resolve => {
          let totalHeight = 0;
          const distance = 300;
          const timer = setInterval(() => {
            window.scrollBy(0, distance);
            totalHeight += distance;
            if (totalHeight >= document.body.scrollHeight) {
              clearInterval(timer);
              window.scrollTo(0, 0);
              resolve();
            }
          }, 100);
          // Max 5s scroll
          setTimeout(() => { clearInterval(timer); resolve(); }, 5000);
        });
      });
    } catch {}
  }

  async extractNextJsChunks(page, pageUrl) {
    try {
      // Get Next.js router data
      const nextInfo = await page.evaluate(() => {
        const data = {
          buildId: null,
          chunks: [],
          pages: [],
        };

        // Build ID
        const nextData = window.__NEXT_DATA__;
        if (nextData) {
          data.buildId = nextData.buildId;
          data.pages = nextData.pages || [];
        }

        // Chunk manifest
        if (window.__NEXT_LOADED_PAGES__) {
          data.pages = Object.keys(window.__NEXT_LOADED_PAGES__);
        }

        return data;
      });

      if (nextInfo.buildId) {
        this.logger.info(`🔑 Next.js Build ID: ${nextInfo.buildId}`);

        const { hostname } = new URL(pageUrl);
        const buildBase = `${new URL(pageUrl).origin}/_next/static`;

        // Common chunk paths
        const chunkPaths = [
          `${buildBase}/chunks/main.js`,
          `${buildBase}/chunks/webpack.js`,
          `${buildBase}/chunks/pages/_app.js`,
          `${buildBase}/chunks/pages/_error.js`,
          `${buildBase}/${nextInfo.buildId}/_buildManifest.js`,
          `${buildBase}/${nextInfo.buildId}/_ssgManifest.js`,
        ];

        chunkPaths.forEach(cp => this.assets.add(cp));
      }
    } catch (err) {
      // Not a Next.js site or older version — ignore
    }
  }

  async savePage(pageUrl, html, page) {
    let filePath = urlToFilePath(pageUrl, this.baseUrl, this.jobDir);
    if (!filePath) return;

    const rewritten = rewriteHtml(html, pageUrl, this.jobDir, filePath);

    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, rewritten, 'utf8');

    // Also save screenshot
    if (this.aggressive) {
      try {
        const screenshotPath = filePath.replace(/\.html$/, '') + '_screenshot.png';
        // Only for first page to avoid huge output
        if (this.processedPages === 0) {
          await page.screenshot({ path: screenshotPath, fullPage: true });
          this.logger.info('📸 Screenshot sauvegardé');
        }
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
          extractNextJsAssets(jsStr, assetUrl).forEach(a => {
            if (!this.assets.has(a)) this.assets.add(a);
          });
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
      await fs.writeJson(
        path.join(this.jobDir, '_api_calls.json'),
        this.apiCalls,
        { spaces: 2 }
      );
      this.logger.info(`🔌 ${this.apiCalls.length} appels API sauvegardés`);
    }

    if (this.interceptedRequests.length > 0) {
      await fs.writeJson(
        path.join(this.jobDir, '_network_log.json'),
        this.interceptedRequests.slice(0, 500), // limit
        { spaces: 2 }
      );
      this.logger.info(`🌐 ${this.interceptedRequests.length} requêtes réseau loggées`);
    }

    if (this.failedUrls.size > 0) {
      await fs.writeFile(
        path.join(this.jobDir, '_failed_urls.txt'),
        [...this.failedUrls].join('\n'),
        'utf8'
      );
    }

    // Summary
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
