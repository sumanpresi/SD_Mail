// The search box: results as you type (from the copy on this device), suggestions of people you
// email with, recent searches, and a short guide to search words. Works offline.
import { esc, icon } from './core.js';
import { localPeople } from './offline.js';
import { peopleIndex, suggestPeople } from './search.js';

const RECENT_KEY = 'lm_recent_searches';
export function recentSearches() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } }
export function saveRecentSearch(q) {
  q = String(q || '').trim(); if (!q) return;
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...recentSearches().filter((x) => x !== q)].slice(0, 8))); } catch {}
}

const TIPS = [
  ['from:', 'from:rakesh', 'Sender'], ['to:', 'to:director', 'Recipient (To or Cc)'], ['subject:', 'subject:NGDR', 'Words in the subject'],
  ['has:attachment', 'has:attachment', 'With attachments'], ['filename:', 'filename:pdf', 'Attachment name'], ['label:', 'label:GSI', 'In a label'],
  ['is:unread', 'is:unread', 'Unread'], ['after:', 'after:01/10/2026', 'After a date (day/month/year)'], ['newer_than:', 'newer_than:7d', 'Last 7 days (d, m, y)'],
  ['"…"', '"report IDs"', 'Exact phrase'], ['-', '-newsletter', 'Leave out a word'], ['OR', 'NGDR OR BISAG', 'Either word'],
];

let people = null; let peopleAt = 0;
async function getPeople(opts) {
  if (people && Date.now() - peopleAt < 5 * 60_000) return people;
  try { people = await localPeople(opts.myEmails()); } catch { people = []; }
  if (!people.length) people = peopleIndex(opts.threads().map((t) => ({ fromName: t.from?.name, fromEmail: t.from?.email, to: '' })), opts.myEmails());
  peopleAt = Date.now();
  return people;
}

export function initSearchUI(input, opts) {
  const bar = input.closest('.searchbar');
  let box = null; let timer = null; let active = -1;
  const close = () => { box?.remove(); box = null; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const choose = (q) => { close(); input.value = q; opts.search(q); input.blur(); };

  async function show() {
    const text = input.value;
    const last = text.split(/\s+/).pop() || '';
    const items = [];
    if (!text.trim()) {
      recentSearches().slice(0, 6).forEach((q) => items.push({ q, html: `${icon('clock', 'sm')}<span>${esc(q)}</span>` }));
      items.push({ tips: true });
    } else {
      if (last.length >= 2 && !last.includes(':')) {
        const ppl = suggestPeople(await getPeople(opts), last, 4);
        const before = text.slice(0, text.length - last.length);
        ppl.forEach((p) => items.push({ q: `${before}from:${p.email}`.trim(), html: `<span class="sg-av">${esc((p.name || p.email)[0].toUpperCase())}</span><span><b>${esc(p.name || p.email)}</b> <small>${esc(p.email)}</small></span><em>from</em>` }));
      }
      items.unshift({ q: text.trim(), html: `${icon('search', 'sm')}<span>Search for <b>${esc(text.trim())}</b></span>` });
    }
    if (!box) {
      box = document.createElement('div'); box.className = 'suggest'; box.setAttribute('role', 'listbox'); box.id = 'search-suggest';
      bar.after(box); input.setAttribute('aria-expanded', 'true');
      box.style.top = (bar.offsetTop + bar.offsetHeight + 4) + 'px'; input.setAttribute('aria-controls', 'search-suggest');
      box.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard open
      box.addEventListener('click', (e) => {
        const b = e.target.closest('[data-q]'); if (b) return choose(b.dataset.q);
        const t = e.target.closest('[data-tip]'); if (t) { input.value = (input.value.trim() + ' ' + t.dataset.tip).trim(); input.focus(); if (!t.dataset.tip.endsWith(':')) show(); }
      });
    }
    box.innerHTML = items.map((it, i) => it.tips
      ? `<div class="sg-tips"><div class="sg-h">Search words — tap to add</div>${TIPS.map(([tok, ex, what]) => `<button class="sg-tip" data-tip="${esc(tok.startsWith('"') || tok === '-' || tok === 'OR' ? '' : tok)}" ${tok.startsWith('"') || tok === '-' || tok === 'OR' ? 'disabled' : ''}><code>${esc(ex)}</code><span>${esc(what)}</span></button>`).join('')}</div>`
      : `<button class="sg-item ${i === active ? 'on' : ''}" role="option" data-q="${esc(it.q)}">${it.html}</button>`).join('');
  }

  input.setAttribute('autocomplete', 'off');
  input.addEventListener('focus', show);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('input', () => {
    show();
    clearTimeout(timer);
    if (!opts.canTypeahead()) return;
    timer = setTimeout(() => opts.typeahead(input.value.trim()), 220); // results as you type
  });
  input.addEventListener('keydown', (e) => {
    const opts2 = box ? [...box.querySelectorAll('.sg-item')] : [];
    if (e.key === 'ArrowDown' && opts2.length) { e.preventDefault(); active = (active + 1) % opts2.length; opts2.forEach((b, i) => b.classList.toggle('on', i === active)); }
    else if (e.key === 'ArrowUp' && opts2.length) { e.preventDefault(); active = (active - 1 + opts2.length) % opts2.length; opts2.forEach((b, i) => b.classList.toggle('on', i === active)); }
    else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(timer); choose(active >= 0 && opts2[active] ? opts2[active].dataset.q : input.value.trim()); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
}
