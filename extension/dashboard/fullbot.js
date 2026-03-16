// ============================================================
// APG eBulletin Bot — Full Bot Mode Controller
// Handles: Login detection → eBulletin download → Processing → BSP Link → Report
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
      // Auto-start after a short delay
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

    fbLog('Bot APG eBulletin demarre', 'stage');
    fbSetStatus('Ouverture du portail IATA...');
    fbSetStage('login', 'active', 'Ouverture du portail IATA...');

    // Check if we're in a Chrome extension context
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.connect) {
      // Demo/preview mode — run mock full bot
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
      fbLog('Commande START_FULL_BOT envoyee au service worker', 'info');

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
    } else if (msg.type === 'EBULLETIN_DOWNLOADED') {
      handleEbulletinDownloaded(msg);
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
      case 'opening_portal':
        fbSetStatus('Ouverture du portail IATA...');
        fbSetStage('login', 'active', 'Ouverture du portail...');
        fbLog('Ouverture du portail IATA', 'info');
        break;

      case 'waiting_login':
        fbSetStatus('En attente de votre connexion...');
        fbSetStage('login', 'active', message || 'Connectez-vous et validez la 2FA...');
        if (message && message.includes('2FA')) {
          fbLog(message, 'warning');
        }
        break;

      case 'login_complete':
        fbSetStage('login', 'done', 'Connecte!', { text: 'OK', type: 'success' });
        fbLog('Connexion IATA reussie!', 'success');
        break;

      case 'navigating_ebulletin':
        fbSetStatus('Navigation vers eBulletin...');
        fbSetStage('ebulletin', 'active', 'Navigation en cours...');
        fbLog('Navigation vers la page eBulletin', 'info');
        break;

      case 'downloading_ebulletin':
        fbSetStatus('Telechargement eBulletin...');
        fbSetStage('ebulletin', 'active', 'Telechargement en cours...');
        fbLog('Telechargement du fichier eBulletin', 'info');
        break;

      case 'ebulletin_downloaded':
        fbSetStage('ebulletin', 'done', `${data?.fileName || 'eBulletin'} telecharge`,
          { text: data?.fileSize ? `${(data.fileSize/1024).toFixed(0)} Ko` : 'OK', type: 'success' });
        fbLog(`Fichier telecharge: ${data?.fileName || 'eBulletin.xlsx'}`, 'success');
        break;

      case 'waiting_processing':
        fbSetStatus('Traitement en cours...');
        fbSetStage('processing', 'active', 'Nettoyage & analyse...');
        break;

      case 'bsplink_scraping':
        fbSetStatus('Scraping BSP Link...');
        fbSetStage('bsplink', 'active', message || 'Scraping en cours...');
        if (message) fbLog(message, 'info');
        break;

      case 'complete':
        fbSetStatus('Pipeline termine!');
        fbSetStage('report', 'done', 'Rapport pret!', { text: 'PRET', type: 'success' });
        fbLog('', 'info');
        fbLog('PIPELINE TERMINE — Rapport pret a telecharger.', 'stage');
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
        fbLog('Bot annule par l\'utilisateur', 'warning');
        fullBotActive = false;
        break;
    }
  }

  // ---- Handle eBulletin file data from service worker ----
  async function handleEbulletinDownloaded(msg) {
    fbLog('Decodage du fichier eBulletin...', 'info');
    fbSetStage('processing', 'active', 'Decodage du fichier...');

    try {
      // Decode base64 to ArrayBuffer
      const binaryString = atob(msg.data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // Parse Excel
      const wb = XLSX.read(bytes.buffer, { type: 'array' });
      fbLog(`Fichier Excel parse: ${wb.SheetNames.length} feuille(s)`, 'info');

      // Run cleaning
      fbSetStage('processing', 'active', 'Nettoyage en cours...');
      fbLog('NETTOYAGE — suppression lignes vides, conversion cellules', 'stage');
      const cleaned = EbulletinCleaner.cleanWorkbook(wb);
      const stats = cleaned._cleaningStats || {};
      fbLog(`${stats.rowsRemoved || 0} lignes supprimees, ${(stats.riskCellsConverted || 0) + (stats.irrCellsConverted || 0)} cellules converties`, 'success');
      appState.cleanedWorkbook = cleaned;

      // Parse cleaned data
      const sheetName = cleaned.SheetNames[0];
      const ws = cleaned.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(ws);
      const headers = json.length > 0 ? Object.keys(json[0]) : [];
      appState.parsedData = { headers, rows: json, sheetName };

      // Detect columns
      const detected = ExcelHandler.detectColumns(headers);
      appState.columnMapping = {
        iataCode: detected.iataCode || headers.find(h => /iata|code/i.test(h)) || headers[0],
        country: detected.country || headers.find(h => /country|pays/i.test(h)) || headers[1],
        agencyName: detected.agencyName,
        section: detected.section
      };
      fbLog(`Colonnes detectees: IATA=${appState.columnMapping.iataCode}, Pays=${appState.columnMapping.country}`, 'info');
      fbLog(`${json.length} lignes de donnees`, 'info');

      // Run anomaly detection
      fbLog('ANOMALIES — scan des donnees', 'stage');
      const anomalyResult = AnomalyDetector.analyzeAll(json, headers, appState.columnMapping);
      appState.anomalyResults = anomalyResult;
      const totalAnomalies = anomalyResult.summary.totalAnomalies;
      fbLog(`${totalAnomalies} anomalie(s) detectee(s)`, totalAnomalies > 0 ? 'warning' : 'success');

      // Run action analysis
      fbLog('ANALYSE — determination OPENED/CLOSED/REVIEW', 'stage');
      const analyses = ActionAnalyzer.analyzeAll(json, appState.columnMapping, null);
      appState.analysisResults = analyses;
      const summary = ActionAnalyzer.getSummary(analyses);
      fbLog(`${summary.counts.OPENED || 0} OPENED, ${summary.counts.CLOSED || 0} CLOSED, ${summary.counts.REVIEW || 0} REVIEW`, 'success');
      fbLog(`Confiance moyenne: ${summary.averageConfidence}%`, 'info');

      fbSetStage('processing', 'done',
        `${json.length} lignes, ${summary.counts.OPENED || 0} OPENED, ${summary.counts.REVIEW || 0} REVIEW`,
        { text: `${summary.averageConfidence}% confiance`, type: summary.averageConfidence >= 60 ? 'success' : 'warning' });

      // Send processed rows back to service worker for BSP Link scraping
      fbSetStage('bsplink', 'active', 'Demarrage du scraping BSP Link...');
      fbLog('SCRAPING BSP LINK — verification des Ticketing Authorities', 'stage');

      if (fullBotPort) {
        fullBotPort.postMessage({
          type: 'EBULLETIN_PROCESSED',
          payload: {
            rows: json,
            iataColumn: appState.columnMapping.iataCode,
            countryColumn: appState.columnMapping.country
          }
        });
      }

    } catch (err) {
      fbLog(`Erreur traitement: ${err.message}`, 'error');
      fbSetStage('processing', 'error', `Erreur: ${err.message}`);
      fbSetStatus('Erreur de traitement');
      fullBotActive = false;
    }
  }

  // ---- Handle BSP Link scraping progress ----
  function handleBSPProgress(payload) {
    if (payload.type === 'init') {
      fbLog(`${payload.totalCountries} pays, ${payload.totalRows} codes a verifier`, 'info');
    } else if (payload.type === 'country_switch') {
      fbSetStage('bsplink', 'active', `${payload.countryName || payload.country}... (${payload.completed}/${payload.total})`);
      fbLog(`BSP: ${payload.countryName || payload.country}`, 'info');
    } else if (payload.type === 'country_scraped') {
      fbLog(`  → ${payload.agentCount} agents trouves`, 'info');
    } else if (payload.type === 'row_result') {
      // Update progress count
      const pct = payload.percent || 0;
      fbSetStage('bsplink', 'active',
        `${payload.completed}/${payload.total} codes (${pct}%)`);
      // Accumulate results
      if (!appState.results) appState.results = [];
      appState.results.push(payload.result);
    } else if (payload.type === 'country_error') {
      fbLog(`Erreur ${payload.country}: ${payload.error}`, 'warning');
    }
  }

  // ---- Handle BSP scraping complete ----
  function handleBSPComplete(msg) {
    const results = msg.results || appState.results || [];
    appState.results = results;
    fbSetStage('bsplink', 'done',
      `${results.length} codes verifies`,
      { text: `${results.length} resultats`, type: 'success' });
    fbLog(`BSP Link termine: ${results.length} codes verifies`, 'success');

    // Re-run action analysis with BSP data
    fbLog('Re-analyse avec donnees BSP Link...', 'info');
    const analyses = ActionAnalyzer.analyzeAll(appState.parsedData.rows, appState.columnMapping, results);
    appState.analysisResults = analyses;
    const summary = ActionAnalyzer.getSummary(analyses);
    fbLog(`Final: ${summary.counts.OPENED || 0} OPENED, ${summary.counts.CLOSED || 0} CLOSED, ${summary.counts.REVIEW || 0} REVIEW (confiance ${summary.averageConfidence}%)`, 'success');

    // Generate report
    fbSetStage('report', 'active', 'Generation du rapport...');
    fbLog('GENERATION du rapport Excel & email', 'stage');

    generateActionsTable();
    const actionsCount = appState.actionsTable?.summary?.totalActions || 0;
    const highPriority = appState.actionsTable?.summary?.highPriority || 0;

    fbSetStage('report', 'done',
      `${actionsCount} actions TA, rapport pret`,
      { text: `${actionsCount} actions`, type: 'success' });
    fbLog(`${actionsCount} actions, ${highPriority} priorite haute`, 'success');
    fbLog('Email HTML pret', 'success');

    // Show final actions
    fbSetStatus('Pipeline termine!');
    fbLog('', 'info');
    fbLog('PIPELINE TERMINE — Rapport pret a telecharger.', 'stage');
    document.getElementById('fullBotActions').classList.remove('hidden');
    fullBotActive = false;

    // Also update the analysis and actions sections for "Voir le detail"
    if (typeof runBotAnomalyDetection === 'function') runBotAnomalyDetection();
    if (typeof runBotActionAnalysis === 'function') runBotActionAnalysis();
  }

  // ---- Demo mode (when not in extension context) ----
  async function runDemoFullBot() {
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Stage 1: Login
    fbLog('MODE DEMO — simulation du parcours complet', 'warning');
    fbSetStage('login', 'active', 'Simulation login...');
    await sleep(1500);
    fbLog('Connexion IATA simulee', 'success');
    fbSetStage('login', 'done', 'Connecte (demo)', { text: 'DEMO', type: 'info' });

    // Stage 2: eBulletin download
    await sleep(500);
    fbSetStatus('Telechargement eBulletin...');
    fbSetStage('ebulletin', 'active', 'Telechargement simule...');
    fbLog('Navigation vers page eBulletin...', 'info');
    await sleep(1200);

    // Check if a file was manually uploaded (allows testing in preview)
    if (appState.file && appState.parsedData) {
      fbLog(`Fichier deja charge: ${appState.file.name}`, 'success');
      fbSetStage('ebulletin', 'done', appState.file.name, { text: 'LOCAL', type: 'info' });
    } else {
      fbLog('Pas de fichier — generation de donnees demo', 'warning');
      // Generate mock data if no file loaded
      const mockRows = generateDemoData();
      const headers = Object.keys(mockRows[0]);
      appState.parsedData = { headers, rows: mockRows, sheetName: 'Demo' };
      appState.columnMapping = {
        iataCode: 'IATA Code',
        country: 'Country',
        agencyName: 'Agency Name',
        section: 'Section'
      };
      fbSetStage('ebulletin', 'done', `${mockRows.length} lignes generees`, { text: 'DEMO', type: 'info' });
    }

    // Stage 3: Processing
    await sleep(500);
    fbSetStatus('Traitement en cours...');
    fbSetStage('processing', 'active', 'Nettoyage & analyse...');
    fbLog('NETTOYAGE du fichier', 'stage');
    await sleep(800);

    if (appState.file) {
      // Run real cleaning on uploaded file
      try {
        const ab = await appState.file.arrayBuffer();
        const wb = XLSX.read(ab, { type: 'array' });
        const cleaned = EbulletinCleaner.cleanWorkbook(wb);
        appState.cleanedWorkbook = cleaned;
        const stats = cleaned._cleaningStats || {};
        fbLog(`${stats.rowsRemoved || 0} lignes supprimees`, 'success');
      } catch(e) {
        fbLog('Nettoyage non necessaire', 'info');
      }
    }

    // Anomaly detection
    fbLog('ANOMALIES — scan des donnees', 'stage');
    const anomalyResult = AnomalyDetector.analyzeAll(
      appState.parsedData.rows, appState.parsedData.headers, appState.columnMapping
    );
    appState.anomalyResults = anomalyResult;
    fbLog(`${anomalyResult.summary.totalAnomalies} anomalie(s)`, anomalyResult.summary.totalAnomalies > 0 ? 'warning' : 'success');
    await sleep(600);

    // Action analysis
    fbLog('ANALYSE — OPENED/CLOSED/REVIEW', 'stage');
    let analyses = ActionAnalyzer.analyzeAll(appState.parsedData.rows, appState.columnMapping, null);
    appState.analysisResults = analyses;
    let summary = ActionAnalyzer.getSummary(analyses);
    fbLog(`${summary.counts.OPENED || 0} OPENED, ${summary.counts.CLOSED || 0} CLOSED, ${summary.counts.REVIEW || 0} REVIEW`, 'success');

    fbSetStage('processing', 'done',
      `${appState.parsedData.rows.length} lignes traitees`,
      { text: `${summary.averageConfidence}% confiance`, type: 'success' });

    // Stage 4: BSP Link mock
    await sleep(500);
    fbSetStatus('Scraping BSP Link (demo)...');
    fbSetStage('bsplink', 'active', 'Simulation BSP Link...');
    fbLog('SCRAPING BSP LINK (mode demo)', 'stage');

    const { rows } = appState.parsedData;
    const { iataCode, country } = appState.columnMapping;
    appState.results = await MockDataGenerator.generateBatchResults(rows, iataCode, country,
      (p) => {
        if (p.type === 'country_switch') {
          fbLog(`BSP: ${p.countryName || p.country}...`, 'info');
          fbSetStage('bsplink', 'active', `${p.countryName || p.country}... (${p.completed}/${p.total})`);
        }
      });
    fbSetStage('bsplink', 'done', `${appState.results.length} codes verifies`, { text: 'DEMO', type: 'info' });
    fbLog(`BSP Link simule: ${appState.results.length} resultats`, 'success');

    // Re-analyze with BSP data
    analyses = ActionAnalyzer.analyzeAll(appState.parsedData.rows, appState.columnMapping, appState.results);
    appState.analysisResults = analyses;
    summary = ActionAnalyzer.getSummary(analyses);

    // Stage 5: Report
    await sleep(500);
    fbSetStatus('Generation du rapport...');
    fbSetStage('report', 'active', 'Generation rapport & email...');
    fbLog('GENERATION rapport Excel & email', 'stage');

    generateActionsTable();
    const actionsCount = appState.actionsTable?.summary?.totalActions || 0;
    const highPriority = appState.actionsTable?.summary?.highPriority || 0;

    fbSetStage('report', 'done',
      `${actionsCount} actions, rapport pret`,
      { text: `${actionsCount} actions`, type: 'success' });
    fbLog(`${actionsCount} actions, ${highPriority} priorite haute`, 'success');
    fbLog('Email HTML pret', 'success');

    // Done
    await sleep(300);
    fbSetStatus('Pipeline termine!');
    fbLog('', 'info');
    fbLog('PIPELINE TERMINE — Rapport pret a telecharger.', 'stage');
    document.getElementById('fullBotActions').classList.remove('hidden');
    fullBotActive = false;

    // Update detail sections
    if (typeof runBotAnomalyDetection === 'function') runBotAnomalyDetection();
    if (typeof runBotActionAnalysis === 'function') runBotActionAnalysis();
  }

  // ---- Generate demo data ----
  function generateDemoData() {
    const countries = ['France', 'Germany', 'United Arab Emirates', 'Senegal', 'Italy', 'Colombia', 'Sweden', 'Ghana', 'French Polynesia', 'Portugal', 'Nigeria', 'Peru'];
    const agencies = ['World Services', 'Express Holidays', 'Star Voyages', 'Pacific Tourism LLC', 'Premium Travel Agency', 'Global Travel Agency', 'Golden Services', 'Express Travel Agency'];
    const changeCodes = ['NEW', 'CHG'];
    const riskStatuses = ['Standard', 'Under Review', 'Standard', 'Standard'];
    const rows = [];
    let code = 2345678;
    for (let i = 0; i < 32; i++) {
      rows.push({
        'Section': 'Passenger',
        'Change Code': changeCodes[i % 2],
        'Agency Code': String(code * 10 + (i % 10)),
        'Agency Name': agencies[i % agencies.length] + ' ' + countries[i % countries.length],
        'Country': countries[i % countries.length],
        'Accreditation Type': 'IATA',
        'Risk Status': riskStatuses[i % riskStatuses.length],
        'IATA Code': String(code + i * 111111),
        'BSP Country': ['FR','DE','AE','SN','IT','CO','SE','GH','PF','PT','NG','PE'][i % 12],
        'Region': i < 18 ? 'Europe' : 'Rest of World'
      });
    }
    return rows;
  }

  // ---- Wire up buttons ----
  document.getElementById('btnStartFullBot')?.addEventListener('click', launchFullBot);
  document.getElementById('fbDownloadReport')?.addEventListener('click', () => {
    if (typeof downloadFullReport === 'function') downloadFullReport();
  });
  document.getElementById('fbViewEmail')?.addEventListener('click', () => {
    if (typeof showEmailPreview === 'function') showEmailPreview();
  });
  document.getElementById('fbViewDetails')?.addEventListener('click', () => {
    switchSection('analysis');
  });

  // ---- Init: check bot mode on load ----
  checkBotMode();

})();
