"""Simulates the LifeMail Android app's message channel (window.LifeMailAndroid) to test the page side."""
import json, sys
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765'
fails = []
def check(n, c, x=''):
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(x)[:250])); c or fails.append(n)

FAKE_NATIVE = """
window.__sent = [];
window.LifeMailAndroid = {
  onmessage: null,
  postMessage(s) {
    const m = JSON.parse(s); window.__sent.push(m); try { if (m.type === 'signIn') sessionStorage.setItem('__signIns', String(+(sessionStorage.getItem('__signIns') || 0) + 1)); } catch (e) {}
    const reply = (o) => setTimeout(() => this.onmessage && this.onmessage({ data: JSON.stringify(Object.assign({ id: m.id, ok: true }, o)) }), 10);
    if (m.type === 'signIn') reply({ accessToken: sessionStorage.getItem('__nextToken') || 'ANDROIDTOKEN', scopes: ['https://www.googleapis.com/auth/userinfo.email','https://www.googleapis.com/auth/userinfo.profile','https://www.googleapis.com/auth/gmail.modify','https://www.googleapis.com/auth/drive.appdata'] });
    else reply({});
  }
};
window.__nativeEvent = (name) => window.LifeMailAndroid.onmessage({ data: JSON.stringify({ event: name }) });
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- demo data: Work, attachments, share, return from Work ----------
    ctx = b.new_context(viewport={'width': 884, 'height': 1000})
    ctx.add_init_script(FAKE_NATIVE + """localStorage.setItem('lm_demo','1');
      if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded','1'); localStorage.setItem('lm_data_v1_demo', JSON.stringify({ schema:1, updatedAt:1,
        accounts:[{ email:'suman.personal@example.com', name:'Suman', profile:'personal', color:'#3a6ea5' }, { email:'suman.work@example.com', name:'Suman', profile:'personal', color:'#2f7d6d' }] })); }""")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    popups = []; ctx.on('page', lambda q: popups.append(q.url))
    pg.goto(BASE + '/'); pg.wait_for_selector('.row'); pg.wait_for_timeout(500)
    sent = lambda: pg.evaluate('window.__sent')
    check('page says hello to the app', any(m['type'] == 'hello' for m in sent()))
    check('page marks itself as inside the app', pg.evaluate("document.documentElement.classList.contains('in-android-app')"))
    pg.click('.rail-prof .work'); pg.wait_for_timeout(400)
    ow = [m for m in sent() if m['type'] == 'openWork']
    check('tapping Work asks the app to open its Work browser', ow and ow[0]['url'] == 'https://workplace.mgovcloud.in/', ow)
    check('no external browser window opened', not popups, popups)
    pg.evaluate("window.__nativeEvent('workClosed')"); pg.wait_for_timeout(500)
    check('returning from Work shows Personal mail', 'work-mode' not in pg.get_attribute('#app', 'class') and pg.locator('.row').count() > 0)
    # attachment save goes through the app
    pg.locator('.row', has_text='Lot-15').click(); pg.wait_for_timeout(700)
    pg.locator('.mhead').first.click(); pg.wait_for_timeout(700)
    pg.click('[data-a=att-save]'); pg.wait_for_timeout(600)
    sf = [m for m in sent() if m['type'] == 'saveFile']
    check('attachment saved through the app (Downloads)', sf and sf[0]['name'] == 'Lot-15-summary.csv' and len(sf[0]['base64']) > 10 and sf[0]['action'] == 'save', [ {k: (v if k!='base64' else len(v)) for k,v in m.items()} for m in sf])
    check('share button available in the app', pg.locator('[data-a=att-share]').count() >= 1)
    pg.click('[data-a=att-share]'); pg.wait_for_timeout(500)
    check('attachment share goes through the app', any(m['type'] == 'saveFile' and m['action'] == 'share' for m in sent()))
    # task share through the app
    pg.click('.taskbtn'); pg.wait_for_selector('#tk-share'); pg.click('#tk-share'); pg.wait_for_timeout(400)
    st = [m for m in sent() if m['type'] == 'shareText']
    check('Share task uses Android share sheet', st and 'Open email:' in st[0]['text'], st)
    check('no page errors (demo)', not errs, errs)
    ctx.close()

    # ---------- real mode: Google sign-in through the app ----------
    ctx = b.new_context(viewport={'width': 400, 'height': 860})
    ctx.add_init_script(FAKE_NATIVE)
    valid = {'ANDROIDTOKEN'}
    def google(route):
        u = route.request.url; auth = route.request.headers.get('authorization', '')
        if auth.replace('Bearer ', '') not in valid: return route.fulfill(status=401, body='{}')
        if 'userinfo' in u: return route.fulfill(content_type='application/json', body=json.dumps({'email': 'suman.test@gmail.com', 'name': 'Suman'}))
        if 'labels/INBOX' in u: return route.fulfill(content_type='application/json', body='{"threadsUnread":0}')
        if '/labels' in u: return route.fulfill(content_type='application/json', body='{"labels":[]}')
        if '/threads' in u: return route.fulfill(content_type='application/json', body='{"threads":[]}')
        if '/profile' in u: return route.fulfill(content_type='application/json', body='{"historyId":"1"}')
        if 'drive/v3/files' in u and route.request.method == 'GET': return route.fulfill(content_type='application/json', body='{"files":[]}')
        if 'upload/drive' in u: return route.fulfill(content_type='application/json', body='{"id":"f1"}')
        return route.fulfill(status=404, body='{}')
    for h in ['https://gmail.googleapis.com/**', 'https://www.googleapis.com/**']: ctx.route(h, google)
    pg = ctx.new_page(); errs2 = []
    pg.on('pageerror', lambda e: errs2.append(str(e)))
    popups2 = []; ctx.on('page', lambda q: popups2.append(q.url))
    pg.route('**/js/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const CONFIG = { googleClientId: 'x.apps.googleusercontent.com', driveFileName: 'lifemail-data.json' };"))
    pg.goto(BASE + '/'); pg.wait_for_selector('#w-signin')
    pg.click('#w-signin'); pg.wait_for_timeout(1500)
    n = pg.evaluate("+(sessionStorage.getItem('__signIns') || 0)")
    check('Sign in with Google asks the app (no Google page in WebView)', n == 1 and not popups2, (n, popups2))
    pg.wait_for_selector('.lhead', timeout=8000)
    check('signed in: inbox screen shown', 'Inbox' in pg.inner_text('.lhead h1'))
    tok = pg.evaluate("JSON.parse(localStorage.getItem('lm_tokens_v1'))")
    check('token stored only on device, for the right account', list(tok.keys()) == ['suman.test@gmail.com'], tok)
    check('no page errors (sign-in)', not errs2, errs2)

    # ---------- staying signed in ----------
    # 1) the Gmail pass ran out while the app was closed / idle → renewed silently on open, no banner
    pg.evaluate("() => { const t = JSON.parse(localStorage.getItem('lm_tokens_v1')); for (const k in t) t[k].exp = Date.now() - 1000; localStorage.setItem('lm_tokens_v1', JSON.stringify(t)); }")
    before = pg.evaluate("+(sessionStorage.getItem('__signIns') || 0)")
    pg.reload(); pg.wait_for_selector('.lhead', timeout=8000); pg.wait_for_timeout(1500)
    sil = pg.evaluate("window.__sent.filter(m => m.type === 'signIn')")
    check('expired pass renewed silently through Android (no screen)', pg.evaluate("+(sessionStorage.getItem('__signIns') || 0)") > before and all(m.get('silent') for m in sil), sil)
    check('no "Session ended" banner after expiry', pg.locator('.auth-banner').count() == 0, pg.inner_text('#listpane')[:200])
    check('token valid again for ~45 min', pg.evaluate("Object.values(JSON.parse(localStorage.getItem('lm_tokens_v1')))[0].exp - Date.now()") > 40 * 60_000)
    # 2) Gmail rejects the pass early (401) → fresh pass fetched silently and the request retried
    valid.clear(); valid.add('ANDROIDTOKEN2')
    pg.evaluate("sessionStorage.setItem('__nextToken', 'ANDROIDTOKEN2')")
    pg.click('[data-act="refresh"]'); pg.wait_for_timeout(1500)
    check('rejected pass replaced silently, list still loads', pg.locator('.auth-banner').count() == 0 and 'ANDROIDTOKEN2' in pg.evaluate("localStorage.getItem('lm_tokens_v1')"))
    check('old pass was handed back to Android to be cleared', any(m.get('oldToken') == 'ANDROIDTOKEN' for m in pg.evaluate("window.__sent") if m['type'] == 'signIn'))
    # 3) Android cannot renew (e.g. Google account removed from the phone) → banner shown honestly
    pg.evaluate("""() => { const orig = window.LifeMailAndroid.postMessage.bind(window.LifeMailAndroid); window.LifeMailAndroid.postMessage = (s) => { const m = JSON.parse(s); if (m.type === 'signIn') { setTimeout(() => window.LifeMailAndroid.onmessage({ data: JSON.stringify({ id: m.id, ok: false, error: 'interaction_required' }) }), 10); return; } orig(s); }; }""")
    valid.clear()
    pg.click('[data-act="refresh"]'); pg.wait_for_timeout(1500)
    check('if Android cannot renew, Reconnect banner appears', pg.locator('.auth-banner').count() == 1, pg.inner_text('#listpane')[:200])
    check('no page errors (staying signed in)', not errs2, errs2)
    ctx.close(); b.close()
print('\nALL PASSED' if not fails else f'\n{len(fails)} failed'); sys.exit(1 if fails else 0)
