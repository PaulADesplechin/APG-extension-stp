// ============================================================
// APG BSP Link - Background Service Worker (Manifest V3)
// Orchestrates the FULL IATA eBulletin procedure:
//   1. IATA Portal login (manual + 2FA)
//   2. Navigate to eBulletin service
//   3. Click Weekly tab, generate report, download CSV
//   4. Send data to dashboard for processing
//   5. BSP Link TA verification per country
//   6. IATA Code Search enrichment
//   7. Complete with all results
// ============================================================

let processingState = {
  isActive: false,
  isPaused: false,
  rows: [],
  iataColumn: '',
  countryColumn: '',
  results: [],
  countryGroups: {},
  currentCountry: null,
  completed: 0,
  total: 0,
  errors: [],
  skippedCountries: []
};

// ---- Full Bot Mode State ----
let botModeState = {
  isActive: false,
  isCancelled: false,
  stage: null,       // current stage identifier
  iataTabId: null,   // IATA portal tab
  bspTabId: null,    // BSP Link tab
  ebulletinTabId: null, // eBulletin app tab (may differ from portal)
  codeSearchTabId: null, // IATA Code Search tab
  port: null         // dashboard port reference
};

// Keep-alive alarm during processing or bot mode
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && (processingState.isActive || botModeState.isActive)) {
    // Keep service worker alive during processing or bot mode
  }
});

// ---- Tab tracking: detect new tabs opened by portal navigation ----
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!botModeState.isActive) return;

  // Detect eBulletin app tab (may open in new tab from portal tile)
  if (changeInfo.status === 'complete' && tab.url) {
    const url = tab.url.toLowerCase();

    // eBulletin / AIRS / CAIRS pages
    if (url.includes('ebulletin') || url.includes('airs') ||
        url.includes('cairs') || url.includes('smart.iata.org') ||
        url.includes('bulletin')) {
      if (tabId !== botModeState.iataTabId) {
        botModeState.ebulletinTabId = tabId;
        console.log('[APG Bot] Detected eBulletin tab:', tabId, tab.url);
      }
    }

    // IATA Code Search pages
    if (url.includes('codesearch') || url.includes('code-search') ||
        url.includes('timatic') || url.includes('iatacodesearch')) {
      botModeState.codeSearchTabId = tabId;
      console.log('[APG Bot] Detected Code Search tab:', tabId, tab.url);
    }
  }
});

// Simple message handler for popup queries
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_BOT_STATE') {
    sendResponse({
      isActive: botModeState.isActive,
      stage: botModeState.stage,
      isCancelled: botModeState.isCancelled
    });
    return true;
  }
  if (message.type === 'RESET_BOT_STATE') {
    botModeState.isActive = false;
    botModeState.isCancelled = false;
    botModeState.stage = null;
    syncBotState('idle', null);
    sendResponse({ success: true });
    return true;
  }
  return false;
});

// Long-lived port connection from dashboard
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'processing') return;

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case 'START_PROCESSING':
        await handleStartProcessing(msg.payload, port);
        break;
      case 'PAUSE_PROCESSING':
        processingState.isPaused = true;
        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: { type: 'paused', completed: processingState.completed, total: processingState.total }
        });
        break;
      case 'RESUME_PROCESSING':
        processingState.isPaused = false;
        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: { type: 'resumed', completed: processingState.completed, total: processingState.total }
        });
        break;
      case 'CANCEL_PROCESSING':
        processingState.isActive = false;
        processingState.isPaused = false;
        chrome.alarms.clear('keepAlive');
        port.postMessage({
          type: 'PROCESSING_CANCELLED',
          payload: { results: processingState.results, completed: processingState.completed }
        });
        break;
      case 'CHECK_BSP_LINK':
        await handleCheckBSPLink(port);
        break;
      case 'START_LOGIN':
        await handleStartLogin(msg.payload, port);
        break;
      case 'CHECK_LOGIN_STATUS':
        await handleCheckLoginStatus(port);
        break;

      // ---- Full Bot Mode messages ----
      case 'START_FULL_BOT':
        await handleStartFullBot(port);
        break;
      case 'EBULLETIN_PROCESSED':
        handleEBulletinProcessed(msg.payload, port);
        break;
      case 'CANCEL_FULL_BOT':
        handleCancelFullBot(port);
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    // Dashboard closed - pause processing (don't cancel)
    if (processingState.isActive) {
      processingState.isPaused = true;
    }
    // If bot mode is active and port disconnects, keep running but clear port ref
    if (botModeState.isActive && botModeState.port === port) {
      botModeState.port = null;
    }
  });
});

// ---- Check BSP Link Status ----
async function handleCheckBSPLink(port) {
  try {
    const bspTab = await findBSPLinkTab();
    if (!bspTab) {
      port.postMessage({
        type: 'BSP_LINK_STATUS',
        payload: {
          found: false,
          message: 'Aucun onglet BSP Link trouve. Ouvrez bsplink.iata.org et connectez-vous.'
        }
      });
      return;
    }

    // Check if content script is injected and user is logged in
    const loginStatus = await sendToTab(bspTab.id, { type: 'CHECK_LOGIN' });
    const pageInfo = await sendToTab(bspTab.id, { type: 'GET_PAGE_INFO' });

    port.postMessage({
      type: 'BSP_LINK_STATUS',
      payload: {
        found: true,
        tabId: bspTab.id,
        tabUrl: bspTab.url,
        isLoggedIn: loginStatus?.isLoggedIn || false,
        hasTable: pageInfo?.hasTable || false,
        country: pageInfo?.country || null,
        message: loginStatus?.isLoggedIn
          ? `Connecte a BSP Link (${pageInfo?.country || 'pays inconnu'})`
          : 'BSP Link ouvert mais non connecte. Veuillez vous connecter.'
      }
    });
  } catch (err) {
    port.postMessage({
      type: 'BSP_LINK_STATUS',
      payload: { found: false, error: err.message, message: 'Erreur de communication avec BSP Link.' }
    });
  }
}

// ---- Login Flow ----
async function handleStartLogin(payload, port) {
  const { email, password } = payload;

  try {
    // Step 1: Find or open IATA portal tab
    let iataTab = await findIATAPortalTab();

    if (!iataTab) {
      // Open IATA login page
      iataTab = await chrome.tabs.create({
        url: 'https://portal.iata.org/s/login/?language=en_US',
        active: true
      });
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: { step: 'opening', message: 'Ouverture du portail IATA...' }
      });
      // Wait for page to load
      await waitForTabLoad(iataTab.id);
      await wait(3000); // Extra wait for JS frameworks to render
    }

    // Step 2: Check if already logged in
    const loggedInCheck = await sendToTab(iataTab.id, { type: 'CHECK_LOGGED_IN' });
    if (loggedInCheck?.isLoggedIn) {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: { step: 'already_logged_in', message: 'Deja connecte au portail IATA!' }
      });
      // Navigate to BSP Link
      await handleNavigateToBSPLink(iataTab.id, port);
      return;
    }

    // Step 3: Check if on login page
    const loginPage = await sendToTab(iataTab.id, { type: 'CHECK_LOGIN_PAGE' });
    if (!loginPage?.readyForLogin) {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: {
          step: 'login_page_not_ready',
          message: 'Page de connexion non trouvee. Naviguez vers portal.iata.org manuellement.'
        }
      });
      return;
    }

    // Step 4: Auto-fill credentials
    port.postMessage({
      type: 'LOGIN_STATUS',
      payload: { step: 'filling', message: 'Remplissage des identifiants...' }
    });

    const fillResult = await sendToTab(iataTab.id, {
      type: 'AUTO_FILL_LOGIN',
      payload: { email, password }
    });

    if (!fillResult?.success) {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: { step: 'fill_error', message: fillResult?.error || 'Erreur lors du remplissage' }
      });
      return;
    }

    if (fillResult?.submitted) {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: {
          step: 'filled',
          message: 'Formulaire soumis automatiquement. Attente de la 2FA...'
        }
      });
    } else {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: {
          step: 'filled',
          message: 'Identifiants remplis. Cliquez sur "Log In" manuellement.'
        }
      });
    }

    // Step 5: Start polling for 2FA completion
    startLoginPolling(iataTab.id, port);

  } catch (err) {
    port.postMessage({
      type: 'LOGIN_STATUS',
      payload: { step: 'error', message: `Erreur: ${err.message}` }
    });
  }
}

async function startLoginPolling(tabId, port) {
  let attempts = 0;
  const maxAttempts = 120; // 2 minutes of polling

  const pollInterval = setInterval(async () => {
    attempts++;

    if (attempts > maxAttempts) {
      clearInterval(pollInterval);
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: { step: 'timeout', message: 'Timeout - la validation 2FA a pris trop de temps.' }
      });
      return;
    }

    try {
      // Check current tab state
      const tab = await chrome.tabs.get(tabId);
      const url = tab?.url || '';

      // Check if we landed on BSP Link
      if (url.includes('bsplink')) {
        clearInterval(pollInterval);
        port.postMessage({
          type: 'LOGIN_STATUS',
          payload: { step: 'success', message: 'Connecte a BSP Link!' }
        });
        return;
      }

      // Check 2FA page
      const twoFA = await sendToTab(tabId, { type: 'CHECK_2FA_PAGE' });
      if (twoFA?.is2FAPage) {
        port.postMessage({
          type: 'LOGIN_STATUS',
          payload: {
            step: 'waiting_2fa',
            message: twoFA.hasPushNotification
              ? 'En attente de validation 2FA (notification push)...'
              : 'Page 2FA detectee - entrez le code de verification'
          }
        });
      }

      // Check if logged in (redirected past login)
      const loggedIn = await sendToTab(tabId, { type: 'CHECK_LOGGED_IN' });
      if (loggedIn?.isLoggedIn) {
        clearInterval(pollInterval);
        port.postMessage({
          type: 'LOGIN_STATUS',
          payload: { step: 'logged_in', message: 'Connexion reussie! Navigation vers BSP Link...' }
        });
        await handleNavigateToBSPLink(tabId, port);
      }
    } catch (err) {
      // Tab might have navigated, keep polling
    }
  }, 1000);
}

async function handleNavigateToBSPLink(tabId, port) {
  try {
    // Try navigating to BSP Link from the IATA portal
    const navResult = await sendToTab(tabId, { type: 'NAVIGATE_TO_BSPLINK' });
    await wait(5000);

    // Check if we're on BSP Link now
    const bspTab = await findBSPLinkTab();
    if (bspTab) {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: { step: 'success', message: 'Connecte a BSP Link! Pret pour le traitement.' }
      });
    } else {
      port.postMessage({
        type: 'LOGIN_STATUS',
        payload: {
          step: 'navigate_manual',
          message: 'Connecte au portail IATA. Naviguez vers BSP Link manuellement puis lancez le traitement.'
        }
      });
    }
  } catch (err) {
    port.postMessage({
      type: 'LOGIN_STATUS',
      payload: { step: 'error', message: `Erreur navigation: ${err.message}` }
    });
  }
}

async function handleCheckLoginStatus(port) {
  // Check IATA portal
  const iataTab = await findIATAPortalTab();
  // Check BSP Link
  const bspTab = await findBSPLinkTab();

  let status = { iataPortal: false, bspLink: false, isLoggedIn: false };

  if (bspTab) {
    const bspLogin = await sendToTab(bspTab.id, { type: 'CHECK_LOGIN' });
    status.bspLink = true;
    status.isLoggedIn = bspLogin?.isLoggedIn || false;
    status.bspUrl = bspTab.url;
  }

  if (iataTab) {
    const iataLogin = await sendToTab(iataTab.id, { type: 'CHECK_LOGGED_IN' });
    status.iataPortal = true;
    status.iataLoggedIn = iataLogin?.isLoggedIn || false;
  }

  port.postMessage({
    type: 'LOGIN_CHECK_RESULT',
    payload: status
  });
}

async function findIATAPortalTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://portal.iata.org/*']
  });
  return tabs.length > 0 ? tabs[0] : null;
}

async function waitForTabLoad(tabId) {
  return new Promise((resolve) => {
    const listener = (updatedTabId, changeInfo) => {
      if (updatedTabId === tabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    // Timeout after 30s
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, 30000);
  });
}

// ---- Main Processing ----
async function handleStartProcessing(payload, port) {
  const { rows, iataColumn, countryColumn } = payload;

  processingState = {
    isActive: true,
    isPaused: false,
    rows,
    iataColumn,
    countryColumn,
    results: [],
    completed: 0,
    total: rows.length,
    errors: [],
    skippedCountries: []
  };

  // Keep alive during processing
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

  try {
    // Find BSP Link tab
    const bspTab = await findBSPLinkTab();
    if (!bspTab) {
      port.postMessage({
        type: 'PROCESSING_ERROR',
        payload: {
          message: 'Ouvrez BSP Link (bsplink.iata.org) dans un onglet et connectez-vous d\'abord.',
          code: 'NO_TAB'
        }
      });
      return;
    }

    // Check login status
    const loginStatus = await sendToTab(bspTab.id, { type: 'CHECK_LOGIN' });
    if (!loginStatus?.isLoggedIn) {
      port.postMessage({
        type: 'PROCESSING_ERROR',
        payload: {
          message: 'Vous n\'etes pas connecte a BSP Link. Connectez-vous d\'abord puis relancez.',
          code: 'NOT_LOGGED_IN'
        }
      });
      return;
    }

    // Group rows by country
    const groups = groupByCountry(rows, iataColumn, countryColumn);
    const countries = Object.keys(groups);

    port.postMessage({
      type: 'PROGRESS_UPDATE',
      payload: {
        type: 'init',
        totalCountries: countries.length,
        totalRows: rows.length,
        countries
      }
    });

    for (let ci = 0; ci < countries.length; ci++) {
      const country = countries[ci];

      if (!processingState.isActive) break;

      // Wait while paused
      while (processingState.isPaused && processingState.isActive) {
        await wait(500);
      }
      if (!processingState.isActive) break;

      // Notify dashboard of country switch
      port.postMessage({
        type: 'PROGRESS_UPDATE',
        payload: {
          type: 'country_switch',
          country,
          countryIndex: ci + 1,
          totalCountries: countries.length,
          completed: processingState.completed,
          total: processingState.total
        }
      });

      try {
        // Switch country in BSP Link
        const switchResult = await sendToTab(bspTab.id, {
          type: 'SWITCH_COUNTRY',
          payload: { countryCode: country }
        });

        if (!switchResult?.success) {
          // Country switch failed - mark all rows for this country as error
          port.postMessage({
            type: 'PROGRESS_UPDATE',
            payload: {
              type: 'country_error',
              country,
              error: switchResult?.error || 'Impossible de changer de pays'
            }
          });

          processingState.skippedCountries.push(country);

          for (const row of groups[country]) {
            const iataCode = cleanIataCode(row[iataColumn]);
            processingState.results.push({
              iataCode, country,
              agentStatus: 'Error', ticketingAuthority: 'N/A',
              agentName: '', lookupStatus: 'error',
              error: 'Country switch failed',
              rowIndex: rows.indexOf(row)
            });
            processingState.completed++;

            port.postMessage({
              type: 'PROGRESS_UPDATE',
              payload: {
                type: 'row_result', iataCode, country,
                agentStatus: 'Error', ticketingAuthority: 'N/A',
                lookupStatus: 'error',
                completed: processingState.completed,
                total: processingState.total,
                percent: Math.round((processingState.completed / processingState.total) * 100)
              }
            });
          }
          continue; // Skip to next country
        }

        await wait(2000);

        // Navigate to Ticketing Authority
        const navResult = await sendToTab(bspTab.id, { type: 'NAVIGATE_TO_TICKETING_AUTHORITY' });
        if (!navResult?.success) {
          port.postMessage({
            type: 'PROGRESS_UPDATE',
            payload: { type: 'country_warning', country, warning: 'Table Ticketing Authority non trouvee' }
          });
        }

        await wait(3000);

        // Scrape the entire table (all pages)
        const tableData = await sendToTab(bspTab.id, { type: 'SCRAPE_ALL_PAGES' });
        const agents = tableData?.agents || [];
        const agentMap = buildAgentMap(agents);

        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: {
            type: 'country_scraped',
            country,
            agentsFound: agents.length,
            pages: tableData?.pages || 1
          }
        });

        // Match IATA codes for this country
        for (const row of groups[country]) {
          if (!processingState.isActive) break;

          // Wait while paused
          while (processingState.isPaused && processingState.isActive) {
            await wait(500);
          }
          if (!processingState.isActive) break;

          const iataCode = cleanIataCode(row[iataColumn]);
          const agent = agentMap[iataCode] || agentMap[String(row[iataColumn]).trim()];

          const result = {
            iataCode,
            country,
            agentStatus: agent?.agentStatus || 'Not Found',
            ticketingAuthority: agent?.ticketingAuthority || 'N/A',
            agentName: agent?.agentName || '',
            lookupStatus: agent ? 'found' : 'not_found',
            rowIndex: rows.indexOf(row)
          };

          processingState.results.push(result);
          processingState.completed++;

          port.postMessage({
            type: 'PROGRESS_UPDATE',
            payload: {
              type: 'row_result',
              ...result,
              completed: processingState.completed,
              total: processingState.total,
              percent: Math.round((processingState.completed / processingState.total) * 100)
            }
          });

          await wait(100);
        }

      } catch (countryErr) {
        // Per-country error recovery
        processingState.errors.push({ country, error: countryErr.message });

        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: {
            type: 'country_error',
            country,
            error: countryErr.message
          }
        });

        // Mark remaining rows for this country as error
        for (const row of groups[country]) {
          const iataCode = cleanIataCode(row[iataColumn]);
          if (!processingState.results.find(r => r.iataCode === iataCode && r.country === country)) {
            processingState.results.push({
              iataCode, country,
              agentStatus: 'Error', ticketingAuthority: 'N/A',
              agentName: '', lookupStatus: 'error',
              error: countryErr.message,
              rowIndex: rows.indexOf(row)
            });
            processingState.completed++;
          }
        }
        // Continue to next country instead of stopping
        continue;
      }
    }

    // Processing complete
    processingState.isActive = false;
    chrome.alarms.clear('keepAlive');

    port.postMessage({
      type: 'PROCESSING_COMPLETE',
      payload: {
        results: processingState.results,
        totalProcessed: processingState.completed,
        errors: processingState.errors,
        skippedCountries: processingState.skippedCountries
      }
    });

  } catch (err) {
    processingState.isActive = false;
    chrome.alarms.clear('keepAlive');
    port.postMessage({
      type: 'PROCESSING_ERROR',
      payload: {
        message: err.message,
        partialResults: processingState.results,
        completed: processingState.completed
      }
    });
  }
}

// ============================================================
// Full Bot Mode Orchestration
// Follows the IATA eBulletin Word doc procedure step-by-step
// ============================================================

function sendBotStatus(port, stage, message, data) {
  botModeState.stage = stage;
  // Sync to storage so the popup can show correct state
  syncBotState(stage, message);
  try {
    port.postMessage({
      type: 'FULL_BOT_STATUS',
      payload: { stage, message, timestamp: Date.now(), ...(data ? { data } : {}) }
    });
  } catch (err) {
    // Port may have disconnected
    console.warn('[APG Bot] Could not send status:', err.message);
  }
}

/**
 * Sync bot state to chrome.storage so the popup always shows the correct status.
 */
function syncBotState(stage, message) {
  const isRunning = botModeState.isActive;
  const isError = stage === 'error' || stage === 'cancelled';
  const isDone = stage === 'complete' || stage === 'done';

  let state = 'IDLE';
  if (isRunning && !isError && !isDone) state = 'BOT_RUNNING';
  else if (isError) state = 'ERROR';
  else if (isDone) state = 'DONE';

  chrome.storage.local.set({
    currentJob: {
      state,
      stage: stage || null,
      message: message || null,
      lastUpdate: Date.now()
    }
  }).catch(() => {});
}

function handleCancelFullBot(port) {
  botModeState.isCancelled = true;
  botModeState.isActive = false;
  botModeState.stage = null;
  syncBotState('cancelled', 'Bot annule par l\'utilisateur.');
  chrome.alarms.clear('keepAlive');
  try {
    port.postMessage({
      type: 'FULL_BOT_STATUS',
      payload: { stage: 'cancelled', message: 'Bot mode annule par l\'utilisateur.' }
    });
  } catch (err) {
    // Port disconnected
  }
}

// Resolver for the EBULLETIN_PROCESSED message (set during bot flow)
let ebulletinProcessedResolver = null;

function handleEBulletinProcessed(payload, port) {
  if (ebulletinProcessedResolver) {
    ebulletinProcessedResolver(payload);
    ebulletinProcessedResolver = null;
  }
}

// ============================================================
// handleStartFullBot - REAL workflow following IATA procedure
// ============================================================
async function handleStartFullBot(port) {
  // Prevent multiple bot instances
  if (botModeState.isActive) {
    sendBotStatus(port, 'error', 'Le bot est deja en cours d\'execution.');
    return;
  }

  // Reset bot state
  botModeState = {
    isActive: true,
    isCancelled: false,
    stage: null,
    iataTabId: null,
    bspTabId: null,
    ebulletinTabId: null,
    codeSearchTabId: null,
    port
  };

  // Keep service worker alive
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

  try {
    // ================================================================
    // STEP 1: Open or find IATA portal tab
    // ================================================================
    sendBotStatus(port, 'opening_portal', 'Etape 1/7 - Ouverture du portail IATA...');

    let iataTab = await findIATAPortalTab();
    if (!iataTab) {
      iataTab = await chrome.tabs.create({
        url: 'https://portal.iata.org/s/login/?language=en_US',
        active: true
      });
      await waitForTabLoad(iataTab.id);
      await wait(3000); // Wait for JS frameworks to render
    }
    botModeState.iataTabId = iataTab.id;
    await focusTab(iataTab.id);

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 2: Check login / wait for manual login + 2FA
    // ================================================================
    sendBotStatus(port, 'checking_login', 'Etape 1/7 - Verification de la connexion au portail...');

    // Try to inject content script in case it was not auto-injected
    await ensureContentScript(iataTab.id, 'portal');

    const alreadyLoggedIn = await sendToTab(iataTab.id, { type: 'CHECK_LOGGED_IN' });

    if (!alreadyLoggedIn?.isLoggedIn) {
      // Make sure we're on the login page
      const tab = await chrome.tabs.get(iataTab.id);
      if (!tab.url || !tab.url.includes('portal.iata.org')) {
        await chrome.tabs.update(iataTab.id, {
          url: 'https://portal.iata.org/s/login/?language=en_US'
        });
        await waitForTabLoad(iataTab.id);
        await wait(3000);
      }

      sendBotStatus(port, 'waiting_login', 'Etape 1/7 - En attente de connexion manuelle + 2FA. Connectez-vous au portail IATA.', {
        instruction: 'Connectez-vous au portail IATA avec vos identifiants et validez la 2FA. Le bot detectera automatiquement la connexion.'
      });

      // Poll for login completion (max 5 minutes for manual login + 2FA)
      const loginSuccess = await pollForLogin(iataTab.id, port);
      if (!loginSuccess) {
        if (!botModeState.isCancelled) {
          sendBotStatus(port, 'error', 'Timeout - connexion non detectee apres 5 minutes. Relancez le bot apres vous etre connecte.');
        }
        botModeState.isActive = false;
        chrome.alarms.clear('keepAlive');
        return;
      }
    }

    sendBotStatus(port, 'logged_in', 'Etape 1/7 - Connexion au portail IATA confirmee.');
    await focusTab(iataTab.id);

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 2: Navigate to eBulletin service
    // Multi-strategy approach:
    //   A) Try content script tile click (portal page — waits for tiles to load, tries "See All")
    //   B) Try SCAN_PORTAL_SERVICES to discover correct link
    //   C) Scan all open tabs for eBulletin
    //   D) Try direct URL navigation via chrome.tabs.update
    //   E) Wait for user to navigate manually (monitor all tabs)
    // ================================================================
    sendBotStatus(port, 'navigating_ebulletin', 'Etape 2/7 - Navigation vers eBulletin...');

    await ensureContentScript(iataTab.id, 'portal');
    await focusTab(iataTab.id);
    await wait(1000);

    let ebulletinTabId = null;

    // ---- Strategy A: Content script tile click ----
    sendBotStatus(port, 'navigating_ebulletin', 'Etape 2/7 - Recherche du service E-Bulletin sur le portail (attente du chargement)...');
    // Give the content script 45s — it waits for portal tiles to load first, then tries "See All"
    const navResult = await sendToTab(iataTab.id, { type: 'NAVIGATE_TO_EBULLETIN' }, 45000);

    if (navResult?.success) {
      await wait(5000);
      // Check if a new tab was opened
      if (botModeState.ebulletinTabId) {
        ebulletinTabId = botModeState.ebulletinTabId;
      } else {
        // Check if portal tab navigated to eBulletin
        const currentTab = await chrome.tabs.get(iataTab.id);
        // VERIFY we're actually on an eBulletin page, not still on portal home
        await ensureContentScript(iataTab.id, 'portal');
        const pageCheck = await sendToTab(iataTab.id, { type: 'CHECK_EBULLETIN_PAGE' }, 10000);
        if (pageCheck?.isEbulletinPage) {
          ebulletinTabId = iataTab.id;
          sendBotStatus(port, 'ebulletin_found', `Etape 2/7 - Page eBulletin confirmee: ${currentTab.url}`);
        } else {
          console.warn('[APG Bot] Tile click succeeded but page is not eBulletin:', currentTab.url);
          // Don't set ebulletinTabId — fall through to next strategy
        }
      }
    }

    // ---- Strategy B: Scan portal for available services ----
    if (!ebulletinTabId) {
      sendBotStatus(port, 'navigating_ebulletin', 'Etape 2/7 - Scan des services disponibles sur le portail...');
      const services = await sendToTab(iataTab.id, { type: 'SCAN_PORTAL_SERVICES' }, 10000);

      if (services?.services?.length > 0) {
        // Look for eBulletin-related service
        const ebulletinService = services.services.find(s => {
          const t = (s.text || '').toLowerCase();
          const h = (s.href || '').toLowerCase();
          return t.includes('bulletin') || t.includes('airs') || t.includes('cairs') ||
                 t.includes('e-bulletin') || t.includes('ebulletin') ||
                 h.includes('bulletin') || h.includes('airs') || h.includes('ebulletin');
        });

        if (ebulletinService?.href) {
          sendBotStatus(port, 'navigating_ebulletin', `Etape 2/7 - Service trouve: "${ebulletinService.text}" — navigation...`);
          // Navigate to the discovered URL
          await chrome.tabs.update(iataTab.id, { url: ebulletinService.href, active: true });
          await waitForTabLoad(iataTab.id);
          await wait(4000);
          // Verify it's actually the eBulletin page
          await ensureContentScript(iataTab.id, 'portal');
          const verifyB = await sendToTab(iataTab.id, { type: 'CHECK_EBULLETIN_PAGE' }, 10000);
          if (verifyB?.isEbulletinPage) {
            ebulletinTabId = iataTab.id;
          } else {
            console.warn('[APG Bot] Strategy B: URL loaded but not eBulletin page');
          }
        }
      }
    }

    // ---- Strategy C: Scan all open tabs ----
    if (!ebulletinTabId) {
      sendBotStatus(port, 'navigating_ebulletin', 'Etape 2/7 - Recherche d\'un onglet eBulletin deja ouvert...');
      const foundTab = await findEBulletinTab();
      if (foundTab) {
        ebulletinTabId = foundTab.id;
        await focusTab(ebulletinTabId);
      }
    }

    // ---- Strategy D: Try direct URLs in a new tab ----
    if (!ebulletinTabId) {
      sendBotStatus(port, 'navigating_ebulletin', 'Etape 2/7 - Tentative de navigation directe...');

      const directUrls = [
        'https://portal.iata.org/s/airs-cairs-online-bulletin',
        'https://portal.iata.org/s/ebulletin',
        'https://portal.iata.org/s/risk-management',
        'https://portal.iata.org/s/article/eBulletin',
        'https://portal.iata.org/s/article/AIRS-CAIRS-Online-Bulletin',
        'https://airs.iata.org/',
        'https://ebulletin.iata.org/',
        'https://cairs.iata.org/'
      ];

      for (const url of directUrls) {
        if (botModeState.isCancelled) return;
        sendBotStatus(port, 'navigating_ebulletin', `Etape 2/7 - Essai: ${url}...`);
        try {
          await chrome.tabs.update(iataTab.id, { url, active: true });
          await waitForTabLoad(iataTab.id);
          await wait(4000);

          // Check if we landed on a valid page (not login redirect, not error)
          const tab = await chrome.tabs.get(iataTab.id);
          const tabUrl = (tab.url || '').toLowerCase();

          // If redirected to login or portal home, skip this URL
          if (tabUrl.includes('login') || tabUrl.includes('error') || tabUrl.includes('404') ||
              tabUrl.match(/portal\.iata\.org\/s\/?(\?.*)?$/) || tabUrl.endsWith('/s/')) {
            continue;
          }

          // If URL looks promising, check content
          await ensureContentScript(iataTab.id, 'portal');
          const check = await sendToTab(iataTab.id, { type: 'CHECK_EBULLETIN_PAGE' }, 10000);

          if (check?.isEbulletinPage || check?.hasWeeklyTab || check?.hasGenerateButton ||
              check?.hasDownloadLinks || tabUrl.includes('ebulletin') || tabUrl.includes('airs.iata')) {
            ebulletinTabId = iataTab.id;
            sendBotStatus(port, 'ebulletin_found', `Etape 2/7 - Page eBulletin trouvee: ${tab.url}`);
            break;
          }
        } catch (err) {
          console.warn('[APG Bot] Direct URL failed:', url, err.message);
        }
      }
    }

    // ---- Strategy E: Ask user + monitor tabs ----
    if (!ebulletinTabId) {
      sendBotStatus(port, 'waiting_manual_nav', 'Etape 2/7 - Navigation automatique echouee. Cliquez sur le service "E-Bulletin" ou "AIRS/CAIRS Online Bulletin" sur le portail IATA. Le bot detectera automatiquement la page.', {
        instruction: 'Naviguez manuellement vers la page E-Bulletin (AIRS/CAIRS Online Bulletin) sur le portail IATA. Le bot reprendra automatiquement.',
        requiresUserAction: true
      });

      // Focus portal tab so user can navigate
      await focusTab(iataTab.id);
      // Navigate back to portal home
      await chrome.tabs.update(iataTab.id, { url: 'https://portal.iata.org/s/' });
      await waitForTabLoad(iataTab.id);

      // Monitor ALL tabs for eBulletin URL (2 minute timeout)
      const foundTab = await monitorTabsForUrl(
        ['ebulletin', 'airs.iata', 'cairs.iata', 'bulletin', 'weekly'],
        120000
      );

      if (foundTab) {
        ebulletinTabId = foundTab.id;
        sendBotStatus(port, 'ebulletin_found', `Etape 2/7 - Page eBulletin detectee: ${foundTab.url}`);
      }
    }

    if (!ebulletinTabId) {
      sendBotStatus(port, 'error', 'Impossible de trouver la page eBulletin apres toutes les tentatives. Verifiez que vous avez acces au service "AIRS/CAIRS Online Bulletin" sur le portail IATA.');
      botModeState.isActive = false;
      chrome.alarms.clear('keepAlive');
      return;
    }

    // Focus the eBulletin tab
    await focusTab(ebulletinTabId);
    botModeState.ebulletinTabId = ebulletinTabId;

    // Wait for page to fully load + inject content script
    await waitForTabLoad(ebulletinTabId);
    await wait(3000);
    await ensureContentScript(ebulletinTabId, 'portal');

    // FINAL VERIFICATION: Make sure we're really on the eBulletin page before proceeding
    const finalCheck = await sendToTab(ebulletinTabId, { type: 'CHECK_EBULLETIN_PAGE' }, 10000);
    if (!finalCheck?.isEbulletinPage && !finalCheck?.hasWeeklyTab && !finalCheck?.hasDownloadLinks) {
      // Log what we found for debugging
      const tab = await chrome.tabs.get(ebulletinTabId);
      console.warn('[APG Bot] Final eBulletin verification FAILED. URL:', tab.url, 'Check result:', JSON.stringify(finalCheck));

      // Go to Strategy E: ask user to navigate manually
      sendBotStatus(port, 'waiting_manual_nav', 'Etape 2/7 - La page detectee n\'est pas la page eBulletin. Cliquez sur le service "AIRS/CAIRS Online Bulletin" sur le portail IATA.', {
        instruction: 'Naviguez manuellement vers la page E-Bulletin puis le bot reprendra automatiquement.',
        requiresUserAction: true,
        currentUrl: tab.url
      });

      // Focus portal tab
      await focusTab(iataTab.id);
      await chrome.tabs.update(iataTab.id, { url: 'https://portal.iata.org/s/' });
      await waitForTabLoad(iataTab.id);

      // Monitor for eBulletin URL
      const manualTab = await monitorTabsForUrl(
        ['ebulletin', 'airs.iata', 'cairs.iata'],
        180000 // 3 minutes
      );

      if (manualTab) {
        ebulletinTabId = manualTab.id;
        botModeState.ebulletinTabId = manualTab.id;
        await focusTab(ebulletinTabId);
        await waitForTabLoad(ebulletinTabId);
        await wait(3000);
        await ensureContentScript(ebulletinTabId, 'portal');
        sendBotStatus(port, 'ebulletin_found', `Etape 2/7 - Page eBulletin detectee: ${manualTab.url}`);
      } else {
        sendBotStatus(port, 'error', 'Impossible de trouver la page eBulletin. Verifiez vos droits d\'acces au service AIRS/CAIRS Online Bulletin.');
        botModeState.isActive = false;
        chrome.alarms.clear('keepAlive');
        return;
      }
    }

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 3: Click the "WEEKLY eBulletin" tab, generate report, download
    // ================================================================
    sendBotStatus(port, 'clicking_weekly_tab', 'Etape 3/7 - Selection de l\'onglet Weekly eBulletin...');

    await focusTab(ebulletinTabId);
    const weeklyTabResult = await sendToTab(ebulletinTabId, { type: 'CLICK_WEEKLY_TAB' });
    if (weeklyTabResult?.error && !weeklyTabResult?.success) {
      // Not critical - the weekly tab might already be selected or the page layout might differ
      console.warn('[APG Bot] CLICK_WEEKLY_TAB warning:', weeklyTabResult.error);
      sendBotStatus(port, 'weekly_tab_warning', 'Etape 3/7 - Onglet Weekly: ' + (weeklyTabResult.error || 'non trouve, tentative de continuer...'));
    }
    await wait(2000);

    // ================================================================
    // STEP 3b: Generate Weekly Report
    // ================================================================
    sendBotStatus(port, 'generating_report', 'Etape 3/7 - Generation du rapport hebdomadaire...');

    await focusTab(ebulletinTabId);
    const generateResult = await sendToTab(ebulletinTabId, { type: 'GENERATE_REPORT' });
    if (generateResult?.error && !generateResult?.success) {
      // Report generation button might not exist if report is already generated
      console.warn('[APG Bot] GENERATE_REPORT warning:', generateResult.error);
      sendBotStatus(port, 'generate_report_warning', 'Etape 3/7 - Generation rapport: ' + (generateResult.error || 'bouton non trouve, tentative de telecharger directement...'));
    }

    // Wait for report generation (poll until download link appears)
    if (generateResult?.success) {
      sendBotStatus(port, 'waiting_report', 'Etape 3/7 - En attente de la generation du rapport...');
      await pollForReportReady(ebulletinTabId, port);
    }

    await wait(2000);

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 4: Download the eBulletin CSV/Excel file
    // ================================================================
    sendBotStatus(port, 'downloading_ebulletin', 'Etape 4/7 - Telechargement du fichier eBulletin...');

    await focusTab(ebulletinTabId);
    const downloadResult = await sendToTab(ebulletinTabId, { type: 'DOWNLOAD_LATEST_EBULLETIN' });
    if (!downloadResult?.success || !downloadResult?.data) {
      sendBotStatus(port, 'error', 'Echec du telechargement: ' + (downloadResult?.error || 'Aucun fichier eBulletin trouve sur la page.'), {
        currentUrl: downloadResult?.currentUrl,
        suggestion: 'Verifiez que des fichiers eBulletin sont disponibles sur la page et reessayez.'
      });
      botModeState.isActive = false;
      chrome.alarms.clear('keepAlive');
      return;
    }

    sendBotStatus(port, 'ebulletin_downloaded', 'Etape 4/7 - Fichier eBulletin telecharge avec succes.', {
      fileName: downloadResult.fileName,
      fileSize: downloadResult.fileSize,
      mimeType: downloadResult.mimeType
    });

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 5: Forward file data to dashboard for processing
    // Dashboard will clean, detect anomalies, analyze actions
    // ================================================================
    sendBotStatus(port, 'sending_to_dashboard', 'Etape 4/7 - Envoi des donnees au dashboard pour traitement...');

    port.postMessage({
      type: 'EBULLETIN_DOWNLOADED',
      payload: {
        data: downloadResult.data,
        fileName: downloadResult.fileName || 'ebulletin.xlsx',
        fileSize: downloadResult.fileSize || 0,
        mimeType: downloadResult.mimeType || 'application/octet-stream',
        sourceUrl: downloadResult.sourceUrl || ''
      }
    });

    // ================================================================
    // STEP 6: Wait for dashboard to process and return rows
    // The dashboard processes: cleaning, anomaly detection, action analysis
    // Then sends back EBULLETIN_PROCESSED with rows to verify
    // ================================================================
    sendBotStatus(port, 'waiting_processing', 'Etape 4/7 - En attente du traitement par le dashboard (nettoyage, detection d\'anomalies, analyse des actions)...');

    const processedData = await waitForEBulletinProcessed();
    if (!processedData) {
      if (!botModeState.isCancelled) {
        sendBotStatus(port, 'error', 'Timeout - le dashboard n\'a pas renvoye les donnees traitees apres 5 minutes.');
      }
      botModeState.isActive = false;
      chrome.alarms.clear('keepAlive');
      return;
    }

    sendBotStatus(port, 'data_processed', 'Etape 4/7 - Donnees traitees par le dashboard.', {
      rowCount: processedData.rows?.length || 0,
      agentsToCheck: processedData.agentsToCheck?.length || processedData.rows?.length || 0
    });

    if (botModeState.isCancelled) return;

    const { rows, iataColumn, countryColumn } = processedData;

    // ================================================================
    // STEP 7: BSP Link verification
    // For each agent that needs TA check:
    //   - Find/open BSP Link tab
    //   - Navigate to Settings > Ticketing Authority
    //   - For each country group: switch country, scrape agent table
    //   - Match IATA codes, get Agent Status + TA status
    // ================================================================
    sendBotStatus(port, 'bsplink_starting', `Etape 5/7 - Demarrage de la verification BSP Link pour ${rows.length} agents...`);

    // Find or open BSP Link tab
    let bspTab = await findBSPLinkTab();
    if (!bspTab) {
      // Try navigating from IATA portal
      sendBotStatus(port, 'bsplink_opening', 'Etape 5/7 - Ouverture de BSP Link...');
      await sendToTab(iataTab.id, { type: 'NAVIGATE_TO_BSPLINK' });
      await wait(5000);
      bspTab = await findBSPLinkTab();
    }

    if (!bspTab) {
      // Open BSP Link directly
      const newBspTab = await chrome.tabs.create({
        url: 'https://www.bsplink.iata.org',
        active: true
      });
      await waitForTabLoad(newBspTab.id);
      await wait(5000);
      bspTab = await findBSPLinkTab();
    }

    if (!bspTab) {
      sendBotStatus(port, 'error', 'Impossible d\'ouvrir BSP Link. Verifiez votre connexion et que vous avez acces a BSP Link.', {
        suggestion: 'Ouvrez manuellement bsplink.iata.org, connectez-vous, puis relancez le bot.'
      });
      botModeState.isActive = false;
      chrome.alarms.clear('keepAlive');
      return;
    }

    botModeState.bspTabId = bspTab.id;
    await focusTab(bspTab.id);

    // Check BSP Link login
    await ensureContentScript(bspTab.id, 'bsplink');
    const bspLogin = await sendToTab(bspTab.id, { type: 'CHECK_LOGIN' });
    if (!bspLogin?.isLoggedIn) {
      sendBotStatus(port, 'waiting_bsp_login', 'Etape 5/7 - Non connecte a BSP Link. En attente de connexion SSO...', {
        instruction: 'Si la connexion SSO ne fonctionne pas automatiquement, connectez-vous manuellement a BSP Link.'
      });

      // Wait for BSP Link login (SSO should work since we logged into portal)
      const bspLoginSuccess = await pollForBSPLinkLogin(bspTab.id, port);
      if (!bspLoginSuccess) {
        if (!botModeState.isCancelled) {
          sendBotStatus(port, 'error', 'Non connecte a BSP Link. La session SSO n\'a pas fonctionne. Connectez-vous manuellement et relancez.');
        }
        botModeState.isActive = false;
        chrome.alarms.clear('keepAlive');
        return;
      }
    }

    sendBotStatus(port, 'bsplink_connected', 'Etape 5/7 - Connecte a BSP Link. Demarrage du scraping...');
    await focusTab(bspTab.id);

    if (botModeState.isCancelled) return;

    // Run the BSP Link scraping (country-by-country)
    await runBSPLinkScraping(rows, iataColumn, countryColumn, bspTab, port);

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 8: IATA Code Search enrichment (for agents needing more info)
    // Navigate to IATA Code Search service on portal
    // For each agent code: search and scrape details
    // ================================================================
    const agentsNeedingEnrichment = processingState.results.filter(
      r => r.lookupStatus === 'not_found' || r.agentStatus === 'Not Found'
    );

    if (agentsNeedingEnrichment.length > 0) {
      sendBotStatus(port, 'code_search_starting', `Etape 6/7 - Enrichissement IATA Code Search pour ${agentsNeedingEnrichment.length} agents non trouves...`);

      try {
        const enrichedResults = await handleIATACodeSearchEnrichment(
          agentsNeedingEnrichment, iataTab.id, port
        );

        // Merge enriched data back into results
        for (const enriched of enrichedResults) {
          const idx = processingState.results.findIndex(
            r => r.iataCode === enriched.iataCode && r.country === enriched.country
          );
          if (idx !== -1) {
            processingState.results[idx] = {
              ...processingState.results[idx],
              ...enriched,
              enrichedViaCodeSearch: true
            };
          }
        }

        sendBotStatus(port, 'code_search_complete', `Etape 6/7 - Enrichissement termine. ${enrichedResults.length} agents enrichis.`, {
          enrichedCount: enrichedResults.length,
          totalNotFound: agentsNeedingEnrichment.length
        });
      } catch (enrichErr) {
        console.error('[APG Bot] Code Search enrichment error:', enrichErr.message);
        sendBotStatus(port, 'code_search_warning', `Etape 6/7 - Erreur enrichissement Code Search: ${enrichErr.message}. Poursuite sans enrichissement.`);
      }
    } else {
      sendBotStatus(port, 'code_search_skipped', 'Etape 6/7 - Tous les agents trouves dans BSP Link, pas d\'enrichissement necessaire.');
    }

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 9: Complete - send all results back to dashboard
    // ================================================================
    sendBotStatus(port, 'complete', 'Etape 7/7 - Bot mode termine avec succes!', {
      results: processingState.results,
      totalProcessed: processingState.completed,
      totalFound: processingState.results.filter(r => r.lookupStatus === 'found').length,
      totalNotFound: processingState.results.filter(r => r.lookupStatus === 'not_found').length,
      totalErrors: processingState.results.filter(r => r.lookupStatus === 'error').length,
      totalEnriched: processingState.results.filter(r => r.enrichedViaCodeSearch).length,
      errors: processingState.errors,
      skippedCountries: processingState.skippedCountries
    });

  } catch (err) {
    console.error('[APG Bot] Fatal error:', err);
    sendBotStatus(port, 'error', `Erreur bot mode: ${err.message}`, {
      partialResults: processingState.results,
      completed: processingState.completed,
      stage: botModeState.stage
    });
  } finally {
    botModeState.isActive = false;
    botModeState.port = null;
    botModeState.ebulletinTabId = null;
    botModeState.codeSearchTabId = null;
    ebulletinProcessedResolver = null;
    if (!processingState.isActive) {
      chrome.alarms.clear('keepAlive');
    }
  }
}

// ============================================================
// Poll for login completion on the IATA portal tab.
// Returns true if login detected, false on timeout/cancel.
// ============================================================
async function pollForLogin(tabId, port) {
  const maxAttempts = 150; // 5 minutes at 2-second intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (botModeState.isCancelled) return false;

    try {
      // Check if tab navigated to a logged-in page
      const tab = await chrome.tabs.get(tabId);
      const url = tab?.url || '';

      // If already redirected to BSP Link, login is complete
      if (url.includes('bsplink')) return true;

      // Check 2FA page status for user feedback
      const twoFA = await sendToTab(tabId, { type: 'CHECK_2FA_PAGE' });
      if (twoFA?.is2FAPage) {
        sendBotStatus(port, 'waiting_login',
          twoFA.hasPushNotification
            ? 'Etape 1/7 - En attente de validation 2FA (notification push)...'
            : 'Etape 1/7 - Page 2FA detectee - entrez le code de verification'
        );
      }

      // Check if logged in
      const loggedIn = await sendToTab(tabId, { type: 'CHECK_LOGGED_IN' });
      if (loggedIn?.isLoggedIn) return true;

    } catch (err) {
      // Tab may have navigated, keep polling
    }

    await wait(2000);
  }
  return false;
}

// ============================================================
// Poll for BSP Link login (SSO after portal login)
// ============================================================
async function pollForBSPLinkLogin(tabId, port) {
  const maxAttempts = 60; // 2 minutes at 2-second intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (botModeState.isCancelled) return false;

    try {
      await ensureContentScript(tabId, 'bsplink');
      const loginCheck = await sendToTab(tabId, { type: 'CHECK_LOGIN' });
      if (loginCheck?.isLoggedIn) return true;
    } catch (err) {
      // Keep polling
    }

    await wait(2000);
  }
  return false;
}

// ============================================================
// Poll for report generation readiness (download link appears)
// ============================================================
async function pollForReportReady(tabId, port) {
  const maxAttempts = 30; // 60 seconds at 2-second intervals
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (botModeState.isCancelled) return false;

    try {
      const check = await sendToTab(tabId, { type: 'CHECK_EBULLETIN_PAGE' });
      if (check?.hasDownloadLinks && check.links?.length > 0) {
        return true;
      }
    } catch (err) {
      // Keep polling
    }

    if (attempt % 5 === 0 && attempt > 0) {
      sendBotStatus(port, 'waiting_report',
        `Etape 3/7 - En attente de la generation du rapport... (${attempt * 2}s)`
      );
    }

    await wait(2000);
  }

  // Timeout is not fatal - we'll try to download whatever is available
  return false;
}

// ============================================================
// Wait for the dashboard to send back EBULLETIN_PROCESSED.
// Timeout after 5 minutes.
// ============================================================
function waitForEBulletinProcessed() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      ebulletinProcessedResolver = null;
      resolve(null);
    }, 5 * 60 * 1000); // 5 minute timeout

    ebulletinProcessedResolver = (data) => {
      clearTimeout(timeout);
      resolve(data);
    };

    // Also resolve null if bot is cancelled
    const cancelCheck = setInterval(() => {
      if (botModeState.isCancelled) {
        clearInterval(cancelCheck);
        clearTimeout(timeout);
        ebulletinProcessedResolver = null;
        resolve(null);
      }
    }, 500);
  });
}

// ============================================================
// Ensure content script is injected in a tab
// Uses chrome.scripting.executeScript as fallback
// ============================================================
async function ensureContentScript(tabId, type) {
  try {
    // First check if content script is already there
    const ping = await sendToTab(tabId, { type: 'PING' });
    if (ping?.status === 'alive') return true;
  } catch (err) {
    // Not injected yet
  }

  // Inject content script based on type
  try {
    const scripts = [];
    if (type === 'portal') {
      scripts.push('content-scripts/iata-login.js', 'content-scripts/iata-ebulletin.js');
    } else if (type === 'bsplink') {
      scripts.push('content-scripts/bsplink-scraper.js');
    }

    if (scripts.length > 0) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: scripts
      });
      await wait(500); // Give scripts time to initialize
      console.log(`[APG Bot] Injected ${type} content scripts into tab ${tabId}`);
      return true;
    }
  } catch (err) {
    console.warn(`[APG Bot] Could not inject ${type} content scripts:`, err.message);
    return false;
  }
  return false;
}

// ============================================================
// Find eBulletin tab among all open tabs
// ============================================================
async function findEBulletinTab() {
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (!tab.url) continue;
    const url = tab.url.toLowerCase();
    // Match eBulletin-related URLs but NOT the portal homepage itself
    if ((url.includes('ebulletin') || url.includes('airs.iata') ||
         url.includes('cairs.iata') || url.includes('bulletin')) &&
        !url.includes('portal.iata.org/s/login') &&
        !url.endsWith('portal.iata.org/s/')) {
      return tab;
    }
  }
  return null;
}

// ============================================================
// IATA Code Search enrichment
// Navigate to IATA Code Search service and look up agent details
// ============================================================
async function handleIATACodeSearchEnrichment(agentsToEnrich, portalTabId, port) {
  const enrichedResults = [];

  try {
    // Navigate to IATA Code Search from the portal
    sendBotStatus(port, 'code_search_navigating', 'Etape 6/7 - Navigation vers IATA Code Search...');

    let codeSearchTabId = botModeState.codeSearchTabId;

    if (!codeSearchTabId) {
      // Try to navigate from portal to Code Search
      await ensureContentScript(portalTabId, 'portal');
      const navResult = await sendToTab(portalTabId, { type: 'NAVIGATE_TO_CODE_SEARCH' });

      await wait(5000);

      // Check if a new tab was opened for Code Search
      if (botModeState.codeSearchTabId) {
        codeSearchTabId = botModeState.codeSearchTabId;
      } else {
        // Check if portal tab navigated to Code Search
        const tab = await chrome.tabs.get(portalTabId);
        if (tab.url && (tab.url.includes('codesearch') || tab.url.includes('code-search'))) {
          codeSearchTabId = portalTabId;
        }
      }

      // If still not found, try direct URLs
      if (!codeSearchTabId) {
        const codeSearchUrls = [
          'https://portal.iata.org/s/iata-code-search',
          'https://portal.iata.org/s/code-search'
        ];

        for (const url of codeSearchUrls) {
          try {
            const newTab = await chrome.tabs.create({ url, active: false });
            await waitForTabLoad(newTab.id);
            await wait(3000);
            codeSearchTabId = newTab.id;
            botModeState.codeSearchTabId = newTab.id;
            break;
          } catch (err) {
            console.warn('[APG Bot] Code Search URL failed:', url, err.message);
          }
        }
      }
    }

    if (!codeSearchTabId) {
      console.warn('[APG Bot] Could not find/open IATA Code Search page');
      return enrichedResults;
    }

    await focusTab(codeSearchTabId);
    await ensureContentScript(codeSearchTabId, 'portal');

    // Search each agent code
    for (let i = 0; i < agentsToEnrich.length; i++) {
      if (botModeState.isCancelled) break;

      const agent = agentsToEnrich[i];

      if (i % 5 === 0) {
        sendBotStatus(port, 'code_search_progress',
          `Etape 6/7 - Recherche Code Search: ${i + 1}/${agentsToEnrich.length} agents...`, {
            current: i + 1,
            total: agentsToEnrich.length,
            percent: Math.round(((i + 1) / agentsToEnrich.length) * 100)
          }
        );
      }

      try {
        const searchResult = await sendToTab(codeSearchTabId, {
          type: 'SEARCH_IATA_CODE',
          payload: { iataCode: agent.iataCode }
        });

        // Content script returns { success, data: { iataCode, legalName, status, riskStatus, ... } }
        const csData = searchResult?.data || searchResult;
        if (searchResult?.success && csData) {
          enrichedResults.push({
            iataCode: agent.iataCode,
            country: agent.country,
            agentName: csData.legalName || csData.tradeName || csData.agentName || agent.agentName,
            agentStatus: csData.status || agent.agentStatus,
            riskStatus: csData.riskStatus || 'N/A',
            location: csData.country || '',
            accreditationType: csData.accreditationType || '',
            financialSecurity: csData.validFinancialSecurity || '',
            lookupStatus: 'found_via_code_search',
            codeSearchDetails: csData
          });
        }

        // Rate limit: wait between searches
        await wait(1500);
      } catch (err) {
        console.warn(`[APG Bot] Code Search lookup failed for ${agent.iataCode}:`, err.message);
      }
    }
  } catch (err) {
    console.error('[APG Bot] Code Search enrichment failed:', err.message);
  }

  return enrichedResults;
}

// ============================================================
// Run BSP Link scraping using existing processing logic.
// This reuses the same country-by-country flow as handleStartProcessing
// but is called from bot mode context.
// ============================================================
async function runBSPLinkScraping(rows, iataColumn, countryColumn, bspTab, port) {
  // Initialize processing state (reuse existing structure)
  processingState = {
    isActive: true,
    isPaused: false,
    rows,
    iataColumn,
    countryColumn,
    results: [],
    completed: 0,
    total: rows.length,
    errors: [],
    skippedCountries: []
  };

  // Group rows by country
  const groups = groupByCountry(rows, iataColumn, countryColumn);
  const countries = Object.keys(groups);

  port.postMessage({
    type: 'PROGRESS_UPDATE',
    payload: {
      type: 'init',
      totalCountries: countries.length,
      totalRows: rows.length,
      countries
    }
  });

  sendBotStatus(port, 'bsplink_scraping', `Etape 5/7 - Scraping BSP Link: ${countries.length} pays, ${rows.length} agents...`);

  for (let ci = 0; ci < countries.length; ci++) {
    const country = countries[ci];

    if (!processingState.isActive || botModeState.isCancelled) break;

    // Wait while paused
    while (processingState.isPaused && processingState.isActive && !botModeState.isCancelled) {
      await wait(500);
    }
    if (!processingState.isActive || botModeState.isCancelled) break;

    sendBotStatus(port, 'bsplink_country', `Etape 5/7 - Pays ${ci + 1}/${countries.length}: ${country}...`);

    // Focus BSP Link tab before each country switch
    await focusTab(bspTab.id);

    // Notify dashboard of country switch
    port.postMessage({
      type: 'PROGRESS_UPDATE',
      payload: {
        type: 'country_switch',
        country,
        countryIndex: ci + 1,
        totalCountries: countries.length,
        completed: processingState.completed,
        total: processingState.total
      }
    });

    try {
      // Ensure content script is still injected (BSP Link may have reloaded)
      await ensureContentScript(bspTab.id, 'bsplink');

      // Switch country in BSP Link
      const switchResult = await sendToTab(bspTab.id, {
        type: 'SWITCH_COUNTRY',
        payload: { countryCode: country }
      });

      if (!switchResult?.success) {
        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: {
            type: 'country_error',
            country,
            error: switchResult?.error || 'Impossible de changer de pays'
          }
        });

        processingState.skippedCountries.push(country);

        for (const row of groups[country]) {
          const iataCode = cleanIataCode(row[iataColumn]);
          processingState.results.push({
            iataCode, country,
            agentStatus: 'Error', ticketingAuthority: 'N/A',
            agentName: '', lookupStatus: 'error',
            error: 'Country switch failed',
            rowIndex: rows.indexOf(row)
          });
          processingState.completed++;

          port.postMessage({
            type: 'PROGRESS_UPDATE',
            payload: {
              type: 'row_result', iataCode, country,
              agentStatus: 'Error', ticketingAuthority: 'N/A',
              lookupStatus: 'error',
              completed: processingState.completed,
              total: processingState.total,
              percent: Math.round((processingState.completed / processingState.total) * 100)
            }
          });
        }
        continue;
      }

      await wait(2000);

      // Navigate to Ticketing Authority
      const navResult = await sendToTab(bspTab.id, { type: 'NAVIGATE_TO_TICKETING_AUTHORITY' });
      if (!navResult?.success) {
        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: { type: 'country_warning', country, warning: 'Table Ticketing Authority non trouvee' }
        });
      }

      await wait(3000);

      // Scrape the entire table (all pages)
      const tableData = await sendToTab(bspTab.id, { type: 'SCRAPE_ALL_PAGES' });
      const agents = tableData?.agents || [];
      const agentMap = buildAgentMap(agents);

      port.postMessage({
        type: 'PROGRESS_UPDATE',
        payload: {
          type: 'country_scraped',
          country,
          agentsFound: agents.length,
          pages: tableData?.pages || 1
        }
      });

      // Match IATA codes for this country
      for (const row of groups[country]) {
        if (!processingState.isActive || botModeState.isCancelled) break;

        while (processingState.isPaused && processingState.isActive && !botModeState.isCancelled) {
          await wait(500);
        }
        if (!processingState.isActive || botModeState.isCancelled) break;

        const iataCode = cleanIataCode(row[iataColumn]);
        const agent = agentMap[iataCode] || agentMap[String(row[iataColumn]).trim()];

        const result = {
          iataCode,
          country,
          agentStatus: agent?.agentStatus || 'Not Found',
          ticketingAuthority: agent?.ticketingAuthority || 'N/A',
          agentName: agent?.agentName || '',
          lookupStatus: agent ? 'found' : 'not_found',
          rowIndex: rows.indexOf(row)
        };

        processingState.results.push(result);
        processingState.completed++;

        port.postMessage({
          type: 'PROGRESS_UPDATE',
          payload: {
            type: 'row_result',
            ...result,
            completed: processingState.completed,
            total: processingState.total,
            percent: Math.round((processingState.completed / processingState.total) * 100)
          }
        });

        await wait(100);
      }

    } catch (countryErr) {
      processingState.errors.push({ country, error: countryErr.message });

      port.postMessage({
        type: 'PROGRESS_UPDATE',
        payload: {
          type: 'country_error',
          country,
          error: countryErr.message
        }
      });

      for (const row of groups[country]) {
        const iataCode = cleanIataCode(row[iataColumn]);
        if (!processingState.results.find(r => r.iataCode === iataCode && r.country === country)) {
          processingState.results.push({
            iataCode, country,
            agentStatus: 'Error', ticketingAuthority: 'N/A',
            agentName: '', lookupStatus: 'error',
            error: countryErr.message,
            rowIndex: rows.indexOf(row)
          });
          processingState.completed++;
        }
      }
      continue;
    }
  }

  // Mark processing as done
  processingState.isActive = false;

  port.postMessage({
    type: 'PROCESSING_COMPLETE',
    payload: {
      results: processingState.results,
      totalProcessed: processingState.completed,
      errors: processingState.errors,
      skippedCountries: processingState.skippedCountries
    }
  });
}

// ---- Helpers ----

async function findBSPLinkTab() {
  const tabs = await chrome.tabs.query({
    url: ['*://www.bsplink.iata.org/*', '*://bsplink.iata.org/*']
  });
  if (tabs.length > 0) return tabs[0];

  // Also try finding by title
  const allTabs = await chrome.tabs.query({});
  for (const tab of allTabs) {
    if (tab.url && (tab.url.includes('bsplink') || tab.url.includes('BSPlink'))) {
      return tab;
    }
  }
  return null;
}

async function sendToTab(tabId, message, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      console.warn('[APG] sendToTab timeout for', message.type, 'on tab', tabId);
      resolve({ error: 'timeout', timedOut: true });
    }, timeoutMs);

    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        clearTimeout(timer);
        if (chrome.runtime.lastError) {
          console.warn('[APG] Tab communication error:', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || {});
        }
      });
    } catch (err) {
      clearTimeout(timer);
      resolve({ error: err.message });
    }
  });
}

async function focusTab(tabId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (err) {
    console.warn('[APG] Could not focus tab:', err.message);
  }
}

// Monitor all tabs for a URL pattern match (used when bot navigation fails)
async function monitorTabsForUrl(patterns, timeoutMs = 120000) {
  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(null);
    }, timeoutMs);

    // Check existing tabs first
    chrome.tabs.query({}).then(tabs => {
      for (const tab of tabs) {
        if (tab.url && patternList.some(p => tab.url.toLowerCase().includes(p))) {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
          return;
        }
      }
    });

    // Listen for new/updated tabs
    function listener(tabId, changeInfo, tab) {
      if (changeInfo.status === 'complete' && tab.url) {
        if (patternList.some(p => tab.url.toLowerCase().includes(p))) {
          clearTimeout(timer);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function groupByCountry(rows, iataColumn, countryColumn) {
  const groups = {};
  for (const row of rows) {
    const country = String(row[countryColumn] || 'XX').trim().toUpperCase();
    if (!groups[country]) groups[country] = [];
    groups[country].push(row);
  }
  return groups;
}

function cleanIataCode(raw) {
  const str = String(raw).trim().replace(/[^0-9]/g, '');
  if (str.length === 8) return str.substring(0, 7);
  return str;
}

function buildAgentMap(agents) {
  const map = {};
  for (const agent of agents) {
    const code = String(agent.agentCode).trim().replace(/[^0-9]/g, '');
    map[code] = agent;
    // Also map 7-digit version if code is 8 digits
    if (code.length === 8) map[code.substring(0, 7)] = agent;
    // Also map 8-digit version if code is 7 digits
    if (code.length === 7) map[code + '0'] = agent;
  }
  return map;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
