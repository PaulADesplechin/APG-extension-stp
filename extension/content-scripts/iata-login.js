// ============================================================
// APG BSP Link - IATA Portal Login Helper
// Injected into portal.iata.org for auto-login assistance
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch(err => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'CHECK_LOGIN_PAGE':
      return checkLoginPage();
    case 'AUTO_FILL_LOGIN':
      return autoFillLogin(message.payload);
    case 'CHECK_2FA_PAGE':
      return check2FAPage();
    case 'CHECK_LOGGED_IN':
      return checkLoggedIn();
    case 'NAVIGATE_TO_BSPLINK':
      return navigateToBSPLink();
    case 'PING':
      return { status: 'alive', url: window.location.href };
    default:
      return { error: 'Unknown message type' };
  }
}

// ---- Login Page Detection ----
function checkLoginPage() {
  const url = window.location.href;
  const isLoginPage = url.includes('/login') || url.includes('/s/login');

  // Look for email/username field
  const emailField = findField([
    'input[name="username"]', 'input[name="email"]',
    'input[type="email"]', 'input[name="j_username"]',
    'input[id*="username"]', 'input[id*="email"]',
    'input[placeholder*="mail"]', 'input[placeholder*="user"]',
    'input[autocomplete="username"]', 'input[autocomplete="email"]'
  ]);

  // Look for password field
  const passwordField = findField([
    'input[type="password"]', 'input[name="password"]',
    'input[name="j_password"]', 'input[id*="password"]'
  ]);

  // Look for submit button
  const submitBtn = findField([
    'button[type="submit"]', 'input[type="submit"]',
    'button[class*="login"]', 'button[class*="submit"]',
    'button[class*="btn-primary"]', 'a[class*="login"]',
    'lightning-button button', 'button'
  ]);

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

// ---- Auto-fill Login ----
async function autoFillLogin(payload) {
  const { email, password } = payload;

  // Find email field
  const emailField = findField([
    'input[name="username"]', 'input[name="email"]',
    'input[type="email"]', 'input[name="j_username"]',
    'input[id*="username"]', 'input[id*="email"]',
    'input[placeholder*="mail"]', 'input[placeholder*="user"]',
    'input[autocomplete="username"]', 'input[autocomplete="email"]'
  ]);

  if (!emailField) {
    return { success: false, error: 'Champ email/username non trouve' };
  }

  // Find password field
  const passwordField = findField([
    'input[type="password"]', 'input[name="password"]',
    'input[name="j_password"]', 'input[id*="password"]'
  ]);

  if (!passwordField) {
    return { success: false, error: 'Champ mot de passe non trouve' };
  }

  // Fill email with realistic typing simulation
  await simulateTyping(emailField, email);
  await wait(300);

  // Fill password
  await simulateTyping(passwordField, password);
  await wait(300);

  return {
    success: true,
    emailFilled: true,
    passwordFilled: true,
    message: 'Formulaire rempli. Cliquez sur "Se connecter" ou attendez la validation 2FA.'
  };
}

async function submitLoginForm() {
  const submitBtn = findField([
    'button[type="submit"]', 'input[type="submit"]',
    'button[class*="login"]', 'button[class*="submit"]',
    'button[class*="btn-primary"]',
    'lightning-button button'
  ]);

  if (submitBtn) {
    submitBtn.click();
    return { success: true, clicked: true };
  }

  // Try form submission
  const form = document.querySelector('form');
  if (form) {
    form.submit();
    return { success: true, formSubmitted: true };
  }

  return { success: false, error: 'Bouton de connexion non trouve' };
}

// ---- 2FA Detection ----
function check2FAPage() {
  const url = window.location.href;

  // Common 2FA indicators
  const has2FAInput = !!findField([
    'input[name*="otp"]', 'input[name*="code"]', 'input[name*="token"]',
    'input[name*="verification"]', 'input[name*="mfa"]',
    'input[type="tel"][maxlength="6"]', 'input[maxlength="6"]',
    'input[placeholder*="code"]', 'input[placeholder*="verification"]'
  ]);

  const has2FAText = document.body.textContent.toLowerCase().includes('verification') ||
                     document.body.textContent.toLowerCase().includes('two-factor') ||
                     document.body.textContent.toLowerCase().includes('2fa') ||
                     document.body.textContent.toLowerCase().includes('authenticator') ||
                     document.body.textContent.toLowerCase().includes('security code') ||
                     document.body.textContent.toLowerCase().includes('one-time');

  const hasPushNotif = document.body.textContent.toLowerCase().includes('push notification') ||
                       document.body.textContent.toLowerCase().includes('approve') ||
                       document.body.textContent.toLowerCase().includes('notification envoy');

  return {
    is2FAPage: has2FAInput || has2FAText || hasPushNotif,
    has2FAInput,
    hasPushNotification: hasPushNotif,
    url,
    message: hasPushNotif
      ? 'En attente de la validation 2FA (notification push envoyee)'
      : has2FAInput
      ? 'Page 2FA detectee - entrez le code de verification'
      : 'Pas de 2FA detecte sur cette page'
  };
}

// ---- Check if Logged In ----
function checkLoggedIn() {
  const url = window.location.href;
  const isLoginPage = url.includes('/login') || url.includes('/s/login');

  // If still on login page, not logged in
  if (isLoginPage) {
    return { isLoggedIn: false, reason: 'Still on login page' };
  }

  // Look for logged-in indicators
  const hasLoggedInUI = !!findField([
    'a[href*="logout"]', 'button[class*="logout"]',
    '[class*="user-profile"]', '[class*="user-menu"]',
    '[class*="avatar"]', '.username', '[class*="header-user"]',
    'a[title*="Log Out"]', 'a[title*="Logout"]', 'a[title*="Deconnexion"]'
  ]);

  // Check for BSP Link or dashboard content
  const hasDashboard = url.includes('bsplink') ||
                       url.includes('dashboard') ||
                       url.includes('/home') ||
                       document.querySelector('[class*="dashboard"]');

  return {
    isLoggedIn: hasLoggedInUI || (!isLoginPage && hasDashboard),
    hasLoggedInUI,
    hasDashboard: !!hasDashboard,
    url,
    title: document.title
  };
}

// ---- Navigate to BSP Link ----
function navigateToBSPLink() {
  // Try finding a link to BSP Link
  const bspLink = findField([
    'a[href*="bsplink"]', 'a[href*="BSPLink"]', 'a[href*="BSPlink"]',
    'a[title*="BSPlink"]', 'a[title*="BSP Link"]'
  ]);

  if (bspLink) {
    bspLink.click();
    return { success: true, method: 'link_click' };
  }

  // Try direct navigation
  window.location.href = 'https://www.bsplink.iata.org/';
  return { success: true, method: 'direct_navigation' };
}

// ---- Helpers ----
function findField(selectors) {
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector */ }
  }
  return null;
}

async function simulateTyping(field, text) {
  // Focus the field
  field.focus();
  field.click();
  await wait(100);

  // Clear existing content
  field.value = '';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  await wait(50);

  // Set value directly (some frameworks intercept keystroke events)
  field.value = text;

  // Dispatch events that frameworks listen for
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));

  // For React-based forms, update the internal value
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  )?.set;
  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

console.log('[APG Extension] IATA Login helper loaded on:', window.location.href);
