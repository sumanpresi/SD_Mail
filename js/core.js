// Shared state + small UI helpers used by every screen.
import { Store } from './store.js';
import { GmailProvider } from './gmail.js';
import { DemoProvider } from './demo.js';
import { wrapProvider } from './offline.js';

export const S = {
  store: new Store(),
  demo: false,
  view: { profile: 'personal', account: 'all', folder: 'inbox', label: '', search: '' },
  threads: [],
  pageTokens: {},
  loading: false,
  fromCache: 0,
  selected: '',        // "account|threadId"
  thread: null,        // full thread currently open
  labels: {},          // account -> [{id,name,type}]
  authNeeded: new Set(),
  online: navigator.onLine,
  unread: { personal: 0, work: 0 },
  loadImages: new Set(),
};

// Simple event bus so screens can ask each other to redraw without import cycles.
export const bus = new EventTarget();
export const emit = (name, detail) => bus.dispatchEvent(new CustomEvent(name, { detail }));
export const on = (name, fn) => bus.addEventListener(name, (e) => fn(e.detail));

const providers = new Map();
export function provider(account) {
  if (!providers.has(account)) providers.set(account, S.demo ? new DemoProvider(account) : wrapProvider(new GmailProvider(account)));
  return providers.get(account);
}
export function dropProvider(account) { providers.delete(account); }

export const D = () => S.store.data;
export const accounts = () => D().accounts;
export const account = (email) => accounts().find((a) => a.email === email);
export function accountsInView() {
  const list = accounts().filter((a) => a.profile === S.view.profile);
  return S.view.account === 'all' ? list : list.filter((a) => a.email === S.view.account);
}
export const keyOf = (t) => `${t.account}|${t.threadId || t.id}`;
export const colorOf = (email) => account(email)?.color || '#7c8389';

export function labelName(acct, id) {
  const l = (S.labels[acct] || []).find((x) => x.id === id);
  return l ? l.name : id;
}
export function userLabelNames(acct) {
  return (S.labels[acct] || []).filter((l) => l.type === 'user').map((l) => l.name);
}
export function labelIdByName(acct, name) {
  return (S.labels[acct] || []).find((l) => l.name.toLowerCase() === String(name).toLowerCase())?.id || '';
}
export function labelColor(name) {
  return D().labelColors[name] || '';
}
export function taskLinkFor(t) {
  return D().taskLinks.find((l) => l.account === t.account && l.threadId === (t.threadId || t.id));
}

// ---------- DOM helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const icon = (name, cls = '') => `<svg class="ic ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
export function hashColor(str = '') {
  let h = 0; for (const c of str) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const pal = ['#5b7c99', '#7a6ab8', '#2f7d6d', '#b4583a', '#a0782b', '#4f8a3c', '#b05c9a', '#3a6ea5', '#8a5a44', '#5f6f7a'];
  return pal[h % pal.length];
}

export function toast(msg, { action, onAction, err = false, ms = 4200 } = {}) {
  const el = document.createElement('div');
  el.className = 'toast' + (err ? ' err' : '');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.remove(); onAction?.(); };
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

let menuCleanup = null;
export function closeMenu() { menuCleanup?.(); menuCleanup = null; }
// items: [{label, icon, onClick, checked}] | {header} | {sep:true} | {input:'placeholder', onEnter}
export function openMenu(anchor, items) {
  closeMenu();
  const m = document.createElement('div');
  m.className = 'menu'; m.setAttribute('role', 'menu');
  m.innerHTML = items.map((it, i) => {
    if (it.sep) return '<hr>';
    if (it.header) return `<div class="mh">${esc(it.header)}</div>`;
    if (it.input) return `<input data-i="${i}" placeholder="${esc(it.input)}" aria-label="${esc(it.input)}">`;
    return `<button role="menuitem" data-i="${i}">${it.checked !== undefined ? `<span class="ck">${it.checked ? icon('check', 'sm') : ''}</span>` : ''}${it.color ? `<span class="dot" style="width:10px;height:10px;border-radius:3px;background:${it.color}"></span>` : ''}${it.icon ? icon(it.icon) : ''}<span>${esc(it.label)}</span></button>`;
  }).join('');
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  const mw = m.offsetWidth; const mh = m.offsetHeight;
  let left = Math.min(r.left, innerWidth - mw - 8); let top = r.bottom + 4;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  m.style.left = Math.max(8, left) + 'px'; m.style.top = top + 'px';
  m.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]'); if (!b) return;
    const it = items[+b.dataset.i]; closeMenu(); it.onClick?.();
  });
  m.querySelectorAll('input[data-i]').forEach((inp) => {
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && inp.value.trim()) { const it = items[+inp.dataset.i]; closeMenu(); it.onEnter(inp.value.trim()); } });
    setTimeout(() => inp.focus(), 30);
  });
  const off = (e) => { if (!m.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu(); };
  const key = (e) => { if (e.key === 'Escape') closeMenu(); };
  setTimeout(() => { addEventListener('pointerdown', off, true); addEventListener('keydown', key); }, 0);
  menuCleanup = () => { m.remove(); removeEventListener('pointerdown', off, true); removeEventListener('keydown', key); };
  m.querySelector('button')?.focus?.({ preventScroll: true });
}

// Modal: returns {el, close}. html is the inner of .modal
export function openModal(html, { cls = '', onClose, dismissable = true } = {}) {
  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.innerHTML = `<div class="modal ${cls}" role="dialog" aria-modal="true">${html}</div>`;
  $('#layer').appendChild(scrim);
  const close = () => { scrim.remove(); removeEventListener('keydown', key); onClose?.(); };
  const key = (e) => { if (e.key === 'Escape' && dismissable) { e.stopPropagation(); close(); } };
  addEventListener('keydown', key);
  scrim.addEventListener('pointerdown', (e) => { if (e.target === scrim && dismissable) close(); });
  scrim.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  const first = scrim.querySelector('input:not([type=hidden]),select,textarea,[contenteditable]');
  if (first && matchMedia('(min-width: 760px)').matches) setTimeout(() => first.focus(), 40);
  return { el: scrim.firstElementChild, close };
}
export const modalOpen = () => !!$('#layer .scrim');

export function confirmBox(text, okLabel = 'OK', danger = false) {
  return new Promise((res) => {
    const m = openModal(`<div class="mcontent" style="padding-top:18px">${esc(text)}</div><div class="mfoot"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`, { onClose: () => res(false) });
    m.el.querySelector('[data-ok]').onclick = () => { res(true); m.close(); };
  });
}

export async function blobFromB64Url(b64url, type) {
  const { b64UrlToBytes } = await import('./lib.js');
  return new Blob([b64UrlToBytes(b64url)], { type: type || 'application/octet-stream' });
}
