document.getElementById('openDashboard').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/index.html') });
  window.close();
});

// Load stats from storage
async function loadStats() {
  const data = await chrome.storage.local.get(['processingHistory', 'currentJob']);

  const history = data.processingHistory || [];
  document.getElementById('totalProcessed').textContent = history.length;

  if (history.length > 0) {
    const last = history[history.length - 1];
    const date = new Date(last.date);
    document.getElementById('lastDate').textContent =
      date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  }

  // Update status badge
  if (data.currentJob && data.currentJob.state === 'PROCESSING') {
    const badge = document.getElementById('statusBadge');
    badge.className = 'status-badge processing';
    document.getElementById('statusText').textContent = 'Traitement en cours...';
  }
}

loadStats();
