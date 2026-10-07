"""Labels + email rules, end to end in demo mode.
Run:  python3 -m http.server 8765   then   python3 tests/rules.py [screenshot-dir/]"""
import sys
from playwright.sync_api import sync_playwright
BASE = 'http://localhost:8765'
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/'
fails = []
def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name + (' — ' + str(extra)[:300] if extra and not cond else ''))
    if not cond: fails.append(name)

def thread_labels(pg, tid):
    return pg.evaluate(f"""async () => {{ const c = await import('/js/core.js'); const ts = await c.provider('suman.work@example.com').listThreads({{ folderId: 'all' }}); return (ts.threads.find(t => t.id === '{tid}') || {{}}).labelIds || []; }}""")

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 1280, 'height': 860})
    ctx.add_init_script("localStorage.setItem('lm_demo','1')")
    pg = ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
    pg.goto(BASE + '/'); pg.wait_for_selector('.row')
    pg.click('.prof.work'); pg.wait_for_timeout(500)
    check('sidebar has Email rules entry', pg.locator('[data-act="rules"]').is_visible())

    # ---------------- labels ----------------
    pg.click('[data-act="labels-edit"]'); pg.wait_for_selector('.lbl-row')
    check('labels tab opens from sidebar Edit', pg.locator('.stabs [data-tab="labels"].on').count() == 1)
    pg.wait_for_timeout(400)
    ngdr = pg.locator('.lbl-row', has_text='NGDR').first.inner_text()
    check('label count shown (NGDR: 2 conversations)', '2 conversations' in ngdr, ngdr)
    pg.fill('#lbl-name', 'GSI Mail'); pg.click('#lbl-create'); pg.wait_for_timeout(500)
    check('label created', pg.locator('.lbl-row', has_text='GSI Mail').count() == 1)
    pg.fill('#lbl-name', 'inbox'); pg.click('#lbl-create'); pg.wait_for_timeout(300)
    check('reserved name refused', 'reserved' in pg.locator('#toasts').inner_text())
    # rename
    pg.locator('.lbl-row', has_text='Delegated').locator('[data-rename]').click()
    pg.fill('#lbl-rename', 'Delegated Tasks'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    check('label renamed', pg.locator('.lbl-row', has_text='Delegated Tasks').count() == 1 and pg.locator('.lbl-main b', has_text='Delegated').count() == 1)
    # colour
    pg.locator('.lbl-row', has_text='GSI Mail').locator('[data-colour]').click()
    pg.locator('.lbl-palette [data-pick="#c2453d"]').click(); pg.wait_for_timeout(200)
    check('label colour saved', pg.evaluate("async () => (await import('/js/core.js')).D().labelColors['GSI Mail']") == '#c2453d')
    # hide
    pg.locator('.lbl-row', has_text='Awaiting').locator('.switch').click(); pg.wait_for_timeout(300)
    check('hidden label leaves the sidebar', pg.locator('#side [data-label="Awaiting"]').count() == 0)
    check('renamed label shows in sidebar', pg.locator('#side [data-label="Delegated Tasks"]').count() == 1)
    # delete (Travel is on a personal email) — emails stay
    pg.locator('.lbl-row', has_text='Travel').locator('[data-del]').click()
    check('delete asks first and says emails are not deleted', 'NOT deleted' in pg.locator('.scrim').last.inner_text())
    pg.locator('.scrim').last.locator('[data-ok]').click(); pg.wait_for_timeout(500)
    check('label deleted', pg.locator('.lbl-main b', has_text='Travel').count() == 0)
    pg.screenshot(path=OUT + 'rules-labels.png')

    # ---------------- rules ----------------
    pg.click('.stabs [data-tab="rules"]'); pg.wait_for_selector('.rule-empty')
    pg.click('[data-a="new"]'); pg.wait_for_selector('#r-name')
    pg.fill('#qf', 'emails from @gsi.example, label them GSI Mail'); pg.click('[data-a="qf"]'); pg.wait_for_timeout(200)
    check('quick fill → From domain condition', pg.locator('[data-cf]').first.input_value() == 'fromDomain' and pg.locator('[data-cv]').first.input_value() == '@gsi.example')
    check('quick fill → label', pg.locator('[data-al]').first.input_value() == 'GSI Mail')
    pg.fill('#r-name', 'GSI Work Emails')
    pg.click('[data-a="preview"]'); pg.wait_for_selector('.pv-sum')
    s = pg.locator('.pv-sum').inner_text()
    check('preview: matched count shown (3 emails from gsi.example)', 'Matched emails: 3' in s, s)
    pg.locator('.pv-item summary').first.click()
    check('preview explains why', '✓ From domain contains “@gsi.example”' in pg.locator('.pv-why').first.inner_text())
    check('nothing changed by preview', not any(l == 'GSI Mail' for l in thread_labels(pg, 'd2')))
    pg.screenshot(path=OUT + 'rules-builder.png', full_page=True)
    pg.locator('[data-a="save-apply"]').click(); pg.wait_for_selector('.rule-card')
    pg.wait_for_timeout(300)
    check('rule saved and active', 'Active' in pg.locator('.rule-card').first.inner_text())
    check('applied to existing emails (d2, d3)', 'GSI Mail' in thread_labels(pg, 'd2') and 'GSI Mail' in thread_labels(pg, 'd3'))
    check('not applied elsewhere (d1)', 'GSI Mail' not in thread_labels(pg, 'd1'))

    # second rule, built by hand: subject contains NGDR → label NGDR + star
    pg.click('[data-a="new"]'); pg.wait_for_selector('#r-name')
    pg.fill('#r-name', 'NGDR Emails')
    pg.locator('[data-cf]').first.select_option('subject'); pg.wait_for_timeout(100)
    pg.locator('[data-cv]').first.fill('NGDR')
    pg.locator('[data-al]').first.fill('NGDR')
    pg.click('[data-a="adda"]'); pg.locator('[data-at]').nth(1).select_option('star'); pg.wait_for_timeout(100)
    pg.click('[data-a="preview"]'); pg.wait_for_selector('.pv-sum')
    check('second preview: 2 matched', 'Matched emails: 2' in pg.locator('.pv-sum').inner_text(), pg.locator('.pv-sum').inner_text())
    pg.click('[data-a="save"]'); pg.wait_for_timeout(300)
    check('two rules listed in order', pg.locator('.rule-card').count() == 2 and 'NGDR Emails' in pg.locator('.rule-card').nth(1).inner_text())
    check('saving without "apply" leaves existing email alone', 'STARRED' not in thread_labels(pg, 'd1'))

    # archive needs explicit confirmation
    pg.click('[data-a="new"]'); pg.fill('#r-name', 'Archive test')
    pg.locator('[data-cv]').first.fill('example.com'); pg.locator('[data-at]').first.select_option('archive'); pg.wait_for_timeout(100)
    check('archive shows a warning box', pg.locator('.risky-box').is_visible())
    pg.click('[data-a="save"]'); pg.wait_for_timeout(100)
    check('archive not saved without the tick', 'Tick the box' in pg.locator('.spanel').inner_text())
    pg.click('[data-a="back"]')

    # run on existing emails: preview then apply (rule 2 now stars d1, d2)
    pg.click('[data-a="existing"]'); pg.click('[data-a="preview-all"]'); pg.wait_for_selector('.pv-sum')
    s = pg.locator('.pv-sum').inner_text()
    check('existing-email preview counts changes', '2 emails will change' in s, s)
    pg.click('[data-a="apply-all"]'); pg.locator('.scrim').last.locator('[data-ok]').click(); pg.wait_for_timeout(600)
    check('existing-email run applied (d1 starred)', 'STARRED' in thread_labels(pg, 'd1'))
    log = pg.locator('.rule-log').inner_text()
    check('run history lists the rule and counts', 'NGDR Emails' in log and 'matched' in log, log[:300])

    # reorder + toggle
    pg.locator('[data-down="0"]').click(); pg.wait_for_timeout(100)
    check('rules can be reordered', 'NGDR Emails' in pg.locator('.rule-card').first.inner_text())
    pg.locator('.rule-card').first.locator('.switch').click(); pg.wait_for_timeout(100)
    check('rule can be switched off', 'Off' in pg.locator('.rule-card').first.inner_text())
    pg.locator('.rule-card').first.locator('.switch').click(); pg.wait_for_timeout(100)

    # Test button on a rule
    pg.locator('.rule-card', has_text='GSI Work Emails').locator('[data-test]').click(); pg.wait_for_selector('.pv-sum')
    check('rule Test shows matches', 'Matched emails: 3' in pg.locator('.pv-sum').inner_text())
    pg.click('[data-a="back"]')
    pg.screenshot(path=OUT + 'rules-list.png', full_page=True)
    pg.locator('.scrim [data-close]').first.click(); pg.wait_for_timeout(300)

    # test rules on one email (from the email's ⋯ menu)
    pg.locator('.row', has_text='Meeting regarding NGDR').click(); pg.wait_for_timeout(900)
    pg.click('#reader [data-a="more"]'); pg.locator('.menu button', has_text='Test rules on this email').click()
    pg.wait_for_selector('.rt-rule')
    t = pg.locator('#rt').inner_text()
    check('email test: both rules MATCHED with reasons', 'MATCHED' in t and 'GSI Work Emails' in t and 'NGDR Emails' in t and '✓ Subject contains “NGDR”' in t, t[:400])
    check('email test: says nothing left to change', 'already has everything' in t, t[-200:])
    pg.screenshot(path=OUT + 'rules-test-email.png')
    pg.locator('.scrim [data-close]').first.click()
    pg.locator('.row', has_text='AWS monthly estimate').click(); pg.wait_for_timeout(900)
    pg.click('#reader [data-a="more"]'); pg.locator('.menu button', has_text='Test rules on this email').click(); pg.wait_for_selector('#rt .rt-sec')
    t = pg.locator('#rt').inner_text()
    check('email test: NOT MATCHED shown with ✗', 'NOT MATCHED' in t and '✗' in t, t[:300])
    pg.locator('.scrim [data-close]').first.click()

    # rules + labels are saved in the data that goes to Google Drive
    d = pg.evaluate("async () => { const c = await import('/js/core.js'); return { rules: c.D().rules, hidden: c.D().hiddenLabels }; }")
    check('rules saved in LifeMail data (Drive file)', len(d['rules']) == 2 and d['rules'][0]['conditions'][0]['field'] == 'subject')
    check('hidden labels saved', d['hidden'] == ['Awaiting'])

    # delete a rule
    pg.click('[data-act="rules"]'); pg.wait_for_selector('.rule-card')
    pg.locator('.rule-card').first.locator('[data-del]').click(); pg.locator('.scrim').last.locator('[data-ok]').click(); pg.wait_for_timeout(200)
    check('rule deleted', pg.locator('.rule-card').count() == 1)

    # from a label straight to its rules
    pg.click('.stabs [data-tab="labels"]'); pg.wait_for_selector('.lbl-row')
    btn = pg.locator('.lbl-row', has_text='GSI Mail').locator('[data-lrules]')
    check('label shows how many rules use it', '1 rule' in btn.inner_text(), btn.inner_text())
    btn.click(); pg.wait_for_selector('.rule-filter')
    check('label → only its rules shown, ready to edit', pg.locator('.rule-card').count() == 1 and 'GSI Work Emails' in pg.locator('.rule-card').inner_text() and pg.locator('.stabs [data-tab="rules"].on').count() == 1)
    pg.click('[data-a="newfor"]'); pg.wait_for_selector('#r-name')
    check('"another rule for this label" pre-fills the label', pg.locator('[data-al]').first.input_value() == 'GSI Mail')
    pg.click('[data-a="back"]')
    pg.click('.stabs [data-tab="labels"]'); pg.wait_for_selector('.lbl-row')
    pg.locator('.lbl-row', has_text='Follow Up').locator('[data-lrules]').click(); pg.wait_for_selector('#r-name')
    check('label without rules → new rule pre-filled with that label', pg.locator('[data-al]').first.input_value() == 'Follow Up' and pg.locator('#r-name').input_value() == 'Follow Up emails')
    pg.click('[data-a="back"]'); pg.click('[data-a="showall"]') if pg.locator('[data-a="showall"]').count() else None

    # phone (folded Z Fold) layout
    pg.set_viewport_size({'width': 380, 'height': 800}); pg.wait_for_timeout(300)
    pg.click('.stabs [data-tab="labels"]'); pg.wait_for_selector('.lbl-row'); pg.wait_for_timeout(200)
    over = pg.evaluate("() => [...document.querySelectorAll('.spanel *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className || e.tagName).slice(0,5)")
    check('phone: labels list fits the screen', not over, over)
    pg.screenshot(path=OUT + 'rules-labels-phone.png', full_page=True)
    pg.click('.stabs [data-tab="rules"]'); pg.wait_for_selector('[data-a="new"]')
    pg.click('[data-a="new"]'); pg.click('[data-a="addc"]'); pg.wait_for_timeout(200)
    over = pg.evaluate("() => [...document.querySelectorAll('.spanel *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).map(e => e.className || e.tagName).slice(0,5)")
    check('phone: rule builder fits the screen', not over, over)
    pg.screenshot(path=OUT + 'rules-phone.png', full_page=True)

    check('no page errors', not errs, errs)
    b.close()

print('\n' + ('ALL PASSED' if not fails else f'{len(fails)} FAILED: {fails}'))
sys.exit(1 if fails else 0)
