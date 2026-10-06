"""Back gesture tests (phone size, demo mode). Run with the local server on :8765."""
import sys
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, x=''):
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(x))); c or fails.append(n)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 400, 'height': 860}, has_touch=True)
    ctx.add_init_script("localStorage.setItem('lm_demo','1')")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://localhost:8765/about:blank'.replace('/about:blank', '/'))
    pg.wait_for_selector('.row')
    cls = lambda: pg.get_attribute('#app', 'class')
    back = lambda: (pg.go_back(), pg.wait_for_timeout(350))
    hl0 = pg.evaluate('history.length')
    check('at Inbox: no extra history (back exits normally)', pg.evaluate('history.length') == hl0)

    pg.locator('.row').first.click(); pg.wait_for_timeout(500)
    check('open email adds one back step', pg.evaluate('history.length') == hl0 + 1)
    back()
    check('back closes the email, stays in app', 'reading' not in cls() and pg.url.startswith('http://localhost:8765/') and pg.locator('.row').count() > 0)

    pg.click('.lhead [data-act=menu]'); pg.wait_for_timeout(300)
    back()
    check('back closes the side drawer', 'side-open' not in cls())

    pg.click('.lhead [data-act=menu]'); pg.wait_for_timeout(300)
    pg.locator('.side [data-folder=sent]').click(); pg.wait_for_timeout(500)
    check('in Sent folder', 'Sent' in pg.inner_text('.lhead h1'))
    back()
    check('back from Sent returns to Inbox', 'Inbox' in pg.inner_text('.lhead h1'))

    pg.locator('.row').first.click(); pg.wait_for_timeout(500)
    pg.click('[data-a=more]'); pg.wait_for_timeout(200)
    back()
    check('back closes a pop-up menu first', pg.locator('.menu').count() == 0 and 'reading' in cls())
    pg.locator('.quick-reply [data-a=reply]').click(); pg.wait_for_selector('#c-body')
    back()
    check('back closes compose (email still open)', pg.locator('#c-body').count() == 0 and 'reading' in cls())
    back()
    check('next back closes the email', 'reading' not in cls())

    pg.click('#fab'); pg.wait_for_selector('#c-to'); pg.fill('#c-to', 'someone@example.com'); pg.wait_for_timeout(100)
    back()
    check('back from an edited message saves it as draft and closes', pg.locator('#c-to').count() == 0)

    # Using the on-screen back arrow must not leave a stale back step behind
    pg.locator('.row').first.click(); pg.wait_for_timeout(500)
    pg.click('[data-a=back]'); pg.wait_for_timeout(600)
    check('on-screen back arrow removes the extra step', pg.evaluate('history.length') >= hl0 and 'reading' not in cls())
    pg.locator('.row').first.click(); pg.wait_for_timeout(500); back()
    check('gesture still works after using the arrow', 'reading' not in cls() and pg.locator('.row').count() > 0)

    # Settings dialog
    pg.click('.lhead [data-act=menu]'); pg.wait_for_timeout(250); pg.click('.side [data-act=settings]'); pg.wait_for_selector('.stabs')
    back()
    check('back closes Settings', pg.locator('.stabs').count() == 0)
    check('no page errors', not errs, errs)
    b.close()
print('\nALL PASSED' if not fails else f'\n{len(fails)} failed'); sys.exit(1 if fails else 0)
