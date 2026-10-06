"""Tests the REAL Gmail + Google Drive code paths against a fake Google API (no network needed).
Run:  python3 -m http.server 8765   then   python3 tests/gmail_mock.py"""
import json, base64, sys, time
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8765'
ME = 'suman.test@gmail.com'
calls = []
drive = {'file': None, 'id': 'drvfile1'}
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(extra)[:300] if extra and not cond else ''))
    if not cond: fails.append(name)
def b64u(s): return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')

THREAD = {'id': 't1', 'historyId': '100', 'messages': [{
    'id': 'm1', 'threadId': 't1', 'labelIds': ['INBOX', 'UNREAD', 'Label_7'], 'snippet': 'Please send the report by Friday', 'internalDate': str(int(time.time() * 1000)),
    'payload': {'mimeType': 'multipart/mixed', 'headers': [
        {'name': 'From', 'value': 'Rakesh <rakesh@bisag-n.example>'}, {'name': 'To', 'value': ME}, {'name': 'Subject', 'value': 'NGDR API'},
        {'name': 'Message-ID', 'value': '<abc123@bisag-n.example>'}, {'name': 'Date', 'value': 'Tue, 6 Oct 2026 10:00:00 +0530'}],
        'parts': [{'mimeType': 'text/html', 'body': {'data': b64u('<p>Please send the report by Friday.</p>')}},
                  {'mimeType': 'application/pdf', 'filename': 'r.pdf', 'body': {'attachmentId': 'att1', 'size': 1234}, 'headers': []}]}}]}

def handle(route):
    req = route.request; u = urlparse(req.url); path = u.path; q = parse_qs(u.query)
    auth = req.headers.get('authorization', '')
    calls.append((req.method, path, q, req.post_data))
    if auth != 'Bearer TESTTOKEN':
        return route.fulfill(status=401, body='{}')
    j = lambda o, st=200: route.fulfill(status=st, content_type='application/json', body=json.dumps(o))
    if 'oauth2/v3/userinfo' in path: return j({'email': ME, 'name': 'Suman Test'})
    if path.endswith('/users/me/labels/INBOX'): return j({'id': 'INBOX', 'threadsUnread': 1})
    if path.endswith('/users/me/labels'):
        if req.method == 'POST': return j({'id': 'Label_99', 'name': json.loads(req.post_data)['name']})
        return j({'labels': [{'id': 'INBOX', 'name': 'INBOX', 'type': 'system'}, {'id': 'Label_7', 'name': 'NGDR', 'type': 'user'}]})
    if path.endswith('/users/me/threads'): return j({'threads': [{'id': 't1', 'historyId': '100'}], 'resultSizeEstimate': 1})
    if path.endswith('/users/me/threads/t1'): return j(THREAD)
    if path.endswith('/threads/t1/modify'): return j({'id': 't1'})
    if path.endswith('/messages/m1/modify'): return j({'id': 'm1'})
    if path.endswith('/messages/send'): return j({'id': 'sent1', 'threadId': 't1'})
    if path.endswith('/users/me/profile'): return j({'historyId': '100'})
    if path.endswith('/users/me/history'): return j({'historyId': '101'})
    if path.endswith('/attachments/att1'): return j({'data': b64u('%PDF-1.4 test')})
    # Drive appData
    if path == '/drive/v3/files' and req.method == 'GET':
        return j({'files': [{'id': drive['id']}] if drive['file'] else []})
    if path == f"/drive/v3/files/{drive['id']}": return route.fulfill(status=200, content_type='application/json', body=drive['file'] or '{}')
    if path == '/upload/drive/v3/files' and req.method == 'POST':
        drive['file'] = req.post_data.split('\r\n\r\n')[2].rsplit('\r\n--', 1)[0]; drive['meta'] = req.post_data
        return j({'id': drive['id']})
    if path == f"/upload/drive/v3/files/{drive['id']}" and req.method == 'PATCH':
        drive['file'] = req.post_data; return j({'id': drive['id']})
    return route.fulfill(status=404, body='{"error":{"message":"not mocked: ' + path + '"}}')

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 820})
    for host in ['https://gmail.googleapis.com/**', 'https://www.googleapis.com/**', 'https://oauth2.googleapis.com/**']:
        ctx.route(host, handle)
    ctx.add_init_script(f"""
      if (!localStorage.getItem('lm_seeded')) {{
        localStorage.setItem('lm_seeded','1');
        localStorage.setItem('lm_tokens_v1', JSON.stringify({{'{ME}': {{ token: 'TESTTOKEN', exp: Date.now() + 3600e3 }}}}));
        localStorage.setItem('lm_data_v1', JSON.stringify({{ schema: 1, updatedAt: 5, storageAccount: '{ME}', accounts: [{{ email: '{ME}', name: 'Suman Test', profile: 'personal', color: '#3a6ea5', signature: 'Suman', notify: true }}] }}));
      }}""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route('**/js/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const CONFIG = { googleClientId: 'x.apps.googleusercontent.com', driveFileName: 'lifemail-data.json' };"))
    pg.goto(BASE + '/'); pg.wait_for_selector('.row', timeout=10000)
    check('real mode: no DEMO badge', pg.locator('.demo-badge').count() == 0)
    check('Gmail thread listed', 'NGDR API' in pg.inner_text('.row'))
    check('Gmail label shown as chip', pg.locator('.row .chip', has_text='NGDR').count() == 1)
    lst = [c for c in calls if c[1].endswith('/users/me/threads')]
    check('list asked Gmail for INBOX only, paged', lst and lst[0][2].get('labelIds') == ['INBOX'] and lst[0][2].get('maxResults') == ['25'], lst[:1])
    pg.wait_for_timeout(2500)
    check('Drive: data file created in appDataFolder', drive['file'] and "appDataFolder" in drive.get('meta', ''), drive.get('meta', '')[:200])
    check('Drive: file contains settings, not tokens', drive['file'] and ME in drive['file'] and 'TESTTOKEN' not in drive['file'])

    pg.click('.row'); pg.wait_for_timeout(800)
    check('opening marks read via Gmail modify', any(c[1].endswith('/threads/t1/modify') and 'UNREAD' in (c[3] or '') for c in calls))
    check('attachment listed', pg.locator('.att', has_text='r.pdf').count() == 1)
    with pg.expect_download() as dl:
        pg.click('[data-a=att-save]')
    check('attachment downloads on demand', dl.value.suggested_filename == 'r.pdf')

    # Task link is saved to Drive
    pg.click('.taskbtn'); pg.wait_for_selector('#tk-copy')
    ctx.grant_permissions(['clipboard-read', 'clipboard-write'])
    pg.click('#tk-copy'); pg.wait_for_timeout(2500)
    check('task link synced to Drive', drive['file'] and '"taskLinks":[{' in drive['file'].replace(' ', ''), (drive['file'] or '')[:200])
    check('LifeOS label created + applied in Gmail', any(c[1].endswith('/users/me/labels') and c[0] == 'POST' for c in calls) and any('Label_99' in (c[3] or '') for c in calls))

    # reply → messages.send with thread id and proper headers
    pg.locator('.quick-reply [data-a=reply]').click(); pg.wait_for_selector('#c-body')
    pg.click('[data-send]'); pg.wait_for_timeout(800)
    send = [c for c in calls if c[1].endswith('/messages/send')]
    ok = False
    if send:
        body = json.loads(send[0][3]); raw = base64.urlsafe_b64decode(body['raw'] + '==').decode()
        ok = body.get('threadId') == 't1' and 'In-Reply-To: <abc123@bisag-n.example>' in raw and 'To: Rakesh <rakesh@bisag-n.example>' in raw and 'Subject: Re: NGDR API' in raw
    check('reply sent in-thread with correct headers', ok, send[:1])

    # archive → remove INBOX
    pg.click('.row'); pg.wait_for_timeout(500)
    pg.click('[data-a=archive]'); pg.wait_for_timeout(500)
    check('archive removes INBOX label', any(c[1].endswith('/threads/t1/modify') and '"removeLabelIds":["INBOX"]' in (c[3] or '').replace(' ', '') for c in calls))

    # expired session → reconnect banner, not a crash
    pg.evaluate("localStorage.setItem('lm_tokens_v1', JSON.stringify({'%s': {token:'EXPIRED', exp: Date.now() + 3600e3}}))" % ME)
    pg.reload(); pg.wait_for_timeout(1500)
    check('expired token shows Reconnect banner', pg.locator('.auth-banner').count() == 1)
    check('no tokens ever sent to Drive file', 'TESTTOKEN' not in (drive['file'] or '') and 'EXPIRED' not in (drive['file'] or ''))
    check('no page errors', not errs, errs)
    b.close()
print('\n%d failed' % len(fails) if fails else '\nALL PASSED')
sys.exit(1 if fails else 0)
