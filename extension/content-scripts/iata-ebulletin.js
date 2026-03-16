// ============================================================
// APG BSP Link - IATA eBulletin Content Script
// Injected into portal.iata.org for eBulletin/Risk Management
// navigation, detection, and Excel file download
// ============================================================

(function () {
  'use strict';

  // ---- Message Handler ----
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message).then(sendResponse).catch(err => {
      console.error('[APG eBulletin] Error handling message:', err);
      sendResponse({ error: err.message });
    });
    return true; // Keep channel open for async response
  });

  async function handleMessage(message) {
    switch (message.type) {
      case 'NAVIGATE_TO_EBULLETIN':
        return await navigateToEbulletin();
      case 'CHECK_EBULLETIN_PAGE':
        return checkEbulletinPage();
      case 'DOWNLOAD_LATEST_EBULLETIN':
        return await downloadLatestEbulletin();
      case 'GET_EBULLETIN_LIST':
        return getEbulletinList();
      case 'PING':
        return { status: 'alive', url: window.location.href };
      default:
        return { error: 'Unknown message type' };
    }
  }

  // ============================================================
  // NAVIGATE_TO_EBULLETIN
  // Attempts multiple strategies to reach the eBulletin /
  // Risk Management section on the IATA Salesforce portal
  // ============================================================

  async function navigateToEbulletin() {
    const strategies = [
      tryDirectUrlNavigation,
      trySidebarNavigation,
      tryTopNavigation,
      tryMegaMenuNavigation,
      trySearchForLinks
    ];

    for (const strategy of strategies) {
      try {
        const result = await strategy();
        if (result && result.success) {
          return {
            success: true,
            currentUrl: window.location.href,
            message: result.message || 'Navigated to eBulletin section'
          };
        }
      } catch (err) {
        console.warn('[APG eBulletin] Strategy failed:', err.message);
      }
    }

    return {
      success: false,
      currentUrl: window.location.href,
      message: 'Could not navigate to eBulletin section. No matching navigation link found.'
    };
  }

  // Strategy 1: Try known direct URL patterns for the portal
  async function tryDirectUrlNavigation() {
    const candidateUrls = [
      '/s/ebulletin',
      '/s/risk-management',
      '/s/risk-management-ebulletin',
      '/s/ebulletin-risk-management',
      '/s/weekly-ebulletin',
      '/s/article/eBulletin',
      '/s/topic/0TO5G000000kGjTWAU/ebulletin' // Example Salesforce topic ID
    ];

    const baseUrl = window.location.origin;

    for (const path of candidateUrls) {
      try {
        const testUrl = baseUrl + path;
        const response = await fetch(testUrl, {
          method: 'HEAD',
          credentials: 'include',
          redirect: 'follow'
        });
        // Accept 200 or any 3xx that resolved (fetch follows redirects)
        if (response.ok) {
          window.location.href = testUrl;
          await waitForElement('body', 10000);
          return { success: true, message: `Navigated via direct URL: ${path}` };
        }
      } catch {
        // URL does not exist, try next
      }
    }

    return { success: false };
  }

  // Strategy 2: Look for links in the sidebar navigation
  async function trySidebarNavigation() {
    const sidebarSelectors = [
      'nav a', '.sidebar a', '.slds-nav-vertical a',
      '[class*="sidebar"] a', '[class*="navigation"] a',
      '.comm-navigation a', 'lightning-navigation a',
      '[class*="nav-item"] a', '.slds-nav-vertical__action'
    ];

    return await findAndClickNavLink(sidebarSelectors);
  }

  // Strategy 3: Look for links in the top navigation bar
  async function tryTopNavigation() {
    const topNavSelectors = [
      'header a', '.slds-global-header a',
      '[class*="header"] a', '[class*="topnav"] a',
      '.comm-header a', '[class*="navbar"] a',
      '.slds-tabs_default__link', '[role="menubar"] a',
      '[class*="app-nav"] a'
    ];

    return await findAndClickNavLink(topNavSelectors);
  }

  // Strategy 4: Open mega menu / dropdown menus and look inside
  async function tryMegaMenuNavigation() {
    // First, try to open any dropdown/mega menu triggers
    const menuTriggers = document.querySelectorAll(
      '[class*="dropdown-trigger"], [class*="menu-trigger"], ' +
      'button[aria-haspopup="true"], [class*="has-submenu"], ' +
      '[role="menuitem"][aria-expanded="false"]'
    );

    for (const trigger of menuTriggers) {
      try {
        trigger.click();
        await wait(500);

        // Now look for eBulletin links in any newly-opened menus
        const menuLinks = document.querySelectorAll(
          '[class*="dropdown"] a, [class*="menu"] a, ' +
          '[role="menu"] a, [class*="submenu"] a, ' +
          '.slds-dropdown a, .slds-popover a'
        );

        const link = findEbulletinLink(menuLinks);
        if (link) {
          link.click();
          await waitForNavigation(10000);
          return { success: true, message: 'Navigated via mega menu link' };
        }
      } catch {
        // Menu trigger did not work, continue
      }
    }

    return { success: false };
  }

  // Strategy 5: Broad search across all links on the page
  async function trySearchForLinks() {
    const allLinks = document.querySelectorAll('a');
    const link = findEbulletinLink(allLinks);

    if (link) {
      link.click();
      await waitForNavigation(10000);
      return { success: true, message: 'Navigated via page link: ' + link.textContent.trim() };
    }

    return { success: false };
  }

  // Shared helper: find and click a navigation link matching eBulletin keywords
  async function findAndClickNavLink(selectors) {
    for (const selector of selectors) {
      try {
        const links = document.querySelectorAll(selector);
        const link = findEbulletinLink(links);
        if (link) {
          link.click();
          await waitForNavigation(10000);
          return { success: true, message: `Navigated via: ${selector}` };
        }
      } catch {
        // Selector invalid or no matches
      }
    }
    return { success: false };
  }

  // Match a link's text or href against eBulletin-related keywords
  function findEbulletinLink(links) {
    const keywords = [
      'ebulletin', 'e-bulletin', 'risk management',
      'bulletin', 'weekly bulletin', 'weekly ebulletin',
      'risk alert', 'fraud prevention'
    ];

    // Prioritise exact keyword matches in link text
    for (const link of links) {
      const text = (link.textContent || '').trim().toLowerCase();
      const href = (link.href || '').toLowerCase();

      for (const keyword of keywords) {
        if (text.includes(keyword) || href.includes(keyword.replace(/\s/g, '-'))) {
          return link;
        }
      }
    }
    return null;
  }

  // ============================================================
  // CHECK_EBULLETIN_PAGE
  // Determines whether the current page contains eBulletin content
  // ============================================================

  function checkEbulletinPage() {
    const url = window.location.href.toLowerCase();
    const pageText = document.body ? document.body.textContent.toLowerCase() : '';
    const title = document.title.toLowerCase();

    // Check headings for eBulletin references
    const headings = document.querySelectorAll('h1, h2, h3, h4');
    let hasEbulletinHeading = false;
    for (const h of headings) {
      const hText = h.textContent.toLowerCase();
      if (hText.includes('ebulletin') || hText.includes('e-bulletin') ||
          hText.includes('risk management') || hText.includes('bulletin')) {
        hasEbulletinHeading = true;
        break;
      }
    }

    // Look for download links
    const downloadLinks = findAllDownloadLinks();

    // Look for file listing tables
    const hasFileTable = !!document.querySelector(
      'table[class*="file"], table[class*="document"], ' +
      '[class*="file-list"], [class*="document-list"], ' +
      'lightning-datatable, [class*="contentDocument"]'
    );

    const isEbulletinPage =
      hasEbulletinHeading ||
      url.includes('ebulletin') ||
      url.includes('risk-management') ||
      title.includes('ebulletin') ||
      (downloadLinks.length > 0 && pageText.includes('bulletin'));

    return {
      isEbulletinPage,
      hasDownloadLinks: downloadLinks.length > 0,
      hasEbulletinHeading,
      hasFileTable,
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
  // DOWNLOAD_LATEST_EBULLETIN
  // Finds the latest eBulletin Excel file and downloads it,
  // returning the content as a base64-encoded string
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

    // Pick the latest file: prefer the first link (typically most recent)
    // If dates are parseable, sort by date descending
    const sorted = sortByDateDescending(downloadLinks);
    const target = sorted[0];

    try {
      const response = await fetch(target.href, {
        credentials: 'include', // Send session cookies (same-origin)
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

      // Try to extract filename from Content-Disposition header
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
        fileName: fileName,
        fileSize: buffer.byteLength,
        mimeType: contentType,
        sourceUrl: target.href
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
  // GET_EBULLETIN_LIST
  // Scans the page and returns metadata for all available files
  // ============================================================

  function getEbulletinList() {
    const downloadLinks = findAllDownloadLinks();

    const files = downloadLinks.map(link => ({
      name: link.fileName || link.text || 'Unknown',
      url: link.href,
      date: link.date || null,
      size: link.size || null
    }));

    return {
      files,
      totalFiles: files.length,
      currentUrl: window.location.href
    };
  }

  // ============================================================
  // Helper: Find all download links on the page
  // Covers standard <a> hrefs, Salesforce ContentDocument /
  // ContentVersion download URLs, and download buttons
  // ============================================================

  function findAllDownloadLinks() {
    const results = [];
    const seen = new Set();

    // Pattern 1: Standard <a> elements with Excel file extensions
    const allAnchors = document.querySelectorAll('a[href]');
    for (const a of allAnchors) {
      const href = a.href || '';
      const text = (a.textContent || '').trim();
      const hrefLower = href.toLowerCase();

      const isExcelLink =
        hrefLower.endsWith('.xlsx') ||
        hrefLower.endsWith('.xls') ||
        hrefLower.includes('.xlsx?') ||
        hrefLower.includes('.xls?') ||
        /\.xlsx?\b/i.test(hrefLower);

      if (isExcelLink && !seen.has(href)) {
        seen.add(href);
        results.push({
          href,
          text,
          fileName: extractFileName(href, text),
          date: extractDateFromText(text) || extractDateFromText(href),
          size: null,
          type: 'direct'
        });
      }
    }

    // Pattern 2: Salesforce ContentDocument / ContentVersion download URLs
    const sfPatterns = [
      '/sfc/servlet.shepherd/document/download/',
      '/sfc/servlet.shepherd/version/download/',
      '/servlet/servlet.FileDownload',
      '/sfc/dist/version/download/',
      '/ContentDocument/',
      '/ContentVersion/'
    ];

    for (const a of allAnchors) {
      const href = a.href || '';
      const text = (a.textContent || '').trim();

      for (const pattern of sfPatterns) {
        if (href.includes(pattern) && !seen.has(href)) {
          seen.add(href);
          results.push({
            href,
            text,
            fileName: extractFileName(href, text),
            date: extractDateFromText(text),
            size: null,
            type: 'salesforce'
          });
          break;
        }
      }
    }

    // Pattern 3: Download buttons (may use onclick or data attributes)
    const downloadButtons = document.querySelectorAll(
      'button[class*="download"], a[class*="download"], ' +
      '[data-action="download"], [title*="Download"], ' +
      '[aria-label*="Download"], [aria-label*="download"]'
    );

    for (const btn of downloadButtons) {
      const href = btn.getAttribute('href') ||
                   btn.getAttribute('data-url') ||
                   btn.getAttribute('data-download-url') || '';
      const text = (btn.textContent || '').trim();

      if (href && !seen.has(href)) {
        seen.add(href);
        results.push({
          href: href.startsWith('http') ? href : window.location.origin + href,
          text,
          fileName: extractFileName(href, text),
          date: extractDateFromText(text),
          size: null,
          type: 'button'
        });
      }
    }

    // Pattern 4: Salesforce Lightning file components
    const fileComponents = document.querySelectorAll(
      'lightning-formatted-url[value*="download"], ' +
      '[class*="fileCard"] a, [class*="file-card"] a, ' +
      'lightning-file-card a, [data-file-id] a, ' +
      '[class*="contentDocumentList"] a'
    );

    for (const el of fileComponents) {
      const href = el.href || el.getAttribute('value') || '';
      const text = (el.textContent || '').trim();

      if (href && !seen.has(href)) {
        seen.add(href);
        results.push({
          href: href.startsWith('http') ? href : window.location.origin + href,
          text,
          fileName: extractFileName(href, text),
          date: extractDateFromText(text),
          size: null,
          type: 'lightning-component'
        });
      }
    }

    return results;
  }

  // ============================================================
  // Helper: Extract a filename from URL or link text
  // ============================================================

  function extractFileName(href, text) {
    // Try to get filename from the URL path
    try {
      const url = new URL(href, window.location.origin);
      const pathParts = url.pathname.split('/');
      const lastPart = pathParts[pathParts.length - 1];
      if (lastPart && /\.\w{2,5}$/.test(lastPart)) {
        return decodeURIComponent(lastPart);
      }
    } catch {
      // Not a valid URL
    }

    // Try to get filename from link text if it looks like a file
    if (text && /\.(xlsx?|csv)\b/i.test(text)) {
      return text;
    }

    // Try to extract from Content-Disposition-style patterns in href
    const filenameMatch = href.match(/filename[=]([^&]+)/i);
    if (filenameMatch) {
      return decodeURIComponent(filenameMatch[1]);
    }

    // Default: use the text or a generic name
    return text || 'ebulletin.xlsx';
  }

  // ============================================================
  // Helper: Extract a date from text using common patterns
  // ============================================================

  function extractDateFromText(text) {
    if (!text) return null;

    // Pattern: DD/MM/YYYY or DD-MM-YYYY
    let match = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (match) {
      return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
    }

    // Pattern: YYYY-MM-DD
    match = text.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return match[0];
    }

    // Pattern: Month DD, YYYY or DD Month YYYY
    const months = [
      'january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december',
      'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
    ];
    const monthPattern = months.join('|');
    const regex = new RegExp(`(${monthPattern})\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i');
    match = text.match(regex);
    if (match) {
      const monthStr = match[1].toLowerCase().substring(0, 3);
      const monthIndex = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(monthStr);
      if (monthIndex >= 0) {
        const m = String(monthIndex + 1).padStart(2, '0');
        const d = match[2].padStart(2, '0');
        return `${match[3]}-${m}-${d}`;
      }
    }

    // Pattern: week number (e.g., "Week 12" or "W12")
    match = text.match(/(?:week|w)\s*(\d{1,2})/i);
    if (match) {
      // Return as a sortable string (week numbers are sequential)
      return `week-${match[1].padStart(2, '0')}`;
    }

    return null;
  }

  // ============================================================
  // Helper: Sort download links by date (most recent first)
  // Falls back to original order if dates are not parseable
  // ============================================================

  function sortByDateDescending(links) {
    const withDates = links.filter(l => l.date && !l.date.startsWith('week-'));
    if (withDates.length > 1) {
      withDates.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const withoutDates = links.filter(l => !l.date || l.date.startsWith('week-'));
      return [...withDates, ...withoutDates];
    }

    // If week numbers are available, sort by week descending
    const withWeeks = links.filter(l => l.date && l.date.startsWith('week-'));
    if (withWeeks.length > 1) {
      withWeeks.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const rest = links.filter(l => !l.date || !l.date.startsWith('week-'));
      return [...withWeeks, ...rest];
    }

    // No dates available: return in original order (first = newest assumption)
    return links;
  }

  // ============================================================
  // Helper: Convert ArrayBuffer to base64 string
  // ============================================================

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

  // ============================================================
  // Helper: Wait for an element to appear in the DOM
  // Polls at short intervals until the element is found or timeout
  // ============================================================

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const interval = 200;
      let elapsed = 0;

      const poll = setInterval(() => {
        elapsed += interval;
        const el = document.querySelector(selector);
        if (el) {
          clearInterval(poll);
          resolve(el);
        } else if (elapsed >= timeout) {
          clearInterval(poll);
          reject(new Error(`waitForElement: "${selector}" not found within ${timeout}ms`));
        }
      }, interval);
    });
  }

  // ============================================================
  // Helper: Wait for SPA navigation to complete
  // Monitors URL changes and DOM mutations, resolves when settled
  // ============================================================

  function waitForNavigation(maxMs = 10000) {
    return new Promise((resolve) => {
      let resolved = false;
      let settleTimer = null;
      const startUrl = window.location.href;

      const observer = new MutationObserver(() => {
        // Reset settle timer on each mutation
        if (settleTimer) clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve();
          }
        }, 800); // Consider settled after 800ms of no DOM changes
      });

      observer.observe(document.body || document.documentElement, {
        childList: true,
        subtree: true
      });

      // Also resolve if URL changes (Lightning SPA navigation)
      const urlCheck = setInterval(() => {
        if (window.location.href !== startUrl && !resolved) {
          clearInterval(urlCheck);
          // Give the new page a moment to render
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              observer.disconnect();
              resolve();
            }
          }, 1500);
        }
      }, 200);

      // Max timeout
      setTimeout(() => {
        clearInterval(urlCheck);
        if (!resolved) {
          resolved = true;
          observer.disconnect();
          resolve();
        }
      }, maxMs);
    });
  }

  // ============================================================
  // Helper: Simple delay
  // ============================================================

  function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Signal that content script is loaded
  console.log('[APG eBulletin] Content script loaded on:', window.location.href);

})();
