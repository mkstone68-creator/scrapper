const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const mime = require('mime-types');

function resolveUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function isSameOrigin(baseUrl, targetUrl) {
  try {
    const b = new URL(baseUrl);
    const t = new URL(targetUrl);
    return b.hostname === t.hostname;
  } catch {
    return false;
  }
}

function urlToFilePath(rawUrl, baseUrl, outputDir) {
  try {
    const parsed = new URL(rawUrl);
    let pathname = decodeURIComponent(parsed.pathname);

    const query = parsed.search
      ? '_' + parsed.search.slice(1).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
      : '';

    let ext = path.extname(pathname);
    if (!ext && parsed.search) ext = '';

    if (pathname.endsWith('/') || !ext) {
      pathname = pathname.replace(/\/$/, '') + '/index.html';
    }

    const filePath = path.join(outputDir, pathname + query);
    return filePath;
  } catch {
    return null;
  }
}

function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200);
}

function guessExt(contentType, urlStr) {
  if (contentType) {
    const ext = mime.extension(contentType.split(';')[0].trim());
    if (ext) return `.${ext}`;
  }
  try {
    const urlExt = path.extname(new URL(urlStr).pathname);
    return urlExt || '.bin';
  } catch {
    return '.bin';
  }
}

function rewriteHtml(html, pageUrl, outputDir, pageFilePath) {
  const pageDir = path.dirname(pageFilePath);

  html = html.replace(
    /((?:src|href|action|data-src|content)=["'])([^"']+)(["'])/gi,
    (match, pre, rawHref, post) => {
      if (rawHref.startsWith('data:') || rawHref.startsWith('#') || rawHref.startsWith('javascript:')) {
        return match;
      }
      try {
        const absUrl = new URL(rawHref, pageUrl).href;
        const localPath = urlToFilePath(absUrl, pageUrl, outputDir);
        if (!localPath) return match;
        const rel = path.relative(pageDir, localPath).replace(/\\/g, '/');
        return `${pre}${rel}${post}`;
      } catch {
        return match;
      }
    }
  );

  html = html.replace(
    /url\((['"]?)([^)'"]+)\1\)/gi,
    (match, quote, rawUrl) => {
      if (rawUrl.startsWith('data:')) return match;
      try {
        const absUrl = new URL(rawUrl, pageUrl).href;
        const localPath = urlToFilePath(absUrl, pageUrl, outputDir);
        if (!localPath) return match;
        const rel = path.relative(path.dirname(pageFilePath), localPath).replace(/\\/g, '/');
        return `url(${quote}${rel}${quote})`;
      } catch {
        return match;
      }
    }
  );

  return html;
}

function rewriteCss(css, cssUrl, outputDir, cssFilePath) {
  return css.replace(
    /url\((['"]?)([^)'"]+)\1\)/gi,
    (match, quote, rawUrl) => {
      if (rawUrl.startsWith('data:')) return match;
      try {
        const absUrl = new URL(rawUrl, cssUrl).href;
        const localPath = urlToFilePath(absUrl, cssUrl, outputDir);
        if (!localPath) return match;
        const rel = path.relative(path.dirname(cssFilePath), localPath).replace(/\\/g, '/');
        return `url(${quote}${rel}${quote})`;
      } catch {
        return match;
      }
    }
  );
}

function extractNextJsAssets(js, baseUrl) {
  const assets = new Set();

  const patterns = [
    /["'`]((?:\/_next\/static\/[^"'`\s]+))["'`]/g,
    /["'`]((?:\/static\/[^"'`\s]+\.(?:js|css|woff2?|png|jpg|svg)))["'`]/g,
    /chunkURL\s*=\s*["'`]([^"'`]+)["'`]/g,
  ];

  for (const re of patterns) {
    let m;
    while ((m = re.exec(js)) !== null) {
      try {
        assets.add(new URL(m[1], baseUrl).href);
      } catch {}
    }
  }
  return assets;
}

function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

function buildInternalPattern(baseUrl) {
  const { hostname } = new URL(baseUrl);
  return new RegExp(`https?://${hostname.replace(/\./g, '\\.')}`, 'i');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    // Normalize trailing slash: treat /foo and /foo/ as the same
    if (u.pathname !== '/' && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return rawUrl;
  }
}

/**
 * Fetch all URLs from a site's sitemap (including sitemap indexes).
 * Checks robots.txt first, then common paths.
 */
async function fetchSitemapUrls(baseUrl, httpClient) {
  const urls = new Set();
  const visitedSitemaps = new Set();

  async function parseSitemap(sitemapUrl) {
    if (visitedSitemaps.has(sitemapUrl)) return;
    visitedSitemaps.add(sitemapUrl);
    try {
      const res = await httpClient.get(sitemapUrl, {
        responseType: 'text',
        timeout: 15000,
        headers: { Accept: 'application/xml,text/xml,*/*' },
      });
      const xml = res.data;
      if (typeof xml !== 'string') return;

      if (xml.includes('<sitemapindex')) {
        // Sitemap index — recurse into sub-sitemaps
        const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim());
        for (const loc of locs) {
          if (!loc.endsWith('.gz')) await parseSitemap(loc);
        }
      } else {
        // Regular sitemap — extract page URLs
        const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => m[1].trim());
        locs.forEach(l => {
          try { new URL(l); urls.add(l); } catch {}
        });
      }
    } catch {}
  }

  const origin = new URL(baseUrl).origin;

  // 1. Check robots.txt for Sitemap: directives
  try {
    const robotsRes = await httpClient.get(`${origin}/robots.txt`, {
      responseType: 'text',
      timeout: 8000,
    });
    const sitemapLines = [...robotsRes.data.matchAll(/^Sitemap:\s*(.+)$/gim)].map(m => m[1].trim());
    for (const su of sitemapLines) await parseSitemap(su);
  } catch {}

  // 2. Try common sitemap locations if nothing found yet
  if (urls.size === 0 && visitedSitemaps.size === 0) {
    for (const candidate of [
      `${origin}/sitemap.xml`,
      `${origin}/sitemap_index.xml`,
      `${origin}/sitemap/sitemap.xml`,
      `${origin}/sitemaps/sitemap.xml`,
    ]) {
      await parseSitemap(candidate);
      if (urls.size > 0) break;
    }
  }

  return urls;
}

module.exports = {
  resolveUrl,
  isSameOrigin,
  urlToFilePath,
  sanitizeFilename,
  guessExt,
  rewriteHtml,
  rewriteCss,
  extractNextJsAssets,
  extractNextData,
  buildInternalPattern,
  sleep,
  normalizeUrl,
  fetchSitemapUrls,
};
