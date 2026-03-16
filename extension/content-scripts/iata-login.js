// ============================================================
// APG BSP Link - IATA Portal Login Helper
// Injected into portal.iata.org for auto-login
// Tested against Salesforce Lightning Community login page
// ============================================================

// IMPORTANT: Only handle messages this script knows about.
// Return false for unknown messages so other content scripts (iata-ebulletin.js) can handle them.
const LOGIN_MESSAGE_TYPES = new Set([
  'CHECK_LOGIN_PAGE', 'AUTO_FILL_AND_SUBMIT', 'AUTO_FILL_LOGIN',
  'CHECK_2FA_PAGE', 'CHECK_LOGGED_IN', 'NAVIGATE_TO_BSPLINK', 'PING'
]);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only handle messages this script is responsible for
  if (!LOGIN_MESSAGE_TYPES.has(message.type)) {
    return false; // Let other content scripts handle it
  }

  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_LOGIN_PAGE':
      return checkLoginPage();
    case 'AUTO_FILL_AND_SUBMIT':
      return autoFillAndSubmit(message.payload);
    case 'AUTO_FILL_LOGIN':
      return autoFillAndSubmit(message.payload);
    case 'CHECK_2FA_PAGE':
      return check2FAPage();
    case 'CHECK_LOGGED_IN':
      return checkLoggedIn();
    case 'NAVIGATE_TO_BSPLINK':
      return navigateToBSPLink();
    case 'PING':
      return { status: 'alive', url: window.location.href, script: 'iata-login' };
    default:
      return false; // Should not reach here due to guard above
  }
}

// ---- Login Page Detection ----
function checkLoginPage() {
  const url = window.location.href;
  const isLoginPage = url.includes('/login') || url.includes('/s/login');

  // Salesforce Lightning login form - exact selectors from IATA portal
  const emailField = getEmailField();
  const passwordField = getPasswordField();
  const submitBtn = getLoginButton();

  return {
    isLoginPage,
    hasEmailField: !!emailField,
    hasPasswordField: !!passwordField,
    hasSubmitButton: !!submitBtn,
    url,
    title: document.title,
    readyForLogin: !!emailField && !!passwordField
  };
}

// ---- Exact selectors for IATA Salesforce Lightning portal ----
function getEmailField() {
  // IATA portal uses input[type="text"] not input[type="email"]
  // It's the first text input on the login page
  const selectors = [
    'input[type="text"][placeholder=" "]',
    'input[type="text"]',
    'input[name="username"]',
    'input[type="email"]',
    'input[id*="username"]',
    'input[id*="email"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function getPasswordField() {
  const selectors = [
    'input[type="password"]',
    'input[name="password"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

function getLoginButton() {
  // Find button with text "Log In"
  const buttons = document.querySelectorAll('button');
  for (const btn of buttons) {
    const text = btn.textContent.trim().toLowerCase();
    if (text === 'log in' || text === 'login' || text === 'se connecter' || text === 'connexion') {
      return btn;
    }
  }
  // Fallback selectors
  const selectors = [
    'button[type="submit"]',
    'input[type="submit"]'
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

// ---- Auto-fill AND click Log In ----
async function autoFillAndSubmit(payload) {
  const { email, password } = payload;

  const emailField = getEmailField();
  if (!emailField) {
    return { success: false, error: 'Champ email non trouve sur la page IATA' };
  }

  const passwordField = getPasswordField();
  if (!passwordField) {
    return { success: false, error: 'Champ mot de passe non trouve sur la page IATA' };
  }

  // Fill email - Salesforce Lightning requires special handling
  await fillSalesforceInput(emailField, email);
  await wait(500);

  // Fill password
  await fillSalesforceInput(passwordField, password);
  await wait(500);

  // Click Log In button automatically
  const loginBtn = getLoginButton();
  if (loginBtn) {
    await wait(300);
    loginBtn.click();
    return {
      success: true,
      emailFilled: true,
      passwordFilled: true,
      submitted: true,
      message: 'Identifiants remplis et formulaire soumis. Attente de la 2FA...'
    };
  }

  return {
    success: true,
    emailFilled: true,
    passwordFilled: true,
    submitted: false,
    message: 'Identifiants remplis mais bouton Log In non trouve. Cliquez manuellement.'
  };
}

// Salesforce Lightning input fill - must trigger their framework events
async function fillSalesforceInput(field, value) {
  // Focus
  field.focus();
  field.click();
  await wait(100);

  // Clear
  field.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);

  // Use native setter to bypass React/LWC value property
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(field, value);
  } else {
    field.value = value;
  }

  // Fire all events Salesforce Lightning listens for
  field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  field.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
  field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
  field.dispatchEvent(new Event('blur', { bubbles: true }));

  await wait(100);
}

// ---- 2FA Detection ----
function check2FAPage() {
  const url = window.location.href;
  const bodyText = document.body.textContent.toLowerCase();

  // Salesforce MFA flow indicators
  const isMFAFlow = url.includes('MFA') || url.includes('mfa') ||
                    url.includes('loginflow') || url.includes('LoginFlow');

  const has2FAInput = !!document.querySelector(
    'input[name*="otp"], input[name*="code"], input[name*="token"], ' +
    'input[name*="verification"], input[type="tel"][maxlength="6"], ' +
    'input[maxlength="6"], input[placeholder*="code"]'
  );

  const hasPushNotif = bodyText.includes('push notification') ||
                       bodyText.includes('approve') ||
                       bodyText.includes('salesforce authenticator') ||
                       bodyText.includes('verify your identity') ||
                       bodyText.includes('notification') ||
                       bodyText.includes('sent a notification');

  const hasVerifyText = bodyText.includes('verification') ||
                        bodyText.includes('two-factor') ||
                        bodyText.includes('2fa') ||
                        bodyText.includes('multi-factor') ||
                        bodyText.includes('security code') ||
                        bodyText.includes('one-time');

  // Check for "Finish Logging In" link (Salesforce specific)
  const hasFinishLogin = !!Array.from(document.querySelectorAll('a')).find(
    a => a.textContent.includes('Finish Logging In')
  );

  return {
    is2FAPage: isMFAFlow || has2FAInput || hasPushNotif || hasVerifyText || hasFinishLogin,
    has2FAInput,
    hasPushNotification: hasPushNotif,
    hasFinishLogin,
    isMFAFlow,
    url,
    message: hasFinishLogin
      ? 'Cliquez sur "Finish Logging In" apres la validation 2FA'
      : hasPushNotif
      ? 'En attente de la validation 2FA (notification push envoyee)'
      : has2FAInput
      ? 'Page 2FA detectee - entrez le code de verification'
      : isMFAFlow
      ? 'Flow MFA Salesforce detecte - en attente...'
      : 'Pas de 2FA detecte sur cette page'
  };
}

// ---- Check if Logged In ----
function checkLoggedIn() {
  const url = window.location.href;
  const isLoginPage = url.includes('/s/login') || url.includes('/login');
  const isLoginFlow = url.includes('loginflow') || url.includes('LoginFlow');

  // If on login page or login flow, not fully logged in yet
  if (isLoginPage || isLoginFlow) {
    return { isLoggedIn: false, reason: 'Still on login/auth page', url };
  }

  // Look for logged-in indicators
  const logoutLink = document.querySelector(
    'a[href*="logout"], button[class*="logout"], a[title*="Log Out"]'
  );
  const userMenu = document.querySelector(
    '[class*="user-profile"], [class*="user-menu"], [class*="avatar"], ' +
    '.username, [class*="header-user"], [class*="profile"]'
  );

  // Portal dashboard indicators
  const hasDashboard = url.includes('/home') || url.includes('/dashboard') ||
                       url.includes('CommunitiesLanding') ||
                       !!document.querySelector('[class*="dashboard"], [class*="home"]');

  return {
    isLoggedIn: !!(logoutLink || userMenu || hasDashboard),
    hasLogoutLink: !!logoutLink,
    hasUserMenu: !!userMenu,
    hasDashboard,
    url,
    title: document.title
  };
}

// ---- Navigate to BSP Link ----
function navigateToBSPLink() {
  // Look for BSP Link in the portal
  const links = document.querySelectorAll('a');
  for (const link of links) {
    const href = link.href || '';
    const text = link.textContent.toLowerCase();
    if (href.includes('bsplink') || text.includes('bsp link') || text.includes('bsplink')) {
      link.click();
      return { success: true, method: 'link_click', href: link.href };
    }
  }

  // Direct navigation to BSP Link
  window.location.href = 'https://www.bsplink.iata.org/';
  return { success: true, method: 'direct_navigation' };
}

// ---- Helper ----
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[APG Extension] IATA Login helper loaded on:', window.location.href);
