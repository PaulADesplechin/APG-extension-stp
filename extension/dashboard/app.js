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
  timerInterval: null,
  port: null, // Long-lived connection to service worker
  bspLinkStatus: null
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
    addLog('Mode LIVE - verification de la connexion BSP Link...', 'info');
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
  try {
    // Check if chrome.runtime is available (extension context)
    if (typeof chrome === 'undefined' || !chrome.runtime?.connect) {
      addLog('Erreur: Extension Chrome non detectee. Ouvrez cette page depuis l\'extension.', 'error');
      showToast('Extension Chrome non detectee', 'error');
      appState.processing = false;
      stopTimer();
      return;
    }

    const port = chrome.runtime.connect({ name: 'processing' });
    appState.port = port;

    // First check BSP Link status
    addLog('Verification de la connexion a BSP Link...', 'info');
    port.postMessage({ type: 'CHECK_BSP_LINK' });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case 'BSP_LINK_STATUS':
          handleBSPLinkStatus(msg.payload, port);
          break;
        case 'PROGRESS_UPDATE':
          handleProgressUpdate(msg.payload);
          break;
        case 'PROCESSING_COMPLETE':
          handleProcessingComplete(msg.payload);
          break;
        case 'PROCESSING_ERROR':
          handleProcessingError(msg.payload);
          break;
        case 'PROCESSING_CANCELLED':
          addLog('Traitement annule. Resultats partiels conserves.', 'warning');
          if (msg.payload.results?.length > 0) {
            appState.results = msg.payload.results;
            onProcessingComplete(msg.payload.results, true);
          }
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      if (appState.processing) {
        addLog('Connexion perdue avec le service worker', 'error');
        showToast('Connexion perdue - le traitement continue en arriere-plan', 'error');
      }
      appState.port = null;
    });
  } catch (err) {
    appState.processing = false;
    stopTimer();
    addLog(`Erreur: ${err.message}`, 'error');
    showToast('Impossible de communiquer avec le service worker', 'error');
  }
}

function handleBSPLinkStatus(status, port) {
  appState.bspLinkStatus = status;

  if (!status.found) {
    addLog('BSP Link non trouve! Ouvrez bsplink.iata.org dans un onglet.', 'error');
    addLog('Puis connectez-vous avec vos identifiants IATA.', 'info');
    showToast('Ouvrez BSP Link et connectez-vous d\'abord', 'error');
    appState.processing = false;
    stopTimer();
    return;
  }

  if (!status.isLoggedIn) {
    addLog('BSP Link ouvert mais non connecte!', 'error');
    addLog('Connectez-vous a BSP Link puis relancez le traitement.', 'info');
    showToast('Connectez-vous a BSP Link d\'abord', 'error');
    appState.processing = false;
    stopTimer();
    return;
  }

  // BSP Link is ready - start processing
  addLog(`BSP Link connecte - Pays actuel: ${status.country || 'inconnu'}`, 'success');
  addLog('Lancement du scraping...', 'info');

  port.postMessage({
    type: 'START_PROCESSING',
    payload: {
      rows: appState.parsedData.rows,
      iataColumn: appState.columnMapping.iataCode,
      countryColumn: appState.columnMapping.country,
      mode: 'live'
    }
  });
}

function handleProgressUpdate(payload) {
  switch (payload.type) {
    case 'init':
      addLog(`${payload.totalCountries} pays a traiter, ${payload.totalRows} lignes`, 'info');
      break;

    case 'country_switch':
      document.getElementById('progressCountry').textContent =
        `${payload.country} (${payload.countryIndex}/${payload.totalCountries})`;
      addLog(`Pays: ${payload.country} (${payload.countryIndex}/${payload.totalCountries})`, 'country');
      break;

    case 'country_scraped':
      addLog(`  -> ${payload.agentsFound} agents trouves (${payload.pages} page${payload.pages > 1 ? 's' : ''})`, 'success');
      break;

    case 'country_error':
      addLog(`  ERREUR ${payload.country}: ${payload.error}`, 'error');
      break;

    case 'country_warning':
      addLog(`  ATTENTION ${payload.country}: ${payload.warning}`, 'warning');
      break;

    case 'row_result':
      updateProgressBar(payload);
      const statusIcon = payload.lookupStatus === 'found' ? 'OK' :
                         payload.lookupStatus === 'error' ? 'ERR' : '??';
      addLog(
        `[${statusIcon}] ${payload.iataCode} - ${payload.agentStatus} / ${payload.ticketingAuthority}`,
        payload.lookupStatus === 'found' ? 'success' :
        payload.lookupStatus === 'error' ? 'error' : 'warning'
      );
      break;

    case 'paused':
      addLog('Traitement en pause...', 'warning');
      break;

    case 'resumed':
      addLog('Reprise du traitement', 'info');
      break;
  }
}

function updateProgressBar(payload) {
  const { completed, total, percent } = payload;
  const pct = percent || Math.round((completed / total) * 100);
  document.getElementById('progressPercent').textContent = `${pct}%`;
  document.getElementById('progressCompleted').textContent = `${completed} / ${total}`;
  document.getElementById('progressFill').style.width = `${pct}%`;
}

// Legacy updateProgress for mock mode
function updateProgress(progress) {
  const { completed, total, percent, type, country, countryName } = progress;

  if (type === 'country_switch') {
    document.getElementById('progressCountry').textContent =
      `${countryName || country} (${country})`;
    addLog(`Pays: ${countryName || country} (${country})`, 'country');
  }

  if (type === 'row_result') {
    updateProgressBar(progress);
    const statusIcon = progress.lookupStatus === 'found' ? 'OK' : '??';
    addLog(
      `[${statusIcon}] ${progress.iataCode} - ${progress.agentStatus} / ${progress.ticketingAuthority}`,
      progress.lookupStatus === 'found' ? 'success' : 'warning'
    );
  }
}

function handleProcessingComplete(payload) {
  appState.results = payload.results;
  appState.processing = false;
  stopTimer();

  if (payload.errors?.length > 0) {
    addLog(`Traitement termine avec ${payload.errors.length} erreur(s) par pays`, 'warning');
    for (const err of payload.errors) {
      addLog(`  Pays ${err.country}: ${err.error}`, 'error');
    }
  }

  if (payload.skippedCountries?.length > 0) {
    addLog(`Pays ignores: ${payload.skippedCountries.join(', ')}`, 'warning');
  }

  onProcessingComplete(payload.results);
}

function handleProcessingError(payload) {
  appState.processing = false;
  stopTimer();
  addLog(`Erreur fatale: ${payload.message}`, 'error');

  if (payload.partialResults?.length > 0) {
    addLog(`${payload.completed} resultats partiels sauvegardes`, 'warning');
    appState.results = payload.partialResults;
    onProcessingComplete(payload.partialResults, true);
  } else {
    showToast(payload.message, 'error');
  }
}

let isPaused = false;
function togglePause() {
  isPaused = !isPaused;
  const btn = document.getElementById('pauseProcessing');

  if (appState.port) {
    appState.port.postMessage({ type: isPaused ? 'PAUSE_PROCESSING' : 'RESUME_PROCESSING' });
  }

  if (isPaused) {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg> Reprendre';
    if (appState.timerInterval) stopTimer();
  } else {
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause';
    startTimer();
  }
}

function cancelProcessing() {
  if (appState.port) {
    appState.port.postMessage({ type: 'CANCEL_PROCESSING' });
  }
  appState.processing = false;
  isPaused = false;
  stopTimer();
  addLog('Traitement annule par l\'utilisateur', 'error');
  showToast('Traitement annule', 'error');
}

// ---- Processing Complete ----
function onProcessingComplete(results, isPartial = false) {
  const label = isPartial ? 'Resultats partiels' : 'Traitement termine';
  addLog(`${label}: ${results.length} codes traites`, 'success');
  showToast(`${label}!`, isPartial ? 'info' : 'success');

  // Build summary
  const found = results.filter(r => r.lookupStatus === 'found').length;
  const notFound = results.filter(r => r.lookupStatus === 'not_found').length;
  const errors = results.filter(r => r.lookupStatus === 'error').length;
  const enabled = results.filter(r => r.ticketingAuthority === 'Enabled').length;
  const disabled = results.filter(r => r.ticketingAuthority === 'Disabled').length;

  document.getElementById('resultFound').textContent = found;
  document.getElementById('resultNotFound').textContent = notFound + errors;
  document.getElementById('resultEnabled').textContent = enabled;
  document.getElementById('resultDisabled').textContent = disabled;

  // Build results table
  buildResultsTable(results);

  document.getElementById('resultsEmpty').classList.add('hidden');
  document.getElementById('resultsContent').classList.remove('hidden');

  // Save to history
  saveToHistory(results, isPartial);

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
                        r.agentStatus === 'Inactive' ? 'status-inactive' :
                        r.agentStatus === 'Error' ? 'status-inactive' : '';
    const taClass = r.ticketingAuthority === 'Enabled' ? 'status-enabled' :
                    r.ticketingAuthority === 'Disabled' ? 'status-disabled' :
                    'status-notfound';
    const lookupBadge = r.lookupStatus === 'found' ?
      '<span class="status-enabled">Trouve</span>' :
      r.lookupStatus === 'error' ?
      '<span class="status-disabled">Erreur</span>' :
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
async function saveToHistory(results, isPartial = false) {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    await StorageHelper.addToHistory({
      fileName: appState.file?.name || 'Inconnu',
      totalRows: appState.parsedData?.rows?.length || 0,
      found: results.filter(r => r.lookupStatus === 'found').length,
      notFound: results.filter(r => r.lookupStatus === 'not_found').length,
      errors: results.filter(r => r.lookupStatus === 'error').length,
      enabled: results.filter(r => r.ticketingAuthority === 'Enabled').length,
      disabled: results.filter(r => r.ticketingAuthority === 'Disabled').length,
      mode: document.getElementById('mockMode').checked ? 'demo' : 'live',
      isPartial
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
      const modeLabel = h.mode === 'demo' ? 'DEMO' : 'LIVE';
      const partialLabel = h.isPartial ? ' (partiel)' : '';

      return `<div class="history-item">
        <div class="history-date">${dateStr}<br>${timeStr}</div>
        <div class="history-file">${escapeHtml(h.fileName)}
          <span class="badge">${modeLabel}${partialLabel}</span>
        </div>
        <div class="history-stats">
          <span>Lignes: <span class="count">${h.totalRows}</span></span>
          <span>Trouves: <span class="count">${h.found}</span></span>
          <span>Enabled: <span class="count">${h.enabled}</span></span>
          ${h.errors ? `<span>Erreurs: <span class="count">${h.errors}</span></span>` : ''}
        </div>
      </div>`;
    }).join('');
  } catch (e) {
    // Storage not available (not in extension context)
  }
}

// ---- Timer ----
function startTimer() {
  if (!appState.startTime) appState.startTime = Date.now();
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

// ---- Connection / Login ----
document.getElementById('btnConnect')?.addEventListener('click', startLogin);

async function startLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showToast('Entrez votre email et mot de passe', 'error');
    return;
  }

  // Save credentials if checkbox is checked
  if (document.getElementById('saveCredentials').checked) {
    if (typeof chrome !== 'undefined' && chrome.storage) {
      chrome.storage.local.set({ savedEmail: email });
    }
  }

  // Show progress steps
  document.getElementById('loginForm').classList.add('hidden');
  document.getElementById('loginProgress').classList.remove('hidden');

  // Update status indicator
  setConnectionStatus('connecting', 'Connexion en cours...');

  try {
    const port = chrome.runtime.connect({ name: 'processing' });
    appState.port = port;

    port.postMessage({
      type: 'START_LOGIN',
      payload: { email, password }
    });

    port.onMessage.addListener((msg) => {
      if (msg.type === 'LOGIN_STATUS') {
        handleLoginStep(msg.payload);
      }
    });

    port.onDisconnect.addListener(() => {
      // Port disconnected
    });
  } catch (err) {
    showToast(`Erreur: ${err.message}`, 'error');
    document.getElementById('loginForm').classList.remove('hidden');
    document.getElementById('loginProgress').classList.add('hidden');
    setConnectionStatus('disconnected', 'Erreur de connexion');
  }
}

function handleLoginStep(payload) {
  const { step, message } = payload;

  switch (step) {
    case 'opening':
      setStepStatus('step-opening', 'active', message);
      break;
    case 'filling':
      setStepStatus('step-opening', 'done', 'Portail IATA ouvert');
      setStepStatus('step-filling', 'active', message);
      break;
    case 'filled':
      setStepStatus('step-filling', 'done', 'Identifiants remplis');
      setStepStatus('step-2fa', 'active', 'En attente de validation par votre collegue...');
      setConnectionStatus('connecting', 'Attente validation 2FA...');
      break;
    case 'waiting_2fa':
      setStepStatus('step-2fa', 'active', message);
      break;
    case 'logged_in':
      setStepStatus('step-2fa', 'done', '2FA valide!');
      setStepStatus('step-bsplink', 'active', 'Navigation vers BSP Link...');
      break;
    case 'already_logged_in':
      setStepStatus('step-opening', 'done', 'Deja connecte');
      setStepStatus('step-filling', 'done', 'Non necessaire');
      setStepStatus('step-2fa', 'done', 'Non necessaire');
      setStepStatus('step-bsplink', 'active', 'Navigation vers BSP Link...');
      break;
    case 'success':
      setStepStatus('step-bsplink', 'done', 'Connecte a BSP Link!');
      setConnectionStatus('connected', 'Connecte a BSP Link');
      showToast('Connexion reussie! Vous pouvez maintenant uploader un fichier.', 'success');
      // Auto-disable mock mode
      document.getElementById('mockMode').checked = false;
      break;
    case 'navigate_manual':
      setStepStatus('step-bsplink', 'done', message);
      setConnectionStatus('connected', 'Connecte au portail IATA');
      showToast('Connecte! Naviguez vers BSP Link manuellement.', 'info');
      break;
    case 'login_page_not_ready':
    case 'fill_error':
    case 'error':
    case 'timeout':
      setConnectionStatus('disconnected', message);
      showToast(message, 'error');
      // Show login form again
      setTimeout(() => {
        document.getElementById('loginForm').classList.remove('hidden');
        document.getElementById('loginProgress').classList.add('hidden');
        resetLoginSteps();
      }, 3000);
      break;
  }
}

function setConnectionStatus(status, message) {
  const indicator = document.getElementById('statusIndicator');
  indicator.className = `status-indicator ${status}`;

  const icon = status === 'connected'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    : status === 'connecting'
    ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
    : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';

  document.getElementById('statusMessage').textContent = message;
  indicator.innerHTML = icon + `<span id="statusMessage">${escapeHtml(message)}</span>`;
}

function setStepStatus(stepId, status, detail) {
  const step = document.getElementById(stepId);
  if (!step) return;

  const icon = step.querySelector('.step-icon');
  icon.className = `step-icon ${status}`;

  if (status === 'done') {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (status === 'error') {
    icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }

  const detailEl = step.querySelector('.step-detail');
  if (detailEl && detail) detailEl.textContent = detail;
}

function resetLoginSteps() {
  ['step-opening', 'step-filling', 'step-2fa', 'step-bsplink'].forEach(id => {
    const step = document.getElementById(id);
    if (!step) return;
    const icon = step.querySelector('.step-icon');
    const num = id.split('-').pop() === 'opening' ? '1' :
                id.split('-').pop() === 'filling' ? '2' :
                id.split('-').pop() === '2fa' ? '3' : '4';
    icon.className = 'step-icon pending';
    icon.textContent = num;
  });
}

// Load saved email on init
async function loadSavedCredentials() {
  if (typeof chrome !== 'undefined' && chrome.storage) {
    try {
      const data = await chrome.storage.local.get(['savedEmail']);
      if (data.savedEmail) {
        document.getElementById('loginEmail').value = data.savedEmail;
        document.getElementById('saveCredentials').checked = true;
      }
    } catch {}
  }
}

// ============================================================
// BOT PIPELINE - Fully automated eBulletin processing
// ============================================================

appState.cleanedWorkbook = null;
appState.anomalyResults = null;
appState.analysisResults = null;
appState.actionsTable = null;
appState.botRunning = false;

// ---- Bot Log Helper ----
function botLog(message, type = 'info') {
  const log = document.getElementById('botLog');
  if (!log) return;
  log.querySelectorAll('.typing').forEach(el => el.classList.remove('typing'));
  const entry = document.createElement('div');
  entry.className = `bot-log-entry bot-log-${type} typing`;
  entry.textContent = message;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
  setTimeout(() => entry.classList.remove('typing'), 1500);
}

function setBotStage(stageId, status, detail, badge) {
  const stage = document.getElementById(`bot-stage-${stageId}`);
  if (!stage) return;
  const icon = stage.querySelector('.bot-stage-icon');
  icon.className = `bot-stage-icon ${status}`;
  stage.className = `bot-stage ${status === 'active' ? 'active-stage' : status === 'done' ? 'done-stage' : ''}`;
  if (status === 'done') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
  } else if (status === 'error') {
    icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  if (detail) document.getElementById(`bot-detail-${stageId}`).textContent = detail;
  if (badge) {
    const badgeEl = document.getElementById(`bot-badge-${stageId}`);
    badgeEl.textContent = badge.text;
    badgeEl.className = `bot-stage-badge badge-${badge.type || 'info'}`;
  }
}

function setBotStatus(text) {
  const el = document.getElementById('botStatusText');
  if (el) el.textContent = text;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

// ---- Launch Bot ----
document.getElementById('btnLaunchBot')?.addEventListener('click', launchBot);
document.getElementById('botDownloadReport')?.addEventListener('click', downloadFullReport);
document.getElementById('botViewEmail')?.addEventListener('click', showEmailPreview);
document.getElementById('botViewDetails')?.addEventListener('click', () => switchSection('analysis'));

async function launchBot() {
  if (!appState.file || !appState.parsedData) {
    showToast('Uploadez un fichier d\'abord', 'error');
    return;
  }
  const mapping = getColumnMapping();
  if (!mapping.iataCode || !mapping.country) {
    showToast('Selectionnez les colonnes Code IATA et Pays', 'error');
    return;
  }
  appState.columnMapping = mapping;
  appState.botRunning = true;

  document.getElementById('botPipeline').classList.remove('hidden');
  document.getElementById('uploadActions').classList.add('hidden');
  document.getElementById('botLog').innerHTML = '';

  botLog('Bot APG initialise. Fichier: ' + appState.file.name, 'stage');
  botLog(`${appState.parsedData.rows.length} lignes detectees`, 'info');
  setBotStatus('Pipeline en cours...');

  try {
    // ===== STAGE 1: CLEANING =====
    await sleep(400);
    setBotStage('clean', 'active', 'Nettoyage en cours...');
    botLog('ETAPE 1/5 - Nettoyage du fichier Excel', 'stage');
    const cleanResult = await runBotCleaning();
    setBotStage('clean', 'done',
      `${cleanResult.rowsRemoved} lignes vides, ${cleanResult.riskConverted + cleanResult.irrConverted} cellules converties`,
      { text: `${cleanResult.rowsRemoved} nettoyees`, type: 'success' });
    botLog(`Nettoyage OK: ${cleanResult.rowsRemoved} lignes supprimees, 2 colonnes IATA inserees`, 'success');
    updateCleaningSection(cleanResult);

    // ===== STAGE 2: ANOMALY DETECTION =====
    await sleep(600);
    setBotStage('anomaly', 'active', 'Scan des anomalies...');
    botLog('ETAPE 2/5 - Detection des anomalies', 'stage');
    const anomalyResult = runBotAnomalyDetection();
    const totalAnomalies = anomalyResult.summary.totalAnomalies;
    setBotStage('anomaly', 'done',
      `${totalAnomalies} anomalie(s), ${anomalyResult.noActionRows.length} No Action`,
      { text: `${totalAnomalies} trouvees`, type: totalAnomalies > 5 ? 'warning' : 'success' });
    if (totalAnomalies > 0) botLog(`${anomalyResult.summary.severityCounts.high} haute, ${anomalyResult.summary.severityCounts.medium} moyenne, ${anomalyResult.summary.severityCounts.low} faible`, 'warning');
    else botLog('Aucune anomalie critique', 'success');
    if (anomalyResult.duplicates.length > 0) botLog(`${anomalyResult.duplicates.length} doublons detectes`, 'warning');
    botLog(`${anomalyResult.noActionRows.length} lignes "No Action"`, 'info');

    // ===== STAGE 3: ACTION ANALYSIS =====
    await sleep(600);
    setBotStage('analysis', 'active', 'Analyse des actions...');
    botLog('ETAPE 3/5 - Analyse OPENED / CLOSED / NO ACTION', 'stage');
    const analysisResult = runBotActionAnalysis();
    const summary = ActionAnalyzer.getSummary(analysisResult);
    setBotStage('analysis', 'done',
      `OPENED: ${summary.counts.OPENED || 0}, CLOSED: ${summary.counts.CLOSED || 0}, REVIEW: ${summary.counts.REVIEW || 0}`,
      { text: `${summary.averageConfidence}% confiance`, type: summary.averageConfidence >= 70 ? 'success' : 'warning' });
    botLog(`${summary.counts.OPENED || 0} OPENED, ${summary.counts.CLOSED || 0} CLOSED, ${summary.counts['NO ACTION'] || 0} NO ACTION, ${summary.counts.REVIEW || 0} REVIEW`, 'success');
    botLog(`Confiance moyenne: ${summary.averageConfidence}%`, 'info');
    if (summary.conflicts > 0) botLog(`${summary.conflicts} conflits detectes`, 'warning');

    // ===== STAGE 4: BSP LINK =====
    await sleep(500);
    const isMock = document.getElementById('mockMode').checked;
    if (isMock) {
      setBotStage('bsplink', 'active', 'Simulation BSP Link (mode demo)...');
      botLog('ETAPE 4/5 - BSP Link (MODE DEMO)', 'stage');
      await runBotMockBSPLink();
      setBotStage('bsplink', 'done', 'Donnees simulees generees', { text: 'DEMO', type: 'info' });
      botLog('BSP Link simule: donnees generees', 'success');
      runBotActionAnalysis(); // re-run with BSP data
    } else {
      setBotStage('bsplink', 'skipped', 'Utilisez "BSP Link seulement"', { text: 'SKIP', type: 'warning' });
      botLog('ETAPE 4/5 - BSP Link ignore (mode manuel)', 'warning');
    }

    // ===== STAGE 5: REPORT =====
    await sleep(500);
    setBotStage('report', 'active', 'Generation du rapport...');
    botLog('ETAPE 5/5 - Generation rapport & email', 'stage');
    generateActionsTable();
    const actionsCount = appState.actionsTable?.summary?.totalActions || 0;
    const highPriority = appState.actionsTable?.summary?.highPriority || 0;
    setBotStage('report', 'done', `${actionsCount} actions TA, rapport pret`,
      { text: `${actionsCount} actions`, type: actionsCount > 0 ? 'success' : 'info' });
    botLog(`${actionsCount} actions, ${highPriority} priorite haute`, 'success');
    botLog('Email HTML pret', 'success');

    // ===== DONE =====
    await sleep(300);
    setBotStatus('Pipeline termine!');
    botLog('', 'info');
    botLog('PIPELINE TERMINE - Rapport pret a telecharger.', 'stage');
    document.getElementById('botActions').classList.remove('hidden');
    showToast('Bot termine! Rapport pret.', 'success');

  } catch (err) {
    setBotStatus('Erreur');
    botLog(`ERREUR: ${err.message}`, 'error');
    showToast(`Erreur: ${err.message}`, 'error');
  }
  appState.botRunning = false;
}

// ---- Bot sub-routines ----
function runBotCleaning() {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const cleaned = EbulletinCleaner.cleanWorkbook(wb);
        appState.cleanedWorkbook = cleaned;
        resolve({ rowsRemoved: cleaned._cleaningStats.rowsRemoved, riskConverted: cleaned._cleaningStats.riskCellsConverted, irrConverted: cleaned._cleaningStats.irrCellsConverted });
      } catch (err) { reject(err); }
    };
    reader.onerror = () => reject(new Error('Erreur lecture'));
    reader.readAsArrayBuffer(appState.file);
  });
}

function updateCleaningSection(stats) {
  setCleanStepStatus('clean-step-1', 'done');
  document.getElementById('cleanStat1').textContent = `${stats.rowsRemoved} supprimees`;
  setCleanStepStatus('clean-step-2', 'done');
  document.getElementById('cleanStat2').textContent = '2 colonnes';
  setCleanStepStatus('clean-step-3', 'done');
  document.getElementById('cleanStat3').textContent = `${stats.riskConverted} converties`;
  setCleanStepStatus('clean-step-4', 'done');
  document.getElementById('cleanStat4').textContent = `${stats.irrConverted} converties`;
  document.getElementById('btnDownloadCleaned').disabled = false;
}

function setCleanStepStatus(stepId, status) {
  const step = document.getElementById(stepId);
  if (!step) return;
  const icon = step.querySelector('.pipeline-icon');
  icon.className = `pipeline-icon ${status}`;
  if (status === 'done') icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
}

function runBotAnomalyDetection() {
  const mapping = getColumnMapping();
  const results = AnomalyDetector.analyzeAll(appState.parsedData.rows, appState.parsedData.headers, mapping);
  appState.anomalyResults = results;
  const sev = results.summary.severityCounts;
  document.getElementById('anomalyHigh').textContent = sev.high;
  document.getElementById('anomalyMedium').textContent = sev.medium;
  document.getElementById('anomalyLow').textContent = sev.low;
  document.getElementById('anomalyNoAction').textContent = results.noActionRows.length;
  renderAnomalyList('anomalyBSPList', results.bspAnomalies);
  renderAnomalyList('anomalyDuplicatesList', results.duplicates);
  renderAnomalyList('anomalyNAList', results.naValues.slice(0, 20));
  renderAnomalyList('anomalyRiskList', results.riskAnomalies);
  return results;
}

function renderAnomalyList(elementId, anomalies) {
  const el = document.getElementById(elementId);
  if (!el) return;
  if (anomalies.length === 0) { el.textContent = 'Aucune anomalie detectee'; return; }
  el.innerHTML = anomalies.slice(0, 15).map(a =>
    `<div class="anomaly-item ${a.severity}">${escapeHtml(a.message)}</div>`
  ).join('') + (anomalies.length > 15 ? `<div class="anomaly-item low">... et ${anomalies.length - 15} autres</div>` : '');
}

function runBotActionAnalysis() {
  const mapping = getColumnMapping();
  const analyses = ActionAnalyzer.analyzeAll(appState.parsedData.rows, mapping, appState.results);
  appState.analysisResults = analyses;
  const summary = ActionAnalyzer.getSummary(analyses);
  document.getElementById('analysisOpened').textContent = summary.counts.OPENED || 0;
  document.getElementById('analysisClosed').textContent = summary.counts.CLOSED || 0;
  document.getElementById('analysisNoAction').textContent = summary.counts['NO ACTION'] || 0;
  document.getElementById('analysisReview').textContent = summary.counts.REVIEW || 0;
  document.getElementById('avgConfidence').textContent = `${summary.averageConfidence}%`;
  document.getElementById('confidenceFill').style.width = `${summary.averageConfidence}%`;
  document.getElementById('confHigh').textContent = summary.highConfidence;
  document.getElementById('confMedium').textContent = summary.total - summary.highConfidence - summary.lowConfidence;
  document.getElementById('confLow').textContent = summary.lowConfidence;
  const tbody = document.getElementById('analysisBody');
  if (tbody) {
    tbody.innerHTML = analyses.slice(0, 50).map(a => {
      const actionClass = a.action === 'OPENED' ? 'action-opened' : a.action === 'CLOSED' ? 'action-closed' : a.action === 'REVIEW' ? 'action-review' : 'action-noaction';
      const confClass = a.confidence >= 80 ? 'high' : a.confidence >= 50 ? 'medium' : 'low';
      return `<tr><td><strong>${escapeHtml(a.iataCode)}</strong></td><td>${escapeHtml(a.country)}</td><td class="${actionClass}">${escapeHtml(a.action)}</td><td><div class="confidence-cell"><div class="confidence-mini-bar"><div class="confidence-mini-fill ${confClass}" style="width:${a.confidence}%"></div></div>${a.confidence}%</div></td><td>${escapeHtml(a.reasoning[0] || '-')}</td></tr>`;
    }).join('');
  }
  return analyses;
}

async function runBotMockBSPLink() {
  const { rows } = appState.parsedData;
  const { iataCode, country } = appState.columnMapping;
  appState.results = await MockDataGenerator.generateBatchResults(rows, iataCode, country,
    (p) => { if (p.type === 'country_switch') botLog(`  BSP: ${p.countryName || p.country}...`, 'info'); });
}

// ---- Shared functions ----
function generateActionsTable() {
  if (!appState.analysisResults) return;
  const deadlineInput = document.getElementById('deadlineDate');
  let deadline;
  if (deadlineInput?.value) { const d = new Date(deadlineInput.value); deadline = d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
  const actionsTable = OutputGenerator.generateActionsTable(appState.analysisResults, appState.results, deadline);
  appState.actionsTable = actionsTable;
  document.getElementById('actionsTitle').textContent = actionsTable.title;
  document.getElementById('actionsOpened').textContent = actionsTable.summary.opened;
  document.getElementById('actionsClosed').textContent = actionsTable.summary.closed;
  document.getElementById('actionsReview').textContent = actionsTable.summary.review;
  document.getElementById('actionsHighPriority').textContent = actionsTable.summary.highPriority;
  const tbody = document.getElementById('actionsBody');
  if (tbody) {
    tbody.innerHTML = actionsTable.rows.map(row => {
      const ac = row.requiredAction === 'OPENED' ? 'action-opened' : row.requiredAction === 'CLOSED' ? 'action-closed' : 'action-review';
      const pc = row.priority === 'high' ? 'priority-high' : row.priority === 'medium' ? 'priority-medium' : '';
      return `<tr class="${pc}"><td><strong>${escapeHtml(row.iataCode)}</strong></td><td>${escapeHtml(row.country)}</td><td>${escapeHtml(row.agentName)}</td><td>${escapeHtml(row.currentStatus)}</td><td>${escapeHtml(row.currentTA)}</td><td class="${ac}">${escapeHtml(row.requiredAction)}</td><td>${row.priority.toUpperCase()}</td><td>${row.confidence}%</td></tr>`;
    }).join('');
  }
}

function downloadFullReport() {
  if (!appState.actionsTable || !appState.parsedData) { showToast('Lancez le bot d\'abord', 'error'); return; }
  const wb = OutputGenerator.createFullReport(appState.parsedData, appState.cleanedWorkbook?._cleaningStats || {},
    appState.anomalyResults || { bspAnomalies: [], actionAnomalies: [], naValues: [], duplicates: [], riskAnomalies: [], noActionRows: [] },
    appState.analysisResults, appState.actionsTable, appState.results);
  OutputGenerator.downloadReport(wb);
  showToast('Rapport telecharge', 'success');
}

function showEmailPreview() {
  if (!appState.actionsTable) { showToast('Lancez le bot d\'abord', 'error'); return; }
  switchSection('actions');
  setTimeout(() => {
    document.getElementById('emailPreview').classList.remove('hidden');
    const html = EmailTemplate.generateEmail(appState.actionsTable, document.getElementById('emailRecipient')?.value || '', document.getElementById('emailSender')?.value || '');
    const container = document.getElementById('emailPreviewContent');
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:500px;border:none';
    container.innerHTML = '';
    container.appendChild(iframe);
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  }, 100);
}

// ---- Manual section buttons ----
document.getElementById('btnRunCleaning')?.addEventListener('click', async () => {
  if (!appState.file) { showToast('Uploadez un fichier', 'error'); return; }
  const r = await runBotCleaning(); updateCleaningSection(r); showToast('Nettoyage OK', 'success');
  runBotAnomalyDetection(); runBotActionAnalysis(); generateActionsTable();
});
document.getElementById('btnDownloadCleaned')?.addEventListener('click', () => {
  if (!appState.cleanedWorkbook) return;
  XLSX.writeFile(appState.cleanedWorkbook, `${(appState.file?.name || 'file').replace(/\.[^.]+$/, '')}_nettoye.xlsx`);
});
document.getElementById('deadlineDate')?.addEventListener('change', generateActionsTable);
document.getElementById('btnDownloadReport')?.addEventListener('click', downloadFullReport);
document.getElementById('btnPreviewEmail')?.addEventListener('click', showEmailPreview);
document.getElementById('closeEmailPreview')?.addEventListener('click', () => document.getElementById('emailPreview')?.classList.add('hidden'));
document.getElementById('btnCopyEmail')?.addEventListener('click', async () => {
  if (!appState.actionsTable) { showToast('Lancez le bot', 'error'); return; }
  const html = EmailTemplate.generateEmail(appState.actionsTable, document.getElementById('emailRecipient')?.value || '', document.getElementById('emailSender')?.value || '');
  const ok = await EmailTemplate.copyToClipboard(html);
  showToast(ok ? 'Email copie!' : 'Erreur', ok ? 'success' : 'error');
});

// Enable bot button when file loaded
const originalHandleFileSelected = handleFileSelected;
handleFileSelected = async function(file) {
  await originalHandleFileSelected(file);
  document.getElementById('btnLaunchBot').disabled = false;
  document.getElementById('btnRunCleaning').disabled = false;
  document.getElementById('botPipeline')?.classList.add('hidden');
  document.getElementById('uploadActions')?.classList.remove('hidden');
  document.getElementById('botActions')?.classList.add('hidden');
};

// ---- Init ----
loadHistory();
loadSavedCredentials();
