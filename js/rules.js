// LifeMail email rules — running them against Gmail, plus label management (create / rename / delete / counts).
//
// When do rules run?  LifeMail has no server, so rules run inside LifeMail (phone or computer):
//   • new email: every time LifeMail checks for mail (and right after it opens, catching up on
//     everything that arrived while it was closed — Gmail keeps about a week of change history;
//     for longer gaps LifeMail searches by date instead);
//   • "Run rules now", and "Run on existing emails" (with a preview first).
// Rules only add/remove labels, star, mark important/read or archive. Nothing is ever deleted.
// Each device remembers how far it has processed (a small marker on the device), so the same
// email is not processed again unless you choose "Run on existing emails".
import { S, D, provider, emit } from './core.js';
import { paced } from './offline.js';
import { normalizeRule, planForEmail, planChanges, rulesNeedFullEmail, ruleAppliesToAccount, evaluateRule } from './rules-engine.js';

const SKIP = ['SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT'];
const STATE_KEY = 'lm_rules_state_v1';
const LOG_MAX = 60;

export const allRules = () => (D().rules || []).map(normalizeRule);
export const activeRulesFor = (account) => allRules().filter((r) => r.enabled && ruleAppliesToAccount(r, account));

function readState() { try { return JSON.parse(localStorage.getItem(STATE_KEY) || '{}'); } catch { return {}; } }
function writeState(st) { try { localStorage.setItem(STATE_KEY, JSON.stringify(st)); } catch {} }

async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

// Gmail gives label ids; rules use names.
async function labelMaps(account) {
  const labels = await provider(account).listLabels();
  S.labels[account] = labels;
  return { byId: new Map(labels.map((l) => [l.id, l])), labels };
}
function asRuleEmail(m, byId) {
  const user = []; const sys = [];
  for (const id of m.labelIds || []) { const l = byId.get(id); if (l && l.type === 'user') user.push(l.name); else sys.push(id); }
  return { ...m, labels: user, systemLabels: sys };
}

/** Fetch emails (headers only unless a rule needs the text) in the shape the rules understand. */
export async function fetchRuleEmails(account, ids, rules) {
  const p = provider(account);
  const full = rulesNeedFullEmail(rules);
  const { byId } = await labelMaps(account);
  const msgs = await pool(ids, 4, async (id) => { try { return await (S.demo ? p.getRuleMessage(id, full) : paced(account, () => p.getRuleMessage(id, full))); } catch (e) { if (e.authNeeded) throw e; return null; } });
  return msgs.filter((m) => m && !SKIP.some((l) => m.labelIds.includes(l))).map((m) => asRuleEmail(m, byId));
}

/** Apply worked-out changes to Gmail. Messages needing the same change go in one request. */
export async function applyPlans(account, items) {
  const p = provider(account);
  const { labels } = await labelMaps(account);
  const idOf = (name) => labels.find((l) => l.type === 'user' && l.name.toLowerCase() === name.toLowerCase())?.id;
  let created = false;
  const groups = new Map();
  for (const { msg, plan } of items) {
    if (!planChanges(plan)) continue;
    const add = [...plan.addSystem]; const remove = [...plan.removeSystem];
    for (const n of plan.addLabels) {
      let id = idOf(n);
      if (!id) { id = await p.ensureLabel(n); created = true; labels.push({ id, name: n, type: 'user' }); }
      add.push(id);
    }
    for (const n of plan.removeLabels) { const id = idOf(n); if (id) remove.push(id); }
    if (!add.length && !remove.length) continue;
    const key = add.sort().join(',') + '|' + remove.sort().join(',');
    if (!groups.has(key)) groups.set(key, { add, remove, ids: [] });
    groups.get(key).ids.push(msg.id);
  }
  let changed = 0;
  for (const g of groups.values()) { await p.batchModify(g.ids, g.add, g.remove); changed += g.ids.length; }
  return { changed, created };
}

function addLog(entries) {
  if (!entries.length) return;
  S.store.update((d) => { d.ruleLog = [...entries, ...(d.ruleLog || [])].slice(0, LOG_MAX); });
}
// One history line per rule that matched (or one "no rule matched" line for manual runs).
function logEntries({ account, trigger, checked, matched, ok = true, error = '' }) {
  const at = Date.now();
  if (!ok) return [{ at, account, trigger, rule: 'All rules', checked, matched: 0, action: '', status: 'Failed', error }];
  const per = new Map();
  for (const { plan } of matched) for (const m of plan.matched) {
    const e = per.get(m.rule.id) || { rule: m.rule, n: 0 };
    e.n++; per.set(m.rule.id, e);
  }
  const out = [...per.values()].map((e) => ({ at, account, trigger, rule: e.rule.name, checked, matched: e.n, action: e.rule.actions.map((a) => (a.label ? `${a.type === 'removeLabel' ? '−' : ''}${a.label}` : a.type)).join(', '), status: 'Success', error: '' }));
  if (!out.length && trigger !== 'new') out.push({ at, account, trigger, rule: 'All rules', checked, matched: 0, action: 'No rule matched', status: 'Success', error: '' });
  return out;
}

const running = new Set();

/** Process emails that arrived since the last check. Called by the mail check (poll) and "Run rules now". */
export async function runRulesOnNew(account, { trigger = 'new' } = {}) {
  if (running.has(account)) return null;
  running.add(account);
  const st = readState(); const mine = st[account] || {};
  const p = provider(account);
  try {
    const rules = activeRulesFor(account);
    if (!rules.length || !mine.historyId) {
      // Nothing to do yet: remember roughly "now" (refreshed daily, to keep the check cheap).
      // A rule only acts on new email that arrives after it was switched on, so old mail is never touched here.
      if (!mine.historyId || Date.now() - (mine.at || 0) > 864e5) { st[account] = { historyId: await p.currentHistoryId(), at: Date.now(), done: [] }; writeState(st); }
      return { checked: 0, matched: [], changed: 0 };
    }
    let ids; let historyId;
    try {
      const h = await p.historyAddedIds(mine.historyId);
      historyId = h.historyId;
      ids = h.messages.filter((m) => !SKIP.some((l) => m.labelIds.includes(l))).map((m) => m.id);
    } catch (e) {
      if (e.status !== 404) throw e;
      // LifeMail was closed for longer than Gmail keeps history: look up mail by date instead.
      const since = Math.floor(((mine.at || Date.now() - 7 * 864e5) - 3600_000) / 1000);
      ids = await p.listMessageIds({ q: `after:${since} -in:sent -in:drafts -in:chats`, max: 500 });
      historyId = await p.currentHistoryId();
    }
    const done = new Set(mine.done || []);
    ids = [...new Set(ids)].filter((id) => !done.has(id));
    let result = { checked: 0, matched: [], changed: 0, created: false };
    if (ids.length) {
      const emails = await fetchRuleEmails(account, ids, rules);
      const items = emails.map((msg) => ({ msg, plan: planForEmail(rules, msg, { account, respectActivation: true }) }));
      const matched = items.filter((x) => x.plan.matched.length);
      const r = await applyPlans(account, matched);
      result = { checked: emails.length, matched, changed: r.changed, created: r.created };
      addLog(logEntries({ account, trigger, checked: emails.length, matched }));
      if (r.changed) emit('rules-applied', { account, created: r.created });
    } else if (trigger !== 'new') addLog(logEntries({ account, trigger, checked: 0, matched: [] }));
    st[account] = { historyId, at: Date.now(), done: [...ids, ...(mine.done || [])].slice(0, 300) }; writeState(st);
    return result;
  } catch (e) {
    if (!e.authNeeded && !e.quota) addLog(logEntries({ account, trigger, checked: 0, matched: [], ok: false, error: e.message }));
    throw e;
  } finally { running.delete(account); }
}

/** Accounts a set of rules can work on right now (signed in). */
export function ruleAccounts(rules) {
  const accts = D().accounts.filter((a) => S.demo || !S.authNeeded.has(a.email));
  if (rules.length && rules.every((r) => r.account)) return accts.filter((a) => rules.some((r) => ruleAppliesToAccount(r, a.email)));
  return accts;
}

/**
 * Preview rules on emails you already have (newest first). Nothing changes until applyPreview().
 * Returns { checked, matches: [{account, msg, plan}], perRule: Map(ruleId → count), errors: [] }
 */
export async function previewExisting(rules, { days = 30, max = 300, onProgress } = {}) {
  rules = rules.map(normalizeRule);
  const out = { checked: 0, matches: [], perRule: new Map(), errors: [], days };
  for (const a of ruleAccounts(rules)) {
    const mine = rules.filter((r) => ruleAppliesToAccount(r, a.email));
    if (!mine.length) continue;
    try {
      onProgress?.(`Checking ${a.email}…`);
      const ids = await provider(a.email).listMessageIds({ q: `newer_than:${days}d -in:sent -in:drafts -in:chats`, max });
      const emails = await fetchRuleEmails(a.email, ids, mine);
      out.checked += emails.length;
      for (const msg of emails) {
        const plan = planForEmail(mine.map((r) => ({ ...r, enabled: true })), msg, { account: a.email });
        if (!plan.matched.length) continue;
        out.matches.push({ account: a.email, msg, plan });
        for (const m of plan.matched) out.perRule.set(m.rule.id, (out.perRule.get(m.rule.id) || 0) + 1);
      }
    } catch (e) { out.errors.push(`${a.email}: ${e.authNeeded ? 'Gmail connection required — reconnect this account.' : e.message}`); }
  }
  return out;
}

export async function applyPreview(preview, { trigger = 'existing' } = {}) {
  const byAcct = new Map();
  for (const m of preview.matches) { if (!byAcct.has(m.account)) byAcct.set(m.account, []); byAcct.get(m.account).push(m); }
  let changed = 0; let created = false; const errors = [];
  for (const [account, items] of byAcct) {
    try {
      const r = await applyPlans(account, items);
      changed += r.changed; created ||= r.created;
      addLog(logEntries({ account, trigger, checked: preview.checked, matched: items }));
    } catch (e) {
      errors.push(`${account}: ${e.message}`);
      addLog(logEntries({ account, trigger, checked: preview.checked, matched: [], ok: false, error: e.message }));
    }
  }
  if (changed) emit('rules-applied', { created });
  return { changed, errors };
}

/** Run every rule on new email for all signed-in accounts now. */
export async function runAllNow() {
  let checked = 0; let changed = 0; const errors = [];
  for (const a of ruleAccounts(allRules())) {
    try { const r = await runRulesOnNew(a.email, { trigger: 'manual' }); if (r) { checked += r.checked; changed += r.changed; } }
    catch (e) { errors.push(`${a.email}: ${e.authNeeded ? 'Gmail connection required' : e.message}`); }
  }
  return { checked, changed, errors };
}

/** Test all rules on one email (the newest message of a conversation). */
export async function testRulesOnEmail(account, messageId) {
  const rules = allRules();
  const [msg] = await fetchRuleEmails(account, [messageId], [{ enabled: true, conditions: [{ field: 'body' }] }]);
  if (!msg) throw new Error('This email cannot be tested (sent, draft, spam or trash).');
  const results = rules.map((rule) => {
    const r = evaluateRule(rule, msg);
    return { rule, applies: ruleAppliesToAccount(rule, account), matched: r.matched, checks: r.checks };
  });
  const plan = planForEmail(rules, msg, { account });
  return { msg, results, plan };
}

// ================= labels =================
// A label is one name across your accounts (each Gmail account has its own copy).

export async function loadAllLabels() {
  await Promise.all(D().accounts.filter((a) => S.demo || !S.authNeeded.has(a.email)).map(async (a) => {
    try { S.labels[a.email] = await provider(a.email).listLabels(true); } catch (e) { if (e.authNeeded) S.authNeeded.add(a.email); }
  }));
}

/** All label names: those in Gmail plus pinned ones not created yet. */
export function labelCatalog() {
  const map = new Map();
  for (const a of D().accounts) for (const l of S.labels[a.email] || []) {
    if (l.type !== 'user') continue;
    const k = l.name.toLowerCase();
    if (!map.has(k)) map.set(k, { name: l.name, accounts: [] });
    map.get(k).accounts.push({ account: a.email, id: l.id });
  }
  for (const n of D().pinnedLabels) if (!map.has(n.toLowerCase())) map.set(n.toLowerCase(), { name: n, accounts: [] });
  return [...map.values()].sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base', numeric: true }));
}

export async function labelCounts(entry) {
  let threads = 0; let unread = 0;
  await Promise.all(entry.accounts.map(async ({ account, id }) => {
    try { const c = await provider(account).labelInfo(id); threads += c.threads; unread += c.unread; } catch {}
  }));
  return { threads, unread };
}

export async function createLabel(name, accounts) {
  name = String(name || '').trim().replace(/\s*\/\s*/g, '/');
  if (!name) throw new Error('Type a label name.');
  if (/^(inbox|sent|drafts?|spam|trash|starred|important|unread|chats?)$/i.test(name)) throw new Error(`“${name}” is reserved by Gmail. Choose another name.`);
  const errors = [];
  for (const a of accounts) { try { await provider(a).ensureLabel(name); } catch (e) { errors.push(`${a}: ${e.message}`); } }
  S.store.update((d) => { if (!d.labelColors[name]) d.labelColors[name] = PALETTE[Object.keys(d.labelColors).length % PALETTE.length]; d.hiddenLabels = d.hiddenLabels.filter((x) => x !== name); });
  await loadAllLabels();
  if (errors.length === accounts.length && accounts.length) throw new Error(errors.join('\n'));
  return name;
}

const moveKey = (obj, from, to) => { if (obj && from in obj) { if (!(to in obj)) obj[to] = obj[from]; delete obj[from]; } };
const renameIn = (list, from, to) => list.map((x) => (x.toLowerCase() === from.toLowerCase() ? to : x.toLowerCase().startsWith(from.toLowerCase() + '/') ? to + x.slice(from.length) : x));

/** Rename in every account; sub-labels ("Old/…") follow, and rules that use the label are updated. */
export async function renameLabel(oldName, newName) {
  newName = String(newName || '').trim().replace(/\s*\/\s*/g, '/');
  if (!newName || newName === oldName) return oldName;
  const lower = oldName.toLowerCase();
  const errors = [];
  for (const a of D().accounts) {
    const list = (S.labels[a.email] || []).filter((l) => l.type === 'user' && (l.name.toLowerCase() === lower || l.name.toLowerCase().startsWith(lower + '/')));
    for (const l of list) {
      try { await provider(a.email).renameLabel(l.id, newName + l.name.slice(oldName.length)); } catch (e) { errors.push(`${a.email}: ${e.message}`); }
    }
  }
  S.store.update((d) => {
    for (const k of Object.keys(d.labelColors)) if (k.toLowerCase() === lower || k.toLowerCase().startsWith(lower + '/')) moveKey(d.labelColors, k, newName + k.slice(oldName.length));
    d.pinnedLabels = renameIn(d.pinnedLabels, oldName, newName);
    d.hiddenLabels = renameIn(d.hiddenLabels, oldName, newName);
    for (const r of d.rules || []) for (const a of r.actions || []) if (a.label) a.label = renameIn([a.label], oldName, newName)[0];
  });
  if (S.view.label && S.view.label.toLowerCase() === lower) S.view.label = newName;
  await loadAllLabels();
  if (errors.length) throw new Error('Some accounts could not rename it: ' + errors.join('; '));
  return newName;
}

/** Rules that put emails under this label. */
export const rulesUsingLabel = (name) => allRules().filter((r) => r.actions.some((a) => a.type === 'applyLabel' && a.label.toLowerCase() === name.toLowerCase()));

/** Delete the label from Gmail (emails stay; only the label goes). Rules that apply it are switched off. */
export async function deleteLabel(name) {
  const lower = name.toLowerCase(); const errors = [];
  for (const a of D().accounts) {
    const l = (S.labels[a.email] || []).find((x) => x.type === 'user' && x.name.toLowerCase() === lower);
    if (l) { try { await provider(a.email).deleteLabel(l.id); } catch (e) { errors.push(`${a.email}: ${e.message}`); } }
  }
  const off = rulesUsingLabel(name).map((r) => r.id);
  S.store.update((d) => {
    delete d.labelColors[name];
    d.pinnedLabels = d.pinnedLabels.filter((x) => x.toLowerCase() !== lower);
    d.hiddenLabels = d.hiddenLabels.filter((x) => x.toLowerCase() !== lower);
    for (const r of d.rules || []) if (off.includes(r.id)) r.enabled = false;
  });
  if (S.view.label && S.view.label.toLowerCase() === lower) S.view.label = '';
  await loadAllLabels();
  if (errors.length) throw new Error(errors.join('; '));
  return off.length;
}

export const PALETTE = ['#3a6ea5', '#2f7d6d', '#b4583a', '#7a6ab8', '#a0782b', '#b05c9a', '#4f8a3c', '#c2453d', '#5f6f7a', '#d9822b', '#2b8a9a', '#8a5a44'];
