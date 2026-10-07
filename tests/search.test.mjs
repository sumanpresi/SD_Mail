import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery, matches, excerpt, groupThreads, peopleIndex, suggestPeople } from '../js/search.js';

const NOW = new Date(2026, 9, 7, 12).getTime();
const doc = (o = {}) => ({ account: 'me@gmail.com', id: 'm1', threadId: 't1', date: new Date(2026, 9, 5).getTime(), labelIds: ['INBOX', 'UNREAD', 'Label_7'],
  fromName: 'Rakesh Patel', fromEmail: 'rakesh.patel@bisag-n.gov.in', to: 'Suman <me@gmail.com>', cc: 'Director <director@gsi.gov.in>',
  subject: 'NGDR Portal API issue', body: 'We have observed intermittent 502 errors on the reports API. Kindly share the Lot-15 report IDs by Friday.', files: ['api-error-log.txt'], hasAtt: true, size: 52000, ...o });
const names = () => ['NGDR', 'Follow Up'];
const m = (q, d = doc()) => matches(d, parseQuery(q, NOW), names);

test('plain words: all must appear (anywhere, any case, part of word)', () => {
  assert.equal(m('ngdr friday'), true);
  assert.equal(m('ngdr budget'), false);
  assert.equal(m('intermit'), true);
  assert.equal(m('RAKESH'), true);
});
test('exact phrase and exclude', () => {
  assert.equal(m('"report IDs"'), true);
  assert.equal(m('"IDs report"'), false);
  assert.equal(m('ngdr -budget'), true);
  assert.equal(m('ngdr -friday'), false);
  assert.equal(m('-from:bisag-n'), false);
});
test('OR', () => {
  assert.equal(m('budget OR friday'), true);
  assert.equal(m('budget OR holiday'), false);
  assert.equal(m('from:nobody OR from:rakesh'), true);
});
test('fields', () => {
  assert.equal(m('from:rakesh'), true);
  assert.equal(m('from:bisag-n.gov.in'), true);
  assert.equal(m('from:director'), false);
  assert.equal(m('to:director'), true); // to: also covers cc (like Gmail)
  assert.equal(m('cc:gsi.gov.in'), true);
  assert.equal(m('subject:portal'), true);
  assert.equal(m('subject:friday'), false);
  assert.equal(m('subject:(portal api)'), true);
  assert.equal(m('filename:log'), true);
  assert.equal(m('filename:pdf'), false);
  assert.equal(m('has:attachment'), true);
  assert.equal(m('has:attachments', doc({ files: [], hasAtt: false })), false);
  assert.equal(m('label:ngdr'), true);
  assert.equal(m('label:follow-up'), true);
  assert.equal(m('label:finance'), false);
  assert.equal(m('is:unread'), true);
  assert.equal(m('is:read'), false);
  assert.equal(m('is:starred'), false);
});
test('folders: spam and trash hidden unless asked', () => {
  assert.equal(m('in:inbox'), true);
  assert.equal(m('in:sent'), false);
  assert.equal(m('ngdr', doc({ labelIds: ['TRASH'] })), false);
  assert.equal(m('in:trash ngdr', doc({ labelIds: ['TRASH'] })), true);
  assert.equal(m('in:anywhere ngdr', doc({ labelIds: ['SPAM'] })), true);
  assert.equal(m('in:archive', doc({ labelIds: ['Label_7'] })), true);
});
test('dates: Gmail style and Indian day/month/year, ages, sizes', () => {
  assert.equal(m('after:2026/10/01'), true);
  assert.equal(m('before:2026/10/01'), false);
  assert.equal(m('after:01/10/2026'), true); // 1 October 2026
  assert.equal(m('before:06/10/2026'), true);
  assert.equal(m('newer_than:7d'), true);
  assert.equal(m('older_than:1d'), true);
  assert.equal(m('newer_than:1d'), false);
  assert.equal(m('larger:40K'), true);
  assert.equal(m('larger:1M'), false);
  assert.equal(m('smaller:1M'), true);
});
test('unknown "word:" is searched as text; empty query', () => {
  assert.equal(m('api:'), false);
  assert.equal(parseQuery('').empty, true);
  assert.equal(m(''), true);
});
test('excerpt shows the text around the searched word', () => {
  const e = excerpt(doc(), parseQuery('friday'));
  assert.match(e, /by Friday/);
  assert.ok(e.startsWith('…'));
});
test('group into conversations, newest first', () => {
  const g = groupThreads([doc({ id: 'a', threadId: 'x', date: 1 }), doc({ id: 'b', threadId: 'y', date: 5 }), doc({ id: 'c', threadId: 'x', date: 9 })]);
  assert.deepEqual(g.map((t) => t.map((d) => d.id)), [['a', 'c'], ['b']]);
});
test('people suggestions ranked, without me', () => {
  const ppl = peopleIndex([doc(), doc({ fromName: 'Ananya Roy', fromEmail: 'ananya@gsi.gov.in' }), doc({ fromName: 'Ananya Roy', fromEmail: 'ananya@gsi.gov.in' })], ['me@gmail.com']);
  assert.equal(ppl[0].email, 'ananya@gsi.gov.in');
  assert.ok(!ppl.some((p) => p.email === 'me@gmail.com'));
  assert.equal(suggestPeople(ppl, 'ana')[0].name, 'Ananya Roy');
  assert.equal(suggestPeople(ppl, 'pat')[0].email, 'rakesh.patel@bisag-n.gov.in');
});
