// Compose / Reply / Reply all / Forward, with attachments, signature and drafts.
import { S, D, esc, icon, openModal, toast, provider, accounts, account, emit, confirmBox } from './core.js';
import { buildMime, splitAddressList, parseAddress, isValidEmail, escapeHtml, formatSize, fromB64Url } from './lib.js';

const MAX_TOTAL = 24 * 1024 * 1024; // Gmail limit is 25 MB per message

function prefix(subject, p) { return new RegExp('^\\s*' + p + ':', 'i').test(subject) ? subject : `${p}: ${subject}`; }
function quoteBlock(m) {
  const when = new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const body = m.html ? window.DOMPurify.sanitize(m.html, { FORBID_TAGS: ['style', 'img', 'script'] }) : escapeHtml(m.text || '').replace(/\n/g, '<br>');
  return `<br><div>On ${esc(when)}, ${esc(m.from.name || m.from.email)} &lt;${esc(m.from.email)}&gt; wrote:</div><blockquote>${body}</blockquote>`;
}
function sigHtml(acct) {
  const s = account(acct)?.signature;
  return s ? `<br><div class="lm-sig">${escapeHtml(s).replace(/\n/g, '<br>')}</div>` : '';
}

export function openCompose({ mode = 'new', thread = null, to = '' } = {}) {
  const all = accounts();
  if (!all.length) return toast('Add an email account first (Settings → Accounts).', { err: true });
  const last = thread?.messages?.[thread.messages.length - 1];
  let from = thread?.account || all.find((a) => a.profile === S.view.profile)?.email || all[0].email;
  if (S.view.account !== 'all' && !thread) from = S.view.account;
  const mine = new Set(all.map((a) => a.email));
  let state = { to, cc: '', bcc: '', subject: '', html: '', threadId: '', inReplyTo: '', references: '', draftId: '', forwardAtts: [] };
  if (last && mode !== 'new') {
    const sender = parseAddress(last.replyTo || '').email && isValidEmail(parseAddress(last.replyTo).email) ? last.replyTo : `${last.from.name} <${last.from.email}>`;
    if (mode === 'reply' || mode === 'replyall') {
      // If I sent the last message, reply to its recipients instead of myself
      state.to = mine.has(last.from.email) ? last.to : sender;
      if (mode === 'replyall') {
        const others = splitAddressList(`${last.to},${last.cc}`).filter((a) => { const e = parseAddress(a).email; return !mine.has(e) && e !== parseAddress(state.to).email; });
        state.cc = others.join(', ');
      }
      state.subject = prefix(thread.subject, 'Re');
      state.threadId = thread.threadId;
      state.inReplyTo = last.rfcMessageId;
      state.references = [last.references, last.rfcMessageId].filter(Boolean).join(' ');
      state.html = `<div><br></div>${sigHtml(from)}${quoteBlock(last)}`;
    } else if (mode === 'forward') {
      state.subject = prefix(thread.subject, 'Fwd');
      state.html = `<div><br></div>${sigHtml(from)}<br><div>---------- Forwarded message ----------<br>From: ${esc(last.from.name)} &lt;${esc(last.from.email)}&gt;<br>Date: ${esc(new Date(last.date).toLocaleString())}<br>Subject: ${esc(thread.subject)}<br>To: ${esc(last.to)}</div><br>${quoteBlock(last).replace(/^<br><div>.*?<\/div>/, '')}`;
      state.forwardAtts = (last.attachments || []).filter((a) => !a.inline).map((a) => ({ ...a, messageId: last.id, account: thread.account, keep: true }));
    } else if (mode === 'draft') {
      state.to = last.to; state.cc = last.cc; state.bcc = last.bcc; state.subject = thread.subject; state.threadId = thread.threadId;
      state.html = last.html || escapeHtml(last.text || '').replace(/\n/g, '<br>'); state.editingDraftMessage = last.id;
    }
  } else {
    state.html = `<div><br></div>${sigHtml(from)}`;
  }
  const files = []; // {file, name, size, type}

  const title = { new: 'New message', reply: 'Reply', replyall: 'Reply all', forward: 'Forward', draft: 'Edit draft' }[mode];
  const m = openModal(`
    <div class="mtitle"><h3>${title}</h3><button class="iconbtn" data-x aria-label="Close">${icon('x')}</button></div>
    <div class="cfield"><label for="c-from">From</label><select id="c-from">${all.map((a) => `<option value="${esc(a.email)}" ${a.email === from ? 'selected' : ''}>${esc(a.displayName || a.name)} &lt;${esc(a.email)}&gt; · ${esc(D().profiles[a.profile]?.name || a.profile)}</option>`).join('')}</select></div>
    <div class="cfield"><label for="c-to">To</label><input id="c-to" type="text" inputmode="email" autocomplete="email" value="${esc(state.to)}"><div class="ccbtns"><button class="btn sm ghost" data-cc>Cc</button><button class="btn sm ghost" data-bcc>Bcc</button></div></div>
    <div class="cfield" id="cc-row" ${state.cc ? '' : 'hidden'}><label for="c-cc">Cc</label><input id="c-cc" value="${esc(state.cc)}"></div>
    <div class="cfield" id="bcc-row" ${state.bcc ? '' : 'hidden'}><label for="c-bcc">Bcc</label><input id="c-bcc" value="${esc(state.bcc)}"></div>
    <div class="cfield"><label for="c-subj">Subject</label><input id="c-subj" value="${esc(state.subject)}"></div>
    <div class="ctool">
      <button class="iconbtn" data-cmd="bold" title="Bold" aria-label="Bold">${icon('bold')}</button>
      <button class="iconbtn" data-cmd="italic" title="Italic" aria-label="Italic">${icon('italic')}</button>
      <button class="iconbtn" data-cmd="underline" title="Underline" aria-label="Underline">${icon('underline')}</button>
      <button class="iconbtn" data-cmd="insertUnorderedList" title="Bulleted list" aria-label="Bulleted list">${icon('list')}</button>
      <button class="iconbtn" data-link title="Insert link" aria-label="Insert link">${icon('link')}</button>
      <span style="width:8px"></span>
      <button class="iconbtn" data-attach title="Attach files" aria-label="Attach files">${icon('clip')}</button>
      <button class="iconbtn" data-photo title="Attach photo" aria-label="Attach photo">${icon('image')}</button>
      <input type="file" id="c-file" multiple hidden><input type="file" id="c-photo" accept="image/*" multiple hidden>
    </div>
    <div class="editor" id="c-body" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Message">${state.html}</div>
    <div class="catts" id="c-atts"></div>
    <div class="mfoot">
      <button class="btn ghost danger" data-discard>${icon('trash', 'sm')} Discard</button>
      <span class="grow"></span>
      <button class="btn" data-draft>Save draft</button>
      <button class="btn primary" data-send>${icon('send', 'sm')} Send</button>
    </div>`, { cls: 'compose full', dismissable: false });
  const el = m.el;
  const q = (s) => el.querySelector(s);
  let dirty = false;
  el.addEventListener('input', () => { dirty = true; });

  const renderAtts = () => {
    const chips = [
      ...state.forwardAtts.filter((a) => a.keep).map((a, i) => `<span class="chip">${icon('clip', 'sm')} ${esc(a.filename)} · ${formatSize(a.size)}<button class="x" data-rmf="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`),
      ...files.map((f, i) => `<span class="chip">${icon('clip', 'sm')} ${esc(f.name)} · ${formatSize(f.size)}<button class="x" data-rm="${i}" aria-label="Remove">${icon('x', 'sm')}</button></span>`),
    ];
    q('#c-atts').innerHTML = chips.join('');
  };
  renderAtts();
  q('#c-atts').onclick = (e) => {
    const r = e.target.closest('[data-rm]'); if (r) { files.splice(+r.dataset.rm, 1); renderAtts(); }
    const rf = e.target.closest('[data-rmf]'); if (rf) { state.forwardAtts.filter((a) => a.keep)[+rf.dataset.rmf].keep = false; renderAtts(); }
  };
  const addFiles = (list) => {
    for (const f of list) {
      const total = files.reduce((s, x) => s + x.size, 0) + f.size;
      if (total > MAX_TOTAL) { toast('Attachments are limited to about 25 MB per email.', { err: true }); break; }
      files.push({ file: f, name: f.name, size: f.size, type: f.type });
    }
    dirty = true; renderAtts();
  };
  q('[data-attach]').onclick = () => q('#c-file').click();
  q('[data-photo]').onclick = () => q('#c-photo').click();
  q('#c-file').onchange = (e) => addFiles(e.target.files);
  q('#c-photo').onchange = (e) => addFiles(e.target.files);
  q('[data-cc]').onclick = () => { q('#cc-row').hidden = false; q('#c-cc').focus(); };
  q('[data-bcc]').onclick = () => { q('#bcc-row').hidden = false; q('#c-bcc').focus(); };
  el.querySelectorAll('[data-cmd]').forEach((b) => (b.onmousedown = (e) => { e.preventDefault(); document.execCommand(b.dataset.cmd); }));
  q('[data-link]').onmousedown = (e) => {
    e.preventDefault();
    const url = prompt('Link address (https://…)');
    if (url && /^(https?:|mailto:)/i.test(url)) document.execCommand('createLink', false, url);
  };
  q('#c-from').onchange = (e) => {
    const body = q('#c-body');
    const old = body.querySelector('.lm-sig');
    const s = account(e.target.value)?.signature;
    if (old) old.innerHTML = s ? escapeHtml(s).replace(/\n/g, '<br>') : '';
  };
  // paste images straight into the message as attachments
  q('#c-body').addEventListener('paste', (e) => {
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (imgs.length) { e.preventDefault(); addFiles(imgs); }
  });

  const readFile = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(f); });

  async function build() {
    const fromEmail = q('#c-from').value;
    const acc = account(fromEmail);
    const toV = q('#c-to').value; const ccV = q('#c-cc').value; const bccV = q('#c-bcc').value;
    const bad = [toV, ccV, bccV].flatMap(splitAddressList).map((a) => parseAddress(a).email).filter((e) => !isValidEmail(e));
    if (bad.length) throw new Error('Please check these addresses: ' + bad.join(', '));
    const atts = [];
    for (const f of files) atts.push({ filename: f.name, mimeType: f.type || 'application/octet-stream', base64: await readFile(f.file) });
    for (const a of state.forwardAtts.filter((x) => x.keep)) {
      const data = a.data || await provider(a.account).getAttachment(a.messageId, a.attachmentId);
      atts.push({ filename: a.filename, mimeType: a.mimeType, base64: fromB64Url(data) });
    }
    const html = window.DOMPurify.sanitize(q('#c-body').innerHTML);
    return {
      fromEmail, threadId: fromEmail === thread?.account ? state.threadId : '',
      mime: buildMime({ from: `${acc?.name || ''} <${fromEmail}>`, to: toV, cc: ccV, bcc: bccV, subject: q('#c-subj').value, html, inReplyTo: state.inReplyTo, references: state.references, attachments: atts }),
      hasRecipient: !!(toV.trim() || ccV.trim() || bccV.trim()),
    };
  }
  const busy = (on) => el.querySelectorAll('.mfoot .btn').forEach((b) => (b.disabled = on));

  q('[data-send]').onclick = async () => {
    try {
      busy(true);
      const b = await build();
      if (!b.hasRecipient) throw new Error('Add at least one recipient.');
      if (!q('#c-subj').value.trim() && !(await confirmBox('Send without a subject?', 'Send'))) { busy(false); return; }
      await provider(b.fromEmail).send(b.mime, b.threadId);
      if (state.draftId) provider(b.fromEmail).deleteDraft(state.draftId).catch(() => {});
      else if (state.editingDraftMessage) { const id = await provider(b.fromEmail).findDraftId(state.editingDraftMessage).catch(() => ''); if (id) provider(b.fromEmail).deleteDraft(id).catch(() => {}); }
      m.close(); toast(S.demo ? 'Sent (demo — nothing actually emailed)' : 'Sent');
      emit('refresh');
    } catch (e) { busy(false); toast(e.authNeeded ? 'Please reconnect ' + e.account + ' and try again.' : e.message, { err: true }); }
  };
  async function saveDraft(silent) {
    const b = await build();
    if (!state.draftId && state.editingDraftMessage) state.draftId = await provider(b.fromEmail).findDraftId(state.editingDraftMessage).catch(() => '');
    const r = await provider(b.fromEmail).saveDraft(b.mime, b.threadId, state.draftId);
    state.draftId = r.id; dirty = false;
    if (!silent) toast('Draft saved');
  }
  q('[data-draft]').onclick = async () => { try { busy(true); await saveDraft(); } catch (e) { toast(e.message, { err: true }); } busy(false); };
  q('[data-discard]').onclick = async () => {
    if (dirty && !(await confirmBox('Discard this message?', 'Discard', true))) return;
    if (state.draftId) provider(q('#c-from').value).deleteDraft(state.draftId).catch(() => {});
    m.close();
  };
  q('[data-x]').onclick = async () => {
    if (!dirty) return m.close();
    try { await saveDraft(true); toast('Saved to Drafts'); } catch { /* keep window open on failure */ return toast('Could not save draft — use Discard to close.', { err: true }); }
    m.close();
  };
  setTimeout(() => {
    const target = state.to ? q('#c-body') : q('#c-to');
    target.focus();
    if (target === q('#c-body')) { const r = document.createRange(); r.setStart(target, 0); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  }, 60);
}

// Used by the list: opening a thread in the Drafts folder edits it.
export async function editDraft(t) {
  try { const full = await provider(t.account).getThread(t.threadId); openCompose({ mode: 'draft', thread: full }); }
  catch (e) { toast(e.message, { err: true }); }
}
