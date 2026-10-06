// Email actions shared by the list, the reader, keyboard shortcuts and menus.
// Each change is shown immediately (optimistic) and reverted if Gmail refuses it.
import { S, provider, keyOf, emit, toast, labelIdByName, D } from './core.js';

function findThread(key) { return S.threads.find((t) => keyOf(t) === key); }

function removeFromList(key) {
  const i = S.threads.findIndex((t) => keyOf(t) === key);
  const removed = i >= 0 ? S.threads.splice(i, 1)[0] : null;
  if (S.selected === key) {
    const next = S.threads[i] || S.threads[i - 1];
    S.selected = ''; S.thread = null;
    if (next && matchMedia('(min-width: 760px)').matches) emit('open', keyOf(next));
    else emit('close-reader');
  }
  emit('list');
  return { removed, index: i };
}
function restore({ removed, index }) {
  if (removed) { S.threads.splice(Math.max(0, index), 0, removed); emit('list'); }
}

async function run(fn, revert, msg) {
  try { await fn(); } catch (e) { revert?.(); toast(msg + ': ' + (e.authNeeded ? 'please reconnect the account' : e.message), { err: true }); if (e.authNeeded) { S.authNeeded.add(e.account); emit('side'); emit('list'); } }
}

export async function archive(t) {
  const key = keyOf(t); const snap = removeFromList(key);
  await run(() => provider(t.account).modifyThread(t.threadId, [], ['INBOX']), () => restore(snap), 'Could not archive');
  toast('Archived', { action: 'Undo', onAction: async () => { restore(snap); await run(() => provider(t.account).modifyThread(t.threadId, ['INBOX'], []), null, 'Undo failed'); } });
}
export async function trash(t) {
  const key = keyOf(t); const snap = removeFromList(key);
  await run(() => provider(t.account).trashThread(t.threadId), () => restore(snap), 'Could not delete');
  toast('Moved to Trash', { action: 'Undo', onAction: async () => { restore(snap); await run(() => provider(t.account).untrashThread(t.threadId), null, 'Undo failed'); } });
}
export async function spam(t) {
  const snap = removeFromList(keyOf(t));
  await run(() => provider(t.account).modifyThread(t.threadId, ['SPAM'], ['INBOX']), () => restore(snap), 'Could not report spam');
  toast('Reported as spam', { action: 'Undo', onAction: async () => { restore(snap); await run(() => provider(t.account).modifyThread(t.threadId, ['INBOX'], ['SPAM']), null, 'Undo failed'); } });
}
export async function moveToInbox(t) {
  const snap = S.view.folder === 'inbox' ? null : removeFromList(keyOf(t));
  await run(() => (t.labelIds?.includes('TRASH') ? provider(t.account).untrashThread(t.threadId) : provider(t.account).modifyThread(t.threadId, ['INBOX'], ['SPAM'])), () => snap && restore(snap), 'Could not move');
  toast('Moved to Inbox');
}

function patch(t, fn) {
  const items = [findThread(keyOf(t)), S.thread && keyOf(S.thread) === keyOf(t) ? S.thread : null].filter(Boolean);
  items.forEach(fn);
  emit('list'); emit('reader');
}

export async function toggleStar(t) {
  const on = !t.starred;
  patch(t, (x) => { x.starred = on; x.labelIds = on ? [...new Set([...(x.labelIds || []), 'STARRED'])] : (x.labelIds || []).filter((l) => l !== 'STARRED'); });
  await run(() => (on ? provider(t.account).modifyMessage(t.messageId, ['STARRED'], []) : provider(t.account).modifyThread(t.threadId, [], ['STARRED'])),
    () => patch(t, (x) => { x.starred = !on; }), 'Could not change star');
}
export async function setUnread(t, unread) {
  if (!!t.unread === unread) return;
  patch(t, (x) => { x.unread = unread; });
  emit('unread-delta', { profile: S.view.profile, delta: unread ? 1 : -1, account: t.account });
  await run(() => provider(t.account).modifyThread(t.threadId, unread ? ['UNREAD'] : [], unread ? [] : ['UNREAD']), () => patch(t, (x) => { x.unread = !unread; }), 'Could not update');
}
export async function toggleLabel(t, name) {
  const p = provider(t.account);
  let id = labelIdByName(t.account, name);
  const has = id && (t.labelIds || []).includes(id);
  try {
    if (!id) { id = await p.ensureLabel(name); S.labels[t.account] = await p.listLabels(); }
    patch(t, (x) => { x.labelIds = has ? x.labelIds.filter((l) => l !== id) : [...new Set([...(x.labelIds || []), id])]; });
    await p.modifyThread(t.threadId, has ? [] : [id], has ? [id] : []);
    emit('side');
  } catch (e) { toast('Could not change label: ' + e.message, { err: true }); }
}
export async function addLabelQuiet(t, name) {
  const p = provider(t.account);
  try {
    let id = labelIdByName(t.account, name);
    if (!id) { id = await p.ensureLabel(name); S.labels[t.account] = await p.listLabels(); }
    if ((t.labelIds || []).includes(id)) return;
    patch(t, (x) => { x.labelIds = [...new Set([...(x.labelIds || []), id])]; });
    await p.modifyThread(t.threadId, [id], []);
  } catch { /* labelling is a convenience — never block task creation */ }
}

export function allUserLabelNames() {
  const set = new Set(D().pinnedLabels);
  for (const a of D().accounts) for (const l of S.labels[a.email] || []) if (l.type === 'user') set.add(l.name);
  return [...set].sort((a, b) => a.localeCompare(b));
}
