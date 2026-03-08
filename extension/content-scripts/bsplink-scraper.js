// ============================================================
// APG BSP Link - Content Script
// Injected into BSP Link pages for DOM scraping
// ============================================================

// Configurable selectors - update after live testing with real BSP Link
const SELECTORS = {
  // Navigation tabs
  settingsTab: [
    'a[href*="settings"]', '[data-tab="settings"]',
    '#settingsTab', 'li.settings a', 'a.settings'
  ],
  ticketingAuthorityTab: [
    'a[href*="ticketing"]', '[data-tab="ticketing-authority"]',
    '#ticketingAuthorityTab', 'a[title*="Ticketing Authority"]'
  ],
  // Agent table
  agentTable: [
    'table.agent-list', 'table#agentTable',
    '[class*="ticketing"] table', 'table.table', 'table'
  ],
  // Pagination
  nextPageButton: [
    'a[aria-label="Next"]', 'button[aria-label="Next"]',
    '.pagination .next a', '.pagination-next',
    'a.next', 'button.next', 'li.next a'
  ],
  // Country selector
  countrySelector: [
    'select[name*="country"]', 'select[name*="bsp"]',
    'select[id*="country"]', '#countrySelector',
    '[class*="country-select"] select'
  ],
  // Current country in header
  countryHeader: [
    '.header-title', '.bsp-header', 'h1', 'h2',
    '[class*="header"] [class*="country"]'
  ]
};

// ---- Message Handler ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
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
    case 'PING':
      return { status: 'alive', url: window.location.href };
    default:
      return { error: 'Unknown message type' };
  }
}

// ---- Navigation ----
async function navigateToTicketingAuthority() {
  // Step 1: Click SETTINGS tab
  const settingsEl = findByTextOrSelector(SELECTORS.settingsTab, 'SETTINGS', 'Settings');
  if (settingsEl) {
    settingsEl.click();
    await waitForLoad(5000);
  }

  // Step 2: Click Ticketing Authority tab
  const taEl = findByTextOrSelector(
    SELECTORS.ticketingAuthorityTab,
    'Ticketing Authority', 'TICKETING AUTHORITY'
  );
  if (taEl) {
    taEl.click();
    await waitForLoad(5000);
  }

  // Verify table exists
  const table = findBySelectors(SELECTORS.agentTable);
  return {
    success: !!table,
    currentUrl: window.location.href,
    country: detectCurrentCountry()
  };
}

// ---- Country Switching ----
async function switchCountry(targetCode) {
  const current = detectCurrentCountry();
  if (current === targetCode) {
    return { success: true, alreadyOnCountry: true, country: current };
  }

  // Try select dropdown
  const select = findBySelectors(SELECTORS.countrySelector);
  if (select && select.tagName === 'SELECT') {
    const option = Array.from(select.options).find(
      opt => opt.value.includes(targetCode) || opt.text.includes(targetCode)
    );
    if (option) {
      select.value = option.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await waitForLoad(8000);
      return { success: true, country: detectCurrentCountry() };
    }
  }

  // Try clicking a country link/button
  const countryEl = findElementByText(targetCode, 'a, button, [role="option"], li');
  if (countryEl) {
    countryEl.click();
    await waitForLoad(8000);
    return { success: true, country: detectCurrentCountry() };
  }

  return { success: false, error: `Cannot switch to country ${targetCode}` };
}

function detectCurrentCountry() {
  // Parse from header: "BSPlink - Efficient | COUNTRY_NAME (XX)"
  for (const selector of SELECTORS.countryHeader) {
    const el = document.querySelector(selector);
    if (el) {
      const match = el.textContent.match(/\(([A-Z]{2})\)/);
      if (match) return match[1];
    }
  }
  // Try page title
  const titleMatch = document.title.match(/\(([A-Z]{2})\)/);
  if (titleMatch) return titleMatch[1];
  return null;
}

// ---- Table Scraping ----
async function scrapeAllPages() {
  let allAgents = [];
  let pageNum = 1;
  let hasNext = true;

  while (hasNext) {
    const agents = scrapeCurrentTable();
    allAgents = allAgents.concat(agents);

    // Try to go to next page
    const nextBtn = findBySelectors(SELECTORS.nextPageButton);
    if (nextBtn && !nextBtn.disabled && !nextBtn.classList.contains('disabled')) {
      nextBtn.click();
      await waitForLoad(3000);
      pageNum++;
    } else {
      hasNext = false;
    }

    // Safety: max 100 pages
    if (pageNum > 100) break;
  }

  return { agents: allAgents, pages: pageNum };
}

function scrapeCurrentTable() {
  const table = findBySelectors(SELECTORS.agentTable);
  if (!table) return [];

  const results = [];
  const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');

  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    if (cells.length < 5) continue;

    // Expected columns: Agent Code | Agent Name | Agent Address | Agent City | Agent Status | TA Management
    const agentCode = cells[0]?.textContent?.trim();
    if (!agentCode || agentCode.length < 3) continue;

    results.push({
      agentCode,
      agentName: cells[1]?.textContent?.trim() || '',
      agentAddress: cells[2]?.textContent?.trim() || '',
      agentCity: cells[3]?.textContent?.trim() || '',
      agentStatus: cells[4]?.textContent?.trim() || '',
      ticketingAuthority: parseTicketingAuthority(cells[5])
    });
  }

  return results;
}

function parseTicketingAuthority(cell) {
  if (!cell) return 'Unknown';

  // Check for checkbox
  const checkbox = cell.querySelector('input[type="checkbox"]');
  if (checkbox) return checkbox.checked ? 'Enabled' : 'Disabled';

  // Check for icon/badge
  const badge = cell.querySelector('[class*="enabled"], [class*="active"], .badge');
  if (badge) {
    const text = badge.textContent.trim().toLowerCase();
    if (text.includes('enabled') || text.includes('yes') || text.includes('actif')) return 'Enabled';
    if (text.includes('disabled') || text.includes('no') || text.includes('inactif')) return 'Disabled';
  }

  // Check text content
  const text = cell.textContent.trim().toLowerCase();
  if (text.includes('enabled')) return 'Enabled';
  if (text.includes('disabled')) return 'Disabled';

  return 'Unknown';
}

// ---- DOM Helpers ----
function findBySelectors(selectorList) {
  for (const sel of selectorList) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch (e) { /* invalid selector */ }
  }
  return null;
}

function findElementByText(text, tagSelector = '*') {
  const elements = document.querySelectorAll(tagSelector);
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
    const byText = findElementByText(text, 'a, button, li, [role="tab"], span');
    if (byText) return byText;
  }
  return null;
}

function waitForLoad(maxMs = 5000) {
  return new Promise((resolve) => {
    let resolved = false;

    const observer = new MutationObserver(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        setTimeout(resolve, 500); // Extra wait for rendering
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

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
