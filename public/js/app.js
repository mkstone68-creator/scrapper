/* ─── ScrapLink — Frontend Client ─────────────────────────────────────────── */

const socket = io();

// ─── Translations ──────────────────────────────────────────────────────────────
const TRANSLATIONS = {
  en: {
    navHome:      'Home',
    navFeatures:  'Features',
    navPricing:   'Pricing',
    navFaq:       'FAQ',
    navDocs:      'Documentation',
    ctaBtn:       'Get Started',
    heroLine1:    'Transform any',
    heroLine2:    'link',
    heroLine3:    'into',
    heroLine4:    'code.',
    heroSubtitle: 'Enter a URL and download the complete source code of any website as a ZIP file in one click.',
    urlPlaceholder: 'https://example.com',
    pillFast:     'Fast',
    pillSecure:   'Secure',
    startBtn:     'Scrape site',
    howTitle:     'How it works?',
    step1Title:   'Enter the link',
    step1Desc:    'Paste the URL of the site you want to scrape.',
    step2Title:   'Site analysis',
    step2Desc:    "Our tool retrieves all the site's code.",
    step3Title:   'ZIP generation',
    step3Desc:    'The code is organized and compressed into a ZIP file.',
    step4Title:   'Download',
    step4Desc:    'Download your ZIP in one click.',
    featuresTitle: 'Features',
    feat1Title:   'Complete scraping',
    feat1Desc:    'Retrieves HTML, CSS, JS, images and other resources.',
    feat2Title:   'Secure',
    feat2Desc:    'No information is stored. Your data stays private.',
    feat3Title:   'Ultra fast',
    feat3Desc:    'Get the complete source code in seconds.',
    feat4Title:   'Export ZIP',
    feat4Desc:    'Organized file ready to use directly.',
    footerAbout:   'About',
    footerContact: 'Contact',
    footerTerms:   'Terms of use',
    footerPrivacy: 'Privacy policy',
    footerRights:  'All rights reserved.',
    progressTitle: 'Real-time progress',
    cancelBtn:     '✕ Cancel',
    initializing:  'Initializing...',
    statStatus:    'STATUS',
    statMode:      'MODE',
    statDepth:     'DEPTH',
    inProgress:    'In progress',
    terminal:      'Terminal',
    clearLogs:     'Clear',
    resultTitle:   'Scraping complete!',
    downloadBtn:   'Download ZIP',
    viewLogs:      'View logs',
    newJob:        'New scraping',
    errorTitle:    'Error',
    retry:         'Retry',
    invalidUrl:    '❌ Invalid URL — check the format',
    blockedDomain: '🚫 This site cannot be scraped — it belongs to the service owner.',
    cancelRequested: '⛔ Cancellation requested...',
    jobCancelled:  '⛔ Job cancelled',
    connLost:      '⚠️ Connection to server lost',
    zipSize:       'ZIP size',
    done:          '✓ Done',
    error:         '✗ Error',
    depthInfinite: '∞ (whole site)',
    levels:        'level(s)',
  },
  fr: {
    navHome:      'Accueil',
    navFeatures:  'Fonctionnalités',
    navPricing:   'Tarifs',
    navFaq:       'FAQ',
    navDocs:      'Documentation',
    ctaBtn:       'Commencer',
    heroLine1:    "Transformez n'importe quel",
    heroLine2:    'lien',
    heroLine3:    'en',
    heroLine4:    'code.',
    heroSubtitle: 'Entrez une URL et téléchargez tout le code source du site sous forme de fichier ZIP en un clic.',
    urlPlaceholder: 'https://exemple.com',
    pillFast:     'Rapide',
    pillSecure:   'Sécurisé',
    startBtn:     'Scraper le site',
    howTitle:     'Comment ça marche ?',
    step1Title:   'Entrez le lien',
    step1Desc:    'Collez l\'URL du site que vous souhaitez scraper.',
    step2Title:   'Analyse du site',
    step2Desc:    'Notre outil récupère tout le code du site.',
    step3Title:   'Génération du ZIP',
    step3Desc:    'Le code est organisé et compressé dans un fichier ZIP.',
    step4Title:   'Téléchargement',
    step4Desc:    'Téléchargez votre ZIP en un clic.',
    featuresTitle: 'Fonctionnalités',
    feat1Title:   'Scraping complet',
    feat1Desc:    'Récupère le HTML, CSS, JS, images et autres ressources.',
    feat2Title:   'Sécurisé',
    feat2Desc:    'Aucune information n\'est stockée. Vos données restent privées.',
    feat3Title:   'Ultra rapide',
    feat3Desc:    'Obtenez le code source complet en quelques secondes.',
    feat4Title:   'Export ZIP',
    feat4Desc:    'Fichier organisé et prêt à être utilisé directement.',
    footerAbout:   'À propos',
    footerContact: 'Contact',
    footerTerms:   "Conditions d'utilisation",
    footerPrivacy: 'Politique de confidentialité',
    footerRights:  'Tous droits réservés.',
    progressTitle: 'Progression en temps réel',
    cancelBtn:     '✕ Annuler',
    initializing:  'Initialisation...',
    statStatus:    'STATUT',
    statMode:      'MODE',
    statDepth:     'PROFONDEUR',
    inProgress:    'En cours',
    terminal:      'Terminal',
    clearLogs:     'Vider',
    resultTitle:   'Scraping terminé !',
    downloadBtn:   'Télécharger le ZIP',
    viewLogs:      'Voir les logs',
    newJob:        'Nouveau scraping',
    errorTitle:    'Erreur',
    retry:         'Réessayer',
    invalidUrl:    '❌ URL invalide — vérifiez le format',
    blockedDomain: '🚫 Ce site ne peut pas être scrapé — il appartient au propriétaire.',
    cancelRequested: '⛔ Annulation demandée...',
    jobCancelled:  '⛔ Job annulé',
    connLost:      '⚠️ Connexion perdue avec le serveur',
    zipSize:       'Taille du ZIP',
    done:          '✓ Terminé',
    error:         '✗ Erreur',
    depthInfinite: '∞ (tout le site)',
    levels:        'niveau(x)',
  },
};

const BLOCKED_DOMAINS = ['xhrishoost.site'];

// English is the default language
let currentLang = localStorage.getItem('lang') || 'en';

function t(key) {
  return TRANSLATIONS[currentLang][key] || TRANSLATIONS.en[key] || key;
}

function applyLanguage() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n'));
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.placeholder = t(el.getAttribute('data-i18n-placeholder'));
  });
  // Toggle button shows the OTHER language you can switch to
  langBtn.textContent = currentLang === 'en' ? 'FR' : 'EN';
  document.documentElement.lang = currentLang;
}

// ─── Elements ──────────────────────────────────────────────────────────────────
const urlInput        = document.getElementById('urlInput');
const startBtn        = document.getElementById('startBtn');
const cancelBtn       = document.getElementById('cancelBtn');
const clearLogBtn     = document.getElementById('clearLogBtn');
const logBody         = document.getElementById('logBody');
const progressBar     = document.getElementById('progressBar');
const progressLabel   = document.getElementById('progressLabel');
const jobIdBadge      = document.getElementById('jobIdBadge');
const resultSize      = document.getElementById('resultSize');
const downloadBtn     = document.getElementById('downloadBtn');
const newJobBtn       = document.getElementById('newJobBtn');
const retryBtn        = document.getElementById('retryBtn');
const errorMsg        = document.getElementById('errorMsg');
const statStatus      = document.getElementById('statStatus');
const statMode        = document.getElementById('statMode');
const statDepth       = document.getElementById('statDepth');
const langBtn         = document.getElementById('langBtn');
const ctaHeaderBtn    = document.getElementById('ctaHeaderBtn');
const showLogsResultBtn = document.getElementById('showLogsResultBtn');
const showLogsErrorBtn  = document.getElementById('showLogsErrorBtn');
const logModalOverlay   = document.getElementById('logModalOverlay');
const logModalBody      = document.getElementById('logModalBody');
const logModalClose     = document.getElementById('logModalClose');

// Sections
const heroSection       = document.getElementById('heroSection');
const jobSection        = document.getElementById('jobSection');
const progressContainer = document.getElementById('progressContainer');
const resultContainer   = document.getElementById('resultContainer');
const errorContainer    = document.getElementById('errorContainer');

// ─── State ─────────────────────────────────────────────────────────────────────
let currentJobId = null;

// ─── Language Toggle ───────────────────────────────────────────────────────────
langBtn.addEventListener('click', () => {
  currentLang = currentLang === 'en' ? 'fr' : 'en';
  localStorage.setItem('lang', currentLang);
  applyLanguage();
});

// ─── CTA "Get Started" — focus URL input ──────────────────────────────────────
ctaHeaderBtn.addEventListener('click', () => {
  heroSection.classList.remove('hidden');
  urlInput.focus();
  urlInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

// ─── Log Modal ─────────────────────────────────────────────────────────────────
function openLogModal() {
  logModalBody.innerHTML = logBody.innerHTML;
  logModalBody.scrollTop = logModalBody.scrollHeight;
  logModalOverlay.classList.remove('hidden');
}

showLogsResultBtn.addEventListener('click', openLogModal);
showLogsErrorBtn.addEventListener('click', openLogModal);

logModalClose.addEventListener('click', () => logModalOverlay.classList.add('hidden'));

logModalOverlay.addEventListener('click', (e) => {
  if (e.target === logModalOverlay) logModalOverlay.classList.add('hidden');
});

// ─── Enter key on URL input ────────────────────────────────────────────────────
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBtn.click();
});

// ─── Start Scraping ────────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  const raw = urlInput.value.trim();
  if (!raw) { shake(urlInput.closest('.hero-url-box')); return; }

  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) targetUrl = 'https://' + targetUrl;

  try { new URL(targetUrl); } catch {
    shake(urlInput.closest('.hero-url-box'));
    showJobSection();
    showJobContainer('progress');
    addLog('error', t('invalidUrl'));
    return;
  }

  // Client-side block for owner's domain
  if (BLOCKED_DOMAINS.some(d => targetUrl.toLowerCase().includes(d))) {
    showJobSection();
    showJobContainer('error');
    errorMsg.textContent = t('blockedDomain');
    return;
  }

  const config = {
    url:        targetUrl,
    mode:       'fast',
    depth:      3,
    delay:      500,
    timeout:    30000,
    aggressive: false,
  };

  statMode.textContent   = 'Axios+Cheerio';
  statDepth.textContent  = `3 ${t('levels')}`;
  statStatus.textContent = t('inProgress');
  statStatus.style.color = '#a855f7';

  showJobSection();
  showJobContainer('progress');
  resetProgress();
  clearLogs();

  socket.emit('start-scrape', config);
});

// ─── Cancel ────────────────────────────────────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  if (currentJobId) {
    socket.emit('cancel-job', { jobId: currentJobId });
    addLog('warn', t('cancelRequested'));
    cancelBtn.disabled = true;
    cancelBtn.textContent = '...';
  }
});

// ─── Clear Logs ────────────────────────────────────────────────────────────────
clearLogBtn.addEventListener('click', clearLogs);

// ─── Download ──────────────────────────────────────────────────────────────────
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

// ─── Socket Events ─────────────────────────────────────────────────────────────
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
  setProgress(100, t('done'));
  statStatus.textContent = t('done');
  statStatus.style.color = '#22c55e';
  resultSize.textContent = `${t('zipSize')}: ${sizeMB} MB`;
  addLog('success', `🎉 Job complete — ZIP: ${sizeMB} MB`);
  setTimeout(() => showJobContainer('result'), 600);
});

socket.on('job-cancelled', () => {
  addLog('warn', t('jobCancelled'));
  setTimeout(resetAll, 2000);
});

socket.on('job-error', ({ message }) => {
  addLog('error', `💥 ${message}`);
  errorMsg.textContent = message;
  statStatus.textContent = t('error');
  statStatus.style.color = '#ef4444';
  setTimeout(() => showJobContainer('error'), 500);
});

// ─── Section Management ────────────────────────────────────────────────────────
function showJobSection() {
  heroSection.classList.add('hidden');
  jobSection.classList.remove('hidden');
  jobSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function showJobContainer(name) {
  progressContainer.classList.toggle('hidden', name !== 'progress');
  resultContainer.classList.toggle('hidden',   name !== 'result');
  errorContainer.classList.toggle('hidden',    name !== 'error');
}

function resetAll() {
  currentJobId = null;
  cancelBtn.disabled = false;
  cancelBtn.textContent = t('cancelBtn');
  logModalOverlay.classList.add('hidden');
  resetProgress();
  jobSection.classList.add('hidden');
  heroSection.classList.remove('hidden');
  showJobContainer('progress');
  heroSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetProgress() {
  setProgress(0, t('initializing'));
}

function setProgress(pct, label) {
  const c = Math.max(0, Math.min(100, pct));
  progressBar.style.width = `${c}%`;
  progressLabel.textContent = label || `${c}%`;
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
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shake(el) {
  if (!el) return;
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

// ─── Init ──────────────────────────────────────────────────────────────────────
applyLanguage();
