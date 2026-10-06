// Email → LifeOS. Three equivalent routes carry the SAME payload (see LIFEOS_INTEGRATION.md):
//   1. Drag an email row and drop it into LifeOS (split screen / pop-up window on the Fold)
//   2. "+ Task" button → small panel → Send to LifeOS (opens LifeOS with the task pre-filled)
//   3. Share → LifeOS (Android share sheet; LifeOS registers as a share target)
import { S, D, esc, icon, openModal, toast, keyOf, emit, account } from './core.js';
import { createTaskPayload, payloadToText, buildLifeOSUrl, suggestTask, PAYLOAD_MIME, isoDate, htmlToText, encodePayload } from './lib.js';
import { addLabelQuiet } from './actions.js';

function defaultsFor(t, bodyText = '') {
  const ls = D().settings.lifeos;
  const sug = D().settings.smartSuggest ? suggestTask({ subject: t.subject, body: bodyText || t.snippet || '' }) : { title: t.subject };
  let due = sug.due || '';
  if (!due && ls.defaultDue === 'today') due = isoDate(new Date());
  if (!due && ls.defaultDue === 'tomorrow') { const d = new Date(); d.setDate(d.getDate() + 1); due = isoDate(d); }
  const acc = account(t.account);
  return {
    title: sug.title || t.subject,
    project: ls.defaultProject || (acc?.profile === 'work' ? (ls.projects[0] || '') : ''),
    due, priority: sug.priority || ls.defaultPriority || '', notes: '', keepEmailLink: true,
  };
}

function emailInfo(t) {
  const msgs = t.messages || [];
  const last = msgs[msgs.length - 1];
  return {
    provider: t.provider || 'gmail', account: t.account, messageId: last?.id || t.messageId, threadId: t.threadId,
    rfcMessageId: last?.rfcMessageId || t.rfcMessageId, subject: t.subject, from: last?.from || t.from,
    date: last?.date || t.date, snippet: t.snippet || last?.snippet || '',
    attachmentNames: msgs.flatMap((m) => (m.attachments || []).filter((a) => !a.inline).map((a) => a.filename)),
  };
}
export function payloadFor(t, taskOverrides) {
  const body = t.messages ? htmlToText(t.messages[t.messages.length - 1].html || t.messages[t.messages.length - 1].text || '') : '';
  return createTaskPayload(emailInfo(t), { ...defaultsFor(t, body), ...(taskOverrides || {}) }, location.origin);
}

// A real web link that carries the whole task. Chrome on Android can only drag *links, images and
// text* to other apps with a finger, so every email row has this link underneath it. Dropping it into
// LifeOS (with lifemail-receiver.js) creates the task; the address also opens LifeOS directly.
export function dragHref(t) {
  const p = payloadFor(t);
  return buildLifeOSUrl(D().settings.lifeos.urlTemplate, p) || `${location.origin}/lifeos-kit/test-receiver.html?lifemail=${encodePayload(p)}`;
}

// ---------- drag ----------
let ghost;
export function startDrag(e, t) {
  const p = payloadFor(t);
  const dt = e.dataTransfer;
  dt.effectAllowed = 'copyLink';
  dt.setData('text/plain', payloadToText(p));
  dt.setData('text/uri-list', p.emailUrl);
  dt.setData('text/html', `<a href="${esc(p.emailUrl)}">${esc(p.task.title)}</a><!-- lifemail-payload -->`);
  try { dt.setData(PAYLOAD_MIME, JSON.stringify(p)); } catch {}
  if (!ghost) { ghost = document.createElement('div'); ghost.className = 'drag-ghost'; document.body.appendChild(ghost); }
  ghost.innerHTML = `${icon('task')}<span>${esc(p.task.title)}</span>`;
  try { dt.setDragImage(ghost, 16, 18); } catch {}
  S.dragging = t;
  document.body.classList.add('is-dragging');
}
export function endDrag() {
  S.dragging = null;
  document.body.classList.remove('is-dragging');
}
// The in-app dock: drop on "+ Task" to open the panel (handy when LifeOS is not on screen).
export function wireDock(dock) {
  dock.querySelectorAll('.dropzone').forEach((z) => {
    z.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; z.classList.add('over'); });
    z.addEventListener('dragleave', () => z.classList.remove('over'));
    z.addEventListener('drop', (e) => {
      e.preventDefault(); z.classList.remove('over');
      const t = S.dragging; endDrag();
      if (!t) return;
      if (z.dataset.act === 'task') openTaskPanel(t);
      if (z.dataset.act === 'share') shareTask(payloadFor(t));
    });
  });
}

// ---------- send / share ----------
export async function shareTask(p) {
  const text = payloadToText(p);
  if (navigator.share) {
    try { await navigator.share({ title: p.task.title, text, url: p.emailUrl }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  await copyText(text);
  toast('Copied — paste it into LifeOS');
  return true;
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
  }
}
function recordLink(t, p) {
  S.store.update((d) => {
    d.taskLinks = d.taskLinks.filter((l) => !(l.account === t.account && l.threadId === t.threadId));
    d.taskLinks.unshift({ id: crypto.randomUUID?.() || String(Date.now()), account: t.account, threadId: t.threadId, title: p.task.title, project: p.task.project, due: p.task.due, createdAt: p.createdAt });
    d.taskLinks = d.taskLinks.slice(0, 2000);
  });
  if (D().settings.lifeos.labelOnTask) addLabelQuiet(t, 'LifeOS');
  emit('list'); emit('reader');
}

// ---------- the "+ Task" panel ----------
export function openTaskPanel(t) {
  const p0 = payloadFor(t);
  const ls = D().settings.lifeos;
  const url = ls.urlTemplate;
  const today = isoDate(new Date());
  const tm = new Date(); tm.setDate(tm.getDate() + 1);
  const nextMon = new Date(); nextMon.setDate(nextMon.getDate() + ((8 - nextMon.getDay()) % 7 || 7));
  const html = `
  <div class="mtitle">${icon('task')}<h3>Create LifeOS task</h3><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></div>
  <div class="mcontent">
    <div class="source-card">${icon('unread')}<div class="s"><div>${esc(p0.subject)}</div><small>${esc(p0.senderName || p0.senderEmail)} · ${esc(p0.account)}</small></div></div>
    <label class="field"><span>Task</span><input id="tk-title" value="${esc(p0.task.title)}" maxlength="200"></label>
    <div class="row2">
      <label class="field"><span>Project</span><input id="tk-project" list="tk-projects" value="${esc(p0.task.project)}" placeholder="None"><datalist id="tk-projects">${ls.projects.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></label>
      <label class="field"><span>Due</span><input id="tk-due" type="date" value="${esc(p0.task.due)}"></label>
    </div>
    <div class="field"><span>Quick due</span><div class="seg" id="tk-quick">
      <button data-d="${today}">Today</button><button data-d="${isoDate(tm)}">Tomorrow</button><button data-d="${isoDate(nextMon)}">Next week</button><button data-d="">None</button></div></div>
    <div class="field"><span>Priority</span><div class="seg" id="tk-pri">
      ${['high', 'medium', 'low', ''].map((x) => `<button data-p="${x}" class="${p0.task.priority === x ? 'on' : ''}">${x ? x[0].toUpperCase() + x.slice(1) : 'None'}</button>`).join('')}</div></div>
    <label class="field"><span>Notes</span><textarea id="tk-notes" rows="2" placeholder="Optional"></textarea></label>
    <label class="check"><input type="checkbox" id="tk-link" checked> Keep a link to the original email</label>
    ${url ? '' : `<div class="note warn">LifeOS address is not set yet, so this will use Share/Copy. Set it once in Settings → LifeOS.</div>`}
  </div>
  <div class="mfoot">
    <button class="btn ghost" id="tk-copy">${icon('file', 'sm')} Copy</button>
    <button class="btn" id="tk-share">${icon('share', 'sm')} Share…</button>
    <span class="grow"></span>
    <button class="btn ghost" data-close>Cancel</button>
    <button class="btn primary" id="tk-send">${icon('task', 'sm')} ${url ? 'Send to LifeOS' : 'Share to LifeOS'}</button>
  </div>`;
  const m = openModal(html);
  const el = m.el;
  let priority = p0.task.priority;
  el.querySelector('#tk-quick').onclick = (e) => { const b = e.target.closest('button'); if (b) el.querySelector('#tk-due').value = b.dataset.d; };
  el.querySelector('#tk-pri').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; priority = b.dataset.p; el.querySelectorAll('#tk-pri button').forEach((x) => x.classList.toggle('on', x === b)); };
  const collect = () => {
    const keep = el.querySelector('#tk-link').checked;
    const p = payloadFor(t, {
      title: el.querySelector('#tk-title').value.trim() || p0.task.title,
      project: el.querySelector('#tk-project').value.trim(), due: el.querySelector('#tk-due').value,
      priority, notes: el.querySelector('#tk-notes').value.trim(), keepEmailLink: keep,
    });
    if (!keep) { p.emailUrl = ''; p.lifemailUrl = ''; }
    return p;
  };
  el.querySelector('#tk-copy').onclick = async () => { const p = collect(); await copyText(payloadToText(p)); recordLink(t, p); m.close(); toast('Task copied — paste it into LifeOS'); };
  el.querySelector('#tk-share').onclick = async () => { const p = collect(); if (await shareTask(p)) { recordLink(t, p); m.close(); } };
  el.querySelector('#tk-send').onclick = async () => {
    const p = collect();
    const target = buildLifeOSUrl(url, p);
    if (!target) { if (await shareTask(p)) { recordLink(t, p); m.close(); } return; }
    recordLink(t, p); m.close();
    const w = window.open(target, 'lifeos');
    if (!w) location.assign(target);
    toast('Sent to LifeOS');
  };
}

export const taskKey = (t) => keyOf(t);
