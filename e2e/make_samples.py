"""Regenerates samples/*.flowsketch and samples/*.gif from the built-in templates via the real UI."""
import os, sys
from playwright.sync_api import sync_playwright
BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
OUT = os.path.join(os.path.dirname(__file__), '..', 'samples')
GIFS = {'agent', 'request', 'loop'}
with sync_playwright() as pw:
    b = pw.chromium.launch()
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.add_init_script('delete window.showSaveFilePicker; delete window.showOpenFilePicker;')
    pg = ctx.new_page()
    pg.on('dialog', lambda d: d.accept())
    pg.goto(BASE); pg.wait_for_function('() => !!window.__flowsketch'); pg.wait_for_timeout(500)
    pg.get_by_role('button', name='Templates').click()
    ids = pg.eval_on_selector_all('[data-template]', 'els => els.map(e => e.dataset.template)')
    for i, tid in enumerate(ids):
        if i:
            pg.get_by_role('menuitem', name='File').click(); pg.get_by_role('menuitem', name='New from template…').click()
        pg.locator(f'[data-template={tid}]').click(); pg.wait_for_timeout(600)
        pg.evaluate('() => document.activeElement && document.activeElement.blur()')
        with pg.expect_download() as dl:
            pg.keyboard.press('Control+s')
        dl.value.save_as(os.path.join(OUT, f'{tid}.flowsketch'))
        if tid in GIFS:
            pg.keyboard.press('Control+Shift+e'); pg.wait_for_selector('[data-testid=gif-export]')
            pg.get_by_role('radio', name='Small').click()
            with pg.expect_download(timeout=120000) as dl:
                pg.get_by_test_id('gif-export').click()
            dl.value.save_as(os.path.join(OUT, f'{tid}.gif'))
            pg.keyboard.press('Escape')
        print('wrote', tid)
    b.close()
