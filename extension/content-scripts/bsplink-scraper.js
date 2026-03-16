// ============================================================
// APG BSP Link - Content Script
// Injected into BSP Link pages for DOM scraping
// Updated with real BSP Link UI selectors
// ============================================================

// BSP Link is a modern Angular/React-style web app.
// The header shows: "BSPlink - Efficient | COUNTRY_NAME (XX)"
// Top nav: DASHBOARDS, MY AIRLINE, ADM/ACM, REFUND, DOCUMENTS, FILES, MASTER DATA, TIP
// Secondary nav (under SETTINGS): Properties, Configuration, Ticketing Authority, RA/RN, ADM/ACM
// User info top-right: "APG DS / Airline"

const SELECTORS = {
  // ---- Login detection ----
  // BSP Link login page indicators
  loginIndicators: [
    'input[type="password"]',
    'form[action*="login"]',
    'form[action*="auth"]',
    '#loginForm',
    '.login-form',
    'input[name="username"]',
    'input[name="j_username"]',
    'button[type="submit"]',
    '[class*="login-container"]',
    '[class*="login-page"]'
  ],

  // Elements visible when logged in on BSP Link
  loggedInIndicators: [
    // Top navigation bar items (dark blue nav)
    'a[href*="dashboard"]',
    'a[href*="Dashboard"]',
    '[routerlink*="dashboard"]',
    // Nav items specific to BSP Link
    'a[href*="adm-acm"]',
    'a[href*="refund"]',
    'a[href*="master-data"]',
    'a[href*="masterData"]',
    // User menu in top-right
    '[class*="user-info"]',
    '[class*="user-profile"]',
    '[class*="userInfo"]',
    '[class*="navbar-user"]',
    // Logout link
    'a[href*="logout"]',
    'button[class*="logout"]',
    '[class*="sign-out"]',
    // The main navigation bar itself
    'nav.navbar',
    '.navbar',
    '[class*="main-nav"]',
    '[class*="top-nav"]',
    '[class*="header-nav"]'
  ],

  // ---- Primary navigation (top dark blue bar) ----
  // Items: DASHBOARDS, MY AIRLINE, ADM/ACM, REFUND, DOCUMENTS, FILES, MASTER DATA, TIP
  primaryNav: [
    'nav a',
    'nav li a',
    '.navbar a',
    '.navbar-nav a',
    '.navbar-nav .nav-link',
    '[class*="main-nav"] a',
    '[class*="top-nav"] a',
    '[class*="header-nav"] a',
    '[class*="nav-item"] a',
    'ul.nav > li > a'
  ],

  // ---- SETTINGS tab (secondary navigation) ----
  // "SETTINGS" appears as a tab in the sub-nav, highlighted in yellow when active
  // Clicking it reveals sub-tabs: Properties, Configuration, Ticketing Authority, etc.
  settingsTab: [
    // Direct href-based selectors
    'a[href*="settings"]',
    'a[href*="Settings"]',
    'a[href*="/settings"]',
    '[routerlink*="settings"]',
    '[routerlink*="Settings"]',
    // Nav tab/pill patterns (Bootstrap-style)
    '.nav-tabs a[href*="settings"]',
    '.nav-pills a[href*="settings"]',
    '.nav-link[href*="settings"]',
    // Tab-specific attributes
    '[data-tab="settings"]',
    '[data-target*="settings"]',
    '[role="tab"][id*="settings"]',
    '#settingsTab',
    '#tab-settings',
    // Menu item patterns
    'li.nav-item a[href*="settings"]',
    '.menu-item a[href*="settings"]',
    // My Airline sub-menu (Settings is often under MY AIRLINE)
    'a[href*="my-airline"] + ul a[href*="settings"]',
    'a[href*="myAirline"] + ul a[href*="settings"]'
  ],

  // ---- Ticketing Authority tab (sub-tab under SETTINGS) ----
  // Shows as a tab labeled "Ticketing Authority" below the SETTINGS section
  ticketingAuthorityTab: [
    // Direct href patterns
    'a[href*="ticketing-authority"]',
    'a[href*="ticketingAuthority"]',
    'a[href*="TicketingAuthority"]',
    'a[href*="ticketing_authority"]',
    'a[href*="ta-management"]',
    'a[href*="taManagement"]',
    // RouterLink patterns (Angular)
    '[routerlink*="ticketing-authority"]',
    '[routerlink*="ticketingAuthority"]',
    '[routerlink*="TicketingAuthority"]',
    // Tab-specific patterns
    '.nav-tabs a[href*="ticketing"]',
    '.nav-pills a[href*="ticketing"]',
    '[data-tab="ticketing-authority"]',
    '[data-tab="ticketingAuthority"]',
    '[role="tab"][id*="ticketing"]',
    '#ticketingAuthorityTab',
    '#tab-ticketing-authority',
    // Sub-navigation under Settings
    '.tab-content a[href*="ticketing"]',
    '.sub-nav a[href*="ticketing"]',
    '[class*="settings-tabs"] a[href*="ticketing"]',
    '[class*="settings-nav"] a[href*="ticketing"]',
    '[class*="sub-tab"] a[href*="ticketing"]'
  ],

  // ---- Agent table ----
  // Table with columns: Agent Code | Agent Name | Agent Address | Agent City | Agent Status | Ticketing Authority Management
  // Has blue/dark header, standard HTML table with <thead>/<tbody>
  agentTable: [
    // Specific table identifiers
    'table[class*="agent"]',
    'table[class*="Agent"]',
    'table[id*="agent"]',
    'table[id*="Agent"]',
    'table[class*="ticketing"]',
    'table[class*="Ticketing"]',
    // Common data table patterns (BSP Link uses Bootstrap-style tables)
    'table.table',
    'table.table-striped',
    'table.table-bordered',
    'table.table-hover',
    'table.dataTable',
    'table[class*="data-table"]',
    'table[class*="grid-table"]',
    // Angular Material / PrimeNG table patterns
    'p-table table',
    'mat-table',
    '[class*="p-datatable"] table',
    '[class*="mat-table"]',
    'cdk-table',
    // Content area table
    '.tab-content table',
    '.card-body table',
    '.panel-body table',
    '[class*="content"] table',
    '[class*="list-agents"] table',
    // Generic fallback (last resort)
    'table'
  ],

  // ---- Pagination ----
  // Standard pagination at bottom of agent table
  nextPageButton: [
    // Angular paginator
    'button[aria-label="Next page"]',
    'button[aria-label="Next"]',
    '[class*="paginator"] button:last-child',
    'mat-paginator button[aria-label*="next" i]',
    // Bootstrap pagination
    '.pagination .page-item:last-child .page-link',
    '.pagination .page-item.next .page-link',
    '.pagination li:last-child a',
    '.pagination .next a',
    '.pagination-next a',
    'a[aria-label="Next"]',
    'li.next a',
    'a.next',
    'button.next',
    'a[rel="next"]',
    // PrimeNG paginator
    '.p-paginator-next',
    'button[class*="paginator-next"]',
    '[class*="paginator"] .p-paginator-next',
    // DataTables
    '.paging_next',
    '.dataTables_paginate .next',
    // Icon-based next buttons (chevron/arrow)
    'button[class*="next-page"]',
    '[class*="pagination"] button[class*="next"]',
    '[class*="pagination"] [class*="arrow-right"]',
    '[class*="pagination"] [class*="chevron-right"]'
  ],

  // ---- Country selector ----
  // BSP Link header: "BSPlink - Efficient | COUNTRY_NAME (XX)"
  // Globe icon or dropdown in header for switching countries
  countrySelector: [
    // Select/dropdown patterns
    'select[name*="country" i]',
    'select[name*="bsp" i]',
    'select[id*="country" i]',
    'select[id*="bsp" i]',
    'select[class*="country" i]',
    'select[class*="bsp" i]',
    '#countrySelector',
    '#bspSelector',
    // Globe icon / country switcher in header
    '[class*="globe"]',
    '[class*="country-switch"]',
    '[class*="countrySwitcher"]',
    '[class*="country-selector"]',
    '[class*="bsp-selector"]',
    '[class*="bsp-switch"]',
    // Angular Material select
    'mat-select[class*="country" i]',
    'mat-select[formcontrolname*="country" i]',
    'mat-select[formcontrolname*="bsp" i]',
    // Dropdown/popover triggers in header area
    '.navbar [class*="dropdown"]',
    'nav [class*="dropdown"]',
    '[class*="header"] [class*="dropdown"]',
    // Font Awesome / Material icon for globe
    '.fa-globe',
    '.material-icons:contains("language")',
    'i[class*="globe"]',
    'mat-icon[class*="globe"]',
    '[class*="header"] button[class*="country"]',
    '[class*="header"] a[class*="country"]'
  ],

  // ---- Current country in header ----
  // Header text: "BSPlink - Efficient | COUNTRY_NAME (XX)"
  countryHeader: [
    // The main brand/header title area
    '.navbar-brand',
    '[class*="brand"]',
    '[class*="header-title"]',
    '[class*="header-brand"]',
    '[class*="app-title"]',
    '[class*="app-header"] span',
    '[class*="app-header"] div',
    // Title/heading elements in header
    'nav .navbar-brand',
    'header .navbar-brand',
    '[class*="toolbar-title"]',
    '[class*="toolbar"] span',
    // BSP Link specific patterns
    '[class*="bsp-header"]',
    '[class*="bsplink"]',
    '[class*="BSPlink"]',
    // Angular Material toolbar
    'mat-toolbar span',
    'mat-toolbar div',
    // Broader fallbacks
    'header h1',
    'header h2',
    'header span',
    '.header h1',
    '.header h2',
    '.header span',
    'h1',
    'h2'
  ],

  // ---- Filter/Download buttons on Ticketing Authority page ----
  filterButton: [
    'button[class*="filter" i]',
    'button:has(> [class*="filter" i])',
    '[class*="filter-btn"]',
    'button[aria-label*="filter" i]',
    'button[title*="filter" i]'
  ],
  downloadButton: [
    'button[class*="download" i]',
    'button[class*="export" i]',
    'a[class*="download" i]',
    'button[aria-label*="download" i]',
    'button[title*="download" i]',
    'button:has(> [class*="download" i])'
  ],
  resetFilters: [
    'a[class*="reset" i]',
    'button[class*="reset" i]',
    '[class*="reset-filter"]',
    'a:contains("Reset")',
    'span[class*="reset"]'
  ]
};

// Column indices for the agent table (0-based)
// Agent Code | Agent Name | Agent Address | Agent City | Agent Status | Ticketing Authority Management
const COLUMN_MAP = {
  agentCode: 0,
  agentName: 1,
  agentAddress: 2,
  agentCity: 3,
  agentStatus: 4,
  ticketingAuthority: 5
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
    case 'DEBUG_DOM':
      return debugDomStructure();
    default:
      return { error: 'Unknown message type' };
  }
}

// ---- Login Detection ----
function checkLoginStatus() {
  const url = window.location.href;

  const hasLoginForm = SELECTORS.loginIndicators.some(sel => {
    try { return !!document.querySelector(sel); } catch { return false; }
  });

  const hasLoggedInUI = SELECTORS.loggedInIndicators.some(sel => {
    try { return !!document.querySelector(sel); } catch { return false; }
  });

  const isLoginUrl = /login|signin|auth|sso/i.test(url);

  // BSP Link specific: if we see the header pattern, we are logged in
  const headerCountry = detectCurrentCountry();
  const hasBspHeader = !!headerCountry;

  const isLoggedIn = (hasLoggedInUI || hasBspHeader) && !hasLoginForm && !isLoginUrl;

  return {
    isLoggedIn,
    hasLoginForm,
    hasLoggedInUI,
    hasBspHeader,
    isLoginUrl,
    currentUrl: url,
    pageTitle: document.title,
    detectedCountry: headerCountry
  };
}

function getPageInfo() {
  const country = detectCurrentCountry();
  const table = findBySelectors(SELECTORS.agentTable);
  const rowCount = countTableRows();

  return {
    url: window.location.href,
    title: document.title,
    country,
    hasTable: !!table,
    tableRowCount: rowCount,
    isLoggedIn: checkLoginStatus().isLoggedIn,
    isOnTicketingAuthority: isTicketingAuthorityPage(),
    tableHeaders: table ? getTableHeaders(table) : []
  };
}

function isTicketingAuthorityPage() {
  const url = window.location.href.toLowerCase();
  if (/ticketing.?authority|ta.?management/i.test(url)) return true;

  // Check if page contains "List of agents in your BSP" text
  const bodyText = document.body?.innerText || '';
  if (bodyText.includes('List of agents in your BSP')) return true;
  if (bodyText.includes('Ticketing Authority Management')) return true;

  return false;
}

function getTableHeaders(table) {
  const headers = [];
  const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
  headerCells.forEach(cell => {
    headers.push(cell.textContent.trim());
  });
  return headers;
}

function countTableRows() {
  const table = findBySelectors(SELECTORS.agentTable);
  if (!table) return 0;
  const tbody = table.querySelector('tbody');
  if (tbody) return tbody.querySelectorAll('tr').length;
  return table.querySelectorAll('tr').length - 1; // minus header row
}

// ---- Navigation ----
async function navigateToTicketingAuthority() {
  // If already on the Ticketing Authority page, just report success
  if (isTicketingAuthorityPage()) {
    const table = findBySelectors(SELECTORS.agentTable);
    return {
      success: !!table,
      hasTable: !!table,
      rowCount: countTableRows(),
      currentUrl: window.location.href,
      country: detectCurrentCountry(),
      alreadyOnPage: true
    };
  }

  // Step 1: Click SETTINGS in the primary/secondary navigation
  const settingsEl = findByTextOrSelector(
    SELECTORS.settingsTab,
    'SETTINGS', 'Settings', 'settings', 'Paramètres', 'PARAMÈTRES'
  );
  if (settingsEl) {
    console.log('[APG] Clicking SETTINGS tab:', settingsEl.textContent.trim());
    settingsEl.click();
    await waitForLoad(5000);
  } else {
    console.warn('[APG] SETTINGS tab not found by selector, trying text-only search...');
    // Broader text search across nav elements
    const settingsLink = findNavItemByText('SETTINGS', 'Settings');
    if (settingsLink) {
      console.log('[APG] Found SETTINGS via text search:', settingsLink.textContent.trim());
      settingsLink.click();
      await waitForLoad(5000);
    }
  }

  // Step 2: Click "Ticketing Authority" sub-tab
  // Wait a moment for sub-tabs to render
  await sleep(1000);

  const taEl = findByTextOrSelector(
    SELECTORS.ticketingAuthorityTab,
    'Ticketing Authority', 'TICKETING AUTHORITY',
    'Ticketing authority', 'TA Management',
    'Autorité de billetterie'
  );
  if (taEl) {
    console.log('[APG] Clicking Ticketing Authority tab:', taEl.textContent.trim());
    taEl.click();
    await waitForLoad(5000);
  } else {
    console.warn('[APG] Ticketing Authority tab not found by selector, trying text-only...');
    const taLink = findNavItemByText('Ticketing Authority', 'TICKETING AUTHORITY', 'Ticketing');
    if (taLink) {
      console.log('[APG] Found Ticketing Authority via text:', taLink.textContent.trim());
      taLink.click();
      await waitForLoad(5000);
    }
  }

  // Wait for table to appear
  await waitForElement(SELECTORS.agentTable, 10000);

  const table = findBySelectors(SELECTORS.agentTable);
  const rowCount = countTableRows();

  return {
    success: !!table,
    hasTable: !!table,
    rowCount,
    currentUrl: window.location.href,
    country: detectCurrentCountry(),
    settingsFound: !!settingsEl,
    taFound: !!taEl,
    isOnTicketingAuthority: isTicketingAuthorityPage()
  };
}

// Find a navigation item by text content across common nav patterns
function findNavItemByText(...textOptions) {
  const navSelectors = [
    'nav a', '.navbar a', '.nav a', '.nav-tabs a', '.nav-pills a',
    '[class*="nav"] a', '[class*="menu"] a', '[class*="tab"] a',
    'ul.nav a', 'ul.nav-tabs a', 'ul.nav-pills a',
    'a.nav-link', 'a[role="tab"]', '[role="tablist"] a',
    'mat-tab-header a', '[class*="mat-tab"] a'
  ];

  for (const text of textOptions) {
    for (const selector of navSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const elText = el.textContent.trim();
          if (elText === text || elText.toUpperCase() === text.toUpperCase()) {
            return el;
          }
        }
      } catch { /* skip */ }
    }
  }
  return null;
}

// ---- Country Detection ----
function detectCurrentCountry() {
  // Strategy 1: Parse header "BSPlink - Efficient | COUNTRY_NAME (XX)"
  for (const selector of SELECTORS.countryHeader) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        const text = el.textContent;
        // Match pattern: (XX) where XX is 2 uppercase letters
        const match = text.match(/\(([A-Z]{2})\)/);
        if (match) return match[1];
        // Also try: "BSPlink" followed by country code pattern
        const bspMatch = text.match(/BSPlink.*?\(([A-Z]{2})\)/i);
        if (bspMatch) return bspMatch[1];
      }
    } catch { /* skip invalid selectors */ }
  }

  // Strategy 2: Search the entire top header area
  const headerAreas = document.querySelectorAll(
    'header, nav, .navbar, [class*="header"], [class*="toolbar"], [class*="app-bar"]'
  );
  for (const area of headerAreas) {
    const match = area.textContent.match(/BSPlink[^(]*\(([A-Z]{2})\)/i);
    if (match) return match[1];
    // Fallback: any (XX) pattern in header
    const fallback = area.textContent.match(/\(([A-Z]{2})\)/);
    if (fallback) return fallback[1];
  }

  // Strategy 3: Page title
  const titleMatch = document.title.match(/\(([A-Z]{2})\)/);
  if (titleMatch) return titleMatch[1];
  const titleBsp = document.title.match(/BSPlink[^(]*\(([A-Z]{2})\)/i);
  if (titleBsp) return titleBsp[1];

  // Strategy 4: URL params
  const urlParams = new URLSearchParams(window.location.search);
  for (const key of ['country', 'bsp', 'countryCode', 'cc', 'bspCode']) {
    const val = urlParams.get(key);
    if (val && /^[A-Z]{2}$/i.test(val)) return val.toUpperCase();
  }

  // Strategy 5: URL path segment (e.g., /bsp/AE/...)
  const pathMatch = window.location.pathname.match(/\/bsp\/([A-Z]{2})\//i);
  if (pathMatch) return pathMatch[1].toUpperCase();

  return null;
}

// ---- Country Switching ----
async function switchCountry(targetCode) {
  const current = detectCurrentCountry();
  if (current === targetCode) {
    return { success: true, alreadyOnCountry: true, country: current };
  }

  // Strategy 1: Try <select> dropdown
  const select = findBySelectors(SELECTORS.countrySelector);
  if (select && select.tagName === 'SELECT') {
    const option = Array.from(select.options).find(
      opt => opt.value.includes(targetCode) || opt.text.includes(targetCode)
    );
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      select.dispatchEvent(new Event('input', { bubbles: true }));
      // Try submitting parent form
      const form = select.closest('form');
      if (form) {
        const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
        if (submitBtn) submitBtn.click();
        else form.submit();
      }
      await waitForLoad(8000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'select' };
    }
  }

  // Strategy 2: Click globe icon or country switcher to open dropdown, then select country
  const globeIcon = findBySelectors(SELECTORS.countrySelector);
  if (globeIcon && globeIcon.tagName !== 'SELECT') {
    globeIcon.click();
    await sleep(1500); // Wait for dropdown/modal to appear

    // Now look for the country in the opened dropdown/modal
    const countryOption = findElementByText(
      targetCode,
      'a, li, button, [role="option"], [role="menuitem"], mat-option, .dropdown-item, option'
    );
    if (countryOption) {
      countryOption.click();
      await waitForLoad(8000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'globe-dropdown' };
    }

    // Try searching by full country name pattern: "COUNTRY_NAME (XX)"
    const countryByPattern = findElementByText(
      `(${targetCode})`,
      'a, li, button, [role="option"], [role="menuitem"], mat-option, .dropdown-item'
    );
    if (countryByPattern) {
      countryByPattern.click();
      await waitForLoad(8000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'globe-dropdown-pattern' };
    }
  }

  // Strategy 3: Angular Material select (mat-select)
  const matSelect = document.querySelector('mat-select[class*="country" i], mat-select[class*="bsp" i]');
  if (matSelect) {
    matSelect.click();
    await sleep(1000);
    const matOption = findElementByText(targetCode, 'mat-option, .mat-option');
    if (matOption) {
      matOption.click();
      await waitForLoad(8000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'mat-select' };
    }
  }

  // Strategy 4: URL-based navigation
  const currentUrl = new URL(window.location.href);
  // Try replacing country code in URL path
  const pathReplaced = currentUrl.pathname.replace(/\/[A-Z]{2}\//, `/${targetCode}/`);
  if (pathReplaced !== currentUrl.pathname) {
    window.location.href = currentUrl.origin + pathReplaced + currentUrl.search;
    await waitForLoad(10000);
    const newCountry = detectCurrentCountry();
    return { success: newCountry === targetCode, country: newCountry, method: 'url-path' };
  }

  // Try URL query param
  for (const param of ['country', 'bsp', 'countryCode', 'cc']) {
    if (currentUrl.searchParams.has(param)) {
      currentUrl.searchParams.set(param, targetCode);
      window.location.href = currentUrl.toString();
      await waitForLoad(10000);
      const newCountry = detectCurrentCountry();
      return { success: newCountry === targetCode, country: newCountry, method: 'url-param' };
    }
  }

  return {
    success: false,
    error: `Cannot find country selector for ${targetCode}`,
    currentCountry: current,
    triedMethods: ['select', 'globe-dropdown', 'mat-select', 'url']
  };
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
      if (agents.length === 0 && pageNum > 1) {
        // Empty page likely means we've gone past the end
        hasNext = false;
        break;
      }
      allAgents = allAgents.concat(agents);

      // Try to go to next page
      const nextBtn = findNextPageButton();
      if (nextBtn) {
        nextBtn.click();
        await waitForLoad(3000);
        // Wait for table content to update
        await sleep(500);
        pageNum++;
      } else {
        hasNext = false;
      }
    } catch (err) {
      errors.push({ page: pageNum, error: err.message });
      hasNext = false;
    }

    // Safety: max 200 pages
    if (pageNum > 200) break;
  }

  return {
    agents: allAgents,
    pages: pageNum,
    totalAgents: allAgents.length,
    errors: errors.length > 0 ? errors : undefined,
    country: detectCurrentCountry()
  };
}

function findNextPageButton() {
  for (const sel of SELECTORS.nextPageButton) {
    try {
      const el = document.querySelector(sel);
      if (el && !isDisabledPaginationButton(el)) return el;
    } catch { /* skip */ }
  }
  return null;
}

function isDisabledPaginationButton(el) {
  if (el.disabled) return true;
  if (el.classList.contains('disabled')) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (el.parentElement?.classList.contains('disabled')) return true;
  // Check for Bootstrap disabled state
  if (el.closest('.page-item')?.classList.contains('disabled')) return true;
  // Check for pointer-events: none style
  const style = window.getComputedStyle(el);
  if (style.pointerEvents === 'none') return true;
  return false;
}

function scrapeCurrentTable() {
  const table = findBySelectors(SELECTORS.agentTable);
  if (!table) return [];

  const results = [];

  // Detect column mapping from headers
  const columnMap = detectColumnMapping(table);

  // Get data rows
  const tbody = table.querySelector('tbody');
  const rows = tbody
    ? tbody.querySelectorAll('tr')
    : table.querySelectorAll('tr:not(:first-child)');

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 3) continue; // Need minimum columns

    const agentCode = extractAgentCode(cells, columnMap);
    if (!agentCode) continue; // Skip rows without valid agent code

    results.push({
      agentCode,
      agentName: getCellText(cells, columnMap.agentName, 1),
      agentAddress: getCellText(cells, columnMap.agentAddress, 2),
      agentCity: getCellText(cells, columnMap.agentCity, 3),
      agentStatus: extractAgentStatus(cells, columnMap),
      ticketingAuthority: extractTicketingAuthority(cells, columnMap)
    });
  }

  return results;
}

function detectColumnMapping(table) {
  const mapping = { ...COLUMN_MAP };
  const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');

  if (headerCells.length === 0) return mapping;

  headerCells.forEach((cell, index) => {
    const text = cell.textContent.trim().toLowerCase();
    if (text.includes('agent code') || text.includes('code agent')) {
      mapping.agentCode = index;
    } else if (text.includes('agent name') || text.includes('nom agent') || text.includes('name')) {
      mapping.agentName = index;
    } else if (text.includes('address') || text.includes('adresse')) {
      mapping.agentAddress = index;
    } else if (text.includes('city') || text.includes('ville')) {
      mapping.agentCity = index;
    } else if (text.includes('agent status') || text.includes('status') || text.includes('statut')) {
      mapping.agentStatus = index;
    } else if (text.includes('ticketing authority') || text.includes('ta management') ||
               text.includes('autorité')) {
      mapping.ticketingAuthority = index;
    }
  });

  return mapping;
}

function getCellText(cells, mappedIndex, fallbackIndex) {
  const idx = mappedIndex !== undefined ? mappedIndex : fallbackIndex;
  if (idx >= 0 && idx < cells.length) {
    return cells[idx]?.textContent?.trim() || '';
  }
  return '';
}

function extractAgentCode(cells, columnMap) {
  // Try mapped column first
  const idx = columnMap.agentCode !== undefined ? columnMap.agentCode : 0;
  if (idx < cells.length) {
    const text = cells[idx]?.textContent?.trim();
    if (text && /^\d{7,8}$/.test(text.replace(/[-\s]/g, ''))) {
      return text.replace(/[-\s]/g, '');
    }
  }

  // Fallback: scan first 3 columns for IATA agent code pattern (7-8 digits)
  for (let i = 0; i < Math.min(cells.length, 3); i++) {
    const text = cells[i]?.textContent?.trim();
    if (text && /^\d{7,8}$/.test(text.replace(/[-\s]/g, ''))) {
      return text.replace(/[-\s]/g, '');
    }
  }

  // Last resort: first cell with at least 3 chars
  const first = cells[0]?.textContent?.trim();
  return (first && first.length >= 3) ? first : null;
}

function extractAgentStatus(cells, columnMap) {
  // Try mapped column first
  const idx = columnMap.agentStatus !== undefined ? columnMap.agentStatus : COLUMN_MAP.agentStatus;
  if (idx < cells.length) {
    const text = cells[idx]?.textContent?.trim().toLowerCase();
    if (text === 'active' || text === 'actif') return 'Active';
    if (text === 'inactive' || text === 'inactif') return 'Inactive';
    if (text === 'default') return 'Default';
  }

  // Fallback: scan cells from the right
  for (let i = Math.max(0, cells.length - 4); i < cells.length; i++) {
    const text = cells[i]?.textContent?.trim().toLowerCase();
    if (text === 'active' || text === 'actif') return 'Active';
    if (text === 'inactive' || text === 'inactif') return 'Inactive';
    if (text === 'default') return 'Default';
  }

  return 'Unknown';
}

function extractTicketingAuthority(cells, columnMap) {
  // Try mapped column first (last column typically)
  const idx = columnMap.ticketingAuthority !== undefined
    ? columnMap.ticketingAuthority
    : COLUMN_MAP.ticketingAuthority;

  if (idx < cells.length) {
    const result = parseTicketingAuthority(cells[idx]);
    if (result !== 'Unknown') return result;
  }

  // Fallback: check last 3 cells
  for (let i = Math.max(0, cells.length - 3); i < cells.length; i++) {
    const result = parseTicketingAuthority(cells[i]);
    if (result !== 'Unknown') return result;
  }

  return 'Unknown';
}

function parseTicketingAuthority(cell) {
  if (!cell) return 'Unknown';

  // Check for checkbox (BSP Link shows checkbox + "Enabled"/"Disabled" text)
  const checkbox = cell.querySelector('input[type="checkbox"]');
  if (checkbox) return checkbox.checked ? 'Enabled' : 'Disabled';

  // Check for Angular Material checkbox
  const matCheckbox = cell.querySelector('mat-checkbox, [class*="mat-checkbox"]');
  if (matCheckbox) {
    const isChecked = matCheckbox.classList.contains('mat-checkbox-checked') ||
                      matCheckbox.querySelector('input[type="checkbox"]')?.checked;
    return isChecked ? 'Enabled' : 'Disabled';
  }

  // Check for toggle/switch
  const toggle = cell.querySelector(
    '[class*="toggle"], [class*="switch"], [class*="slider"], mat-slide-toggle'
  );
  if (toggle) {
    const isOn = toggle.classList.contains('on') ||
                 toggle.classList.contains('active') ||
                 toggle.classList.contains('checked') ||
                 toggle.classList.contains('mat-checked') ||
                 toggle.getAttribute('aria-checked') === 'true';
    return isOn ? 'Enabled' : 'Disabled';
  }

  // Check for icon/badge with status
  const badge = cell.querySelector(
    '[class*="enabled"], [class*="active"], .badge, [class*="status"], ' +
    '[class*="chip"], .mat-chip, [class*="tag"], .label'
  );
  if (badge) {
    const text = badge.textContent.trim().toLowerCase();
    if (text.includes('enabled') || text.includes('yes') || text.includes('actif') || text.includes('oui')) return 'Enabled';
    if (text.includes('disabled') || text.includes('no') || text.includes('inactif') || text.includes('non')) return 'Disabled';
  }

  // Check for green/red icons (check mark / X)
  const greenIcon = cell.querySelector(
    '.text-success, .text-green, [style*="green"], .fa-check, .fa-check-circle, ' +
    '.icon-check, .mat-icon[color="primary"], .material-icons'
  );
  if (greenIcon) {
    const iconText = greenIcon.textContent.trim().toLowerCase();
    if (iconText === 'check' || iconText === 'check_circle' || iconText === 'done') return 'Enabled';
  }
  const redIcon = cell.querySelector(
    '.text-danger, .text-red, [style*="red"], .fa-times, .fa-times-circle, ' +
    '.icon-close, .mat-icon[color="warn"]'
  );
  if (redIcon) return 'Disabled';

  // Check raw text content
  const text = cell.textContent.trim().toLowerCase();
  if (text === 'enabled' || text.includes('enabled')) return 'Enabled';
  if (text === 'disabled' || text.includes('disabled')) return 'Disabled';
  if (text === 'yes' || text === 'oui' || text === 'actif') return 'Enabled';
  if (text === 'no' || text === 'non' || text === 'inactif') return 'Disabled';

  return 'Unknown';
}

// ---- DOM Helpers ----
function findBySelectors(selectorList) {
  // First pass: visible elements only
  for (const sel of selectorList) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    } catch { /* invalid selector */ }
  }
  // Second pass: any matching element
  for (const sel of selectorList) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

function isVisible(el) {
  if (!el) return false;
  // offsetParent is null for hidden elements (except body/fixed)
  if (el.offsetParent === null && el.tagName !== 'BODY' &&
      window.getComputedStyle(el).position !== 'fixed') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function findElementByText(text, tagSelector = '*') {
  const elements = document.querySelectorAll(tagSelector);
  const lowerText = text.toLowerCase();

  // Exact match first
  for (const el of elements) {
    if (el.textContent.trim() === text) return el;
  }
  // Case-insensitive exact match
  for (const el of elements) {
    if (el.textContent.trim().toLowerCase() === lowerText) return el;
  }
  // Partial match (contains)
  for (const el of elements) {
    if (el.textContent.trim().toLowerCase().includes(lowerText)) return el;
  }
  return null;
}

function findByTextOrSelector(selectorList, ...textOptions) {
  // Try selectors first
  const bySelector = findBySelectors(selectorList);
  if (bySelector) return bySelector;

  // Fallback to text search in navigation elements
  const navTagSelector = [
    'a', 'button', 'li', '[role="tab"]', 'span[role="tab"]',
    'div[role="tab"]', '.nav-link', '.nav-item a',
    'mat-tab', '[class*="tab"]'
  ].join(', ');

  for (const text of textOptions) {
    const byText = findElementByText(text, navTagSelector);
    if (byText) return byText;
  }
  return null;
}

function waitForLoad(maxMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;
    let timer = null;

    const observer = new MutationObserver(() => {
      // Reset settle timer on each mutation
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

    // If no mutations happen within 1s, resolve early
    timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve();
      }
    }, 1500);
  });
}

function waitForElement(selectorList, maxMs = 10000) {
  return new Promise((resolve) => {
    // Check if element already exists
    const existing = findBySelectors(selectorList);
    if (existing) { resolve(existing); return; }

    let resolved = false;

    const observer = new MutationObserver(() => {
      const el = findBySelectors(selectorList);
      if (el && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve(null);
      }
    }, maxMs);
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---- Debug Helper ----
// Returns DOM structure info to help diagnose selector issues
function debugDomStructure() {
  const info = {
    url: window.location.href,
    title: document.title,
    bodyClasses: document.body?.className || '',
    detectedCountry: detectCurrentCountry()
  };

  // Check for Angular/React/Vue indicators
  info.framework = {
    angular: !!document.querySelector('[ng-version], [_nghost], [_ngcontent]'),
    react: !!document.querySelector('[data-reactroot], [data-reactid]'),
    vue: !!document.querySelector('[data-v-], [data-vue]')
  };

  // Sample navigation structure
  info.navElements = [];
  const navLinks = document.querySelectorAll('nav a, .navbar a, [class*="nav"] a');
  navLinks.forEach(a => {
    if (info.navElements.length < 20) {
      info.navElements.push({
        text: a.textContent.trim().substring(0, 50),
        href: a.getAttribute('href'),
        classes: a.className.substring(0, 100)
      });
    }
  });

  // Check for tables
  info.tables = [];
  document.querySelectorAll('table').forEach((table, i) => {
    if (i < 5) {
      const headers = [];
      table.querySelectorAll('thead th, tr:first-child th').forEach(th => {
        headers.push(th.textContent.trim().substring(0, 30));
      });
      info.tables.push({
        classes: table.className,
        id: table.id,
        headers,
        rowCount: table.querySelectorAll('tbody tr, tr').length
      });
    }
  });

  // Header text (for country detection)
  info.headerTexts = [];
  document.querySelectorAll('header *, nav *, .navbar *, [class*="header"] *, [class*="toolbar"] *').forEach(el => {
    const text = el.textContent.trim();
    if (text.includes('BSPlink') || text.includes('bsplink') || /\([A-Z]{2}\)/.test(text)) {
      if (info.headerTexts.length < 10) {
        info.headerTexts.push({
          tag: el.tagName,
          text: text.substring(0, 100),
          classes: el.className?.substring?.(0, 80) || ''
        });
      }
    }
  });

  return info;
}

// Signal that content script is loaded
console.log('[APG BSP Link Extension] Content script loaded on:', window.location.href);
