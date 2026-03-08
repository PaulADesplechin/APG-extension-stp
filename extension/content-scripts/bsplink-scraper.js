// ============================================================
// APG BSP Link - Content Script
// Injected into BSP Link pages for DOM scraping
// ============================================================

// Configurable selectors with fallback chains
// These MUST be tested and updated with real BSP Link DOM
const SELECTORS = {
  // Login detection - elements that indicate user is NOT logged in
  loginIndicators: [
    'input[type="password"]', 'form[action*="login"]',
    '#loginForm', '.login-form', '[class*="login"]',
    'button[type="submit"][class*="login"]'
  ],
  // Elements that indicate user IS logged in (dashboard/main content)
  loggedInIndicators: [
    'a[href*="logout"]', 'button[class*="logout"]',
    '[class*="user-menu"]', '[class*="header-user"]',
    '.navbar', '#mainMenu', '[class*="dashboard"]',
    'a[href*="settings"]'
  ],
  // Navigation tabs
  settingsTab: [
    'a[href*="settings"]', '[data-tab="settings"]',
    '#settingsTab', 'li.settings a', 'a.settings',
    'a[title*="Settings"]', 'a[title*="settings"]'
  ],
  ticketingAuthorityTab: [
    'a[href*="ticketing"]', '[data-tab="ticketing-authority"]',
    '#ticketingAuthorityTab', 'a[title*="Ticketing Authority"]',
    'a[href*="ticketingAuthority"]', 'a[href*="TicketingAuthority"]'
  ],
  // Agent table
  agentTable: [
    'table.agent-list', 'table#agentTable',
    '[class*="ticketing"] table', 'table.table',
    'table.dataTable', 'table[class*="grid"]', 'table'
  ],
  // Pagination
  nextPageButton: [
    'a[aria-label="Next"]', 'button[aria-label="Next"]',
    '.pagination .next a', '.pagination-next',
    'a.next', 'button.next', 'li.next a',
    'a[rel="next"]', '.paging_next'
  ],
  // Country selector
  countrySelector: [
    'select[name*="country"]', 'select[name*="bsp"]',
    'select[id*="country"]', '#countrySelector',
    '[class*="country-select"] select',
    'select[name*="Country"]', 'select[id*="Country"]'
  ],
  // Current country in header
  countryHeader: [
    '.header-title', '.bsp-header', 'h1', 'h2',
    '[class*="header"] [class*="country"]',
    '.breadcrumb', '[class*="context"]'
  ]
};

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    console.error('[APG] Error handling message:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_LOGIN':
      return checkLoginStatus();
    case 'NAVIGATE_TO_TICKETING_AUTHORITY':
      return await navigateToTicketingAuthority();
    case 'SWITCH_COUNTRY':
      return await switchCountry(message.payload.countryCode);
    case 'SCRAPE_ALL_PAGES':
      return await scrapeAllPages();
    case 'SCRAPE_CURRENT_PAGE':
      return { agents: scrapeCurrentTable() };
    case 'GET_CURRENT_COUNTRY':
      return { country: detectCurrentCountry() };
    case 'GET_PAGE_INFO':
      return getPageInfo();
    case 'PING':
      return { status: 'alive', url: window.location.href };
    default:
      return { error: 'Unknown message type' };
  }
}

// ---- Login Detection ----
function checkLoginStatus() {
  const url = window.location.href;

  // Check for login page indicators
  const hasLoginForm = SELECTORS.loginIndicators.some(sel => {
    try { return !!document.querySelector(sel); } catch { return false; }
  });

  // Check for logged-in indicators
  const hasLoggedInUI = SELECTORS.loggedInIndicators.some(sel => {
    try { return !!document.querySelector(sel); } catch { return false; }
  });

  // Check URL patterns for login pages
  const isLoginUrl = /login|signin|auth|sso/i.test(url);

  const isLoggedIn = hasLoggedInUI && !hasLoginForm && !isLoginUrl;

  return {
    isLoggedIn,
    hasLoginForm,
    hasLoggedInUI,
    isLoginUrl,
    currentUrl: url,
    pageTitle: document.title
  };
}

function getPageInfo() {
  return {
    url: window.location.href,
    title: document.title,
    country: detectCurrentCountry(),
    hasTable: !!findBySelectors(SELECTORS.agentTable),
    tableRowCount: countTableRows(),
    isLoggedIn: checkLoginStatus().isLoggedIn
  };
}

function countTableRows() {
  const table = findBySelectors(SELECTORS.agentTable);
  if (!table) return 0;
  return table.querySelectorAll('tbody tr, tr:not(:first-child)').length;
}

// ---- Navigation ----
async function navigateToTicketingAuthority() {
  // Step 1: Click SETTINGS tab
  const settingsEl = findByTextOrSelector(SELECTORS.settingsTab, 'SETTINGS', 'Settings', 'Paramètres');
  if (settingsEl) {
    settingsEl.click();
    await waitForLoad(5000);
  } else {
    console.warn('[APG] Settings tab not found, trying direct navigation...');
  }

  // Step 2: Click Ticketing Authority tab
  const taEl = findByTextOrSelector(
    SELECTORS.ticketingAuthorityTab,
    'Ticketing Authority', 'TICKETING AUTHORITY',
    'Ticketing', 'TA Management'
  );
  if (taEl) {
    taEl.click();
    await waitForLoad(5000);
  } else {
    console.warn('[APG] Ticketing Authority tab not found');
  }

  // Verify table exists
  const table = findBySelectors(SELECTORS.agentTable);
  const rowCount = countTableRows();

  return {
    success: !!table,
    hasTable: !!table,
    rowCount,
    currentUrl: window.location.href,
    country: detectCurrentCountry(),
    settingsFound: !!settingsEl,
    taFound: !!taEl
  };
}

// ---- Country Switching ----
async function switchCountry(targetCode) {
  const current = detectCurrentCountry();
  if (current === targetCode) {
    return { success: true, alreadyOnCountry: true, country: current };
  }

  // Strategy 1: Try select dropdown
  const select = findBySelectors(SELECTORS.countrySelector);
  if (select && select.tagName === 'SELECT') {
    const option = Array.from(select.options).find(
      opt => opt.value.includes(targetCode) || opt.text.includes(targetCode)
    );
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      // Also try submitting the parent form
      const form = select.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) submitBtn.click();
      }
      await waitForLoad(8000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'select' };
    }
  }

  // Strategy 2: Try clicking a country link/button
  const countryEl = findElementByText(targetCode, 'a, button, [role="option"], li, span');
  if (countryEl) {
    countryEl.click();
    await waitForLoad(8000);
    const newCountry = detectCurrentCountry();
    return { success: newCountry === targetCode, country: newCountry, method: 'click' };
  }

  // Strategy 3: Try URL navigation (some BSP Link versions use URL params)
  const urlPatterns = [
    `?country=${targetCode}`,
    `?bsp=${targetCode}`,
    `&country=${targetCode}`
  ];
  // Don't auto-navigate, just report failure
  return {
    success: false,
    error: `Cannot find country selector for ${targetCode}`,
    currentCountry: current,
    triedMethods: ['select', 'click']
  };
}

function detectCurrentCountry() {
  // Parse from header: "BSPlink - Efficient | COUNTRY_NAME (XX)"
  for (const selector of SELECTORS.countryHeader) {
    try {
      const el = document.querySelector(selector);
      if (el) {
        const match = el.textContent.match(/\(([A-Z]{2})\)/);
        if (match) return match[1];
      }
    } catch { /* skip invalid selectors */ }
  }

  // Try page title
  const titleMatch = document.title.match(/\(([A-Z]{2})\)/);
  if (titleMatch) return titleMatch[1];

  // Try URL params
  const urlParams = new URLSearchParams(window.location.search);
  for (const key of ['country', 'bsp', 'countryCode']) {
    const val = urlParams.get(key);
    if (val && /^[A-Z]{2}$/.test(val)) return val;
  }

  return null;
}

// ---- Table Scraping ----
async function scrapeAllPages() {
  let allAgents = [];
  let pageNum = 1;
  let hasNext = true;
  let errors = [];

  while (hasNext) {
    try {
      const agents = scrapeCurrentTable();
      allAgents = allAgents.concat(agents);

      // Try to go to next page
      const nextBtn = findBySelectors(SELECTORS.nextPageButton);
      if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled') &&
          !nextBtn.parentElement?.classList.contains('disabled')) {
        nextBtn.click();
        await waitForLoad(3000);
        pageNum++;
      } else {
        hasNext = false;
      }
    } catch (err) {
      errors.push({ page: pageNum, error: err.message });
      hasNext = false; // Stop on error
    }

    // Safety: max 100 pages
    if (pageNum > 100) break;
  }

  return {
    agents: allAgents,
    pages: pageNum,
    totalAgents: allAgents.length,
    errors: errors.length > 0 ? errors : undefined
  };
}

function scrapeCurrentTable() {
  const table = findBySelectors(SELECTORS.agentTable);
  if (!table) return [];

  const results = [];
  const rows = table.querySelectorAll('tbody tr');

  // If no tbody, fallback to all tr except header
  const rowList = rows.length > 0 ? rows : table.querySelectorAll('tr:not(:first-child)');

  for (const row of rowList) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue; // Need at minimum: code, name, status

    // Try to detect column layout dynamically
    const agentCode = extractAgentCode(cells);
    if (!agentCode) continue;

    results.push({
      agentCode,
      agentName: cells[1]?.textContent?.trim() || '',
      agentAddress: cells.length > 3 ? cells[2]?.textContent?.trim() : '',
      agentCity: cells.length > 4 ? cells[3]?.textContent?.trim() : '',
      agentStatus: extractAgentStatus(cells),
      ticketingAuthority: extractTicketingAuthority(cells)
    });
  }

  return results;
}

function extractAgentCode(cells) {
  // Look for a cell containing what looks like an IATA code (7-8 digits)
  for (let i = 0; i < Math.min(cells.length, 3); i++) {
    const text = cells[i]?.textContent?.trim();
    if (text && /^\d{7,8}$/.test(text.replace(/[-\s]/g, ''))) {
      return text.replace(/[-\s]/g, '');
    }
  }
  // Fallback: first cell if it's at least 3 chars
  const first = cells[0]?.textContent?.trim();
  return (first && first.length >= 3) ? first : null;
}

function extractAgentStatus(cells) {
  // Look for Active/Inactive in any cell
  for (let i = Math.max(0, cells.length - 4); i < cells.length; i++) {
    const text = cells[i]?.textContent?.trim().toLowerCase();
    if (text === 'active' || text === 'actif') return 'Active';
    if (text === 'inactive' || text === 'inactif') return 'Inactive';
    if (text === 'default') return 'Default';
  }
  return 'Unknown';
}

function extractTicketingAuthority(cells) {
  // Check last few cells for TA info
  for (let i = Math.max(0, cells.length - 3); i < cells.length; i++) {
    const result = parseTicketingAuthority(cells[i]);
    if (result !== 'Unknown') return result;
  }
  return 'Unknown';
}

function parseTicketingAuthority(cell) {
  if (!cell) return 'Unknown';

  // Check for checkbox
  const checkbox = cell.querySelector('input[type="checkbox"]');
  if (checkbox) return checkbox.checked ? 'Enabled' : 'Disabled';

  // Check for toggle/switch
  const toggle = cell.querySelector('[class*="toggle"], [class*="switch"]');
  if (toggle) {
    const isOn = toggle.classList.contains('on') || toggle.classList.contains('active') ||
                 toggle.classList.contains('checked') || toggle.getAttribute('aria-checked') === 'true';
    return isOn ? 'Enabled' : 'Disabled';
  }

  // Check for icon/badge
  const badge = cell.querySelector('[class*="enabled"], [class*="active"], .badge, [class*="status"]');
  if (badge) {
    const text = badge.textContent.trim().toLowerCase();
    if (text.includes('enabled') || text.includes('yes') || text.includes('actif') || text.includes('oui')) return 'Enabled';
    if (text.includes('disabled') || text.includes('no') || text.includes('inactif') || text.includes('non')) return 'Disabled';
  }

  // Check for green/red icons
  const greenIcon = cell.querySelector('.text-success, .text-green, [style*="green"], .fa-check, .icon-check');
  if (greenIcon) return 'Enabled';
  const redIcon = cell.querySelector('.text-danger, .text-red, [style*="red"], .fa-times, .icon-close');
  if (redIcon) return 'Disabled';

  // Check raw text content
  const text = cell.textContent.trim().toLowerCase();
  if (text === 'enabled' || text === 'yes' || text === 'oui' || text === 'actif') return 'Enabled';
  if (text === 'disabled' || text === 'no' || text === 'non' || text === 'inactif') return 'Disabled';

  return 'Unknown';
}

// ---- DOM Helpers ----
function findBySelectors(selectorList) {
  for (const sel of selectorList) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) return el; // Visible element
    } catch { /* invalid selector */ }
  }
  // Retry without visibility check
  for (const sel of selectorList) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

function findElementByText(text, tagSelector = '*') {
  const elements = document.querySelectorAll(tagSelector);
  // Exact match first
  for (const el of elements) {
    if (el.textContent.trim() === text) return el;
  }
  // Partial match
  for (const el of elements) {
    if (el.textContent.trim().includes(text)) return el;
  }
  return null;
}

function findByTextOrSelector(selectorList, ...textOptions) {
  // Try selectors first
  const bySelector = findBySelectors(selectorList);
  if (bySelector) return bySelector;

  // Fallback to text search
  for (const text of textOptions) {
    const byText = findElementByText(text, 'a, button, li, [role="tab"], span, div[role="tab"]');
    if (byText) return byText;
  }
  return null;
}

function waitForLoad(maxMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    let mutationCount = 0;
    let timer = null;

    const observer = new MutationObserver(() => {
      mutationCount++;
      // Wait for DOM to settle (no mutations for 500ms)
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve();
        }
      }, 500);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Max timeout
    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve();
      }
    }, maxMs);
  });
}

// Signal that content script is loaded
console.log('[APG BSP Link Extension] Content script loaded on:', window.location.href);
