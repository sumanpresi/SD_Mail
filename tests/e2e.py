"""End-to-end tests in demo mode. Run:  python3 -m http.server 8765  then  python3 tests/e2e.py"""
import json, sys
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/'
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(extra) if extra and not cond else ''))
    if not cond: fails.append(name)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 820})
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE + '/'); pg.wait_for_selector('.row')
    check('demo badge visible', pg.locator('.demo-badge').is_visible())

    # profile switching
    pg.click('.prof.work'); pg.wait_for_timeout(500)
    titles = pg.locator('.row .subj').all_inner_texts()
    check('work profile shows work mail', any('NGDR Portal API' in t for t in titles), titles)
    check('personal mail hidden in work', not any('Travel confirmation' in t for t in titles))

    # open thread with inline image + attachments
    pg.locator('.row', has_text='Lot-15 summary').click(); pg.wait_for_timeout(1200)
    check('thread shows 3 messages', pg.locator('.msg').count() == 3, pg.locator('.msg').count())
    pg.locator('.mhead').first.click(); pg.wait_for_timeout(900)
    check('attachments listed', pg.locator('.att').count() == 1, pg.locator('.att').count())
    fr = pg.frame_locator('.mframe').first
    check('inline cid image resolved to blob', 'blob:' in (fr.locator('img').first.get_attribute('src') or ''))
    pg.screenshot(path=OUT + 'e2e-thread.png')

    # drag payload: capture what a real dragstart puts on the DataTransfer
    data = pg.evaluate("""() => {
      const row = [...document.querySelectorAll('.row')].find(r => r.textContent.includes('NGDR Portal API'));
      const dt = new DataTransfer();
      row.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      const out = {}; for (const t of dt.types) out[t] = dt.getData(t);
      out.__dragging = document.body.classList.contains('is-dragging');
      row.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      return out; }""")
    check('drag sets text/plain with payload marker', 'lifemail-payload:' in data.get('text/plain', ''))
    check('drag sets text/uri-list to Gmail link', data.get('text/uri-list', '').startswith('https://mail.google.com/'))
    check('drag sets custom JSON type', 'application/x-lifemail+json' in data)
    check('drag dock shown while dragging', data['__dragging'])
    pj = json.loads(data['application/x-lifemail+json'])
    check('drag payload has task title', bool(pj['task']['title']), pj['task'])

    # drop into the LifeOS test receiver (separate page) — text only, like a cross-app drop on Android
    rp = ctx.new_page(); rp.goto(BASE + '/lifeos-kit/test-receiver.html')
    rp.evaluate("""(txt) => { const dt = new DataTransfer(); dt.setData('text/plain', txt);
      const z = document.getElementById('z-today');
      z.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
      z.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""", data['text/plain'])
    task = rp.evaluate('window.__lastTask')
    check('receiver got task from text-only drop', task and task['threadId'] == 'd1', task)
    check('receiver applied drop destination', task and task['destination'] == 'today')
    check('receiver keeps email link', task and task['emailUrl'].startswith('https://mail.google.com/'))
    rp.screenshot(path=OUT + 'e2e-receiver.png')
    # plain Gmail link drop also works
    rp.evaluate("""() => { const dt = new DataTransfer(); dt.setData('text/uri-list', 'https://mail.google.com/mail/u/0/#inbox/abc');
      document.documentElement.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt })); }""")
    check('plain Gmail link drop makes a basic task', rp.evaluate('window.__lastTask.source') == 'link')
    rp.close()

    # + Task panel → Send to LifeOS (URL template pointing at the test receiver)
    pg.evaluate("""async () => { const c = await import('/js/core.js'); c.S.store.update(d => { d.settings.lifeos.urlTemplate = location.origin + '/lifeos-kit/test-receiver.html?lifemail={payload}'; }); }""")
    pg.locator('.row', has_text='NGDR Portal API').click(); pg.wait_for_timeout(700)
    pg.click('.taskbtn'); pg.wait_for_selector('#tk-title')
    check('task panel: smart title from email body', pg.input_value('#tk-title').startswith('Share the list'), pg.input_value('#tk-title'))
    check('task panel: due date suggested from "by Friday"', pg.input_value('#tk-due') != '', pg.input_value('#tk-due'))
    pg.fill('#tk-title', 'Send failed report IDs to BISAG-N')
    pg.fill('#tk-project', 'NGDR')
    pg.click('#tk-pri [data-p=high]')
    pg.screenshot(path=OUT + 'e2e-taskpanel.png')
    with ctx.expect_page() as newp:
        pg.click('#tk-send')
    lp = newp.value; lp.wait_for_load_state(); lp.wait_for_timeout(300)
    t2 = lp.evaluate('window.__lastTask')
    check('LifeOS link delivers edited task', t2 and t2['title'] == 'Send failed report IDs to BISAG-N' and t2['priority'] == 'high' and t2['project'] == 'NGDR', t2)
    check('payload removed from LifeOS address bar', 'lifemail=' not in lp.url, lp.url)
    lp.close()
    pg.wait_for_timeout(300)
    check('row shows Task badge after linking', pg.locator('.row', has_text='NGDR Portal API').locator('.chip.task').count() == 1)
    check('reader shows linked task', pg.locator('.linked').count() == 1)

    # star, label, archive + undo
    pg.keyboard.press('s'); pg.wait_for_timeout(200)
    check('keyboard s stars', pg.locator('.row.sel .rstar.on').count() == 1)
    pg.click('[data-a=label]'); pg.wait_for_selector('.menu')
    pg.locator('.menu button', has_text='Delegated').click(); pg.wait_for_timeout(300)
    check('label applied', pg.locator('.rchips', has_text='Delegated').count() == 1)
    n0 = pg.locator('.row').count()
    pg.click('[data-a=archive]'); pg.wait_for_timeout(300)
    check('archive removes row', pg.locator('.row').count() == n0 - 1)
    pg.locator('.toast button', has_text='Undo').first.click(); pg.wait_for_timeout(300)
    check('undo restores row', pg.locator('.row').count() == n0)

    # reply flow
    pg.locator('.row', has_text='Lot-15 summary').click(); pg.wait_for_timeout(800)
    pg.locator('.quick-reply [data-a=replyall]').click(); pg.wait_for_selector('#c-to')
    check('reply-all addresses the other person, not me', 'ananya.roy@gsi.example' in pg.input_value('#c-to'), pg.input_value('#c-to'))
    check('reply subject prefixed', pg.input_value('#c-subj').startswith('Re: '))
    check('signature inserted', 'Senior Geologist' in pg.inner_text('#c-body'))
    pg.screenshot(path=OUT + 'e2e-compose.png')
    pg.click('[data-send]'); pg.wait_for_timeout(500)
    check('send closes composer', pg.locator('#c-to').count() == 0)
    # compose validation
    pg.keyboard.press('c'); pg.wait_for_selector('#c-to'); pg.fill('#c-to', 'not-an-address'); pg.click('[data-send]'); pg.wait_for_timeout(300)
    check('bad address rejected', pg.locator('.toast.err').count() >= 1 and pg.locator('#c-to').count() == 1)
    pg.click('[data-discard]'); pg.wait_for_timeout(200)
    if pg.locator('[data-ok]').count(): pg.click('[data-ok]')

    # search
    pg.fill('#search', 'BISAG'); pg.press('#search', 'Enter'); pg.wait_for_timeout(500)
    check('search finds BISAG-N mail', pg.locator('.row').count() >= 1)
    pg.click('[data-act=clear-search]'); pg.wait_for_timeout(300)

    # settings tabs open cleanly
    pg.click('.side [data-act=settings]'); pg.wait_for_selector('.stabs')
    for tab in ['accounts', 'profiles', 'lifeos', 'labels', 'notify', 'appearance', 'privacy', 'data', 'about']:
        pg.click(f'[data-tab={tab}]'); pg.wait_for_timeout(80)
    pg.click('[data-tab=appearance]'); pg.click('[data-seg=theme] [data-v=dark]'); pg.wait_for_timeout(100)
    pg.click('[data-tab=lifeos]'); pg.screenshot(path=OUT + 'e2e-settings-dark.png')
    check('dark theme applied', pg.evaluate('document.documentElement.dataset.theme') == 'dark')
    pg.keyboard.press('Escape')

    # security: hostile email
    pg.evaluate("""async () => { const d = await import('/js/demo.js'); d.__demoInject({ account: 'suman.work@example.com', id: 'evil', labels: ['INBOX'], subject: 'Hostile test',
      messages: [{ id: 'evilm', from: 'Bad <bad@evil.example>', to: 'x', date: Date.now() + 1000, att: [], rfc: '<e@x>',
      html: '<p id=ok>Body</p><script>parent.__pwned=1</script><img src=x onerror="parent.__pwned=2"><a href="javascript:parent.__pwned=3" id=jl>click</a><img src="https://tracker.example/p.gif"><form action="https://evil.example"><input name=pw></form><iframe src="https://evil.example"></iframe>' }] }); }""")
    pg.click('[data-act=refresh]'); pg.wait_for_timeout(600)
    pg.locator('.row', has_text='Hostile test').click(); pg.wait_for_timeout(900)
    fr = pg.frame_locator('.mframe').first
    check('hostile: body renders', fr.locator('#ok').count() == 1)
    check('hostile: no script ran', pg.evaluate('window.__pwned') is None)
    check('hostile: script/form/iframe removed', fr.locator('script, form, iframe, input').count() == 0)
    check('hostile: javascript: link neutralised', not (fr.locator('#jl').get_attribute('href') or '').startswith('javascript'))
    check('hostile: tracker image blocked', fr.locator('img[src^="https"]').count() == 0 and pg.locator('.imgbar').count() == 1)
    sandbox = pg.locator('.mframe').first.get_attribute('sandbox')
    check('iframe sandbox has no allow-scripts', 'allow-scripts' not in sandbox, sandbox)

    real = [e for e in errs if 'Content Security Policy' not in e]  # CSP blocks inside the hostile email are the protection working
    check('email CSP blocked the hostile image', any('Content Security Policy' in e for e in errs))
    check('no JavaScript errors during run', not real, real)
    ctx.close()

    # ---- phone (folded Fold) layout ----
    ctx = b.new_context(viewport={'width': 400, 'height': 860}, has_touch=True)
    pg = ctx.new_page(); errs2 = []
    pg.on('pageerror', lambda e: errs2.append(str(e)))
    pg.goto(BASE + '/'); pg.wait_for_selector('.row')
    pg.locator('.row').first.click(); pg.wait_for_timeout(700)
    check('phone: reader slides in', 'reading' in pg.get_attribute('#app', 'class'))
    pg.screenshot(path=OUT + 'e2e-phone-read.png')
    pg.click('[data-a=back]'); pg.wait_for_timeout(300)
    check('phone: back returns to list', 'reading' not in pg.get_attribute('#app', 'class'))
    pg.click('.lhead [data-act=menu]'); pg.wait_for_timeout(300)
    check('phone: drawer opens', 'side-open' in pg.get_attribute('#app', 'class'))
    pg.screenshot(path=OUT + 'e2e-phone-drawer.png')
    check('phone: no errors', not errs2, errs2)
    ctx.close()

    # ---- welcome screen when a Client ID is set but no account yet ----
    ctx = b.new_context(viewport={'width': 884, 'height': 1000})
    ctx.route('https://accounts.google.com/**', lambda r: r.fulfill(content_type='text/html', body='<p>Google sign-in (stub)</p>'))
    pg = ctx.new_page()
    pg.route('**/js/config.js', lambda r: r.fulfill(content_type='text/javascript', body="export const CONFIG = { googleClientId: 'test.apps.googleusercontent.com', driveFileName: 'lifemail-data.json' };"))
    pg.goto(BASE + '/'); pg.wait_for_selector('#w-signin')
    check('welcome screen with Google sign-in', pg.locator('#w-signin').is_visible())
    with ctx.expect_page() as pop:
        pg.click('#w-signin')
    pop.value.wait_for_load_state(); u = pop.value.url
    check('sign-in opens Google OAuth with minimal scopes', u.startswith('https://accounts.google.com/o/oauth2/v2/auth') and 'gmail.modify' in u and 'drive.appdata' in u and 'drive.file' not in u and 'mail.google.com%2F' not in u.split('scope=')[1].split('&')[0], u[:300])
    pg.screenshot(path=OUT + 'e2e-welcome.png')
    ctx.close()
    b.close()

print('\n%d failed' % len(fails) if fails else '\nALL PASSED')
sys.exit(1 if fails else 0)
