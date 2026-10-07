// GmailProvider — talks directly to the official Gmail API from the browser.
// Every provider (Gmail now; Outlook/IMAP later) exposes the same methods, so the UI never
// contains Gmail-specific code paths. See ARCHITECTURE.md.
import { getToken, renewSilently } from './auth.js';
import { headerMap, parseAddress, extractParts, folderQuery, encodeB64Url, htmlToText } from './lib.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

// Gmail allows each app a limited number of requests per user per minute. When LifeMail goes over,
// Gmail answers 429 (or 403 "rate limit"). LifeMail then waits and retries instead of failing.
export const QUOTA_MSG = 'Gmail is getting too many requests from LifeMail right now, so it paused us for a minute. LifeMail will slow down and try again automatically.';
export function isQuotaError(status, text = '') { return status === 429 || (status === 403 && /rate ?limit|quota/i.test(text)); }
export const coolDown = {}; // account → time until which background work should wait
export const QUOTA_PAUSE = { ms: 65_000, retry: [2500, 7000] }; // (tests shorten these)

export class AuthNeededError extends Error {
  constructor(account) { super('Session expired for ' + account); this.account = account; this.authNeeded = true; }
}

async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

export class GmailProvider {
  constructor(account) { this.account = account; this.kind = 'gmail'; this.labelCache = null; this.threadCache = new Map(); }

  async req(path, { method = 'GET', body, query, raw = false, retry = 2, renewed = false } = {}) {
    const token = getToken(this.account) || await renewSilently(this.account);
    if (!token) throw new AuthNeededError(this.account);
    const url = new URL(API + path);
    if (query) for (const [k, v] of Object.entries(query)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else if (v !== undefined && v !== '' && v !== null) url.searchParams.set(k, v);
    }
    const r = await fetch(url, {
      method, headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401) {
      // pass expired early (or was withdrawn): get a fresh one silently and try once more
      if (!renewed && await renewSilently(this.account, { force: true })) return this.req(path, { method, body, query, raw, retry, renewed: true });
      throw new AuthNeededError(this.account);
    }
    if (!r.ok) {
      let msg = r.statusText; try { msg = (await r.json()).error.message; } catch {}
      const quota = isQuotaError(r.status, msg);
      if (quota) coolDown[this.account] = Date.now() + QUOTA_PAUSE.ms;
      if ((quota || r.status >= 500) && retry > 0) {
        await new Promise((res) => setTimeout(res, quota ? QUOTA_PAUSE.retry[retry === 2 ? 0 : 1] : (3 - retry) * 900 + 400));
        return this.req(path, { method, body, query, raw, retry: retry - 1 });
      }
      if (quota) throw Object.assign(new Error(QUOTA_MSG), { status: r.status, quota: true });
      throw Object.assign(new Error('Gmail: ' + msg), { status: r.status });
    }
    if (raw || r.status === 204) return r;
    return r.json();
  }

  // ---- labels ----
  async listLabels(force = false) {
    if (this.labelCache && !force) return this.labelCache;
    const j = await this.req('/labels');
    this.labelCache = (j.labels || []).map((l) => ({ id: l.id, name: l.name, type: l.type, color: l.color?.backgroundColor || '' }));
    return this.labelCache;
  }
  async ensureLabel(name) {
    const labels = await this.listLabels();
    const found = labels.find((l) => l.name.toLowerCase() === name.toLowerCase());
    if (found) return found.id;
    const l = await this.req('/labels', { method: 'POST', body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' } });
    this.labelCache.push({ id: l.id, name: l.name, type: 'user', color: '' });
    return l.id;
  }

  async renameLabel(id, name) {
    const l = await this.req('/labels/' + encodeURIComponent(id), { method: 'PATCH', body: { name } });
    const c = this.labelCache?.find((x) => x.id === id); if (c) c.name = l.name;
    return l;
  }
  async deleteLabel(id) {
    await this.req('/labels/' + encodeURIComponent(id), { method: 'DELETE' });
    if (this.labelCache) this.labelCache = this.labelCache.filter((x) => x.id !== id);
  }
  async labelInfo(id) {
    const l = await this.req('/labels/' + encodeURIComponent(id));
    return { messages: l.messagesTotal || 0, threads: l.threadsTotal || 0, unread: l.threadsUnread || 0 };
  }

  async inboxUnread() { const l = await this.req('/labels/INBOX'); return l.threadsUnread || 0; }

  // ---- list ----
  async listThreads({ folderId = 'inbox', search = '', labelId = '', pageToken = '', max = 25 }) {
    const fq = folderQuery(folderId, search);
    const labelIds = labelId ? [labelId] : fq.labelIds;
    const j = await this.req('/threads', { query: { maxResults: max, pageToken, q: fq.q, labelIds, includeSpamTrash: fq.includeSpamTrash ? 'true' : undefined } });
    const ids = (j.threads || []).map((t) => t);
    const threads = await pool(ids, 8, async (t) => {
      const c = this.threadCache.get(t.id);
      if (c && c.historyId === t.historyId) return c.summary; // unchanged since last fetch: no extra API call
      const full = await this.req('/threads/' + t.id, { query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date', 'Message-ID'] } });
      const s = this.summarize(full);
      this.threadCache.set(t.id, { historyId: t.historyId, summary: s });
      return s;
    });
    return { threads: threads.filter(Boolean), nextPageToken: j.nextPageToken || '' };
  }

  summarize(thread) {
    const msgs = thread.messages || [];
    if (!msgs.length) return null;
    const last = msgs[msgs.length - 1];
    const first = headerMap(msgs[0].payload?.headers);
    const lh = headerMap(last.payload?.headers);
    const labelIds = [...new Set(msgs.flatMap((m) => m.labelIds || []))];
    const senders = [...new Map(msgs.map((m) => { const a = parseAddress(headerMap(m.payload?.headers).from); return [a.email, a]; })).values()];
    return {
      id: thread.id, threadId: thread.id, account: this.account, provider: 'gmail',
      messageId: last.id, rfcMessageId: lh['message-id'] || '',
      subject: first.subject || '(no subject)',
      from: parseAddress(lh.from || first.from || ''), senders,
      to: lh.to || '', snippet: decodeEntities(last.snippet || ''),
      date: Number(last.internalDate) || Date.parse(lh.date) || 0,
      unread: msgs.some((m) => (m.labelIds || []).includes('UNREAD')),
      starred: labelIds.includes('STARRED'),
      hasAttachment: msgs.some((m) => /multipart\/mixed/i.test(m.payload?.mimeType || '')),
      labelIds, count: msgs.length,
    };
  }

  // ---- read ----
  async getThread(threadId) {
    const t = await this.req('/threads/' + threadId, { query: { format: 'full' } });
    const summary = this.summarize(t);
    const messages = (t.messages || []).map((m) => {
      const h = headerMap(m.payload?.headers);
      const parts = extractParts(m.payload);
      return {
        id: m.id, threadId, labelIds: m.labelIds || [], snippet: decodeEntities(m.snippet || ''),
        from: parseAddress(h.from || ''), to: h.to || '', cc: h.cc || '', bcc: h.bcc || '', replyTo: h['reply-to'] || '',
        subject: h.subject || '', date: Number(m.internalDate) || Date.parse(h.date) || 0,
        rfcMessageId: h['message-id'] || '', references: h.references || '',
        html: parts.html, text: parts.text, attachments: parts.attachments,
      };
    });
    return { ...summary, messages };
  }

  async getAttachment(messageId, attachmentId) {
    const j = await this.req(`/messages/${messageId}/attachments/${attachmentId}`);
    return j.data; // base64url
  }

  // ---- change ----
  modifyThread(threadId, add = [], remove = []) {
    return this.req(`/threads/${threadId}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
  }
  modifyMessage(messageId, add = [], remove = []) {
    return this.req(`/messages/${messageId}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
  }
  trashThread(threadId) { return this.req(`/threads/${threadId}/trash`, { method: 'POST' }); }
  untrashThread(threadId) { return this.req(`/threads/${threadId}/untrash`, { method: 'POST' }); }

  // ---- send / drafts ----
  send(mime, threadId) {
    return this.req('/messages/send', { method: 'POST', body: { raw: encodeB64Url(mime), ...(threadId ? { threadId } : {}) } });
  }
  async saveDraft(mime, threadId, draftId) {
    const body = { message: { raw: encodeB64Url(mime), ...(threadId ? { threadId } : {}) } };
    if (draftId) return this.req('/drafts/' + draftId, { method: 'PUT', body: { id: draftId, ...body } });
    return this.req('/drafts', { method: 'POST', body });
  }
  deleteDraft(draftId) { return this.req('/drafts/' + draftId, { method: 'DELETE' }); }
  async findDraftId(messageId) {
    let pageToken = '';
    for (let i = 0; i < 5; i++) {
      const j = await this.req('/drafts', { query: { maxResults: 100, pageToken } });
      const d = (j.drafts || []).find((x) => x.message?.id === messageId);
      if (d) return d.id;
      if (!j.nextPageToken) break; pageToken = j.nextPageToken;
    }
    return '';
  }

  // ---- email rules ----
  // Message ids matching a Gmail search, newest first (used for "Run on existing emails").
  async listMessageIds({ q = '', max = 300 } = {}) {
    const ids = []; let pageToken = '';
    while (ids.length < max) {
      const j = await this.req('/messages', { query: { q, maxResults: Math.min(500, max - ids.length), pageToken } });
      ids.push(...(j.messages || []).map((m) => m.id));
      if (!j.nextPageToken) break; pageToken = j.nextPageToken;
    }
    return ids;
  }
  // One email as the rules see it. Only headers unless a rule looks at the email text or attachment names.
  async getRuleMessage(id, full = false) {
    const m = await this.req('/messages/' + id, { query: full ? { format: 'full' } : { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Subject'] } });
    const h = headerMap(m.payload?.headers);
    const from = parseAddress(h.from || '');
    let body = ''; let attachments = [];
    if (full) {
      const parts = extractParts(m.payload);
      body = (parts.text || htmlToText(parts.html || '')).slice(0, 30000);
      attachments = parts.attachments.filter((a) => !a.inline).map((a) => a.filename);
    }
    return {
      id: m.id, threadId: m.threadId, date: Number(m.internalDate) || 0, labelIds: m.labelIds || [],
      from: h.from || '', fromEmail: from.email, fromName: from.name, to: h.to || '', cc: h.cc || '', subject: h.subject || '',
      body, attachments, hasAttachment: full ? attachments.length > 0 : /multipart\/mixed/i.test(m.payload?.mimeType || ''),
      snippet: decodeEntities(m.snippet || ''),
    };
  }
  async batchModify(ids, add = [], remove = []) {
    for (let i = 0; i < ids.length; i += 500) {
      await this.req('/messages/batchModify', { method: 'POST', body: { ids: ids.slice(i, i + 500), addLabelIds: add, removeLabelIds: remove } });
    }
  }
  // Every email that arrived since a point in Gmail's history (any folder). Throws {status:404} when that point is too old.
  async historyAddedIds(startHistoryId) {
    const ids = []; let pageToken = ''; let historyId = startHistoryId;
    for (let i = 0; i < 20; i++) {
      const j = await this.req('/history', { query: { startHistoryId, historyTypes: 'messageAdded', maxResults: 500, pageToken } });
      for (const h of j.history || []) for (const a of h.messagesAdded || []) ids.push({ id: a.message.id, labelIds: a.message.labelIds || [] });
      historyId = j.historyId || historyId;
      if (!j.nextPageToken) break; pageToken = j.nextPageToken;
    }
    return { historyId, messages: ids };
  }

  // ---- offline copy (js/offline.js) ----
  getRawMessage(id, format = 'full') { return this.req('/messages/' + id, { query: { format } }); }
  // Everything that changed since a point in history: new, deleted and re-labelled messages.
  async historyChanges(startHistoryId) {
    const added = new Map(); const deleted = new Set(); const labels = new Map(); let pageToken = ''; let historyId = startHistoryId;
    for (let i = 0; i < 30; i++) {
      const j = await this.req('/history', { query: { startHistoryId, historyTypes: ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'], maxResults: 500, pageToken } });
      for (const h of j.history || []) {
        for (const a of h.messagesAdded || []) { added.set(a.message.id, a.message.labelIds || []); deleted.delete(a.message.id); }
        for (const d of h.messagesDeleted || []) { deleted.add(d.message.id); added.delete(d.message.id); labels.delete(d.message.id); }
        for (const l of [...(h.labelsAdded || []), ...(h.labelsRemoved || [])]) { if (added.has(l.message.id)) added.set(l.message.id, l.message.labelIds || []); else labels.set(l.message.id, l.message.labelIds || []); }
      }
      historyId = j.historyId || historyId;
      if (!j.nextPageToken) break; pageToken = j.nextPageToken;
    }
    return { historyId, added: [...added].map(([id, labelIds]) => ({ id, labelIds })), deleted: [...deleted], labels: [...labels].map(([id, labelIds]) => ({ id, labelIds })) };
  }

  // ---- new-mail polling (cheap: history API) ----
  async currentHistoryId() { return (await this.req('/profile')).historyId; }
  async newInboxMessages(startHistoryId) {
    const j = await this.req('/history', { query: { startHistoryId, historyTypes: 'messageAdded', labelId: 'INBOX' } });
    const ids = (j.history || []).flatMap((h) => (h.messagesAdded || []).map((m) => m.message)).filter((m) => (m.labelIds || []).includes('UNREAD'));
    const metas = await pool(ids.slice(0, 5), 3, (m) => this.req('/messages/' + m.id, { query: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } }));
    return { historyId: j.historyId || startHistoryId, messages: metas.map((m) => { const h = headerMap(m.payload?.headers); return { id: m.id, threadId: m.threadId, from: parseAddress(h.from), subject: h.subject || '', labelIds: m.labelIds || [] }; }) };
  }
}

function decodeEntities(s) {
  return s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
