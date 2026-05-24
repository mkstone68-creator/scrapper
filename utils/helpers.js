const path = require('path');
const url = require('url');
const fs = require('fs-extra');
const mime = require('mime-types');

/**
 * Normalize a URL – resolve relative → absolute
 */
function resolveUrl(base, href) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

/**
 * Check if a URL belongs to the same origin
 */
function isSameOrigin(baseUrl, targetUrl) {
  try {
    const b = new URL(baseUrl);
    const t = new URL(targetUrl);
    return b.hostname === t.hostname;
  } catch {
    return false;
  }
}

/**
 * Convert a URL to a safe local file path
 */
function urlToFilePath(rawUrl, baseUrl, outputDir) {
  try {
    const parsed = new URL(rawUrl);
    let pathname = decodeURIComponent(parsed.pathname);

    // Strip query from filename but keep as suffix for uniqueness
    const query = parsed.search
      ? '_' + parsed.search.slice(1).replace(/[^a-z0-9_-]/gi, '_').slice(0, 40)
      : '';

    // Determine extension
    let ext = path.extname(pathname);
    if (!ext && parsed.search) ext = '';

    // Index files
    if (pathname.endsWith('/') || !ext) {
      pathname = pathname.replace(/\/$/, '') + '/index.html';
    }

    const filePath = path.join(outputDir, pathname + query);
    return filePath;
  } catch {
    return null;
  }
}

/**
 * Sanitize filename
 */
function sanitizeFilename(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 200);
}

/**
 * Guess extension from content-type header
 */
function guessExt(contentType, urlStr) {
  if (contentType) {
    const ext = mime.extension(contentType.split(';')[0].trim());
    if (ext) return `.${ext}`;
  }
  const urlExt = path.extname(new URL(urlStr).pathname);
  return urlExt || '.bin';
}

/**
 * Convert all absolute/relative URLs in HTML to relative local paths
 */
function rewriteHtml(html, pageUrl, outputDir, pageFilePath) {
  const pageDir = path.dirname(pageFilePath);

  // Rewrite src, href, action attributes
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

  // Rewrite url() in inline styles
  html = html.replace(
    /url\((['"]?)([^)'"]+)\1\)/gi,
    (match, quote, rawUrl) => {
      if (rawUrl.startsWith('data:')) return match;
      try {
        const absUrl = new URL(rawUrl, pageUrl).href;
        const localPath = urlToFilePath(absUrl, pageUrl, outputDir);
        if (!localPath) return match;
        const pageHtmlPath = pageFilePath;
        const rel = path.relative(path.dirname(pageHtmlPath), localPath).replace(/\\/g, '/');
        return `url(${quote}${rel}${quote})`;
      } catch {
        return match;
      }
    }
  );

  return html;
}

/**
 * Rewrite CSS file content (url() references)
 */
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

/**
 * Extract all URLs from JS source that look like Next.js chunks/assets
 */
function extractNextJsAssets(js, baseUrl) {
  const assets = new Set();

  // _next/static patterns
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

/**
 * Extract JSON data from Next.js __NEXT_DATA__ script tag
 */
function extractNextData(html) {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/**
 * Build a regex-safe URL pattern for internal link detection
 */
function buildInternalPattern(baseUrl) {
  const { hostname } = new URL(baseUrl);
  return new RegExp(`https?://${hostname.replace(/\./g, '\\.')}`, 'i');
}

/**
 * Delay helper
 */
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Normalize URL: remove fragment, trailing slash inconsistency
 */
function normalizeUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    return u.href;
  } catch {
    return rawUrl;
  }
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
};
