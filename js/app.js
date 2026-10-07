// LifeMail — main screen: boot, sidebar, email list, drag wiring, keyboard, notifications.
import { CONFIG } from './config.js';
import { S, D, $, esc, icon, provider, accountsInView, keyOf, colorOf, labelName, labelColor, labelIdByName, taskLinkFor, toast, openMenu, on, emit, modalOpen, account } from './core.js';
import { signIn, completeRedirectIfAny, getToken, tokenExpiresIn } from './auth.js';
import { cacheGet, cacheSet } from './store.js';
import { DEMO_ACCOUNTS } from './demo.js';
import { FOLDERS, folderById, formatListDate, initials, parseOpenHash, withinQuietHours } from './lib.js';
import { renderReader, openThread, userLabelIds, currentThreadAction, labelMenu } from './reader.js';
import { archive, trash, toggleStar, setUnread, allUserLabelNames } from './actions.js';
import { startDrag, endDrag, wireDock, openTaskPanel, shareTask, payloadFor, dragHref } from './task.js';
import { openCompose, editDraft } from './compose.js';
import { openSettings, addAccount } from './settings.js';
import { initBackNav, backNavChanged } from './backnav.js';
import { renderWorkPanel, openWorkplace, workIsPortalOnly, workSettings } from './workplace.js';
import { isAndroidApp, onAndroidEvent } from './bridge.js';
import { runRulesOnNew, allRules } from './rules.js';

const app = $('#app');
const FOLDER_ICONS = { inbox: 'inbox', starred: 'star', snoozed: 'clock', drafts: 'file', sent: 'send', archive: 'archive', all: 'all', spam: 'spam', trash: 'trash' };

// ---------------- boot ----------------
async function boot() {
  const wantDemo = localStorage.getItem('lm_demo') === '1' || !CONFIG.googleClientId;
  try {
    const info = await completeRedirectIfAny();
    if (info) { addAccount(info); S.authNeeded.delete(info.email); }
  } catch (e) { setTimeout(() => toast(e.message, { err: true, ms: 7000 }), 300); }

  if (wantDemo) {
    S.demo = true;
    S.store.useDemo(DEMO_ACCOUNTS);
  } else if (!D().accounts.length) {
    return renderWelcome();
  }
  applyTheme();
  const firstProfile = D().focus || (D().accounts.some((a) => a.profile === 'work') && !D().accounts.some((a) => a.profile === 'personal') ? 'work' : 'personal');
  S.view.profile = D().accounts.some((a) => a.profile === firstProfile) ? firstProfile : (D().accounts[0]?.profile || 'personal');
  checkAuth();
  renderShell();
  initBackNav({
    canGoBackView: () => S.view.folder !== 'inbox' || !!S.view.label || !!S.view.search || S.view.account !== 'all',
    goBackView: () => setView({ folder: 'inbox', label: '', search: '', account: 'all' }),
    closeReader: () => emit('close-reader'),
  });
  handleHash();
  await Promise.all([loadLabels(), loadList()]);
  loadUnread();
  if (!S.demo) S.store.pull().then(() => { applyTheme(); renderSide(); });
  startPolling();
}

function checkAuth() {
  if (S.demo) return;
  for (const a of D().accounts) if (!getToken(a.email)) S.authNeeded.add(a.email); else S.authNeeded.delete(a.email);
}

function renderWelcome() {
  app.removeAttribute('aria-busy');
  app.className = 'app';
  app.innerHTML = `<div class="welcome"><div class="wcard">
    <div class="brand" style="padding:0"><span class="mark">${icon('task')}</span>LifeMail</div>
    <h1>Turn email into action.</h1>
    <p>Read Gmail from all your accounts, keep Personal and Work apart, and drag any email straight into LifeOS as a task that links back to the original.</p>
    <div class="flow"><span>Read email</span>→<span>Drag to LifeOS</span>→<span><b>Task with link</b></span></div>
    <div class="wactions">
      <button class="btn primary" id="w-signin">${icon('plus', 'sm')} Sign in with Google</button>
      <button class="btn" id="w-demo">Try it with sample emails</button>
    </div>
    <p class="fine">You sign in on Google's own page — LifeMail never sees your password. LifeMail asks for access to Gmail and to its own hidden folder in Google Drive (where it saves your settings). It cannot see your other Drive files. There is no LifeMail server.</p>
  </div></div>`;
  $('#w-signin').onclick = async () => {
    try { const info = await signIn(); addAccount(info); location.reload(); } catch (e) { toast(e.message, { err: true, ms: 7000 }); }
  };
  $('#w-demo').onclick = () => { localStorage.setItem('lm_demo', '1'); location.reload(); };
}

export function applyTheme() {
  const t = D().settings.theme;
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = t;
  root.dataset.themeResolved = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : t;
  root.dataset.density = D().settings.density;
}

// ---------------- shell ----------------
function renderShell() {
  app.removeAttribute('aria-busy');
  app.innerHTML = `
    <aside class="side" id="side" aria-label="Mailboxes"></aside>
    <section class="listpane" id="listpane" aria-label="Email list"></section>
    <section class="reader" id="reader" aria-label="Email"></section>
    <button class="fab phone-only" id="fab" aria-label="Compose">${icon('compose')} Compose</button>
    <div class="drag-hint">Drop into LifeOS to create a task</div>
    <div class="dropdock" id="dock" aria-hidden="true">
      <div class="dropzone" data-act="task">${icon('task')} + Task</div>
      <div class="dropzone" data-act="share">${icon('share')} Share</div>
    </div>`;
  wireDock($('#dock'));
  $('#fab').onclick = () => openCompose();
  app.addEventListener('click', (e) => { if (app.classList.contains('side-open') && !e.target.closest('.side')) app.classList.remove('side-open'); });
  renderSide(); renderListPane(); renderReader($('#reader'));
}

// ---------------- sidebar ----------------
function renderSide() {
  const side = $('#side'); if (!side) return;
  const d = D(); const v = S.view;
  const portalOnly = workIsPortalOnly();
  const inProfile = d.accounts.filter((a) => a.profile === v.profile);
  const labels = [...new Set([...d.pinnedLabels, ...inProfile.flatMap((a) => (S.labels[a.email] || []).filter((l) => l.type === 'user').map((l) => l.name))])]
    .filter((n) => d.pinnedLabels.includes(n) || inProfile.some((a) => labelIdByName(a.email, n)))
    .filter((n) => !(d.hiddenLabels || []).includes(n));
  const activeRules = allRules().filter((r) => r.enabled).length;
  const prof = (k, ic) => `<button class="prof ${k} ${v.profile === k ? 'on' : ''}" data-profile="${k}" aria-pressed="${v.profile === k}">
      <span class="pi">${icon(ic)}</span><span class="pn">${esc(d.profiles[k].name)}</span>
      ${S.unread[k] ? `<span class="pc">${S.unread[k]}</span>` : ''}${d.focus && d.focus !== k ? `<span class="focus" title="Muted by Focus">${icon('moon', 'sm')}</span>` : ''}</button>`;
  const syncTxt = S.demo ? 'Demo data · not saved to Drive' : { synced: 'Saved to Google Drive', syncing: 'Saving to Drive…', offline: 'Offline · will sync later', error: 'Drive sync problem', auth: 'Reconnect to sync Drive', local: 'Drive sync pending' }[S.store.status] || '';
  side.innerHTML = `
    <div class="brand full-only"><span class="mark">${icon('task')}</span><span class="grow">LifeMail</span>${S.demo ? '<span class="demo-badge" title="Sample emails — nothing is sent">DEMO</span>' : ''}</div>
    <div class="rail-only rail-stack"><button class="rail-btn" data-act="expand" aria-label="Open menu">${icon('menu')}</button></div>
    <div class="profiles full-only">${prof('personal', 'home')}${prof('work', 'work')}</div>
    <div class="rail-only rail-prof">
      <button class="personal ${v.profile === 'personal' ? 'on' : ''}" data-profile="personal" title="${esc(d.profiles.personal.name)}" aria-label="${esc(d.profiles.personal.name)}"><span>${icon('home', 'sm')}</span></button>
      <button class="work ${v.profile === 'work' ? 'on' : ''}" data-profile="work" title="${esc(d.profiles.work.name)}" aria-label="${esc(d.profiles.work.name)}"><span>${icon('work', 'sm')}</span></button>
    </div>
    <div class="side-scroll">
      ${inProfile.length > 1 ? `<div class="full-only">
        <button class="nav acct ${v.account === 'all' ? 'on' : ''}" data-acct="all">${icon('inbox')}<span class="t">All ${esc(d.profiles[v.profile].name)} accounts</span></button>
        ${inProfile.map((a) => `<button class="nav acct ${v.account === a.email ? 'on' : ''}" data-acct="${esc(a.email)}"><span class="acct-dot" style="background:${a.color}"></span><span class="t">${esc(a.displayName || a.email)}</span></button>`).join('')}
      </div>` : ''}
      ${v.profile === 'work' ? `<div class="sec full-only">Government</div>
        <button class="nav ${portalOnly ? 'on' : ''}" data-act="workplace" title="Government Workplace" aria-label="Open Government Workplace">${icon('work')}<span class="t full-only">Government Workplace</span><span class="full-only" style="color:var(--ink-3)">${icon('external', 'sm')}</span></button>
        ${workSettings().shortcuts.map((sc, i) => `<button class="nav full-only" data-act="work-sc" data-i="${i}"><span class="dot" style="background:var(--work)"></span><span class="t">${esc(sc.name)}</span></button>`).join('')}` : ''}
      ${inProfile.length === 0 && !portalOnly ? `<div class="note full-only" style="margin:8px">No accounts in ${esc(d.profiles[v.profile].name)} yet. <a href="#" data-act="settings-acc">Assign or add one</a>.</div>` : ''}
      ${portalOnly ? '' : `<div class="sec full-only">Mailboxes</div>
      ${FOLDERS.map((f) => `<button class="nav ${!v.label && v.folder === f.id && !v.search ? 'on' : ''}" data-folder="${f.id}" title="${f.name}" aria-label="${f.name}">${icon(FOLDER_ICONS[f.id])}<span class="t full-only">${f.name}</span>${f.id === 'inbox' && S.unread[v.profile] ? `<span class="n full-only">${S.unread[v.profile]}</span>` : ''}</button>`).join('')}
      <div class="sec sec-act full-only"><span>Labels</span><button data-act="labels-edit" title="Create, rename, colour or hide labels" aria-label="Edit labels">${icon('edit', 'sm')} Edit</button></div>
      <div class="full-only">${labels.map((n) => `<button class="nav ${v.label === n ? 'on' : ''}" data-label="${esc(n)}"><span class="dot" style="background:${labelColor(n) || 'var(--line-2)'}"></span><span class="t">${esc(n)}</span></button>`).join('') || '<div class="note" style="margin:4px 8px">No labels yet</div>'}
        <button class="nav" data-act="rules" title="Rules that label incoming email automatically">${icon('filter')}<span class="t">Email rules</span><span class="n">${activeRules ? activeRules + ' on' : ''}</span></button></div>`}
    </div>
    <div class="side-foot">
      <button class="nav full-only" data-act="compose">${icon('compose')}<span class="t">Compose</span></button>
      <button class="nav" data-act="settings" title="Settings" aria-label="Settings">${icon('settings')}<span class="t full-only">Settings</span></button>
      <div class="sync full-only ${['error', 'auth'].includes(S.store.status) && !S.demo ? 'err' : ''}" title="${esc(S.store.error || '')}">${icon('cloud')}<span>${esc(syncTxt)}</span></div>
    </div>`;
  side.onclick = (e) => {
    const b = e.target.closest('button, a'); if (!b) return;
    if (b.dataset.act) e.preventDefault();
    if (b.dataset.profile) { switchProfile(b.dataset.profile); return; }
    if (b.dataset.acct) setView({ account: b.dataset.acct });
    else if (b.dataset.folder) setView({ folder: b.dataset.folder, label: '', search: '' });
    else if (b.dataset.label) setView({ label: b.dataset.label, search: '' });
    else if (b.dataset.act === 'expand') { e.stopPropagation(); app.classList.add('side-open'); return; }
    else if (b.dataset.act === 'compose') openCompose();
    else if (b.dataset.act === 'settings') openSettings();
    else if (b.dataset.act === 'settings-acc') openSettings('accounts');
    else if (b.dataset.act === 'labels-edit') openSettings('labels');
    else if (b.dataset.act === 'rules') openSettings('rules');
    else if (b.dataset.act === 'workplace') { openWorkplace(); renderListPane(); }
    else if (b.dataset.act === 'work-sc') { openWorkplace(workSettings().shortcuts[+b.dataset.i]?.url); renderListPane(); }
    app.classList.remove('side-open');
  };
}

function switchProfile(p) {
  if (p === 'work' && !D().accounts.some((a) => a.profile === 'work') && workSettings().autoOpen && S.view.profile !== 'work') openWorkplace();
  if (S.view.profile === p) return;
  S.view = { ...S.view, profile: p, account: 'all', label: '', search: '' };
  S.selected = ''; S.thread = null;
  renderSide(); renderListPane(); renderReader($('#reader'));
  loadLabels().then(renderSide); loadList();
}
function setView(patch) {
  Object.assign(S.view, patch);
  backNavChanged();
  S.selected = ''; S.thread = null;
  app.classList.remove('reading');
  renderSide(); renderListPane(); renderReader($('#reader'));
  loadList();
}

// ---------------- list ----------------
function viewTitle() {
  const v = S.view;
  if (v.search) return `Search <small>“${esc(v.search)}”</small>`;
  const base = v.label ? esc(v.label) : folderById(v.folder).name;
  const where = v.account !== 'all' ? (account(v.account)?.displayName || v.account) : D().profiles[v.profile].name;
  return `${base} <small>${esc(where)}</small>`;
}

function renderListPane() {
  const lp = $('#listpane'); if (!lp) return;
  const portal = workIsPortalOnly();
  app.classList.toggle('work-mode', portal);
  if (portal) { lp.onclick = null; renderWorkPanel(lp, { onSettings: () => openSettings('work'), onMenu: () => app.classList.add('side-open') }); return; }
  const needs = accountsInView().filter((a) => S.authNeeded.has(a.email));
  lp.innerHTML = `
    <div class="lhead">
      <button class="iconbtn phone-only" data-act="menu" aria-label="Menu">${icon('menu')}</button>
      <h1>${viewTitle()}</h1>
      <button class="iconbtn" data-act="refresh" title="Refresh" aria-label="Refresh">${icon('refresh')}</button>
      <button class="iconbtn" data-act="compose" title="Compose (c)" aria-label="Compose">${icon('compose')}</button>
    </div>
    <label class="searchbar">${icon('search', 'sm')}<input id="search" type="search" placeholder="Search mail (from:, subject:, has:attachment…)" value="${esc(S.view.search)}" enterkeyhint="search" aria-label="Search mail">${S.view.search ? `<button class="iconbtn" data-act="clear-search" aria-label="Clear search" style="width:28px;height:28px">${icon('x', 'sm')}</button>` : ''}</label>
    ${needs.map((a) => `<div class="auth-banner"><span>Session ended for <b>${esc(a.email)}</b>.</span><button class="btn sm primary" data-reconnect="${esc(a.email)}">Reconnect</button></div>`).join('')}
    <div class="status-strip" id="lstatus"></div>
    <div class="list" id="list" role="listbox" aria-label="Emails"></div>`;
  lp.onclick = async (e) => {
    const b = e.target.closest('[data-act],[data-reconnect]'); if (!b) return;
    if (b.dataset.reconnect) {
      try { await signIn({ loginHint: b.dataset.reconnect }); S.authNeeded.delete(b.dataset.reconnect); renderListPane(); loadLabels(); loadList(); if (!S.demo) S.store.pull(); }
      catch (err) { toast(err.message, { err: true }); }
      return;
    }
    const a = b.dataset.act;
    if (a === 'menu') { e.stopPropagation(); app.classList.add('side-open'); }
    if (a === 'refresh') loadList();
    if (a === 'compose') openCompose();
    if (a === 'clear-search') setView({ search: '' });
    if (a === 'more') loadList({ more: true });
  };
  $('#search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const q = e.target.value.trim(); setView({ search: q, label: '' }); e.target.blur(); }
    if (e.key === 'Escape') e.target.blur();
  });
  renderList();
}

function rowHtml(t) {
  const key = keyOf(t);
  const chips = userLabelIds(t.labelIds).map((id) => labelName(t.account, id)).filter((n) => n !== 'LifeOS').slice(0, 3);
  const linked = taskLinkFor(t);
  const who = S.view.folder === 'sent' || S.view.folder === 'drafts' ? 'To: ' + (t.to || '').replace(/<[^>]+>/g, '').trim() : (t.senders?.length > 1 ? [...new Set(t.senders.map((s) => s.name.split(' ')[0]).reverse())].slice(0, 3).reverse().join(', ') : t.from.name || t.from.email);
  return `<div class="row ${t.unread ? 'unread' : ''} ${S.selected === key ? 'sel' : ''}" role="option" aria-selected="${S.selected === key}" tabindex="${S.selected === key ? 0 : -1}" data-key="${esc(key)}"
      aria-label="${esc((t.unread ? 'Unread. ' : '') + (t.from.name || '') + '. ' + t.subject)}">
    <a class="row-link" href="${esc(dragHref(t))}" draggable="true" tabindex="-1" aria-hidden="true"></a>
    <span class="acc" style="background:${accountsInView().length > 1 || S.view.account === 'all' ? colorOf(t.account) : 'transparent'}"></span>
    <div style="min-width:0">
      <span class="udot"></span>
      <div class="r1"><span class="who">${esc(who)}${t.count > 1 ? `<span class="cnt">${t.count}</span>` : ''}</span><span class="when">${esc(formatListDate(t.date))}</span></div>
      <div class="subj">${esc(t.subject)}</div>
      <div class="snip">${esc(t.snippet)}</div>
      <div class="r4">${linked ? `<span class="chip task">${icon('check', 'sm')} Task</span>` : ''}${chips.map((n) => { const c = labelColor(n); return `<span class="chip" ${c ? `style="background:${c}22;color:${c}"` : ''}>${esc(n)}</span>`; }).join('')}${t.hasAttachment ? `<span class="attach-ind" title="Has attachment">${icon('clip', 'sm')}</span>` : ''}</div>
    </div>
    <button class="rstar ${t.starred ? 'on' : ''}" data-star aria-label="${t.starred ? 'Unstar' : 'Star'}" tabindex="-1">${icon('star', 'sm')}</button>
  </div>`;
}

function renderList() {
  if (workIsPortalOnly() || app.classList.contains('work-mode')) return renderListPane();
  const list = $('#list'); if (!list) return;
  const st = $('#lstatus');
  if (st) {
    st.className = 'status-strip' + (!S.online ? ' off' : '');
    st.textContent = !S.online ? `Offline${S.fromCache ? ' · showing copy from ' + new Date(S.fromCache).toLocaleString([], { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' }) : ''}` : S.fromCache ? 'Showing saved copy · refreshing…' : '';
  }
  if (S.loading && !S.threads.length) { list.innerHTML = '<div class="skel"></div>'.repeat(7); return; }
  if (!accountsInView().length) {
    list.innerHTML = `<div class="empty">${icon('inbox')}<h3>No accounts here</h3><p>Add an account or assign one to ${esc(D().profiles[S.view.profile].name)} in Settings.</p><button class="btn primary" data-open-settings>Open Settings</button></div>`;
    list.querySelector('[data-open-settings]').onclick = () => openSettings('accounts');
    return;
  }
  if (!S.threads.length) {
    list.innerHTML = `<div class="empty">${icon(S.view.search ? 'search' : 'check')}<h3>${S.view.search ? 'Nothing found' : 'All clear'}</h3><p>${S.view.search ? 'Try different words, or search a different profile.' : 'No email here.'}</p></div>`;
    return;
  }
  const more = Object.values(S.pageTokens).some(Boolean);
  list.innerHTML = S.threads.map(rowHtml).join('') + (more ? `<div class="more-row"><button class="btn" data-act="more">Load more</button></div>` : '<div class="more-row" style="color:var(--ink-3);font-size:12px">End of list</div>');
}

function wireList() {
  const lp = $('#app');
  let pressTimer = null; let dragStarted = false;
  lp.addEventListener('click', (e) => {
    const row = e.target.closest('.row'); if (!row) return;
    if (e.target.closest('.row-link')) e.preventDefault(); // a tap opens the email, not the link
    const t = S.threads.find((x) => keyOf(x) === row.dataset.key); if (!t) return;
    if (e.target.closest('[data-star]')) { e.stopPropagation(); toggleStar(t); return; }
    if (S.view.folder === 'drafts') { editDraft(t); return; }
    openThread(row.dataset.key);
  });
  lp.addEventListener('dragstart', (e) => {
    const row = e.target.closest?.('.row'); if (!row) return;
    const t = S.threads.find((x) => keyOf(x) === row.dataset.key); if (!t) return;
    dragStarted = true; clearTimeout(pressTimer);
    row.classList.add('dragging');
    startDrag(e, t);
  });
  lp.addEventListener('dragend', (e) => { e.target.closest?.('.row')?.classList.remove('dragging'); endDrag(); setTimeout(() => (dragStarted = false), 50); });
  // Long-press without dragging opens a quick-action menu (touch)
  lp.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('.row'); if (!row) return;
    // Finger long-press must reach Chrome untouched — that is what starts a drag on Android.
    if (e.pointerType === 'touch' || (!e.pointerType && matchMedia('(pointer: coarse)').matches)) return;
    e.preventDefault();
    const t = S.threads.find((x) => keyOf(x) === row.dataset.key); if (!t) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => { if (!dragStarted) rowMenu(row, t); }, e.pointerType === 'mouse' || !('ontouchstart' in window) ? 0 : 350);
  });
}

function rowMenu(row, t) {
  openMenu(row.querySelector('.when') || row, [
    { label: 'Add to LifeOS…', icon: 'task', onClick: () => openTaskPanel(t) },
    { label: 'Share to LifeOS / other app', icon: 'share', onClick: () => shareTask(payloadFor(t)) },
    { sep: true },
    { label: t.unread ? 'Mark as read' : 'Mark as unread', icon: 'unread', onClick: () => setUnread(t, !t.unread) },
    { label: t.starred ? 'Unstar' : 'Star', icon: 'star', onClick: () => toggleStar(t) },
    { label: 'Labels…', icon: 'tag', onClick: () => labelMenu(row, t) },
    { label: 'Archive', icon: 'archive', onClick: () => archive(t) },
    { label: 'Delete', icon: 'trash', onClick: () => trash(t) },
  ]);
}

let loadSeq = 0;
async function loadList({ more = false } = {}) {
  const seq = ++loadSeq;
  if (workIsPortalOnly()) { S.threads = []; S.loading = false; renderListPane(); renderSide(); return; }
  const v = { ...S.view };
  const accts = accountsInView().filter((a) => !S.authNeeded.has(a.email));
  const cacheKey = `${v.profile}|${v.account}|${v.folder}|${v.label}`;
  if (!more) {
    if (S.lastKey !== cacheKey + '|' + v.search) { S.threads = []; S.lastKey = cacheKey + '|' + v.search; }
    S.loading = true; S.pageTokens = {}; S.fromCache = 0;
    if (!v.search) {
      const c = await cacheGet(cacheKey);
      if (c && seq === loadSeq && !S.threads.length) { S.threads = c.value; S.fromCache = c.at; }
    }
    if (!S.fromCache) S.threads = [];
    renderList();
  }
  if (!navigator.onLine && !S.demo) { S.loading = false; S.online = false; renderList(); return; }
  try {
    const results = await Promise.all(accts.map(async (a) => {
      if (more && !S.pageTokens[a.email]) return { a, threads: [] };
      try {
        let labelId = '';
        if (v.label) { labelId = labelIdByName(a.email, v.label); if (!labelId) return { a, threads: [], nextPageToken: '' }; }
        const r = await provider(a.email).listThreads({ folderId: v.search ? 'all' : v.folder, search: v.search, labelId, pageToken: more ? S.pageTokens[a.email] : '' });
        return { a, ...r };
      } catch (e) {
        if (e.authNeeded) { S.authNeeded.add(a.email); return { a, threads: [] }; }
        toast(`${a.email}: ${e.message}`, { err: true });
        return { a, threads: [] };
      }
    }));
    if (seq !== loadSeq) return;
    const merged = results.flatMap((r) => r.threads);
    for (const r of results) S.pageTokens[r.a.email] = r.nextPageToken || '';
    const base = more ? S.threads : [];
    const seen = new Set(base.map(keyOf));
    S.threads = [...base, ...merged.filter((t) => !seen.has(keyOf(t)))].sort((x, y) => y.date - x.date);
    S.fromCache = 0; S.online = true;
    if (!more && !v.search) cacheSet(cacheKey, S.threads.slice(0, 60));
  } finally {
    if (seq === loadSeq) { S.loading = false; renderListPane(); renderSide(); }
  }
}

async function loadLabels() {
  const list = D().accounts.filter((a) => a.profile === S.view.profile && !S.authNeeded.has(a.email));
  await Promise.all(list.map(async (a) => { try { S.labels[a.email] = await provider(a.email).listLabels(true); } catch (e) { if (e.authNeeded) S.authNeeded.add(a.email); } }));
  renderSide();
}
async function loadUnread() {
  for (const p of ['personal', 'work']) {
    const accts = D().accounts.filter((a) => a.profile === p && !S.authNeeded.has(a.email));
    const n = await Promise.all(accts.map((a) => provider(a.email).inboxUnread().catch(() => 0)));
    S.unread[p] = n.reduce((s, x) => s + x, 0);
  }
  renderSide();
}

// ---------------- deep link: #open=account/threadId ----------------
function handleHash() {
  if (location.hash === '#compose') { history.replaceState(null, '', '/'); return openCompose(); }
  const o = parseOpenHash(location.hash);
  if (!o) return;
  history.replaceState(null, '', '/');
  const acc = account(o.account);
  if (!acc) return toast('That email belongs to an account not added here: ' + o.account, { err: true });
  if (acc.profile !== S.view.profile) { S.view.profile = acc.profile; renderSide(); }
  openThread(`${o.account}|${o.threadId}`);
}

// ---------------- notifications (polling the cheap Gmail history API) ----------------
let pollTimer = null; const historyIds = {};
async function poll() {
  if (S.demo || !navigator.onLine) return;
  const d = D();
  for (const a of d.accounts) {
    if (S.authNeeded.has(a.email) || !getToken(a.email)) continue;
    try {
      const p = provider(a.email);
      // Email rules first, so new mail is labelled (or archived) before any notification.
      try { await runRulesOnNew(a.email); } catch (e) { if (e.authNeeded) throw e; }
      if (!historyIds[a.email]) { historyIds[a.email] = await p.currentHistoryId(); continue; }
      const r = await p.newInboxMessages(historyIds[a.email]);
      historyIds[a.email] = r.historyId;
      if (!r.messages.length) continue;
      if (a.profile === S.view.profile && S.view.folder === 'inbox' && !S.view.search && !modalOpen()) loadList();
      loadUnread();
      const prof = d.profiles[a.profile];
      const muted = !d.settings.notifications || a.notify === false || prof.notify === 'off' || (d.focus && d.focus !== a.profile) || withinQuietHours(prof.quiet) || document.visibilityState === 'visible';
      if (muted || window.Notification?.permission !== 'granted') continue;
      for (const m of r.messages) {
        if (prof.notify === 'important' && !m.labelIds.includes('IMPORTANT')) continue;
        const reg = await navigator.serviceWorker?.getRegistration();
        const opts = { body: m.subject, tag: m.threadId, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { url: `/#open=${encodeURIComponent(a.email)}/${m.threadId}` } };
        if (reg) reg.showNotification(m.from.name || m.from.email, opts); else new Notification(m.from.name || m.from.email, opts);
      }
    } catch (e) { if (e.authNeeded) { S.authNeeded.add(a.email); renderListPane(); } }
  }
}
function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, Math.max(60, D().settings.pollSeconds) * 1000);
  poll();
}

// ---------------- keyboard ----------------
function moveSel(dir) {
  if (!S.threads.length) return;
  let i = S.threads.findIndex((t) => keyOf(t) === S.selected);
  i = Math.min(S.threads.length - 1, Math.max(0, i + dir));
  openThread(keyOf(S.threads[i]));
  setTimeout(() => $(`.row[data-key="${CSS.escape(keyOf(S.threads[i]))}"]`)?.scrollIntoView({ block: 'nearest' }), 30);
}
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || modalOpen() || document.querySelector('.menu')) return;
  if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
  const k = e.key;
  const map = { e: 'archive', '#': 'trash', Delete: 'trash', s: 'star', u: 'unread', t: 'task', r: 'reply', a: 'replyall', f: 'forward', l: 'label' };
  if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); moveSel(1); }
  else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
  else if (k === 'c') { e.preventDefault(); openCompose(); }
  else if (k === '/') { e.preventDefault(); $('#search')?.focus(); }
  else if (k === 'Escape') { app.classList.remove('reading', 'side-open'); }
  else if (map[k]) { e.preventDefault(); currentThreadAction(map[k]); }
});

// ---------------- events ----------------
on('list', () => { renderList(); });
on('side', () => renderSide());
on('reader', () => renderReader($('#reader')));
on('reading', () => app.classList.add('reading'));
on('close-reader', () => { app.classList.remove('reading'); if (matchMedia('(max-width: 759px)').matches) { S.selected = ''; S.thread = null; renderList(); } else { S.thread = null; S.selected = ''; renderReader($('#reader')); renderList(); } });
on('open', (key) => openThread(key));
on('refresh', () => loadList());
on('reload', () => { checkAuth(); renderSide(); renderListPane(); loadLabels(); loadList(); loadUnread(); });
on('unread-delta', ({ profile, delta }) => { S.unread[profile] = Math.max(0, (S.unread[profile] || 0) + delta); renderSide(); });
on('theme', () => { applyTheme(); renderReader($('#reader')); renderList(); });
on('poll-restart', () => startPolling());
on('rules-applied', async ({ created } = {}) => { if (created) await loadLabels(); if (!modalOpen()) loadList(); loadUnread(); });
S.store.onChange(() => { if ($('#side')) renderSideDebounced(); });
let sideT; function renderSideDebounced() { clearTimeout(sideT); sideT = setTimeout(renderSide, 80); }

addEventListener('online', () => { S.online = true; renderList(); loadList(); if (!S.demo) S.store.push(); });
addEventListener('offline', () => { S.online = false; renderList(); });
addEventListener('hashchange', handleHash);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if ($('#reader')) { applyTheme(); renderReader($('#reader')); } });
// Re-render reader when crossing the phone breakpoint (fold / unfold)
let wasNarrow = matchMedia('(max-width: 759px)').matches;
addEventListener('resize', () => {
  const n = matchMedia('(max-width: 759px)').matches;
  if (n !== wasNarrow) { wasNarrow = n; if ($('#reader')) { renderReader($('#reader')); if (!n) app.classList.remove('reading'); else if (S.thread) app.classList.add('reading'); } }
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && $('#side')) { checkAuth(); poll(); } });

// Google browser sign-ins last 1 hour. On your next tap after that (or shortly before), LifeMail asks
// Google again *silently* (prompt=none) — normally a window flashes for a moment and closes by itself.
// Popups need a tap, which is why this runs on pointerdown. If Google wants you to confirm, the banner stays.
let lastSilent = 0;
addEventListener('pointerdown', (e) => {
  if (S.demo || !CONFIG.googleClientId || !D().accounts.length || Date.now() - lastSilent < 90_000) return;
  if (e.target.closest?.('[data-reconnect], .scrim')) return;
  const due = D().accounts.find((a) => a.profile === S.view.profile && (S.authNeeded.has(a.email) || tokenExpiresIn(a.email) < 5 * 60_000));
  if (!due) return;
  lastSilent = Date.now();
  signIn({ loginHint: due.email, silent: true })
    .then(() => { const was = S.authNeeded.has(due.email); S.authNeeded.delete(due.email); if (was) emit('reload'); })
    .catch(() => {});
}, true);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});

// Android app: leaving the Work browser brings you back to Personal mail.
onAndroidEvent('workClosed', () => { if (workIsPortalOnly() && $('#side')) switchProfile('personal'); });
if (isAndroidApp) document.documentElement.classList.add('in-android-app');

wireList();
boot().catch((e) => { console.error(e); app.innerHTML = `<div class="empty">${icon('alert')}<h3>LifeMail could not start</h3><p>${esc(e.message)}</p></div>`; });
