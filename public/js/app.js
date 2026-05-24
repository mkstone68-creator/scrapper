/* ─── NextScraper Pro — Frontend Client ─────────────────────────── */

const socket = io();

// ─── Elements ─────────────────────────────────────────────────────
const urlInput     = document.getElementById('urlInput');
const pasteBtn     = document.getElementById('pasteBtn');
const depth        = document.getElementById('depth');
const depthVal     = document.getElementById('depthVal');
const delay        = document.getElementById('delay');
const delayVal     = document.getElementById('delayVal');
const timeout      = document.getElementById('timeout');
const timeoutVal   = document.getElementById('timeoutVal');
const aggressive   = document.getElementById('aggressive');
const startBtn     = document.getElementById('startBtn');
const cancelBtn    = document.getElementById('cancelBtn');
const clearLogBtn  = document.getElementById('clearLogBtn');
const logBody      = document.getElementById('logBody');
const progressBar  = document.getElementById('progressBar');
const progressLabel = document.getElementById('progressLabel');
const jobIdBadge   = document.getElementById('jobIdBadge');
const resultSize   = document.getElementById('resultSize');
const downloadBtn  = document.getElementById('downloadBtn');
const newJobBtn    = document.getElementById('newJobBtn');
const retryBtn     = document.getElementById('retryBtn');
const errorMsg     = document.getElementById('errorMsg');
const statStatus   = document.getElementById('statStatus');
const statMode     = document.getElementById('statMode');
const statDepth    = document.getElementById('statDepth');

// Panels
const configPanel   = document.getElementById('configPanel');
const progressPanel = document.getElementById('progressPanel');
const resultPanel   = document.getElementById('resultPanel');
const errorPanel    = document.getElementById('errorPanel');

// ─── State ────────────────────────────────────────────────────────
let currentJobId = null;
let currentConfig = null;

// ─── Slider Displays ──────────────────────────────────────────────
depth.addEventListener('input', () => {
  depthVal.textContent = depth.value >= 10 ? '∞ (tout le site)' : depth.value;
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
    const cleaned = text.trim().replace(/^https?:\/\//, '');
    urlInput.value = cleaned;
    urlInput.focus();
  } catch {
    urlInput.focus();
  }
});

// ─── URL Enter key ────────────────────────────────────────────────
urlInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startBtn.click();
});

// ─── Mode Cards ───────────────────────────────────────────────────
document.querySelectorAll('.mode-option').forEach(opt => {
  opt.addEventListener('click', () => {
    const radio = opt.querySelector('input[type="radio"]');
    radio.checked = true;
  });
});

// ─── Start ────────────────────────────────────────────────────────
startBtn.addEventListener('click', () => {
  const raw = urlInput.value.trim();
  if (!raw) {
    shake(urlInput.closest('.url-wrapper'));
    return;
  }

  let targetUrl = raw;
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = 'https://' + targetUrl;
  }

  try {
    new URL(targetUrl); // validate
  } catch {
    shake(urlInput.closest('.url-wrapper'));
    addLog('error', '❌ URL invalide — vérifiez le format');
    return;
  }

  const mode = document.querySelector('input[name="mode"]:checked').value;

  currentConfig = {
    url: targetUrl,
    mode,
    depth: parseInt(depth.value),
    delay: parseInt(delay.value),
    timeout: parseInt(timeout.value),
    aggressive: aggressive.checked,
  };

  // Update stat badges
  statMode.textContent = mode === 'full' ? 'Playwright' : 'Axios+Cheerio';
  statDepth.textContent = `${currentConfig.depth} niveau(x)`;
  statStatus.textContent = 'En cours...';
  statStatus.style.color = 'var(--accent2)';

  // Show progress panel
  showPanel('progress');
  resetProgress();
  clearLogs();

  socket.emit('start-scrape', currentConfig);
});

// ─── Cancel ───────────────────────────────────────────────────────
cancelBtn.addEventListener('click', () => {
  if (currentJobId) {
    socket.emit('cancel-job', { jobId: currentJobId });
    addLog('warn', '⛔ Annulation demandée...');
    cancelBtn.disabled = true;
    cancelBtn.textContent = '...';
  }
});

// ─── Clear Logs ───────────────────────────────────────────────────
clearLogBtn.addEventListener('click', clearLogs);

// ─── Download & New Job ───────────────────────────────────────────
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

socket.on('connect', () => {
  console.log('[socket] connecté:', socket.id);
});

socket.on('disconnect', () => {
  if (currentJobId) {
    addLog('error', '⚠️ Connexion perdue avec le serveur');
  }
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
  setProgress(100, 'Terminé !');
  statStatus.textContent = '✓ Terminé';
  statStatus.style.color = 'var(--success)';
  resultSize.textContent = `Taille du ZIP: ${sizeMB} MB`;
  addLog('success', `🎉 Job terminé — ZIP: ${sizeMB} MB`);

  setTimeout(() => showPanel('result'), 600);
});

socket.on('job-cancelled', () => {
  addLog('warn', '⛔ Job annulé');
  setTimeout(resetAll, 2000);
});

socket.on('job-error', ({ message }) => {
  addLog('error', `💥 ${message}`);
  errorMsg.textContent = message;
  statStatus.textContent = '✗ Erreur';
  statStatus.style.color = 'var(--error)';
  setTimeout(() => showPanel('error'), 500);
});

// ─── UI Helpers ───────────────────────────────────────────────────

function showPanel(name) {
  configPanel.classList.add('hidden');
  progressPanel.classList.add('hidden');
  resultPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');

  if (name === 'config') configPanel.classList.remove('hidden');
  else if (name === 'progress') progressPanel.classList.remove('hidden');
  else if (name === 'result') resultPanel.classList.remove('hidden');
  else if (name === 'error') errorPanel.classList.remove('hidden');
}

function resetAll() {
  currentJobId = null;
  currentConfig = null;
  cancelBtn.disabled = false;
  cancelBtn.textContent = '✕ Annuler';
  resetProgress();
  clearLogs();
  showPanel('config');
}

function resetProgress() {
  setProgress(0, 'Initialisation...');
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
  line.innerHTML = `
    <span class="log-ts">${ts || now()}</span>
    <span class="log-msg">${escHtml(message)}</span>
  `;
  logBody.appendChild(line);
  logBody.scrollTop = logBody.scrollHeight;

  // Trim to 500 lines
  while (logBody.children.length > 500) {
    logBody.removeChild(logBody.firstChild);
  }
}

function now() {
  return new Date().toLocaleTimeString('fr-FR', { hour12: false });
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight;
  el.style.animation = 'shake 0.4s ease';
  el.addEventListener('animationend', () => { el.style.animation = ''; }, { once: true });
}

// Add shake keyframe dynamically
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-6px); }
    40%, 80% { transform: translateX(6px); }
  }
`;
document.head.appendChild(style);

// ─── Init ─────────────────────────────────────────────────────────
showPanel('config');
