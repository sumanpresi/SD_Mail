// Talks to the LifeMail Android app when this page runs inside it.
// The Android app injects `LifeMailAndroid` ONLY for this site's exact address (origin-locked),
// so no other website can use it. In a normal browser / installed PWA it does not exist and
// everything works exactly as before.
const B = typeof window !== 'undefined' ? window.LifeMailAndroid : undefined;
export const isAndroidApp = !!(B && typeof B.postMessage === 'function');

let seq = 0;
const pending = new Map();
const listeners = new Map();

if (isAndroidApp) {
  B.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.event) { (listeners.get(m.event) || []).forEach((fn) => fn(m)); return; }
    const p = pending.get(m.id); if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.res(m); else p.rej(Object.assign(new Error(friendly(m.error)), { code: m.error }));
  };
}

function friendly(code) {
  return ({
    android_not_configured: 'Google sign-in is not set up for the Android app yet (Android OAuth client + SHA-1). See ANDROID.md, step 2.',
    access_denied: 'Access was not granted.',
    interaction_required: 'Please sign in again.',
    network: 'No internet connection.',
  })[code] || code || 'The LifeMail app could not do that.';
}

export function androidCall(type, data = {}, timeoutMs = 5 * 60_000) {
  if (!isAndroidApp) return Promise.reject(new Error('Not running in the LifeMail Android app'));
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    B.postMessage(JSON.stringify({ id, type, ...data }));
    setTimeout(() => { if (pending.delete(id)) rej(new Error('No response from the LifeMail app')); }, timeoutMs);
  });
}

export function onAndroidEvent(name, fn) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}

export function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
}

// Saves (and optionally opens/shares) a file through the Android app — WebView cannot use <a download>.
export async function androidSaveBlob(blob, name, mime, action = 'save') {
  const base64 = await blobToBase64(blob);
  return androidCall('saveFile', { name, mime: mime || blob.type || 'application/octet-stream', base64, action });
}

if (isAndroidApp) androidCall('hello', {}, 10_000).catch(() => {});
