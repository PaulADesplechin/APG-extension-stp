// ============================================================
// APG eBulletin Bot - Popup Controller
// ============================================================

// ---- Open Dashboard ----
document.getElementById('openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  window.close();
});

// ---- Launch Full Bot ----
document.getElementById('btnLaunchBot').addEventListener('click', async () => {
  const btn = document.getElementById('btnLaunchBot');
  btn.classList.add('running');
  btn.innerHTML = '<span class="bot-icon">⚡</span> Bot en cours...';
  document.getElementById('botStatus').classList.add('visible');
  setStage('login', 'active');

  // Save state
  await chrome.storage.local.set({
    currentJob: { state: 'BOT_RUNNING', stage: 'login', startTime: Date.now() }
  });

  // Check if portal.iata.org is already open
  const portalTabs = await chrome.tabs.query({ url: '*://portal.iata.org/*' });
  if (portalTabs.length > 0) {
    await chrome.tabs.update(portalTabs[0].id, { active: true });
  } else {
    // Open portal login page for manual login + 2FA
    await chrome.tabs.create({
      url: 'https://portal.iata.org/s/login/?language=en_US',
      active: true
    });
  }

  // Open dashboard in bot mode (behind the portal tab for manual login)
  chrome.tabs.create({
    url: chrome.runtime.getURL('dashboard/index.html?mode=bot'),
    active: false
  });
});

// ---- Stage helpers ----
function setStage(stageId, status) {
  const el = document.getElementById(`stage-${stageId}`);
  if (!el) return;
  el.className = `stage ${status}`;
}

// ---- Load stats from storage ----
async function loadStats() {
  try {
    const data = await chrome.storage.local.get(['processingHistory', 'currentJob']);

    const history = data.processingHistory || [];
    document.getElementById('totalProcessed').textContent = history.length;

    if (history.length > 0) {
      const last = history[history.length - 1];
      const date = new Date(last.date);
      document.getElementById('lastDate').textContent =
        date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
    }

    // Update bot status if running
    if (data.currentJob && data.currentJob.state === 'BOT_RUNNING') {
      const btn = document.getElementById('btnLaunchBot');
      btn.classList.add('running');
      btn.innerHTML = '<span class="bot-icon">⚡</span> Bot en cours...';
      document.getElementById('botStatus').classList.add('visible');
      if (data.currentJob.stage) {
        setStage(data.currentJob.stage, 'active');
      }
    }
  } catch (e) {
    // Ignore storage errors
  }
}

loadStats();
