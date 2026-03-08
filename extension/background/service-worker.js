// ============================================================
// APG BSP Link - Background Service Worker (Manifest V3)
// Orchestrates scraping of BSP Link Ticketing Authority
// ============================================================

let processingState = {
  isActive: false,
  rows: [],
  iataColumn: '',
  countryColumn: '',
  results: [],
  countryGroups: {},
  currentCountry: null,
  completed: 0,
  total: 0
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
        processingState.isActive = false;
        break;
      case 'RESUME_PROCESSING':
        processingState.isActive = true;
        break;
      case 'CANCEL_PROCESSING':
        processingState.isActive = false;
        processingState.results = [];
        chrome.alarms.clear('keepAlive');
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    // Dashboard closed - pause processing
    if (processingState.isActive) {
      processingState.isActive = false;
      chrome.alarms.clear('keepAlive');
    }
  });
});

async function handleStartProcessing(payload, port) {
  const { rows, iataColumn, countryColumn } = payload;

  processingState = {
    isActive: true,
    rows,
    iataColumn,
    countryColumn,
    results: [],
    completed: 0,
    total: rows.length
  };

  // Keep alive during processing
  chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });

  try {
    // Find BSP Link tab
    const bspTab = await findBSPLinkTab();
    if (!bspTab) {
      port.postMessage({
        type: 'PROCESSING_ERROR',
        payload: { message: 'Ouvrez BSP Link dans un onglet et connectez-vous d\'abord.' }
      });
      return;
    }

    // Group rows by country
    const groups = groupByCountry(rows, iataColumn, countryColumn);
    const countries = Object.keys(groups);

    for (const country of countries) {
      if (!processingState.isActive) break;

      // Notify dashboard of country switch
      port.postMessage({
        type: 'PROGRESS_UPDATE',
        payload: {
          type: 'country_switch',
          country,
          countryName: country,
          completed: processingState.completed,
          total: processingState.total
        }
      });

      // Switch country in BSP Link
      await sendToTab(bspTab.id, {
        type: 'SWITCH_COUNTRY',
        payload: { countryCode: country }
      });
      await wait(2000);

      // Navigate to Ticketing Authority
      await sendToTab(bspTab.id, { type: 'NAVIGATE_TO_TICKETING_AUTHORITY' });
      await wait(3000);

      // Scrape the entire table
      const tableData = await sendToTab(bspTab.id, { type: 'SCRAPE_ALL_PAGES' });
      const agentMap = buildAgentMap(tableData?.agents || []);

      // Match IATA codes
      for (const row of groups[country]) {
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
    }

    // Done
    processingState.isActive = false;
    chrome.alarms.clear('keepAlive');

    port.postMessage({
      type: 'PROCESSING_COMPLETE',
      payload: { results: processingState.results }
    });

  } catch (err) {
    processingState.isActive = false;
    chrome.alarms.clear('keepAlive');
    port.postMessage({
      type: 'PROCESSING_ERROR',
      payload: { message: err.message }
    });
  }
}

// ---- Helpers ----

async function findBSPLinkTab() {
  const tabs = await chrome.tabs.query({ url: ['*://www.bsplink.iata.org/*', '*://bsplink.iata.org/*'] });
  return tabs.length > 0 ? tabs[0] : null;
}

async function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      resolve(response || {});
    });
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
    const code = String(agent.agentCode).trim();
    map[code] = agent;
    // Also map 7-digit version
    if (code.length === 8) map[code.substring(0, 7)] = agent;
  }
  return map;
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
