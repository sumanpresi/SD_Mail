// Shows exactly what LifeOS would receive. Builds the table with textContent (never innerHTML) — safe by design.
(function () {
  var out = document.getElementById('out');
  function show(task) {
    out.textContent = '';
    var ok = document.createElement('div'); ok.className = 'ok';
    ok.textContent = '✓ Received from LifeMail' + (task.destination ? ' → dropped on “' + task.destination + '”' : '');
    out.appendChild(ok);
    var table = document.createElement('table');
    var rows = [['Task title', task.title], ['Project', task.project], ['Due', task.due], ['Priority', task.priority], ['Destination', task.destination],
      ['Notes', task.notes], ['Provider', task.provider], ['Account', task.account], ['Sender', (task.senderName ? task.senderName + ' ' : '') + (task.senderEmail ? '<' + task.senderEmail + '>' : '')],
      ['Subject', task.subject], ['Email date', task.emailDate], ['Message ID', task.messageId], ['Thread ID', task.threadId],
      ['Email URL', task.emailUrl, true], ['Open in LifeMail', task.lifemailUrl, true], ['Preview', task.preview], ['Attachments', (task.attachments || []).join(', ')]];
    rows.forEach(function (r) {
      var tr = document.createElement('tr'); var a = document.createElement('td'); var b = document.createElement('td');
      a.textContent = r[0];
      if (r[2] && r[1]) { var l = document.createElement('a'); l.href = r[1]; l.textContent = 'Open ↗'; l.target = '_blank'; l.rel = 'noopener'; b.appendChild(l); }
      else b.textContent = r[1] || '—';
      tr.appendChild(a); tr.appendChild(b); table.appendChild(tr);
    });
    out.appendChild(table);
    window.__lastTask = task; // for automated tests
  }
  LifeMailReceiver.init({ onTask: show, wholePage: true });
  LifeMailReceiver.dropZone(document.getElementById('z-today'), { destination: 'today' });
  LifeMailReceiver.dropZone(document.getElementById('z-tomorrow'), { destination: 'tomorrow' });
  LifeMailReceiver.dropZone(document.getElementById('z-waiting'), { destination: 'waiting' });
})();
