// ============================================================
// APG BSP Link - Background Service Worker (Manifest V3)
// Orchestrates scraping of BSP Link Ticketing Authority
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

// Keep-alive alarm during processing
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'keepAlive' && processingState.isActive) {
    // Keep service worker alive during processing
  }
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
    }
  });

  port.onDisconnect.addListener(() => {
    // Dashboard closed - pause processing (don't cancel)
    if (processingState.isActive) {
      processingState.isPaused = true;
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

async function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[APG] Tab communication error:', chrome.runtime.lastError.message);
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(response || {});
        }
      });
    } catch (err) {
      resolve({ error: err.message });
    }
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
