// The reading pane: conversation view, safe HTML rendering, attachments, toolbar.
import { S, D, esc, icon, $, provider, keyOf, emit, toast, openMenu, labelName, labelColor, colorOf, hashColor, taskLinkFor, account, blobFromB64Url } from './core.js';
import { formatListDate, formatSize, initials, gmailWebUrl, escapeHtml } from './lib.js';
import { archive, trash, spam, toggleStar, setUnread, toggleLabel, moveToInbox, allUserLabelNames } from './actions.js';
import { openTaskPanel, shareTask, payloadFor, dragHref } from './task.js';
import { openCompose } from './compose.js';
import { isAndroidApp, androidSaveBlob } from './bridge.js';

const SYSTEM = new Set(['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SENT', 'DRAFT', 'SPAM', 'TRASH', 'CHAT']);
export const userLabelIds = (ids = []) => ids.filter((id) => !SYSTEM.has(id) && !id.startsWith('CATEGORY_'));

const blobUrls = [];
function freeBlobs() { while (blobUrls.length) URL.revokeObjectURL(blobUrls.pop()); }

export async function openThread(key) {
  const [acct, threadId] = key.split('|');
  S.selected = key;
  const summary = S.threads.find((t) => keyOf(t) === key);
  S.thread = summary ? { ...summary, messages: null } : { account: acct, threadId, id: threadId, subject: '', messages: null };
  emit('list'); emit('reader'); emit('reading', true);
  try {
    const full = await provider(acct).getThread(threadId);
    if (S.selected !== key) return;
    S.thread = full;
    // expand the last message plus any unread ones
    S.expanded = new Set(full.messages.filter((m, i) => i === full.messages.length - 1 || (m.labelIds || []).includes('UNREAD')).map((m) => m.id));
    emit('reader');
    if (full.unread || summary?.unread) setUnread(summary || full, false);
  } catch (e) {
    if (S.selected !== key) return;
    S.thread = { ...S.thread, error: e.authNeeded ? 'Please reconnect ' + acct + ' to read this email.' : e.message };
    if (e.authNeeded) { S.authNeeded.add(acct); emit('side'); }
    emit('reader');
  }
}

export function renderReader(root) {
  freeBlobs();
  const t = S.thread;
  const narrow = matchMedia('(max-width: 759px)').matches;
  if (!t) {
    root.innerHTML = `<div class="reader-empty"><div class="big">${icon('task')}</div><b>Turn email into action</b>
      <div>Select an email to read it. Drag it to LifeOS, or press <b>+ Task</b>.</div></div>`;
    return;
  }
  const inTrash = (t.labelIds || []).includes('TRASH') || (t.labelIds || []).includes('SPAM');
  const link = taskLinkFor(t);
  root.innerHTML = `
  <div class="rtool">
    ${narrow ? `<button class="iconbtn" data-a="back" aria-label="Back">${icon('back')}</button>` : ''}
    ${inTrash ? `<button class="iconbtn" data-a="inbox" title="Move to Inbox" aria-label="Move to Inbox">${icon('inbox')}</button>`
      : `<button class="iconbtn" data-a="archive" title="Archive (e)" aria-label="Archive">${icon('archive')}</button>
         <button class="iconbtn" data-a="trash" title="Delete (#)" aria-label="Delete">${icon('trash')}</button>`}
    <button class="iconbtn hide-mid" data-a="unread" title="Mark unread (u)" aria-label="Mark unread">${icon('unread')}</button>
    <button class="iconbtn" data-a="label" title="Labels (l)" aria-label="Labels">${icon('tag')}</button>
    <button class="iconbtn ${t.starred ? 'on' : ''}" data-a="star" title="Star (s)" aria-label="${t.starred ? 'Unstar' : 'Star'}">${icon('star', t.starred ? 'fill' : '')}</button>
    <span class="sep hide-mid"></span>
    <button class="iconbtn hide-mid" data-a="reply" title="Reply (r)" aria-label="Reply">${icon('reply')}</button>
    <button class="iconbtn hide-mid" data-a="replyall" title="Reply all (a)" aria-label="Reply all">${icon('replyall')}</button>
    <button class="iconbtn hide-mid" data-a="forward" title="Forward (f)" aria-label="Forward">${icon('forward')}</button>
    <button class="iconbtn" data-a="more" title="More" aria-label="More actions">${icon('more')}</button>
    <span class="grow"></span>
    <a class="taskbtn" data-a="task" href="${esc(dragHref(t))}" draggable="true" role="button" title="Add to LifeOS (t) — or long-press and drag into LifeOS">${icon('plus')}<span class="lbl">Task</span></a>
  </div>
  <div class="rbody" id="rbody">
    <div class="rsubject"><h2>${esc(t.subject || '')}</h2></div>
    ${chipsHtml(t)}
    ${link ? `<div class="linked">${icon('check', 'sm')}<span>Task in LifeOS: “${esc(link.title)}”${link.due ? ' · due ' + esc(link.due) : ''}</span></div>` : ''}
    ${t.error ? `<div class="note warn">${esc(t.error)}</div>` : ''}
    ${t.messages ? t.messages.map((m, i) => messageHtml(t, m, i)).join('') : '<div class="skel"></div><div class="skel" style="height:200px"></div>'}
    ${t.messages ? `<div class="quick-reply">
      <button class="btn" data-a="reply">${icon('reply', 'sm')} Reply</button>
      <button class="btn" data-a="replyall">${icon('replyall', 'sm')} Reply all</button>
      <button class="btn" data-a="forward">${icon('forward', 'sm')} Forward</button></div>` : ''}
  </div>`;
  root.onclick = (e) => onClick(e, t, root);
  // "+ Task" button is also draggable: drag it straight into LifeOS
  const tb = root.querySelector('.taskbtn');
  tb.addEventListener('dragstart', async (e) => { const { startDrag } = await import('./task.js'); startDrag(e, t); });
  tb.addEventListener('dragend', async () => { const { endDrag } = await import('./task.js'); endDrag(); });
  if (t.messages) t.messages.forEach((m) => { if (S.expanded?.has(m.id)) mountBody(root, t, m); });
}

function chipsHtml(t) {
  const ids = userLabelIds(t.labelIds);
  if (!ids.length) return '';
  return `<div class="rchips">${ids.map((id) => { const n = labelName(t.account, id); const c = labelColor(n); return `<span class="chip" ${c ? `style="background:${c}22;color:${c}"` : ''}>${esc(n)}<button class="x" data-a="unlabel" data-l="${esc(n)}" aria-label="Remove label ${esc(n)}">${icon('x', 'sm')}</button></span>`; }).join('')}</div>`;
}

function messageHtml(t, m, i) {
  const open = S.expanded?.has(m.id);
  const nm = m.from.name || m.from.email;
  const color = hashColor(m.from.email);
  const me = account(m.from.email);
  const atts = (m.attachments || []).filter((a) => !a.inline || !a.contentId);
  return `<div class="msg ${open ? '' : 'collapsed'}" data-m="${esc(m.id)}">
    <div class="mhead" data-a="toggle" data-m="${esc(m.id)}">
      <div class="avatar" style="background:${me ? colorOf(me.email) : color}">${esc(initials(nm))}</div>
      <div class="mmeta">
        <div class="l1"><span class="nm">${esc(nm)}</span><span class="dt">${esc(new Date(m.date).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }))}</span></div>
        <div class="l2">${open ? 'To: ' + esc(m.to || '') + (m.cc ? ' · Cc: ' + esc(m.cc) : '') : esc(m.snippet || '')}</div>
      </div>
    </div>
    ${open ? `<div class="mbody" id="mb-${esc(m.id)}"></div>
      ${atts.length ? `<div class="atts">${atts.map((a, k) => `<div class="att">${icon(a.mimeType.startsWith('image/') ? 'image' : 'clip')}
        <div class="an"><div title="${esc(a.filename)}">${esc(a.filename)}</div><small>${formatSize(a.size)}</small></div>
        <button class="iconbtn" data-a="att-open" data-m="${esc(m.id)}" data-k="${k}" title="Open" aria-label="Open ${esc(a.filename)}">${icon('external', 'sm')}</button>
        <button class="iconbtn" data-a="att-save" data-m="${esc(m.id)}" data-k="${k}" title="Download" aria-label="Download ${esc(a.filename)}">${icon('download', 'sm')}</button>
        ${navigator.canShare || isAndroidApp ? `<button class="iconbtn" data-a="att-share" data-m="${esc(m.id)}" data-k="${k}" title="Share" aria-label="Share ${esc(a.filename)}">${icon('share', 'sm')}</button>` : ''}
      </div>`).join('')}</div>` : ''}` : ''}
  </div>`;
}

// ----- safe email body -----
function allowRemoteImages(fromEmail) {
  const pol = D().settings.remoteImages;
  if (S.loadImages.has(fromEmail)) return true;
  if (pol === 'always') return true;
  if (pol === 'wifi') return navigator.connection ? navigator.connection.type === 'wifi' || navigator.connection.type === 'ethernet' : false;
  return false;
}

async function mountBody(root, t, m) {
  const holder = root.querySelector(`#mb-${CSS.escape(m.id)}`);
  if (!holder) return;
  let html = m.html;
  if (!html) html = `<div style="white-space:pre-wrap;word-break:break-word">${escapeHtml(m.text || '')}</div>`;
  const remoteOk = allowRemoteImages(m.from.email);
  let blocked = 0;
  // DOMPurify removes scripts, event handlers, forms actions, javascript: links, etc.
  const P = window.DOMPurify;
  P.removeAllHooks();
  P.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') { node.setAttribute('target', '_blank'); node.setAttribute('rel', 'noopener noreferrer nofollow'); }
    for (const attr of ['src', 'background', 'poster']) {
      const v = node.getAttribute?.(attr);
      if (v && /^https?:/i.test(v) && !remoteOk) { node.setAttribute('data-blocked-' + attr, v); node.removeAttribute(attr); blocked++; }
    }
  });
  let clean = P.sanitize(html, { FORCE_BODY: true, FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea', 'select', 'meta', 'link', 'base'], ADD_ATTR: ['target'], ALLOW_UNKNOWN_PROTOCOLS: false });
  P.removeAllHooks();
  // inline (cid:) images: fetch from Gmail only when shown
  const cids = (m.attachments || []).filter((a) => a.contentId && /src=["']?cid:/i.test(clean));
  for (const a of cids) {
    if (!clean.includes('cid:' + a.contentId)) continue;
    try {
      const data = a.data || await provider(t.account).getAttachment(m.id, a.attachmentId);
      const url = URL.createObjectURL(await blobFromB64Url(data, a.mimeType)); blobUrls.push(url);
      clean = clean.split('cid:' + a.contentId).join(url);
    } catch {}
  }
  const dark = document.documentElement.dataset.themeResolved === 'dark';
  const isPlain = !m.html;
  const csp = `default-src 'none'; img-src data: blob: ${remoteOk ? 'https: http:' : ''}; style-src 'unsafe-inline' ${remoteOk ? 'https:' : ''}; font-src ${remoteOk ? 'https:' : "'none'"}; media-src 'none'`;
  const baseCss = `html,body{margin:0;padding:0}body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:${isPlain && dark ? '#e7e8e6' : '#1d2124'};word-wrap:break-word;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}a{color:${isPlain && dark ? '#7fc4ab' : '#1f6b55'}}blockquote{margin:6px 0;padding-left:10px;border-left:3px solid #ccc;color:#555}pre{white-space:pre-wrap}`;
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="no-referrer"><base target="_blank"><style>${baseCss}</style></head><body>${clean}</body></html>`;
  holder.innerHTML = `${blocked && !remoteOk ? `<div class="imgbar">${icon('image', 'sm')}<span>Remote images are hidden to protect your privacy.</span><button class="btn sm" data-a="images" data-from="${esc(m.from.email)}">Show images</button></div>` : ''}<div class="mail-paper ${isPlain ? '' : 'html'}"></div>`;
  const frame = document.createElement('iframe');
  frame.className = 'mframe';
  frame.title = 'Email content';
  // No allow-scripts: email code can never run. allow-same-origin only lets LifeMail measure the height.
  frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.srcdoc = doc;
  holder.querySelector('.mail-paper').appendChild(frame);
  const fit = () => { try { const b = frame.contentDocument.documentElement; frame.style.height = Math.max(b.scrollHeight, b.offsetHeight) + 4 + 'px'; } catch {} };
  frame.addEventListener('load', () => {
    fit();
    try { frame.contentDocument.querySelectorAll('img').forEach((img) => img.addEventListener('load', fit)); new ResizeObserver(fit).observe(frame.contentDocument.body); } catch {}
    setTimeout(fit, 400);
  });
}

async function attachment(t, mid, k, mode) {
  const m = t.messages.find((x) => x.id === mid);
  const a = (m.attachments || []).filter((x) => !x.inline || !x.contentId)[+k];
  try {
    toast('Downloading ' + a.filename + '…', { ms: 1500 });
    const data = a.data || await provider(t.account).getAttachment(m.id, a.attachmentId);
    const blob = await blobFromB64Url(data, a.mimeType);
    if (isAndroidApp) { await androidSaveBlob(blob, a.filename, a.mimeType, mode); return; } // saved to the phone's Downloads
    if (mode === 'share') {
      const file = new File([blob], a.filename, { type: a.mimeType });
      if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file], title: a.filename }).catch(() => {});
    }
    const url = URL.createObjectURL(blob);
    if (mode === 'open' && !/html|svg|xml/i.test(a.mimeType)) { const w = window.open(url, '_blank', 'noopener'); if (w) { setTimeout(() => URL.revokeObjectURL(url), 60000); return; } }
    const link = document.createElement('a'); link.href = url; link.download = a.filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) { toast('Could not get attachment: ' + e.message, { err: true }); }
}

export function labelMenu(anchor, t) {
  const names = allUserLabelNames().filter((n) => n !== 'LifeOS' || true);
  const has = new Set(userLabelIds(t.labelIds).map((id) => labelName(t.account, id)));
  openMenu(anchor, [
    { header: 'Labels' },
    ...names.map((n) => ({ label: n, checked: has.has(n), color: labelColor(n) || undefined, onClick: () => toggleLabel(t, n) })),
    { sep: true },
    { input: 'New label…', onEnter: (n) => toggleLabel(t, n) },
  ]);
}

function onClick(e, t, root) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  if (b.tagName === 'A') e.preventDefault();
  const a = b.dataset.a;
  const sum = S.threads.find((x) => keyOf(x) === keyOf(t)) || t;
  switch (a) {
    case 'back': emit('close-reader'); break;
    case 'archive': archive(sum); break;
    case 'trash': trash(sum); break;
    case 'inbox': moveToInbox(sum); break;
    case 'unread': setUnread(sum, true); emit('close-reader'); break;
    case 'star': toggleStar(sum); break;
    case 'label': labelMenu(b, sum); break;
    case 'unlabel': toggleLabel(sum, b.dataset.l); break;
    case 'task': openTaskPanel(t); break;
    case 'reply': case 'replyall': case 'forward': if (t.messages) openCompose({ mode: a, thread: t }); break;
    case 'toggle': {
      const id = b.dataset.m; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id);
      renderReader(root); break;
    }
    case 'images': S.loadImages.add(b.dataset.from); renderReader(root); break;
    case 'att-open': attachment(t, b.dataset.m, b.dataset.k, 'open'); break;
    case 'att-save': attachment(t, b.dataset.m, b.dataset.k, 'save'); break;
    case 'att-share': attachment(t, b.dataset.m, b.dataset.k, 'share'); break;
    case 'more': {
      const narrow = matchMedia('(max-width: 1179px)').matches;
      const p = payloadFor(t);
      openMenu(b, [
        ...(narrow ? [
          { label: 'Reply', icon: 'reply', onClick: () => t.messages && openCompose({ mode: 'reply', thread: t }) },
          { label: 'Reply all', icon: 'replyall', onClick: () => t.messages && openCompose({ mode: 'replyall', thread: t }) },
          { label: 'Forward', icon: 'forward', onClick: () => t.messages && openCompose({ mode: 'forward', thread: t }) },
          { label: 'Mark unread', icon: 'unread', onClick: () => { setUnread(sum, true); emit('close-reader'); } },
          { sep: true }] : []),
        { label: 'Add to LifeOS…', icon: 'task', onClick: () => openTaskPanel(t) },
        { label: 'Share to LifeOS / other app', icon: 'share', onClick: () => shareTask(p) },
        { label: 'Open in Gmail', icon: 'external', onClick: () => window.open(gmailWebUrl({ account: t.account, threadId: t.threadId, rfcMessageId: t.messages?.at(-1)?.rfcMessageId }), '_blank', 'noopener') },
        { label: 'Copy link to this email', icon: 'link', onClick: async () => { await navigator.clipboard?.writeText(p.lifemailUrl); toast('Link copied'); } },
        { sep: true },
        { label: 'Report spam', icon: 'spam', onClick: () => spam(sum) },
        { label: 'Move to Inbox', icon: 'inbox', onClick: () => moveToInbox(sum) },
      ]);
      break;
    }
  }
}

export function currentThreadAction(name) {
  const t = S.thread; if (!t) return;
  const sum = S.threads.find((x) => keyOf(x) === keyOf(t)) || t;
  ({
    archive: () => archive(sum), trash: () => trash(sum), star: () => toggleStar(sum), unread: () => { setUnread(sum, true); emit('close-reader'); },
    task: () => openTaskPanel(t), reply: () => t.messages && openCompose({ mode: 'reply', thread: t }), replyall: () => t.messages && openCompose({ mode: 'replyall', thread: t }),
    forward: () => t.messages && openCompose({ mode: 'forward', thread: t }), label: () => labelMenu($('[data-a=label]'), sum),
  })[name]?.();
}
