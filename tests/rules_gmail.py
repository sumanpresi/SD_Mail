"""Email rules + label management against a FAKE Gmail API — tests the real Gmail code paths (no network).
Run:  python3 -m http.server 8765   then   python3 tests/rules_gmail.py"""
import json, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765'
ME = 'suman.test@gmail.com'
calls = []; fails = []
state = {'history404': False, 'labels': [
    {'id': 'INBOX', 'name': 'INBOX', 'type': 'system'}, {'id': 'UNREAD', 'name': 'UNREAD', 'type': 'system'},
    {'id': 'Label_7', 'name': 'NGDR', 'type': 'user'}, {'id': 'Label_8', 'name': '[Airmail]', 'type': 'user'}, {'id': 'Label_9', 'name': '[Airmail]/To Do', 'type': 'user'}]}
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(extra)[:400] if extra and not cond else ''))
    if not cond: fails.append(name)

NOW = int(time.time() * 1000)
def msg(mid, frm, subj, labels, ago_min=1, mime='text/plain', to=ME):
    return {'id': mid, 'threadId': 't' + mid, 'labelIds': labels, 'snippet': subj, 'internalDate': str(NOW - ago_min * 60000),
            'payload': {'mimeType': mime, 'headers': [{'name': 'From', 'value': frm}, {'name': 'To', 'value': to}, {'name': 'Subject', 'value': subj}]}}
MSGS = {
    'm1': msg('m1', 'Director <director@gsi.gov.in>', 'NGDR Meeting', ['INBOX', 'UNREAD']),
    'm2': msg('m2', 'Friend <f@gmail.com>', 'Lunch', ['INBOX']),
    'm3': msg('m3', 'Me <' + ME + '>', 'NGDR reply I sent', ['SENT']),
    'm4': msg('m4', 'Ananya <ananya@gsi.gov.in>', 'Lot-15', ['INBOX', 'Label_7'], ago_min=60 * 24 * 3),
}

def handle(route):
    req = route.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    calls.append((req.method, path, q, req.post_data))
    if req.headers.get('authorization', '') != 'Bearer TESTTOKEN': return route.fulfill(status=401, body='{}')
    j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
    P = '/gmail/v1/users/me'
    if path == P + '/labels' and req.method == 'GET': return j({'labels': state['labels']})
    if path == P + '/labels' and req.method == 'POST':
        name = json.loads(req.post_data)['name']; l = {'id': 'Label_%d' % (100 + len(state['labels'])), 'name': name, 'type': 'user'}; state['labels'].append(l); return j(l)
    if path.startswith(P + '/labels/'):
        lid = path.rsplit('/', 1)[1]
        if lid == 'INBOX': return j({'id': 'INBOX', 'threadsUnread': 1})
        l = next((x for x in state['labels'] if x['id'] == lid), None)
        if not l: return j({'error': {'message': 'Not Found'}}, 404)
        if req.method == 'PATCH': l['name'] = json.loads(req.post_data)['name']; return j(l)
        if req.method == 'DELETE': state['labels'].remove(l); return route.fulfill(status=204, body='')
        return j({**l, 'messagesTotal': 12, 'threadsTotal': 9, 'threadsUnread': 2})
    if path == P + '/threads': return j({'threads': []})
    if path == P + '/profile': return j({'historyId': '500'})
    if path == P + '/history':
        if state['history404']: return j({'error': {'message': 'Requested entity was not found.'}}, 404)
        return j({'historyId': '510', 'history': [{'messagesAdded': [{'message': {'id': i, 'labelIds': MSGS[i]['labelIds']}} for i in ['m1', 'm2', 'm3']]}]})
    if path == P + '/messages': return j({'messages': [{'id': i} for i in MSGS]})
    if path.startswith(P + '/messages/') and path.count('/') == 6 and req.method == 'GET':
        return j(MSGS[path.rsplit('/', 1)[1]])
    if path == P + '/messages/batchModify':
        b = json.loads(req.post_data)
        for i in b['ids']: MSGS[i]['labelIds'] = [x for x in MSGS[i]['labelIds'] if x not in b['removeLabelIds']] + [x for x in b['addLabelIds'] if x not in MSGS[i]['labelIds']]
        return route.fulfill(status=204, body='')
    if 'drive' in path or 'upload' in path: return j({'files': []} if req.method == 'GET' else {'id': 'f1'})
    return route.fulfill(status=404, body='{"error":{"message":"not mocked: ' + path + '"}}')

RULES = [
    {'id': 'r1', 'name': 'GSI Work Emails', 'enabled': True, 'account': '', 'logic': 'AND', 'conditions': [{'field': 'fromDomain', 'op': 'contains', 'value': '@gsi.gov.in'}], 'actions': [{'type': 'applyLabel', 'label': 'GSI Mail'}], 'createdAt': NOW - 864e5 * 10, 'activatedAt': NOW - 864e5 * 10},
    {'id': 'r2', 'name': 'NGDR Emails', 'enabled': True, 'account': '', 'logic': 'AND', 'conditions': [{'field': 'subject', 'op': 'contains', 'value': 'NGDR'}], 'actions': [{'type': 'applyLabel', 'label': 'NGDR'}, {'type': 'markImportant'}], 'createdAt': NOW - 864e5 * 10, 'activatedAt': NOW - 864e5 * 10},
]

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 820})
    for host in ['https://gmail.googleapis.com/**', 'https://www.googleapis.com/**']: ctx.route(host, handle)
    ctx.add_init_script(f"""
      if (!localStorage.getItem('lm_seeded')) {{
        localStorage.setItem('lm_seeded','1');
        localStorage.setItem('lm_tokens_v1', JSON.stringify({{'{ME}': {{ token: 'TESTTOKEN', exp: Date.now() + 3600e3 }}}}));
        localStorage.setItem('lm_data_v1', JSON.stringify({{ schema: 1, updatedAt: Date.now(), storageAccount: '{ME}', rules: {json.dumps(RULES)},
          accounts: [{{ email: '{ME}', name: 'Suman Test', profile: 'personal', color: '#3a6ea5', signature: '', notify: true }}] }}));
        localStorage.setItem('lm_rules_state_v1', JSON.stringify({{'{ME}': {{ historyId: '400', at: Date.now() - 600000, done: [] }}}}));
      }}""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/js/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const CONFIG = { googleClientId: 'x.apps.googleusercontent.com', driveFileName: 'lifemail-data.json' };"))
    pg.goto(BASE + '/'); pg.wait_for_selector('.listpane', timeout=10000); pg.wait_for_timeout(2500)

    # --- new mail is processed automatically on open (catch-up) ---
    hist = [c for c in calls if c[1].endswith('/history')]
    check('catch-up asks Gmail history from the saved point', hist and hist[0][2].get('startHistoryId') == ['400'], hist[:1])
    created = [json.loads(c[3])['name'] for c in calls if c[1].endswith('/users/me/labels') and c[0] == 'POST']
    check('missing label "GSI Mail" created once', created == ['GSI Mail'], created)
    gsi = next(l['id'] for l in state['labels'] if l['name'] == 'GSI Mail')
    check('m1 (gsi + NGDR subject) got BOTH labels + important', gsi in MSGS['m1']['labelIds'] and 'Label_7' in MSGS['m1']['labelIds'] and 'IMPORTANT' in MSGS['m1']['labelIds'], MSGS['m1']['labelIds'])
    check('m2 (no match) untouched', MSGS['m2']['labelIds'] == ['INBOX'])
    check('m3 (sent by me) skipped', MSGS['m3']['labelIds'] == ['SENT'])
    fetched = [c[1].rsplit('/', 1)[1] for c in calls if '/users/me/messages/m' in c[1]]
    check('sent mail not even downloaded', 'm3' not in fetched, fetched)
    gets = [c for c in calls if c[1].endswith('/messages/m1')]
    check('headers only (no email text) when no rule needs it', gets and gets[0][2].get('format') == ['metadata'], gets[:1])
    bm = [json.loads(c[3]) for c in calls if c[1].endswith('/batchModify')]
    check('one batch request for the change', len(bm) == 1 and bm[0]['ids'] == ['m1'], bm)
    st = pg.evaluate("() => JSON.parse(localStorage.getItem('lm_rules_state_v1'))")
    check('processing marker moved forward', st[ME]['historyId'] == '510' and 'm1' in st[ME]['done'], st)
    log = pg.evaluate("async () => (await import('/js/core.js')).D().ruleLog")
    check('history log: 2 rules matched, success', len(log) == 2 and all(l['status'] == 'Success' and l['matched'] == 1 for l in log), log)

    # --- running again does not re-process the same emails ---
    n_bm = len([c for c in calls if c[1].endswith('/batchModify')])
    pg.evaluate("async () => (await import('/js/rules.js')).runRulesOnNew('" + ME + "')")
    check('same emails not processed twice', len([c for c in calls if c[1].endswith('/batchModify')]) == n_bm)

    # --- LifeMail closed for longer than Gmail keeps history: falls back to date search ---
    state['history404'] = True
    pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('lm_rules_state_v1')); s['" + ME + "'] = { historyId: '1', at: Date.now() - 864e5 * 9, done: [] }; localStorage.setItem('lm_rules_state_v1', JSON.stringify(s)); }")
    r = pg.evaluate("async () => { const x = await (await import('/js/rules.js')).runRulesOnNew('" + ME + "'); return { checked: x.checked, changed: x.changed }; }")
    lst = [c for c in calls if c[1].endswith('/users/me/messages') and c[0] == 'GET']
    check('history too old → searches by date', lst and lst[-1][2]['q'][0].startswith('after:'), lst[-1:] )
    check('fallback labels the older gsi email (m4)', gsi in MSGS['m4']['labelIds'], (r, MSGS['m4']['labelIds']))
    state['history404'] = False

    # --- a newly activated rule ignores email that arrived before it ---
    pg.evaluate("""async () => { const c = await import('/js/core.js'); c.S.store.update(d => { d.rules.push({ id: 'r3', name: 'Lunch', enabled: true, account: '', logic: 'AND', conditions: [{ field: 'subject', op: 'contains', value: 'Lunch' }], actions: [{ type: 'star' }], createdAt: Date.now(), activatedAt: Date.now() }); });
      const s = JSON.parse(localStorage.getItem('lm_rules_state_v1')); s['""" + ME + """'] = { historyId: '400', at: Date.now(), done: [] }; localStorage.setItem('lm_rules_state_v1', JSON.stringify(s)); }""")
    pg.evaluate("async () => (await import('/js/rules.js')).runRulesOnNew('" + ME + "')")
    check('new rule does not touch email from before it was activated', 'STARRED' not in MSGS['m2']['labelIds'], MSGS['m2']['labelIds'])

    # --- preview + apply on existing email (manual run ignores activation date) ---
    pv = pg.evaluate("""async () => { const r = await import('/js/rules.js'); const p = await r.previewExisting(r.allRules().filter(x => x.id === 'r3'), { days: 30 }); window.__pv = p; return { checked: p.checked, n: p.matches.length }; }""")
    check('preview: 3 received emails checked, 1 match, nothing changed yet', pv == {'checked': 3, 'n': 1} and 'STARRED' not in MSGS['m2']['labelIds'], pv)
    pg.evaluate("async () => (await import('/js/rules.js')).applyPreview(window.__pv)")
    check('apply after preview stars m2', 'STARRED' in MSGS['m2']['labelIds'])

    # --- label management through Gmail ---
    pg.evaluate("async () => { const r = await import('/js/rules.js'); await r.loadAllLabels(); await r.renameLabel('[Airmail]', 'Airmail'); }")
    names = sorted(l['name'] for l in state['labels'] if l['type'] == 'user')
    check('rename also renames sub-labels', 'Airmail' in names and 'Airmail/To Do' in names and '[Airmail]/To Do' not in names, names)
    pg.evaluate("async () => { const r = await import('/js/rules.js'); await r.renameLabel('GSI Mail', 'GSI Official'); }")
    check('rename updates rules that use it', pg.evaluate("async () => (await import('/js/core.js')).D().rules[0].actions[0].label") == 'GSI Official')
    cnt = pg.evaluate("async () => { const r = await import('/js/rules.js'); return r.labelCounts(r.labelCatalog().find(e => e.name === 'NGDR')); }")
    check('label counts come from Gmail', cnt == {'threads': 9, 'unread': 2}, cnt)
    off = pg.evaluate("async () => (await import('/js/rules.js')).deleteLabel('GSI Official')")
    check('delete removes label in Gmail', not any(l['name'] == 'GSI Official' for l in state['labels']) and any(c[0] == 'DELETE' for c in calls))
    check('delete switches off the rule that applied it', off == 1 and pg.evaluate("async () => (await import('/js/core.js')).D().rules[0].enabled") is False)
    check('emails themselves never deleted/trashed', not any('/trash' in c[1] or (c[0] == 'DELETE' and '/messages' in c[1]) for c in calls))

    # --- disconnected Gmail is reported, not silent ---
    pg.evaluate("() => { localStorage.setItem('lm_tokens_v1', '{}'); }")
    pg.evaluate("async () => { const c = await import('/js/core.js'); c.S.authNeeded.add('" + ME + "'); (await import('/js/settings.js')).openSettings('rules'); }")
    pg.wait_for_selector('.rule-card')
    check('rules screen says Gmail connection required', 'Gmail connection required' in pg.locator('.spanel').inner_text())

    check('no page errors', not errs, errs)
    b.close()

print('\n' + ('ALL PASSED' if not fails else f'{len(fails)} FAILED: {fails}'))
sys.exit(1 if fails else 0)
