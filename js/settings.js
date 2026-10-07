// Settings screen. Every change is saved to the device immediately and to Google Drive a moment later.
import { S, D, esc, icon, openModal, toast, emit, confirmBox, dropProvider, colorOf } from './core.js';
import { signIn, forgetToken, getToken } from './auth.js';
import { cacheClear } from './store.js';
import { isAndroidApp, androidSaveBlob } from './bridge.js';
import { workSettings, isAllowedWorkUrl, openWorkplace, WORK_DEFAULTS } from './workplace.js';
import { mountLabels, mountRules } from './rules-ui.js';
import * as OFF from './offline.js';
import { encodePayload, createTaskPayload, buildLifeOSUrl, isAllowedLifeOSUrl } from './lib.js';

const COLORS = ['#3a6ea5', '#2f7d6d', '#b4583a', '#7a6ab8', '#a0782b', '#b05c9a', '#4f8a3c', '#c2453d', '#5f6f7a', '#d9822b'];
const TABS = [
  ['accounts', 'Accounts'], ['work', 'Work (Government)'], ['profiles', 'Profiles & Focus'], ['lifeos', 'LifeOS'], ['labels', 'Labels'], ['rules', 'Email rules'],
  ['offline', 'Offline & search'], ['notify', 'Notifications'], ['appearance', 'Appearance'], ['privacy', 'Privacy & Security'], ['data', 'Data & Sync'], ['about', 'About'],
];

export function openSettings(tab = 'accounts') {
  const m = openModal(`<div class="mtitle">${icon('settings')}<h3>Settings</h3><button class="iconbtn" data-close aria-label="Close">${icon('x')}</button></div>
    <div class="settings"><nav class="stabs">${TABS.map(([k, n]) => `<button class="nav" data-tab="${k}"><span class="t">${n}</span></button>`).join('')}</nav><div class="spanel" id="spanel"></div></div>`,
  { cls: 'wide', onClose: () => { emit('side'); emit('list'); emit('reader'); } });
  const el = m.el;
  const show = (k) => {
    tab = k;
    el.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === k));
    const panel = el.querySelector('#spanel');
    panel.innerHTML = PANELS[k]();
    panel.onclick = panel.onchange = panel.oninput = panel.onkeydown = null;
    WIRE[k]?.(panel, () => show(k), m);
  };
  el.querySelector('.stabs').onclick = (e) => { const b = e.target.closest('[data-tab]'); if (b) show(b.dataset.tab); };
  show(tab);
  return m;
}

const set = (fn) => S.store.update(fn);
const seg = (name, value, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${v === value ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
function wireSeg(panel, name, fn) {
  const s = panel.querySelector(`[data-seg="${name}"]`); if (!s) return;
  s.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); fn(b.dataset.v); };
}

const PANELS = {
  accounts: () => `
    <h4>Email accounts</h4>
    ${D().accounts.map((a, i) => `<div class="acct-card">
      <div class="avatar" style="background:${a.color}">${a.picture ? `<img src="${esc(a.picture)}" alt="" style="width:36px;height:36px;border-radius:50%" referrerpolicy="no-referrer">` : esc((a.name || a.email)[0].toUpperCase())}</div>
      <div class="meta"><b>${esc(a.displayName || a.name)}</b><small>${esc(a.email)} · Gmail · ${S.demo ? 'demo' : getToken(a.email) ? 'connected' : 'needs reconnect'}</small></div>
      <div>${S.demo ? '' : `<button class="btn sm" data-reconnect="${i}">Reconnect</button>`} <button class="btn sm ghost danger" data-remove="${i}">Remove</button></div>
      <div class="acct-edit">
        <div class="row2">
          <label class="field"><span>Name shown in LifeMail</span><input data-f="displayName" data-i="${i}" value="${esc(a.displayName || '')}" placeholder="${esc(a.name)}"></label>
          <label class="field"><span>Profile</span><select data-f="profile" data-i="${i}">${Object.entries(D().profiles).map(([k, p]) => `<option value="${k}" ${a.profile === k ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        </div>
        <div class="field"><span>Colour</span><div class="colors" data-colors="${i}">${COLORS.map((c) => `<button style="background:${c}" data-c="${c}" class="${a.color === c ? 'on' : ''}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
        <label class="field"><span>Signature</span><textarea data-f="signature" data-i="${i}" rows="3">${esc(a.signature || '')}</textarea></label>
        <label class="check"><input type="checkbox" data-f="notify" data-i="${i}" ${a.notify !== false ? 'checked' : ''}> Notify me about new email in this account</label>
      </div></div>`).join('')}
    ${S.demo ? `<div class="note">You are in demo mode. To use your real Gmail, set the Google Client ID (see SETUP.md) and choose “Leave demo” in Data & Sync.</div>`
      : `<button class="btn primary" data-add>${icon('plus', 'sm')} Add Google / Gmail account</button>
      <div class="note">Gmail and Google Workspace accounts sign in on Google's own page — LifeMail never sees your password. Outlook and other providers are planned (the app is built for them), but not active yet.</div>`}`,

  work: () => {
    const w = workSettings();
    return `
    <h4>Government Workplace</h4>
    <label class="field"><span>Workplace address</span><input id="wk-url" value="${esc(w.portalUrl)}" inputmode="url"></label>
    <div class="field"><span>Sign-in page (used by the Government site)</span><div class="note" style="margin:0">${esc(w.authUrl)}</div></div>
    <label class="check"><input type="checkbox" id="wk-auto" ${w.autoOpen ? 'checked' : ''}> <span>Open Workplace automatically when I tap <b>Work</b></span></label>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 4px"><button class="btn primary" id="wk-open">${icon('external', 'sm')} Open Workplace</button></div>
    <h4>Shortcuts</h4>
    <div class="note">Open a page in Workplace (for example Mail or ToDo), copy its address from the ⋮ menu → Share/Copy link, and add it here. It will appear under Work in the sidebar.</div>
    ${w.shortcuts.map((sc, i) => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)"><b style="flex:none">${esc(sc.name)}</b><span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--ink-3);font-size:12.5px">${esc(sc.url)}</span><button class="btn sm ghost danger" data-wk-rm="${i}">Remove</button></div>`).join('')}
    <div class="row2" style="margin-top:10px"><input class="inp" id="wk-sc-name" placeholder="Name, e.g. Mail"><input class="inp" id="wk-sc-url" placeholder="https://workplace.mgovcloud.in/…" inputmode="url"></div>
    <button class="btn" id="wk-sc-add" style="margin-top:8px">${icon('plus', 'sm')} Add shortcut</button>
    <h4>How Work is kept separate and safe</h4>
    <ul class="note" style="padding-left:28px;line-height:1.7">
      <li>Workplace opens as the real Government website. You sign in there; LifeMail never sees or stores your Government password, OTP or authenticator code.</li>
      <li>The Government site refuses to be shown inside other apps and blocks sign-in inside frames, so LifeMail does not embed it and does not route it through any server. On the installed app it opens on top of LifeMail; press Back to return.</li>
      <li>Government mail is not copied into LifeMail, Google Drive or anywhere else. Its session is stored by the browser under the Government's own address, separate from LifeMail's Personal data.</li>
      <li><b>Signing out / clearing the Work session:</b> use Sign out from your profile menu inside Workplace. On a shared device you can also remove mgovcloud.in under Chrome → Settings → Site settings → All sites.</li>
    </ul>`;
  },

  profiles: () => `
    <h4>Focus</h4>
    <p class="note">Focus mutes notifications from the other profile. Your accounts and email are not changed.</p>
    ${seg('focus', D().focus, [['', 'Off'], ['work', 'Work focus'], ['personal', 'Personal focus']])}
    ${Object.entries(D().profiles).map(([k, p]) => `
      <h4>${esc(p.name)} profile</h4>
      <label class="field"><span>Name</span><input data-pn="${k}" value="${esc(p.name)}"></label>
      <div class="field"><span>Notify for</span>${seg('pn-' + k, p.notify, [['all', 'All new email'], ['important', 'Important only'], ['off', 'Off']])}</div>
      <label class="check"><input type="checkbox" data-q="${k}" ${p.quiet.enabled ? 'checked' : ''}> Quiet hours</label>
      <div class="row2"><label class="field"><span>From</span><input type="time" data-qs="${k}" value="${esc(p.quiet.start)}"></label><label class="field"><span>Until</span><input type="time" data-qe="${k}" value="${esc(p.quiet.end)}"></label></div>
      <div class="note">${D().accounts.filter((a) => a.profile === k).map((a) => esc(a.email)).join(', ') || 'No accounts in this profile yet — assign them under Accounts.'}</div>`).join('')}`,

  lifeos: () => {
    const l = D().settings.lifeos;
    return `
    <h4>Connect to LifeOS</h4>
    <label class="field"><span>LifeOS address <span class="hint">— the web address of your LifeOS app, with {payload} where the task goes</span></span>
      <input id="lo-url" placeholder="https://your-lifeos.vercel.app/?lifemail={payload}" value="${esc(l.urlTemplate)}" inputmode="url"></label>
    <div class="note">Use the https:// address of LifeOS. LifeOS needs the small receiver script in <b>lifeos-kit/</b> (see LIFEOS_INTEGRATION.md). Until then, use Share or Copy.</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:8px 0 4px"><button class="btn sm" id="lo-test">Send a test task</button><a class="btn sm ghost" href="/lifeos-kit/test-receiver.html" target="_blank" rel="noopener">Open drop test page</a></div>
    <h4>Defaults for new tasks</h4>
    <label class="field"><span>Projects <span class="hint">— comma separated, shown as suggestions</span></span><input id="lo-projects" value="${esc(l.projects.join(', '))}"></label>
    <div class="row2">
      <label class="field"><span>Default project</span><input id="lo-dproj" list="lo-pl" value="${esc(l.defaultProject)}" placeholder="None"><datalist id="lo-pl">${l.projects.map((p) => `<option value="${esc(p)}">`).join('')}</datalist></label>
      <label class="field"><span>Default due date</span><select id="lo-due"><option value="none">No date</option><option value="today" ${l.defaultDue === 'today' ? 'selected' : ''}>Today</option><option value="tomorrow" ${l.defaultDue === 'tomorrow' ? 'selected' : ''}>Tomorrow</option></select></label>
    </div>
    <div class="field"><span>Default priority</span>${seg('lo-pri', l.defaultPriority, [['high', 'High'], ['medium', 'Medium'], ['low', 'Low'], ['', 'None']])}</div>
    <label class="check"><input type="checkbox" id="lo-label" ${l.labelOnTask ? 'checked' : ''}> Add the Gmail label “LifeOS” to emails I turn into tasks</label>
    <label class="check"><input type="checkbox" id="lo-smart" ${D().settings.smartSuggest ? 'checked' : ''}> <span>Suggest task title, due date and priority from the email text <span class="hint" style="color:var(--ink-3)">— worked out on this device; no AI service, nothing sent anywhere</span></span></label>`;
  },

  labels: () => '',
  rules: () => '',

  offline: () => {
    const o = OFF.offlineSettings();
    return `<h4>Email on this device</h4>
    <div class="note">LifeMail keeps a copy of your recent Gmail <b>on this ${isAndroidApp ? 'phone' : 'device'}</b> — like the Gmail, Outlook and Apple Mail apps — so you can <b>read and search without internet</b>, and search gives results as you type. The copy is not put in Google Drive (Drive also needs internet); Drive keeps only your settings and rules. Government Workplace mail is never copied.</div>
    ${S.demo ? '<div class="note warn">Demo mode: offline copies are made only for real Gmail accounts.</div>' : ''}
    <label class="check"><input type="checkbox" id="off-on" ${o.enabled ? 'checked' : ''}> <span>Keep email on this device for offline reading and fast search</span></label>
    <label class="field"><span>How much email to keep</span><select id="off-days" ${o.enabled ? '' : 'disabled'}>${OFF.DAY_CHOICES.map(([d, n]) => `<option value="${d}" ${o.days === d ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <div id="off-stats" class="off-stats"><div><span>Saved emails</span><b>…</b></div></div>
    <div id="off-progress"></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="off-sync" ${o.enabled && !S.demo ? '' : 'disabled'}>${icon('refresh', 'sm')} Update now</button><button class="btn danger" id="off-clear">Remove email from this device</button></div>
    <h4>How it works</h4>
    <ul class="note" style="padding-left:28px;line-height:1.7">
      <li>The first download runs in the background while LifeMail is open (the text of each email and pictures inside it). After that, only changes are fetched on every mail check.</li>
      <li>Attachments are kept after you open them once.</li>
      <li>Offline you can read, search, archive, delete, star, mark read/unread, label — and send. These changes wait in an outbox and go to Gmail automatically when you are back online.</li>
      <li>Searching while online shows results from this device instantly, then adds anything older that Gmail finds.</li>
      <li>Spam and Trash are not downloaded. Signing out or removing an account deletes its copy from this device.</li>
    </ul>
    <h4>Search words</h4>
    <div class="note" style="line-height:1.8"><code>from:rakesh</code> · <code>to:director</code> · <code>subject:NGDR</code> · <code>has:attachment</code> · <code>filename:pdf</code> · <code>label:GSI</code> · <code>is:unread</code> · <code>is:starred</code> · <code>in:sent</code> · <code>after:01/10/2026</code> · <code>before:2026/10/31</code> · <code>newer_than:7d</code> · <code>larger:5M</code> · <code>"exact phrase"</code> · <code>-leave-out</code> · <code>NGDR OR BISAG</code></div>`;
  },

  notify: () => `
    <h4>New-email notifications</h4>
    <label class="check"><input type="checkbox" id="nt-on" ${D().settings.notifications ? 'checked' : ''}> Show a notification when new email arrives</label>
    <label class="field"><span>Check every</span><select id="nt-int">${[60, 90, 180, 300, 600].map((s) => `<option value="${s}" ${D().settings.pollSeconds === s ? 'selected' : ''}>${s < 120 ? s + ' seconds' : s / 60 + ' minutes'}</option>`).join('')}</select></label>
    <div class="note">LifeMail checks for new email while it is open (also in the background on Android while the app is in recent apps). Profile rules, Focus and quiet hours are under “Profiles & Focus”. For instant alerts when LifeMail is fully closed, keep the Gmail app's notifications on.</div>`,

  appearance: () => `
    <h4>Theme</h4>${seg('theme', D().settings.theme, [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}
    <h4>Email list density</h4>${seg('density', D().settings.density, [['comfortable', 'Comfortable'], ['compact', 'Compact']])}`,

  privacy: () => `
    <h4>Remote images</h4>
    <div class="note">Pictures loaded from the internet can tell the sender when and where you opened an email. LifeMail hides them until you choose.</div>
    ${seg('img', D().settings.remoteImages, [['ask', 'Ask each time'], ['wifi', 'Only on Wi-Fi'], ['always', 'Always'], ['never', 'Never']])}
    <h4>How LifeMail protects you</h4>
    <ul class="note" style="padding-left:28px;line-height:1.7">
      <li>Sign-in happens on Google's page. LifeMail never sees or stores your password.</li>
      <li>Access tokens last 1 hour and stay on this device only. They are never put in Drive, in links, or in LifeOS tasks.</li>
      <li>Drive access is limited to LifeMail's own hidden app folder — it cannot see your other Drive files.</li>
      <li>Email content runs in a locked box: no scripts, no forms, tracking pixels blocked.</li>
      <li>There is no LifeMail server and no analytics. Your email goes only between this device and Google.</li>
    </ul>
    <button class="btn danger" id="signout-all">Sign out of all accounts on this device</button>`,

  data: () => `
    <h4>Google Drive storage</h4>
    <p class="note">${S.demo ? 'Demo mode keeps settings on this device only.' : `Settings, profiles, label colours and your email→task links are saved in Google Drive (hidden app folder of <b>${esc(S.store.driveAccount)}</b>) so they follow you to every device.`}</p>
    ${S.demo ? '' : `<div class="field"><span>Store LifeMail data in</span><select id="drive-acct">${D().accounts.map((a) => `<option ${a.email === S.store.driveAccount ? 'selected' : ''}>${esc(a.email)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="sync-now">${icon('cloud', 'sm')} Sync now</button><span class="note" style="margin:0">Status: ${esc(S.store.status)}${S.store.lastSync ? ' · ' + new Date(S.store.lastSync).toLocaleTimeString() : ''}</span></div>`}
    <h4>Backup</h4>
    <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="export">Download backup (.json)</button><button class="btn" id="import">Restore from backup…</button><input type="file" id="import-file" accept="application/json" hidden></div>
    <h4>This device</h4>
    <button class="btn" id="clear-cache">Clear offline email cache</button>
    ${S.demo ? '<button class="btn" id="leave-demo" style="margin-left:8px">Leave demo</button>' : ''}`,

  about: () => `
    <h4>LifeMail</h4><p>Turn email into action. Version 1.6 — offline mail, fast search, labels &amp; email rules.</p>
    <p class="note">Keyboard (with a keyboard attached): <b>j/k</b> next/previous · <b>Enter</b> open · <b>e</b> archive · <b>#</b> delete · <b>s</b> star · <b>u</b> unread · <b>l</b> label · <b>t</b> + Task · <b>r</b>/<b>a</b>/<b>f</b> reply/all/forward · <b>c</b> compose · <b>/</b> search.</p>
    <p class="note">Email sanitising by DOMPurify (Apache-2.0 / MPL-2.0).</p>`,
};

const WIRE = {
  work(panel, redraw) {
    const q = (x) => panel.querySelector(x);
    const setW = (fn) => set((d) => { d.work = { ...WORK_DEFAULTS, ...(d.work || {}) }; fn(d.work); });
    q('#wk-url').onchange = (e) => {
      const v = e.target.value.trim();
      if (!isAllowedWorkUrl(v)) { toast('Use an https:// Government address (mgovcloud.in, gov.in or nic.in).', { err: true }); e.target.value = workSettings().portalUrl; return; }
      setW((w) => { w.portalUrl = v; }); toast('Workplace address saved');
    };
    q('#wk-auto').onchange = (e) => setW((w) => { w.autoOpen = e.target.checked; });
    q('#wk-open').onclick = () => openWorkplace();
    q('#wk-sc-add').onclick = () => {
      const name = q('#wk-sc-name').value.trim(); const url = q('#wk-sc-url').value.trim();
      if (!name) return toast('Give the shortcut a name.', { err: true });
      if (!isAllowedWorkUrl(url)) return toast('Use an https:// Government address (mgovcloud.in, gov.in or nic.in).', { err: true });
      setW((w) => { w.shortcuts = [...(w.shortcuts || []), { name: name.slice(0, 40), url }].slice(0, 12); }); redraw();
    };
    panel.querySelectorAll('[data-wk-rm]').forEach((b) => (b.onclick = () => { setW((w) => { w.shortcuts = w.shortcuts.filter((_, i) => i !== +b.dataset.wkRm); }); redraw(); }));
  },
  accounts(panel, redraw) {
    panel.oninput = panel.onchange = (e) => {
      const f = e.target.dataset.f; if (!f) return;
      const i = +e.target.dataset.i;
      const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      set((d) => { d.accounts[i][f] = v; });
      if (f === 'profile') { emit('reload'); }
    };
    panel.querySelectorAll('[data-colors]').forEach((c) => (c.onclick = (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      set((d) => { d.accounts[+c.dataset.colors].color = b.dataset.c; }); redraw();
    }));
    panel.querySelector('[data-add]')?.addEventListener('click', async () => {
      try { const info = await signIn(); addAccount(info); redraw(); emit('reload'); toast('Added ' + info.email); }
      catch (e) { toast(e.message, { err: true }); }
    });
    panel.querySelectorAll('[data-reconnect]').forEach((b) => (b.onclick = async () => {
      const a = D().accounts[+b.dataset.reconnect];
      try { await signIn({ loginHint: a.email }); S.authNeeded.delete(a.email); redraw(); emit('reload'); } catch (e) { toast(e.message, { err: true }); }
    }));
    panel.querySelectorAll('[data-remove]').forEach((b) => (b.onclick = async () => {
      const a = D().accounts[+b.dataset.remove];
      if (!(await confirmBox(`Remove ${a.email} from LifeMail? Your email stays in Gmail.`, 'Remove', true))) return;
      forgetToken(a.email); dropProvider(a.email); OFF.clearAccount(a.email).catch(() => {});
      set((d) => { d.accounts = d.accounts.filter((x) => x.email !== a.email); if (d.storageAccount === a.email) d.storageAccount = ''; });
      if (S.view.account === a.email) S.view.account = 'all';
      redraw(); emit('reload');
    }));
  },
  profiles(panel) {
    wireSeg(panel, 'focus', (v) => set((d) => { d.focus = v; }));
    for (const k of Object.keys(D().profiles)) {
      wireSeg(panel, 'pn-' + k, (v) => set((d) => { d.profiles[k].notify = v; }));
    }
    panel.oninput = (e) => {
      const t = e.target;
      if (t.dataset.pn) set((d) => { d.profiles[t.dataset.pn].name = t.value || d.profiles[t.dataset.pn].name; });
      if (t.dataset.q) set((d) => { d.profiles[t.dataset.q].quiet.enabled = t.checked; });
      if (t.dataset.qs) set((d) => { d.profiles[t.dataset.qs].quiet.start = t.value; });
      if (t.dataset.qe) set((d) => { d.profiles[t.dataset.qe].quiet.end = t.value; });
    };
  },
  lifeos(panel) {
    const q = (s) => panel.querySelector(s);
    q('#lo-url').onchange = (e) => {
      const v = e.target.value.trim();
      if (v && !isAllowedLifeOSUrl(v)) { toast('The LifeOS address must start with https://', { err: true }); return; }
      set((d) => { d.settings.lifeos.urlTemplate = v; });
      toast(v ? 'LifeOS address saved' : 'LifeOS address cleared');
    };
    q('#lo-projects').onchange = (e) => set((d) => { d.settings.lifeos.projects = e.target.value.split(',').map((x) => x.trim()).filter(Boolean); });
    q('#lo-dproj').onchange = (e) => set((d) => { d.settings.lifeos.defaultProject = e.target.value.trim(); });
    q('#lo-due').onchange = (e) => set((d) => { d.settings.lifeos.defaultDue = e.target.value; });
    q('#lo-label').onchange = (e) => set((d) => { d.settings.lifeos.labelOnTask = e.target.checked; });
    q('#lo-smart').onchange = (e) => set((d) => { d.settings.smartSuggest = e.target.checked; });
    wireSeg(panel, 'lo-pri', (v) => set((d) => { d.settings.lifeos.defaultPriority = v; }));
    q('#lo-test').onclick = () => {
      const p = createTaskPayload({ provider: 'gmail', account: D().accounts[0]?.email || 'test@example.com', messageId: 'test', threadId: 'test', subject: 'LifeMail test task', from: { name: 'LifeMail', email: 'test@example.com' }, date: Date.now(), snippet: 'If you can read this in LifeOS, the connection works.' }, { title: 'LifeMail connection test', priority: 'low' }, location.origin);
      const url = buildLifeOSUrl(D().settings.lifeos.urlTemplate, p) || `${location.origin}/lifeos-kit/test-receiver.html?lifemail=${encodePayload(p)}`;
      window.open(url, '_blank');
    };
  },
  labels(panel, redraw, m) { mountLabels(panel, m); },
  rules(panel, redraw, m) { mountRules(panel, m); },
  offline(panel, redraw) {
    const q = (x) => panel.querySelector(x);
    const fill = async () => {
      const st = await OFF.offlineStats(); if (!panel.isConnected) return;
      const last = Math.max(0, ...st.metas.map((m) => m.lastSync || 0));
      q('#off-stats').innerHTML = `<div><span>Saved emails</span><b>${st.count.toLocaleString()}</b></div>
        <div><span>Space used</span><b>${st.usage ? (st.usage / 1048576).toFixed(st.usage > 1e8 ? 0 : 1) + ' MB' : '—'}</b></div>
        <div><span>Last updated</span><b>${last ? new Date(last).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Not yet'}</b></div>
        <div><span>Waiting to send</span><b>${st.pending}</b></div>
        ${D().accounts.length > 1 ? Object.entries(st.perAccount).map(([a, n]) => `<div><span>${esc(a)}</span><b>${n.toLocaleString()}</b></div>`).join('') : ''}`;
      const p = OFF.offlineState().progress;
      q('#off-progress').innerHTML = p && p.total ? `<div class="note">Downloading ${esc(p.account)}: ${p.done.toLocaleString()} of ${p.total.toLocaleString()}</div><div class="off-bar"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></div>` : OFF.offlineState().syncing ? '<div class="note">Checking for changes…</div>' : '';
    };
    fill();
    const iv = setInterval(() => { if (!panel.isConnected || !q('#off-stats')) return clearInterval(iv); fill(); }, 1500);
    q('#off-on').onchange = async (e) => {
      if (!e.target.checked) {
        if (!(await confirmBox('Stop keeping email on this device? The saved copy will be removed. (Your email stays in Gmail.)', 'Stop & remove', true))) { e.target.checked = true; return; }
        OFF.setOfflineSettings({ enabled: false }); await OFF.clearAll(); toast('Offline copy removed from this device');
      } else { OFF.setOfflineSettings({ enabled: true }); OFF.askPersistentStorage(); emit('offline-sync'); toast('Downloading email for offline use…'); }
      redraw();
    };
    q('#off-days').onchange = (e) => { OFF.setOfflineSettings({ days: +e.target.value }); OFF.askPersistentStorage(); emit('offline-sync'); toast('Updating the saved email…'); fill(); };
    q('#off-sync').onclick = () => { emit('offline-sync'); toast('Updating…'); setTimeout(fill, 800); };
    q('#off-clear').onclick = async () => {
      if (!(await confirmBox('Remove all email saved on this device? Your email stays in Gmail. It will download again while “Keep email on this device” is on.', 'Remove', true))) return;
      await OFF.clearAll(); toast('Removed from this device'); fill();
    };
  },
  notify(panel) {
    panel.querySelector('#nt-on').onchange = async (e) => {
      if (e.target.checked && 'Notification' in window && Notification.permission !== 'granted') {
        const p = await Notification.requestPermission();
        if (p !== 'granted') { e.target.checked = false; toast('Notifications are blocked for LifeMail in your browser/phone settings.', { err: true }); return; }
      }
      set((d) => { d.settings.notifications = e.target.checked; }); emit('poll-restart');
    };
    panel.querySelector('#nt-int').onchange = (e) => { set((d) => { d.settings.pollSeconds = +e.target.value; }); emit('poll-restart'); };
  },
  appearance(panel) {
    wireSeg(panel, 'theme', (v) => { set((d) => { d.settings.theme = v; }); emit('theme'); });
    wireSeg(panel, 'density', (v) => { set((d) => { d.settings.density = v; }); emit('theme'); });
  },
  privacy(panel) {
    wireSeg(panel, 'img', (v) => set((d) => { d.settings.remoteImages = v; }));
    panel.querySelector('#signout-all').onclick = async () => {
      if (!(await confirmBox('Sign out of all accounts on this device? Your settings stay in Google Drive.', 'Sign out', true))) return;
      D().accounts.forEach((a) => forgetToken(a.email));
      await cacheClear(); await OFF.clearAll(); location.reload();
    };
  },
  data(panel, redraw) {
    const q = (s) => panel.querySelector(s);
    q('#drive-acct')?.addEventListener('change', (e) => { set((d) => { d.storageAccount = e.target.value; }); S.store.fileId = ''; S.store.pull().then(redraw); });
    q('#sync-now')?.addEventListener('click', async () => { await S.store.pull(); await S.store.push(); redraw(); toast(S.store.status === 'synced' ? 'Synced with Google Drive' : 'Sync problem: ' + (S.store.error || S.store.status), { err: S.store.status !== 'synced' }); });
    q('#export').onclick = () => {
      const blob = new Blob([S.store.exportJson()], { type: 'application/json' });
      if (isAndroidApp) { androidSaveBlob(blob, `lifemail-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json').catch((e) => toast(e.message, { err: true })); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `lifemail-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    q('#import').onclick = () => q('#import-file').click();
    q('#import-file').onchange = async (e) => {
      try { S.store.importJson(await e.target.files[0].text()); toast('Backup restored'); emit('reload'); redraw(); } catch (err) { toast(err.message, { err: true }); }
    };
    q('#clear-cache').onclick = async () => { await cacheClear(); toast('Offline cache cleared'); };
    q('#leave-demo')?.addEventListener('click', () => { localStorage.setItem('lm_demo', '0'); location.href = '/'; });
  },
};

export function addAccount(info) {
  set((d) => {
    const ex = d.accounts.find((a) => a.email === info.email);
    if (ex) { ex.name = info.name; ex.picture = info.picture; return; }
    const isWork = !/@(gmail|googlemail)\.com$/i.test(info.email);
    d.accounts.push({ email: info.email, name: info.name, picture: info.picture, displayName: '', profile: isWork ? 'work' : 'personal', color: COLORS[d.accounts.length % COLORS.length], signature: '', notify: true });
    if (!d.storageAccount) d.storageAccount = info.email;
  });
}
export { colorOf };
