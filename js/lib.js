// LifeMail — pure helper functions (no DOM, no network). Unit-tested in tests/lib.test.mjs.

export const PAYLOAD_VERSION = 1;
export const PAYLOAD_MIME = 'application/x-lifemail+json';
export const PAYLOAD_MARKER = 'lifemail-payload:';

// ---------- base64url ----------
export function utf8ToB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64ToUtf8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}
export const toB64Url = (b64) => b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64Url(s) {
  let b = s.replace(/-/g, '+').replace(/_/g, '/');
  while (b.length % 4) b += '=';
  return b;
}
export const encodeB64Url = (str) => toB64Url(utf8ToB64(str));
export const decodeB64Url = (s) => b64ToUtf8(fromB64Url(s));
export function b64UrlToBytes(s) {
  const bin = atob(fromB64Url(s));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------- addresses / headers ----------
export function parseAddress(raw = '') {
  const s = String(raw).trim();
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  return { name: s, email: s.toLowerCase() };
}
export function splitAddressList(raw = '') {
  // split on commas not inside quotes
  const out = []; let cur = ''; let q = false;
  for (const ch of String(raw)) {
    if (ch === '"') q = !q;
    if ((ch === ',' || ch === ';') && !q) { if (cur.trim()) out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
export function isValidEmail(e) { return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/.test(String(e).trim()); }

export function headerMap(headers = []) {
  const m = {};
  for (const h of headers) m[h.name.toLowerCase()] = h.value;
  return m;
}

// RFC 2047 encode a header value only when it contains non-ASCII
export function encodeHeader(v = '') {
  return /[^\x20-\x7e]/.test(v) ? `=?UTF-8?B?${utf8ToB64(v)}?=` : v;
}
function encodeAddressHeader(list) {
  return splitAddressList(list).map((a) => {
    const p = parseAddress(a);
    if (p.name && p.name.toLowerCase() !== p.email) return `${encodeHeader(p.name.replace(/"/g, ''))} <${p.email}>`;
    return p.email;
  }).join(', ');
}

function wrap76(b64) { return b64.replace(/.{1,76}/g, '$&\r\n').trimEnd(); }

// Build an RFC 2822 message. attachments: [{filename, mimeType, base64}]
export function buildMime({ from, to = '', cc = '', bcc = '', subject = '', html = '', text = '', inReplyTo = '', references = '', attachments = [], boundarySeed = Date.now().toString(36) }) {
  const alt = `alt_${boundarySeed}`;
  const mix = `mix_${boundarySeed}`;
  const head = [
    `From: ${encodeAddressHeader(from)}`,
    to && `To: ${encodeAddressHeader(to)}`,
    cc && `Cc: ${encodeAddressHeader(cc)}`,
    bcc && `Bcc: ${encodeAddressHeader(bcc)}`,
    `Subject: ${encodeHeader(subject)}`,
    inReplyTo && `In-Reply-To: ${inReplyTo}`,
    references && `References: ${references}`,
    'MIME-Version: 1.0',
  ].filter(Boolean);
  const plain = text || htmlToText(html);
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToB64(plain)),
    `--${alt}`, 'Content-Type: text/html; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', wrap76(utf8ToB64(html || escapeHtml(plain).replace(/\n/g, '<br>'))),
    `--${alt}--`,
  ].join('\r\n');
  if (!attachments.length) return head.join('\r\n') + '\r\n' + altPart + '\r\n';
  const parts = [`Content-Type: multipart/mixed; boundary="${mix}"`, '', `--${mix}`, altPart];
  for (const a of attachments) {
    const fn = encodeHeader(a.filename || 'attachment').replace(/"/g, '');
    parts.push(`--${mix}`,
      `Content-Type: ${a.mimeType || 'application/octet-stream'}; name="${fn}"`,
      `Content-Disposition: attachment; filename="${fn}"`,
      'Content-Transfer-Encoding: base64', '', wrap76(a.base64));
  }
  parts.push(`--${mix}--`);
  return head.join('\r\n') + '\r\n' + parts.join('\r\n') + '\r\n';
}

export function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function htmlToText(html = '') {
  return String(html)
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)[^>]*>/gi, '\n')
    .replace(/<\/t[dh]>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n').trim();
}

// ---------- Gmail payload walking ----------
// Returns {html, text, attachments:[{filename,mimeType,size,attachmentId,contentId,inline}]}
export function extractParts(payload) {
  const res = { html: '', text: '', attachments: [] };
  const walk = (p) => {
    if (!p) return;
    const mt = (p.mimeType || '').toLowerCase();
    const hm = headerMap(p.headers || []);
    const cid = (hm['content-id'] || '').replace(/[<>]/g, '');
    const disp = (hm['content-disposition'] || '').toLowerCase();
    if (p.filename || (p.body && p.body.attachmentId && !mt.startsWith('text/'))) {
      res.attachments.push({
        filename: p.filename || 'attachment', mimeType: mt, size: p.body?.size || 0,
        attachmentId: p.body?.attachmentId || null, data: p.body?.data || null,
        contentId: cid, inline: !!cid && !disp.startsWith('attachment'),
      });
    } else if (mt === 'text/html' && p.body?.data) res.html += decodeB64Url(p.body.data);
    else if (mt === 'text/plain' && p.body?.data) res.text += decodeB64Url(p.body.data);
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return res;
}

// ---------- links ----------
export function gmailWebUrl({ account, threadId, rfcMessageId }) {
  const au = encodeURIComponent(account || '');
  if (rfcMessageId) {
    const id = rfcMessageId.replace(/[<>]/g, '');
    return `https://mail.google.com/mail/?authuser=${au}#search/rfc822msgid%3A${encodeURIComponent(id)}`;
  }
  return `https://mail.google.com/mail/?authuser=${au}#all/${encodeURIComponent(threadId || '')}`;
}
export function lifemailUrl(origin, { account, threadId }) {
  return `${origin.replace(/\/$/, '')}/#open=${encodeURIComponent(account)}/${encodeURIComponent(threadId)}`;
}
export function parseOpenHash(hash = '') {
  const m = String(hash).match(/^#open=([^/]+)\/([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const account = decodeURIComponent(m[1]);
  if (!isValidEmail(account)) return null;
  return { account, threadId: m[2] };
}

// ---------- LifeOS payload (the integration contract) ----------
export function createTaskPayload(email, task = {}, origin = '') {
  const p = {
    v: PAYLOAD_VERSION,
    source: 'lifemail',
    provider: email.provider || 'gmail',
    account: email.account,
    messageId: email.messageId,
    threadId: email.threadId,
    rfcMessageId: email.rfcMessageId || '',
    subject: (email.subject || '(no subject)').slice(0, 300),
    senderName: (email.from?.name || '').slice(0, 120),
    senderEmail: email.from?.email || '',
    emailDate: email.date ? new Date(email.date).toISOString() : '',
    emailUrl: gmailWebUrl({ account: email.account, threadId: email.threadId, rfcMessageId: email.rfcMessageId }),
    lifemailUrl: origin ? lifemailUrl(origin, email) : '',
    preview: (email.snippet || '').slice(0, 280),
    attachments: (email.attachmentNames || []).slice(0, 20),
    task: {
      title: (task.title || email.subject || 'Follow up').slice(0, 200),
      project: task.project || '',
      due: task.due || '',
      priority: task.priority || '',
      destination: task.destination || '',
      notes: (task.notes || '').slice(0, 2000),
      keepEmailLink: task.keepEmailLink !== false,
    },
    createdFromEmail: true,
    createdAt: new Date().toISOString(),
  };
  return p;
}
export const encodePayload = (p) => encodeB64Url(JSON.stringify(p));

// Validate anything coming back in (LifeOS side uses the same function).
export function validatePayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.source !== 'lifemail' || typeof obj.v !== 'number') return null;
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const url = (v) => (typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, 2000) : '');
  const t = obj.task && typeof obj.task === 'object' ? obj.task : {};
  return {
    v: obj.v, source: 'lifemail', provider: str(obj.provider, 20),
    account: str(obj.account, 200), messageId: str(obj.messageId, 100), threadId: str(obj.threadId, 100),
    rfcMessageId: str(obj.rfcMessageId, 300), subject: str(obj.subject, 300), senderName: str(obj.senderName, 120),
    senderEmail: str(obj.senderEmail, 200), emailDate: str(obj.emailDate, 40), emailUrl: url(obj.emailUrl),
    lifemailUrl: url(obj.lifemailUrl), preview: str(obj.preview, 280),
    attachments: Array.isArray(obj.attachments) ? obj.attachments.filter((a) => typeof a === 'string').slice(0, 20).map((a) => a.slice(0, 200)) : [],
    task: {
      title: str(t.title, 200) || str(obj.subject, 200), project: str(t.project, 100), due: str(t.due, 40),
      priority: ['high', 'medium', 'low', ''].includes(t.priority) ? t.priority : '', destination: str(t.destination, 40),
      notes: str(t.notes, 2000), keepEmailLink: t.keepEmailLink !== false,
    },
    createdFromEmail: true, createdAt: str(obj.createdAt, 40),
  };
}
export function decodePayload(s) {
  try { return validatePayload(JSON.parse(decodeB64Url(String(s).trim()))); } catch { return null; }
}

// Human-readable text that also carries the machine payload on its last line.
export function payloadToText(p) {
  return [
    `📧 ${p.task.title}`,
    `From: ${p.senderName ? p.senderName + ' <' + p.senderEmail + '>' : p.senderEmail}`,
    `Subject: ${p.subject}`,
    p.preview ? `“${p.preview}”` : '',
    p.emailUrl ? `Open email: ${p.emailUrl}` : '',
    `${PAYLOAD_MARKER}${encodePayload(p)}`,
  ].filter(Boolean).join('\n');
}
// Find a payload anywhere in dropped/shared text or URL.
export function extractPayloadFromText(text = '') {
  const s = String(text);
  let m = s.match(new RegExp(PAYLOAD_MARKER + '([A-Za-z0-9_-]+)'));
  if (m) return decodePayload(m[1]);
  m = s.match(/[?&#]lifemail=([A-Za-z0-9_-]+)/);
  if (m) return decodePayload(m[1]);
  return null;
}
// LifeOS must be https (http only for local testing on this device)
export function isAllowedLifeOSUrl(u) { return /^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u); }
// Build the LifeOS URL from a template such as https://my-lifeos.vercel.app/?lifemail={payload}
export function buildLifeOSUrl(template, p) {
  if (!template || !isAllowedLifeOSUrl(template)) return '';
  const enc = encodePayload(p);
  if (template.includes('{payload}')) return template.replace('{payload}', enc);
  return template + (template.includes('?') ? '&' : '?') + 'lifemail=' + enc;
}

// ---------- folders ----------
export const FOLDERS = [
  { id: 'inbox', name: 'Inbox', labelIds: ['INBOX'] },
  { id: 'starred', name: 'Starred', labelIds: ['STARRED'] },
  { id: 'snoozed', name: 'Snoozed', q: 'in:snoozed' },
  { id: 'drafts', name: 'Drafts', labelIds: ['DRAFT'] },
  { id: 'sent', name: 'Sent', labelIds: ['SENT'] },
  { id: 'archive', name: 'Archive', q: '-in:inbox -in:sent -in:drafts -in:spam -in:trash -in:chats' },
  { id: 'all', name: 'All Mail', q: '' },
  { id: 'spam', name: 'Spam', labelIds: ['SPAM'], spamTrash: true },
  { id: 'trash', name: 'Trash', labelIds: ['TRASH'], spamTrash: true },
];
export const folderById = (id) => FOLDERS.find((f) => f.id === id);
export function folderQuery(folderId, search = '') {
  const f = folderById(folderId) || FOLDERS[0];
  const q = [f.q || '', search || ''].filter(Boolean).join(' ').trim();
  return { labelIds: search && folderId === 'inbox' ? [] : (f.labelIds || []), q, includeSpamTrash: !!f.spamTrash };
}

// ---------- formatting ----------
export function formatListDate(date, now = new Date()) {
  const d = new Date(date);
  if (isNaN(d)) return '';
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now - d < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
}
export function formatSize(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
export function initials(name = '') {
  const p = String(name).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/);
  return ((p[0]?.[0] || '?') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
}

// ---------- on-device task suggestion (no AI, no network) ----------
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
export function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
export function suggestTask({ subject = '', body = '' }, now = new Date()) {
  const text = `${subject}\n${body}`.toLowerCase();
  let due = '';
  const addDays = (n) => { const d = new Date(now); d.setDate(d.getDate() + n); return isoDate(d); };
  if (/\b(today|by eod|end of (the )?day|immediately|asap|urgent)\b/.test(text)) due = addDays(0);
  else if (/\btomorrow\b/.test(text)) due = addDays(1);
  else {
    const wd = text.match(/\b(?:by|before|on|till|until)\s+(?:this\s+|next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (wd) { const t = WEEKDAYS.indexOf(wd[1]); let diff = (t - now.getDay() + 7) % 7; if (diff === 0) diff = 7; due = addDays(diff); }
    const dm = text.match(/\b(?:by|before|on|till|until)\s+(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})\b/);
    if (!due && dm) { const y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]; const d = new Date(y, +dm[2] - 1, +dm[1]); if (!isNaN(d)) due = isoDate(d); }
  }
  const priority = /\b(urgent|asap|immediately|priority|top priority|important)\b/.test(text) ? 'high' : due ? 'medium' : '';
  let title = String(subject || '').replace(/^\s*((re|fw|fwd|aw)\s*:\s*)+/i, '').trim() || 'Follow up';
  const ask = body.match(/\b(?:please|kindly|request you to)\s+([^.?!\n]{6,90})/i);
  if (ask) {
    let a = ask[1].trim().replace(/\s+(by|before|latest by)\s+.*$/i, '');
    a = a.replace(/^(to\s+)/i, '');
    title = a.charAt(0).toUpperCase() + a.slice(1);
  }
  return { title: title.slice(0, 120), due, priority };
}

export function withinQuietHours(quiet, now = new Date()) {
  // quiet: {enabled, start:'22:00', end:'07:00'}
  if (!quiet || !quiet.enabled || !quiet.start || !quiet.end) return false;
  const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const n = now.getHours() * 60 + now.getMinutes();
  const a = toMin(quiet.start); const b = toMin(quiet.end);
  return a <= b ? n >= a && n < b : n >= a || n < b;
}
