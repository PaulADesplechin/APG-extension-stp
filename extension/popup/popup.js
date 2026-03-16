// ============================================================
// APG Assistant - Popup Controller v5.0
// BSP Link agent status checking (Enable/Disable)
// Shows correct state: idle / running / done / error
// ============================================================

const btn = document.getElementById('btnLaunchBot');
const btnLabel = document.getElementById('btnLabel');
const btnStop = document.getElementById('btnStopBot');
const statusBox = document.getElementById('botStatus');

// ---- Stage definitions ----
const STAGE_ORDER = ['connexion', 'import', 'verification', 'export'];

// ---- UI State Management ----
function setUIState(state, stage) {
  // Reset all stages
  document.querySelectorAll('.bot-status .stage').forEach(el => {
    el.className = 'stage';
  });

  switch (state) {
    case 'idle':
      btn.className = 'btn-bot';
      btn.disabled = false;
      btnLabel.textContent = "Lancer l'Assistant";
      btn.querySelector('.bot-icon').textContent = '🚀';
      statusBox.classList.remove('visible');
      btnStop.classList.remove('visible');
      break;

    case 'running':
      btn.className = 'btn-bot running';
      btn.disabled = true;
      btnLabel.textContent = 'Assistant en cours...';
      btn.querySelector('.bot-icon').textContent = '⚡';
      statusBox.classList.add('visible');
      btnStop.classList.add('visible');
      if (stage) {
        setStage(stage, 'active');
        markPreviousStagesDone(stage);
      }
      break;

    case 'done':
      btn.className = 'btn-bot';
      btn.disabled = false;
      btnLabel.textContent = "Relancer l'Assistant";
      btn.querySelector('.bot-icon').textContent = '✅';
      statusBox.classList.add('visible');
      btnStop.classList.remove('visible');
      // All stages done
      document.querySelectorAll('.bot-status .stage').forEach(el => {
        el.className = 'stage done';
      });
      break;

    case 'error':
      btn.className = 'btn-bot';
      btn.disabled = false;
      btnLabel.textContent = "Relancer l'Assistant";
      btn.querySelector('.bot-icon').textContent = '🚀';
      statusBox.classList.add('visible');
      btnStop.classList.remove('visible');
      if (stage) {
        setStage(stage, 'error');
        markPreviousStagesDone(stage);
      }
      break;
  }
}

function setStage(stageId, status) {
  const el = document.getElementById(`stage-${stageId}`);
  if (el) el.className = `stage ${status}`;
}

function markPreviousStagesDone(currentStage) {
  const idx = STAGE_ORDER.indexOf(currentStage);
  for (let i = 0; i < idx; i++) {
    setStage(STAGE_ORDER[i], 'done');
  }
}

// Map internal bot stages to popup stage IDs
function mapBotStageToPopup(botStage) {
  if (!botStage) return null;
  const s = botStage.toLowerCase();

  // Stage 1: Connexion BSP Link
  if (s.includes('login') || s.includes('2fa') || s.includes('connect') ||
      s.includes('connexion') || s.includes('auth')) return 'connexion';

  // Stage 2: Import fichier Excel
  if (s.includes('import') || s.includes('upload') || s.includes('excel') ||
      s.includes('fichier') || s.includes('read')) return 'import';

  // Stage 3: Verification des statuts
  if (s.includes('verif') || s.includes('status') || s.includes('statut') ||
      s.includes('scraping') || s.includes('ticketing') || s.includes('navigat') ||
      s.includes('bsp') || s.includes('check') || s.includes('settings')) return 'verification';

  // Stage 4: Excel final / export
  if (s.includes('export') || s.includes('report') || s.includes('final') ||
      s.includes('download') || s.includes('complet') || s.includes('done') ||
      s.includes('generat')) return 'export';

  return 'connexion'; // default
}

// ---- Launch Assistant ----
btn.addEventListener('click', async () => {
  if (btn.disabled) return;

  setUIState('running', 'connexion');

  // Save running state
  await chrome.storage.local.set({
    currentJob: { state: 'BOT_RUNNING', stage: 'connexion', lastUpdate: Date.now() }
  });

  // Check if portal.iata.org is already open
  const portalTabs = await chrome.tabs.query({ url: '*://portal.iata.org/*' });
  if (portalTabs.length > 0) {
    await chrome.tabs.update(portalTabs[0].id, { active: true });
  } else {
    await chrome.tabs.create({
      url: 'https://portal.iata.org/s/login/?language=en_US',
      active: true
    });
  }

  // Open dashboard in background
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard/index.html?mode=bot'),
    active: false
  });
});

// ---- Stop Assistant ----
btnStop.addEventListener('click', async () => {
  // Send reset to service worker
  chrome.runtime.sendMessage({ type: 'RESET_BOT_STATE' });
  await chrome.storage.local.set({
    currentJob: { state: 'IDLE', stage: null, lastUpdate: Date.now() }
  });
  setUIState('idle');
});

// ---- Open Dashboard ----
document.getElementById('openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  window.close();
});

// ---- Load state on popup open ----
async function loadState() {
  try {
    // Ask service worker for live state (source of truth)
    const liveState = await chrome.runtime.sendMessage({ type: 'GET_BOT_STATE' });

    if (liveState?.isActive) {
      // Assistant is running right now
      const popupStage = mapBotStageToPopup(liveState.stage);
      setUIState('running', popupStage);
    } else {
      // Service worker says not active -> show idle, clean storage
      await chrome.storage.local.set({
        currentJob: { state: 'IDLE', stage: null, lastUpdate: Date.now() }
      });
      setUIState('idle');
    }

    // Load stats from processingHistory
    const data = await chrome.storage.local.get(['processingHistory']);
    const history = data.processingHistory || [];
    document.getElementById('totalProcessed').textContent = history.length;
    if (history.length > 0) {
      const last = history[history.length - 1];
      const date = new Date(last.date);
      document.getElementById('lastDate').textContent =
        date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }
  } catch (e) {
    // If service worker is not responding, show idle
    setUIState('idle');
  }
}

loadState();
