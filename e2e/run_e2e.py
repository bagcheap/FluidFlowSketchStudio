"""
FlowSketch Studio end-to-end acceptance tests (spec §23), driven through real pointer/keyboard
input in headless Chromium via Playwright. Exported files are verified on disk (GIFs decoded with Pillow).

Usage:  npm run build && npx vite preview --port 4173 &   then   python3 e2e/run_e2e.py [base_url] [out_dir]
"""
import json, os, re, sys, time, traceback
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:4173/'
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), 'out')
os.makedirs(OUT, exist_ok=True)
results = []

# Force the download fallback (no native file pickers in headless runs)
INIT = "delete window.showSaveFilePicker; delete window.showOpenFilePicker;"


def test(name):
    def wrap(fn):
        def run(*a):
            t0 = time.time()
            try:
                fn(*a)
                results.append((name, True, f'{time.time()-t0:.1f}s'))
                print(f'PASS  {name}')
            except Exception as e:
                results.append((name, False, str(e)))
                print(f'FAIL  {name}: {e}')
                traceback.print_exc()
        return run
    return wrap


class App:
    def __init__(self, page):
        self.p = page

    def js(self, expr, *args):
        return self.p.evaluate(expr, *args)

    def doc(self):
        return self.js('() => window.__flowsketch.doc()')

    def ui(self):
        return self.js('() => window.__flowsketch.ui()')

    def reset_view(self):
        self.js('() => window.__flowsketch.setView({x: 0, y: 0, zoom: 1})')
        self.p.wait_for_timeout(50)

    def pt(self, wx, wy):
        box = self.p.locator('[data-testid=stage]').bounding_box()
        v = self.ui()['view']
        return box['x'] + (wx - v['x']) * v['zoom'], box['y'] + (wy - v['y']) * v['zoom']

    def drag(self, a, b, steps=8, mods=None):
        x0, y0 = self.pt(*a)
        x1, y1 = self.pt(*b)
        for m in mods or []:
            self.p.keyboard.down(m)
        self.p.mouse.move(x0, y0)
        self.p.mouse.down()
        self.p.mouse.move(x1, y1, steps=steps)
        self.p.mouse.up()
        for m in mods or []:
            self.p.keyboard.up(m)
        self.p.wait_for_timeout(60)

    def click(self, w, count=1):
        x, y = self.pt(*w)
        self.p.mouse.click(x, y, click_count=count)
        self.p.wait_for_timeout(60)

    def key(self, k):
        self.p.evaluate('() => document.activeElement && document.activeElement !== document.body && document.activeElement.blur()')
        self.p.keyboard.press(k)
        self.p.wait_for_timeout(40)

    def els(self, t=None):
        return [e for e in self.doc()['elements'] if t is None or e['type'] == t]


def fresh(browser, accept_downloads=True):
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=accept_downloads)
    ctx.add_init_script(INIT)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    # register early: Playwright enables file-chooser interception asynchronously on first listener
    page.on('filechooser', lambda f: None)
    page.goto(BASE)
    page.wait_for_function('() => !!window.__flowsketch')
    page.wait_for_timeout(400)
    page.mouse.click(700, 600)  # focus document
    return ctx, page, App(page), errors


def open_file(page, mod, path):
    """Ctrl/Cmd+O and pick a file; retries once (the first keypress can race the app's startup restore)."""
    for attempt in range(2):
        try:
            page.mouse.click(700, 600)
            with page.expect_file_chooser(timeout=6000) as fc:
                page.keyboard.press(f'{mod}+o')
            fc.value.set_files(path)
            return
        except Exception:
            if attempt:
                raise
            page.wait_for_timeout(500)


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx, page, app, errors = fresh(browser)

        @test('1 · Continuous drawing: tool persists, 3 rectangles share defaults')
        def t1():
            app.reset_view()
            app.key('r')
            page.get_by_label('Stroke colour #1864ab').click()
            page.get_by_label('Fill colour #fff3bf').click()
            page.get_by_label('Width value').fill('3')
            for i in range(3):
                app.drag((100 + i * 220, 150), (280 + i * 220, 250))
            rects = app.els('shape')
            assert len(rects) == 3, f'expected 3 shapes, got {len(rects)}'
            for r in rects:
                assert r['shape'] == 'rectangle'
                assert r['style']['stroke'] == '#1864ab' and r['style']['fill'] == '#fff3bf' and r['style']['strokeWidth'] == 3, r['style']
            u = app.ui()
            assert u['tool'] == 'shape' and u['shapeKind'] == 'rectangle', u
        t1()

        @test('2 · Remembered per-tool defaults (red diamond survives switching tools)')
        def t2():
            app.key('d')
            page.get_by_label('Stroke colour #c92a2a').click()
            app.key('r')
            app.drag((100, 330), (260, 420))
            app.drag((320, 330), (480, 420))
            last2 = app.els('shape')[-2:]
            assert all(e['style']['stroke'] == '#1864ab' for e in last2), [e['style']['stroke'] for e in last2]
            app.key('d')
            assert app.js("() => window.__flowsketch.toolStyle('shape:diamond').style.stroke") == '#c92a2a'
            app.drag((560, 320), (720, 440))
            d = app.els('shape')[-1]
            assert d['shape'] == 'diamond' and d['style']['stroke'] == '#c92a2a'
            # existing objects untouched by default edits
            assert app.els('shape')[0]['style']['stroke'] == '#1864ab'
        t2()

        @test('9 · Undo / redo (create, resize, recolour)')
        def t9():
            app.key('Escape')
            app.key('u')
            app.drag((900, 150), (1040, 230))
            sid = app.els('shape')[-1]['id']
            app.key('v')
            app.click((970, 190))
            assert app.ui()['selection'] == [sid]
            # resize via the south-east handle
            app.drag((1040, 230), (1100, 300))
            el = [e for e in app.els() if e['id'] == sid][0]
            assert abs(el['w'] - 200) < 3 and abs(el['h'] - 150) < 3, (el['w'], el['h'])
            page.get_by_label('Fill colour #ffe3e3').click()
            assert [e for e in app.els() if e['id'] == sid][0]['style']['fill'] == '#ffe3e3'
            n = len(app.els())
            mod = 'Meta' if 'Mac' in page.evaluate('navigator.platform') else 'Control'
            app.click((800, 650))  # deselect to keep focus on canvas
            for _ in range(3):
                app.key(f'{mod}+z')
            assert len(app.els()) == n - 1, 'undo x3 should remove the shape'
            app.key(f'{mod}+Shift+z')
            el = [e for e in app.els() if e['id'] == sid][0]
            assert abs(el['w'] - 140) < 3, 'first redo restores the created size'
            app.key(f'{mod}+Shift+z'); app.key(f'{mod}+Shift+z')
            el = [e for e in app.els() if e['id'] == sid][0]
            assert abs(el['w'] - 200) < 3 and el['style']['fill'] == '#ffe3e3'
        t9()

        @test('4 · Smart connector stays attached after move + resize')
        def t4():
            app.key('a')
            app.drag((190, 200), (410, 200))  # rect 1 centre -> rect 2 centre
            c = app.els('connector')[-1]
            s0, s1 = app.els('shape')[0], app.els('shape')[1]
            assert c['start']['elementId'] == s0['id'] and c['end']['elementId'] == s1['id'], (c['start'], c['end'])
            app.key('v')
            app.drag((150, 175), (150, 105))  # move rect 1 up 70
            app.click((420, 160)); app.drag((500, 250), (580, 330))  # resize rect 2
            s0 = [e for e in app.els() if e['id'] == s0['id']][0]
            s1 = [e for e in app.els() if e['id'] == s1['id']][0]
            assert abs(s0['y'] - 80) < 2, s0['y']
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            inside = lambda p, e: e['x'] - 9 <= p['x'] <= e['x'] + e['w'] + 9 and e['y'] - 9 <= p['y'] <= e['y'] + e['h'] + 9
            assert inside(ends['s'], s0) and inside(ends['e'], s1), ends
            page.screenshot(path=f'{OUT}/e2e-connector.png')
        t4()

        @test('Text: double-click a shape, type, commit')
        def ttext():
            app.key('Escape')
            s = app.els('shape')[2]
            app.click((s['x'] + s['w'] / 2, s['y'] + s['h'] / 2), count=2)
            page.wait_for_selector('.text-editor')
            page.keyboard.type('Hello flow')
            page.keyboard.press('Escape')
            page.wait_for_timeout(100)
            s = [e for e in app.els() if e['id'] == s['id']][0]
            assert s['text'] == 'Hello flow', s['text']
        ttext()

        @test('Text tool: click empty canvas, type = one undo step; abandoned empty box leaves no history')
        def ttexttool():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 5000, zoom: 1})')  # empty area
            n0 = len(app.els())
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.key('t'); app.click((5300, 5200)); page.wait_for_timeout(100)
            app.key('Escape'); page.wait_for_timeout(100)
            assert len(app.els()) == n0 and app.js('() => window.__flowsketch.history()')['past'] == h0, 'empty text box left history'
            app.key('t'); app.click((5300, 5300))
            page.wait_for_selector('.text-editor')
            page.keyboard.type('Typed'); page.keyboard.press('Escape'); page.wait_for_timeout(100)
            assert [e['text'] for e in app.els('text')][-1:] == ['Typed'], [e['text'] for e in app.els('text')]
            assert app.js('() => window.__flowsketch.history()')['past'] == h0 + 1
            app.key('Escape'); app.key('Control+z'); page.wait_for_timeout(100)
            assert len(app.els()) == n0, 'undo left an element behind'
            # clicking elsewhere while typing keeps the text and the next box is typeable
            app.key('t'); app.click((5300, 5200)); page.wait_for_selector('.text-editor')
            page.keyboard.type('One'); app.click((5300, 5400)); page.wait_for_timeout(100)
            page.keyboard.type('Two'); page.keyboard.press('Escape'); page.wait_for_timeout(100)
            assert [e['text'] for e in app.els('text')][-2:] == ['One', 'Two'], [e['text'] for e in app.els('text')]
            app.key('Escape'); app.key('Control+z'); app.key('Control+z'); page.wait_for_timeout(100)
            assert len(app.els()) == n0
            app.js('(v) => window.__flowsketch.setView(v)', v)
        ttexttool()

        @test('Esc: one press cancels a drag in progress and returns to Select')
        def tesc():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 5000, zoom: 1})')  # empty area
            n0 = len(app.els())
            app.key('a')
            x, y = app.pt(5200, 5200)
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 120, y + 30, steps=4)
            page.keyboard.press('Escape'); page.mouse.up(); page.wait_for_timeout(60)
            assert app.ui()['tool'] == 'select', app.ui()['tool']
            assert len(app.els()) == n0, 'cancelled arrow was kept'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tesc()

        @test('Swap direction: the Inspector button reverses an arrow; one undo restores it')
        def tswap():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 5000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.key('u'); app.drag((5100, 5200), (5260, 5280)); app.drag((5500, 5200), (5660, 5280))
            ids = [e['id'] for e in app.els('shape')[-2:]]
            app.key('a'); app.drag((5180, 5240), (5580, 5240)); app.key('Escape')
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == ids[0] and c['end']['elementId'] == ids[1], (c['start'], c['end'])
            app.click((5380, 5240))
            page.get_by_role('button', name='Swap direction').click(); page.wait_for_timeout(80)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['start']['elementId'] == ids[1] and s['end']['elementId'] == ids[0], (s['start'], s['end'])
            app.key('Escape'); app.key('Control+z'); page.wait_for_timeout(80)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['start']['elementId'] == ids[0], 'undo did not restore the direction'
            # remove the test objects so later tests that use "the last arrow" are unaffected
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            assert not [e for e in app.els() if e['id'] in ids + [c['id']]], 'test objects left behind'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tswap()

        @test('3 · Squiggle intensity: 0 = still, low = subtle, high = stronger (continuous)')
        def t3():
            s = app.els('shape')[0]
            app.click((s['x'] + 10, s['y'] + s['h'] / 2))
            page.get_by_label('Animation style', exact=True).select_option('float')
            def dev():
                m, prev, jump = 0, None, 0
                for i in range(80):
                    f = app.js('(t) => window.__flowsketch.frame(t)', i * 0.05)
                    it = [x for x in f['items'] if x['id'] == s['id']][0]['tf']
                    m = max(m, ((it['x'] - s['x']) ** 2 + (it['y'] - s['y']) ** 2) ** 0.5)
                    if prev: jump = max(jump, ((it['x'] - prev['x']) ** 2 + (it['y'] - prev['y']) ** 2) ** 0.5)
                    prev = it
                return m, jump
            page.get_by_label('Squiggle value').fill('0'); page.wait_for_timeout(50)
            z, _ = dev()
            page.get_by_label('Squiggle value').fill('2'); page.wait_for_timeout(50)
            lo, jlo = dev()
            page.get_by_label('Squiggle value').fill('8'); page.wait_for_timeout(50)
            hi, jhi = dev()
            assert z == 0, z
            assert 0.3 < lo < 4, lo
            assert hi > lo * 2, (lo, hi)
            assert jhi < 2.5, f'per-frame jump too large: {jhi}'
            print(f'      max offset: intensity0={z:.2f}px  intensity2={lo:.2f}px  intensity8={hi:.2f}px  max step@20fps={jhi:.2f}px')
        t3()

        @test('5/6 · Arrow draw-on grows; travelling highlight moves, recolours, reverses')
        def t56():
            c = app.els('connector')[-1]
            app.key('Escape')
            mid = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            mx, my = (mid['s']['x'] + mid['e']['x']) / 2, (mid['s']['y'] + mid['e']['y']) / 2
            app.click((mx, my))
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            page.get_by_label('Arrow animation', exact=True).select_option('travel')
            page.get_by_label('Highlight colour #ec4899').click()
            page.get_by_label('Length value').fill('10')
            def hl(t):
                f = app.js('(t) => window.__flowsketch.frame(t)', t)
                parts = [x for x in f['items'] if x['id'] == c['id']][0]['parts']
                return [p for p in parts if p['k'] == 'line' and p['color'] == '#ec4899']
            a, b = hl(0.50), hl(0.56)
            assert a and b, 'highlight segment missing'
            cx = lambda h: sum(h[0]['pts'][0::2]) / len(h[0]['pts'][0::2])
            dx = cx(b) - cx(a)
            page.get_by_label('Direction').get_by_role('radio', name='← Reverse').click()
            a2, b2 = hl(0.50), hl(0.56)
            dx2 = cx(b2) - cx(a2)
            assert dx * dx2 < 0, f'direction should flip (dx={dx:.1f}, reversed dx={dx2:.1f})'
            page.get_by_label('Arrow animation', exact=True).select_option('drawOn')
            def visible_len(t):
                f = app.js('(t) => window.__flowsketch.frame(t)', t)
                parts = [x for x in f['items'] if x['id'] == c['id']][0]['parts']
                return len(parts[0]['pts']) if parts else 0
            assert visible_len(0.15) < visible_len(0.5), (visible_len(0.15), visible_len(0.5))
            page.get_by_label('Arrow animation', exact=True).select_option('travel')
        t56()

        @test('11 · Pointer accuracy at 200% zoom while animation plays')
        def t11():
            app.js('() => window.__flowsketch.setView({x: 50, y: 50, zoom: 2})')
            page.get_by_label('Play').click() if app.ui()['playing'] is False else None
            s = app.els('shape')[1]
            app.key('Escape'); app.key('Escape')
            app.click((s['x'] + 20, s['y'] + 20))
            assert app.ui()['selection'] == [s['id']], app.ui()['selection']
            x0 = s['x']
            app.drag((s['x'] + s['w'] / 2, s['y'] + s['h'] / 2), (s['x'] + s['w'] / 2 + 20, s['y'] + s['h'] / 2))
            s2 = [e for e in app.els() if e['id'] == s['id']][0]
            assert abs(s2['x'] - (x0 + 20)) < 1.5, (x0, s2['x'])
            app.reset_view()
        t11()

        mod = 'Meta' if 'Mac' in page.evaluate('navigator.platform') else 'Control'
        saved_path = f'{OUT}/e2e-roundtrip.flowsketch'

        @test('7 · Save native file (download fallback)')
        def t7():
            with page.expect_download() as dl:
                app.key(f'{mod}+s')
            dl.value.save_as(saved_path)
            data = json.load(open(saved_path))
            assert data['format'] == 'flowsketch' and data['schemaVersion'] == 1
            assert len(data['elements']) == len(app.els())
        t7()

        before = app.doc()

        @test('8 · Animated GIF export (5 s @ 15 fps) is genuinely animated')
        def t8():
            from PIL import Image, ImageChops
            app.key(f'{mod}+Shift+e')
            page.wait_for_selector('[data-testid=gif-export]')
            page.get_by_role('radio', name='Small').click()
            page.get_by_label('Frames per second').get_by_role('radio', name='15').click()
            page.get_by_label('Duration value').fill('5')
            page.wait_for_timeout(300)
            with page.expect_download(timeout=120000) as dl:
                page.get_by_test_id('gif-export').click()
            path = f'{OUT}/e2e-export.gif'
            dl.value.save_as(path)
            page.wait_for_selector('.result-img')
            page.screenshot(path=f'{OUT}/e2e-gif-dialog.png')
            im = Image.open(path)
            assert im.format == 'GIF'
            n = im.n_frames
            assert n == 75, f'expected 75 frames, got {n}'
            frames = []
            for i in range(n):
                im.seek(i); frames.append(im.convert('RGB'))
            distinct = len({f.tobytes() for f in frames})
            diff = ImageChops.difference(frames[0], frames[20]).getbbox()
            assert distinct > 30 and diff, f'only {distinct} distinct frames'
            durs = []
            for i in range(n):
                im.seek(i); durs.append(im.info.get('duration', 0))
            assert abs(sum(durs) - 5000) <= 40, f'total duration {sum(durs)}ms'
            assert im.info.get('loop', None) == 0, 'should loop forever'
            # seamless: last frame should be close to first
            last_first = ImageChops.difference(frames[0], frames[-1]).getbbox()
            print(f'      {im.size[0]}x{im.size[1]}, {n} frames, {distinct} distinct, total {sum(durs)} ms, {os.path.getsize(path)//1024} KB')
            frames[0].save(f'{OUT}/e2e-gif-frame0.png'); frames[37].save(f'{OUT}/e2e-gif-frame37.png')
            page.keyboard.press('Escape')
            assert app.doc()['elements'] == before['elements'], 'export must not change the document'
        t8()

        @test('PNG + SVG export produce valid files')
        def tpng():
            from PIL import Image
            page.get_by_role('menuitem', name='Export').first.click()
            with page.expect_download() as dl:
                page.get_by_role('menuitem', name='Quick PNG (current frame)').click()
            p = f'{OUT}/e2e.png'; dl.value.save_as(p)
            im = Image.open(p); assert im.format == 'PNG' and im.size[0] > 200
            page.get_by_role('menuitem', name='Export').first.click()
            with page.expect_download() as dl:
                page.get_by_role('menuitem', name='Quick SVG (current frame)').click()
            p = f'{OUT}/e2e.svg'; dl.value.save_as(p)
            s = open(p).read()
            assert s.count('<path') > 10 and '<text' in s and '<image' not in s and '<script' not in s
        tpng()

        @test('Standalone HTML player export')
        def thtml():
            page.get_by_role('menuitem', name='Export').first.click()
            with page.expect_download() as dl:
                page.get_by_role('menuitem', name='Standalone HTML player').click()
            p = f'{OUT}/e2e-player.html'; dl.value.save_as(p)
            pg2 = ctx.new_page()
            errs = []
            pg2.on('pageerror', lambda e: errs.append(str(e)))
            pg2.goto('file://' + os.path.abspath(p))
            pg2.wait_for_timeout(800)
            a = pg2.locator('#fs-player').screenshot()
            pg2.wait_for_timeout(500)
            b = pg2.locator('#fs-player').screenshot()
            pg2.screenshot(path=f'{OUT}/e2e-player.png')
            assert not errs, errs
            assert a != b, 'player should animate'
            pg2.close()
        thtml()

        ctx.close()

        @test('7b · Reload app, open saved file: everything preserved')
        def t7b():
            ctx2, page2, app2, err2 = fresh(browser)
            open_file(page2, mod, saved_path)
            page2.wait_for_timeout(500)
            after = app2.doc()
            strip = lambda d: json.dumps(d['elements'], sort_keys=True)
            assert strip(after) == strip(before), 'elements differ after round trip'
            assert after['animation'] == before['animation']
            f1 = app2.js('() => window.__flowsketch.frame(1.234)')
            data = json.load(open(saved_path))
            assert len(f1['items']) > 5
            page2.screenshot(path=f'{OUT}/e2e-reopened.png')
            ctx2.close()
        t7b()

        @test('12 · Malformed import shows an error; refresh restores autosave')
        def t12():
            ctx3, page3, app3, _ = fresh(browser)
            bad = f'{OUT}/bad.flowsketch'
            open(bad, 'w').write('{"format":"flowsketch","elements": "nope"')
            open_file(page3, mod, bad)
            page3.wait_for_selector('.toast.error')
            assert 'not valid JSON' in page3.locator('.toast.error').inner_text()
            app3.reset_view(); app3.key('o'); app3.drag((100, 100), (220, 180)); app3.key('o'); app3.drag((300, 100), (420, 180))
            page3.wait_for_timeout(1200)  # autosave debounce
            page3.reload(); page3.wait_for_function('() => !!window.__flowsketch'); page3.wait_for_timeout(800)
            assert len(app3.els('shape')) == 2, 'autosave not restored'
            ctx3.close()
        t12()

        @test('Sample templates load and render without errors')
        def tsamples():
            ctx4, page4, app4, err4 = fresh(browser)
            page4.get_by_role('button', name='Templates').click()
            ids = page4.eval_on_selector_all('[data-template]', 'els => els.map(e => e.dataset.template)')
            assert len(ids) >= 7, ids
            page4.on('dialog', lambda d: d.accept())
            for i, tid in enumerate(ids):
                if i: page4.get_by_role('menuitem', name='File').click(); page4.get_by_role('menuitem', name='New from template…').click()
                page4.locator(f'[data-template={tid}]').click()
                if page4.get_by_test_id('confirm-ok').count(): page4.get_by_test_id('confirm-ok').click()
                page4.wait_for_timeout(700)
                page4.screenshot(path=f'{OUT}/sample-{tid}.png')
                assert len(app4.els()) > 4
            assert not err4, err4
            ctx4.close()
        tsamples()

        @test('Performance: 100 shapes + 150 connectors (measured, headless software rendering)')
        def tperf():
            import random
            random.seed(4)
            kinds = ['roundRect', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'rectangle']
            els = []
            for i in range(100):
                els.append({'id': f'p{i}', 'type': 'shape', 'shape': kinds[i % 6], 'x': (i % 10) * 220, 'y': (i // 10) * 160, 'w': 150, 'h': 90, 'seed': i + 1, 'text': f'Step {i}', 'style': {'fill': '#e7e3ff', 'fillStyle': 'solid', 'stroke': '#1e1e2e', 'strokeWidth': 2, 'roughness': 1}})
            for j in range(150):
                a, b = random.randrange(100), random.randrange(100)
                if a == b: b = (b + 1) % 100
                els.append({'id': f'q{j}', 'type': 'connector', 'seed': 500 + j, 'start': {'elementId': f'p{a}', 'x': 0, 'y': 0}, 'end': {'elementId': f'p{b}', 'x': 0, 'y': 0}, 'routing': ['straight', 'curved', 'elbow'][j % 3], 'style': {'stroke': '#4b5563', 'strokeWidth': 2, 'roughness': 1}})
            big = f'{OUT}/perf.flowsketch'
            json.dump({'format': 'flowsketch', 'schemaVersion': 1, 'title': 'Perf', 'elements': els}, open(big, 'w'))
            ctx5, page5, app5, err5 = fresh(browser)
            open_file(page5, mod, big)
            page5.wait_for_timeout(800)
            assert len(app5.els()) == 250
            render_ms = app5.js('() => window.__flowsketch.benchRender(60)')
            fps = app5.js('() => window.__flowsketch.measureFps(3000)')
            # interaction while playing: drag a shape and time it
            app5.js('() => window.__flowsketch.setView({x: 0, y: 0, zoom: 0.6})')
            t0 = time.time(); app5.drag((75, 45), (300, 300), steps=30); drag_s = time.time() - t0
            moved = [e for e in app5.els() if e['id'] == 'p0'][0]
            print(f'      renderDocumentAtTime: {render_ms:.1f} ms/frame · live playback ≈ {fps:.0f} FPS · 30-step drag {drag_s*1000:.0f} ms')
            json.dump({'renderMs': render_ms, 'fps': fps, 'dragMs': drag_s * 1000}, open(f'{OUT}/perf.json', 'w'))
            assert moved['x'] > 100, 'drag should move the shape'
            assert not err5, err5
            ctx5.close()
        tperf()

        @test('Smoke: freehand, eraser, group/align, painter, image, library, presentation, video')
        def tsmoke():
            ctx6, page6, a6, err6 = fresh(browser)
            page6.on('dialog', lambda d: d.accept())
            a6.reset_view()
            a6.key('o'); a6.drag((100, 100), (200, 180)); a6.drag((300, 130), (400, 220))
            a6.key('Escape'); a6.key(f'{mod}+a')
            page6.get_by_role('menuitem', name='Arrange').click(); page6.get_by_role('menuitem', name='Align').click(); page6.get_by_role('menuitem', name='Top').click()
            ells = a6.els('shape')
            assert abs(ells[0]['y'] - ells[1]['y']) < 0.01, [e['y'] for e in ells]
            a6.key(f'{mod}+g')
            assert len(set(tuple(e['groupIds']) for e in a6.els())) == 1 and a6.els()[0]['groupIds']
            a6.key('Escape'); a6.click((150, 140))
            assert len(a6.ui()['selection']) == len(a6.els()) == 2, 'clicking a grouped object selects the group'
            a6.key(f'{mod}+Shift+g'); a6.key('Escape')
            # format painter: copy style of ellipse 1 onto ellipse 2
            a6.key('Escape')
            a6.js("() => null")
            ells = a6.els('shape')
            a6.click((150, 140)); page6.get_by_label('Fill colour #ffe3e3').click(); a6.key('Escape')
            a6.key('f'); a6.click((150, 140)); a6.click((350, 175))
            ells = a6.els('shape')
            assert ells[1]['style']['fill'] == '#ffe3e3', ells[1]['style']['fill']
            # freehand + eraser
            a6.key('p'); a6.drag((100, 400), (300, 460), steps=12)
            assert a6.els('freehand'), 'freehand stroke missing'
            a6.key('e'); a6.drag((150, 430), (250, 440))
            assert not a6.els('freehand'), 'eraser should delete the stroke'
            # image via file chooser
            png = f'{OUT}/e2e-gif-frame0.png'
            a6.key('Escape'); a6.key('Escape')
            with page6.expect_file_chooser() as fc:
                page6.get_by_label('Image (I)').click()
            fc.value.set_files(png); page6.wait_for_timeout(600)
            imgs = a6.els('image')
            assert imgs and a6.doc()['assets'][imgs[0]['assetId']]['dataUrl'].startswith('data:image/png')
            # shape library search
            a6.key('s'); page6.get_by_placeholder('Search shapes').fill('database'); page6.keyboard.press('Enter')
            assert a6.ui()['shapeKind'] == 'cylinder' and a6.ui()['tool'] == 'shape'
            a6.key('Escape')
            # presentation mode hides chrome
            a6.key(f'{mod}+Shift+p'); page6.wait_for_timeout(400)
            assert page6.locator('.topbar').count() == 0 and page6.locator('.toolbar').count() == 0
            page6.screenshot(path=f'{OUT}/e2e-presentation.png')
            page6.keyboard.press('Escape'); page6.wait_for_timeout(200)
            assert page6.locator('.topbar').count() == 1
            # video (if this browser can record)
            fmts = page6.evaluate("() => typeof MediaRecorder !== 'undefined' && ['video/webm;codecs=vp9','video/webm'].some(m => MediaRecorder.isTypeSupported(m))")
            if fmts:
                a6.js("() => window.__flowsketch.pause(0)")
                page6.get_by_role('menuitem', name='Export').first.click(); page6.get_by_role('menuitem', name=re.compile('^Video')).click()
                page6.get_by_label('Repeat loop value').fill('1')
                with page6.expect_download(timeout=60000) as dl:
                    # the dialog offers the browser's first supported format (MP4 or WebM)
                    page6.get_by_role('button', name=re.compile('^Export (WebM|MP4)')).click()
                ext = os.path.splitext(dl.value.suggested_filename)[1] or '.webm'
                vp = f'{OUT}/e2e-video{ext}'; dl.value.save_as(vp)
                assert os.path.getsize(vp) > 5000, os.path.getsize(vp)
                print(f'      video: {os.path.getsize(vp)//1024} KB {ext[1:].upper()}')
            assert not err6, err6
            ctx6.close()
        tsmoke()

        @test('No uncaught page errors during the session')
        def tnoerr():
            assert not errors, errors
        tnoerr()
        browser.close()

    ok = sum(1 for r in results if r[1])
    print(f'\n{ok}/{len(results)} end-to-end checks passed')
    json.dump(results, open(f'{OUT}/results.json', 'w'), indent=1)
    sys.exit(0 if ok == len(results) else 1)


if __name__ == '__main__':
    main()
