const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');

const { FastScraper } = require('./scrapers/fastScraper');
const { FullScraper } = require('./scrapers/fullScraper');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;
const JOBS_DIR = path.join(__dirname, 'jobs');
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');

fs.ensureDirSync(JOBS_DIR);
fs.ensureDirSync(DOWNLOADS_DIR);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const ipLimits = new Map();
const DAILY_LIMIT = 10;
const BLOCKED_DOMAINS = ['xhrishost'];

function getClientIp(socket) {
  const fwd = socket.handshake.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return socket.handshake.address || '0.0.0.0';
}

function checkRateLimit(ip) {
  const today = new Date().toISOString().slice(0, 10);
  let rec = ipLimits.get(ip);
  if (!rec || rec.date !== today) {
    ipLimits.set(ip, { count: 1, date: today });
    return { allowed: true, remaining: DAILY_LIMIT - 1 };
  }
  if (rec.count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  rec.count++;
  return { allowed: true, remaining: DAILY_LIMIT - rec.count };
}

function isBlockedDomain(url) {
  const lower = url.toLowerCase();
  return BLOCKED_DOMAINS.some(domain => lower.includes(domain));
}

// Clean up stale rate-limit entries every hour
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [ip, rec] of ipLimits) {
    if (rec.date !== today) ipLimits.delete(ip);
  }
}, 60 * 60 * 1000);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/download/:jobId', (req, res) => {
  const zipPath = path.join(DOWNLOADS_DIR, `${req.params.jobId}.zip`);
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: 'File not found or expired' });
  }
  res.download(zipPath, 'website.zip');
});

app.delete('/job/:jobId', (req, res) => {
  const jobDir = path.join(JOBS_DIR, req.params.jobId);
  const zipPath = path.join(DOWNLOADS_DIR, `${req.params.jobId}.zip`);
  fs.removeSync(jobDir);
  fs.removeSync(zipPath);
  res.json({ ok: true });
});

// ─── Socket.io – Job Management ───────────────────────────────────────────────

const activeJobs = new Map();

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  socket.on('start-scrape', async (config) => {
    const ip = getClientIp(socket);

    // Block owner's domain
    if (isBlockedDomain(config.url)) {
      socket.emit('job-error', {
        jobId: null,
        message: '🚫 This site cannot be scraped — it belongs to the service owner.',
      });
      return;
    }

    // Enforce daily limit
    const { allowed, remaining } = checkRateLimit(ip);
    if (!allowed) {
      socket.emit('job-error', {
        jobId: null,
        message: `⛔ Daily limit reached (${DAILY_LIMIT} scrapes/day per IP). Try again tomorrow.`,
      });
      return;
    }

    const jobId = generateId();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.ensureDirSync(jobDir);

    const logger = createLogger(socket, jobId);
    activeJobs.set(jobId, { socket, cancelled: false });

    socket.emit('job-started', { jobId, remaining });
    logger.info(`🚀 Job started: ${jobId}`);
    logger.info(`📋 Mode: ${config.mode === 'full' ? 'Full (Playwright)' : 'Fast (Axios+Cheerio)'}`);
    logger.info(`🌐 Target URL: ${config.url}`);
    logger.info(`📊 Scrapes remaining today: ${remaining}`);

    try {
      const isCancelled = () => activeJobs.get(jobId)?.cancelled;

      let scraper;
      if (config.mode === 'full') {
        scraper = new FullScraper({ ...config, jobDir, jobId, logger, isCancelled });
      } else {
        scraper = new FastScraper({ ...config, jobDir, jobId, logger, isCancelled });
      }

      await scraper.run();

      if (isCancelled()) {
        logger.warn('⛔ Job cancelled by user');
        socket.emit('job-cancelled', { jobId });
        return;
      }

      logger.info('📦 Creating ZIP file...');
      const zipPath = path.join(DOWNLOADS_DIR, `${jobId}.zip`);
      await createZip(jobDir, zipPath, logger);

      const stats = fs.statSync(zipPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      logger.success(`✅ Done! ZIP created: ${sizeMB} MB`);
      socket.emit('job-complete', { jobId, sizeMB });

    } catch (err) {
      logger.error(`❌ Fatal error: ${err.message}`);
      console.error(err);
      socket.emit('job-error', { jobId, message: err.message });
    } finally {
      activeJobs.delete(jobId);
    }
  });

  socket.on('cancel-job', ({ jobId }) => {
    if (activeJobs.has(jobId)) {
      activeJobs.get(jobId).cancelled = true;
    }
  });

  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLogger(socket, jobId) {
  const emit = (level, msg) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    console.log(`[${ts}] ${msg}`);
    socket.emit('log', { jobId, level, message: msg, ts });
  };
  return {
    info:     (m) => emit('info', m),
    success:  (m) => emit('success', m),
    warn:     (m) => emit('warn', m),
    error:    (m) => emit('error', m),
    progress: (pct, label) => socket.emit('progress', { jobId, pct, label }),
  };
}

async function createZip(sourceDir, destPath, logger) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destPath);
    const archive = archiver('zip', { zlib: { level: 6 } });

    output.on('close', resolve);
    archive.on('error', reject);
    archive.on('progress', (p) => {
      const pct = Math.round((p.entries.processed / Math.max(p.entries.total, 1)) * 100);
      logger.progress(90 + Math.round(pct * 0.1), `Compression: ${pct}%`);
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

// ─── Cleanup old jobs (2h) ────────────────────────────────────────────────────

setInterval(() => {
  const maxAge = 2 * 60 * 60 * 1000;
  const now = Date.now();
  [JOBS_DIR, DOWNLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.removeSync(fp);
        console.log(`[cleanup] Removed: ${fp}`);
      }
    });
  });
}, 30 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  ScrapLink — Port ${PORT}               ║`);
  console.log(`║  http://localhost:${PORT}              ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
