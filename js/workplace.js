// Work = the Government Workplace (workplace.mgovcloud.in), opened as the REAL Government website.
//
// Why it is not shown inside a LifeMail frame:
//  • Government sign-in pages (accounts.mgovcloud.in) refuse to be displayed inside other sites, and
//    modern browsers block sign-in cookies inside embedded frames. Forcing it would need a proxy that
//    sits between you and the Government servers — exactly what must never happen with Government
//    credentials. So LifeMail opens the Government site directly; on an installed Android app this
//    appears as an in-app browser sheet on top of LifeMail, and Back returns you here.
//  • LifeMail never sees, stores or forwards the Government password, OTP/TOTP, cookies or mail.
//    The Government site's session lives in the browser under the Government's own address,
//    completely separate from LifeMail's storage (different web origin).
import { S, D, esc, icon, toast, $ } from './core.js';
import { isAndroidApp, androidCall } from './bridge.js';

export const WORK_DEFAULTS = {
  portalUrl: 'https://workplace.mgovcloud.in/',
  authUrl: 'https://accounts.mgovcloud.in/signin',
  autoOpen: true,
  shortcuts: [],   // [{name, url}] — e.g. the address of the Mail or ToDo page, added by the user
  lastOpened: 0,
};

export function workSettings() { return { ...WORK_DEFAULTS, ...(D().work || {}) }; }

// Only https addresses on the Government cloud are opened from the Work area.
export function isAllowedWorkUrl(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && (x.hostname === 'mgovcloud.in' || x.hostname.endsWith('.mgovcloud.in') || x.hostname.endsWith('.gov.in') || x.hostname.endsWith('.nic.in'));
  } catch { return false; }
}

export function openWorkplace(url) {
  const w = workSettings();
  const target = url && isAllowedWorkUrl(url) ? url : w.portalUrl;
  if (!navigator.onLine) { toast('Workplace requires an internet connection.', { err: true }); return false; }
  if (isAndroidApp) {
    // LifeMail Android app: Workplace opens INSIDE the app, in its own isolated Work browser.
    androidCall('openWork', { url: target }).catch((e) => toast(e.message, { err: true }));
    S.store.update((d) => { d.work = { ...WORK_DEFAULTS, ...(d.work || {}), lastOpened: Date.now() }; });
    return true;
  }
  // noopener + noreferrer: the Government site gets no handle on LifeMail and learns nothing about it.
  const win = window.open(target, '_blank', 'noopener,noreferrer');
  if (win === null && !document.hasFocus()) { /* opened in another app/tab; nothing to do */ }
  S.store.update((d) => { d.work = { ...WORK_DEFAULTS, ...(d.work || {}), lastOpened: Date.now() }; });
  return true;
}

const ago = (t) => {
  if (!t) return 'Not opened yet';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(t).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
};

// The Work screen shown in LifeMail (replaces "No accounts here").
export function renderWorkPanel(root, { onSettings, onMenu }) {
  const w = workSettings();
  const host = (() => { try { return new URL(w.portalUrl).host; } catch { return w.portalUrl; } })();
  root.innerHTML = `
  <div class="lhead phone-only"><button class="iconbtn" data-work-menu aria-label="Menu">${icon('menu')}</button><h1>Work</h1></div>
  <div class="workpanel">
    <div class="work-head">
      <div class="work-badge">${icon('work')}</div>
      <div><h1>Government Workplace</h1><p>${esc(host)}</p></div>
    </div>
    ${navigator.onLine ? '' : `<div class="note warn">${icon('alert', 'sm')} Workplace requires an internet connection.</div>`}
    <button class="btn primary work-open" data-work-open>${icon('external', 'sm')} Open Workplace</button>
    <p class="work-sub">${isAndroidApp ? 'Workplace opens inside LifeMail in its own secure Work browser, separate from Personal.' : 'Mail, Calendar, ToDo, Notes, Contacts and Resources open in the Government\'s own secure page.'} Sign in there with your Government ID and authenticator code — LifeMail never sees them. Press Back to return here.</p>
    ${w.shortcuts.length ? `<div class="sec">Shortcuts</div><div class="work-shortcuts">${w.shortcuts.map((s, i) => `<button class="work-tile" data-work-sc="${i}">${icon('external', 'sm')}<span>${esc(s.name)}</span></button>`).join('')}</div>` : ''}
    <div class="work-meta">
      <div><span>Last opened</span><b>${esc(ago(w.lastOpened))}</b></div>
      <div><span>Sign-in</span><b>Handled by the Government site</b></div>
    </div>
    <div class="work-actions">
      <button class="btn" data-work-settings>${icon('settings', 'sm')} Work settings</button>
      <button class="btn ghost" data-work-copy>${icon('link', 'sm')} Copy Workplace address</button>
    </div>
  </div>`;
  root.onclick = async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.hasAttribute('data-work-menu')) { e.stopPropagation(); onMenu?.(); return; }
    const again = () => renderWorkPanel(root, { onSettings, onMenu });
    if (b.hasAttribute('data-work-open')) { openWorkplace(); again(); }
    else if (b.dataset.workSc !== undefined) { openWorkplace(w.shortcuts[+b.dataset.workSc]?.url); again(); }
    else if (b.hasAttribute('data-work-settings')) onSettings();
    else if (b.hasAttribute('data-work-copy')) { try { await navigator.clipboard.writeText(w.portalUrl); toast('Address copied'); } catch { toast(w.portalUrl); } }
  };
}

// True when the Work profile has no Gmail accounts — Work then *is* the Government Workplace.
export function workIsPortalOnly() {
  return S.view.profile === 'work' && !D().accounts.some((a) => a.profile === 'work');
}

export { $ };
