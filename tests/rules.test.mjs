// Run: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRule, validateRule, evaluateRule, planForEmail, planChanges, parseRuleSentence, rulesNeedFullEmail, summarizeRule } from '../js/rules-engine.js';

const gsiRule = normalizeRule({ name: 'GSI Work Emails', conditions: [{ field: 'fromDomain', op: 'contains', value: '@gsi.gov.in' }], actions: [{ type: 'applyLabel', label: 'GSI Mail' }] });
const ngdrRule = normalizeRule({ name: 'NGDR Emails', conditions: [{ field: 'subject', op: 'contains', value: 'NGDR' }], actions: [{ type: 'applyLabel', label: 'NGDR' }] });
const email = (o = {}) => ({ from: 'A B <abc@gsi.gov.in>', fromEmail: 'abc@gsi.gov.in', to: 'me@gmail.com', cc: '', subject: 'NGDR Meeting', body: 'Please see the BISAG note', attachments: [], hasAttachment: false, labels: [], systemLabels: ['INBOX', 'UNREAD'], ...o });

test('one email matching two rules gets BOTH labels', () => {
  const p = planForEmail([gsiRule, ngdrRule], email());
  assert.deepEqual(p.addLabels, ['GSI Mail', 'NGDR']);
  assert.equal(p.matched.length, 2);
});

test('a label the email already has is not added again', () => {
  const p = planForEmail([gsiRule, ngdrRule], email({ labels: ['ngdr'] }));
  assert.deepEqual(p.addLabels, ['GSI Mail']);
});

test('no match → no change', () => {
  const p = planForEmail([gsiRule, ngdrRule], email({ fromEmail: 'x@gmail.com', from: 'x@gmail.com', subject: 'Lunch' }));
  assert.equal(planChanges(p), 0);
  assert.equal(p.matched.length, 0);
});

test('AND needs all conditions, OR needs one, and explanations are given', () => {
  const both = normalizeRule({ name: 'x', logic: 'AND', conditions: [{ field: 'fromDomain', op: 'contains', value: 'gsi.gov.in' }, { field: 'subject', op: 'contains', value: 'budget' }], actions: [{ type: 'star' }] });
  const r = evaluateRule(both, email());
  assert.equal(r.matched, false);
  assert.deepEqual(r.checks.map((c) => c.ok), [true, false]);
  assert.match(r.checks[0].text, /From domain contains “gsi.gov.in”/);
  assert.equal(evaluateRule({ ...both, logic: 'OR' }, email()).matched, true);
});

test('domain matching: @ is optional, "is exactly" also accepts sub-domains, case-insensitive', () => {
  const r = (op, value, from) => evaluateRule(normalizeRule({ name: 'd', conditions: [{ field: 'fromDomain', op, value }], actions: [{ type: 'star' }] }), email({ fromEmail: from, from })).matched;
  assert.equal(r('contains', 'GSI.GOV.IN', 'a@gsi.gov.in'), true);
  assert.equal(r('equals', '@gsi.gov.in', 'a@nic.gsi.gov.in'), true);
  assert.equal(r('equals', 'gsi.gov.in', 'a@notgsi.gov.in'), false);
  assert.equal(r('contains', 'gsi.gov.in', 'gsi.gov.in.fake@evil.com'), false); // the domain is evil.com
});

test('comma = alternatives; "does not contain" means none of them', () => {
  const mk = (op) => normalizeRule({ name: 'a', conditions: [{ field: 'subject', op, value: 'budget, NGDR' }], actions: [{ type: 'star' }] });
  assert.equal(evaluateRule(mk('contains'), email()).matched, true);
  assert.equal(evaluateRule(mk('notContains'), email()).matched, false);
  assert.equal(evaluateRule(mk('notContains'), email({ subject: 'hello' })).matched, true);
});

test('to, cc, body, attachments', () => {
  const r = (field, op, value, o) => evaluateRule(normalizeRule({ name: 'a', conditions: [{ field, op, value }], actions: [{ type: 'star' }] }), email(o)).matched;
  assert.equal(r('cc', 'contains', 'director', { cc: 'Director <director@gsi.gov.in>' }), true);
  assert.equal(r('body', 'contains', 'bisag'), true);
  assert.equal(r('attachmentName', 'endsWith', '.pdf', { attachments: ['Lot-15.csv', 'Report.PDF'] }), true);
  assert.equal(r('attachmentName', 'endsWith', '.pdf', { attachments: ['Lot-15.csv'] }), false);
  assert.equal(r('hasAttachment', 'is', true, { attachments: ['x.pdf'] }), true);
  assert.equal(r('hasAttachment', 'is', false, { attachments: ['x.pdf'] }), false);
});

test('actions: important / read / star / archive only change what is needed; later rule wins', () => {
  const a = normalizeRule({ name: 'a', conditions: [{ field: 'subject', op: 'contains', value: 'ngdr' }], actions: [{ type: 'markRead' }, { type: 'star' }, { type: 'archive' }, { type: 'markImportant' }, { type: 'applyLabel', label: 'X' }] });
  const p = planForEmail([a], email({ systemLabels: ['INBOX', 'UNREAD', 'IMPORTANT'] }));
  assert.deepEqual(p.removeSystem.sort(), ['INBOX', 'UNREAD']);
  assert.deepEqual(p.addSystem, ['STARRED']);
  const b = normalizeRule({ name: 'b', conditions: [{ field: 'subject', op: 'contains', value: 'meeting' }], actions: [{ type: 'removeLabel', label: 'x' }] });
  const p2 = planForEmail([a, b], email({ labels: ['X'] }));
  assert.deepEqual(p2.removeLabels, ['x']);
  assert.deepEqual(p2.addLabels, []);
});

test('disabled rules, account-limited rules and activation date are respected', () => {
  assert.equal(planForEmail([{ ...gsiRule, enabled: false }], email()).matched.length, 0);
  assert.equal(planForEmail([{ ...gsiRule, account: 'work@x.in' }], email(), { account: 'me@gmail.com' }).matched.length, 0);
  assert.equal(planForEmail([{ ...gsiRule, account: 'ME@gmail.com' }], email(), { account: 'me@gmail.com' }).matched.length, 1);
  const later = { ...gsiRule, activatedAt: Date.now() };
  assert.equal(planForEmail([later], email({ date: Date.now() - 86400_000 }), { respectActivation: true }).matched.length, 0);
  assert.equal(planForEmail([later], email({ date: Date.now() - 86400_000 })).matched.length, 1); // manual runs ignore it
});

test('normalize and validate: there is no delete action; empty values dropped; duplicates removed', () => {
  const r = normalizeRule({ name: ' ', conditions: [{ field: 'subject', op: 'contains', value: '' }], actions: [{ type: 'delete' }, { type: 'applyLabel', label: '' }, { type: 'star' }, { type: 'star' }] });
  assert.deepEqual(r.actions, [{ type: 'star' }]);
  assert.equal(r.conditions.length, 0);
  assert.equal(validateRule(r).length, 2);
  assert.equal(validateRule(gsiRule).length, 0);
});

test('only rules about email text / attachment names need the full email', () => {
  assert.equal(rulesNeedFullEmail([gsiRule, ngdrRule]), false);
  assert.equal(rulesNeedFullEmail([normalizeRule({ name: 'b', conditions: [{ field: 'body', op: 'contains', value: 'x' }], actions: [{ type: 'star' }] })]), true);
});

test('summary reads like a sentence', () => {
  assert.deepEqual(summarizeRule(gsiRule), { when: 'From domain contains “@gsi.gov.in”', then: 'Label “GSI Mail”' });
});

test('quick fill from a sentence (no AI)', () => {
  const a = parseRuleSentence('Create a rule for all emails from GSI and label them GSI Mail', ['GSI Mail']);
  assert.deepEqual(a.conditions, [{ field: 'from', op: 'contains', value: 'GSI' }]);
  assert.deepEqual(a.actions, [{ type: 'applyLabel', label: 'GSI Mail' }]);
  const b = parseRuleSentence('emails from @gsi.gov.in with subject containing NGDR label them NGDR');
  assert.deepEqual(b.conditions, [{ field: 'fromDomain', op: 'contains', value: '@gsi.gov.in' }, { field: 'subject', op: 'contains', value: 'NGDR' }]);
  assert.deepEqual(b.actions, [{ type: 'applyLabel', label: 'NGDR' }]);
  const c = parseRuleSentence('mail from bisag-n.gov.in with attachments, label "Finance" and star');
  assert.equal(c.conditions[0].field, 'fromDomain');
  assert.equal(c.conditions.at(-1).field, 'hasAttachment');
  assert.deepEqual(c.actions, [{ type: 'applyLabel', label: 'Finance' }, { type: 'star' }]);
  assert.equal(parseRuleSentence('hello'), null);
});
