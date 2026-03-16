// ============================================================
// APG Assistant — Full Bot Mode Controller v5.0
// Flow: BSP Link login → Excel upload → Scraping Enable/Disable → Excel final
// ============================================================

(function() {
  'use strict';

  let fullBotPort = null;
  let fullBotActive = false;

  // ---- Full Bot Log (terminal style) ----
  function fbLog(message, type = 'info') {
    const log = document.getElementById('fullBotLog');
    if (!log) return;
    const entry = document.createElement('div');
    entry.className = `bot-log-entry bot-log-${type}`;
    const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    entry.innerHTML = `<span class="bot-log-time">${time}</span> ${message}`;
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
  }

  function fbSetStage(stageId, status, detail, badge) {
    const stage = document.getElementById(`fb-stage-${stageId}`);
    if (!stage) return;
    const icon = stage.querySelector('.bot-stage-icon');
    if (icon) {
      icon.className = `bot-stage-icon ${status}`;
      if (status === 'done') icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>';
      else if (status === 'error') icon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    }
    if (detail) {
      const detailEl = document.getElementById(`fb-detail-${stageId}`);
      if (detailEl) detailEl.textContent = detail;
    }
    if (badge) {
      const badgeEl = document.getElementById(`fb-badge-${stageId}`);
      if (badgeEl) {
        badgeEl.textContent = badge.text;
        badgeEl.className = `bot-stage-badge badge-${badge.type || 'info'}`;
      }
    }
  }

  function fbSetStatus(text) {
    const el = document.getElementById('fullBotStatusText');
    if (el) el.textContent = text;
  }

  // ---- Check if in bot mode (URL param) ----
  function checkBotMode() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'bot') {
      switchSection('botmode');
      setTimeout(() => {
        launchFullBot();
      }, 500);
    }
  }

  // ---- Launch Full Bot ----
  async function launchFullBot() {
    if (fullBotActive) return;
    fullBotActive = true;

    // Show pipeline, hide launch card
    document.getElementById('botLaunchCard').classList.add('hidden');
    document.getElementById('fullBotPipeline').classList.remove('hidden');
    document.getElementById('fullBotLog').innerHTML = '';
    document.getElementById('fullBotActions').classList.add('hidden');

    fbLog('APG Assistant demarre', 'stage');
    fbSetStatus('Connexion au portail IATA...');
    fbSetStage('connexion', 'active', 'Ouverture du portail IATA...');

    // Check if we're in a Chrome extension context
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) {
      fbLog('Mode demo detecte (pas dans l\'extension Chrome)', 'warning');
      await runDemoFullBot();
      return;
    }

    try {
      // Connect to service worker
      fullBotPort = chrome.runtime.connect({ name: 'processing' });

      fullBotPort.onMessage.addListener(handleFullBotMessage);
      fullBotPort.onDisconnect.addListener(() => {
        if (fullBotActive) {
          fbLog('Connexion au service worker perdue', 'error');
          fbSetStatus('Erreur: connexion perdue');
        }
        fullBotActive = false;
      });

      // Send START_FULL_BOT
      fullBotPort.postMessage({ type: 'START_FULL_BOT' });
      fbLog('Commande START_FULL_BOT envoyee', 'info');

    } catch (err) {
      fbLog(`Erreur: ${err.message}`, 'error');
      fbSetStatus('Erreur');
      fullBotActive = false;
    }
  }

  // ---- Handle messages from service worker ----
  function handleFullBotMessage(msg) {
    if (msg.type === 'FULL_BOT_STATUS') {
      handleBotStatus(msg.payload);
    } else if (msg.type === 'PROGRESS_UPDATE') {
      handleBSPProgress(msg.payload);
    } else if (msg.type === 'PROCESSING_COMPLETE') {
      handleBSPComplete(msg);
    }
  }

  // ---- Handle bot stage updates ----
  function handleBotStatus(payload) {
    const { stage, message, data } = payload;

    switch (stage) {
      // ---- STEP 1: Portal login → BSP Link ----
      case 'opening_portal':
      case 'checking_login':
        fbSetStatus('Connexion au portail IATA...');
        fbSetStage('connexion', 'active', 'Ouverture du portail IATA...');
        fbLog(message || 'Ouverture du portail IATA', 'info');
        break;

      case 'waiting_login':
        fbSetStatus('En attente de votre connexion...');
        fbSetStage('connexion', 'active', message || 'Connectez-vous + 2FA...');
        fbLog(message || 'Connectez-vous au portail IATA et validez la 2FA', 'warning');
        break;

      case 'navigating_bsplink':
        fbSetStatus('Navigation vers BSP Link...');
        fbSetStage('connexion', 'active', message || 'Navigation vers BSP Link...');
        fbLog(message || 'Navigation vers BSP Link depuis le portail', 'info');
        break;

      case 'logged_in':
        fbSetStage('connexion', 'done', 'Connecte!', { text: 'OK', type: 'success' });
        fbLog(message || 'Connexion confirmee!', 'success');
        break;

      // ---- STEP 2: Excel Upload ----
      case 'waiting_excel':
        fbSetStatus('En attente du fichier Excel...');
        fbSetStage('import', 'active', 'Uploadez le fichier Excel avec les Agent Codes...');
        fbLog(message || 'Uploadez le fichier Excel avec les Agent Codes', 'warning');
        showExcelUploadInBot();
        break;

      case 'excel_received':
        fbSetStage('import', 'done', `${data?.rowCount || 0} Agent Codes charges`, { text: 'OK', type: 'success' });
        fbLog(message || 'Fichier Excel recu', 'success');
        if (data?.countries) {
          fbLog(`Pays detectes: ${data.countries.join(', ')}`, 'info');
        }
        break;

      // ---- STEP 3: BSP Link Scraping ----
      case 'bsplink_starting':
      case 'bsplink_opening':
      case 'bsplink_connected':
      case 'bsplink_scraping':
        fbSetStatus('Verification des statuts sur BSP Link...');
        fbSetStage('verification', 'active', message || 'Scraping en cours...');
        if (message) fbLog(message, 'info');
        break;

      case 'waiting_bsp_login':
        fbSetStage('verification', 'active', message || 'Attente connexion BSP Link...');
        fbLog(message || 'En attente de connexion BSP Link...', 'warning');
        break;

      case 'bsplink_country':
        fbSetStage('verification', 'active', message || 'Changement de pays...');
        if (message) fbLog(message, 'info');
        break;

      // ---- STEP 4: Complete ----
      case 'complete':
        fbSetStatus('Verification terminee!');
        fbSetStage('verification', 'done', `${data?.totalFound || 0} trouves`, { text: 'OK', type: 'success' });
        fbSetStage('export', 'done', 'Excel pret au telechargement!', { text: 'PRET', type: 'success' });
        fbLog('', 'info');
        fbLog(`TERMINE — ${data?.totalEnabled || 0} Enable, ${data?.totalDisabled || 0} Disable, ${data?.totalNotFound || 0} non trouves`, 'stage');

        // Store results for Excel generation
        if (data?.results) {
          appState.results = data.results;
        }

        // Generate the final Excel
        generateFinalExcel(data);

        document.getElementById('fullBotActions').classList.remove('hidden');
        fullBotActive = false;
        break;

      case 'error':
        fbSetStatus('Erreur');
        fbLog(`ERREUR: ${message}`, 'error');
        fullBotActive = false;
        break;

      case 'cancelled':
        fbSetStatus('Annule');
        fbLog('Assistant annule par l\'utilisateur', 'warning');
        fullBotActive = false;
        break;

      default:
        if (message) fbLog(message, 'info');
        break;
    }
  }

  // ---- Show Excel upload zone inside the bot pipeline ----
  function showExcelUploadInBot() {
    const log = document.getElementById('fullBotLog');
    if (!log) return;

    // Remove existing upload zone if any
    const existing = document.getElementById('botExcelUploadZone');
    if (existing) existing.remove();

    const uploadZone = document.createElement('div');
    uploadZone.id = 'botExcelUploadZone';
    uploadZone.innerHTML = `
      <div style="padding:16px; margin-top:8px; background:#1e1f32; border:2px dashed #E8871E; border-radius:10px; text-align:center;">
        <p style="color:#e0e0e8; margin-bottom:10px; font-size:14px; font-weight:600;">
          Uploadez le fichier Excel Agent Codes
        </p>
        <p style="color:#8888aa; margin-bottom:12px; font-size:12px;">
          Fichier .xlsx ou .csv avec les colonnes Agent Code et Country
        </p>
        <input type="file" id="botExcelFileInput" accept=".xlsx,.xls,.csv" style="display:none;">
        <button id="botExcelFileBtn" style="padding:12px 28px; background:linear-gradient(135deg, #E8871E, #c06a10); color:white; border:none; border-radius:8px; cursor:pointer; font-weight:700; font-size:14px;">
          Choisir un fichier Excel
        </button>
      </div>
    `;
    log.appendChild(uploadZone);
    log.scrollTop = log.scrollHeight;

    const fileInput = document.getElementById('botExcelFileInput');
    document.getElementById('botExcelFileBtn').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      uploadZone.remove();
      fbLog(`Fichier charge: ${file.name}`, 'success');

      try {
        const ab = await file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const ws = wb.Sheets[sheetName];
        const json = XLSX.utils.sheet_to_json(ws);
        const headers = json.length > 0 ? Object.keys(json[0]) : [];

        // Detect columns
        const detected = ExcelHandler.detectColumns(headers);
        const iataColumn = detected.iataCode || headers.find(h => /iata|code|agent/i.test(h)) || headers[0];
        const countryColumn = detected.country || headers.find(h => /country|pays|bsp/i.test(h)) || headers[1];

        fbLog(`${json.length} lignes, colonnes: Code=${iataColumn}, Pays=${countryColumn}`, 'info');

        // Store in appState
        appState.file = file;
        appState.parsedData = { headers, rows: json, sheetName };
        appState.columnMapping = { iataCode: iataColumn, country: countryColumn };
        appState.originalWorkbook = wb;

        // Send to service worker
        if (fullBotPort) {
          fullBotPort.postMessage({
            type: 'EXCEL_UPLOADED',
            payload: {
              rows: json,
              iataColumn,
              countryColumn,
              fileName: file.name
            }
          });
          fbLog('Donnees envoyees au service worker pour verification BSP Link', 'info');
          fbSetStage('import', 'done', `${json.length} Agent Codes`, { text: 'OK', type: 'success' });
        }
      } catch (err) {
        fbLog(`Erreur de lecture du fichier: ${err.message}`, 'error');
      }
    });
  }

  // ---- Handle BSP Link scraping progress ----
  function handleBSPProgress(payload) {
    if (payload.type === 'init') {
      fbLog(`${payload.totalCountries} pays, ${payload.totalRows} codes a verifier`, 'info');
    } else if (payload.type === 'country_switch') {
      fbSetStage('verification', 'active', `${payload.countryName || payload.country}... (${payload.completed}/${payload.total})`);
      fbLog(`Pays: ${payload.countryName || payload.country}`, 'info');
    } else if (payload.type === 'country_scraped') {
      fbLog(`  ${payload.agentsFound || payload.agentCount || 0} agents trouves dans BSP Link`, 'info');
    } else if (payload.type === 'row_result') {
      const pct = payload.percent || 0;
      fbSetStage('verification', 'active', `${payload.completed}/${payload.total} codes (${pct}%)`);
      // Accumulate results
      if (!appState.results) appState.results = [];
      const { type, completed, total, percent, ...resultData } = payload;
      appState.results.push(resultData);
    } else if (payload.type === 'country_error') {
      fbLog(`Erreur ${payload.country}: ${payload.error}`, 'warning');
    }
  }

  // ---- Handle BSP scraping complete ----
  function handleBSPComplete(msg) {
    const results = msg.payload?.results || appState.results || [];
    appState.results = results;
    fbSetStage('verification', 'done',
      `${results.length} codes verifies`,
      { text: `${results.length} resultats`, type: 'success' });
    fbLog(`Scraping BSP Link termine: ${results.length} codes verifies`, 'success');
  }

  // ---- Generate final Excel with Enable/Disable status ----
  function generateFinalExcel(data) {
    try {
      const results = data?.results || appState.results || [];
      if (!results.length) return;

      // If we have the original workbook, add a status column
      let rows;
      if (appState.parsedData?.rows) {
        const iataCol = appState.columnMapping?.iataCode || 'IATA Code';
        rows = appState.parsedData.rows.map(row => {
          const code = String(row[iataCol] || '').trim().replace(/[^0-9]/g, '');
          const match = results.find(r => {
            const rCode = String(r.iataCode || '').trim();
            return rCode === code || rCode === code.substring(0, 7);
          });

          return {
            ...row,
            'Status Enable/Disable': match ? match.agentStatus : 'Non trouve',
            'Ticketing Authority': match ? (match.ticketingAuthority || 'N/A') : 'N/A',
            'Agent Name BSP': match ? (match.agentName || '') : '',
            'Verification': match ? 'OK' : 'Non trouve dans BSP Link'
          };
        });
      } else {
        // Just use results directly
        rows = results.map(r => ({
          'IATA Code': r.iataCode,
          'Country': r.country,
          'Agent Name': r.agentName || '',
          'Status Enable/Disable': r.agentStatus || 'N/A',
          'Ticketing Authority': r.ticketingAuthority || 'N/A',
          'Verification': r.lookupStatus || 'N/A'
        }));
      }

      // Store for download
      appState.finalRows = rows;
      fbLog(`Excel final prepare: ${rows.length} lignes avec statuts Enable/Disable`, 'success');
    } catch (err) {
      fbLog(`Erreur generation Excel: ${err.message}`, 'error');
    }
  }

  // ---- Download final Excel ----
  function downloadFinalExcel() {
    const rows = appState.finalRows || appState.results || [];
    if (!rows.length) {
      fbLog('Aucune donnee a exporter', 'warning');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Agent Status');

    // Auto-size columns
    const colWidths = Object.keys(rows[0]).map(key => ({
      wch: Math.max(key.length, ...rows.slice(0, 50).map(r => String(r[key] || '').length)) + 2
    }));
    ws['!cols'] = colWidths;

    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `APG_Agent_Status_${date}.xlsx`);
    fbLog(`Fichier telecharge: APG_Agent_Status_${date}.xlsx`, 'success');
  }

  // ---- Demo mode (when not in extension context) ----
  async function runDemoFullBot() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Stage 1: Connection
    fbLog('MODE DEMO — simulation du parcours complet', 'warning');
    fbSetStage('connexion', 'active', 'Simulation connexion BSP Link...');
    await sleep(1500);
    fbLog('Connexion BSP Link simulee', 'success');
    fbSetStage('connexion', 'done', 'Connecte (demo)', { text: 'DEMO', type: 'info' });

    // Stage 2: Excel upload
    await sleep(500);
    fbSetStatus('Import fichier Excel...');
    fbSetStage('import', 'active', 'Upload du fichier...');

    if (appState.file && appState.parsedData) {
      fbLog(`Fichier deja charge: ${appState.file.name}`, 'success');
      fbSetStage('import', 'done', appState.file.name, { text: 'LOCAL', type: 'info' });
      if (!appState.columnMapping) {
        const detected = ExcelHandler.detectColumns(appState.parsedData.headers);
        appState.columnMapping = {
          iataCode: detected.iataCode || appState.parsedData.headers[0],
          country: detected.country || appState.parsedData.headers[1]
        };
      }
    } else {
      fbLog('Pas de fichier — generation de donnees demo', 'warning');
      const mockRows = generateDemoData();
      const headers = Object.keys(mockRows[0]);
      appState.parsedData = { headers, rows: mockRows, sheetName: 'Demo' };
      appState.columnMapping = { iataCode: 'IATA Code', country: 'BSP Country' };
      fbSetStage('import', 'done', `${mockRows.length} lignes generees`, { text: 'DEMO', type: 'info' });
    }
    await sleep(500);

    // Stage 3: BSP Link scraping (mock)
    fbSetStatus('Verification des statuts (demo)...');
    fbSetStage('verification', 'active', 'Simulation scraping BSP Link...');
    fbLog('SCRAPING BSP LINK (mode demo)', 'stage');

    const { rows } = appState.parsedData;
    const { iataCode, country } = appState.columnMapping;
    appState.results = await MockDataGenerator.generateBatchResults(rows, iataCode, country,
      (p) => {
        if (p.type === 'country_switch') {
          fbLog(`Pays: ${p.countryName || p.country}...`, 'info');
          fbSetStage('verification', 'active', `${p.countryName || p.country}... (${p.completed}/${p.total})`);
        }
      });

    const enabled = appState.results.filter(r => (r.agentStatus || '').includes('Enable')).length;
    const disabled = appState.results.filter(r => (r.agentStatus || '').includes('Disable')).length;
    fbSetStage('verification', 'done', `${appState.results.length} codes verifies`, { text: 'DEMO', type: 'info' });
    fbLog(`BSP Link simule: ${enabled} Enable, ${disabled} Disable`, 'success');

    // Stage 4: Excel final
    await sleep(500);
    fbSetStatus('Generation Excel final...');
    fbSetStage('export', 'active', 'Generation du fichier...');

    generateFinalExcel({ results: appState.results });

    fbSetStage('export', 'done', 'Excel pret', { text: 'PRET', type: 'success' });
    fbLog('Excel final pret au telechargement', 'success');

    // Done
    await sleep(300);
    fbSetStatus('Verification terminee!');
    fbLog('', 'info');
    fbLog(`TERMINE — ${enabled} Enable, ${disabled} Disable`, 'stage');
    document.getElementById('fullBotActions').classList.remove('hidden');
    fullBotActive = false;
  }

  // ---- Generate demo data ----
  function generateDemoData() {
    const countries = ['FR', 'DE', 'AE', 'SN', 'IT', 'CO', 'SE', 'GH', 'PF', 'PT', 'NG', 'PE'];
    const agencies = ['World Services', 'Express Holidays', 'Star Voyages', 'Pacific Tourism LLC', 'Premium Travel', 'Global Travel', 'Golden Services', 'Express Travel'];
    const rows = [];
    let code = 2345678;
    for (let i = 0; i < 32; i++) {
      rows.push({
        'Agent Code': String(code * 10 + (i % 10)),
        'Agency Name': agencies[i % agencies.length],
        'BSP Country': countries[i % countries.length],
        'IATA Code': String(code + i * 111111)
      });
    }
    return rows;
  }

  // ---- Wire up buttons ----
  document.getElementById('btnStartFullBot')?.addEventListener('click', launchFullBot);
  document.getElementById('fbDownloadReport')?.addEventListener('click', () => {
    downloadFinalExcel();
  });
  document.getElementById('fbViewEmail')?.addEventListener('click', () => {
    if (typeof showEmailPreview === 'function') showEmailPreview();
  });
  document.getElementById('fbViewDetails')?.addEventListener('click', () => {
    switchSection('resultats');
  });

  // ---- Init: check bot mode on load ----
  checkBotMode();

})();
