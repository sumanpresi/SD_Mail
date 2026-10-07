// LifeMail offline mail — a copy of your recent Gmail kept ON THIS DEVICE (like the Gmail, Outlook and
// Apple Mail apps do), so you can read and search email without internet.
//
// • Where: the device's private app storage (IndexedDB). NOT Google Drive — Drive needs internet too,
//   and your mail already lives safely in Gmail. Drive keeps only LifeMail's settings and rules.
// • What: emails from the last N days (you choose), with their text and pictures sent inside the email.
//   Attachments are kept once you have opened them. Spam and Trash are not downloaded.
// • Staying up to date: Gmail's change history is checked on every mail check — only changes travel.
// • Offline changes (archive, star, read, labels, delete, sending) wait in an outbox and are sent to
//   Gmail automatically when you are back online.
// • Only Gmail accounts. Government Workplace mail is never copied.
// • "Remove email from this phone" (Settings → Offline & search) deletes the copy; signing out does too.
import { headerMap, parseAddress, extractParts, htmlToText } from './lib.js';
import { parseQuery, matches, excerpt, groupThreads, peopleIndex, forget } from './search.js';

const DBN = 'lifemail-mail';
const SET_KEY = 'lm_offline_v1';
const SKIP_DOWNLOAD = ['SPAM', 'TRASH', 'CHAT'];
export const DAY_CHOICES = [[7, '7 days'], [30, '30 days'], [90, '3 months'], [365, '1 year'], [0, 'Everything (newest 10,000)']];

// ---------------- settings (per device) ----------------
export function offlineSettings() {
  let s = {}; try { s = JSON.parse(localStorage.getItem(SET_KEY) || '{}'); } catch {}
  return { enabled: true, days: 30, ...s };
}
export function setOfflineSettings(patch) {
  const s = { ...offlineSettings(), ...patch };
  try { localStorage.setItem(SET_KEY, JSON.stringify(s)); } catch {}
  return s;
}
const maxFor = (days) => (days === 0 ? 10000 : days >= 365 ? 8000 : 5000);

// ---------------- events (status for the screen) ----------------
const listeners = new Set();
export const onOfflineStatus = (fn) => listeners.add(fn);
const state = { syncing: '', progress: null, lastError: '', pending: 0 };
export const offlineState = () => ({ ...state });
function emitStatus(patch = {}) { Object.assign(state, patch); listeners.forEach((f) => { try { f({ ...state }); } catch {} }); }

let labelResolver = () => [];
export function setLabelResolver(fn) { labelResolver = fn; }

// ---------------- IndexedDB ----------------
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DBN, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      const m = d.createObjectStore('msgs', { keyPath: 'k' }); m.createIndex('acct', 'account'); m.createIndex('thread', 'tk');
      d.createObjectStore('bodies', { keyPath: 'k' });
      d.createObjectStore('meta', { keyPath: 'account' });
      d.createObjectStore('outbox', { keyPath: 'id', autoIncrement: true });
      d.createObjectStore('atts', { keyPath: 'k' });
    };
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); dbp = null; }; res(r.result); };
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Offline storage is busy — close other LifeMail tabs.'));
  });
  return dbp;
}
function reqP(r) { return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function tx(stores, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode); let out;
    Promise.resolve(fn(...[].concat(stores).map((s) => t.objectStore(s)))).then((v) => { out = v; });
    t.oncomplete = () => res(out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('Storage aborted (device storage may be full).'));
  });
}

// ---------------- in-memory copy of the light records (fast search) ----------------
const mem = new Map(); // account → Map(id → doc)
let loaded = null;
export function loadMem() {
  if (!loaded) loaded = (async () => {
    try {
      const all = await tx('msgs', 'readonly', (s) => reqP(s.getAll()));
      for (const d of all) { if (!mem.has(d.account)) mem.set(d.account, new Map()); mem.get(d.account).set(d.id, d); }
      refreshPending().catch(() => {});
    } catch (e) { emitStatus({ lastError: e.message }); }
  })();
  return loaded;
}
const acctMap = (a) => { if (!mem.has(a)) mem.set(a, new Map()); return mem.get(a); };
export function localCount(account) { return account ? (mem.get(account)?.size || 0) : [...mem.values()].reduce((n, m) => n + m.size, 0); }
export const hasLocal = (account) => localCount(account) > 0;

// ---------------- converting Gmail messages ----------------
const decode = (s) => String(s || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
function lightFrom(account, base) {
  return { k: account + '|' + base.id, tk: account + '|' + base.threadId, account, ...base, body: String(base.body || '').replace(/\s+/g, ' ').slice(0, 5000) };
}
/** Raw Gmail API message (format=full) → [light record, body record] */
export function fromGmail(account, m) {
  const h = headerMap(m.payload?.headers); const a = parseAddress(h.from || '');
  const parts = extractParts(m.payload);
  const text = parts.text || htmlToText(parts.html || '');
  const files = parts.attachments.filter((x) => !x.inline).map((x) => x.filename);
  const light = lightFrom(account, {
    id: m.id, threadId: m.threadId, date: Number(m.internalDate) || Date.parse(h.date) || 0, labelIds: m.labelIds || [],
    from: h.from || '', fromName: a.name, fromEmail: a.email, to: h.to || '', cc: h.cc || '', bcc: h.bcc || '', replyTo: h['reply-to'] || '',
    subject: h.subject || '', snippet: decode(m.snippet), body: text, files, hasAtt: files.length > 0, size: m.sizeEstimate || 0,
    rfcMessageId: h['message-id'] || '', references: h.references || '',
  });
  return [light, bodyRecord(light.k, parts.html, parts.text, parts.attachments)];
}
/** A message already opened in the reader (GmailProvider.getThread shape) → [light, body] */
function fromParsed(account, threadId, m) {
  const files = (m.attachments || []).filter((x) => !x.inline).map((x) => x.filename);
  const light = lightFrom(account, {
    id: m.id, threadId, date: m.date || 0, labelIds: m.labelIds || [], from: m.from?.name ? `${m.from.name} <${m.from.email}>` : m.from?.email || '',
    fromName: m.from?.name || '', fromEmail: m.from?.email || '', to: m.to || '', cc: m.cc || '', bcc: m.bcc || '', replyTo: m.replyTo || '',
    subject: m.subject || '', snippet: m.snippet || '', body: m.text || htmlToText(m.html || ''), files, hasAtt: files.length > 0, size: 0,
    rfcMessageId: m.rfcMessageId || '', references: m.references || '',
  });
  return [light, bodyRecord(light.k, m.html, m.text, m.attachments || [])];
}
function bodyRecord(k, html = '', text = '', atts = []) {
  return { k, html: String(html || '').slice(0, 600000), text: String(text || '').slice(0, 300000),
    attachments: atts.map((x) => ({ filename: x.filename, mimeType: x.mimeType, size: x.size || 0, attachmentId: x.attachmentId || null, contentId: x.contentId || '', inline: !!x.inline, data: x.data && x.data.length < 300000 ? x.data : null })) };
}

async function putMany(pairs) {
  if (!pairs.length) return;
  await tx(['msgs', 'bodies'], 'readwrite', (ms, bs) => { for (const [l, b] of pairs) { ms.put(l); if (b) bs.put(b); } });
  for (const [l] of pairs) { const m = acctMap(l.account); const old = m.get(l.id); if (old) forget(old); m.set(l.id, l); }
}
async function removeMany(account, ids) {
  if (!ids.length) return;
  await tx(['msgs', 'bodies'], 'readwrite', (ms, bs) => { for (const id of ids) { ms.delete(account + '|' + id); bs.delete(account + '|' + id); } });
  const m = acctMap(account); ids.forEach((id) => m.delete(id));
}
async function setLabels(account, list) { // [{id, labelIds}]
  const m = acctMap(account); const changed = [];
  for (const { id, labelIds } of list) { const d = m.get(id); if (d) { d.labelIds = [...labelIds]; changed.push(d); } }
  if (changed.length) await tx('msgs', 'readwrite', (s) => { changed.forEach((d) => s.put(d)); });
}
const getMeta = (account) => tx('meta', 'readonly', (s) => reqP(s.get(account))).catch(() => null);
const putMeta = (meta) => tx('meta', 'readwrite', (s) => { s.put(meta); });

// ---------------- local lists, threads, search ----------------
function summarize(account, docs, snippetOverride) {
  const first = docs[0]; const last = docs[docs.length - 1];
  const labelIds = [...new Set(docs.flatMap((d) => d.labelIds || []))];
  const senders = [...new Map(docs.map((d) => [d.fromEmail, { name: d.fromName || d.fromEmail, email: d.fromEmail }])).values()];
  return {
    id: last.threadId, threadId: last.threadId, account, provider: 'gmail', messageId: last.id, rfcMessageId: last.rfcMessageId,
    subject: first.subject || '(no subject)', from: { name: last.fromName || last.fromEmail, email: last.fromEmail }, senders,
    to: last.to, snippet: snippetOverride || last.snippet, date: last.date, unread: docs.some((d) => (d.labelIds || []).includes('UNREAD')),
    starred: labelIds.includes('STARRED'), hasAttachment: docs.some((d) => d.hasAtt), labelIds, count: docs.length, local: true,
  };
}
const FOLDER_TEST = {
  inbox: (L) => L.includes('INBOX'), starred: (L) => L.includes('STARRED'), drafts: (L) => L.includes('DRAFT'), sent: (L) => L.includes('SENT'),
  archive: (L) => !['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].some((x) => L.includes(x)), all: (L) => !L.includes('SPAM') && !L.includes('TRASH'),
  spam: (L) => L.includes('SPAM'), trash: (L) => L.includes('TRASH'), snoozed: () => false,
};

/** Conversations from the copy on this device. search uses Gmail-style words (see js/search.js). */
export async function localThreads(account, { folderId = 'inbox', labelId = '', search = '', limit = 300 } = {}) {
  await loadMem();
  const docs = [...(mem.get(account)?.values() || [])];
  let hits; let parsed = null;
  if (search) {
    parsed = parseQuery(search);
    hits = docs.filter((d) => matches(d, parsed, (x) => (x.labelIds || []).map((id) => labelResolver(account, id)).filter(Boolean)));
  } else if (labelId) hits = docs.filter((d) => (d.labelIds || []).includes(labelId) && !(d.labelIds || []).includes('TRASH') && !(d.labelIds || []).includes('SPAM'));
  else { const f = FOLDER_TEST[folderId] || FOLDER_TEST.inbox; hits = docs.filter((d) => f(d.labelIds || [])); }
  const hitThreads = new Map(); for (const d of hits) hitThreads.set(d.tk, d); // newest hit per thread kept below
  for (const d of hits) { const h = hitThreads.get(d.tk); if (d.date > h.date) hitThreads.set(d.tk, d); }
  const byThread = new Map(); for (const d of docs) if (hitThreads.has(d.tk)) { if (!byThread.has(d.tk)) byThread.set(d.tk, []); byThread.get(d.tk).push(d); }
  const out = [...byThread.entries()].map(([tk, ds]) => { ds.sort((a, b) => a.date - b.date); return summarize(account, ds, parsed && parsed.terms.length ? excerpt(hitThreads.get(tk), parsed) : ''); });
  out.sort((a, b) => b.date - a.date);
  return out.slice(0, limit);
}

export async function localThread(account, threadId) {
  await loadMem();
  const docs = [...(mem.get(account)?.values() || [])].filter((d) => d.threadId === threadId).sort((a, b) => a.date - b.date);
  if (!docs.length) return null;
  const bodies = await tx('bodies', 'readonly', (s) => Promise.all(docs.map((d) => reqP(s.get(d.k)))));
  const summary = summarize(account, docs);
  const messages = docs.map((d, i) => {
    const b = bodies[i] || {};
    return { id: d.id, threadId, labelIds: d.labelIds, snippet: d.snippet, from: { name: d.fromName, email: d.fromEmail }, to: d.to, cc: d.cc, bcc: d.bcc, replyTo: d.replyTo,
      subject: d.subject, date: d.date, rfcMessageId: d.rfcMessageId, references: d.references, html: b.html || '', text: b.text || (b.html ? '' : d.body), attachments: b.attachments || [] };
  });
  return { ...summary, messages };
}

/** People you email with — for search suggestions. */
export async function localPeople(myEmails) { await loadMem(); return peopleIndex([...mem.values()].flatMap((m) => [...m.values()]), myEmails); }

// ---------------- downloading & keeping up to date ----------------
async function pool(items, limit, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } }));
}
const isNetErr = (e) => e instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(e?.message || '');
const running = new Set();

/** Bring one account's copy up to date. inner = the real GmailProvider. */
export async function syncAccount(account, inner) {
  const st = offlineSettings();
  if (!st.enabled || running.has(account) || !navigator.onLine) return null;
  running.add(account);
  try {
    await loadMem();
    const meta = await getMeta(account);
    const days = st.days;
    if (meta && meta.complete && meta.days === days && meta.historyId) {
      try { return await incremental(account, inner, meta, days); }
      catch (e) { if (e.status !== 404) throw e; } // history too old → download again (keeps what is already here)
    }
    return await fullSync(account, inner, days, meta);
  } catch (e) {
    if (!isNetErr(e) && !e.authNeeded) emitStatus({ lastError: `${account}: ${e.message}` });
    throw e;
  } finally { running.delete(account); if (!running.size) emitStatus({ syncing: '', progress: null }); }
}

async function fullSync(account, inner, days, meta) {
  emitStatus({ syncing: account, progress: { account, done: 0, total: 0, phase: 'list' } });
  const historyId = await inner.currentHistoryId();
  const q = ['-in:chats', days ? `newer_than:${days}d` : ''].filter(Boolean).join(' ');
  const ids = await inner.listMessageIds({ q, max: maxFor(days) });
  const keep = new Set(ids); const have = acctMap(account);
  const missing = ids.filter((id) => !have.has(id));
  // anything here that Gmail no longer lists (deleted, spam/trash, or older than the chosen period)
  await removeMany(account, [...have.keys()].filter((id) => !keep.has(id)));
  // labels of emails already here may have changed while history was unavailable
  if (meta && have.size) {
    const stale = [...have.keys()];
    const fresh = [];
    await pool(stale, 6, async (id) => { try { const r = await inner.getRawMessage(id, 'minimal'); fresh.push({ id, labelIds: r.labelIds || [] }); } catch (e) { if (isNetErr(e) || e.authNeeded) throw e; } });
    await setLabels(account, fresh);
  }
  let done = 0; let batch = [];
  emitStatus({ progress: { account, done, total: missing.length, phase: 'download' } });
  await pool(missing, 4, async (id) => {
    try {
      const raw = await inner.getRawMessage(id, 'full');
      if (!SKIP_DOWNLOAD.some((l) => (raw.labelIds || []).includes(l))) batch.push(fromGmail(account, raw));
    } catch (e) { if (isNetErr(e) || e.authNeeded) throw e; }
    done++;
    if (batch.length >= 25) { const b = batch; batch = []; await putMany(b); }
    if (done % 10 === 0 || done === missing.length) emitStatus({ progress: { account, done, total: missing.length, phase: 'download' } });
  });
  await putMany(batch);
  await putMeta({ account, historyId, days, lastSync: Date.now(), complete: true, count: acctMap(account).size });
  return { added: missing.length, full: true };
}

async function incremental(account, inner, meta, days) {
  const h = await inner.historyChanges(meta.historyId);
  const have = acctMap(account);
  await removeMany(account, h.deleted.filter((id) => have.has(id)));
  await setLabels(account, h.labels);
  const toFetch = h.added.filter((a) => !SKIP_DOWNLOAD.some((l) => a.labelIds.includes(l)) && !have.has(a.id)).map((a) => a.id);
  await setLabels(account, h.added.filter((a) => have.has(a.id)));
  const got = [];
  if (toFetch.length) emitStatus({ syncing: account, progress: { account, done: 0, total: toFetch.length, phase: 'new' } });
  await pool(toFetch, 4, async (id) => { try { got.push(fromGmail(account, await inner.getRawMessage(id, 'full'))); } catch (e) { if (isNetErr(e) || e.authNeeded) throw e; } });
  await putMany(got);
  // keep only the chosen period (checked at most once an hour)
  if (days && Date.now() - (meta.pruned || 0) > 3600_000) {
    const cutoff = Date.now() - days * 864e5;
    await removeMany(account, [...have.values()].filter((d) => d.date < cutoff && !(d.labelIds || []).includes('DRAFT')).map((d) => d.id));
    meta.pruned = Date.now();
  }
  await putMeta({ ...meta, historyId: h.historyId, lastSync: Date.now(), count: have.size });
  return { added: got.length, removed: h.deleted.length, changed: h.labels.length };
}

/** Save a conversation you opened (so it is readable offline later). */
export async function rememberThread(account, full) {
  if (!offlineSettings().enabled || !full?.messages?.length) return;
  try { await putMany(full.messages.filter((m) => !SKIP_DOWNLOAD.some((l) => (m.labelIds || []).includes(l))).map((m) => fromParsed(account, full.threadId, m))); } catch {}
}

// ---------------- attachments ----------------
const ATT_MAX = 12 * 1048576 * 1.37; // ~12 MB files
export async function cachedAttachment(account, messageId, attachmentId) {
  try { return (await tx('atts', 'readonly', (s) => reqP(s.get(`${account}|${messageId}|${attachmentId}`))))?.data || null; } catch { return null; }
}
export async function cacheAttachment(account, messageId, attachmentId, data) {
  if (!offlineSettings().enabled || !data || data.length > ATT_MAX) return;
  try { await tx('atts', 'readwrite', (s) => { s.put({ k: `${account}|${messageId}|${attachmentId}`, data, at: Date.now() }); }); } catch {}
}

// ---------------- offline changes (outbox) ----------------
async function localModify(account, { threadId, ids }, add = [], remove = []) {
  const m = acctMap(account); const changed = [];
  for (const d of m.values()) {
    if ((threadId && d.threadId === threadId) || (ids && ids.includes(d.id))) {
      d.labelIds = [...new Set([...(d.labelIds || []).filter((l) => !remove.includes(l)), ...add])]; changed.push(d);
    }
  }
  if (changed.length) await tx('msgs', 'readwrite', (s) => { changed.forEach((d) => s.put(d)); }).catch(() => {});
}
async function enqueue(account, op, args) {
  await tx('outbox', 'readwrite', (s) => { s.add({ account, op, args, at: Date.now() }); });
  await refreshPending();
}
export async function pendingChanges() { try { return await tx('outbox', 'readonly', (s) => reqP(s.getAll())); } catch { return []; } }
async function refreshPending() { emitStatus({ pending: (await pendingChanges()).length }); }

let flushing = null;
/** Send waiting offline changes to Gmail, oldest first. getInner(account) → real GmailProvider. */
export function flushOutbox(getInner) {
  if (flushing || !navigator.onLine) return flushing || Promise.resolve({ sent: 0, failed: [] });
  flushing = (async () => {
    const items = await pendingChanges(); let sent = 0; const failed = [];
    for (const it of items) {
      try { await getInner(it.account)[it.op](...it.args); }
      catch (e) {
        if (isNetErr(e) || e.authNeeded) break; // still offline / signed out: try again later, keep order
        failed.push({ ...it, error: e.message });
      }
      await tx('outbox', 'readwrite', (s) => { s.delete(it.id); }); sent++;
    }
    await refreshPending();
    return { sent, failed };
  })().finally(() => { flushing = null; });
  return flushing;
}

// ---------------- the offline-aware provider ----------------
const offline = () => !navigator.onLine;
const NOT_SAVED = 'This email is not saved on this device yet. Connect to the internet to open it.';

/** Wraps the real Gmail provider: reads fall back to the device copy; changes made offline are queued. */
export function wrapProvider(inner) {
  const account = inner.account;
  const on = () => offlineSettings().enabled;
  const change = (op, local) => async (...args) => {
    if (on()) await local(...args);
    if (offline()) { await enqueue(account, op, args); return { queued: true }; }
    try { return await inner[op](...args); }
    catch (e) { if (isNetErr(e)) { await enqueue(account, op, args); return { queued: true }; } throw e; }
  };
  const over = {
    inner,
    async listThreads(args) {
      if (on() && offline()) return { threads: await localThreads(account, args), nextPageToken: '', local: true };
      try { return await inner.listThreads(args); }
      catch (e) { if (on() && isNetErr(e)) return { threads: await localThreads(account, args), nextPageToken: '', local: true }; throw e; }
    },
    async getThread(id) {
      if (offline()) { const t = on() && await localThread(account, id); if (t) return t; throw new Error(NOT_SAVED); }
      try { const t = await inner.getThread(id); rememberThread(account, t); return t; }
      catch (e) { if (isNetErr(e)) { const t = on() && await localThread(account, id); if (t) return t; throw new Error(NOT_SAVED); } throw e; }
    },
    async getAttachment(messageId, attachmentId) {
      const c = await cachedAttachment(account, messageId, attachmentId); if (c) return c;
      if (offline()) throw new Error('This attachment has not been downloaded yet. Open it once while online to keep it on this device.');
      const d = await inner.getAttachment(messageId, attachmentId);
      cacheAttachment(account, messageId, attachmentId, d);
      return d;
    },
    modifyThread: change('modifyThread', (threadId, add, remove) => localModify(account, { threadId }, add, remove)),
    modifyMessage: change('modifyMessage', (id, add, remove) => localModify(account, { ids: [id] }, add, remove)),
    batchModify: change('batchModify', (ids, add, remove) => localModify(account, { ids }, add, remove)),
    trashThread: change('trashThread', (threadId) => localModify(account, { threadId }, ['TRASH'], ['INBOX'])),
    untrashThread: change('untrashThread', (threadId) => localModify(account, { threadId }, ['INBOX'], ['TRASH'])),
    send: change('send', async () => {}),
    async inboxUnread() {
      if (offline()) { await loadMem(); return (await localThreads(account, { folderId: 'inbox' })).filter((t) => t.unread).length; }
      return inner.inboxUnread();
    },
    async listLabels(force) {
      const cached = () => { try { const c = JSON.parse(localStorage.getItem('lm_labels_' + account) || 'null'); if (c) inner.labelCache = c; return c; } catch { return null; } };
      if (offline()) { const c = cached(); if (c) return c; }
      try { const l = await inner.listLabels(force); try { localStorage.setItem('lm_labels_' + account, JSON.stringify(l)); } catch {} return l; }
      catch (e) { if (isNetErr(e) || offline()) { try { const c = JSON.parse(localStorage.getItem('lm_labels_' + account) || 'null'); if (c) { inner.labelCache = c; return c; } } catch {} } throw e; }
    },
  };
  return new Proxy(inner, { get(t, p) { if (p in over) return over[p]; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } });
}

// ---------------- housekeeping ----------------
export async function offlineStats() {
  await loadMem();
  const metas = await tx('meta', 'readonly', (s) => reqP(s.getAll())).catch(() => []);
  let usage = 0; try { usage = (await navigator.storage?.estimate?.())?.usage || 0; } catch {}
  return { count: localCount(), perAccount: Object.fromEntries([...mem].map(([a, m]) => [a, m.size])), metas, usage, pending: (await pendingChanges()).length };
}
export async function clearAccount(account) {
  await loadMem();
  await removeMany(account, [...acctMap(account).keys()]);
  await tx(['meta', 'atts', 'outbox'], 'readwrite', (m, at, ob) => {
    m.delete(account);
    at.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (String(c.key).startsWith(account + '|')) c.delete(); c.continue(); } };
    ob.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { if (c.value.account === account) c.delete(); c.continue(); } };
  }).catch(() => {});
  mem.delete(account);
}
export async function clearAll() {
  mem.clear(); loaded = null;
  try { (await dbp)?.close(); } catch {}
  dbp = null;
  await new Promise((res) => { const r = indexedDB.deleteDatabase(DBN); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  await refreshPending().catch(() => {});
}
export async function askPersistentStorage() { try { return await navigator.storage?.persist?.(); } catch { return false; } }
export { isNetErr };
