// LifeMail email rules — the pure "brain" (no network, no screen). Unit-tested in tests/rules.test.mjs.
//
//   EMAIL ARRIVES → CHECK EVERY ENABLED RULE (in order) → EACH MATCHING RULE ADDS ITS ACTIONS
//   One email can match many rules and receive many labels. Rules never delete email.
//
// Rule format (saved in LifeMail's Google Drive file):
// { id, name, enabled, account: '' (all accounts) | 'me@x.com', logic: 'AND' | 'OR',
//   conditions: [{ field, op, value }], actions: [{ type, label? }], createdAt, activatedAt }

export const FIELDS = [
  { id: 'from', name: 'From (name or address)', kind: 'text', ph: 'e.g. rakesh@bisag-n.gov.in' },
  { id: 'fromDomain', name: 'From domain', kind: 'text', ph: 'e.g. @gsi.gov.in' },
  { id: 'to', name: 'To', kind: 'text', ph: 'e.g. ngdr@gsi.gov.in' },
  { id: 'cc', name: 'Cc', kind: 'text', ph: 'e.g. director@gsi.gov.in' },
  { id: 'subject', name: 'Subject', kind: 'text', ph: 'e.g. NGDR' },
  { id: 'body', name: 'Email text', kind: 'text', ph: 'e.g. BISAG' },
  { id: 'hasAttachment', name: 'Has attachment', kind: 'bool' },
  { id: 'attachmentName', name: 'Attachment file name', kind: 'text', ph: 'e.g. .pdf or invoice' },
];
export const OPERATORS = [
  { id: 'contains', name: 'contains' },
  { id: 'notContains', name: 'does not contain' },
  { id: 'equals', name: 'is exactly' },
  { id: 'startsWith', name: 'starts with' },
  { id: 'endsWith', name: 'ends with' },
];
export const ACTIONS = [
  { id: 'applyLabel', name: 'Apply label', needsLabel: true },
  { id: 'removeLabel', name: 'Remove label', needsLabel: true },
  { id: 'markImportant', name: 'Mark as important' },
  { id: 'markRead', name: 'Mark as read' },
  { id: 'star', name: 'Star' },
  { id: 'archive', name: 'Archive (remove from Inbox)', risky: true },
];
// Gmail's own (system) labels behind the simple actions.
const SYS = { markImportant: ['IMPORTANT', 'add'], star: ['STARRED', 'add'], markRead: ['UNREAD', 'remove'], archive: ['INBOX', 'remove'] };

export const fieldById = (id) => FIELDS.find((f) => f.id === id) || FIELDS[0];
export const opById = (id) => OPERATORS.find((o) => o.id === id) || OPERATORS[0];
export const actionById = (id) => ACTIONS.find((a) => a.id === id);

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const uid = () => 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function newRule(over = {}) {
  return { id: uid(), name: '', enabled: true, account: '', logic: 'AND', conditions: [{ field: 'fromDomain', op: 'contains', value: '' }], actions: [{ type: 'applyLabel', label: '' }], createdAt: Date.now(), activatedAt: Date.now(), ...over };
}

/** Cleans a rule (from the screen or from Drive) so the engine can trust its shape. */
export function normalizeRule(r) {
  const out = newRule({ ...r });
  out.name = String(out.name || '').trim().slice(0, 80);
  out.logic = out.logic === 'OR' ? 'OR' : 'AND';
  out.enabled = out.enabled !== false;
  out.account = String(out.account || '');
  out.conditions = (Array.isArray(r?.conditions) ? r.conditions : [])
    .map((c) => {
      const f = fieldById(c.field);
      if (f.kind === 'bool') return { field: f.id, op: 'is', value: c.value === false || c.value === 'false' || c.value === 'no' ? false : true };
      return { field: f.id, op: opById(c.op).id, value: String(c.value ?? '').trim().slice(0, 200) };
    })
    .filter((c) => typeof c.value === 'boolean' || c.value !== '');
  const seen = new Set();
  out.actions = (Array.isArray(r?.actions) ? r.actions : [])
    .map((a) => ({ type: actionById(a.type)?.id, label: String(a.label || '').trim().slice(0, 100) }))
    .filter((a) => a.type && (!actionById(a.type).needsLabel || a.label))
    .map((a) => (actionById(a.type).needsLabel ? a : { type: a.type }))
    .filter((a) => { const k = a.type + '|' + (a.label || '').toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

/** Problems that stop a rule from being saved, in plain words. */
export function validateRule(r) {
  const errs = [];
  if (!r.name) errs.push('Give the rule a name.');
  if (!r.conditions.length) errs.push('Add at least one condition (WHEN) with a value.');
  if (!r.actions.length) errs.push('Add at least one action (THEN). “Apply label” needs a label.');
  return errs;
}

// --- the email as the rules see it ---
// { from: 'Rakesh <rakesh@x.in>', fromEmail, to, cc, subject, body, hasAttachment, attachments: ['a.pdf'], labels: ['NGDR'], date }
function domainOf(email) { const m = String(email || '').toLowerCase().match(/@([^\s>]+)/); return m ? m[1] : ''; }
function fieldValue(msg, field) {
  switch (field) {
    case 'from': return [msg.from, msg.fromEmail].filter(Boolean).join(' ');
    case 'fromDomain': return domainOf(msg.fromEmail || msg.from);
    case 'to': return msg.to || '';
    case 'cc': return msg.cc || '';
    case 'subject': return msg.subject || '';
    case 'body': return msg.body || '';
    case 'attachmentName': return (msg.attachments || []).join('\n');
    default: return '';
  }
}

// A value may list alternatives separated by commas: subject contains "NGDR, BISAG" = either word.
const alternatives = (v) => String(v).split(',').map(norm).filter(Boolean);

function testOne(hay, op, want, field) {
  if (field === 'fromDomain') want = want.replace(/^@/, '');
  if (field === 'attachmentName' && op !== 'contains' && op !== 'notContains') {
    // each file name is tested on its own
    return hay.split('\n').some((h) => testOne(norm(h), op, want, 'x'));
  }
  switch (op) {
    case 'equals': return field === 'fromDomain' ? hay === want || hay.endsWith('.' + want) : hay === want;
    case 'startsWith': return hay.startsWith(want);
    case 'endsWith': return hay.endsWith(want);
    default: return hay.includes(want);
  }
}

export function evaluateCondition(c, msg) {
  const f = fieldById(c.field);
  if (f.kind === 'bool') {
    const has = !!msg.hasAttachment || (msg.attachments || []).length > 0;
    return has === (c.value !== false);
  }
  const hay = norm(fieldValue(msg, f.id));
  const alts = alternatives(c.value);
  if (!alts.length) return false;
  if (c.op === 'notContains') return !alts.some((a) => testOne(hay, 'contains', a, f.id));
  return alts.some((a) => testOne(hay, c.op, a, f.id));
}

export function describeCondition(c) {
  const f = fieldById(c.field);
  if (f.kind === 'bool') return c.value === false ? 'Has no attachment' : 'Has an attachment';
  const alts = String(c.value).split(',').map((x) => x.trim()).filter(Boolean);
  return `${f.name} ${opById(c.op).name} ${alts.map((a) => `“${a}”`).join(' or ')}`;
}
export function describeAction(a) {
  const d = actionById(a.type);
  if (!d) return '';
  return d.needsLabel ? `${a.type === 'applyLabel' ? 'Label' : 'Remove label'} “${a.label}”` : d.name;
}

/** Does this rule match this email? Returns the yes/no for every condition so the screen can explain why. */
export function evaluateRule(rule, msg) {
  const checks = rule.conditions.map((c) => ({ text: describeCondition(c), ok: evaluateCondition(c, msg) }));
  const matched = checks.length > 0 && (rule.logic === 'OR' ? checks.some((x) => x.ok) : checks.every((x) => x.ok));
  return { matched, checks };
}

export const ruleAppliesToAccount = (rule, account) => !rule.account || rule.account.toLowerCase() === String(account || '').toLowerCase();

/**
 * Runs every enabled rule (in order) on one email and works out the final change.
 * Rules do NOT stop at the first match. Labels the email already has are not added again,
 * and labels it does not have are not "removed". If two rules disagree, the later rule wins.
 * Returns { matched: [{rule, checks}], addLabels, removeLabels, addSystem, removeSystem, actions: [text] }
 */
export function planForEmail(rules, msg, { account = '', respectActivation = false } = {}) {
  const want = new Map(); // key -> {kind:'label'|'sys', name, add:boolean}
  const matched = [];
  for (const rule of rules) {
    if (!rule.enabled || !ruleAppliesToAccount(rule, account)) continue;
    if (respectActivation && msg.date && rule.activatedAt && msg.date < rule.activatedAt - 60_000) continue;
    const r = evaluateRule(rule, msg);
    if (!r.matched) continue;
    matched.push({ rule, checks: r.checks });
    for (const a of rule.actions) {
      if (a.type === 'applyLabel' || a.type === 'removeLabel') want.set('l:' + a.label.toLowerCase(), { kind: 'label', name: a.label, add: a.type === 'applyLabel' });
      else if (SYS[a.type]) want.set('s:' + SYS[a.type][0], { kind: 'sys', name: SYS[a.type][0], add: SYS[a.type][1] === 'add' });
    }
  }
  const have = new Set((msg.labels || []).map((x) => String(x).toLowerCase()));
  const sysHave = new Set(msg.systemLabels || []);
  const out = { matched, addLabels: [], removeLabels: [], addSystem: [], removeSystem: [], actions: [] };
  for (const w of want.values()) {
    if (w.kind === 'label') {
      const has = have.has(w.name.toLowerCase());
      if (w.add && !has) { out.addLabels.push(w.name); out.actions.push(`Label “${w.name}”`); }
      if (!w.add && has) { out.removeLabels.push(w.name); out.actions.push(`Remove label “${w.name}”`); }
    } else {
      const has = sysHave.has(w.name);
      if (w.add && !has) { out.addSystem.push(w.name); out.actions.push(w.name === 'STARRED' ? 'Star' : 'Mark as important'); }
      if (!w.add && has) { out.removeSystem.push(w.name); out.actions.push(w.name === 'INBOX' ? 'Archive' : 'Mark as read'); }
    }
  }
  return out;
}
export const planChanges = (p) => p.addLabels.length + p.removeLabels.length + p.addSystem.length + p.removeSystem.length;

export function summarizeRule(rule) {
  const join = rule.logic === 'OR' ? ' or ' : ' and ';
  return { when: rule.conditions.map(describeCondition).join(join) || 'No conditions', then: rule.actions.map(describeAction).join(', ') || 'No actions' };
}

/** Does any enabled rule need the full email (text / attachment names)? If not, LifeMail fetches only the headers. */
export function rulesNeedFullEmail(rules) {
  return rules.some((r) => r.enabled && r.conditions.some((c) => c.field === 'body' || c.field === 'attachmentName'));
}

/**
 * Optional quick fill from a sentence, worked out on this device (no AI service, nothing sent anywhere).
 * "Create a rule for all emails from GSI and label them GSI Mail" → From contains "GSI" → Label "GSI Mail".
 * The result only fills the rule builder; you check it before saving.
 */
export function parseRuleSentence(text, knownLabels = []) {
  const s = String(text || '').trim();
  if (!s) return null;
  const conds = [];
  const q = (re) => { const m = s.match(re); return m ? (m[1] || m[2] || '').trim() : ''; };
  const quoted = '["“”\']([^"“”\']+)["“”\']';
  const until = '(?=\\s+(?:and|with|label|tag|put|move|mark|star|archive|subject|having|that|which|into|→|->)\\b|[,;]|\\.(?:\\s|$)|$)';
  const lab = q(new RegExp(`(?:label(?:led)?(?: them| it| as| with)?|tag(?: them| it)?(?: as)?|put (?:them|it) (?:in|under)|move (?:them|it) to|→|->)\\s+(?:${quoted}|(.+?)(?=[,.;]|\\s+and\\s+(?:mark|star|archive)\\b|$))`, 'i'));
  const fromV = q(new RegExp(`\\bfrom\\s+(?:${quoted}|(.+?)${until})`, 'i'));
  const subjV = q(new RegExp(`\\bsubject(?:\\s+line)?\\s+(?:contains|containing|has|with|includes|mentions|is|=)?\\s*(?:${quoted}|(.+?)${until})`, 'i'))
    || q(new RegExp(`\\b(?:about|mentioning|regarding)\\s+(?:${quoted}|(.+?)${until})`, 'i'));
  const bodyV = q(new RegExp(`\\b(?:body|text|message)\\s+(?:contains|containing|has|includes|mentions)\\s+(?:${quoted}|(.+?)${until})`, 'i'));
  const toV = q(new RegExp(`\\bsent to\\s+(?:${quoted}|(.+?)${until})`, 'i'));
  if (fromV) {
    const v = fromV.replace(/^(?:the\s+)?/, '');
    if (/^@|^[\w-]+(\.[\w-]+)+$/.test(v)) conds.push({ field: 'fromDomain', op: 'contains', value: v });
    else conds.push({ field: 'from', op: 'contains', value: v });
  }
  if (toV) conds.push({ field: 'to', op: 'contains', value: toV });
  if (subjV) conds.push({ field: 'subject', op: 'contains', value: subjV });
  if (bodyV) conds.push({ field: 'body', op: 'contains', value: bodyV });
  if (/\b(with|having|has|contain(?:s|ing)?) (an? )?attachments?\b/i.test(s)) conds.push({ field: 'hasAttachment', op: 'is', value: true });
  const actions = [];
  if (lab) {
    const clean = lab.replace(/^(?:the\s+)?label\s+/i, '').replace(/\s+label$/i, '').trim();
    const known = knownLabels.find((l) => l.toLowerCase() === clean.toLowerCase());
    actions.push({ type: 'applyLabel', label: known || clean });
  }
  if (/\bmark (?:them |it )?(?:as )?important\b/i.test(s)) actions.push({ type: 'markImportant' });
  if (/\bmark (?:them |it )?(?:as )?read\b/i.test(s)) actions.push({ type: 'markRead' });
  if (/\bstar\b/i.test(s)) actions.push({ type: 'star' });
  if (/\barchive\b/i.test(s)) actions.push({ type: 'archive' });
  if (!conds.length && !actions.length) return null;
  const logic = /\b(?:either|any of)\b/i.test(s) && conds.length > 1 ? 'OR' : 'AND';
  const label = actions.find((a) => a.label)?.label;
  return { name: label ? `${label} emails` : 'New rule', logic, conditions: conds, actions };
}
