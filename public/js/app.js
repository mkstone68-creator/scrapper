/* ─── NextScraper Pro — Frontend Client ─────────────────────────── */

const socket = io();

// ─── Translations ─────────────────────────────────────────────────
const TRANSLATIONS = {
  fr: {
    configTitle:    'Configuration du scraping',
    urlLabel:       'URL cible',
    urlPlaceholder: 'example.com ou next-app.vercel.app',
    paste:          'Coller',
    modeLabel:      'Mode de scraping',
    modeFastLabel:  'Rapide',
    modeFastDesc:   'Axios + Cheerio<br/>Sites statiques/SSR',
    modeFullLabel:  'Complet',
    modeFullDesc:   'Playwright headless<br/>Next.js / SPA / React',
    depthLabel:     'Profondeur de crawl',
    depthMin:       '1 (page seule)',
    depthMax:       '10 (tout le site)',
    delayLabel:     'Délai entre requêtes',
    timeoutLabel:   'Timeout par page',
    aggressiveName: 'Mode Agressif',
    aggressiveDesc: 'Concurrence x5, screenshot (mode Complet), ignore les délais partiellement',
    startBtn:       'Lancer le scraping',
    progressTitle:  'Progression en temps réel',
    cancelBtn:      '✕ Annuler',
    initializing:   'Initialisation...',
    statStatus:     'STATUT',
    statMode:       'MODE',
    statDepth:      'PROFONDEUR',
    inProgress:     'En cours',
    terminal:       'Terminal',
    clearLogs:      'Vider',
    resultTitle:    'Scraping terminé !',
    downloadBtn:    'Télécharger le ZIP',
    viewLogs:       'Voir les logs',
    newJob:         'Nouveau scraping',
    errorTitle:     'Erreur',
    retry:          'Réessayer',
    tip1:           'Pour les sites <strong>Next.js</strong>, utilisez le mode <strong>Complet (Playwright)</strong> afin d\'exécuter le JavaScript et récupérer le HTML hydraté.',
    tip2:           'Le mode <strong>Rapide</strong> convient aux sites statiques, WordPress, et sites SSR simples.',
    tip3:           'Le ZIP contient les HTML, CSS, JS, images, polices, et les fichiers <code>_next/static</code>.',
    invalidUrl:     '❌ URL invalide — vérifiez le format',
    cancelRequested:'⛔ Annulation demandée...',
    jobCancelled:   '⛔ Job annulé',
    connLost:       '⚠️ Connexion perdue avec le serveur',
    zipSize:        'Taille du ZIP',
    done:           '✓ Terminé',
    error:          '✗ Erreur',
    depthInfinite:  '∞ (tout le site)',
    levels:         'niveau(x)',
  },
  en: {
    configTitle:    'Scraping Configuration',
    urlLabel:       'Target URL',
    urlPlaceholder: 'example.com or next-app.vercel.app',
    paste:          'Paste',
    modeLabel:      'Scraping mode',
    modeFastLabel:  'Fast',
    modeFastDesc:   'Axios + Cheerio<br/>Static / SSR sites',
    modeFullLabel:  'Full',
    modeFullDesc:   'Playwright headless<br/>Next.js / SPA / React',
    depthLabel:     'Crawl depth',
    depthMin:       '1 (single page)',
    depthMax:       '10 (whole site)',
    delayLabel:     'Delay between requests',
    timeoutLabel:   'Timeout per page',
    aggressiveName: 'Aggressive Mode',
    aggressiveDesc: 'Concurrency x5, screenshot (Full mode), partially ignores delays',
    startBtn:       'Start scraping',
    progressTitle:  'Real-time progress',
    cancelBtn:      '✕ Cancel',
    initializing:   'Initializing...',
    statStatus:     'STATUS',
    statMode:       'MODE',
    statDepth:      'DEPTH',
    inProgress:     'In progress',
    terminal:       'Terminal',
    clearLogs:      'Clear',
    resultTitle:    'Scraping complete!',
    downloadBtn:    'Download ZIP',
    viewLogs:       'View logs',
    newJob:         'New scraping',
    errorTitle:     'Error',
    retry:          'Retry',
    tip1:           'For <strong>Next.js</strong> sites, use <strong>Full (Playwright)</strong> mode to execute JavaScript and get hydrated HTML.',
    tip2:           '<strong>Fast</strong> mode works for static sites, WordPress, and simple SSR sites.',
    tip3:           'The ZIP contains HTML, CSS, JS, images, fonts, and <code>_next/static</code> files.',
    invalidUrl:     '❌ Invalid URL — check the format',
    cancelRequested:'⛔ Cancellation requested...',
    jobCancelled:   '⛔ Job cancelled',
    connLost:       '⚠️ Connection to server lost',
    zipSize:        'ZIP size',
    done:           '✓ Done',
    error:          '✗ Error',
    depthInfinite:  '∞ (whole site)',
    levels:         'level(s)',
  },
};

let currentLang = localStorage.getItem('lang') || 'fr';

function t(key) {
  return TRANSLATIONS[currentLang][key] || TRANSLATIONS.fr[key] || key;
}

function applyLanguage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.innerHTML = t(key);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.getAttribute('data-i18n-title'));
  });
  langBtn.textContent = currentLang === 'fr' ? '🌐 EN' : '🌐 FR';
  document.documentElement.lang = currentLang;

  // Update depth display
  const v = parseInt(depth.value);
  depthVal.textContent = v >= 10 ? t('depthInfinite') : v;
}

// ─── Elements ─────────────────────────────────────────────────────
const urlInput      = document.getElementById('urlInput');
const pasteBtn      = document.getElementById('pasteBtn');
const depth         = document.getElementById('depth');
const depthVal      = document.getElementById('depthVal');
const delay         = document.getElementById('delay');
const delayVal      = document.getElementById('delayVal');
const timeout       = document.getElementById('timeout');
const timeoutVal    = document.getElementById('timeoutVal');
const aggressive    = document.getElementById('aggressive');
const startBtn      = document.getElementById('startBtn');
const cancelBtn     = document.getElementById('cancelBtn');
const clearLogBtn   = document.getElementById('clearLogBtn');
const logBody       = document.getElementById('logBody');
const progressBar   = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const jobIdBadge    = document.getElementById('jobIdBadge');
const resultSize    = document.getElementById('resultSize');
const downloadBtn   = document.getElementById('downloadBtn');
const newJobBtn     = document.getElementById('newJobBtn');
const retryBtn      = document.getElementById('retryBtn');
const errorMsg      = document.getElementById('errorMsg');
const statStatus    = document.getElementById('statStatus');
const statMode      = document.getElementById('statMode');
const statDepth     = document.getElementById('statDepth');
const langBtn       = document.getElementById('langBtn');
const showLogsResultBtn = document.getElementById('showLogsResultBtn');
const showLogsErrorBtn  = document.getElementById('showLogsErrorBtn');
const logModalOverlay   = document.getElementById('logModalOverlay');
const logModalBody      = document.getElementById('logModalBody');
const logModalClose     = document.getElementById('logModalClose');

// Panels
const configPanel   = document.getElementById('configPanel');
const progressPanel = document.getElementById('progressPanel');
const resultPanel   = document.getElementById('resultPanel');
const errorPanel    = document.getElementById('errorPanel');

// ─── State ────────────────────────────────────────────────────────
let currentJobId = null;
let currentConfig = null;

// ─── Language Toggle ──────────────────────────────────────────────
langBtn.addEventListener('click', () => {
  currentLang = currentLang === 'fr' ? 'en' : 'fr';
  localStorage.setItem('lang', currentLang);
  applyLanguage();
});

// ─── Log Modal ────────────────────────────────────────────────────
function openLogModal() {
  logModalBody.innerHTML = logBody.innerHTML;
  logModalBody.scrollTop = logModalBody.scrollHeight;
  logModalOverlay.classList.remove('hidden');
}

showLogsResultBtn.addEventListener('click', openLogModal);
showLogsErrorBtn.addEventListener('click', openLogModal);

logModalClose.addEventListener('click', () => {
  logModalOverlay.classList.add('hidden');
});

logModalOverlay.addEventListener('click', (e) => {
  if (e.target === logModalOverlay) logModalOverlay.classList.add('hidden');
});

// ─── Slider Displays ──────────────────────────────────────────────
depth.addEventListener('input', () => {
  const v = parseInt(depth.value);
  depthVal.textContent = v >= 10 ? t('depthInfinite') : v;
});

delay.addEventListener('input', () => {
  const v = parseInt(delay.value);
  delayVal.textContent = v >= 1000 ? `${(v/1000).toFixed(1)}s` : `${v}ms`;
});

timeout.addEventListener('input', () => {
  const v = parseInt(timeout.value);
  timeoutVal.textContent = v >= 60000 ? `${(v/60000).toFixed(1)}min` : `${v/1000}s`;
});

// ─── Paste Button ─────────────────────────────────────────────────
pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    urlInput.value = text.trim().replace(/^https?:\/\//, '');
    urlInput.focus();
  } catch {
    urlInput.focus();
  }
});

urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBtn.click();
});

// ─── Mode Cards ───────────────────────────────────────────────────
document.querySelectorAll('.mode-option').forEach(opt => {
  opt.addEventListener('click', () => {
    opt.querySelector('input[type="radio"]').checked = true;
  });
});

// ─── Start ────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  const raw = urlInput.value.trim();
  if (!raw) { shake(urlInput.closest('.url-wrapper')); return; }

  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  try { new URL(targetUrl); } catch {
    shake(urlInput.closest('.url-wrapper'));
    addLog('error', t('invalidUrl'));
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;
  const depthVal_ = parseInt(depth.value);

  currentConfig = {
    url: targetUrl,
    mode,
    depth:      depthVal_,
    delay:      parseInt(delay.value),
    timeout:    parseInt(timeout.value),
    aggressive: aggressive.checked,
  };

  statMode.textContent  = mode === 'full' ? 'Playwright' : 'Axios+Cheerio';
  statDepth.textContent = depthVal_ >= 10 ? t('depthInfinite') : `${depthVal_} ${t('levels')}`;
  statStatus.textContent = t('inProgress');
  statStatus.style.color = 'var(--accent2)';

  showPanel('progress');
  resetProgress();
  clearLogs();

  socket.emit('start-scrape', currentConfig);
});

// ─── Cancel ───────────────────────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  if (currentJobId) {
    socket.emit('cancel-job', { jobId: currentJobId });
    addLog('warn', t('cancelRequested'));
    cancelBtn.disabled = true;
    cancelBtn.textContent = '...';
  }
});

// ─── Clear Logs ───────────────────────────────────────────────────
clearLogBtn.addEventListener('click', clearLogs);

// ─── Download ─────────────────────────────────────────────────────
downloadBtn.addEventListener('click', () => {
  if (currentJobId) {
    const link = document.createElement('a');
    link.href = `/download/${currentJobId}`;
    link.download = 'website.zip';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
});

newJobBtn.addEventListener('click', resetAll);
retryBtn.addEventListener('click', resetAll);

// ─── Socket Events ────────────────────────────────────────────────
socket.on('connect', () => console.log('[socket] connected:', socket.id));

socket.on('disconnect', () => {
  if (currentJobId) addLog('error', t('connLost'));
});

socket.on('job-started', ({ jobId }) => {
  currentJobId = jobId;
  jobIdBadge.textContent = jobId;
  addLog('info', `🆔 Job: ${jobId}`);
});

socket.on('log', ({ level, message, ts }) => {
  addLog(level, message, ts);
});

socket.on('progress', ({ pct, label }) => {
  setProgress(pct, label);
});

socket.on('job-complete', ({ jobId, sizeMB }) => {
  setProgress(100, currentLang === 'fr' ? 'Terminé !' : 'Done!');
  statStatus.textContent = t('done');
  statStatus.style.color = 'var(--success)';
  resultSize.textContent = `${t('zipSize')}: ${sizeMB} MB`;
  addLog('success', `🎉 ${currentLang === 'fr' ? 'Job terminé' : 'Job complete'} — ZIP: ${sizeMB} MB`);
  setTimeout(() => showPanel('result'), 600);
});

socket.on('job-cancelled', () => {
  addLog('warn', t('jobCancelled'));
  setTimeout(resetAll, 2000);
});

socket.on('job-error', ({ message }) => {
  addLog('error', `💥 ${message}`);
  errorMsg.textContent = message;
  statStatus.textContent = t('error');
  statStatus.style.color = 'var(--error)';
  setTimeout(() => showPanel('error'), 500);
});

// ─── UI Helpers ───────────────────────────────────────────────────
function showPanel(name) {
  configPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');

  if (name === 'config')   configPanel.classList.remove('hidden');
  if (name === 'progress') progressPanel.classList.remove('hidden');
  if (name === 'result')   resultPanel.classList.remove('hidden');
  if (name === 'error')    errorPanel.classList.remove('hidden');
}

function resetAll() {
  currentJobId  = null;
  currentConfig = null;
  cancelBtn.disabled = false;
  cancelBtn.textContent = t('cancelBtn');
  logModalOverlay.classList.add('hidden');
  resetProgress();
  showPanel('config');
}

function resetProgress() {
  setProgress(0, t('initializing'));
}

function setProgress(pct, label) {
  const clamped = Math.max(0, Math.min(100, pct));
  progressBar.style.width = `${clamped}%`;
  progressLabel.textContent = label || `${clamped}%`;
}

function clearLogs() {
  logBody.innerHTML = '';
}

function addLog(level, message, ts) {
  const line = document.createElement('div');
  line.className = `log-line ${level}`;
  line.innerHTML = `<span class="log-ts">${ts || now()}</span><span class="log-msg">${escHtml(message)}</span>`;
  logBody.appendChild(line);
  logBody.scrollTop = logBody.scrollHeight;
  while (logBody.children.length > 500) logBody.removeChild(logBody.firstChild);
}

function now() {
  return new Date().toLocaleTimeString(currentLang === 'fr' ? 'fr-FR' : 'en-US', { hour12: false });
}

function escHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60%  { transform: translateX(-6px); }
    40%, 80%  { transform: translateX(6px); }
  }
`;
document.head.appendChild(style);

// ─── Init ─────────────────────────────────────────────────────────
applyLanguage();
showPanel('config');
