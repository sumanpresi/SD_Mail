"""Work = Government Workplace tests (demo data, all accounts set to Personal so Work has no Gmail)."""
import sys
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765'
fails = []
def check(n, c, x=''):
    print(('PASS ' if c else 'FAIL ') + n + ('' if c else ' — ' + str(x)[:200])); c or fails.append(n)
with sync_playwright() as p:
    b = p.chromium.launch()
    for name, w, h in [('fold', 884, 1000), ('phone', 400, 860)]:
        ctx = b.new_context(viewport={'width': w, 'height': h}, has_touch=True)
        ctx.route('https://workplace.mgovcloud.in/**', lambda r: r.fulfill(content_type='text/html', body='<p>Government Workplace (stub)</p>'))
        ctx.add_init_script("""localStorage.setItem('lm_demo','1');
          if (!localStorage.getItem('seeded')) { localStorage.setItem('seeded','1');
            localStorage.setItem('lm_data_v1_demo', JSON.stringify({ schema:1, updatedAt:1, accounts:[{ email:'suman.personal@example.com', name:'Suman', profile:'personal', color:'#3a6ea5', signature:'', notify:true }] })); }""")
        pg = ctx.new_page(); errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_selector('.row'); pg.wait_for_timeout(500)
        if name == 'phone': pg.click('.lhead [data-act=menu]'); pg.wait_for_timeout(250)
        sel = '.prof.work' if name == 'phone' else '.rail-prof .work'
        with ctx.expect_page() as pop:
            pg.click(sel)
        wp = pop.value; wp.wait_for_load_state()
        check(f'{name}: tapping Work opens the real Government Workplace', wp.url.startswith('https://workplace.mgovcloud.in/'), wp.url)
        check(f'{name}: opened without a link back to LifeMail (noopener)', wp.evaluate('window.opener') is None)
        wp.close(); pg.wait_for_timeout(300)
        if name == 'phone' and 'side-open' in (pg.get_attribute('#app', 'class') or ''): pg.click('#listpane', position={'x': 380, 'y': 400}); pg.wait_for_timeout(200)
        body = pg.inner_text('#listpane')
        check(f'{name}: Work screen shown, no "No accounts here"', 'Government Workplace' in body and 'No accounts here' not in body, body[:120])
        check(f'{name}: work-mode layout (no empty reading pane)', 'work-mode' in pg.get_attribute('#app', 'class'))
        pg.screenshot(path=f'/tmp/claude-0/-home-claude/1e83c7fb-ac13-517f-8605-26a0241d5446/scratchpad/work-{name}.png')
        with ctx.expect_page() as pop2:
            pg.click('[data-work-open]')
        check(f'{name}: Open Workplace button works', pop2.value.url.startswith('https://workplace.mgovcloud.in/')); pop2.value.close()
        check(f'{name}: last opened recorded', 'Not opened yet' not in pg.inner_text('.work-meta'))
        # settings: shortcuts + validation
        pg.click('[data-work-settings]'); pg.wait_for_selector('#wk-url')
        pg.fill('#wk-sc-name', 'Mail'); pg.fill('#wk-sc-url', 'https://evil.example.com/phish'); pg.click('#wk-sc-add'); pg.wait_for_timeout(150)
        check(f'{name}: non-Government shortcut rejected', pg.locator('[data-wk-rm]').count() == 0)
        pg.fill('#wk-sc-url', 'https://workplace.mgovcloud.in/#mail'); pg.click('#wk-sc-add'); pg.wait_for_timeout(150)
        check(f'{name}: Government shortcut added', pg.locator('[data-wk-rm]').count() == 1)
        pg.fill('#wk-url', 'http://workplace.mgovcloud.in/'); pg.dispatch_event('#wk-url', 'change'); pg.wait_for_timeout(100)
        check(f'{name}: non-https Workplace address refused', pg.evaluate("JSON.parse(localStorage.getItem('lm_data_v1_demo')).work.portalUrl") == 'https://workplace.mgovcloud.in/')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        check(f'{name}: shortcut tile shown on Work screen', pg.locator('[data-work-sc]').count() == 1)
        stored = pg.evaluate("localStorage.getItem('lm_data_v1_demo')")
        check(f'{name}: nothing Government-sensitive stored', all(k not in stored.lower() for k in ['password', 'otp', 'totp', 'cookie']))
        # back to Personal works and mail is intact
        if name == 'phone': pg.click('[data-work-menu]'); pg.wait_for_timeout(250)
        pg.click('.prof.personal' if name == 'phone' else '.rail-prof .personal'); pg.wait_for_timeout(600)
        check(f'{name}: Personal mail still works', pg.locator('.row').count() > 0 and 'work-mode' not in pg.get_attribute('#app', 'class'))
        check(f'{name}: no page errors', not errs, errs)
        ctx.close()
    b.close()
print('\nALL PASSED' if not fails else f'\n{len(fails)} failed'); sys.exit(1 if fails else 0)
