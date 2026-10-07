// Email search on the phone — works offline and gives results as you type.
// Understands the same search words as Gmail (and most email apps):
//   words / "exact phrase" / -exclude / a OR b
//   from:  to:  cc:  subject:  label:  filename:  has:attachment  is:unread|read|starred|important
//   in:inbox|sent|drafts|archive|spam|trash|anywhere   before:  after:  (2026/10/01 or 01/10/2026)
//   older_than: / newer_than: 7d 2m 1y    larger: / smaller: 5M 200K
// Pure functions (no network, no screen). Unit-tested in tests/search.test.mjs.

export const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const FIELD_ALIASES = { from: 'from', to: 'to', cc: 'cc', bcc: 'cc', subject: 'subject', label: 'label', l: 'label', filename: 'filename', has: 'has', is: 'is', in: 'in', before: 'before', after: 'after', older: 'before', newer: 'after', older_than: 'older_than', newer_than: 'newer_than', larger: 'larger', smaller: 'smaller', size: 'larger' };

function parseDate(v, endOfDay = false) {
  const m = String(v).match(/^(\d{1,4})[/.-](\d{1,2})[/.-](\d{1,4})$/);
  if (!m) return NaN;
  let [, a, b, c] = m.map(Number);
  let y, mo, d;
  if (String(m[1]).length === 4) { y = a; mo = b; d = c; } // 2026/10/01 (Gmail style)
  else { d = a; mo = b; y = c < 100 ? 2000 + c : c; }       // 01/10/2026 (Indian day/month/year)
  const t = new Date(y, mo - 1, d).getTime();
  return endOfDay ? t + 864e5 : t;
}
function parseAge(v) {
  const m = String(v).toLowerCase().match(/^(\d+)([dwmy])$/);
  if (!m) return NaN;
  return +m[1] * { d: 864e5, w: 7 * 864e5, m: 30.44 * 864e5, y: 365.25 * 864e5 }[m[2]];
}
function parseSize(v) {
  const m = String(v).toLowerCase().match(/^(\d+(?:\.\d+)?)(k|kb|m|mb)?$/);
  if (!m) return NaN;
  return +m[1] * (m[2]?.startsWith('m') ? 1048576 : m[2]?.startsWith('k') ? 1024 : 1);
}

/**
 * "from:rakesh NGDR -draft" → { groups: [[clause], …], nots: [clause], terms: ['ngdr'], folder, empty }
 * A clause is {field, value}. Every group must match (AND); inside a group any clause may match (OR).
 */
export function parseQuery(q, now = Date.now()) {
  const re = /(-)?(?:([a-z_]+):)?(?:"([^"]*)"?|\(([^)]*)\)?|(\S+))/gi;
  const items = []; let m;
  const src = String(q || '').trim();
  while ((m = re.exec(src))) {
    if (!m[0]) { re.lastIndex++; continue; }
    const neg = !!m[1]; let field = m[2] ? FIELD_ALIASES[m[2].toLowerCase()] : 'text';
    let value = m[3] ?? m[4] ?? m[5] ?? '';
    let phrase = m[3] !== undefined;
    if (m[2] && !field) { field = 'text'; value = m[2] + ':' + value; } // unknown "word:" → plain text
    if (!m[2] && !phrase && (value === 'OR' || value === '|')) { items.push({ or: true }); continue; }
    if (m[4] !== undefined && field !== 'text') { // from:(a b) → each word on that field
      value.split(/\s+/).filter(Boolean).forEach((w) => items.push({ neg, field, value: w }));
      continue;
    }
    if (!value) continue;
    items.push({ neg, field, value, phrase });
  }
  const groups = []; const nots = []; const terms = []; let folder = ''; let joinNext = false;
  for (const it of items) {
    if (it.or) { joinNext = groups.length > 0; continue; }
    const c = clause(it, now);
    if (!c) continue;
    if (c.field === 'in') { if (!it.neg) folder = c.value; else nots.push(c); continue; }
    if (it.neg) { nots.push(c); joinNext = false; continue; }
    if (joinNext) groups[groups.length - 1].push(c); else groups.push([c]);
    joinNext = false;
    if (c.field === 'text' || c.field === 'subject') terms.push(c.value);
  }
  return { groups, nots, terms, folder, empty: !groups.length && !nots.length && !folder };
}

function clause(it, now) {
  const v = norm(it.value).trim();
  switch (it.field) {
    case 'before': { const t = parseDate(it.value); return isNaN(t) ? null : { field: 'before', value: t }; }
    case 'after': { const t = parseDate(it.value); return isNaN(t) ? null : { field: 'after', value: t }; }
    case 'older_than': { const a = parseAge(it.value); return isNaN(a) ? null : { field: 'before', value: now - a }; }
    case 'newer_than': { const a = parseAge(it.value); return isNaN(a) ? null : { field: 'after', value: now - a }; }
    case 'larger': { const s = parseSize(it.value); return isNaN(s) ? null : { field: 'larger', value: s }; }
    case 'smaller': { const s = parseSize(it.value); return isNaN(s) ? null : { field: 'smaller', value: s }; }
    case 'has': return { field: 'has', value: v.replace(/s$/, '') };
    case 'is': return { field: 'is', value: v };
    case 'in': return { field: 'in', value: v };
    default: return v ? { field: it.field, value: v } : null;
  }
}

const SYS = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT']);

/** Lower-cased text of one message, prepared once and reused for every search. */
export function prepare(doc) {
  if (doc._p) return doc._p;
  const from = norm(`${doc.fromName || ''} ${doc.fromEmail || ''} ${doc.from || ''}`);
  const to = norm(doc.to || ''); const cc = norm(`${doc.cc || ''} ${doc.bcc || ''}`);
  const subject = norm(doc.subject || ''); const body = norm(doc.body || doc.snippet || '');
  const files = norm((doc.files || []).join(' \n '));
  Object.defineProperty(doc, '_p', { value: { from, to, cc, subject, body, files, all: `${subject}\n${from}\n${to}\n${cc}\n${files}\n${body}` }, enumerable: false, configurable: true });
  return doc._p;
}
export function forget(doc) { delete doc._p; }

function folderOk(doc, folder) {
  const L = doc.labelIds || [];
  switch (folder) {
    case 'anywhere': return true;
    case 'inbox': return L.includes('INBOX');
    case 'sent': return L.includes('SENT');
    case 'draft': case 'drafts': return L.includes('DRAFT');
    case 'spam': return L.includes('SPAM');
    case 'trash': return L.includes('TRASH');
    case 'starred': return L.includes('STARRED');
    case 'archive': return !['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].some((l) => L.includes(l));
    default: return !L.includes('SPAM') && !L.includes('TRASH'); // like Gmail: spam & trash only when asked
  }
}

function test(doc, c, labelNames) {
  const p = prepare(doc);
  switch (c.field) {
    case 'text': return p.all.includes(c.value);
    case 'from': return p.from.includes(c.value);
    case 'to': return p.to.includes(c.value) || p.cc.includes(c.value);
    case 'cc': return p.cc.includes(c.value);
    case 'subject': return p.subject.includes(c.value);
    case 'filename': return p.files.includes(c.value);
    case 'label': { const want = c.value.replace(/-/g, ' '); return labelNames(doc).some((n) => { const x = norm(n); return x === c.value || x === want || x.replace(/[\s/]+/g, '-') === c.value; }); }
    case 'has': return c.value === 'attachment' ? !!doc.hasAtt || (doc.files || []).length > 0 : c.value === 'star' ? (doc.labelIds || []).includes('STARRED') : c.value === 'userlabel' ? (doc.labelIds || []).some((l) => !SYS.has(l) && !l.startsWith('CATEGORY_')) : false;
    case 'is': {
      const L = doc.labelIds || [];
      return { unread: L.includes('UNREAD'), read: !L.includes('UNREAD'), starred: L.includes('STARRED'), important: L.includes('IMPORTANT'), snoozed: false }[c.value] ?? false;
    }
    case 'before': return doc.date < c.value;
    case 'after': return doc.date >= c.value;
    case 'larger': return (doc.size || 0) > c.value;
    case 'smaller': return (doc.size || 0) < c.value;
    case 'in': return folderOk(doc, c.value);
    default: return false;
  }
}

/** Does this message match the search? labelNames(doc) → its label names (for label:). */
export function matches(doc, parsed, labelNames = () => []) {
  if (!folderOk(doc, parsed.folder)) return false;
  for (const g of parsed.groups) if (!g.some((c) => test(doc, c, labelNames))) return false;
  for (const c of parsed.nots) if (test(doc, c, labelNames)) return false;
  return true;
}

/** A short piece of the email around the first word you searched for (like Gmail's search snippets). */
export function excerpt(doc, parsed, len = 150) {
  const body = String(doc.body || doc.snippet || '').replace(/\s+/g, ' ').trim();
  const lower = norm(body);
  for (const t of parsed.terms) {
    const i = lower.indexOf(t);
    if (i < 0) continue;
    const start = Math.max(0, i - 50);
    return (start ? '…' : '') + body.slice(start, start + len).trim() + (start + len < body.length ? '…' : '');
  }
  return doc.snippet || body.slice(0, len);
}

/** Group matching messages into conversations, newest first. */
export function groupThreads(docs) {
  const by = new Map();
  for (const d of docs) {
    const k = d.account + '|' + d.threadId;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(d);
  }
  return [...by.values()].map((ms) => ms.sort((a, b) => a.date - b.date)).sort((a, b) => b[b.length - 1].date - a[a.length - 1].date);
}

/** Search suggestions: people you have emailed with, ranked by how often (works offline). */
export function peopleIndex(docs, myEmails = []) {
  const mine = new Set(myEmails.map((e) => e.toLowerCase()));
  const people = new Map();
  const add = (name, email, w) => {
    email = String(email || '').toLowerCase().trim(); if (!email || mine.has(email) || !email.includes('@')) return;
    const p = people.get(email) || { email, name: '', n: 0 };
    if (name && name !== email && !p.name) p.name = name.replace(/^"|"$/g, '').trim();
    p.n += w; people.set(email, p);
  };
  for (const d of docs) {
    add(d.fromName, d.fromEmail, 1);
    for (const part of String(d.to || '').split(',')) { const m = part.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); if (m) add(m[1], m[2], 2); else add('', part, 2); }
  }
  return [...people.values()].sort((a, b) => b.n - a.n);
}
export function suggestPeople(people, text, max = 5) {
  const t = norm(text).trim(); if (!t || t.length < 2) return [];
  return people.filter((p) => norm(p.name).split(/\s+/).some((w) => w.startsWith(t)) || norm(p.email).startsWith(t) || norm(p.name).startsWith(t)).slice(0, max);
}
