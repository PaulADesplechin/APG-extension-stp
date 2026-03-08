// ============================================================
// APG BSP Link Dashboard - Main Application Controller
// ============================================================

let appState = {
  file: null,
  parsedData: null,    // { headers, rows, sheetName }
  columnMapping: null,  // { iataCode, country, agencyName, section }
  results: null,
  processing: false,
  startTime: null,
  timerInterval: null
};

// ---- Navigation ----
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    const section = item.dataset.section;
    switchSection(section);
  });
});

function switchSection(sectionId) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`section-${sectionId}`)?.classList.add('active');
  document.querySelector(`[data-section="${sectionId}"]`)?.classList.add('active');
}

// ---- File Upload ----
const uploadZone = document.getElementById('uploadZone');
const fileInput = document.getElementById('fileInput');

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  uploadZone.classList.add('drag-over');
});

uploadZone.addEventListener('dragleave', () => {
  uploadZone.classList.remove('drag-over');
});

uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFileSelected(file);
});

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) handleFileSelected(file);
});

document.getElementById('removeFile').addEventListener('click', resetUpload);

async function handleFileSelected(file) {
  const validExts = ['.xlsx', '.xls', '.csv'];
  const ext = '.' + file.name.split('.').pop().toLowerCase();
  if (!validExts.includes(ext)) {
    showToast('Format non supporte. Utilisez .xlsx, .xls ou .csv', 'error');
    return;
  }

  appState.file = file;
  document.getElementById('fileName').textContent = file.name;
  document.getElementById('fileMeta').textContent =
    `${(file.size / 1024).toFixed(1)} Ko - ${ext.toUpperCase().replace('.', '')}`;
  document.getElementById('fileInfo').classList.remove('hidden');
  uploadZone.style.display = 'none';

  try {
    const parsed = await ExcelHandler.parseFile(file);
    appState.parsedData = parsed;
    setupColumnMapping(parsed.headers);
    showPreview(parsed.headers, parsed.rows);
    document.getElementById('uploadActions').classList.remove('hidden');
    showToast(`${parsed.rows.length} lignes chargees`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
    resetUpload();
  }
}

function resetUpload() {
  appState.file = null;
  appState.parsedData = null;
  appState.columnMapping = null;
  fileInput.value = '';
  document.getElementById('fileInfo').classList.add('hidden');
  document.getElementById('columnMapping').classList.add('hidden');
  document.getElementById('previewContainer').classList.add('hidden');
  document.getElementById('uploadActions').classList.add('hidden');
  uploadZone.style.display = '';
}

// ---- Column Mapping ----
function setupColumnMapping(headers) {
  const detected = ExcelHandler.detectColumns(headers);
  const selects = {
    colIataCode: detected.iataCode,
    colCountry: detected.country,
    colAgencyName: detected.agencyName,
    colSection: detected.section
  };

  for (const [selectId, defaultVal] of Object.entries(selects)) {
    const select = document.getElementById(selectId);
    // Keep first option if it's a placeholder
    const hasPlaceholder = select.options.length > 0 && select.options[0].value === '';
    while (select.options.length > (hasPlaceholder ? 1 : 0)) {
      select.remove(hasPlaceholder ? 1 : 0);
    }
    // Add column options
    for (const h of headers) {
      const opt = document.createElement('option');
      opt.value = h;
      opt.textContent = h;
      if (h === defaultVal) opt.selected = true;
      select.appendChild(opt);
    }
  }

  document.getElementById('columnMapping').classList.remove('hidden');
}

function getColumnMapping() {
  return {
    iataCode: document.getElementById('colIataCode').value,
    country: document.getElementById('colCountry').value,
    agencyName: document.getElementById('colAgencyName').value,
    section: document.getElementById('colSection').value
  };
}

// ---- Preview Table ----
function showPreview(headers, rows) {
  const maxPreview = 10;
  document.getElementById('rowCount').textContent = `${rows.length} lignes`;

  const thead = document.getElementById('previewHead');
  thead.innerHTML = '<tr>' + headers.slice(0, 8).map(h =>
    `<th>${escapeHtml(h)}</th>`
  ).join('') + (headers.length > 8 ? '<th>...</th>' : '') + '</tr>';

  const tbody = document.getElementById('previewBody');
  tbody.innerHTML = rows.slice(0, maxPreview).map(row =>
    '<tr>' + headers.slice(0, 8).map(h =>
      `<td>${escapeHtml(String(row[h] || ''))}</td>`
    ).join('') + (headers.length > 8 ? '<td>...</td>' : '') + '</tr>'
  ).join('');

  document.getElementById('previewContainer').classList.remove('hidden');
}

// ---- Processing ----
document.getElementById('startProcessing').addEventListener('click', startProcessing);
document.getElementById('pauseProcessing').addEventListener('click', togglePause);
document.getElementById('cancelProcessing').addEventListener('click', cancelProcessing);

async function startProcessing() {
  const mapping = getColumnMapping();
  if (!mapping.iataCode) {
    showToast('Selectionnez la colonne Code IATA', 'error');
    return;
  }
  if (!mapping.country) {
    showToast('Selectionnez la colonne Pays BSP', 'error');
    return;
  }

  appState.columnMapping = mapping;
  appState.processing = true;
  appState.startTime = Date.now();
  appState.results = null;

  switchSection('processing');
  clearLog();
  addLog('Demarrage du traitement...', 'info');
  startTimer();

  const isMock = document.getElementById('mockMode').checked;

  if (isMock) {
    addLog('Mode DEMO active - donnees simulees', 'warning');
    await runMockProcessing();
  } else {
    addLog('Mode LIVE - connexion a BSP Link...', 'info');
    await runLiveProcessing();
  }
}

async function runMockProcessing() {
  const { rows } = appState.parsedData;
  const { iataCode, country } = appState.columnMapping;

  try {
    const results = await MockDataGenerator.generateBatchResults(
      rows, iataCode, country,
      (progress) => updateProgress(progress)
    );

    appState.results = results;
    appState.processing = false;
    stopTimer();
    onProcessingComplete(results);
  } catch (err) {
    appState.processing = false;
    stopTimer();
    addLog(`Erreur: ${err.message}`, 'error');
    showToast('Erreur pendant le traitement', 'error');
  }
}

async function runLiveProcessing() {
  // Send message to service worker to start scraping
  try {
    const port = chrome.runtime.connect({ name: 'processing' });

    port.postMessage({
      type: 'START_PROCESSING',
      payload: {
        rows: appState.parsedData.rows,
        iataColumn: appState.columnMapping.iataCode,
        countryColumn: appState.columnMapping.country,
        mode: 'live'
      }
    });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'PROGRESS_UPDATE':
          updateProgress(msg.payload);
          break;
        case 'PROCESSING_COMPLETE':
          appState.results = msg.payload.results;
          appState.processing = false;
          stopTimer();
          onProcessingComplete(msg.payload.results);
          break;
        case 'PROCESSING_ERROR':
          appState.processing = false;
          stopTimer();
          addLog(`Erreur: ${msg.payload.message}`, 'error');
          showToast(msg.payload.message, 'error');
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      if (appState.processing) {
        addLog('Connexion perdue avec le service worker', 'error');
      }
    });
  } catch (err) {
    appState.processing = false;
    stopTimer();
    addLog(`Erreur: ${err.message}`, 'error');
    showToast('Impossible de communiquer avec le service worker', 'error');
  }
}

function updateProgress(progress) {
  const { completed, total, percent, type, country, countryName } = progress;

  if (type === 'country_switch') {
    document.getElementById('progressCountry').textContent =
      `${countryName || country} (${country})`;
    addLog(`Pays: ${countryName || country} (${country})`, 'country');
  }

  if (type === 'row_result') {
    const pct = percent || Math.round((completed / total) * 100);
    document.getElementById('progressPercent').textContent = `${pct}%`;
    document.getElementById('progressCompleted').textContent = `${completed} / ${total}`;
    document.getElementById('progressFill').style.width = `${pct}%`;

    const statusIcon = progress.lookupStatus === 'found' ? 'OK' : '??';
    addLog(
      `[${statusIcon}] ${progress.iataCode} - ${progress.agentStatus} / ${progress.ticketingAuthority}`,
      progress.lookupStatus === 'found' ? 'success' : 'warning'
    );
  }
}

let isPaused = false;
function togglePause() {
  isPaused = !isPaused;
  const btn = document.getElementById('pauseProcessing');
  if (isPaused) {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Reprendre';
    addLog('Traitement en pause', 'warning');
  } else {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    addLog('Reprise du traitement', 'info');
  }
}

function cancelProcessing() {
  appState.processing = false;
  stopTimer();
  addLog('Traitement annule par l\'utilisateur', 'error');
  showToast('Traitement annule', 'error');
}

// ---- Processing Complete ----
function onProcessingComplete(results) {
  addLog(`Traitement termine: ${results.length} codes traites`, 'success');
  showToast('Traitement termine!', 'success');

  // Build summary
  const found = results.filter(r => r.lookupStatus === 'found').length;
  const notFound = results.filter(r => r.lookupStatus === 'not_found').length;
  const enabled = results.filter(r => r.ticketingAuthority === 'Enabled').length;
  const disabled = results.filter(r => r.ticketingAuthority === 'Disabled').length;

  document.getElementById('resultFound').textContent = found;
  document.getElementById('resultNotFound').textContent = notFound;
  document.getElementById('resultEnabled').textContent = enabled;
  document.getElementById('resultDisabled').textContent = disabled;

  // Build results table
  buildResultsTable(results);

  document.getElementById('resultsEmpty').classList.add('hidden');
  document.getElementById('resultsContent').classList.remove('hidden');

  // Save to history
  saveToHistory(results);

  // Auto switch to results after 1s
  setTimeout(() => switchSection('results'), 1000);
}

function buildResultsTable(results) {
  const thead = document.getElementById('resultsHead');
  thead.innerHTML = `<tr>
    <th>Code IATA</th><th>Pays</th><th>Agent Status</th>
    <th>Ticketing Authority</th><th>Nom Agent</th><th>Statut</th>
  </tr>`;

  const tbody = document.getElementById('resultsBody');
  tbody.innerHTML = results.map(r => {
    const statusClass = r.agentStatus === 'Active' ? 'status-active' :
                        r.agentStatus === 'Inactive' ? 'status-inactive' : '';
    const taClass = r.ticketingAuthority === 'Enabled' ? 'status-enabled' :
                    r.ticketingAuthority === 'Disabled' ? 'status-disabled' :
                    'status-notfound';
    const lookupBadge = r.lookupStatus === 'found' ?
      '<span class="status-enabled">Trouve</span>' :
      '<span class="status-notfound">Non trouve</span>';

    return `<tr>
      <td><strong>${escapeHtml(r.iataCode)}</strong></td>
      <td>${escapeHtml(r.country)}</td>
      <td class="${statusClass}">${escapeHtml(r.agentStatus)}</td>
      <td><span class="${taClass}">${escapeHtml(r.ticketingAuthority)}</span></td>
      <td>${escapeHtml(r.agentName || '-')}</td>
      <td>${lookupBadge}</td>
    </tr>`;
  }).join('');
}

// ---- Download Excel ----
document.getElementById('downloadExcel').addEventListener('click', () => {
  if (!appState.results || !appState.parsedData) {
    showToast('Aucun resultat a telecharger', 'error');
    return;
  }

  const wb = ExcelHandler.createEnrichedExcel(
    appState.parsedData.rows,
    appState.parsedData.headers,
    appState.results
  );

  const baseName = appState.file?.name?.replace(/\.[^.]+$/, '') || 'BSP_Link';
  ExcelHandler.downloadWorkbook(wb, `${baseName}_enrichi_${new Date().toISOString().slice(0, 10)}.xlsx`);
  showToast('Fichier telecharge', 'success');
});

// ---- Send to Server ----
document.getElementById('sendToServer').addEventListener('click', async () => {
  if (!appState.results) {
    showToast('Aucun resultat a envoyer', 'error');
    return;
  }

  try {
    const resp = await fetch('http://localhost:3001/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileName: appState.file?.name,
        results: appState.results,
        date: new Date().toISOString(),
        totalRows: appState.parsedData?.rows?.length
      })
    });

    if (resp.ok) {
      showToast('Resultats envoyes au serveur', 'success');
    } else {
      throw new Error(`Serveur: ${resp.status}`);
    }
  } catch (err) {
    showToast(`Erreur serveur: ${err.message}`, 'error');
  }
});

// ---- History ----
async function saveToHistory(results) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await StorageHelper.addToHistory({
      fileName: appState.file?.name || 'Inconnu',
      totalRows: appState.parsedData?.rows?.length || 0,
      found: results.filter(r => r.lookupStatus === 'found').length,
      notFound: results.filter(r => r.lookupStatus === 'not_found').length,
      enabled: results.filter(r => r.ticketingAuthority === 'Enabled').length,
      disabled: results.filter(r => r.ticketingAuthority === 'Disabled').length,
      mode: document.getElementById('mockMode').checked ? 'demo' : 'live'
    });
    loadHistory();
  }
}

async function loadHistory() {
  if (typeof chrome === 'undefined' || !chrome.storage) return;
  try {
    const history = await StorageHelper.getHistory();
    if (history.length === 0) {
      document.getElementById('historyEmpty').classList.remove('hidden');
      document.getElementById('historyContent').classList.add('hidden');
      return;
    }

    document.getElementById('historyEmpty').classList.add('hidden');
    document.getElementById('historyContent').classList.remove('hidden');

    const list = document.getElementById('historyList');
    list.innerHTML = history.reverse().map(h => {
      const d = new Date(h.date);
      const dateStr = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

      return `<div class="history-item">
        <div class="history-date">${dateStr}<br>${timeStr}</div>
        <div class="history-file">${escapeHtml(h.fileName)}
          <span class="badge">${h.mode === 'demo' ? 'DEMO' : 'LIVE'}</span>
        </div>
        <div class="history-stats">
          <span>Lignes: <span class="count">${h.totalRows}</span></span>
          <span>Trouves: <span class="count">${h.found}</span></span>
          <span>Enabled: <span class="count">${h.enabled}</span></span>
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    // Storage not available (not in extension context)
  }
}

// ---- Timer ----
function startTimer() {
  appState.startTime = Date.now();
  appState.timerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - appState.startTime) / 1000);
    const min = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const sec = String(elapsed % 60).padStart(2, '0');
    document.getElementById('progressTime').textContent = `${min}:${sec}`;
  }, 1000);
}

function stopTimer() {
  if (appState.timerInterval) {
    clearInterval(appState.timerInterval);
    appState.timerInterval = null;
  }
}

// ---- Log ----
function addLog(message, type = 'info') {
  const entries = document.getElementById('logEntries');
  const entry = document.createElement('div');
  const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.className = `log-entry log-${type}`;
  entry.textContent = `[${time}] ${message}`;
  entries.appendChild(entry);
  entries.scrollTop = entries.scrollHeight;
}

function clearLog() {
  document.getElementById('logEntries').innerHTML = '';
}

// ---- Toast Notifications ----
function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ---- Utilities ----
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Init ----
loadHistory();
