"""Offline mail + search, end to end, against a FAKE Gmail API, switching the internet off and on.
Run:  python3 -m http.server 8765   then   python3 tests/offline.py [screenshot-dir/]"""
import json, sys, time, base64, re
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/'
ME = 'suman.test@gmail.com'
calls = []; fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(extra)[:400] if extra and not cond else ''))
    if not cond: fails.append(name)
b64u = lambda s: base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')
NOW = int(time.time() * 1000)
def msg(mid, tid, frm, subj, html, labels, days_ago=0.1, att=None):
    parts = [{'mimeType': 'text/html', 'body': {'data': b64u(html)}}]
    if att: parts.append({'mimeType': 'application/pdf', 'filename': att, 'body': {'attachmentId': 'att_' + mid, 'size': 2000}, 'headers': []})
    return {'id': mid, 'threadId': tid, 'labelIds': labels, 'snippet': re.sub('<[^>]+>', '', html)[:80], 'internalDate': str(int(NOW - days_ago * 864e5)), 'sizeEstimate': 4000,
            'historyId': '100', 'payload': {'mimeType': 'multipart/mixed', 'headers': [{'name': 'From', 'value': frm}, {'name': 'To', 'value': ME}, {'name': 'Subject', 'value': subj}, {'name': 'Message-ID', 'value': f'<{mid}@x>'}], 'parts': parts}}
M = {
    'm1': msg('m1', 't1', 'Rakesh Patel <rakesh@bisag-n.gov.in>', 'NGDR Portal API issue', '<p>We see intermittent 502 errors. Kindly share the Lot-15 report IDs by Friday.</p>', ['INBOX', 'UNREAD', 'Label_7'], 0.2, 'api-log.pdf'),
    'm2': msg('m2', 't2', 'Ananya Roy <ananya@gsi.gov.in>', 'Lot-15 summary', '<p>Please review the attached summary of the geochemical samples.</p>', ['INBOX'], 1),
    'm3': msg('m3', 't2', 'Suman <' + ME + '>', 'Re: Lot-15 summary', '<p>Thanks Ananya, numbers look right.</p>', ['SENT'], 0.9),
    'm4': msg('m4', 't4', 'Bank <statements@bank.example>', 'August statement', '<p>Your statement is ready.</p>', ['INBOX'], 40),
    'm5': msg('m5', 't5', 'Spammer <win@lottery.example>', 'You won', '<p>Claim now</p>', ['SPAM'], 0.5),
}
hist = {'id': 200, 'added': []}

def handle(route):
    req = route.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    calls.append((req.method, path, q, req.post_data))
    if req.headers.get('authorization', '') != 'Bearer TESTTOKEN': return route.fulfill(status=401, body='{}')
    j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
    P = '/gmail/v1/users/me'
    if path == P + '/labels': return j({'labels': [{'id': 'INBOX', 'name': 'INBOX', 'type': 'system'}, {'id': 'Label_7', 'name': 'NGDR', 'type': 'user'}]})
    if path == P + '/labels/INBOX': return j({'id': 'INBOX', 'threadsUnread': 1})
    if path == P + '/profile': return j({'historyId': str(hist['id'])})
    if path == P + '/history':
        out = {'historyId': str(hist['id'])}
        if hist['added']: out['history'] = [{'messagesAdded': [{'message': {'id': i, 'labelIds': M[i]['labelIds']}} for i in hist['added']]}]
        return j(out)
    if path == P + '/messages':
        qq = q.get('q', [''])[0]; days = int((re.search(r'newer_than:(\d+)d', qq) or [0, 3650])[1])
        ids = [m['id'] for m in M.values() if NOW - int(m['internalDate']) < days * 864e5 and not set(m['labelIds']) & {'SPAM', 'TRASH'}]
        return j({'messages': [{'id': i} for i in ids]})
    mm = re.match(P + r'/messages/(m\d+)$', path)
    if mm and req.method == 'GET': return j(M[mm.group(1)])
    if path == P + '/threads':
        lab = q.get('labelIds', [None])[0]; qq = q.get('q', [''])[0]
        ok = lambda m: ('filename:pdf' not in qq or 'parts' in m['payload'] and len(m['payload']['parts']) > 1)
        ts = sorted({m['threadId'] for m in M.values() if (not lab or lab in m['labelIds']) and 'SPAM' not in m['labelIds'] and ok(m)})
        return j({'threads': [{'id': t, 'historyId': '1'} for t in ts]})
    mt = re.match(P + r'/threads/(t\d+)$', path)
    if mt: return j({'id': mt.group(1), 'historyId': '1', 'messages': sorted([m for m in M.values() if m['threadId'] == mt.group(1)], key=lambda m: m['internalDate'])})
    if re.match(P + r'/threads/t\d+/modify$', path) or re.match(P + r'/messages/m\d+/modify$', path) or path.endswith('/batchModify'): return j({})
    if path == P + '/messages/send': return j({'id': 'sent1'})
    if 'attachments' in path: return j({'data': b64u('%PDF-1.4 fake')})
    if 'drive' in path or 'upload' in path: return j({'files': []} if req.method == 'GET' else {'id': 'f1'})
    return route.fulfill(status=404, body='{"error":{"message":"not mocked: ' + path + '"}}')

def local_count(pg):
    return pg.evaluate("async () => (await import('/js/offline.js')).localCount()")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 820})
    for host in ['https://gmail.googleapis.com/**', 'https://www.googleapis.com/**']: ctx.route(host, handle)
    ctx.add_init_script(f"""
      if (!localStorage.getItem('lm_seeded')) {{
        localStorage.setItem('lm_seeded','1');
        localStorage.setItem('lm_tokens_v1', JSON.stringify({{'{ME}': {{ token: 'TESTTOKEN', exp: Date.now() + 3600e3 }}}}));
        localStorage.setItem('lm_data_v1', JSON.stringify({{ schema: 1, updatedAt: Date.now(), storageAccount: '{ME}', accounts: [{{ email: '{ME}', name: 'Suman Test', profile: 'personal', color: '#3a6ea5', signature: '', notify: true }}] }}));
      }}""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/js/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const CONFIG = { googleClientId: 'x.apps.googleusercontent.com', driveFileName: 'lifemail-data.json' };"))
    pg.goto(BASE + '/'); pg.wait_for_selector('.row', timeout=10000)

    # ---- 1. first download (last 30 days by default) ----
    for _ in range(40):
        if local_count(pg) >= 3: break
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(500)
    check('downloads the last 30 days: inbox + sent (3 emails)', local_count(pg) == 3, local_count(pg))
    ids = pg.evaluate("async () => { const o = await import('/js/offline.js'); return (await o.localThreads('" + ME + "', { folderId: 'all' })).map(t => t.threadId); }")
    check('older than 30 days and spam are not downloaded', 't4' not in ids and 't5' not in ids, ids)
    full = [c for c in calls if re.search(r'/messages/m\d$', c[1]) and c[2].get('format') == ['full']]
    check('each email downloaded once, with its text', len(full) == 3, [c[1] for c in full])

    # ---- 2. search as you type (from the device, no Gmail search needed) ----
    n_before = len([c for c in calls if c[1].endswith('/messages') or c[1].endswith('/threads')])
    pg.click('#search'); pg.wait_for_selector('.suggest')
    check('empty search box shows search tips', 'search words' in pg.locator('.suggest').inner_text().lower())
    pg.keyboard.type('geochem', delay=30); pg.wait_for_timeout(700)
    rows = pg.locator('.row').all_inner_texts()
    check('typing finds a word inside the email text', len(rows) == 1 and 'Lot-15 summary' in rows[0], rows)
    check('no Gmail call while typing', len([c for c in calls if c[1].endswith('/messages') or c[1].endswith('/threads')]) == n_before)
    check('searched word is highlighted', pg.locator('.row mark').count() >= 1)
    pg.fill('#search', ''); pg.keyboard.type('anan', delay=30); pg.wait_for_timeout(500)
    sg = pg.locator('.suggest').inner_text()
    check('people suggestions while typing', 'Ananya Roy' in sg and 'ananya@gsi.gov.in' in sg, sg)
    pg.locator('.sg-item', has_text='Ananya Roy').click(); pg.wait_for_timeout(900)
    check('choosing a person searches from: them', pg.input_value('#search') == 'from:ananya@gsi.gov.in' and 'Lot-15 summary' in pg.inner_text('#list'))
    check('filter chips shown while searching', pg.locator('.schip').count() >= 5)
    pg.locator('.schip', has_text='Attachment').click(); pg.wait_for_timeout(900)
    check('chip adds has:attachment', 'has:attachment' in pg.input_value('#search'))
    pg.fill('#search', 'filename:pdf'); pg.keyboard.press('Enter'); pg.wait_for_timeout(900)
    check('Gmail-style search words work (filename:pdf)', 'NGDR Portal API' in pg.inner_text('#list') and pg.locator('.row').count() == 1, (pg.input_value('#search'), pg.inner_text('#list')[:300]))
    pg.screenshot(path=OUT + 'offline-search.png')
    pg.click('[data-act="clear-search"]'); pg.wait_for_timeout(600)

    # ---- 3. no internet ----
    ctx.set_offline(True); pg.wait_for_timeout(900)
    check('offline: inbox still shows', 'NGDR Portal API' in pg.inner_text('#list') and 'Lot-15 summary' in pg.inner_text('#list'), pg.inner_text('#list')[:200])
    check('offline: status says email is from this device', 'Offline' in pg.inner_text('#lstatus') and 'saved on this device' in pg.inner_text('#lstatus'), pg.inner_text('#lstatus'))
    pg.locator('.row', has_text='Lot-15 summary').click(); pg.wait_for_timeout(900)
    check('offline: conversation opens with both messages', pg.locator('.msg').count() == 2, pg.locator('.msg').count())
    fr = pg.frame_locator('.mframe').last
    check('offline: email text readable', 'numbers look right' in fr.locator('body').inner_text())
    pg.screenshot(path=OUT + 'offline-read.png')
    pg.fill('#search', 'from:rakesh friday'); pg.keyboard.press('Enter'); pg.wait_for_timeout(700)
    check('offline: search works', 'NGDR Portal API' in pg.inner_text('#list') and pg.locator('.row').count() == 1)
    pg.click('[data-act="clear-search"]'); pg.wait_for_timeout(600)
    # attachment not yet opened → clear message
    pg.locator('.row', has_text='NGDR Portal API').click(); pg.wait_for_timeout(900)
    pg.locator('[data-a=att-save]').first.click(); pg.wait_for_timeout(500)
    check('offline: unopened attachment explains why', 'not been downloaded' in pg.inner_text('#toasts'), pg.inner_text('#toasts'))
    # changes while offline
    pg.click('#reader [data-a="archive"]'); pg.wait_for_timeout(600)
    check('offline: archive removes it from Inbox', 'NGDR Portal API' not in pg.inner_text('#list'))
    pg.evaluate("async () => (await import('/js/core.js')).provider('" + ME + "').send('To: a@b.c\\r\\nSubject: hi\\r\\n\\r\\nhello', null)")
    pg.wait_for_timeout(600)
    pend = pg.evaluate("async () => (await import('/js/offline.js')).pendingChanges()")
    check('offline: changes wait in the outbox (archive + read + send)', [x['op'] for x in pend] == ['modifyThread', 'modifyThread', 'modifyThread', 'send'] or (len(pend) >= 2 and pend[-1]['op'] == 'send'), [x['op'] for x in pend])
    check('offline: status shows waiting changes', 'waiting to be sent' in pg.inner_text('#lstatus'), pg.inner_text('#lstatus'))
    # the archived thread stays archived in the device copy after reopening the folder
    pg.click('[data-folder="archive"]'); pg.wait_for_timeout(600)
    check('offline: archived email appears in Archive', 'NGDR Portal API' in pg.inner_text('#list'))
    pg.click('[data-folder="inbox"]'); pg.wait_for_timeout(400)
    pg.screenshot(path=OUT + 'offline-inbox.png')

    # ---- 4. back online: outbox goes to Gmail ----
    n_mod = len([c for c in calls if c[1].endswith('/modify')])
    ctx.set_offline(False); pg.wait_for_timeout(2500)
    mods = [c for c in calls if c[1].endswith('/modify')][n_mod:]
    check('online again: archive sent to Gmail', any('INBOX' in (c[3] or '') and c[1].endswith('/threads/t1/modify') for c in mods), [(c[1], c[3]) for c in mods])
    check('online again: queued email sent', any(c[1].endswith('/messages/send') for c in calls))
    check('outbox empty', pg.evaluate("async () => (await import('/js/offline.js')).pendingChanges()") == [])
    check('told the user', 'offline change' in pg.inner_text('#toasts'), pg.inner_text('#toasts'))

    # ---- 5. new mail arrives: only the change is fetched ----
    M['m6'] = msg('m6', 't6', 'Director <director@gsi.gov.in>', 'Review meeting Thursday', '<p>Bring the lot-wise upload summary.</p>', ['INBOX', 'UNREAD'], 0.01)
    hist['id'] = 201; hist['added'] = ['m6']
    n_list = len([c for c in calls if c[1].endswith('/users/me/messages')])
    pg.evaluate("async () => { const c = await import('/js/core.js'); const o = await import('/js/offline.js'); await o.syncAccount('" + ME + "', c.provider('" + ME + "').inner); }")
    check('new email added to the device copy', local_count(pg) == 4, local_count(pg))
    check('update used history only (no full re-listing)', len([c for c in calls if c[1].endswith('/users/me/messages')]) == n_list)

    # ---- 6. settings ----
    pg.evaluate("async () => (await import('/js/settings.js')).openSettings('offline')"); pg.wait_for_selector('#off-stats b'); pg.wait_for_timeout(800)
    st = pg.locator('#off-stats').inner_text()
    check('settings show saved emails', 'SAVED EMAILS' in st.upper() and '4' in st, st)
    pg.screenshot(path=OUT + 'offline-settings.png')
    pg.click('#off-clear'); pg.locator('.scrim').last.locator('[data-ok]').click(); pg.wait_for_timeout(800)
    check('remove from device works', local_count(pg) == 0)

    # ---- 7. phone layout of suggestions ----
    pg.locator('.scrim [data-close]').first.click()
    pg.set_viewport_size({'width': 380, 'height': 800}); pg.wait_for_timeout(400)
    pg.click('#search'); pg.wait_for_selector('.suggest')
    over = pg.evaluate("() => [...document.querySelectorAll('.suggest, .suggest *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length")
    check('phone: suggestions fit the screen', over == 0, over)
    pg.screenshot(path=OUT + 'offline-phone-suggest.png')

    check('no page errors', not errs, errs)
    b.close()

print('\n' + ('ALL PASSED' if not fails else f'{len(fails)} FAILED: {fails}'))
sys.exit(1 if fails else 0)
