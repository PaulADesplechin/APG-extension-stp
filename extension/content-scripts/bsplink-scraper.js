// ============================================================
// APG BSP Link - Content Script
// Injected into BSP Link pages (www.bsplink.iata.org)
//
// REAL PARCOURS (décrit par l'utilisateur) :
// 1. BSP Link s'ouvre → Language dropdown (ignore) + ISOC (pays) → Submit
// 2. User ID, name, user type, country territory → Submit
// 3. Dashboard "BSP Link Efficiency, Switzerland"
// 4. Master Data → Ticketing Authority History
// 5. Table: Agent Code | Action (Enable/Disable)
// 6. "Switch to another BSP Link account" (globe icon en haut) → nouveau pays
// 7. Répéter pour chaque pays
// ============================================================

const LOG_PREFIX = '[APG BSP]';

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}

// ---- Known message types ----
const BSP_MESSAGE_TYPES = new Set([
  'CHECK_LOGIN',
  'HANDLE_USER_DIALOG',
  'GET_COUNTRY_LIST',
  'SELECT_ISOC_COUNTRY',
  'SUBMIT_ISOC_FORM',
  'NAVIGATE_TO_TICKETING_AUTHORITY',
  'SWITCH_COUNTRY',
  'SCRAPE_ALL_PAGES',
  'SCRAPE_CURRENT_PAGE',
  'GET_CURRENT_COUNTRY',
  'GET_PAGE_INFO',
  'PING',
  'DEBUG_DOM'
]);

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!BSP_MESSAGE_TYPES.has(message.type)) {
    return false; // Let other content scripts handle it
  }

  handleMessage(message).then(sendResponse).catch(err => {
    console.error(LOG_PREFIX, 'Error handling:', message.type, err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_LOGIN':
      return checkLoginStatus();
    case 'HANDLE_USER_DIALOG':
      return await handleUserSelectionDialog();
    case 'GET_COUNTRY_LIST':
      return await getCountryList();
    case 'SELECT_ISOC_COUNTRY':
      return await selectIsocCountry(message.payload?.countryCode);
    case 'SUBMIT_ISOC_FORM':
      return await submitCurrentForm();
    case 'NAVIGATE_TO_TICKETING_AUTHORITY':
      return await navigateToTicketingAuthority();
    case 'SWITCH_COUNTRY':
      return await switchCountry(message.payload?.countryCode);
    case 'SCRAPE_ALL_PAGES':
      return await scrapeAllPages();
    case 'SCRAPE_CURRENT_PAGE':
      return { agents: scrapeCurrentTable() };
    case 'GET_CURRENT_COUNTRY':
      return { country: detectCurrentCountry() };
    case 'GET_PAGE_INFO':
      return getPageInfo();
    case 'PING':
      return { status: 'alive', url: window.location.href, script: 'bsplink-scraper' };
    case 'DEBUG_DOM':
      return debugDomStructure();
    default:
      return false;
  }
}

// ============================================================
//  CHECK LOGIN STATUS
// ============================================================

function checkLoginStatus() {
  const url = window.location.href.toLowerCase();
  const bodyText = document.body?.innerText || '';

  // Check for login form indicators
  const hasLoginForm = !!(
    document.querySelector('input[type="password"]') ||
    document.querySelector('form[action*="login"]') ||
    document.querySelector('#loginForm') ||
    document.querySelector('.login-form') ||
    document.querySelector('input[name="username"]') ||
    document.querySelector('input[name="j_username"]')
  );

  const isLoginUrl = /login|signin|auth|sso/i.test(url);

  // Check if we are on bsplink.iata.org (any page that's not a login page = we're logged in)
  const isBspLinkDomain = url.includes('bsplink.iata.org');

  // Check for ISOC selection page (first page after SSO login)
  // Accept ANY page with a <select> on bsplink domain as logged in
  const hasSelectElement = !!document.querySelector('select');
  const hasIsocSelector = hasSelectElement && (
    bodyText.includes('ISOC') || bodyText.includes('BSP') ||
    bodyText.includes('Country') || bodyText.includes('Submit') ||
    bodyText.includes('Language') || bodyText.includes('Langue') ||
    isBspLinkDomain
  );

  // Check for logged-in indicators
  const hasNavBar = !!(
    document.querySelector('nav') ||
    document.querySelector('.navbar') ||
    document.querySelector('[class*="main-nav"]')
  );

  const hasLoggedInLinks = !!(
    document.querySelector('a[href*="dashboard"]') ||
    document.querySelector('a[href*="master-data"]') ||
    document.querySelector('a[href*="masterData"]') ||
    document.querySelector('a[href*="logout"]') ||
    document.querySelector('[class*="user-info"]') ||
    document.querySelector('[class*="user-profile"]')
  );

  // Check for any form/button on the page (ISOC, user selection)
  const hasForm = !!document.querySelector('form');
  const hasSubmitBtn = !!(
    document.querySelector('button[type="submit"]') ||
    document.querySelector('input[type="submit"]') ||
    document.querySelector('input[value*="Submit" i]')
  );

  const headerCountry = detectCurrentCountry();

  // LIBERAL login detection:
  // If we're on bsplink.iata.org and there's no password field → we're logged in
  // The ISOC page, user selection page, dashboard, etc. are ALL "logged in" states
  const isLoggedIn = (
    (isBspLinkDomain && !hasLoginForm && !isLoginUrl) ||
    (hasLoggedInLinks && !hasLoginForm) ||
    hasIsocSelector ||
    !!headerCountry
  );

  log('Login check:', { isLoggedIn, isBspLinkDomain, hasLoginForm, hasIsocSelector, hasLoggedInLinks, isLoginUrl, hasForm, hasSubmitBtn });

  return {
    isLoggedIn,
    isBspLinkDomain,
    hasLoginForm,
    hasIsocSelector,
    hasLoggedInLinks,
    hasForm,
    hasSubmitBtn,
    isLoginUrl,
    currentUrl: window.location.href,
    pageTitle: document.title,
    detectedCountry: headerCountry,
    pageType: detectPageType()
  };
}

// ============================================================
//  HANDLE USER SELECTION DIALOG (Step 2 from spec)
//  The popup with account table (CH, DE, FR...) + Submit
//  Exact selectors from recorded session
// ============================================================

async function handleUserSelectionDialog() {
  log('Handling user selection dialog...');

  try {
    // Wait for dialog to appear
    const dialog = document.querySelector('#user-select-dialog');
    if (!dialog) {
      log('No #user-select-dialog found — may not be needed');
      return { success: true, skipped: true, reason: 'no dialog' };
    }

    // Action 1: Click radio button of first row
    // Selector: tr:nth-of-type(1) input
    // XPath: //*[@id="user-select-dialog"]/div[2]/div/bspl-user-selection-dialog/div[2]/table/tbody/tr[1]/td[1]/input
    const radio = dialog.querySelector('table tbody tr:first-child td:first-child input') ||
                  dialog.querySelector('tr:nth-of-type(1) input') ||
                  dialog.querySelector('input[type="radio"]');

    if (radio) {
      log('Clicking first radio button');
      radio.click();
      await sleep(500);
    }

    // Action 2: Click Submit
    // Selector: button
    // XPath: //*[@id="user-select-dialog"]/div[2]/div/bspl-user-selection-dialog/button
    const submitBtn = dialog.querySelector('bspl-user-selection-dialog > button') ||
                      dialog.querySelector('button');

    if (submitBtn) {
      log('Clicking Submit:', submitBtn.textContent.trim());
      submitBtn.click();
      await sleep(2000);
    }

    // Action 3: Second dialog Submit (may or may not appear)
    // Selector: button:nth-of-type(1)
    // XPath: //*[@id="user-select-dialog"]/div[2]/div/bspl-user-selection-dialog/div[3]/button[1]
    try {
      await sleep(1500);
      const dialog2 = document.querySelector('#user-select-dialog');
      if (dialog2) {
        const confirm = dialog2.querySelector('bspl-user-selection-dialog div:nth-of-type(3) button:first-of-type') ||
                        dialog2.querySelector('button');
        if (confirm && isVisible(confirm)) {
          log('Clicking second Submit dialog');
          confirm.click();
          await sleep(2000);
        }
      }
    } catch (e) {
      log('No second dialog (expected):', e.message);
    }

    await waitForLoad(10000);
    return { success: true, pageType: detectPageType(), url: window.location.href };

  } catch (e) {
    log('Error in user dialog:', e.message);
    return { success: false, error: e.message };
  }
}

// ============================================================
//  GET COUNTRY LIST (Step 3 from spec)
//  Open globe → read all country options → close without changing
// ============================================================

async function getCountryList() {
  log('Getting country list from globe switch dialog...');

  // Click globe icon in header
  // Selector: bspl-header li:nth-of-type(2) > a
  const globe = document.querySelector('bspl-header li:nth-of-type(2) > a') ||
                document.querySelector('bspl-header nav ul li:nth-of-type(2) a') ||
                findVisibleElementByText(['Switch to another BSPLink account', 'Switch'], 'a, button');

  if (!globe) {
    return { success: false, error: 'Globe icon not found', countries: [] };
  }

  log('Clicking globe icon');
  globe.click();
  await sleep(2000);

  // Click country dropdown to open it
  // Selector: div.dialog-container > div:nth-of-type(1) div.ng-input
  const dropdown = document.querySelector('div.dialog-container > div:nth-of-type(1) div.ng-input') ||
                   document.querySelector('bspl-switch-account-dialog ng-select div.ng-input') ||
                   document.querySelector('ng-select .ng-input') ||
                   document.querySelector('bspl-dialog ng-select');

  if (!dropdown) {
    // Try to close dialog
    const cancel = document.querySelector('bspl-dialog bspl-button:nth-of-type(1) button');
    if (cancel) cancel.click();
    return { success: false, error: 'Country dropdown not found', countries: [] };
  }

  log('Clicking country dropdown');
  dropdown.click();
  await sleep(1500);

  // Read all options
  const options = document.querySelectorAll('ng-select .ng-dropdown-panel .ng-option, .ng-option');
  const countries = [];

  for (const opt of options) {
    const text = opt.textContent.trim();
    if (!text) continue;
    // Parse "SWITZERLAND - CH" → {name, code}
    const parts = text.rsplit ? text.split(' - ') : text.split(' - ');
    const code = parts.length > 1 ? parts[parts.length - 1].trim() : text.substring(0, 2);
    countries.push({ name: text, code: code });
  }

  log('Found', countries.length, 'countries');

  // Close dialog WITHOUT changing — click CANCEL
  // Selector: bspl-dialog bspl-button:nth-of-type(1) button
  try {
    // Press Escape first to close dropdown
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(500);

    const cancel = document.querySelector('bspl-dialog bspl-button:nth-of-type(1) button') ||
                   findVisibleElementByText(['Cancel', 'CANCEL', 'Annuler'], 'button');
    if (cancel) {
      log('Clicking Cancel');
      cancel.click();
    } else {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    await sleep(1000);
  } catch (e) {
    log('Error closing dialog:', e.message);
  }

  return { success: countries.length > 0, countries };
}

// ============================================================
//  DETECT PAGE TYPE
//  Determine what page we're on in BSP Link
// ============================================================

function detectPageType() {
  const url = window.location.href.toLowerCase();
  const bodyText = document.body?.innerText || '';

  if (/login|signin|auth/i.test(url)) return 'login';

  // ISOC selection page
  if (bodyText.includes('ISOC') || (document.querySelector('select') && bodyText.includes('Submit'))) {
    return 'isoc_selection';
  }

  // User selection page (after ISOC)
  if (bodyText.includes('User ID') && bodyText.includes('User Type')) {
    return 'user_selection';
  }

  // Dashboard
  if (bodyText.includes('BSP') && bodyText.includes('Efficiency') || url.includes('dashboard')) {
    return 'dashboard';
  }

  // Ticketing Authority History page
  if (bodyText.includes('Ticketing Authority') || url.includes('ticketing')) {
    return 'ticketing_authority';
  }

  // Master Data section
  if (bodyText.includes('Master Data') || url.includes('master-data') || url.includes('masterData')) {
    return 'master_data';
  }

  return 'unknown';
}

// ============================================================
//  ISOC COUNTRY SELECTION
//  First page after login: Language + ISOC dropdown → Submit
// ============================================================

async function selectIsocCountry(countryCode) {
  log('Selecting ISOC country:', countryCode);

  // Find all <select> elements on the page
  const selects = document.querySelectorAll('select');
  log('Found', selects.length, 'select elements');

  let isocSelect = null;
  let selectedOption = null;

  for (const sel of selects) {
    // Skip language selector (usually smaller, with EN/FR options)
    const options = Array.from(sel.options);
    const isLanguageSelect = options.some(o =>
      o.text.trim() === 'English' || o.text.trim() === 'French' ||
      o.value === 'en' || o.value === 'fr'
    );
    if (isLanguageSelect) {
      log('Skipping language selector');
      continue;
    }

    // Look for ISOC/country selector - has country codes or country names
    const match = options.find(o => {
      const val = (o.value || '').toUpperCase();
      const txt = (o.text || '').toUpperCase();
      return val.includes(countryCode.toUpperCase()) ||
             txt.includes(countryCode.toUpperCase()) ||
             txt.includes(`(${countryCode.toUpperCase()})`);
    });

    if (match) {
      isocSelect = sel;
      selectedOption = match;
      break;
    }
  }

  if (!isocSelect || !selectedOption) {
    // List all available options for debugging
    const allOptions = [];
    for (const sel of selects) {
      Array.from(sel.options).forEach(o => {
        allOptions.push({ value: o.value, text: o.text.trim() });
      });
    }
    return {
      success: false,
      error: `Country ${countryCode} not found in ISOC selector`,
      availableOptions: allOptions.slice(0, 50)
    };
  }

  // Select the option
  isocSelect.value = selectedOption.value;
  isocSelect.dispatchEvent(new Event('change', { bubbles: true }));
  isocSelect.dispatchEvent(new Event('input', { bubbles: true }));

  log('Selected ISOC:', selectedOption.text, '(', selectedOption.value, ')');

  return {
    success: true,
    selectedCountry: selectedOption.text.trim(),
    selectedValue: selectedOption.value
  };
}

// ============================================================
//  SUBMIT CURRENT FORM
//  Click Submit button on ISOC page or User selection page
// ============================================================

async function submitCurrentForm() {
  log('Looking for Submit button...');

  // Find submit button by various selectors
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[value*="Submit" i]',
    'input[value*="Submit" i]',
    'button[value*="OK" i]',
    'input[value*="OK" i]'
  ];

  let submitBtn = null;

  // Try selectors first
  for (const sel of submitSelectors) {
    const el = document.querySelector(sel);
    if (el && isVisible(el)) {
      submitBtn = el;
      break;
    }
  }

  // Try text search
  if (!submitBtn) {
    submitBtn = findVisibleElementByText(
      ['Submit', 'SUBMIT', 'OK', 'Confirm', 'Go', 'Continue', 'Envoyer', 'Valider'],
      'button, input[type="button"], input[type="submit"], a.btn, a.button'
    );
  }

  if (!submitBtn) {
    // Last resort: find any form and submit it
    const form = document.querySelector('form');
    if (form) {
      log('No submit button found, submitting form directly');
      form.submit();
      await waitForLoad(10000);
      return { success: true, method: 'form-submit' };
    }
    return { success: false, error: 'No submit button or form found' };
  }

  log('Clicking submit:', submitBtn.tagName, submitBtn.textContent?.trim() || submitBtn.value);
  submitBtn.click();
  await waitForLoad(10000);

  return {
    success: true,
    method: 'button-click',
    newUrl: window.location.href,
    newPageType: detectPageType()
  };
}

// ============================================================
//  NAVIGATE TO TICKETING AUTHORITY HISTORY
//  Dashboard → Master Data → Ticketing Authority History
// ============================================================

async function navigateToTicketingAuthority() {
  log('Navigating to Ticketing Authority History...');

  // Check if already on the page
  if (isTicketingAuthorityPage()) {
    log('Already on Ticketing Authority page');
    const table = findFirstTable();
    return {
      success: !!table,
      hasTable: !!table,
      rowCount: countTableRows(table),
      currentUrl: window.location.href,
      country: detectCurrentCountry(),
      alreadyOnPage: true,
      tableHeaders: table ? getTableHeaders(table) : []
    };
  }

  // Step 1: Click "MASTER DATA" in the top navigation
  // Exact selector from spec: text=MASTER DATA
  log('Step 1: Looking for MASTER DATA in navigation...');
  const masterDataEl = findNavItemByText(
    'MASTER DATA', 'Master Data', 'Master data'
  ) || findVisibleElementByText(['MASTER DATA', 'Master Data'], 'a, button, li, span');

  if (masterDataEl) {
    log('Clicking Master Data:', masterDataEl.textContent.trim());
    const clickable = masterDataEl.closest('a') || masterDataEl.closest('button') || masterDataEl;
    clickable.click();
    await waitForLoad(5000);
    await sleep(1500);
  } else {
    log('MASTER DATA not found in nav');
  }

  // Step 2: Click "Ticketing Authority" in the sub-menu
  // Exact selector: body > div li:nth-of-type(2) span
  // XPath: //*[@id="cdk-overlay-0"]/bspl-sub-menu/ul/li[2]/a/span
  // Text: "Ticketing Authority"
  log('Step 2: Looking for Ticketing Authority sub-menu...');
  await sleep(1500); // Wait for sub-menu/overlay to render

  // Try exact selector first (Angular CDK overlay)
  let taEl = document.querySelector('#cdk-overlay-0 bspl-sub-menu ul li:nth-of-type(2) a span') ||
             document.querySelector('bspl-sub-menu ul li:nth-of-type(2) a') ||
             document.querySelector('[id^="cdk-overlay"] bspl-sub-menu li:nth-of-type(2) a');

  // Fallback: text search in overlay or nav
  if (!taEl) {
    taEl = findVisibleElementByText(
      ['Ticketing Authority', 'TICKETING AUTHORITY', 'Ticketing Authority History'],
      'a, button, span, li'
    );
  }

  if (taEl) {
    log('Clicking Ticketing Authority:', taEl.textContent.trim());
    const clickable = taEl.closest('a') || taEl;
    clickable.click();
    await waitForLoad(5000);
    await sleep(2000);
  } else {
    log('Ticketing Authority not found in sub-menu');
  }

  // Step 3: Wait for the agent table to appear
  log('Step 3: Waiting for agent table...');
  await waitForTable(15000);

  const table = findFirstTable();
  const rowCount = countTableRows(table);

  return {
    success: !!table,
    hasTable: !!table,
    rowCount,
    currentUrl: window.location.href,
    country: detectCurrentCountry(),
    masterDataFound: !!masterDataEl,
    taFound: !!taEl,
    isOnTicketingAuthority: isTicketingAuthorityPage(),
    tableHeaders: table ? getTableHeaders(table) : []
  };
}

// ============================================================
//  SWITCH COUNTRY
//  "Switch to another BSP Link account" — globe icon at the top
// ============================================================

async function switchCountry(targetCode) {
  if (!targetCode) return { success: false, error: 'No country code provided' };

  const current = detectCurrentCountry();
  log('Switch country: current =', current, '→ target =', targetCode);

  if (current === targetCode.toUpperCase()) {
    return { success: true, alreadyOnCountry: true, country: current };
  }

  // Step 1: Click globe icon in header
  // Exact selector: bspl-header li:nth-of-type(2) > a
  log('Clicking globe icon...');
  const globe = document.querySelector('bspl-header li:nth-of-type(2) > a') ||
                document.querySelector('bspl-header nav ul li:nth-of-type(2) a') ||
                findVisibleElementByText(['Switch to another BSPLink account', 'Switch'], 'a, button');

  if (!globe) {
    return { success: false, error: 'Globe icon not found', currentCountry: current };
  }

  globe.click();
  await sleep(2000);

  // Step 2: Click country dropdown
  // Exact selector: div.dialog-container > div:nth-of-type(1) div.ng-input
  const dropdown = document.querySelector('div.dialog-container > div:nth-of-type(1) div.ng-input') ||
                   document.querySelector('bspl-switch-account-dialog ng-select div.ng-input') ||
                   document.querySelector('ng-select .ng-input');

  if (!dropdown) {
    return { success: false, error: 'Country dropdown not found in switch dialog' };
  }

  dropdown.click();
  await sleep(1000);

  // Step 3: Type country name to filter, then click matching option
  const targetUpper = targetCode.toUpperCase();

  // Type to filter
  const input = document.querySelector('ng-select input') || dropdown.querySelector('input');
  if (input) {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    // Type country code
    for (const char of targetUpper) {
      input.value += char;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await sleep(1000);
  }

  // Find and click the option matching the target country
  const options = document.querySelectorAll('ng-select .ng-dropdown-panel .ng-option, .ng-option');
  let clicked = false;
  for (const opt of options) {
    const text = opt.textContent.trim().toUpperCase();
    if (text.includes(targetUpper) || text.endsWith(` - ${targetUpper}`)) {
      log('Selecting country option:', opt.textContent.trim());
      opt.click();
      clicked = true;
      break;
    }
  }

  if (!clicked) {
    // Try aria selector: aria/COUNTRY_NAME
    const ariaOpt = document.querySelector(`[role="option"][aria-label*="${targetUpper}"]`);
    if (ariaOpt) {
      ariaOpt.click();
      clicked = true;
    }
  }

  if (!clicked) {
    // Close and fail
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { success: false, error: `Country ${targetCode} not found in dropdown` };
  }

  await sleep(500);

  // Step 4: Click APPLY
  // Exact selector: bspl-dialog bspl-button:nth-of-type(2) button
  const applyBtn = document.querySelector('bspl-dialog bspl-button:nth-of-type(2) button') ||
                   findVisibleElementByText(['APPLY', 'Apply', 'Appliquer'], 'button');

  if (applyBtn) {
    log('Clicking APPLY');
    applyBtn.click();
  } else {
    return { success: false, error: 'APPLY button not found' };
  }

  // Wait for full page reload
  await waitForLoad(15000);
  await sleep(3000);

  // Handle user selection dialog if it reappears
  await handleUserSelectionDialog();

  const newCountry = detectCurrentCountry();
  log('Switched to:', newCountry);

  return {
    success: true,
    country: newCountry,
    method: 'globe-dialog'
  };
}

// ============================================================
//  TABLE SCRAPING
// ============================================================

async function scrapeAllPages() {
  let allAgents = [];
  let pageNum = 1;
  let hasNext = true;
  let errors = [];

  while (hasNext) {
    try {
      const agents = scrapeCurrentTable();
      if (agents.length === 0 && pageNum > 1) {
        hasNext = false;
        break;
      }
      allAgents = allAgents.concat(agents);
      log('Page', pageNum, ':', agents.length, 'agents. Total:', allAgents.length);

      // Try to go to next page
      const nextBtn = findNextPageButton();
      if (nextBtn) {
        nextBtn.click();
        await waitForLoad(3000);
        await sleep(1000);
        pageNum++;
      } else {
        hasNext = false;
      }
    } catch (err) {
      errors.push({ page: pageNum, error: err.message });
      hasNext = false;
    }

    if (pageNum > 200) break; // Safety limit
  }

  return {
    agents: allAgents,
    pages: pageNum,
    totalAgents: allAgents.length,
    errors: errors.length > 0 ? errors : undefined,
    country: detectCurrentCountry()
  };
}

function scrapeCurrentTable() {
  const table = findFirstTable();
  if (!table) {
    log('No table found on page');
    return [];
  }

  const results = [];

  // Check if it's an ngx-datatable (Angular)
  if (table.tagName === 'NGX-DATATABLE' || table.querySelector('.datatable-body-row')) {
    log('Scraping ngx-datatable...');
    return scrapeNgxDatatable(table);
  }

  const columnMap = detectColumnMapping(table);
  log('Column mapping:', JSON.stringify(columnMap));

  const tbody = table.querySelector('tbody');
  const rows = tbody
    ? tbody.querySelectorAll('tr')
    : table.querySelectorAll('tr:not(:first-child)');

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 2) continue;

    const agentCode = extractAgentCode(cells, columnMap);
    if (!agentCode) continue;

    const action = extractAction(cells, columnMap);

    results.push({
      agentCode,
      agentName: getCellText(cells, columnMap.agentName),
      action,
      agentStatus: extractAgentStatus(cells, columnMap),
      ticketingAuthority: extractTicketingAuthority(cells, columnMap),
      rawRow: Array.from(cells).map(c => c.textContent.trim())
    });
  }

  return results;
}

/**
 * Scrape ngx-datatable (Angular DataTable component)
 * BSPLink uses this for the Ticketing Authority History table.
 * Columns: BSP | Agent Code | Agent Name | Date/Time | Action | Performed by | Email
 */
function scrapeNgxDatatable(ngxTable) {
  const results = [];

  // Get header columns
  const headerCells = ngxTable.querySelectorAll('.datatable-header-cell');
  const headers = Array.from(headerCells).map(h => h.textContent.trim().toLowerCase());
  log('ngx-datatable headers:', headers);

  // Map columns
  const colMap = {};
  headers.forEach((h, i) => {
    if (h.includes('agent code') || h === 'code') colMap.agentCode = i;
    else if (h.includes('agent name') || h === 'name') colMap.agentName = i;
    else if (h.includes('action')) colMap.action = i;
    else if (h.includes('date')) colMap.dateTime = i;
    else if (h.includes('bsp')) colMap.bsp = i;
    else if (h.includes('performed')) colMap.performedBy = i;
    else if (h.includes('email')) colMap.email = i;
  });

  // Get data rows
  const rows = ngxTable.querySelectorAll('.datatable-body-row');
  for (const row of rows) {
    const cells = row.querySelectorAll('.datatable-body-cell');
    if (cells.length < 2) continue;

    const getText = (idx) => idx !== undefined && idx < cells.length
      ? cells[idx]?.textContent?.trim() || '' : '';

    const agentCode = getText(colMap.agentCode);
    if (!agentCode || !/^\d{5,8}$/.test(agentCode.replace(/[-\s]/g, ''))) continue;

    const action = getText(colMap.action);

    results.push({
      agentCode: agentCode.replace(/[-\s]/g, ''),
      agentName: getText(colMap.agentName),
      action: action,
      dateTime: getText(colMap.dateTime),
      bsp: getText(colMap.bsp),
      performedBy: getText(colMap.performedBy),
      email: getText(colMap.email),
      rawRow: Array.from(cells).map(c => c.textContent.trim())
    });
  }

  log('Scraped', results.length, 'agents from ngx-datatable');
  return results;
}

// ============================================================
//  COLUMN DETECTION & DATA EXTRACTION
// ============================================================

function detectColumnMapping(table) {
  const mapping = {
    agentCode: 0,
    agentName: 1,
    action: -1,
    agentStatus: -1,
    ticketingAuthority: -1
  };

  const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th');
  if (headerCells.length === 0) return mapping;

  headerCells.forEach((cell, index) => {
    const text = cell.textContent.trim().toLowerCase();

    if (text.includes('agent code') || text.includes('code agent') || text === 'code') {
      mapping.agentCode = index;
    } else if (text.includes('agent name') || text.includes('nom') || text.includes('name')) {
      mapping.agentName = index;
    } else if (text === 'action' || text.includes('action')) {
      mapping.action = index;
    } else if (text.includes('status') || text.includes('statut')) {
      mapping.agentStatus = index;
    } else if (text.includes('ticketing') || text.includes('authority') || text.includes('ta ')) {
      mapping.ticketingAuthority = index;
    } else if (text.includes('enable') || text.includes('disable')) {
      mapping.action = index;
    }
  });

  return mapping;
}

function extractAgentCode(cells, columnMap) {
  const idx = columnMap.agentCode || 0;
  if (idx < cells.length) {
    const text = cells[idx]?.textContent?.trim();
    // IATA agent codes are typically 7-8 digits
    if (text && /^\d{7,8}$/.test(text.replace(/[-\s]/g, ''))) {
      return text.replace(/[-\s]/g, '');
    }
  }

  // Fallback: scan first 3 columns
  for (let i = 0; i < Math.min(cells.length, 3); i++) {
    const text = cells[i]?.textContent?.trim();
    if (text && /^\d{7,8}$/.test(text.replace(/[-\s]/g, ''))) {
      return text.replace(/[-\s]/g, '');
    }
  }

  return null;
}

/**
 * Extract the ACTION column: Enable or Disable
 * This is the key data point — the user described this as "action disable" or "action enable"
 */
function extractAction(cells, columnMap) {
  // Try mapped column
  if (columnMap.action >= 0 && columnMap.action < cells.length) {
    const text = cells[columnMap.action]?.textContent?.trim().toLowerCase();
    if (text.includes('enable')) return 'Enable';
    if (text.includes('disable')) return 'Disable';
  }

  // Scan all cells for Enable/Disable text
  for (let i = 0; i < cells.length; i++) {
    const text = cells[i]?.textContent?.trim().toLowerCase();
    if (text === 'enable' || text === 'enabled') return 'Enable';
    if (text === 'disable' || text === 'disabled') return 'Disable';
  }

  // Check for checkboxes, toggles, badges
  for (let i = 0; i < cells.length; i++) {
    const result = parseStatusFromCell(cells[i]);
    if (result !== 'Unknown') return result;
  }

  return 'Unknown';
}

function extractAgentStatus(cells, columnMap) {
  if (columnMap.agentStatus >= 0 && columnMap.agentStatus < cells.length) {
    const text = cells[columnMap.agentStatus]?.textContent?.trim().toLowerCase();
    if (text === 'active' || text === 'actif') return 'Active';
    if (text === 'inactive' || text === 'inactif') return 'Inactive';
    if (text === 'default') return 'Default';
    return cells[columnMap.agentStatus]?.textContent?.trim() || 'Unknown';
  }
  return 'Unknown';
}

function extractTicketingAuthority(cells, columnMap) {
  if (columnMap.ticketingAuthority >= 0 && columnMap.ticketingAuthority < cells.length) {
    const result = parseStatusFromCell(cells[columnMap.ticketingAuthority]);
    if (result !== 'Unknown') return result;
    // Return raw text
    return cells[columnMap.ticketingAuthority]?.textContent?.trim() || 'Unknown';
  }
  return 'Unknown';
}

function parseStatusFromCell(cell) {
  if (!cell) return 'Unknown';

  // Checkbox
  const checkbox = cell.querySelector('input[type="checkbox"]');
  if (checkbox) return checkbox.checked ? 'Enabled' : 'Disabled';

  // Toggle/switch
  const toggle = cell.querySelector('[class*="toggle"], [class*="switch"]');
  if (toggle) {
    const isOn = toggle.classList.contains('on') || toggle.classList.contains('active') ||
                 toggle.classList.contains('checked') || toggle.getAttribute('aria-checked') === 'true';
    return isOn ? 'Enabled' : 'Disabled';
  }

  // Badge/status indicator
  const badge = cell.querySelector('.badge, [class*="status"], [class*="chip"], .label, .tag');
  if (badge) {
    const text = badge.textContent.trim().toLowerCase();
    if (text.includes('enable') || text.includes('yes') || text.includes('actif') || text.includes('oui')) return 'Enabled';
    if (text.includes('disable') || text.includes('no') || text.includes('inactif') || text.includes('non')) return 'Disabled';
  }

  // Green/red icons
  if (cell.querySelector('.fa-check, .text-success, [style*="green"]')) return 'Enabled';
  if (cell.querySelector('.fa-times, .text-danger, [style*="red"]')) return 'Disabled';

  // Raw text
  const text = cell.textContent.trim().toLowerCase();
  if (text === 'enabled' || text === 'enable' || text === 'yes' || text === 'oui') return 'Enabled';
  if (text === 'disabled' || text === 'disable' || text === 'no' || text === 'non') return 'Disabled';

  return 'Unknown';
}

function getCellText(cells, index) {
  if (index >= 0 && index < cells.length) {
    return cells[index]?.textContent?.trim() || '';
  }
  return '';
}

function getTableHeaders(table) {
  const headers = [];
  table.querySelectorAll('thead th, thead td, tr:first-child th').forEach(cell => {
    headers.push(cell.textContent.trim());
  });
  return headers;
}

// ============================================================
//  COUNTRY DETECTION
// ============================================================

function detectCurrentCountry() {
  // Strategy 1: Header text pattern "BSPlink ... (XX)" or "COUNTRY (XX)"
  const headerAreas = document.querySelectorAll(
    'header, nav, .navbar, [class*="header"], [class*="toolbar"], [class*="brand"], h1, h2, h3'
  );
  for (const area of headerAreas) {
    const text = area.textContent;
    // Match "BSPlink ... (XX)"
    const bspMatch = text.match(/BSP\s*link[^(]*\(([A-Z]{2})\)/i);
    if (bspMatch) return bspMatch[1].toUpperCase();
    // Match "Efficiency ... (XX)" or just "(XX)" in header context
    const effMatch = text.match(/Efficiency[^(]*\(([A-Z]{2})\)/i);
    if (effMatch) return effMatch[1].toUpperCase();
  }

  // Strategy 2: Any (XX) pattern in top part of page
  const topElements = document.querySelectorAll('header *, nav *, .navbar *');
  for (const el of topElements) {
    if (el.children.length > 0) continue; // Only leaf text nodes
    const match = el.textContent.match(/\(([A-Z]{2})\)/);
    if (match) return match[1];
  }

  // Strategy 3: Page title
  const titleMatch = document.title.match(/\(([A-Z]{2})\)/);
  if (titleMatch) return titleMatch[1];

  // Strategy 4: URL
  const urlParams = new URLSearchParams(window.location.search);
  for (const key of ['country', 'bsp', 'countryCode', 'cc']) {
    const val = urlParams.get(key);
    if (val && /^[A-Z]{2}$/i.test(val)) return val.toUpperCase();
  }

  const pathMatch = window.location.pathname.match(/\/([A-Z]{2})\//i);
  if (pathMatch) return pathMatch[1].toUpperCase();

  return null;
}

function isTicketingAuthorityPage() {
  const url = window.location.href.toLowerCase();
  const bodyText = document.body?.innerText || '';

  if (/ticketing.?authority/i.test(url)) return true;
  if (bodyText.includes('Ticketing Authority')) return true;
  if (bodyText.includes('List of agents')) return true;

  // Check if there's a table with agent code column
  const table = findFirstTable();
  if (table) {
    const headers = getTableHeaders(table);
    const hasAgentCode = headers.some(h => h.toLowerCase().includes('agent code'));
    const hasAction = headers.some(h => h.toLowerCase().includes('action') || h.toLowerCase().includes('enable') || h.toLowerCase().includes('disable'));
    if (hasAgentCode && hasAction) return true;
  }

  return false;
}

// ============================================================
//  PAGE INFO
// ============================================================

function getPageInfo() {
  const table = findFirstTable();
  return {
    url: window.location.href,
    title: document.title,
    country: detectCurrentCountry(),
    pageType: detectPageType(),
    hasTable: !!table,
    tableRowCount: countTableRows(table),
    tableHeaders: table ? getTableHeaders(table) : [],
    isOnTicketingAuthority: isTicketingAuthorityPage(),
    bodyTextSample: (document.body?.innerText || '').substring(0, 500),
    selectElements: Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name, id: s.id,
      optionCount: s.options.length,
      firstOptions: Array.from(s.options).slice(0, 5).map(o => o.text.trim())
    })),
    navLinks: Array.from(document.querySelectorAll('nav a, .navbar a, [class*="nav"] a')).slice(0, 20).map(a => ({
      text: a.textContent.trim().substring(0, 50),
      href: a.getAttribute('href')
    }))
  };
}

// ============================================================
//  PAGINATION
// ============================================================

function findNextPageButton() {
  const selectors = [
    'button[aria-label="Next page"]',
    'button[aria-label="Next"]',
    '.pagination .page-item.next .page-link',
    '.pagination .page-item:last-child .page-link',
    '.pagination li:last-child a',
    '.pagination .next a',
    'a[aria-label="Next"]',
    'a[rel="next"]',
    'li.next a',
    'a.next',
    'button.next',
    'button[class*="next-page"]',
    '.p-paginator-next',
    '.paging_next',
    '[class*="paginator"] button:last-child'
  ];

  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && !isDisabledButton(el)) return el;
    } catch { /* skip */ }
  }

  // Text search for "Next" / "Suivant" / ">" buttons
  const nextByText = findVisibleElementByText(
    ['Next', 'Suivant', '›', '»', '>'],
    '.pagination a, .pagination button, [class*="paginator"] button'
  );
  if (nextByText && !isDisabledButton(nextByText)) return nextByText;

  return null;
}

function isDisabledButton(el) {
  if (el.disabled) return true;
  if (el.classList.contains('disabled')) return true;
  if (el.getAttribute('aria-disabled') === 'true') return true;
  if (el.parentElement?.classList.contains('disabled')) return true;
  if (el.closest('.page-item')?.classList.contains('disabled')) return true;
  const style = window.getComputedStyle(el);
  if (style.pointerEvents === 'none') return true;
  return false;
}

// ============================================================
//  DOM HELPERS
// ============================================================

function findFirstTable() {
  // BSPLink uses ngx-datatable (Angular component)
  // Try ngx-datatable first
  const ngxTable = document.querySelector('ngx-datatable');
  if (ngxTable && isVisible(ngxTable)) {
    // ngx-datatable has its own row structure
    const rows = ngxTable.querySelectorAll('.datatable-body-row');
    if (rows.length > 0) {
      log('Found ngx-datatable with', rows.length, 'rows');
      return ngxTable;
    }
  }

  // Try specific selectors
  const specificSelectors = [
    'table[class*="agent"]', 'table[class*="ticketing"]',
    'table.table', 'table.table-striped', 'table.dataTable',
    '.tab-content table', '.card-body table', '.panel-body table',
    '[class*="content"] table'
  ];

  for (const sel of specificSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el) && countTableRows(el) > 0) return el;
    } catch { /* skip */ }
  }

  // Fallback: any visible table with rows
  const tables = document.querySelectorAll('table');
  for (const table of tables) {
    if (isVisible(table) && countTableRows(table) > 0) return table;
  }

  return null;
}

function countTableRows(table) {
  if (!table) {
    table = findFirstTable();
    if (!table) return 0;
  }
  // ngx-datatable
  const ngxRows = table.querySelectorAll('.datatable-body-row');
  if (ngxRows.length > 0) return ngxRows.length;
  // Regular table
  const tbody = table.querySelector('tbody');
  if (tbody) return tbody.querySelectorAll('tr').length;
  return Math.max(0, table.querySelectorAll('tr').length - 1);
}

function findNavItemByText(...textOptions) {
  const navSelectors = [
    'nav a', '.navbar a', '.nav a', '.nav-tabs a', '.nav-pills a',
    '[class*="nav"] a', '[class*="menu"] a', '[class*="tab"] a',
    'ul.nav a', 'a.nav-link', 'a[role="tab"]', '[role="tablist"] a',
    'li.nav-item a', '.menu-item a'
  ];

  for (const text of textOptions) {
    for (const selector of navSelectors) {
      try {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
          const elText = el.textContent.trim();
          if (elText === text || elText.toLowerCase() === text.toLowerCase()) {
            return el;
          }
        }
      } catch { /* skip */ }
    }
  }

  // Broader search: any clickable element with matching text
  for (const text of textOptions) {
    const el = findVisibleElementByText([text], 'a, button, [role="tab"], [role="menuitem"]');
    if (el) return el;
  }

  return null;
}

function findVisibleElementByText(textOptions, tagSelector = '*') {
  const elements = document.querySelectorAll(tagSelector);

  for (const text of textOptions) {
    const lower = text.toLowerCase();

    // Exact match first
    for (const el of elements) {
      const elText = el.textContent.trim();
      if (elText === text && isVisible(el)) return el;
    }

    // Case-insensitive exact
    for (const el of elements) {
      if (el.textContent.trim().toLowerCase() === lower && isVisible(el)) return el;
    }

    // Contains match (but prefer shorter matches to avoid matching parent containers)
    const matches = [];
    for (const el of elements) {
      if (el.textContent.trim().toLowerCase().includes(lower) && isVisible(el)) {
        matches.push(el);
      }
    }
    // Return the one with shortest text (most specific)
    if (matches.length > 0) {
      matches.sort((a, b) => a.textContent.length - b.textContent.length);
      return matches[0];
    }
  }

  return null;
}

function isVisible(el) {
  if (!el) return false;
  if (el.offsetParent === null && el.tagName !== 'BODY' &&
      window.getComputedStyle(el).position !== 'fixed') {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isInTopArea(el) {
  const rect = el.getBoundingClientRect();
  return rect.top < 150; // Top 150px of the page
}

function waitForLoad(maxMs = 5000) {
  return new Promise(resolve => {
    let resolved = false;
    let settleTimer = null;

    const observer = new MutationObserver(() => {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
      }, 800);
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Max timeout
    setTimeout(() => {
      if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
    }, maxMs);

    // Initial settle
    settleTimer = setTimeout(() => {
      if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
    }, 1500);
  });
}

function waitForTable(maxMs = 15000) {
  return new Promise(resolve => {
    // Check immediately
    if (findFirstTable()) { resolve(findFirstTable()); return; }

    let resolved = false;

    const observer = new MutationObserver(() => {
      const table = findFirstTable();
      if (table && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(table);
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

// ============================================================
//  DEBUG
// ============================================================

function debugDomStructure() {
  return {
    url: window.location.href,
    title: document.title,
    pageType: detectPageType(),
    country: detectCurrentCountry(),
    bodyClasses: document.body?.className || '',

    // Framework detection
    framework: {
      angular: !!document.querySelector('[ng-version], [_nghost], [_ngcontent]'),
      react: !!document.querySelector('[data-reactroot], [data-reactid]'),
      vue: !!document.querySelector('[data-v-], [data-vue]')
    },

    // All navigation links
    navLinks: Array.from(document.querySelectorAll('nav a, .navbar a, [class*="nav"] a')).slice(0, 30).map(a => ({
      text: a.textContent.trim().substring(0, 60),
      href: a.getAttribute('href'),
      visible: isVisible(a)
    })),

    // All select elements
    selects: Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name, id: s.id,
      options: Array.from(s.options).slice(0, 10).map(o => ({ value: o.value, text: o.text.trim() }))
    })),

    // All tables
    tables: Array.from(document.querySelectorAll('table')).slice(0, 5).map(t => ({
      classes: t.className,
      id: t.id,
      headers: getTableHeaders(t),
      rowCount: countTableRows(t),
      visible: isVisible(t)
    })),

    // Header texts (for country detection)
    headerTexts: Array.from(
      document.querySelectorAll('header *, nav *, .navbar *, [class*="header"] *')
    ).filter(el => {
      const text = el.textContent.trim();
      return text.includes('BSP') || text.includes('bsp') || /\([A-Z]{2}\)/.test(text) ||
             text.includes('Switch') || text.includes('switch');
    }).slice(0, 15).map(el => ({
      tag: el.tagName, text: el.textContent.trim().substring(0, 100),
      classes: el.className?.substring?.(0, 80) || ''
    })),

    // Buttons/links in top area (for switch country detection)
    topAreaElements: Array.from(document.querySelectorAll('a, button')).filter(el => isInTopArea(el)).slice(0, 20).map(el => ({
      tag: el.tagName,
      text: el.textContent.trim().substring(0, 80),
      href: el.getAttribute('href'),
      classes: el.className?.substring?.(0, 60) || ''
    })),

    // Body text sample
    bodyTextSample: (document.body?.innerText || '').substring(0, 800)
  };
}

// ---- Init ----
log('Content script loaded on:', window.location.href);
log('Page type:', detectPageType());
