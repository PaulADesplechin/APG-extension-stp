// ============================================================
// APG Assistant - Background Service Worker (Manifest V3)
// Orchestrates the BSP Link Agent Status verification:
//   1. Connect to BSP Link (user manual login + 2FA)
//   2. Wait for Excel upload (Agent Codes list)
//   3. For each country: Ticketing Authority scraping (Enable/Disable)
//   4. Generate final Excel with updated statuses
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

// Resolver for Excel upload promise (set by handleStartFullBot, resolved by EXCEL_UPLOADED message)
let excelUploadResolver = null;

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

// ---- Tab tracking: detect BSP Link login completion ----
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!botModeState.isActive) return;

  if (changeInfo.status === 'complete' && tab.url) {
    const url = tab.url.toLowerCase();

    // Detect BSP Link tab
    if (url.includes('bsplink') && !botModeState.bspTabId) {
      botModeState.bspTabId = tabId;
      console.log('[APG Assistant] Detected BSP Link tab:', tabId, tab.url);
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
      case 'EXCEL_UPLOADED':
        // Dashboard sends this when user uploads Excel with Agent Codes
        if (excelUploadResolver) {
          excelUploadResolver(msg.payload);
        }
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
// handleStartFullBot - NEW FLOW: BSP Link Agent Status verification
// ============================================================
async function handleStartFullBot(port) {
  // Prevent multiple bot instances
  if (botModeState.isActive) {
    sendBotStatus(port, 'error', 'L\'assistant est deja en cours d\'execution.');
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
    // STEP 1: Portal login → navigate to BSP Link via Favorite Services
    // Path: portal.iata.org → login + 2FA → Favorite Services → BSP Link
    // ================================================================
    sendBotStatus(port, 'opening_portal', 'Etape 1/4 - Ouverture du portail IATA...');

    // 1a. Find or open portal tab
    let portalTab = await findIATAPortalTab();
    if (!portalTab) {
      portalTab = await chrome.tabs.create({
        url: 'https://portal.iata.org/s/login/?language=en_US',
        active: true
      });
      await waitForTabLoad(portalTab.id);
      await wait(3000);
    }
    botModeState.iataTabId = portalTab.id;
    await focusTab(portalTab.id);

    if (botModeState.isCancelled) return;

    // 1b. Check login / wait for manual login + 2FA
    sendBotStatus(port, 'checking_login', 'Etape 1/4 - Verification de la connexion au portail IATA...');
    await ensureContentScript(portalTab.id, 'portal');

    const alreadyLoggedIn = await sendToTab(portalTab.id, { type: 'CHECK_LOGGED_IN' });

    if (!alreadyLoggedIn?.isLoggedIn) {
      const tab = await chrome.tabs.get(portalTab.id);
      if (!tab.url || !tab.url.includes('portal.iata.org')) {
        await chrome.tabs.update(portalTab.id, {
          url: 'https://portal.iata.org/s/login/?language=en_US'
        });
        await waitForTabLoad(portalTab.id);
        await wait(3000);
      }

      sendBotStatus(port, 'waiting_login', 'Etape 1/4 - Connectez-vous au portail IATA (c.bertereau@apg-airlines.com) + 2FA.', {
        instruction: 'Connectez-vous au portail IATA et validez la 2FA. L\'assistant detectera automatiquement la connexion.',
        requiresUserAction: true
      });

      // Poll for login (max 5 minutes)
      const loginSuccess = await pollForLogin(portalTab.id, port);
      if (!loginSuccess) {
        if (!botModeState.isCancelled) {
          sendBotStatus(port, 'error', 'Timeout — connexion non detectee apres 5 minutes.');
        }
        botModeState.isActive = false;
        chrome.alarms.clear('keepAlive');
        return;
      }
    }

    sendBotStatus(port, 'logged_in', 'Etape 1/4 - Connexion au portail IATA confirmee.');

    if (botModeState.isCancelled) return;

    // 1c. Navigate to BSP Link via Favorite Services
    sendBotStatus(port, 'navigating_bsplink', 'Etape 1/4 - Navigation vers BSP Link depuis le portail...');
    await focusTab(portalTab.id);
    await wait(2000);

    // Check if BSP Link is already open in another tab
    let bspTab = await findBSPLinkTab();

    if (!bspTab) {
      // Try clicking "BSP Link" in Favorite Services on the portal
      await ensureContentScript(portalTab.id, 'portal');
      const navResult = await sendToTab(portalTab.id, {
        type: 'NAVIGATE_TO_EBULLETIN' // Reuse tile click — we'll search for "BSP Link" text
      }, 30000);

      // Also try clicking "BSP Link" tile specifically
      const bspNavResult = await sendToTab(portalTab.id, {
        type: 'CLICK_PORTAL_TILE',
        payload: {
          tileTexts: ['BSP Link', 'BSPlink', 'BSP link', 'BSPLINK', 'Bsp Link'],
          fallbackUrls: ['https://www.bsplink.iata.org', 'https://bsplink.iata.org']
        }
      }, 20000);

      // Wait for BSP Link tab to appear
      await wait(5000);
      bspTab = await findBSPLinkTab();

      // If still not found, monitor tabs
      if (!bspTab) {
        sendBotStatus(port, 'navigating_bsplink', 'Etape 1/4 - Recherche de l\'onglet BSP Link...');
        const foundTab = await monitorTabsForUrl(['bsplink'], 30000);
        if (foundTab) bspTab = foundTab;
      }

      // Last resort: open BSP Link directly (user is logged in via portal SSO)
      if (!bspTab) {
        sendBotStatus(port, 'navigating_bsplink', 'Etape 1/4 - Ouverture directe de BSP Link...');
        const newTab = await chrome.tabs.create({
          url: 'https://www.bsplink.iata.org',
          active: true
        });
        await waitForTabLoad(newTab.id);
        await wait(5000);
        bspTab = newTab;
      }
    }

    botModeState.bspTabId = bspTab.id;
    await focusTab(bspTab.id);

    // Wait for BSP Link to be logged in (SSO from portal)
    await ensureContentScript(bspTab.id, 'bsplink');
    const bspLogin = await sendToTab(bspTab.id, { type: 'CHECK_LOGIN' });

    if (!bspLogin?.isLoggedIn) {
      sendBotStatus(port, 'waiting_login', 'Etape 1/4 - Attente de connexion BSP Link (SSO depuis le portail)...', {
        instruction: 'La connexion SSO devrait etre automatique. Si ca bloque, connectez-vous manuellement a BSP Link.'
      });

      const bspLoginSuccess = await pollForBSPLinkLogin(bspTab.id, port, 90); // 3 min
      if (!bspLoginSuccess) {
        if (!botModeState.isCancelled) {
          sendBotStatus(port, 'error', 'Connexion BSP Link echouee. Connectez-vous manuellement et relancez.');
        }
        botModeState.isActive = false;
        chrome.alarms.clear('keepAlive');
        return;
      }
    }

    sendBotStatus(port, 'logged_in', 'Etape 1/4 - Connecte a BSP Link!');
    await focusTab(bspTab.id);

    // Handle initial ISOC selection page (if we land on it)
    await ensureContentScript(bspTab.id, 'bsplink');
    const pageInfo = await sendToTab(bspTab.id, { type: 'GET_PAGE_INFO' });

    if (pageInfo?.pageType === 'isoc_selection') {
      sendBotStatus(port, 'navigating_bsplink', 'Etape 1/4 - Page ISOC detectee, selection du premier pays disponible...');

      // Get available countries from the select dropdown
      if (pageInfo.selectElements?.[0]) {
        const firstCountryOption = pageInfo.selectElements.find(s => s.optionCount > 1);
        if (firstCountryOption?.firstOptions?.[1]) {
          // Select any country to get past the ISOC page — we'll switch later per country
          const selectResult = await sendToTab(bspTab.id, {
            type: 'SELECT_ISOC_COUNTRY',
            payload: { countryCode: firstCountryOption.firstOptions[1] }
          }, 10000);

          if (selectResult?.success) {
            const submitResult = await sendToTab(bspTab.id, { type: 'SUBMIT_ISOC_FORM' }, 15000);
            await wait(3000);

            // Check if we need a second submit (user selection page)
            await ensureContentScript(bspTab.id, 'bsplink');
            const newPageInfo = await sendToTab(bspTab.id, { type: 'GET_PAGE_INFO' });
            if (newPageInfo?.pageType === 'user_selection') {
              await sendToTab(bspTab.id, { type: 'SUBMIT_ISOC_FORM' }, 15000);
              await wait(3000);
            }
          }
        }
      }
    }

    sendBotStatus(port, 'logged_in', 'Etape 1/4 - BSP Link pret!');

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 2: Wait for Excel upload from dashboard
    // The dashboard sends EXCEL_UPLOADED with rows + column mapping
    // ================================================================
    sendBotStatus(port, 'waiting_excel', 'Etape 2/4 - En attente de l\'upload du fichier Excel avec les Agent Codes...', {
      instruction: 'Ouvrez le Dashboard et uploadez le fichier Excel contenant les Agent Codes a verifier.',
      requiresUserAction: true
    });

    // Switch focus to dashboard so user can upload
    const dashTabs = await chrome.tabs.query({ url: chrome.runtime.getURL('dashboard/*') });
    if (dashTabs.length > 0) {
      await focusTab(dashTabs[0].id);
    }

    const uploadedData = await waitForExcelUpload();
    if (!uploadedData) {
      if (!botModeState.isCancelled) {
        sendBotStatus(port, 'error', 'Timeout — aucun fichier Excel recu apres 10 minutes.');
      }
      botModeState.isActive = false;
      chrome.alarms.clear('keepAlive');
      return;
    }

    const { rows, iataColumn, countryColumn } = uploadedData;

    sendBotStatus(port, 'excel_received', `Etape 2/4 - Fichier Excel recu: ${rows.length} Agent Codes a verifier.`, {
      rowCount: rows.length,
      countries: [...new Set(rows.map(r => String(r[countryColumn] || 'XX').trim().toUpperCase()))]
    });

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 3: BSP Link scraping — country by country
    // For each country group:
    //   - Switch to country via "Switch to another BSP Link account"
    //   - Navigate to Master Data > Ticketing Authority History
    //   - Scrape agent table (all pages)
    //   - Match Agent Codes → get Enable/Disable action
    // ================================================================
    await focusTab(bspTab.id);
    sendBotStatus(port, 'bsplink_starting', `Etape 3/4 - Demarrage du scraping BSP Link pour ${rows.length} agents...`);

    // Run the BSP Link scraping (country-by-country)
    await runBSPLinkScraping(rows, iataColumn, countryColumn, bspTab, port);

    if (botModeState.isCancelled) return;

    // ================================================================
    // STEP 4: Complete — send results to dashboard for Excel generation
    // ================================================================
    const totalFound = processingState.results.filter(r => r.lookupStatus === 'found').length;
    const totalNotFound = processingState.results.filter(r => r.lookupStatus === 'not_found').length;
    const totalEnabled = processingState.results.filter(r => (r.action || '').toLowerCase().includes('enable')).length;
    const totalDisabled = processingState.results.filter(r => (r.action || '').toLowerCase().includes('disable')).length;

    sendBotStatus(port, 'complete', `Etape 4/4 - Verification terminee! ${totalFound} trouves, ${totalEnabled} Enable, ${totalDisabled} Disable.`, {
      results: processingState.results,
      totalProcessed: processingState.completed,
      totalFound,
      totalNotFound,
      totalEnabled,
      totalDisabled,
      totalErrors: processingState.results.filter(r => r.lookupStatus === 'error').length,
      errors: processingState.errors,
      skippedCountries: processingState.skippedCountries
    });

    // Save to processing history
    const historyEntry = {
      date: Date.now(),
      totalProcessed: processingState.completed,
      totalFound,
      totalNotFound,
      totalEnabled,
      totalDisabled
    };
    const histData = await chrome.storage.local.get(['processingHistory']);
    const history = histData.processingHistory || [];
    history.push(historyEntry);
    await chrome.storage.local.set({ processingHistory: history });

    // Update storage state
    await chrome.storage.local.set({
      currentJob: { state: 'DONE', stage: 'complete', lastUpdate: Date.now() }
    });

  } catch (err) {
    console.error('[APG Assistant] Fatal error:', err);
    sendBotStatus(port, 'error', `Erreur: ${err.message}`, {
      partialResults: processingState.results,
      completed: processingState.completed,
      stage: botModeState.stage
    });
  } finally {
    botModeState.isActive = false;
    botModeState.port = null;
    botModeState.ebulletinTabId = null;
    botModeState.codeSearchTabId = null;
    excelUploadResolver = null;
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
async function pollForBSPLinkLogin(tabId, port, maxAttempts = 60) {
  // Default: 60 attempts = 2 minutes at 2-second intervals
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
// Wait for Excel upload from the dashboard.
// Timeout after 10 minutes.
// ============================================================
function waitForExcelUpload() {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      excelUploadResolver = null;
      resolve(null);
    }, 10 * 60 * 1000); // 10 minute timeout

    excelUploadResolver = (data) => {
      clearTimeout(timeout);
      excelUploadResolver = null;
      resolve(data);
    };

    // Also resolve null if bot is cancelled
    const cancelCheck = setInterval(() => {
      if (botModeState.isCancelled) {
        clearInterval(cancelCheck);
        clearTimeout(timeout);
        excelUploadResolver = null;
        resolve(null);
      }
    }, 500);
  });
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
        `Etape 3/4 - En attente de la generation du rapport... (${attempt * 2}s)`
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
    sendBotStatus(port, 'code_search_navigating', 'Etape 3/4 - Navigation vers IATA Code Search...');

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
          `Etape 3/4 - Recherche Code Search: ${i + 1}/${agentsToEnrich.length} agents...`, {
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

  sendBotStatus(port, 'bsplink_scraping', `Etape 3/4 - Scraping BSP Link: ${countries.length} pays, ${rows.length} agents...`);

  for (let ci = 0; ci < countries.length; ci++) {
    const country = countries[ci];

    if (!processingState.isActive || botModeState.isCancelled) break;

    // Wait while paused
    while (processingState.isPaused && processingState.isActive && !botModeState.isCancelled) {
      await wait(500);
    }
    if (!processingState.isActive || botModeState.isCancelled) break;

    sendBotStatus(port, 'bsplink_country', `Etape 3/4 - Pays ${ci + 1}/${countries.length}: ${country}...`);

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
          action: agent?.action || 'Not Found', // Enable or Disable — key data point
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
