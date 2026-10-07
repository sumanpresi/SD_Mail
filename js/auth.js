// Google OAuth for a browser app (no password ever touches LifeMail, no client secret, no server).
// Flow: open Google's consent page in a popup (or full-page redirect if popups are blocked),
// Google returns a short-lived (1 hour) access token to /oauth.html, which hands it back here.
import { CONFIG } from './config.js';
import { isAndroidApp, androidCall } from './bridge.js';

export const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.modify',   // read, label, archive, send — never permanent delete
  'https://www.googleapis.com/auth/drive.appdata',  // ONLY LifeMail's own hidden app folder in Drive
];

const TOKENS_KEY = 'lm_tokens_v1';
const STATE_KEY = 'lm_oauth_state';
const channel = 'BroadcastChannel' in self ? new BroadcastChannel('lifemail-oauth') : null;

let tokens = {};
try { tokens = JSON.parse(localStorage.getItem(TOKENS_KEY) || '{}'); } catch { tokens = {}; }
const persist = () => { try { localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens)); } catch {} };

export function getToken(email) {
  const t = tokens[(email || '').toLowerCase()];
  return t && t.exp - 60_000 > Date.now() ? t.token : null;
}
export function tokenExpiresIn(email) {
  const t = tokens[(email || '').toLowerCase()];
  return t ? t.exp - Date.now() : -1;
}
export function forgetToken(email) {
  const t = tokens[email];
  delete tokens[email]; persist();
  if (t) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.token), { method: 'POST' }).catch(() => {});
}
function saveToken(email, token, expiresIn) {
  tokens[email.toLowerCase()] = { token, exp: Date.now() + (Number(expiresIn) || 3600) * 1000 };
  persist();
}

function randomState() {
  const a = new Uint8Array(16); crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

function authUrl({ loginHint, prompt, mode }) {
  const state = randomState() + '.' + mode;
  localStorage.setItem(STATE_KEY, JSON.stringify({ state, at: Date.now(), hint: loginHint || '' }));
  const p = new URLSearchParams({
    client_id: CONFIG.googleClientId,
    redirect_uri: location.origin + '/oauth.html',
    response_type: 'token',
    scope: SCOPES.join(' '),
    include_granted_scopes: 'true',
    state,
  });
  if (loginHint) p.set('login_hint', loginHint);
  if (prompt) p.set('prompt', prompt);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString();
}

async function fetchUserInfo(token) {
  const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('Could not read your Google profile');
  const j = await r.json();
  return { email: (j.email || '').toLowerCase(), name: j.name || j.email, picture: j.picture || '' };
}

// Called by oauth.html result (via BroadcastChannel / storage) or by redirect landing.
export async function consumeResult(result) {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch {}
  if (!result || !result.state || result.state !== saved.state) throw new Error('Sign-in was interrupted (state mismatch). Please try again.');
  localStorage.removeItem(STATE_KEY);
  if (result.error) throw new Error(result.error === 'access_denied' ? 'Access was not granted.' : 'Google sign-in error: ' + result.error);
  const granted = (result.scope || '').split(' ');
  const missing = SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s));
  if (missing.length) throw new Error('Please tick all permission boxes on the Google screen (Gmail and Drive app data) — LifeMail cannot work without them.');
  const info = await fetchUserInfo(result.access_token);
  saveToken(info.email, result.access_token, result.expires_in);
  return info;
}

// Inside the LifeMail Android app, Google sign-in goes through Android's own Google account system
// (Google blocks its sign-in page inside embedded browsers). No password ever reaches LifeMail.
async function androidSignIn(loginHint, silent) {
  const hint = (loginHint || '').toLowerCase();
  const old = hint && tokens[hint] ? tokens[hint].token : '';
  const r = await androidCall('signIn', { hint, silent, oldToken: old });
  const granted = r.scopes || [];
  const missing = SCOPES.filter((s) => s.startsWith('https://') && !granted.includes(s));
  if (missing.length) throw new Error('Please allow Gmail and Drive app data access — LifeMail cannot work without them.');
  const info = await fetchUserInfo(r.accessToken);
  // Android may hand back a cached token, so assume a shorter life and refresh early.
  saveToken(info.email, r.accessToken, 45 * 60);
  return info;
}

// Keeping you signed in. Google gives LifeMail a Gmail pass that lasts about an hour.
// • In the Android app, a new pass is fetched silently from Android's Google account — no tap, no
//   screen — shortly before the old one runs out, or whenever Gmail says it has expired.
// • In a web browser, Google only allows renewing from a tap (it opens and closes a small window),
//   so LifeMail renews on your next tap once less than 10 minutes are left.
export const canRenewSilently = () => isAndroidApp;
const renewing = new Map(); const renewFailedAt = {};
export function renewSilently(email, { force = false } = {}) {
  email = String(email || '').toLowerCase();
  if (!isAndroidApp || !email) return Promise.resolve(null);
  if (!force && getToken(email) && tokenExpiresIn(email) > 10 * 60_000) return Promise.resolve(getToken(email));
  if (Date.now() - (renewFailedAt[email] || 0) < 60_000) return Promise.resolve(null); // don't hammer after a refusal
  if (!renewing.has(email)) {
    renewing.set(email, androidSignIn(email, true)
      .then((info) => (info.email === email ? getToken(email) : null))
      .catch(() => { renewFailedAt[email] = Date.now(); return null; })
      .finally(() => renewing.delete(email)));
  }
  return renewing.get(email);
}

// Opens the Google screen. Resolves with {email,name,picture}.
export function signIn({ loginHint = '', silent = false } = {}) {
  if (isAndroidApp) return androidSignIn(loginHint, silent);
  if (!CONFIG.googleClientId) return Promise.reject(new Error('Google Client ID is not set yet. See SETUP.md, step 3.'));
  const prompt = silent ? 'none' : (loginHint ? '' : 'select_account consent');
  const url = authUrl({ loginHint, prompt, mode: 'popup' });
  const w = window.open(url, 'lifemail-oauth', 'width=480,height=640');
  if (!w && silent) return Promise.reject(new Error('Popup blocked'));
  if (!w) {
    // Popup blocked (common in installed apps) — do a full-page redirect instead.
    location.assign(authUrl({ loginHint, prompt, mode: 'redirect' }));
    return new Promise(() => {});
  }
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = async (res) => {
      if (done) return; done = true;
      cleanup();
      try { resolve(await consumeResult(res)); } catch (e) { reject(e); }
    };
    const onMsg = (e) => finish(e.data);
    const onStorage = (e) => { if (e.key === 'lm_oauth_result' && e.newValue) { finish(JSON.parse(e.newValue)); } };
    const timer = setInterval(() => {
      const v = localStorage.getItem('lm_oauth_result');
      if (v) { localStorage.removeItem('lm_oauth_result'); finish(JSON.parse(v)); }
      else if (w.closed && !done) { setTimeout(() => { if (!done) { done = true; cleanup(); reject(new Error('Sign-in window was closed.')); } }, 1200); }
    }, 500);
    const cleanup = () => { clearInterval(timer); channel?.removeEventListener('message', onMsg); removeEventListener('storage', onStorage); localStorage.removeItem('lm_oauth_result'); };
    channel?.addEventListener('message', onMsg);
    addEventListener('storage', onStorage);
  });
}

// If the page loaded after a full-page redirect sign-in, finish it.
export async function completeRedirectIfAny() {
  const v = sessionStorage.getItem('lm_oauth_redirect_result');
  if (!v) return null;
  sessionStorage.removeItem('lm_oauth_redirect_result');
  return consumeResult(JSON.parse(v));
}
