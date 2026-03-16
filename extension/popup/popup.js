// ============================================================
// APG eBulletin Bot - Popup Controller v4.1
// Shows correct state: idle / running / done / error
// ============================================================

const btn = document.getElementById('btnLaunchBot');
const btnLabel = document.getElementById('btnLabel');
const btnStop = document.getElementById('btnStopBot');
const statusBox = document.getElementById('botStatus');

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
      btnLabel.textContent = 'Lancer le Bot';
      btn.querySelector('.bot-icon').textContent = '🤖';
      statusBox.classList.remove('visible');
      btnStop.classList.remove('visible');
      break;

    case 'running':
      btn.className = 'btn-bot running';
      btn.disabled = true;
      btnLabel.textContent = 'Bot en cours...';
      btn.querySelector('.bot-icon').textContent = '⚡';
      statusBox.classList.add('visible');
      btnStop.classList.add('visible');
      if (stage) {
        setStage(stage, 'active');
        // Mark all previous stages as done
        markPreviousStagesDone(stage);
      }
      break;

    case 'done':
      btn.className = 'btn-bot';
      btn.disabled = false;
      btnLabel.textContent = 'Relancer le Bot';
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
      btnLabel.textContent = 'Relancer le Bot';
      btn.querySelector('.bot-icon').textContent = '🤖';
      statusBox.classList.add('visible');
      btnStop.classList.remove('visible');
      if (stage) {
        setStage(stage, 'error');
        markPreviousStagesDone(stage);
      }
      break;
  }
}

const STAGE_ORDER = ['login', 'ebulletin', 'processing', 'bsplink', 'report'];

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
  if (s.includes('login') || s.includes('2fa') || s.includes('connect')) return 'login';
  if (s.includes('ebulletin') || s.includes('bulletin') || s.includes('weekly') ||
      s.includes('download') || s.includes('navigat') || s.includes('generate')) return 'ebulletin';
  if (s.includes('process') || s.includes('clean') || s.includes('analy') || s.includes('nettoy')) return 'processing';
  if (s.includes('bsp') || s.includes('scraping') || s.includes('ticketing')) return 'bsplink';
  if (s.includes('report') || s.includes('email') || s.includes('complet') || s.includes('done') || s.includes('final')) return 'report';
  return 'ebulletin'; // default
}

// ---- Launch Bot ----
btn.addEventListener('click', async () => {
  if (btn.disabled) return;

  setUIState('running', 'login');

  // Save running state
  await chrome.storage.local.set({
    currentJob: { state: 'BOT_RUNNING', stage: 'login', lastUpdate: Date.now() }
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

  // Open dashboard in bot mode (behind portal tab)
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard/index.html?mode=bot'),
    active: false
  });
});

// ---- Stop Bot ----
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
    // Ask service worker for live state
    const liveState = await chrome.runtime.sendMessage({ type: 'GET_BOT_STATE' });

    if (liveState?.isActive) {
      const popupStage = mapBotStageToPopup(liveState.stage);
      setUIState('running', popupStage);
    } else {
      // Check storage for last known state
      const data = await chrome.storage.local.get(['currentJob', 'processingHistory']);

      const job = data.currentJob;
      if (job) {
        // If state was "running" but last update was >5 min ago, it's stale → reset
        if (job.state === 'BOT_RUNNING') {
          const staleTimeout = 5 * 60 * 1000; // 5 minutes
          if (job.lastUpdate && Date.now() - job.lastUpdate > staleTimeout) {
            // Stale — reset
            await chrome.storage.local.set({
              currentJob: { state: 'IDLE', stage: null, lastUpdate: Date.now() }
            });
            setUIState('idle');
          } else {
            const popupStage = mapBotStageToPopup(job.stage);
            setUIState('running', popupStage);
          }
        } else if (job.state === 'DONE') {
          setUIState('done');
        } else if (job.state === 'ERROR') {
          const popupStage = mapBotStageToPopup(job.stage);
          setUIState('error', popupStage);
        } else {
          setUIState('idle');
        }
      } else {
        setUIState('idle');
      }

      // Load stats
      const history = data.processingHistory || [];
      document.getElementById('totalProcessed').textContent = history.length;
      if (history.length > 0) {
        const last = history[history.length - 1];
        const date = new Date(last.date);
        document.getElementById('lastDate').textContent =
          date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
      }
    }
  } catch (e) {
    // If service worker is not responding, check storage
    setUIState('idle');
  }
}

loadState();
