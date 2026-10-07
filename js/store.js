// LifeMail's own data (accounts list, profiles, label colours, settings, email→task links)
// is saved as ONE small JSON file in the hidden "app data" folder of your Google Drive.
// It never contains passwords or tokens. Emails themselves stay in Gmail.
// A copy is kept on the device so the app opens instantly and works offline.
import { getToken } from './auth.js';
import { CONFIG } from './config.js';

const LOCAL_KEY = 'lm_data_v1';

export function defaultData() {
  return {
    schema: 1,
    updatedAt: 0,
    storageAccount: '',
    accounts: [], // {email, name, picture, displayName, profile, color, signature, notify}
    profiles: {
      personal: { name: 'Personal', notify: 'all', quiet: { enabled: false, start: '22:00', end: '07:00' } },
      work: { name: 'Work', notify: 'all', quiet: { enabled: false, start: '19:00', end: '09:00' } },
    },
    focus: '', // '', 'personal' or 'work' — mutes the other profile's notifications
    labelColors: { 'Follow Up': '#d9822b', Awaiting: '#c2453d', Delegated: '#7a6ab8', NGDR: '#2f7d6d', GSI: '#3a6ea5', Finance: '#8a7a2e', Travel: '#b05c9a', LifeOS: '#4a7c3a' },
    pinnedLabels: ['Follow Up', 'Awaiting', 'Delegated', 'NGDR', 'GSI'],
    hiddenLabels: [], // labels not shown in the sidebar (they still exist in Gmail)
    rules: [],        // email rules — see js/rules-engine.js for the format
    ruleLog: [],      // last runs: {at, account, trigger, rule, checked, matched, action, status, error}
    settings: {
      theme: 'system', density: 'comfortable', remoteImages: 'ask', notifications: false, pollSeconds: 90,
      smartSuggest: true,
      lifeos: {
        enabled: true, urlTemplate: '', projects: ['NGDR', 'GSI', 'Personal'], defaultProject: '',
        defaultPriority: 'medium', defaultDue: 'none', labelOnTask: true, shareAlso: false,
      },
    },
    taskLinks: [], // {id, account, threadId, title, project, due, createdAt}
    // Work = Government Workplace, opened as the real Government website (see js/workplace.js).
    work: { portalUrl: 'https://workplace.mgovcloud.in/', authUrl: 'https://accounts.mgovcloud.in/signin', autoOpen: true, shortcuts: [], lastOpened: 0 },
  };
}

function deepMerge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = k in base ? deepMerge(base[k], over[k]) : over[k];
  return out;
}

export class Store {
  constructor() {
    this.data = defaultData();
    this.fileId = '';
    this.status = 'local'; // local | syncing | synced | error | offline
    this.lastSync = 0;
    this.listeners = new Set();
    this.timer = null;
    this.demo = false;
    try { const s = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null'); if (s) this.data = deepMerge(defaultData(), s); } catch {}
  }
  useDemo(accounts) {
    this.demo = true;
    this.localKey = LOCAL_KEY + '_demo';
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(this.localKey) || 'null'); } catch {}
    this.data = deepMerge(defaultData(), saved || {});
    if (!this.data.accounts.length) this.data.accounts = accounts.map((a) => ({ ...a }));
    this.data.settings.lifeos.projects = this.data.settings.lifeos.projects.length ? this.data.settings.lifeos.projects : ['NGDR', 'GSI', 'Personal'];
    this.status = 'demo';
  }
  onChange(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach((f) => f(this)); }

  saveLocal() { try { localStorage.setItem(this.localKey || LOCAL_KEY, JSON.stringify(this.data)); } catch {} }

  update(mutator) {
    mutator(this.data);
    this.data.updatedAt = Date.now();
    this.saveLocal();
    this.scheduleSync();
    this.emit();
  }

  get driveAccount() { return this.data.storageAccount || this.data.accounts[0]?.email || ''; }

  async driveReq(url, opts = {}) {
    const token = getToken(this.driveAccount);
    if (!token) throw Object.assign(new Error('Drive sign-in needed'), { authNeeded: true, account: this.driveAccount });
    const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) } });
    if (r.status === 401) throw Object.assign(new Error('Drive sign-in needed'), { authNeeded: true, account: this.driveAccount });
    if (!r.ok) throw new Error('Google Drive: ' + r.status + ' ' + r.statusText);
    return r;
  }

  // Load from Drive and keep whichever copy is newer.
  async pull() {
    if (this.demo || !this.driveAccount) return;
    if (!navigator.onLine) { this.status = 'offline'; this.emit(); return; }
    this.status = 'syncing'; this.emit();
    try {
      const q = encodeURIComponent(`name='${CONFIG.driveFileName}' and trashed=false`);
      const list = await (await this.driveReq(`https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id,modifiedTime)`)).json();
      const f = list.files?.[0];
      if (f) {
        this.fileId = f.id;
        const remote = await (await this.driveReq(`https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).json();
        if ((remote.updatedAt || 0) > (this.data.updatedAt || 0)) {
          const localAccounts = this.data.accounts;
          this.data = deepMerge(defaultData(), remote);
          // keep any account added on this device that the Drive copy does not know yet
          for (const a of localAccounts) if (!this.data.accounts.some((x) => x.email === a.email)) this.data.accounts.push(a);
          this.saveLocal();
        } else if ((remote.updatedAt || 0) < (this.data.updatedAt || 0)) {
          await this.push();
        }
      } else {
        await this.push();
      }
      this.status = 'synced'; this.lastSync = Date.now();
    } catch (e) {
      this.status = e.authNeeded ? 'auth' : 'error'; this.error = e.message;
    }
    this.emit();
  }

  scheduleSync() {
    if (this.demo) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push().catch(() => {}), 1500);
  }

  async push() {
    if (this.demo || !this.driveAccount) return;
    if (!navigator.onLine) { this.status = 'offline'; this.emit(); return; }
    this.status = 'syncing'; this.emit();
    try {
      const body = JSON.stringify(this.data);
      if (this.fileId) {
        await this.driveReq(`https://www.googleapis.com/upload/drive/v3/files/${this.fileId}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      } else {
        const boundary = 'lm' + Date.now();
        const meta = JSON.stringify({ name: CONFIG.driveFileName, parents: ['appDataFolder'], mimeType: 'application/json' });
        const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
        const r = await this.driveReq('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body: multipart });
        this.fileId = (await r.json()).id;
      }
      this.status = 'synced'; this.lastSync = Date.now();
    } catch (e) { this.status = e.authNeeded ? 'auth' : 'error'; this.error = e.message; }
    this.emit();
  }

  exportJson() { return JSON.stringify(this.data, null, 2); }
  importJson(text) {
    const obj = JSON.parse(text);
    if (!obj || obj.schema !== 1) throw new Error('This is not a LifeMail backup file.');
    this.update((d) => Object.assign(d, deepMerge(defaultData(), obj)));
  }
}

// ---- small offline cache of message lists (IndexedDB), so the inbox shows when offline ----
const DB = 'lifemail-cache';
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('lists');
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
export async function cacheSet(key, value) {
  try { const db = await idb(); await new Promise((res) => { const tx = db.transaction('lists', 'readwrite'); tx.objectStore('lists').put({ value, at: Date.now() }, key); tx.oncomplete = res; tx.onerror = res; }); } catch {}
}
export async function cacheGet(key) {
  try { const db = await idb(); return await new Promise((res) => { const r = db.transaction('lists').objectStore('lists').get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => res(null); }); } catch { return null; }
}
export async function cacheClear() { try { indexedDB.deleteDatabase(DB); } catch {} }
