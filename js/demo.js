// DemoProvider — same methods as GmailProvider, backed by sample data in memory.
// Used automatically when no Google Client ID is configured, or when "Try demo" is chosen.
import { folderQuery, utf8ToB64, toB64Url } from './lib.js';

export const DEMO_ACCOUNTS = [
  { email: 'suman.personal@example.com', name: 'Suman', displayName: 'Suman · Personal', profile: 'personal', color: '#3a6ea5', signature: '— Suman', notify: true, picture: '' },
  { email: 'suman.work@example.com', name: 'Suman', displayName: 'Suman · Work', profile: 'work', color: '#2f7d6d', signature: 'Regards,\nSuman\nSenior Geologist', notify: true, picture: '' },
];

const H = (h) => Date.now() - h * 3600_000;
const svgImg = toB64Url(utf8ToB64('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160"><rect width="320" height="160" fill="#e8efe9"/><path d="M10 140 L80 70 L130 110 L200 40 L310 140 Z" fill="#7aa58a"/><text x="160" y="30" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#2f4b3a">Field site sketch</text></svg>'));
const csv = toB64Url(utf8ToB64('Lot,Reports,Uploaded,Pending\nLot-14,220,198,22\nLot-15,180,120,60\n'));
const txt = toB64Url(utf8ToB64('NGDR portal API — error log extract\n502 Bad Gateway on /api/v2/reports (3 times, 10:12–10:40)\n'));

function seed() {
  const W = DEMO_ACCOUNTS[1].email; const P = DEMO_ACCOUNTS[0].email;
  const T = [
    { account: W, id: 'd1', labels: ['INBOX', 'UNREAD', 'IMPORTANT', 'NGDR'], subject: 'NGDR Portal API issue — reports endpoint failing', msgs: [
      { from: 'Rakesh Patel <rakesh.patel@bisag-n.example>', to: W, h: 2.2, html: '<p>Dear Sir,</p><p>We have observed intermittent <b>502 errors</b> on the reports API of the NGDR portal since this morning. Our team is investigating the load balancer configuration.</p><p>Kindly share the list of report IDs that failed to upload in Lot-15 <b>by Friday</b>, so we can re-run the ingestion.</p><p>Regards,<br>Rakesh Patel<br>BISAG-N</p>', att: [{ filename: 'api-error-log.txt', mimeType: 'text/plain', data: txt }] },
    ] },
    { account: W, id: 'd2', labels: ['INBOX', 'UNREAD', 'NGDR', 'Follow Up'], subject: 'Meeting regarding NGDR data upload status', msgs: [
      { from: 'Director (NGDR) <director.ngdr@gsi.example>', to: W, h: 5, html: '<p>All concerned,</p><p>A review meeting on the NGDR report upload status is scheduled for <b>Thursday, 11:00 AM</b> in Conference Room 2.</p><p>Please bring the lot-wise upload summary.</p>' },
    ] },
    { account: W, id: 'd3', labels: ['INBOX', 'GSI'], subject: 'Please review attached report — Lot-15 summary', msgs: [
      { from: 'Ananya Roy <ananya.roy@gsi.example>', to: W, h: 26, html: '<p>Sir,</p><p>Please review the attached Lot-15 summary and the field sketch. Let me know if the numbers look right before I forward it to BISAG-N.</p><p><img src="cid:sketch1" alt="sketch"></p><p>Thanks,<br>Ananya</p>', att: [{ filename: 'Lot-15-summary.csv', mimeType: 'text/csv', data: csv }, { filename: 'field-sketch.svg', mimeType: 'image/svg+xml', data: svgImg, contentId: 'sketch1', inline: true }] },
      { from: 'Suman <' + W + '>', to: 'ananya.roy@gsi.example', h: 24, html: '<p>Thanks Ananya. Lot-15 pending count looks high — please recheck the 60 pending reports.</p>' },
      { from: 'Ananya Roy <ananya.roy@gsi.example>', to: W, h: 20, html: '<p>Rechecked. 60 is correct — 38 are awaiting metadata from the circle offices.</p>' },
    ] },
    { account: W, id: 'd4', labels: ['INBOX', 'Awaiting'], subject: 'AWS monthly estimate — clarification sought', msgs: [
      { from: 'Cloud Team <cloud@bisag-n.example>', to: W, h: 50, html: '<p>We will share the revised monthly estimate after the storage tiering review. Expected next week.</p>' },
    ] },
    { account: P, id: 'd5', labels: ['INBOX', 'UNREAD', 'Travel'], subject: 'Travel confirmation — Kolkata to Gangtok', msgs: [
      { from: 'Travel Desk <bookings@travel.example>', to: P, h: 3, html: '<p>Your booking is confirmed.</p><table style="border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0">Departure</td><td><b>14 Nov, 06:40</b></td></tr><tr><td style="padding:4px 12px 4px 0">PNR</td><td><b>X7K2QP</b></td></tr></table><p>Please complete web check-in <b>by tomorrow</b>.</p><p><img src="https://example.com/track.png" width="1" height="1"></p>' },
    ] },
    { account: P, id: 'd6', labels: ['INBOX'], subject: 'Family event on Sunday', msgs: [
      { from: 'Mitali <mitali@example.com>', to: P, h: 30, html: '<p>Hi! Lunch at home this Sunday, 1 PM. Please bring the photos from the last trip 📷</p>' },
    ] },
    { account: P, id: 'd7', labels: ['INBOX', 'Finance'], subject: 'Your bank statement for September', msgs: [
      { from: 'Bank Statements <statements@bank.example>', to: P, h: 75, html: '<p>Your account statement for September is now available in net banking.</p>' },
    ] },
    { account: P, id: 'd8', labels: ['SENT'], subject: 'Lens rental query', msgs: [
      { from: 'Suman <' + P + '>', to: 'rentals@camera.example', h: 90, html: '<p>Is the 100-400mm available for the weekend of 14 Nov?</p>' },
    ] },
    { account: W, id: 'd9', labels: ['DRAFT'], subject: 'Draft: Lot-16 upload plan', msgs: [
      { from: 'Suman <' + W + '>', to: 'rakesh.patel@bisag-n.example', h: 1, html: '<p>Dear Rakesh ji,</p><p>Lot-16 will contain 210 reports…</p>' },
    ] },
  ];
  return T.map((t) => ({
    ...t,
    messages: t.msgs.map((m, i) => ({ id: `${t.id}m${i}`, from: m.from, to: m.to, date: H(m.h), html: m.html, att: m.att || [], rfc: `<${t.id}m${i}@demo.lifemail>` })),
  }));
}

const store = { threads: null, customLabels: {} };

import { parseAddress, htmlToText } from './lib.js';

export class DemoProvider {
  constructor(account) {
    this.account = account; this.kind = 'gmail'; this.demo = true;
    if (!store.threads) store.threads = seed();
    if (!store.customLabels[account]) store.customLabels[account] = ['Follow Up', 'Awaiting', 'Delegated', 'NGDR', 'GSI', 'Travel', 'Finance'];
  }
  mine() { return store.threads.filter((t) => t.account === this.account); }
  async listLabels() {
    const sys = ['INBOX', 'STARRED', 'UNREAD', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].map((id) => ({ id, name: id, type: 'system' }));
    return [...sys, ...store.customLabels[this.account].map((n) => ({ id: n, name: n, type: 'user' }))];
  }
  async ensureLabel(name) { if (!store.customLabels[this.account].includes(name)) store.customLabels[this.account].push(name); return name; }
  async renameLabel(id, name) {
    const L = store.customLabels[this.account]; const i = L.indexOf(id); if (i < 0) throw new Error('Label not found');
    L[i] = name; for (const t of this.mine()) t.labels = t.labels.map((l) => (l === id ? name : l));
    return { id: name, name };
  }
  async deleteLabel(id) {
    store.customLabels[this.account] = store.customLabels[this.account].filter((l) => l !== id);
    for (const t of this.mine()) t.labels = t.labels.filter((l) => l !== id);
  }
  async labelInfo(id) {
    const ts = this.mine().filter((t) => t.labels.includes(id));
    return { messages: ts.reduce((n, t) => n + t.messages.length, 0), threads: ts.length, unread: ts.filter((t) => t.labels.includes('UNREAD')).length };
  }
  // ---- email rules (demo labels are per conversation) ----
  async listMessageIds({ q = '' } = {}) {
    const days = +(q.match(/newer_than:(\d+)d/) || [])[1] || 3650;
    return this.mine().filter((t) => !['SENT', 'DRAFT', 'TRASH', 'SPAM'].some((l) => t.labels.includes(l)))
      .flatMap((t) => t.messages.filter((m) => !m.from.includes(this.account) && m.date > Date.now() - days * 86400_000).map((m) => m.id));
  }
  async getRuleMessage(id) {
    const t = this.mine().find((x) => x.messages.some((m) => m.id === id)); if (!t) throw new Error('Not found');
    const m = t.messages.find((x) => x.id === id); const a = parseAddress(m.from);
    const atts = m.att.filter((x) => !x.inline).map((x) => x.filename);
    return { id, threadId: t.id, date: m.date, labelIds: [...t.labels], from: m.from, fromEmail: a.email, fromName: a.name, to: m.to, cc: m.cc || '', subject: t.subject, body: htmlToText(m.html), attachments: atts, hasAttachment: atts.length > 0, snippet: htmlToText(m.html).slice(0, 120) };
  }
  async batchModify(ids, add = [], remove = []) { for (const id of ids) await this.modifyMessage(id, add, remove); }
  async historyAddedIds(h) { return { historyId: h, messages: [] }; }

  async inboxUnread() { return this.mine().filter((t) => t.labels.includes('INBOX') && t.labels.includes('UNREAD') && !t.labels.includes('TRASH')).length; }
  summarize(t) {
    const last = t.messages[t.messages.length - 1];
    return {
      id: t.id, threadId: t.id, account: this.account, provider: 'gmail', messageId: last.id, rfcMessageId: last.rfc,
      subject: t.subject, from: parseAddress(last.from), senders: t.messages.map((m) => parseAddress(m.from)), to: last.to,
      snippet: htmlToText(last.html).replace(/\s+/g, ' ').slice(0, 140), date: last.date,
      unread: t.labels.includes('UNREAD'), starred: t.labels.includes('STARRED'),
      hasAttachment: t.messages.some((m) => m.att.some((a) => !a.inline)), labelIds: [...t.labels], count: t.messages.length,
    };
  }
  async listThreads({ folderId = 'inbox', search = '', labelId = '' }) {
    await new Promise((r) => setTimeout(r, 120));
    const fq = folderQuery(folderId, '');
    let list = this.mine();
    if (labelId) list = list.filter((t) => t.labels.includes(labelId));
    else if (folderId === 'archive') list = list.filter((t) => !['INBOX', 'SENT', 'DRAFT', 'SPAM', 'TRASH'].some((l) => t.labels.includes(l)));
    else if (folderId === 'all') list = list.filter((t) => !t.labels.includes('SPAM') && !t.labels.includes('TRASH'));
    else if (folderId === 'snoozed') list = [];
    else if (!search) list = list.filter((t) => fq.labelIds.every((l) => t.labels.includes(l)));
    if (!['trash', 'spam'].includes(folderId)) list = list.filter((t) => !t.labels.includes('TRASH') && !t.labels.includes('SPAM'));
    if (search) {
      const s = search.toLowerCase().replace(/\b(from|subject|label):/g, '');
      list = list.filter((t) => (t.subject + ' ' + t.messages.map((m) => m.from + ' ' + m.html).join(' ') + ' ' + t.labels.join(' ')).toLowerCase().includes(s.trim()));
    }
    return { threads: list.map((t) => this.summarize(t)).sort((a, b) => b.date - a.date), nextPageToken: '' };
  }
  async getThread(id) {
    const t = this.mine().find((x) => x.id === id);
    if (!t) throw new Error('Not found');
    return { ...this.summarize(t), messages: t.messages.map((m) => ({
      id: m.id, threadId: id, labelIds: t.labels, from: parseAddress(m.from), to: m.to, cc: '', bcc: '', replyTo: '', subject: t.subject, date: m.date,
      rfcMessageId: m.rfc, references: '', html: m.html, text: '', snippet: htmlToText(m.html).replace(/\s+/g, ' ').slice(0, 140),
      attachments: m.att.map((a, i) => ({ filename: a.filename, mimeType: a.mimeType, size: Math.round(a.data.length * 0.75), attachmentId: `${m.id}a${i}`, contentId: a.contentId || '', inline: !!a.inline })),
    })) };
  }
  async getAttachment(messageId, attachmentId) {
    for (const t of this.mine()) for (const m of t.messages) if (m.id === messageId) { const i = +attachmentId.split('a').pop(); return m.att[i].data; }
    throw new Error('Attachment not found');
  }
  async modifyThread(id, add = [], remove = []) {
    const t = this.mine().find((x) => x.id === id); if (!t) return;
    t.labels = [...new Set([...t.labels.filter((l) => !remove.includes(l)), ...add])];
  }
  modifyMessage(messageId, add, remove) { const t = this.mine().find((x) => x.messages.some((m) => m.id === messageId)); return t && this.modifyThread(t.id, add, remove); }
  async trashThread(id) { return this.modifyThread(id, ['TRASH'], ['INBOX']); }
  async untrashThread(id) { return this.modifyThread(id, ['INBOX'], ['TRASH']); }
  async send(mime, threadId) {
    const subj = (mime.match(/^Subject: (.*)$/m) || [])[1] || '(no subject)';
    const to = (mime.match(/^To: (.*)$/m) || [])[1] || '';
    const msg = { id: 'sent' + Date.now(), from: 'Suman <' + this.account + '>', to, date: Date.now(), html: '<p><i>(Sent from LifeMail demo — nothing was actually emailed.)</i></p>', att: [], rfc: '<' + Date.now() + '@demo>' };
    const t = threadId && this.mine().find((x) => x.id === threadId);
    if (t) { t.messages.push(msg); t.labels = [...new Set([...t.labels, 'SENT'])]; }
    else store.threads.push({ account: this.account, id: 'n' + Date.now(), labels: ['SENT'], subject: subj, messages: [msg] });
    return { id: msg.id };
  }
  async saveDraft(mime, threadId, draftId) { return { id: draftId || 'draft' + Date.now() }; }
  async deleteDraft() {}
  async findDraftId() { return 'demo-draft'; }
  async currentHistoryId() { return '1'; }
  async newInboxMessages(h) { return { historyId: h, messages: [] }; }
}

// Test hook: lets the automated security test add a hostile email to the demo mailbox.
export function __demoInject(thread) { if (!store.threads) store.threads = seed(); store.threads.push(thread); }
