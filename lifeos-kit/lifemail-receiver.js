/*!
 * LifeMail → LifeOS receiver  (copy this ONE file into your LifeOS app)
 * ---------------------------------------------------------------
 * It accepts an email from LifeMail by any of the three routes:
 *   1. drag-and-drop  (LifeMail and LifeOS side by side on the Fold, or two browser windows)
 *   2. a link         (LifeMail "Send to LifeOS" opens  https://your-lifeos/?lifemail=<payload>)
 *   3. Android Share  (LifeOS installed as an app with "share_target" in its manifest)
 * and calls YOUR function with a clean, validated task object. It never sees or needs any password or token.
 *
 * Usage in LifeOS:
 *   <script src="/lifemail-receiver.js"></script>
 *   <script>
 *     LifeMailReceiver.init({
 *       onTask(task) {           // you decide what to do: show your "new task" dialog, or save directly
 *         openNewTaskDialog({ title: task.title, due: task.due, priority: task.priority, project: task.project,
 *                             notes: task.notes, link: task.emailUrl, source: task.source });
 *       },
 *       wholePage: true          // the whole LifeOS window accepts drops (default true)
 *     });
 *     // Optional: special drop targets — dropping here sets task.destination
 *     LifeMailReceiver.dropZone(document.getElementById('today-list'), { destination: 'today' });
 *     LifeMailReceiver.dropZone(document.getElementById('waiting-list'), { destination: 'waiting' });
 *   </script>
 */
(function (global) {
  'use strict';
  var MARKER = 'lifemail-payload:';
  var MIME = 'application/x-lifemail+json';

  function b64urlDecode(s) {
    var b = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : ''; }
  function https(v) { return typeof v === 'string' && /^https:\/\//i.test(v) ? v.slice(0, 2000) : ''; }

  // Security: never trust incoming data blindly — keep only known fields, as plain text, with length limits.
  function validate(o) {
    if (!o || typeof o !== 'object' || o.source !== 'lifemail' || typeof o.v !== 'number') return null;
    var t = o.task && typeof o.task === 'object' ? o.task : {};
    var pri = ['high', 'medium', 'low'].indexOf(t.priority) >= 0 ? t.priority : '';
    var due = /^\d{4}-\d{2}-\d{2}$/.test(t.due || '') ? t.due : '';
    return {
      source: 'lifemail', version: o.v,
      title: str(t.title, 200) || str(o.subject, 200) || 'Follow up',
      project: str(t.project, 100), due: due, priority: pri, destination: str(t.destination, 40),
      notes: str(t.notes, 2000), keepEmailLink: t.keepEmailLink !== false,
      provider: str(o.provider, 20), account: str(o.account, 200),
      messageId: str(o.messageId, 100), threadId: str(o.threadId, 100), rfcMessageId: str(o.rfcMessageId, 300),
      subject: str(o.subject, 300), senderName: str(o.senderName, 120), senderEmail: str(o.senderEmail, 200),
      emailDate: str(o.emailDate, 40), emailUrl: https(o.emailUrl), lifemailUrl: https(o.lifemailUrl),
      preview: str(o.preview, 280),
      attachments: Array.isArray(o.attachments) ? o.attachments.filter(function (a) { return typeof a === 'string'; }).slice(0, 20) : [],
      createdAt: str(o.createdAt, 40),
    };
  }
  function decode(encoded) {
    try { return validate(JSON.parse(b64urlDecode(String(encoded).trim()))); } catch (e) { return null; }
  }
  function fromText(text) {
    if (!text) return null;
    var m = String(text).match(/lifemail-payload:([A-Za-z0-9_-]+)/);
    if (m) return decode(m[1]);
    m = String(text).match(/[?&#]lifemail=([A-Za-z0-9_-]+)/);
    if (m) return decode(m[1]);
    return null;
  }
  function fromDataTransfer(dt) {
    if (!dt) return null;
    var p = null;
    try { var j = dt.getData(MIME); if (j) p = validate(JSON.parse(j)); } catch (e) {}
    if (!p) p = fromText(dt.getData('text/plain'));
    if (!p) p = fromText(dt.getData('text/uri-list'));
    if (!p) p = fromText(dt.getData('text/html'));
    return p;
  }
  // A plain Gmail link dropped from somewhere else still makes a (simpler) task.
  function fromLooseLink(dt) {
    var u = (dt && (dt.getData('text/uri-list') || dt.getData('text/plain')) || '').trim().split('\n')[0];
    if (!/^https:\/\/mail\.google\.com\//i.test(u)) return null;
    return { source: 'link', title: 'Follow up on email', emailUrl: u, notes: '', due: '', priority: '', project: '', destination: '', keepEmailLink: true };
  }

  var opts = { onTask: null, wholePage: true };
  function deliver(task, extra) {
    if (!task) return false;
    if (extra && extra.destination) task.destination = extra.destination;
    if (typeof opts.onTask === 'function') opts.onTask(task);
    return true;
  }
  function accepts(e) {
    var types = Array.prototype.slice.call((e.dataTransfer && e.dataTransfer.types) || []);
    return types.indexOf('text/plain') >= 0 || types.indexOf('text/uri-list') >= 0 || types.indexOf(MIME) >= 0;
  }

  function dropZone(el, extra) {
    if (!el) return;
    el.addEventListener('dragover', function (e) { if (accepts(e)) { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('lifemail-over'); } });
    el.addEventListener('dragleave', function () { el.classList.remove('lifemail-over'); });
    el.addEventListener('drop', function (e) {
      el.classList.remove('lifemail-over');
      var p = fromDataTransfer(e.dataTransfer) || fromLooseLink(e.dataTransfer);
      if (p) { e.preventDefault(); e.stopPropagation(); deliver(p, extra); }
    });
  }

  function checkUrl() {
    var u = new URL(location.href);
    var p = null;
    if (u.searchParams.get('lifemail')) p = decode(u.searchParams.get('lifemail'));
    else if (u.searchParams.get('text') || u.searchParams.get('url')) p = fromText((u.searchParams.get('text') || '') + '\n' + (u.searchParams.get('url') || '')); // Android share target
    if (u.searchParams.has('lifemail') || (p && (u.searchParams.has('text') || u.searchParams.has('url')))) {
      ['lifemail', 'text', 'title', 'url'].forEach(function (k) { u.searchParams.delete(k); });
      history.replaceState(null, '', u.pathname + (u.searchParams.toString() ? '?' + u.searchParams : '') + u.hash);
    }
    return p;
  }

  function init(o) {
    opts = Object.assign(opts, o || {});
    if (opts.wholePage) dropZone(document.documentElement, {});
    var p = checkUrl();
    if (p) setTimeout(function () { deliver(p); }, 0);
    // Also accept a pasted LifeMail task (from "Copy" in LifeMail)
    document.addEventListener('paste', function (e) {
      var t = e.clipboardData && e.clipboardData.getData('text/plain');
      var task = fromText(t);
      if (task && !/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) { e.preventDefault(); deliver(task); }
    });
  }

  global.LifeMailReceiver = { init: init, dropZone: dropZone, decode: decode, fromText: fromText, fromDataTransfer: fromDataTransfer, validate: validate };
})(window);
