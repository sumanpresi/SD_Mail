// Android back gesture / back button support.
// An installed web app exits when the browser history is empty. LifeMail keeps ONE extra
// history entry ("guard") whenever there is something to step back from — an open menu,
// dialog, side drawer, an email on a phone screen, or a folder other than the Inbox.
// Back then closes that one thing instead of leaving the app. At the plain Inbox, back exits as normal.
import { closeMenu, $, $$ } from './core.js';

let armed = false;     // is our guard entry currently on the history stack?
let ignoreNext = false; // we removed the guard ourselves; skip the resulting popstate
let hooks = { canGoBackView: () => false, goBackView: () => {}, closeReader: () => {} };

const app = () => $('#app');
const narrow = () => matchMedia('(max-width: 759px)').matches;
const menuOpen = () => !!document.querySelector('.menu');
const topModal = () => { const s = $$('#layer .scrim'); return s[s.length - 1] || null; };
const drawerOpen = () => !!app()?.classList.contains('side-open');
const readerOpen = () => narrow() && !!app()?.classList.contains('reading');

export function canGoBack() {
  return menuOpen() || !!topModal() || drawerOpen() || readerOpen() || hooks.canGoBackView();
}

// Close exactly one thing, most recent first.
function stepBack() {
  if (menuOpen()) return closeMenu();
  const m = topModal();
  if (m) {
    // Compose's ✕ saves a draft before closing; other dialogs use their Close/Cancel button.
    const btn = m.querySelector('[data-x]') || m.querySelector('.mtitle [data-close]') || m.querySelector('[data-close]');
    if (btn) btn.click(); else m.remove();
    return;
  }
  if (drawerOpen()) return app().classList.remove('side-open');
  if (readerOpen()) return hooks.closeReader();
  if (hooks.canGoBackView()) return hooks.goBackView();
}

export function syncBack() {
  const need = canGoBack();
  if (need && !armed) { history.pushState({ lifemailGuard: true }, '', location.href); armed = true; }
  else if (!need && armed) { ignoreNext = true; armed = false; history.back(); }
}

let queued = false;
function queueSync() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; syncBack(); }); }

export function initBackNav(h) {
  hooks = { ...hooks, ...h };
  addEventListener('popstate', () => {
    armed = false;
    if (ignoreNext) { ignoreNext = false; return; }
    stepBack();
    queueSync();
  });
  // Re-check whenever something opens or closes.
  const mo = new MutationObserver(queueSync);
  mo.observe(app(), { attributes: true, attributeFilter: ['class'] });
  mo.observe($('#layer'), { childList: true });
  mo.observe(document.body, { childList: true }); // pop-up menus
  addEventListener('resize', queueSync);
  queueSync();
}
export { queueSync as backNavChanged };
