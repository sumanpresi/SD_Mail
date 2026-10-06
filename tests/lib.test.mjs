// Unit tests for the pure logic. Run:  node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/lib.js';

const email = {
  provider: 'gmail', account: 'suman@gmail.com', messageId: '18c1', threadId: '18c0', rfcMessageId: '<abc@mail.example>',
  subject: 'NGDR Portal API issue', from: { name: 'Rakesh Patel', email: 'rakesh@bisag-n.example' }, date: Date.UTC(2026, 9, 6, 5, 0),
  snippet: 'Please share the list by Friday', attachmentNames: ['log.txt'],
};

test('base64url round trip incl. Unicode', () => {
  const s = 'नमस्ते — NGDR ✓ "quotes" & <tags>';
  assert.equal(L.decodeB64Url(L.encodeB64Url(s)), s);
  assert.ok(!/[+/=]/.test(L.encodeB64Url(s + '???>>>')));
});

test('address parsing', () => {
  assert.deepEqual(L.parseAddress('"Patel, Rakesh" <Rakesh@X.org>'), { name: 'Patel, Rakesh', email: 'rakesh@x.org' });
  assert.deepEqual(L.parseAddress('a@b.co'), { name: 'a@b.co', email: 'a@b.co' });
  assert.deepEqual(L.splitAddressList('"Patel, Rakesh" <r@x.org>, b@y.org; c@z.org'), ['"Patel, Rakesh" <r@x.org>', 'b@y.org', 'c@z.org']);
  assert.ok(L.isValidEmail('name@gsi.gov.in'));
  assert.ok(!L.isValidEmail('not an email'));
});

test('payload carries everything LifeOS needs and no secrets', () => {
  const p = L.createTaskPayload(email, { title: 'Send report list', due: '2026-10-09', priority: 'high' }, 'https://lifemail.example');
  for (const k of ['source', 'provider', 'account', 'messageId', 'threadId', 'subject', 'senderName', 'senderEmail', 'emailDate', 'emailUrl', 'lifemailUrl', 'preview', 'createdAt'])
    assert.ok(p[k], 'missing ' + k);
  assert.equal(p.createdFromEmail, true);
  assert.equal(p.task.title, 'Send report list');
  assert.match(p.emailUrl, /^https:\/\/mail\.google\.com\/mail\/\?authuser=suman%40gmail\.com#search\/rfc822msgid%3Aabc%40mail\.example$/);
  assert.equal(p.lifemailUrl, 'https://lifemail.example/#open=suman%40gmail.com/18c0');
  assert.ok(!/token|password|secret/i.test(JSON.stringify(p)));
});

test('payload survives text, URL and validation round trips', () => {
  const p = L.createTaskPayload(email, { title: 'Follow up', priority: 'medium' });
  const text = L.payloadToText(p);
  assert.match(text, /Open email: https:\/\/mail\.google\.com/);
  assert.deepEqual(L.extractPayloadFromText(text).task.title, 'Follow up');
  const url = L.buildLifeOSUrl('https://lifeos.example/?lifemail={payload}', p);
  assert.equal(L.extractPayloadFromText(url).threadId, '18c0');
  assert.equal(L.buildLifeOSUrl('https://lifeos.example/app', p).startsWith('https://lifeos.example/app?lifemail='), true);
  assert.equal(L.buildLifeOSUrl('http://insecure.example/', p), '', 'non-https rejected');
  assert.equal(L.buildLifeOSUrl('javascript:alert(1)', p), '');
});

test('validation strips hostile input', () => {
  const evil = { v: 1, source: 'lifemail', subject: 'x'.repeat(5000), emailUrl: 'javascript:alert(1)', task: { title: 42, priority: 'urgent!!' }, extra: 'drop me' };
  const v = L.validatePayload(evil);
  assert.equal(v.subject.length, 300);
  assert.equal(v.emailUrl, '');
  assert.equal(v.task.priority, '');
  assert.equal(v.extra, undefined);
  assert.equal(L.validatePayload({ source: 'other', v: 1 }), null);
  assert.equal(L.decodePayload('%%%not-base64'), null);
});

test('deep link parsing is strict', () => {
  assert.deepEqual(L.parseOpenHash('#open=suman%40gmail.com/18c0abc'), { account: 'suman@gmail.com', threadId: '18c0abc' });
  assert.equal(L.parseOpenHash('#open=evil/../../x'), null);
  assert.equal(L.parseOpenHash('#open=notanemail/123'), null);
});

test('MIME message: headers, Unicode subject, attachments', () => {
  const mime = L.buildMime({ from: 'Suman <s@x.org>', to: 'A <a@x.org>, b@y.org', subject: 'Rapport — résumé', html: '<p>Hello <b>there</b></p>', inReplyTo: '<m1@x>', references: '<m0@x> <m1@x>',
    attachments: [{ filename: 'a.txt', mimeType: 'text/plain', base64: L.utf8ToB64('hi') }], boundarySeed: 't' });
  assert.match(mime, /^From: Suman <s@x\.org>\r\n/);
  assert.match(mime, /\r\nTo: A <a@x\.org>, b@y\.org\r\n/);
  assert.match(mime, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  assert.match(mime, /In-Reply-To: <m1@x>/);
  assert.match(mime, /multipart\/mixed; boundary="mix_t"/);
  assert.match(mime, /Content-Disposition: attachment; filename="a.txt"/);
  assert.match(mime, /--mix_t--/);
  const plain = L.buildMime({ from: 's@x.org', to: 'a@x.org', subject: 'Hi', text: 'Line' });
  assert.ok(!/multipart\/mixed/.test(plain));
});

test('Gmail payload walking finds html, text, attachments and inline images', () => {
  const enc = (s) => L.encodeB64Url(s);
  const payload = { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [{ mimeType: 'text/plain', body: { data: enc('plain') } }, { mimeType: 'text/html', body: { data: enc('<p>html</p>') } }] },
    { mimeType: 'application/pdf', filename: 'r.pdf', body: { attachmentId: 'A1', size: 2048 }, headers: [{ name: 'Content-Disposition', value: 'attachment' }] },
    { mimeType: 'image/png', filename: 'i.png', body: { attachmentId: 'A2', size: 10 }, headers: [{ name: 'Content-ID', value: '<img1>' }, { name: 'Content-Disposition', value: 'inline' }] },
  ] };
  const r = L.extractParts(payload);
  assert.equal(r.text, 'plain'); assert.equal(r.html, '<p>html</p>');
  assert.equal(r.attachments.length, 2);
  assert.equal(r.attachments[1].contentId, 'img1'); assert.equal(r.attachments[1].inline, true);
  assert.equal(r.attachments[0].inline, false);
});

test('folder mapping', () => {
  assert.deepEqual(L.folderQuery('inbox'), { labelIds: ['INBOX'], q: '', includeSpamTrash: false });
  assert.equal(L.folderQuery('trash').includeSpamTrash, true);
  assert.match(L.folderQuery('archive').q, /-in:inbox/);
  assert.equal(L.folderQuery('all', 'from:bisag').q, 'from:bisag');
});

test('on-device task suggestions', () => {
  const now = new Date(2026, 9, 6, 10); // Tuesday 6 Oct 2026
  const a = L.suggestTask({ subject: 'Re: Lot-15', body: 'Kindly share the list of failed reports by Friday.' }, now);
  assert.equal(a.title, 'Share the list of failed reports');
  assert.equal(a.due, '2026-10-09');
  assert.equal(a.priority, 'medium');
  const b = L.suggestTask({ subject: 'URGENT: data needed', body: 'Need it today' }, now);
  assert.equal(b.due, '2026-10-06'); assert.equal(b.priority, 'high');
  const c = L.suggestTask({ subject: 'Fwd: Newsletter', body: 'Hello' }, now);
  assert.deepEqual(c, { title: 'Newsletter', due: '', priority: '' });
  const d = L.suggestTask({ subject: 'x', body: 'please submit by 15/10/2026' }, now);
  assert.equal(d.due, '2026-10-15');
});

test('quiet hours across midnight', () => {
  const q = { enabled: true, start: '22:00', end: '07:00' };
  assert.equal(L.withinQuietHours(q, new Date(2026, 0, 1, 23, 0)), true);
  assert.equal(L.withinQuietHours(q, new Date(2026, 0, 1, 6, 59)), true);
  assert.equal(L.withinQuietHours(q, new Date(2026, 0, 1, 12, 0)), false);
  assert.equal(L.withinQuietHours({ ...q, enabled: false }, new Date(2026, 0, 1, 23, 0)), false);
});

test('html to text keeps table cells apart', () => {
  assert.equal(L.htmlToText('<table><tr><td>PNR</td><td>X7K</td></tr></table>'), 'PNR X7K');
});
