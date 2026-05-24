const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs-extra');
const archiver = require('archiver');
const { v4: uuidv4 } = (function() {
  try { return require('crypto'); } catch(e) { return { v4: () => Math.random().toString(36).slice(2) }; }
})();

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

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/download/:jobId', (req, res) => {
  const zipPath = path.join(DOWNLOADS_DIR, `${req.params.jobId}.zip`);
  if (!fs.existsSync(zipPath)) {
    return res.status(404).json({ error: 'Fichier non trouvé ou expiré' });
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
  console.log(`[+] Client connecté: ${socket.id}`);

  socket.on('start-scrape', async (config) => {
    const jobId = generateId();
    const jobDir = path.join(JOBS_DIR, jobId);
    fs.ensureDirSync(jobDir);

    const logger = createLogger(socket, jobId);
    activeJobs.set(jobId, { socket, cancelled: false });

    socket.emit('job-started', { jobId });
    logger.info(`🚀 Démarrage du job ${jobId}`);
    logger.info(`📋 Mode: ${config.mode === 'full' ? 'Complet (Playwright)' : 'Rapide (Axios+Cheerio)'}`);
    logger.info(`🌐 URL cible: ${config.url}`);

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
        logger.warn('⛔ Job annulé par l\'utilisateur');
        socket.emit('job-cancelled', { jobId });
        return;
      }

      logger.info('📦 Création du fichier ZIP...');
      const zipPath = path.join(DOWNLOADS_DIR, `${jobId}.zip`);
      await createZip(jobDir, zipPath, logger);

      const stats = fs.statSync(zipPath);
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);

      logger.success(`✅ Terminé ! ZIP créé: ${sizeMB} MB`);
      socket.emit('job-complete', { jobId, sizeMB });

    } catch (err) {
      logger.error(`❌ Erreur fatale: ${err.message}`);
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
    console.log(`[-] Client déconnecté: ${socket.id}`);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createLogger(socket, jobId) {
  const emit = (level, msg) => {
    const ts = new Date().toLocaleTimeString('fr-FR');
    const line = `[${ts}] ${msg}`;
    console.log(line);
    socket.emit('log', { jobId, level, message: msg, ts });
  };
  return {
    info: (m) => emit('info', m),
    success: (m) => emit('success', m),
    warn: (m) => emit('warn', m),
    error: (m) => emit('error', m),
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

// ─── Cleanup old jobs ─────────────────────────────────────────────────────────

setInterval(() => {
  const maxAge = 2 * 60 * 60 * 1000; // 2h
  const now = Date.now();

  [JOBS_DIR, DOWNLOADS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) return;
    fs.readdirSync(dir).forEach(f => {
      const fp = path.join(dir, f);
      const stat = fs.statSync(fp);
      if (now - stat.mtimeMs > maxAge) {
        fs.removeSync(fp);
        console.log(`[cleanup] Supprimé: ${fp}`);
      }
    });
  });
}, 30 * 60 * 1000);

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  NextScraper Pro — Port ${PORT}          ║`);
  console.log(`║  http://localhost:${PORT}               ║`);
  console.log(`╚══════════════════════════════════════╝\n`);
});
