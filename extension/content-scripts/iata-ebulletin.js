// ============================================================
// APG BSP Link - IATA eBulletin / Code Search / SMART
// Content Script — Injected into portal.iata.org/*
//
// Handles:
//   - eBulletin navigation, weekly tab, report generation & download
//   - IATA Code Search navigation + agent data scraping
//   - SMART Risk Management navigation + profile scraping
//   - SMART Lite data extraction
// ============================================================

(function () {
  'use strict';

  const LOG_PREFIX = '[APG eBulletin]';

  // ---- Known message types this script handles ----
  const EBULLETIN_MESSAGE_TYPES = new Set([
    'NAVIGATE_TO_EBULLETIN', 'CHECK_EBULLETIN_PAGE', 'CLICK_WEEKLY_TAB',
    'GENERATE_REPORT', 'DOWNLOAD_LATEST_EBULLETIN', 'GET_EBULLETIN_LIST',
    'NAVIGATE_TO_CODE_SEARCH', 'SEARCH_IATA_CODE',
    'NAVIGATE_TO_SMART', 'SEARCH_SMART_AGENT',
    'NAVIGATE_TO_SMART_LITE', 'SCRAPE_SMART_LITE',
    'SCAN_PORTAL_SERVICES', 'PING'
  ]);

  // ---- Message Handler ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Only handle messages this script knows about
    if (!EBULLETIN_MESSAGE_TYPES.has(message.type)) {
      return false; // Let other content scripts handle it
    }

    handleMessage(message).then(sendResponse).catch(err => {
      console.error(LOG_PREFIX, 'Error handling message:', err);
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  });

  async function handleMessage(message) {
    switch (message.type) {
      // ---- eBulletin ----
      case 'NAVIGATE_TO_EBULLETIN':
        return await navigateToEbulletin();
      case 'CHECK_EBULLETIN_PAGE':
        return checkEbulletinPage();
      case 'CLICK_WEEKLY_TAB':
        return await clickWeeklyTab();
      case 'GENERATE_REPORT':
        return await generateReport();
      case 'DOWNLOAD_LATEST_EBULLETIN':
        return await downloadLatestEbulletin();
      case 'GET_EBULLETIN_LIST':
        return getEbulletinList();

      // ---- IATA Code Search ----
      case 'NAVIGATE_TO_CODE_SEARCH':
        return await navigateToCodeSearch();
      case 'SEARCH_IATA_CODE':
        return await searchIataCode(message.payload);

      // ---- SMART Risk Management ----
      case 'NAVIGATE_TO_SMART':
        return await navigateToSmart();
      case 'SEARCH_SMART_AGENT':
        return await searchSmartAgent(message.payload);

      // ---- SMART Lite ----
      case 'NAVIGATE_TO_SMART_LITE':
        return await navigateToSmartLite();
      case 'SCRAPE_SMART_LITE':
        return await scrapeSmartLite(message.payload);

      // ---- Portal Scan ----
      case 'SCAN_PORTAL_SERVICES':
        return scanPortalServices();

      // ---- Utility ----
      case 'PING':
        return { status: 'alive', url: window.location.href, script: 'iata-ebulletin' };
      default:
        return { error: `Unknown message type: ${message.type}` };
    }
  }

  // ============================================================
  //  SHARED UTILITIES
  // ============================================================

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wait for an element matching ANY of the given selectors.
   * Returns the first matched element or throws on timeout.
   */
  function waitForElement(selectors, timeout = 15000) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    return new Promise((resolve, reject) => {
      // Check immediately
      for (const sel of selectorList) {
        const el = document.querySelector(sel);
        if (el) { resolve(el); return; }
      }

      const interval = 300;
      let elapsed = 0;
      const poll = setInterval(() => {
        elapsed += interval;
        for (const sel of selectorList) {
          const el = document.querySelector(sel);
          if (el) { clearInterval(poll); resolve(el); return; }
        }
        if (elapsed >= timeout) {
          clearInterval(poll);
          reject(new Error(`waitForElement: none of [${selectorList.join(', ')}] found within ${timeout}ms`));
        }
      }, interval);
    });
  }

  /**
   * Wait until the DOM has settled (no mutations for `quietMs`).
   */
  function waitForDomSettle(quietMs = 800, maxMs = 15000) {
    return new Promise(resolve => {
      let resolved = false;
      let settleTimer = null;

      const observer = new MutationObserver(() => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
        }, quietMs);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true
      });

      // Kick-start settle timer in case there are no mutations at all
      settleTimer = setTimeout(() => {
        if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
      }, quietMs);

      // Hard max
      setTimeout(() => {
        if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
      }, maxMs);
    });
  }

  /**
   * Wait for SPA navigation to complete (URL change + DOM settle).
   */
  function waitForNavigation(maxMs = 15000) {
    return new Promise(resolve => {
      let resolved = false;
      let settleTimer = null;
      const startUrl = window.location.href;

      const observer = new MutationObserver(() => {
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
        }, 1000);
      });

      observer.observe(document.body || document.documentElement, {
        childList: true, subtree: true
      });

      const urlCheck = setInterval(() => {
        if (window.location.href !== startUrl && !resolved) {
          clearInterval(urlCheck);
          setTimeout(() => {
            if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
          }, 2000);
        }
      }, 200);

      setTimeout(() => {
        clearInterval(urlCheck);
        if (!resolved) { resolved = true; observer.disconnect(); resolve(); }
      }, maxMs);
    });
  }

  /**
   * Fill a Salesforce Lightning / legacy input robustly.
   */
  async function fillInput(field, value) {
    field.focus();
    field.click();
    await wait(100);

    // Use native setter to bypass React / LWC / Angular wrappers
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    )?.set;

    if (nativeSetter) {
      nativeSetter.call(field, '');
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      await wait(50);
      nativeSetter.call(field, value);
    } else {
      field.value = value;
    }

    // Fire the full event chain that frameworks listen for
    field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter' }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
    await wait(200);
  }

  /**
   * Find an element by text content among a set of candidates.
   * Supports partial, case-insensitive matching.
   */
  function findElementByText(selector, textPatterns, options = {}) {
    const { exact = false, parent = document } = options;
    const patterns = Array.isArray(textPatterns) ? textPatterns : [textPatterns];
    const elements = parent.querySelectorAll(selector);

    for (const el of elements) {
      const text = (el.textContent || '').trim();
      const textLower = text.toLowerCase();
      for (const pattern of patterns) {
        const patternLower = pattern.toLowerCase();
        if (exact ? textLower === patternLower : textLower.includes(patternLower)) {
          return el;
        }
      }
    }
    return null;
  }

  /**
   * Click a service tile on the portal homepage.
   * These tiles live in "Favorite Services" or service carousel areas.
   * Returns { success, message } or throws.
   */
  async function clickServiceTile(tileTexts, fallbackHrefs = []) {
    const tilePatterns = Array.isArray(tileTexts) ? tileTexts : [tileTexts];

    // Strategy 1: Look for links/buttons matching tile text
    const clickableSelectors = [
      'a', 'button',
      '[role="link"]', '[role="button"]',
      '[class*="tile"] a', '[class*="card"] a',
      '[class*="service"] a', '[class*="favorite"] a',
      '.slds-card a', '.slds-tile a',
      'lightning-card a', 'lightning-button',
      '[class*="carousel"] a', '[class*="slider"] a',
      'article a', '[class*="featured"] a'
    ];

    for (const selector of clickableSelectors) {
      const el = findElementByText(selector, tilePatterns);
      if (el) {
        log('Found tile via selector:', selector, '— text:', el.textContent.trim().substring(0, 60));
        el.click();
        await waitForNavigation(15000);
        return { success: true, message: `Clicked tile: ${el.textContent.trim().substring(0, 60)}` };
      }
    }

    // Strategy 2: Find any visible element with matching text and climb to clickable parent
    const allElements = document.querySelectorAll('*');
    for (const el of allElements) {
      // Only check direct text nodes (avoid matching deep children)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === Node.TEXT_NODE)
        .map(n => n.textContent.trim())
        .join(' ')
        .toLowerCase();

      if (!directText) continue;

      for (const pattern of tilePatterns) {
        if (directText.includes(pattern.toLowerCase())) {
          // Climb to nearest clickable ancestor
          let clickable = el.closest('a') || el.closest('button') || el.closest('[role="link"]');
          if (!clickable && (el.tagName === 'A' || el.tagName === 'BUTTON')) clickable = el;
          if (!clickable) clickable = el; // click the element itself as last resort

          log('Found tile via text scan — clicking:', clickable.tagName);
          clickable.click();
          await waitForNavigation(15000);
          return { success: true, message: `Clicked tile element: ${pattern}` };
        }
      }
    }

    // Strategy 2.5: Search Shadow DOM (Salesforce Lightning / LWC components)
    const shadowLinks = deepQuerySelectorAll('a, button, [role="link"], [role="button"]');
    for (const el of shadowLinks) {
      const text = (el.textContent || '').trim().toLowerCase();
      for (const pattern of tilePatterns) {
        if (text.includes(pattern.toLowerCase())) {
          log('Found tile in Shadow DOM:', text.substring(0, 60));
          el.click();
          await waitForNavigation(15000);
          return { success: true, message: `Clicked tile in Shadow DOM: ${pattern}` };
        }
      }
    }

    // Strategy 3: Try direct URL navigation via known patterns
    for (const href of fallbackHrefs) {
      try {
        const url = href.startsWith('http') ? href : window.location.origin + href;
        const response = await fetch(url, { method: 'HEAD', credentials: 'include', redirect: 'follow' });
        if (response.ok) {
          window.location.href = url;
          await waitForDomSettle(1500, 15000);
          return { success: true, message: `Navigated via URL: ${href}` };
        }
      } catch { /* URL does not resolve */ }
    }

    return { success: false, message: 'Service tile not found on page.' };
  }

  /**
   * Scrape text content from a DOM element via multiple selector strategies.
   * Returns the trimmed text or defaultValue.
   */
  function scrapeText(selectors, defaultValue = '', parent = document) {
    const selectorList = Array.isArray(selectors) ? selectors : [selectors];
    for (const sel of selectorList) {
      try {
        const el = parent.querySelector(sel);
        if (el) {
          const text = (el.textContent || el.innerText || '').trim();
          if (text) return text;
        }
      } catch { /* invalid selector, skip */ }
    }
    return defaultValue;
  }

  /**
   * Scrape a label: value pair from the page.
   * Looks for a label element containing `labelText`, then grabs the adjacent value.
   */
  function scrapeLabelValue(labelText, parent = document) {
    const labelLower = labelText.toLowerCase();

    // Strategy 1: Find label elements
    const labelCandidates = parent.querySelectorAll(
      'label, dt, th, .label, [class*="label"], [class*="field-label"], ' +
      'span[class*="label"], div[class*="label"], strong, b'
    );

    for (const lbl of labelCandidates) {
      const text = (lbl.textContent || '').trim().toLowerCase();
      if (!text.includes(labelLower)) continue;

      // Try the next sibling
      let value = lbl.nextElementSibling;
      if (value) {
        const vText = (value.textContent || '').trim();
        if (vText && vText.toLowerCase() !== text) return vText;
      }

      // Try parent's next child
      const parentEl = lbl.parentElement;
      if (parentEl) {
        const children = Array.from(parentEl.children);
        const idx = children.indexOf(lbl);
        if (idx >= 0 && idx + 1 < children.length) {
          const vText = (children[idx + 1].textContent || '').trim();
          if (vText) return vText;
        }

        // Try dd after dt
        if (lbl.tagName === 'DT') {
          const dd = lbl.nextElementSibling;
          if (dd && dd.tagName === 'DD') return (dd.textContent || '').trim();
        }

        // If parent is a row, look for value cell
        const row = lbl.closest('tr');
        if (row) {
          const cells = row.querySelectorAll('td, th');
          if (cells.length >= 2) return (cells[cells.length - 1].textContent || '').trim();
        }
      }
    }

    // Strategy 2: Regex scan of visible text blocks
    const blocks = parent.querySelectorAll('div, p, span, li, td');
    for (const block of blocks) {
      const bText = (block.textContent || '').trim();
      const regex = new RegExp(labelText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[:;]?\\s*(.+)', 'i');
      const match = bText.match(regex);
      if (match && match[1]) {
        const val = match[1].trim().split('\n')[0].trim();
        if (val.length < 200) return val;
      }
    }

    return '';
  }

  function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return btoa(binary);
  }

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  /**
   * Search through Shadow DOM to find elements matching a selector.
   * Salesforce Lightning (LWC) uses Shadow DOM extensively.
   */
  function deepQuerySelectorAll(selector, root = document) {
    const results = [];
    // Search in light DOM
    try {
      root.querySelectorAll(selector).forEach(el => results.push(el));
    } catch(e) {}

    // Search in shadow roots
    const allElements = root.querySelectorAll('*');
    for (const el of allElements) {
      if (el.shadowRoot) {
        try {
          el.shadowRoot.querySelectorAll(selector).forEach(el => results.push(el));
        } catch(e) {}
        // Recurse into shadow root
        const nested = deepQuerySelectorAll(selector, el.shadowRoot);
        results.push(...nested);
      }
    }
    return results;
  }

  function deepQuerySelector(selector, root = document) {
    const all = deepQuerySelectorAll(selector, root);
    return all.length > 0 ? all[0] : null;
  }

  // ============================================================
  //  SCAN_PORTAL_SERVICES
  //  Scan the portal page for all available service links/tiles
  //  Returns: { services: [...], url, title }
  // ============================================================
  function scanPortalServices() {
    const services = [];
    const seen = new Set();

    // Scan all links (light DOM + shadow DOM)
    const allLinks = deepQuerySelectorAll('a[href]');
    for (const a of allLinks) {
      const text = (a.textContent || '').trim().replace(/\s+/g, ' ');
      const href = a.href || a.getAttribute('href') || '';
      if (text.length < 2 || text.length > 300 || !href) continue;
      const key = text.substring(0, 50) + '|' + href;
      if (seen.has(key)) continue;
      seen.add(key);
      services.push({ text: text.substring(0, 200), href, tag: 'a' });
    }

    // Scan buttons
    const allButtons = deepQuerySelectorAll('button');
    for (const btn of allButtons) {
      const text = (btn.textContent || '').trim().replace(/\s+/g, ' ');
      if (text.length < 2 || text.length > 300) continue;
      const key = 'btn|' + text.substring(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);
      services.push({ text: text.substring(0, 200), tag: 'button' });
    }

    // Scan elements with href attributes (common in LWC)
    const allClickable = deepQuerySelectorAll('[href], [data-href], [data-url], [onclick]');
    for (const el of allClickable) {
      const text = (el.textContent || '').trim().replace(/\s+/g, ' ');
      const href = el.href || el.getAttribute('href') || el.getAttribute('data-href') || el.getAttribute('data-url') || '';
      if (text.length < 2 || text.length > 300) continue;
      const key = text.substring(0, 50) + '|' + href;
      if (seen.has(key)) continue;
      seen.add(key);
      services.push({ text: text.substring(0, 200), href, tag: el.tagName.toLowerCase() });
    }

    log('Scanned portal services:', services.length, 'items found');
    return {
      services,
      url: window.location.href,
      title: document.title,
      bodyTextPreview: (document.body?.textContent || '').substring(0, 500).replace(/\s+/g, ' ')
    };
  }

  // ============================================================
  //  1. NAVIGATE_TO_EBULLETIN
  //  Click "AIRS / CAIRS Online Bulletin" tile on portal homepage
  // ============================================================

  async function navigateToEbulletin() {
    log('Navigating to eBulletin...');

    const result = await clickServiceTile(
      [
        'AIRS / CAIRS Online Bulletin',
        'AIRS/CAIRS Online Bulletin',
        'AIRS / CAIRS',
        'Online Bulletin',
        'E-Bulletin',
        'eBulletin',
        'e-bulletin',
        'Weekly eBulletin',
        'AIRS',
        'Bulletin'
      ],
      [
        '/s/ebulletin',
        '/s/airs-cairs-online-bulletin',
        '/s/online-bulletin',
        '/s/risk-management',
        '/s/risk-management-ebulletin',
        '/s/weekly-ebulletin',
        '/s/article/eBulletin'
      ]
    );

    return {
      ...result,
      currentUrl: window.location.href
    };
  }

  // ============================================================
  //  2. CHECK_EBULLETIN_PAGE
  //  Detect if we are on the actual eBulletin page
  // ============================================================

  function checkEbulletinPage() {
    const url = window.location.href.toLowerCase();
    const pageText = document.body ? document.body.textContent : '';
    const pageTextLower = pageText.toLowerCase();

    // Look for the header "AIRS / CAIRS Online Bulletin"
    const hasHeader = !!(
      findElementByText('h1, h2, h3, h4, [class*="header"], [class*="title"]', [
        'AIRS / CAIRS Online Bulletin',
        'AIRS/CAIRS Online Bulletin',
        'Online Bulletin'
      ]) ||
      pageTextLower.includes('airs / cairs online bulletin') ||
      pageTextLower.includes('airs/cairs online bulletin')
    );

    // Look for "WEEKLY eBulletin" tab
    const hasWeeklyTab = !!(
      findElementByText('a, button, [role="tab"], li, span, div', [
        'WEEKLY eBulletin',
        'Weekly eBulletin',
        'WEEKLY'
      ]) ||
      pageTextLower.includes('weekly ebulletin')
    );

    // Look for "DAILY eBulletin" tab
    const hasDailyTab = !!(
      findElementByText('a, button, [role="tab"], li, span, div', [
        'DAILY eBulletin',
        'Daily eBulletin',
        'DAILY'
      ]) ||
      pageTextLower.includes('daily ebulletin')
    );

    // Look for "Generate Weekly Report" button
    const hasGenerateButton = !!(
      findElementByText('button, input[type="button"], input[type="submit"], a, [role="button"]', [
        'Generate Weekly Report',
        'Generate Report',
        'Generate'
      ]) ||
      document.querySelector('[value*="Generate"], [title*="Generate"]')
    );

    // Look for "Generated Reports" section
    const hasGeneratedReports = !!(
      findElementByText('h1, h2, h3, h4, h5, span, div, th', [
        'Generated Reports',
        'generated reports'
      ]) ||
      pageTextLower.includes('generated reports')
    );

    // Look for download links
    const downloadLinks = findAllDownloadLinks();

    // Look for "Filter Options (WEEKLY)"
    const hasFilterOptions = pageTextLower.includes('filter options') ||
      pageTextLower.includes('edit selection criteria');

    // Look for subscription info
    const hasSubscription = pageTextLower.includes('subscription information') ||
      pageTextLower.includes('status: active');

    const hasDownloadLinks = downloadLinks.length > 0;

    const isEbulletinPage = hasHeader || (hasWeeklyTab && hasDailyTab) ||
      (hasGenerateButton && (hasWeeklyTab || hasFilterOptions)) ||
      hasGeneratedReports ||
      hasDownloadLinks ||
      (hasWeeklyTab && hasGenerateButton) ||
      url.includes('ebulletin') || url.includes('bulletin') ||
      url.includes('airs.iata') || url.includes('cairs.iata') ||
      (pageTextLower.includes('weekly') && pageTextLower.includes('bulletin')) ||
      (pageTextLower.includes('generate') && pageTextLower.includes('report') && pageTextLower.includes('bulletin'));

    return {
      isEbulletinPage,
      hasHeader,
      hasWeeklyTab,
      hasDailyTab,
      hasGenerateButton,
      hasGeneratedReports,
      hasFilterOptions,
      hasSubscription,
      hasDownloadLinks: downloadLinks.length > 0,
      downloadLinksCount: downloadLinks.length,
      links: downloadLinks.map(l => ({
        text: l.text,
        href: l.href,
        fileName: l.fileName
      })),
      currentUrl: window.location.href,
      title: document.title
    };
  }

  // ============================================================
  //  3. CLICK_WEEKLY_TAB
  //  Click "WEEKLY eBulletin" tab
  // ============================================================

  async function clickWeeklyTab() {
    log('Clicking WEEKLY eBulletin tab...');

    // Strategy 1: Find tab by text
    const tabSelectors = [
      'a', 'button', '[role="tab"]', 'li a', 'li button',
      '.tab', '[class*="tab"]', 'span', 'div[role="tab"]',
      '[class*="Tab"]', 'nav a', 'nav button'
    ];

    const tabTexts = [
      'WEEKLY eBulletin',
      'Weekly eBulletin',
      'WEEKLY',
      'Weekly'
    ];

    for (const sel of tabSelectors) {
      const el = findElementByText(sel, tabTexts);
      if (el) {
        log('Found weekly tab via:', sel);
        el.click();
        await waitForDomSettle(1000, 8000);
        return { success: true, message: 'Clicked WEEKLY eBulletin tab' };
      }
    }

    // Strategy 2: Find tab by class/attribute indicating "weekly"
    const weeklyByAttr = document.querySelector(
      '[data-tab="weekly"], [data-value="weekly"], [id*="weekly" i], ' +
      '[class*="weekly" i], [aria-label*="weekly" i], [title*="weekly" i], ' +
      '[href*="weekly" i]'
    );
    if (weeklyByAttr) {
      log('Found weekly tab via attribute selector');
      weeklyByAttr.click();
      await waitForDomSettle(1000, 8000);
      return { success: true, message: 'Clicked WEEKLY tab via attribute' };
    }

    // Strategy 3: If tabs are structured as a list, find the second tab
    // (DAILY = first, WEEKLY = second based on the page structure)
    const tabLists = document.querySelectorAll(
      '[role="tablist"], .nav-tabs, .tabs, [class*="tab-list"], ul[class*="tab"]'
    );
    for (const tabList of tabLists) {
      const tabs = tabList.querySelectorAll('[role="tab"], li, a, button');
      if (tabs.length >= 2) {
        // The second tab should be WEEKLY
        const secondTab = tabs[1];
        const text = (secondTab.textContent || '').trim().toLowerCase();
        if (text.includes('weekly') || text.includes('hebdomadaire')) {
          log('Found weekly tab as second in tablist');
          secondTab.click();
          await waitForDomSettle(1000, 8000);
          return { success: true, message: 'Clicked second tab in tablist (WEEKLY)' };
        }
      }
    }

    return {
      success: false,
      message: 'Could not find WEEKLY eBulletin tab',
      currentUrl: window.location.href
    };
  }

  // ============================================================
  //  4. GENERATE_REPORT
  //  Click "Generate Weekly Report" and wait for generation
  // ============================================================

  async function generateReport() {
    log('Clicking Generate Weekly Report...');

    // Find the button
    const buttonTexts = [
      'Generate Weekly Report',
      'Generate Report',
      'Generate',
      'Generer le rapport',
      'Generer'
    ];

    const buttonSelectors = [
      'button', 'input[type="button"]', 'input[type="submit"]',
      'a[role="button"]', '[role="button"]',
      '[class*="btn"]', '[class*="button"]'
    ];

    let generateBtn = null;

    // Strategy 1: Find by text
    for (const sel of buttonSelectors) {
      const el = findElementByText(sel, buttonTexts);
      if (el) { generateBtn = el; break; }
    }

    // Strategy 2: Find by value attribute (for <input type="button">)
    if (!generateBtn) {
      generateBtn = document.querySelector(
        'input[value*="Generate" i], button[value*="Generate" i], ' +
        '[title*="Generate" i], [aria-label*="Generate" i]'
      );
    }

    // Strategy 3: Find highlighted/styled generate button (yellow highlight)
    if (!generateBtn) {
      const allBtns = document.querySelectorAll('button, input[type="button"], input[type="submit"], a');
      for (const btn of allBtns) {
        const text = (btn.textContent || btn.value || '').trim().toLowerCase();
        if (text.includes('generate')) {
          generateBtn = btn;
          break;
        }
      }
    }

    if (!generateBtn) {
      return {
        success: false,
        message: 'Generate Weekly Report button not found',
        currentUrl: window.location.href
      };
    }

    // Record current download links count to detect new report
    const linksBefore = findAllDownloadLinks().length;

    log('Clicking generate button:', generateBtn.textContent || generateBtn.value);
    generateBtn.click();

    // Wait for report generation: either a loading indicator appears/disappears
    // or new download links appear in the "Generated Reports" section
    log('Waiting for report generation...');

    // Phase 1: Wait for any loading indicator to appear
    await wait(1000);

    // Phase 2: Wait for loading to finish (spinner disappears or new content appears)
    const maxWaitMs = 60000; // Reports can take up to 60 seconds
    const pollInterval = 2000;
    let elapsed = 0;
    let reportGenerated = false;

    while (elapsed < maxWaitMs) {
      await wait(pollInterval);
      elapsed += pollInterval;

      // Check for new download links
      const linksNow = findAllDownloadLinks();
      if (linksNow.length > linksBefore) {
        reportGenerated = true;
        log('New report detected! Links:', linksNow.length, '(was', linksBefore + ')');
        break;
      }

      // Check if a loading/spinner is still visible
      const spinner = document.querySelector(
        '.loading, .spinner, [class*="loading"], [class*="spinner"], ' +
        '[class*="progress"], [role="progressbar"], [class*="wait"]'
      );
      if (spinner && elapsed > 5000) {
        // Still loading, keep waiting
        log('Report generation in progress... (', elapsed / 1000, 's)');
        continue;
      }

      // Check for success/error messages
      const successMsg = findElementByText('div, span, p', [
        'Report generated', 'report has been generated', 'successfully generated',
        'Download', 'Your report is ready'
      ]);
      if (successMsg && elapsed > 3000) {
        reportGenerated = true;
        log('Report generation success message detected');
        break;
      }

      const errorMsg = findElementByText('div, span, p', [
        'error generating', 'failed to generate', 'unable to generate',
        'no data available', 'please try again'
      ]);
      if (errorMsg) {
        return {
          success: false,
          message: `Report generation error: ${errorMsg.textContent.trim().substring(0, 200)}`,
          currentUrl: window.location.href
        };
      }
    }

    // Final check
    const finalLinks = findAllDownloadLinks();

    return {
      success: reportGenerated || finalLinks.length > 0,
      message: reportGenerated
        ? `Report generated successfully. ${finalLinks.length} download link(s) available.`
        : finalLinks.length > 0
          ? `${finalLinks.length} download link(s) found (report may have already existed).`
          : 'Generate clicked but could not confirm report creation within timeout.',
      downloadLinksCount: finalLinks.length,
      waitedMs: elapsed,
      currentUrl: window.location.href
    };
  }

  // ============================================================
  //  5. DOWNLOAD_LATEST_EBULLETIN
  //  Find and download the most recent CSV/Excel from Generated Reports
  // ============================================================

  async function downloadLatestEbulletin() {
    const downloadLinks = findAllDownloadLinks();

    if (downloadLinks.length === 0) {
      return {
        success: false,
        error: 'No eBulletin download links found on the current page',
        currentUrl: window.location.href
      };
    }

    // Sort by date descending (most recent first)
    const sorted = sortByDateDescending(downloadLinks);
    const target = sorted[0];

    log('Downloading:', target.fileName, 'from', target.href);

    try {
      const response = await fetch(target.href, {
        credentials: 'include',
        redirect: 'follow'
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Download failed with HTTP ${response.status}: ${response.statusText}`,
          fileName: target.fileName,
          url: target.href
        };
      }

      const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
      const buffer = await response.arrayBuffer();
      const base64Data = arrayBufferToBase64(buffer);

      // Extract filename from Content-Disposition header if available
      let fileName = target.fileName;
      const disposition = response.headers.get('Content-Disposition');
      if (disposition) {
        const match = disposition.match(/filename[^;=\n]*=["']?([^"';\n]+)/i);
        if (match && match[1]) {
          fileName = match[1].trim();
        }
      }

      return {
        success: true,
        data: base64Data,
        fileName,
        fileSize: buffer.byteLength,
        mimeType: contentType,
        sourceUrl: target.href,
        allFiles: sorted.map(l => ({ fileName: l.fileName, href: l.href, date: l.date }))
      };
    } catch (err) {
      return {
        success: false,
        error: `Fetch error: ${err.message}`,
        fileName: target.fileName,
        url: target.href
      };
    }
  }

  // ============================================================
  //  GET_EBULLETIN_LIST
  // ============================================================

  function getEbulletinList() {
    const downloadLinks = findAllDownloadLinks();
    return {
      files: downloadLinks.map(link => ({
        name: link.fileName || link.text || 'Unknown',
        url: link.href,
        date: link.date || null,
        type: link.type || 'unknown'
      })),
      totalFiles: downloadLinks.length,
      currentUrl: window.location.href
    };
  }

  // ============================================================
  //  Download link discovery (eBulletin Generated Reports)
  // ============================================================

  function findAllDownloadLinks() {
    const results = [];
    const seen = new Set();

    const allAnchors = document.querySelectorAll('a[href]');

    for (const a of allAnchors) {
      const href = a.href || '';
      const text = (a.textContent || '').trim();
      const hrefLower = href.toLowerCase();
      const textLower = text.toLowerCase();

      // Skip empty or javascript: hrefs
      if (!href || href.startsWith('javascript:')) continue;

      // Pattern 1: "(Download)" links in the Generated Reports section
      if (textLower === '(download)' || textLower === 'download' || textLower === 'download all') {
        if (!seen.has(href)) {
          seen.add(href);
          results.push({
            href,
            text,
            fileName: extractFileName(href, text, a),
            date: extractDateFromContext(a),
            type: textLower === 'download all' ? 'download-all' : 'download'
          });
        }
        continue;
      }

      // Pattern 2: CSV file links
      const isCsvLink = hrefLower.endsWith('.csv') || hrefLower.includes('.csv?') ||
        /\.csv\b/i.test(hrefLower) ||
        textLower.includes('.csv') ||
        textLower.includes('ebulletin weekly report');

      // Pattern 3: Excel file links
      const isExcelLink = hrefLower.endsWith('.xlsx') || hrefLower.endsWith('.xls') ||
        hrefLower.includes('.xlsx?') || hrefLower.includes('.xls?') ||
        /\.xlsx?\b/i.test(hrefLower);

      if ((isCsvLink || isExcelLink) && !seen.has(href)) {
        seen.add(href);
        results.push({
          href,
          text,
          fileName: extractFileName(href, text, a),
          date: extractDateFromContext(a) || extractDateFromText(text) || extractDateFromText(href),
          type: isCsvLink ? 'csv' : 'excel'
        });
      }

      // Pattern 4: Salesforce ContentDocument / ContentVersion download URLs
      const sfPatterns = [
        '/sfc/servlet.shepherd/document/download/',
        '/sfc/servlet.shepherd/version/download/',
        '/servlet/servlet.FileDownload',
        '/sfc/dist/version/download/',
        '/ContentDocument/',
        '/ContentVersion/'
      ];
      for (const pattern of sfPatterns) {
        if (href.includes(pattern) && !seen.has(href)) {
          seen.add(href);
          results.push({
            href,
            text,
            fileName: extractFileName(href, text, a),
            date: extractDateFromContext(a) || extractDateFromText(text),
            type: 'salesforce'
          });
          break;
        }
      }
    }

    // Pattern 5: Download buttons (non-anchor)
    const downloadButtons = document.querySelectorAll(
      'button[class*="download" i], [data-action="download"], ' +
      '[title*="Download" i], [aria-label*="Download" i]'
    );
    for (const btn of downloadButtons) {
      const href = btn.getAttribute('data-url') || btn.getAttribute('data-download-url') ||
        btn.getAttribute('data-href') || '';
      const text = (btn.textContent || '').trim();
      if (href && !seen.has(href)) {
        seen.add(href);
        results.push({
          href: href.startsWith('http') ? href : window.location.origin + href,
          text,
          fileName: extractFileName(href, text, btn),
          date: extractDateFromContext(btn) || extractDateFromText(text),
          type: 'button'
        });
      }
    }

    return results;
  }

  /**
   * Extract filename from URL, link text, or nearby context.
   */
  function extractFileName(href, text, element) {
    // Check nearby text for report names like "EBulletin Weekly Report 28-JUN-2025 - 4-JUL-2025.csv"
    if (element) {
      const parent = element.parentElement;
      if (parent) {
        const contextText = (parent.textContent || '').trim();
        const reportMatch = contextText.match(/(eBulletin\s+Weekly\s+Report\s+[\w\d\s\-]+\.(?:csv|xlsx?))/i);
        if (reportMatch) return reportMatch[1].trim();
      }
    }

    // Try filename from URL path
    try {
      const url = new URL(href, window.location.origin);
      const pathParts = url.pathname.split('/');
      const lastPart = decodeURIComponent(pathParts[pathParts.length - 1]);
      if (lastPart && /\.\w{2,5}$/.test(lastPart)) return lastPart;
    } catch { /* not a valid URL */ }

    // Check text for filename patterns
    if (text && /\.(xlsx?|csv)\b/i.test(text)) return text;

    // Check for filename in query params
    const filenameMatch = href.match(/filename[=]([^&]+)/i);
    if (filenameMatch) return decodeURIComponent(filenameMatch[1]);

    return text || 'ebulletin-report.csv';
  }

  /**
   * Extract date from the context surrounding a download link element.
   * The report entries often have dates nearby like "28-JUN-2025 - 4-JUL-2025"
   */
  function extractDateFromContext(element) {
    if (!element) return null;

    // Check the parent/row for date strings
    const contexts = [
      element.parentElement,
      element.closest('tr'),
      element.closest('li'),
      element.closest('div'),
      element.closest('[class*="report"]'),
      element.closest('[class*="row"]')
    ].filter(Boolean);

    for (const ctx of contexts) {
      const text = (ctx.textContent || '').trim();
      const date = extractDateFromText(text);
      if (date) return date;
    }

    return null;
  }

  function extractDateFromText(text) {
    if (!text) return null;

    // Pattern: D-MMM-YYYY (e.g., "28-JUN-2025", "4-JUL-2025")
    const months3 = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const monthPattern = months3.join('|');
    const regex3 = new RegExp(`(\\d{1,2})-(${monthPattern})-(\\d{4})`, 'gi');
    const matches3 = [...text.matchAll(regex3)];
    if (matches3.length > 0) {
      // Take the last date in the range (end date is more recent)
      const m = matches3[matches3.length - 1];
      const day = m[1].padStart(2, '0');
      const monthIdx = months3.indexOf(m[2].toLowerCase());
      const month = String(monthIdx + 1).padStart(2, '0');
      return `${m[3]}-${month}-${day}`;
    }

    // Pattern: YYYY-MM-DD
    let match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) return match[0];

    // Pattern: DD/MM/YYYY or DD-MM-YYYY
    match = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) {
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }

    // Pattern: Month DD, YYYY or DD Month YYYY
    const fullMonths = [
      'january','february','march','april','may','june',
      'july','august','september','october','november','december'
    ];
    const fullPattern = [...fullMonths, ...months3].join('|');
    const regex = new RegExp(`(${fullPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i');
    match = text.match(regex);
    if (match) {
      const monthStr = match[1].toLowerCase().substring(0, 3);
      const monthIndex = months3.indexOf(monthStr);
      if (monthIndex >= 0) {
        return `${match[3]}-${String(monthIndex + 1).padStart(2, '0')}-${match[2].padStart(2, '0')}`;
      }
    }

    return null;
  }

  function sortByDateDescending(links) {
    const withDates = links.filter(l => l.date);
    const withoutDates = links.filter(l => !l.date);
    withDates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    return [...withDates, ...withoutDates];
  }

  // ============================================================
  //  6. NAVIGATE_TO_CODE_SEARCH
  //  Navigate to IATA Code Search service from portal
  // ============================================================

  async function navigateToCodeSearch() {
    log('Navigating to IATA Code Search...');

    const result = await clickServiceTile(
      [
        'IATA Code Search',
        'Code Search',
        'Agency Code Search',
        'Search IATA Code',
        'Agent Code Search',
        'Code Lookup'
      ],
      [
        '/s/iata-code-search',
        '/s/code-search',
        '/s/agent-search',
        '/s/agency-code-search',
        '/s/search',
        '/s/iata-code'
      ]
    );

    return { ...result, currentUrl: window.location.href };
  }

  // ============================================================
  //  7. SEARCH_IATA_CODE
  //  Enter code, click Search, scrape all agent details
  // ============================================================

  async function searchIataCode(payload) {
    const code = payload?.iataCode || payload?.code;
    if (!code) return { success: false, error: 'No IATA code provided' };

    log('Searching IATA code:', code);

    // Step 1: Find the search input field
    const inputSelectors = [
      'input[placeholder*="IATA Code" i]',
      'input[placeholder*="Code" i]',
      'input[placeholder*="Search" i]',
      'input[name*="code" i]',
      'input[name*="search" i]',
      'input[id*="code" i]',
      'input[id*="search" i]',
      'input[type="text"]',
      'input[type="search"]',
      'input:not([type="hidden"]):not([type="password"])'
    ];

    let searchInput = null;
    for (const sel of inputSelectors) {
      const candidates = document.querySelectorAll(sel);
      for (const el of candidates) {
        // Skip hidden elements
        if (el.offsetParent === null && !el.closest('[style*="display: none"]')) continue;
        // Prefer inputs near "IATA Code" label
        const label = el.closest('label') || document.querySelector(`label[for="${el.id}"]`);
        if (label && (label.textContent || '').toLowerCase().includes('code')) {
          searchInput = el;
          break;
        }
        if (!searchInput) searchInput = el;
      }
      if (searchInput) break;
    }

    if (!searchInput) {
      return { success: false, error: 'IATA Code search input field not found' };
    }

    // Step 2: Fill in the code
    await fillInput(searchInput, code);
    await wait(500);

    // Step 3: Click Search button
    const searchBtn = findElementByText(
      'button, input[type="submit"], input[type="button"], a[role="button"], [role="button"]',
      ['Search', 'Rechercher', 'Find', 'Go', 'Lookup']
    ) || document.querySelector(
      'button[type="submit"], input[type="submit"], ' +
      '[class*="search-btn" i], [class*="searchBtn" i], ' +
      'button[aria-label*="Search" i]'
    );

    if (searchBtn) {
      log('Clicking search button');
      searchBtn.click();
    } else {
      // Try submitting via Enter key
      log('No search button found, pressing Enter');
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
      searchInput.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'Enter', keyCode: 13 }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
      // Also try form submission
      const form = searchInput.closest('form');
      if (form) form.submit();
    }

    // Step 4: Wait for results to load
    await wait(2000);
    await waitForDomSettle(1000, 15000);
    await wait(1000);

    // Step 5: Scrape the agent details
    const agentData = scrapeCodeSearchResults();

    return {
      success: !!(agentData && (agentData.iataCode || agentData.legalName)),
      data: agentData,
      searchedCode: code,
      currentUrl: window.location.href
    };
  }

  /**
   * Scrape all fields from the IATA Code Search results page.
   */
  function scrapeCodeSearchResults() {
    const data = {};

    // Core fields from the results
    const fields = [
      { key: 'iataCode', labels: ['IATA Code', 'Code IATA', 'Agency Code'] },
      { key: 'locationType', labels: ['Location type', 'Location Type', 'Type de localisation'] },
      { key: 'legalName', labels: ['Legal name', 'Legal Name', 'Nom legal', 'Raison sociale'] },
      { key: 'tradeName', labels: ['Trade Name', 'Trade name', 'Nom commercial'] },
      { key: 'status', labels: ['Status', 'Statut'] },
      { key: 'country', labels: ['Country', 'Pays'] },
      { key: 'accreditationDate', labels: ['Accreditation date', 'Accreditation Date', 'Date d\'accreditation'] },
      { key: 'remittanceFrequency', labels: ['Remittance frequency', 'Remittance Frequency', 'Frequence de remise'] },
      { key: 'accreditationType', labels: ['Accreditation Type', 'Accreditation type', 'Type d\'accreditation'] },
      { key: 'riskStatus', labels: ['Risk Status', 'Risk status', 'Statut de risque'] },
      { key: 'validFinancialSecurity', labels: ['Valid Financial Security', 'Financial Security', 'Garantie financiere'] },
      { key: 'remittanceHoldingCapacity', labels: ['Remittance Holding Capacity', 'RHC', 'Capacite de retenue'] }
    ];

    for (const field of fields) {
      for (const label of field.labels) {
        const value = scrapeLabelValue(label);
        if (value) {
          data[field.key] = value;
          break;
        }
      }
    }

    // Scrape "Available Forms of Payment" section
    data.formsOfPayment = scrapeFormsOfPayment();

    // Scrape "Risk Events History" table
    data.riskEventsHistory = scrapeRiskEventsHistory();

    return data;
  }

  /**
   * Scrape the Available Forms of Payment section.
   * Looks for Cash, IATA EasyPay, Credit Card with check/x indicators.
   */
  function scrapeFormsOfPayment() {
    const fop = {};

    // Find the section
    const sectionHeader = findElementByText(
      'h1, h2, h3, h4, h5, th, span, div, strong',
      ['Available Forms of Payment', 'Forms of Payment', 'Moyens de paiement']
    );

    const section = sectionHeader
      ? (sectionHeader.closest('section') || sectionHeader.closest('div') || sectionHeader.closest('table') || sectionHeader.parentElement)
      : document;

    const paymentTypes = ['Cash', 'IATA EasyPay', 'Credit Card'];

    for (const payType of paymentTypes) {
      const label = findElementByText('td, th, span, div, li, dt', [payType], { parent: section });
      if (!label) continue;

      // Look for check/x icon or text nearby
      const row = label.closest('tr') || label.closest('li') || label.closest('div') || label.parentElement;
      if (!row) continue;

      const rowText = row.textContent || '';
      const rowHtml = row.innerHTML || '';

      // Check for visual indicators
      const hasCheck = rowHtml.includes('check') || rowHtml.includes('tick') ||
        rowHtml.includes('✓') || rowHtml.includes('✔') ||
        rowHtml.includes('greenTick') || rowHtml.includes('approved') ||
        row.querySelector('[class*="check" i], [class*="tick" i], [class*="success" i], [class*="green" i]');

      const hasX = rowHtml.includes('cross') || rowHtml.includes('×') ||
        rowHtml.includes('✗') || rowHtml.includes('✘') ||
        rowHtml.includes('redCross') || rowHtml.includes('denied') ||
        row.querySelector('[class*="cross" i], [class*="close" i], [class*="error" i], [class*="red" i]');

      fop[payType] = hasCheck ? 'Available' : hasX ? 'Not Available' : 'Unknown';
    }

    return Object.keys(fop).length > 0 ? fop : null;
  }

  /**
   * Scrape the Risk Events History table.
   */
  function scrapeRiskEventsHistory() {
    const sectionHeader = findElementByText(
      'h1, h2, h3, h4, h5, th, span, div, caption, strong',
      ['Risk Events History', 'Risk Event History', 'Historique des evenements']
    );

    if (!sectionHeader) return [];

    // Find the closest table
    const container = sectionHeader.closest('section') || sectionHeader.closest('div') ||
      sectionHeader.parentElement;
    const table = container ? container.querySelector('table') : null;

    if (!table) return [];

    return scrapeTable(table);
  }

  /**
   * Generic table scraper: extract header row + data rows as array of objects.
   */
  function scrapeTable(table) {
    const headers = [];
    const rows = [];

    const headerCells = table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td');
    for (const cell of headerCells) {
      headers.push((cell.textContent || '').trim());
    }

    if (headers.length === 0) return [];

    const bodyRows = table.querySelectorAll('tbody tr, tr');
    let isFirst = true;
    for (const tr of bodyRows) {
      // Skip header row
      if (isFirst && tr.querySelector('th')) { isFirst = false; continue; }
      isFirst = false;

      const cells = tr.querySelectorAll('td');
      if (cells.length === 0) continue;

      const rowObj = {};
      cells.forEach((cell, idx) => {
        const header = headers[idx] || `col${idx}`;
        rowObj[header] = (cell.textContent || '').trim();
      });
      rows.push(rowObj);
    }

    return rows;
  }

  // ============================================================
  //  8. NAVIGATE_TO_SMART
  //  Navigate to SMART Risk Management service
  // ============================================================

  async function navigateToSmart() {
    log('Navigating to SMART Risk Management...');

    const result = await clickServiceTile(
      [
        'SMART Risk Management',
        'SMART',
        'Risk Management',
        'SMART Risk',
        'Smart Risk Management'
      ],
      [
        '/s/smart',
        '/s/smart-risk-management',
        '/s/risk-management',
        '/s/smart-risk',
        '/s/services/smart'
      ]
    );

    return { ...result, currentUrl: window.location.href };
  }

  // ============================================================
  //  9. SEARCH_SMART_AGENT
  //  Search an agent by code in SMART and scrape the profile
  // ============================================================

  async function searchSmartAgent(payload) {
    const code = payload?.iataCode || payload?.code;
    if (!code) return { success: false, error: 'No agent code provided' };

    log('Searching SMART agent:', code);

    // Step 1: Find the SMART search input
    const inputSelectors = [
      'input[placeholder*="Search" i]',
      'input[placeholder*="IATA" i]',
      'input[placeholder*="Agent" i]',
      'input[placeholder*="Code" i]',
      'input[name*="search" i]',
      'input[name*="agent" i]',
      'input[id*="search" i]',
      'input[type="search"]',
      'input[type="text"]:not([type="hidden"]):not([type="password"])'
    ];

    let searchInput = null;
    for (const sel of inputSelectors) {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        searchInput = el;
        break;
      }
    }

    if (!searchInput) {
      // Try clicking on "Agent Profile" tab first if it exists
      const profileTab = findElementByText(
        'a, button, [role="tab"], li, span',
        ['Agent Profile', 'Agent', 'Profile']
      );
      if (profileTab) {
        profileTab.click();
        await wait(1500);
        // Retry finding input
        for (const sel of inputSelectors) {
          const el = document.querySelector(sel);
          if (el && el.offsetParent !== null) { searchInput = el; break; }
        }
      }
    }

    if (!searchInput) {
      return { success: false, error: 'SMART search input not found' };
    }

    // Step 2: Fill in the code
    await fillInput(searchInput, code);
    await wait(500);

    // Step 3: Click Search or press Enter
    const searchBtn = findElementByText(
      'button, input[type="submit"], input[type="button"], [role="button"]',
      ['Search', 'Go', 'Find', 'Lookup']
    ) || document.querySelector(
      'button[type="submit"], [class*="search-btn" i]'
    );

    if (searchBtn) {
      searchBtn.click();
    } else {
      searchInput.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
      searchInput.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: 'Enter', keyCode: 13 }));
      searchInput.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
    }

    // Step 4: Wait for results
    await wait(2000);
    await waitForDomSettle(1000, 15000);
    await wait(1000);

    // Step 5: If results show a list, click the first matching agent
    const resultLink = findElementByText(
      'a, [role="link"], tr, [class*="result"]',
      [code]
    );
    if (resultLink) {
      const clickTarget = resultLink.closest('a') || resultLink;
      clickTarget.click();
      await wait(2000);
      await waitForDomSettle(1000, 10000);
    }

    // Step 6: Scrape the SMART agent profile
    const profileData = scrapeSmartProfile();

    return {
      success: !!(profileData && (profileData.iataCode || profileData.name)),
      data: profileData,
      searchedCode: code,
      currentUrl: window.location.href
    };
  }

  /**
   * Scrape all data from a SMART agent profile page.
   */
  function scrapeSmartProfile() {
    const data = {};

    // Core profile fields
    const fields = [
      { key: 'name', labels: ['Name', 'Agent Name', 'Nom'] },
      { key: 'status', labels: ['Status', 'Statut', 'Approved'] },
      { key: 'iataCode', labels: ['IATA Code', 'Code IATA', 'Agency Code'] },
      { key: 'accreditationType', labels: ['Accreditation Type', 'Accreditation type'] },
      { key: 'locationType', labels: ['Location Type', 'Location type'] },
      { key: 'accreditationDate', labels: ['Accreditation date', 'Accreditation Date'] },
      { key: 'remittanceHoldingCapacity', labels: ['Remittance Holding Capacity', 'RHC'] },
      { key: 'financialSecurityUtilization', labels: ['Financial Security Utilization', 'FS Utilization'] },
      { key: 'riskStatus', labels: ['Risk Status', 'Risk status'] },
      { key: 'rhcConsumed', labels: ['RHC Consumed', 'Consumed RHC', 'RHC Consumed %'] },
      { key: 'remittanceFrequency', labels: ['Remittance Freq', 'Remittance Frequency', 'Remittance freq'] },
      { key: 'country', labels: ['Country', 'Pays', 'BSP Country'] },
      { key: 'region', labels: ['Region', 'Region'] }
    ];

    for (const field of fields) {
      for (const label of field.labels) {
        const value = scrapeLabelValue(label);
        if (value) {
          data[field.key] = value;
          break;
        }
      }
    }

    // Scrape Available Forms of Payment
    data.formsOfPayment = scrapeFormsOfPayment();

    // Scrape Ownership & Shares section
    data.ownershipAndShares = scrapeSmartSection('Ownership & Shares', 'Ownership');

    // Scrape Agent Hierarchy section
    data.agentHierarchy = scrapeSmartSection('Agent Hierarchy', 'Hierarchy');

    // Scrape Contact Details section
    data.contactDetails = scrapeSmartContactDetails();

    // Scrape Risk Event History
    data.riskEventHistory = scrapeRiskEventsHistory();

    // Scrape any metrics/cards (Financial Security Utilization, etc.)
    data.metrics = scrapeSmartMetrics();

    return data;
  }

  /**
   * Scrape a named section from the SMART page.
   * Returns table data if found, or key-value pairs.
   */
  function scrapeSmartSection(sectionTitle, altTitle) {
    const header = findElementByText(
      'h1, h2, h3, h4, h5, th, span, div, strong, caption',
      [sectionTitle, altTitle].filter(Boolean)
    );

    if (!header) return null;

    const container = header.closest('section') || header.closest('div') ||
      header.closest('[class*="card"]') || header.parentElement;
    if (!container) return null;

    // Try to find a table
    const table = container.querySelector('table');
    if (table) return scrapeTable(table);

    // Otherwise extract key-value pairs
    const pairs = {};
    const rows = container.querySelectorAll('div, p, li, dl');
    for (const row of rows) {
      const text = (row.textContent || '').trim();
      const colonMatch = text.match(/^(.+?)[:]\s*(.+)$/);
      if (colonMatch) {
        pairs[colonMatch[1].trim()] = colonMatch[2].trim();
      }
    }

    return Object.keys(pairs).length > 0 ? pairs : null;
  }

  /**
   * Scrape Contact Details from SMART profile.
   */
  function scrapeSmartContactDetails() {
    const contactLabels = [
      'Email', 'Phone', 'Telephone', 'Fax', 'Address',
      'City', 'Postal Code', 'ZIP', 'Contact'
    ];

    const details = {};
    for (const label of contactLabels) {
      const value = scrapeLabelValue(label);
      if (value) details[label.toLowerCase()] = value;
    }

    return Object.keys(details).length > 0 ? details : null;
  }

  /**
   * Scrape SMART metric cards/badges (utilization %, risk status, etc.).
   */
  function scrapeSmartMetrics() {
    const metrics = {};

    // Look for metric-style elements (cards with large numbers/percentages)
    const metricSelectors = [
      '[class*="metric"]', '[class*="stat"]', '[class*="kpi"]',
      '[class*="gauge"]', '[class*="progress"]',
      '[class*="card-body"]', '[class*="summary"]'
    ];

    for (const sel of metricSelectors) {
      const elements = document.querySelectorAll(sel);
      for (const el of elements) {
        const text = (el.textContent || '').trim();
        // Look for percentage values
        const pctMatch = text.match(/(\d+(?:\.\d+)?)\s*%/);
        if (pctMatch) {
          // Try to find a label nearby
          const parent = el.parentElement;
          const label = parent ? (parent.textContent || '').replace(text, '').trim() : '';
          if (label) metrics[label.substring(0, 60)] = pctMatch[0];
        }
      }
    }

    return Object.keys(metrics).length > 0 ? metrics : null;
  }

  // ============================================================
  //  SMART Lite Navigation & Scraping
  // ============================================================

  async function navigateToSmartLite() {
    log('Navigating to SMART Lite...');

    const result = await clickServiceTile(
      [
        'SMART Lite',
        'SMARTLite',
        'Smart Lite'
      ],
      [
        '/s/smart-lite',
        '/s/smartlite',
        '/s/smart-lite-risk'
      ]
    );

    return { ...result, currentUrl: window.location.href };
  }

  async function scrapeSmartLite(payload) {
    const { filters } = payload || {};

    // Apply filters if provided
    if (filters) {
      await applySmartLiteFilters(filters);
    }

    // Wait for the data table to be present
    await wait(2000);
    await waitForDomSettle(1000, 10000);

    // Scrape the main data table
    const table = document.querySelector(
      'table, [role="grid"], lightning-datatable, [class*="datatable"]'
    );

    if (!table) {
      return {
        success: false,
        error: 'SMART Lite data table not found',
        currentUrl: window.location.href
      };
    }

    const rows = scrapeTable(table);

    // Scrape filter values for context
    const activeFilters = scrapeSmartLiteFilters();

    // Scrape bottom tabs info (Legend, GoStandard, GoLite, GoGlobal)
    const tabs = [];
    const tabElements = document.querySelectorAll(
      '[role="tab"], .tab, [class*="tab"]'
    );
    for (const tab of tabElements) {
      const text = (tab.textContent || '').trim();
      if (['Legend', 'GoStandard', 'GoLite', 'GoGlobal'].some(t => text.includes(t))) {
        tabs.push(text);
      }
    }

    return {
      success: rows.length > 0,
      data: rows,
      totalRows: rows.length,
      activeFilters,
      availableTabs: tabs,
      currentUrl: window.location.href
    };
  }

  async function applySmartLiteFilters(filters) {
    // filters may contain: { iataCode, bspCountry, region, financialSecurity, consumedRhcPct, fsUtilization }
    const filterMap = {
      iataCode: ['IATA Code', 'Code'],
      bspCountry: ['BSP Country', 'Country'],
      region: ['Region'],
      financialSecurity: ['Financial Security'],
      consumedRhcPct: ['Consumed RHC%', 'Consumed RHC'],
      fsUtilization: ['FS Utilization', 'Financial Security Utilization'],
      openCashPosition: ['Open Cash Position']
    };

    for (const [key, labels] of Object.entries(filterMap)) {
      if (!filters[key]) continue;

      // Find the filter input by its label
      for (const label of labels) {
        const labelEl = findElementByText('label, span, div', [label]);
        if (!labelEl) continue;

        const container = labelEl.closest('div') || labelEl.parentElement;
        if (!container) continue;

        const input = container.querySelector('input, select, [role="combobox"]');
        if (input) {
          if (input.tagName === 'SELECT') {
            input.value = filters[key];
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } else {
            await fillInput(input, filters[key]);
          }
          await wait(500);
          break;
        }
      }
    }

    // Click Apply/Search if there is one
    const applyBtn = findElementByText(
      'button, [role="button"]',
      ['Apply', 'Search', 'Filter', 'Go']
    );
    if (applyBtn) {
      applyBtn.click();
      await wait(2000);
      await waitForDomSettle(1000, 10000);
    }
  }

  function scrapeSmartLiteFilters() {
    const filters = {};

    const filterLabels = [
      'Open Cash Position', 'IATA Code', 'BSP Country',
      'Region', 'Financial Security', 'Consumed RHC%', 'FS Utilization'
    ];

    for (const label of filterLabels) {
      const labelEl = findElementByText('label, span, div', [label]);
      if (!labelEl) continue;

      const container = labelEl.closest('div') || labelEl.parentElement;
      if (!container) continue;

      const input = container.querySelector('input, select, [role="combobox"]');
      if (input) {
        const value = input.value || input.textContent || '';
        if (value.trim()) filters[label] = value.trim();
      }
    }

    return Object.keys(filters).length > 0 ? filters : null;
  }

  // ============================================================
  //  Signal that content script is loaded
  // ============================================================

  log('Content script loaded on:', window.location.href);

})();
