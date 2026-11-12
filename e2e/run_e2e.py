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

    def tool(self, k):
        """Pick a tool by its letter. Esc first: with a shape selected, letters type into it."""
        self.key('Escape')
        self.key(k)

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
            app.tool('r')
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
            app.tool('d')
            page.get_by_label('Stroke colour #c92a2a').click()
            app.tool('r')
            app.drag((100, 330), (260, 420))
            app.drag((320, 330), (480, 420))
            last2 = app.els('shape')[-2:]
            assert all(e['style']['stroke'] == '#1864ab' for e in last2), [e['style']['stroke'] for e in last2]
            app.tool('d')
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
            app.tool('u')
            app.drag((900, 150), (1040, 230))
            sid = app.els('shape')[-1]['id']
            app.tool('v')
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
            app.tool('a')
            app.drag((190, 200), (410, 200))  # rect 1 centre -> rect 2 centre
            c = app.els('connector')[-1]
            s0, s1 = app.els('shape')[0], app.els('shape')[1]
            assert c['start']['elementId'] == s0['id'] and c['end']['elementId'] == s1['id'], (c['start'], c['end'])
            app.tool('v')
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
            app.tool('t'); app.click((5300, 5200)); page.wait_for_timeout(100)
            app.key('Escape'); page.wait_for_timeout(100)
            assert len(app.els()) == n0 and app.js('() => window.__flowsketch.history()')['past'] == h0, 'empty text box left history'
            app.tool('t'); app.click((5300, 5300))
            page.wait_for_selector('.text-editor')
            page.keyboard.type('Typed'); page.keyboard.press('Escape'); page.wait_for_timeout(100)
            assert [e['text'] for e in app.els('text')][-1:] == ['Typed'], [e['text'] for e in app.els('text')]
            assert app.js('() => window.__flowsketch.history()')['past'] == h0 + 1
            app.key('Escape'); app.key('Control+z'); page.wait_for_timeout(100)
            assert len(app.els()) == n0, 'undo left an element behind'
            # clicking elsewhere while typing keeps the text and the next box is typeable
            app.tool('t'); app.click((5300, 5200)); page.wait_for_selector('.text-editor')
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
            app.tool('a')
            x, y = app.pt(5200, 5200)
            page.mouse.move(x, y); page.mouse.down(); page.mouse.move(x + 120, y + 30, steps=4)
            page.keyboard.press('Escape'); page.mouse.up(); page.wait_for_timeout(60)
            assert app.ui()['tool'] == 'select', app.ui()['tool']
            assert len(app.els()) == n0, 'cancelled arrow was kept'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tesc()

        @test('Icons: Shift+I opens the panel; search, drag and click add icons; arrows attach')
        def ticons():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 5000, zoom: 1})')  # empty area
            app.tool('Shift+I')
            page.wait_for_selector('.icon-cell')
            page.get_by_label('Search icons').fill('database')
            cell = page.locator('.icon-cell[data-icon="tabler:database"]')
            assert cell.count() == 1
            stage = page.get_by_test_id('stage')
            box = stage.bounding_box()
            x, y = app.pt(5500, 5200)
            cell.drag_to(stage, target_position={'x': x - box['x'], 'y': y - box['y']})
            page.wait_for_timeout(100)
            db = app.els('icon')[-1]
            assert db['iconId'] == 'tabler:database', db
            assert abs(db['x'] + db['w'] / 2 - 5500) < 2 and abs(db['y'] + db['h'] / 2 - 5200) < 2, (db['x'], db['y'])
            page.get_by_label('Search icons').fill('server')
            page.locator('.icon-cell[data-icon="tabler:server"]').click(); page.wait_for_timeout(100)
            srv = app.els('icon')[-1]
            assert srv['iconId'] == 'tabler:server'
            doc = app.doc()
            assert set(doc['icons']) >= {'tabler:database', 'tabler:server'}
            assert doc['icons']['tabler:database']['parts'], 'icon data missing from the document'
            # label the database icon (double-click), then connect server -> database
            app.key('Escape')
            app.click((5500, 5200), count=2); page.wait_for_selector('.text-editor')
            page.keyboard.type('Orders DB'); page.keyboard.press('Escape'); page.wait_for_timeout(80)
            assert [e for e in app.els('icon') if e['id'] == db['id']][0]['text'] == 'Orders DB'
            app.tool('a'); app.drag((srv['x'] + 28, srv['y'] + 28), (5500, 5200)); app.key('Escape')
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == srv['id'] and c['end']['elementId'] == db['id'], (c['start'], c['end'])
            # the icons stay (later save/export tests then cover them); the arrow is undone so tests that use "the last arrow" are unaffected
            app.key('Control+z'); page.wait_for_timeout(80)
            assert not [e for e in app.els('connector') if e['id'] == c['id']]
            app.tool('Shift+I')
            assert page.locator('.icons-panel').count() == 0, 'Shift+I should close the panel'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        ticons()

        @test('Icon libraries: logos with gradients, your own SVG/PNG library, SVG dropped on the canvas')
        def ticonlibs():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 6000, zoom: 1})')  # empty area
            app.tool('Shift+I'); page.wait_for_selector('.icon-cell')
            stage = page.get_by_test_id('stage')
            box = stage.bounding_box()
            def at(wx, wy):
                x, y = app.pt(wx, wy); return {'x': x - box['x'], 'y': y - box['y']}
            # a colour logo from SVG Logos (search across all sets finds it)
            page.get_by_label('Search icons').fill('firefox')
            page.locator('.icon-cell[data-icon="logos:firefox"]').wait_for()
            page.locator('.icon-cell[data-icon="logos:firefox"]').drag_to(stage, target_position=at(5300, 6200))
            page.wait_for_timeout(100)
            ff = app.els('icon')[-1]
            assert ff['iconId'] == 'logos:firefox'
            icon = app.doc()['icons']['logos:firefox']
            assert any(isinstance(p['fill'], dict) and p['fill']['stops'] for p in icon['parts']), 'gradients were not kept'
            # your own library: an SVG and a PNG added through "Add icons"
            svg = os.path.join(OUT, 'team-db.svg')
            open(svg, 'w').write('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" onload="alert(1)"><script>alert(1)</script><rect x="3" y="3" width="18" height="18" rx="4" fill="#7048e8"/></svg>')
            from PIL import Image
            png = os.path.join(OUT, 'team-badge.png'); Image.new('RGB', (32, 32), (43, 138, 62)).save(png)
            page.get_by_label('Search icons').fill('')
            page.get_by_role('button', name='Add icons').click()
            page.get_by_label('New library name').fill('E2E team')
            with page.expect_file_chooser() as fc:
                page.get_by_role('button', name='Choose files…').click()
            fc.value.set_files([svg, png])
            page.wait_for_selector('.note.ok')
            assert 'Added 2 icons' in page.locator('.note.ok').inner_text()
            page.keyboard.press('Escape')
            page.locator('.ip-chips .chip', has_text='E2E team').click()
            page.locator('.icon-cell[data-icon$=":team-db"]').drag_to(stage, target_position=at(5500, 6200)); page.wait_for_timeout(100)
            mine = app.els('icon')[-1]
            assert mine['iconId'].endswith(':team-db'), mine['iconId']
            parts = app.doc()['icons'][mine['iconId']]['parts']
            assert parts and 'script' not in json.dumps(parts) and 'alert' not in json.dumps(parts)
            page.locator('.icon-cell[data-icon$=":team-badge"]').click(); page.wait_for_timeout(100)
            assert app.els()[-1]['type'] == 'image', 'a PNG from a library is placed as an image'
            # an SVG file dropped straight onto the canvas becomes an icon in this diagram
            dt = page.evaluate_handle("(t) => { const d = new DataTransfer(); d.items.add(new File([t], 'dropped.svg', {type: 'image/svg+xml'})); return d; }", open(svg).read())
            x, y = app.pt(5700, 6200)
            stage.dispatch_event('drop', {'dataTransfer': dt, 'clientX': x, 'clientY': y})
            page.wait_for_timeout(200)
            assert app.els('icon')[-1]['iconId'].startswith('file:dropped'), app.els('icon')[-1]['iconId']
            app.tool('Shift+I')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        ticonlibs()

        @test('Cloud icons: an AWS-style ZIP becomes a categorised library under AWS terms')
        def tziplib():
            import zipfile
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 7000, zoom: 1})')  # empty area
            pack = os.path.join(OUT, 'Asset-Package_e2e.zip')  # built here: provider icons are never stored in the repo
            svg = lambda c: f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="{c}"/></svg>'
            with zipfile.ZipFile(pack, 'w') as z:
                base = 'Asset-Package_e2e/Architecture-Service-Icons_07312025'
                for size in (32, 64):
                    z.writestr(f'{base}/Arch_Compute/{size}/Arch_AWS-Lambda_{size}.svg', svg('#ed7100'))
                    z.writestr(f'{base}/Arch_Storage/{size}/Arch_Amazon-Simple-Storage-Service_{size}.svg', svg('#7aa116'))
                z.writestr('__MACOSX/._x.svg', 'junk')
            app.tool('Shift+I'); page.wait_for_selector('.icon-cell')
            page.get_by_role('button', name='Add icons').click()
            row = page.locator('.iconlibs li', has_text='AWS Architecture Icons').first
            with page.expect_file_chooser() as fc:
                row.get_by_role('button', name='Choose ZIP…').click()
            fc.value.set_files(pack)
            page.wait_for_selector('.note.ok')
            assert 'Added 2 icons to “AWS Architecture Icons”' in page.locator('.note.ok').inner_text(), page.locator('.note.ok').inner_text()
            page.keyboard.press('Escape')
            page.locator('.ip-chips .chip', has_text='AWS Architecture').click()
            heads = [h.split('\n')[0].upper() for h in page.locator('.ip-sec h3').all_inner_texts()]
            assert heads == ['COMPUTE', 'STORAGE'], heads
            stage = page.get_by_test_id('stage'); box = stage.bounding_box()
            x, y = app.pt(5300, 7200)
            page.locator('.icon-cell[data-icon$=":aws-lambda"]').drag_to(stage, target_position={'x': x - box['x'], 'y': y - box['y']})
            page.wait_for_timeout(100)
            assert app.els('icon')[-1]['iconId'].endswith(':aws-lambda')
            assert 'AWS terms' in page.locator('.inspector .insp-tip').first.inner_text()
            app.tool('Shift+I')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tziplib()

        @test('Right-click menu and containers: wrap, rename, move with contents, join and leave')
        def tcontainer():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 8000, zoom: 1})')  # empty area
            app.tool('u'); app.drag((5100, 8200), (5240, 8280)); app.drag((5400, 8200), (5540, 8280)); app.key('Escape')
            a, b = app.els('shape')[-2:]
            app.drag((5060, 8160), (5600, 8320))  # selection box around both
            assert set(app.ui()['selection']) == {a['id'], b['id']}, app.ui()['selection']
            x, y = app.pt(5170, 8240)
            page.mouse.click(x, y, button='right'); page.wait_for_selector('.ctx-menu')
            page.locator('.ctx-menu [role=menuitem]', has_text='Add container').click()
            page.wait_for_selector('.text-editor')
            page.keyboard.press('Control+a'); page.keyboard.type('Payments'); page.keyboard.press('Escape'); page.wait_for_timeout(80)
            c = app.els('container')[-1]
            assert c['text'] == 'Payments' and set(c['members']) == {a['id'], b['id']}, c
            # drag the container by its title bar: the shapes come along
            app.drag((c['x'] + 100, c['y'] + 12), (c['x'] + 160, c['y'] + 52))
            a2 = [e for e in app.els() if e['id'] == a['id']][0]
            assert (round(a2['x'] - a['x']), round(a2['y'] - a['y'])) == (60, 40), (a2['x'], a2['y'])
            # drag b out: it leaves; drag it back in: it joins again
            b2 = [e for e in app.els() if e['id'] == b['id']][0]
            app.drag((b2['x'] + 70, b2['y'] + 40), (b2['x'] + 70, b2['y'] + 400))
            assert b['id'] not in app.els('container')[-1]['members']
            app.drag((b2['x'] + 70, b2['y'] + 400), (b2['x'] + 70, b2['y'] + 40))
            assert b['id'] in app.els('container')[-1]['members']
            # right-click empty canvas: the canvas menu, with the grid choice
            x, y = app.pt(5900, 8700)
            page.mouse.click(x, y, button='right'); page.wait_for_selector('.ctx-menu')
            assert page.locator('.ctx-menu [role=menuitem]', has_text='Select all').count() == 1
            page.locator('.ctx-menu [role=menuitem]', has_text='Grid').click()
            page.locator('.ctx-menu .menu-pop.sub [role^=menuitem]', has_text='Line grid').click()
            assert app.doc()['canvas']['grid'] == 'lines'
            app.key('Control+z')  # back to the dot grid; the container stays for the save/export tests
            assert app.doc()['canvas']['grid'] == 'dots'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tcontainer()

        @test('Swap direction: the Inspector button reverses an arrow; one undo restores it')
        def tswap():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 5000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('u'); app.drag((5100, 5200), (5260, 5280)); app.drag((5500, 5200), (5660, 5280))
            ids = [e['id'] for e in app.els('shape')[-2:]]
            app.tool('a'); app.drag((5180, 5240), (5580, 5240)); app.key('Escape')
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == ids[0] and c['end']['elementId'] == ids[1], (c['start'], c['end'])
            app.click((5380, 5240))
            page.get_by_role('button', name='Swap direction').click(); page.wait_for_timeout(80)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['start']['elementId'] == ids[1] and s['end']['elementId'] == ids[0], (s['start'], s['end'])
            app.key('Escape'); app.key('Control+z'); page.wait_for_timeout(80)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['start']['elementId'] == ids[0], 'undo did not restore the direction'
            # round trip: choose it in the Inspector, pick a return colour; the highlight comes back in that colour
            app.click((5380, 5240))
            page.get_by_role('radiogroup', name='Direction').get_by_role('radio', name='⇄ Round trip').click()
            page.get_by_label('Return colour #8b5cf6').click(); page.wait_for_timeout(80)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['anim']['direction'] == 'roundTrip' and s['anim']['returnColor'] == '#8b5cf6', s.get('anim')
            dur = app.doc()['animation']['duration']
            cols = set()
            for i in range(40):
                f = app.js('(t) => window.__flowsketch.frame(t)', dur * i / 40)
                it = [x for x in f['items'] if x['id'] == c['id']][0]
                cols |= {p['color'] for p in it['parts'] if p['k'] == 'line'}
            assert '#8b5cf6' in cols and '#3b82f6' in cols, cols
            app.key('Escape')
            # remove the test objects so later tests that use "the last arrow" are unaffected
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            assert not [e for e in app.els() if e['id'] in ids + [c['id']]], 'test objects left behind'
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tswap()

        @test('Arrow labels can be dragged off the line; the arrow stays put; one undo step')
        def tlabeldrag():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 7000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('u'); app.drag((5100, 7200), (5260, 7280)); app.drag((5500, 7200), (5660, 7280))
            ids = [e['id'] for e in app.els('shape')[-2:]]
            app.tool('a'); app.drag((5180, 7240), (5580, 7240))
            page.keyboard.type('go'); app.key('Escape')  # the new arrow is selected: typing labels it
            c = app.els('connector')[-1]
            assert c['text'] == 'go' and c['labelOffset'] == 0, (c['text'], c['labelOffset'])
            app.key('Escape')
            before = app.js('() => window.__flowsketch.history()')['past']
            app.drag((5380, 7240), (5395, 7290))  # press on the label, drag it below the line
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert abs(abs(s['labelOffset']) - 50) < 3 and 0.5 < s['labelPos'] < 0.6, (s['labelOffset'], s['labelPos'])
            assert s['start'] == c['start'] and s['end'] == c['end'] and s['bends'] == c['bends'], 'the arrow itself moved'
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            assert app.js('() => window.__flowsketch.history()')['past'] == before + 1, 'not one undo step'
            # the label is drawn where it was dropped
            box = app.js('(id) => { const f = window.__flowsketch.frame(0); const t = f.items.filter((i) => i.id === id + ":label").flatMap((i) => i.parts).find((p) => p.k === "text"); return t ? t.lines.map((l) => l.y) : null }', c['id'])
            assert box and min(box) > 7270, box
            # dragging it back near the line snaps it onto the line
            app.drag((5395, 7290), (5395, 7243))
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['labelOffset'] == 0, s['labelOffset']
            app.key('Control+z'); app.key('Control+z')
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['labelOffset'] == 0 and s['labelPos'] == 0.5, 'undo did not restore the label'
            # the label's side handles set its width; the text wraps and the box grows downwards
            app.click((5290, 7240)); page.keyboard.type('one two three four five six seven'); app.key('Escape')
            app.click((5290, 7240))
            def lbox():
                pts = app.js('(id) => window.__flowsketch.frame(0).items.find((i) => i.id === id + ":label").parts[0].pts', c['id'])
                xs, ys = pts[0::2], pts[1::2]
                return min(xs), min(ys), max(xs), max(ys)
            x0, y0, x1, y1 = lbox()
            app.drag((x1, (y0 + y1) / 2), ((x0 + x1) / 2 + 45, (y0 + y1) / 2))
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s.get('labelWidth') and abs(s['labelWidth'] - 90) <= 2, s.get('labelWidth')
            nx0, ny0, nx1, ny1 = lbox()
            assert abs((nx1 - nx0) - s['labelWidth']) < 1 and (ny1 - ny0) > (y1 - y0) * 2, ((x0, y0, x1, y1), (nx0, ny0, nx1, ny1))
            assert s['start'] == c['start'] and s['end'] == c['end'], 'the arrow moved'
            page.screenshot(path=f'{OUT}/label-width.png')
            page.get_by_role('button', name='Fit label to its text').click(); page.wait_for_timeout(60)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert 'labelWidth' not in s or s['labelWidth'] is None, s.get('labelWidth')
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tlabeldrag()

        @test('Cmd/Ctrl-drag and Alt-drag duplicate: the original stays, the copy moves; one undo step')
        def tdupdrag():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 9000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('u'); app.drag((5100, 9100), (5260, 9180)); app.key('Escape')
            orig = app.els('shape')[-1]
            n = len(app.els())
            # Ctrl stands in for Cmd here (the test browser is not a Mac)
            for mod, to in (('Control', (5480, 9180)), ('Alt', (5180, 9380))):
                before = app.js('() => window.__flowsketch.history()')['past']
                app.drag((5180, 9140), to, mods=[mod])
                els = app.els()
                assert len(els) == n + 1, (mod, len(els), n)
                o = [e for e in els if e['id'] == orig['id']][0]
                assert (o['x'], o['y']) == (orig['x'], orig['y']), (mod, 'the original moved')
                copy = els[-1]
                assert copy['type'] == 'shape' and abs(copy['x'] - (orig['x'] + to[0] - 5180)) < 2 and abs(copy['y'] - (orig['y'] + to[1] - 9140)) < 2, (mod, copy['x'], copy['y'])
                assert app.ui()['selection'] == [copy['id']], (mod, app.ui()['selection'])
                assert app.js('() => window.__flowsketch.history()')['past'] == before + 1, (mod, 'not one undo step')
                n += 1
            # a plain drag still just moves
            app.drag((5180, 9140), (5200, 9160))
            assert len(app.els()) == n
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tdupdrag()

        @test('Elbow waypoints: drag a segment bar to slide it; Reset route; double-click removes a waypoint')
        def twaypoints():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 11000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('u'); app.drag((5100, 11200), (5260, 11280)); app.drag((5500, 11380), (5660, 11460))
            ids = [e['id'] for e in app.els('shape')[-2:]]
            app.tool('a'); app.drag((5180, 11240), (5580, 11420))
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == ids[0] and c['end']['elementId'] == ids[1]
            page.get_by_role('radiogroup', name='Routing').get_by_role('radio', name='Elbow').click(); page.wait_for_timeout(80)
            app.key('Escape'); app.click((5380, 11330))  # select the arrow by its vertical middle segment
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            before = app.js('() => window.__flowsketch.history()')['past']
            app.drag((5380, 11330), (5300, 11330))  # the bar on that segment: slide it left
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            xs = sorted({round(b['x']) for b in s['bends']})
            assert len(s['bends']) == 2 and all(abs(x - 5300) <= 10 for x in xs), s['bends']
            assert s['start'] == c['start'] and s['end'] == c['end'], 'the ends moved'
            assert app.js('() => window.__flowsketch.history()')['past'] == before + 1, 'not one undo step'
            page.screenshot(path=f'{OUT}/elbow-waypoints.png')
            # the route goes through the new segment position: the middle of the arrow is now at x ≈ 5300
            app.key('Escape'); app.click((xs[0], 11330))
            assert app.ui()['selection'] == [c['id']], 'the arrow is not at its new route'
            page.get_by_role('button', name='Reset route').click(); page.wait_for_timeout(60)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['bends'] == [], s['bends']
            # straight arrows: a waypoint added from the mid-dot can be removed with a double-click
            page.get_by_role('radiogroup', name='Routing').get_by_role('radio', name='Straight').click(); page.wait_for_timeout(80)
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            mid = ((ends['s']['x'] + ends['e']['x']) / 2, (ends['s']['y'] + ends['e']['y']) / 2)
            app.drag(mid, (mid[0], mid[1] + 60))
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert len(s['bends']) == 1, s['bends']
            app.click((s['bends'][0]['x'], s['bends'][0]['y']), count=2)
            s = [e for e in app.els('connector') if e['id'] == c['id']][0]
            assert s['bends'] == [] and not app.ui().get('editingId'), (s['bends'], app.ui().get('editingId'))
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        twaypoints()

        @test('Three snap points per side: an arrow drawn between quarter ports attaches to them')
        def tports():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 13000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r'); app.drag((5100, 13100), (5300, 13180)); app.drag((5100, 13400), (5300, 13480))
            ids = [e['id'] for e in app.els('shape')[-2:]]
            app.tool('a')
            x0, y0 = app.pt(5150, 13180); x1, y1 = app.pt(5252, 13398)
            page.mouse.move(x0, y0); page.mouse.down(); page.mouse.move(x1, y1, steps=10); page.wait_for_timeout(80)
            page.screenshot(path=f'{OUT}/ports.png')
            page.mouse.up(); page.wait_for_timeout(80)
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == ids[0] and c['end']['elementId'] == ids[1], (c['start'], c['end'])
            assert c['start']['anchor'] == {'x': 0.25, 'y': 1} and c['end']['anchor'] == {'x': 0.75, 'y': 0}, (c['start']['anchor'], c['end']['anchor'])
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            assert abs(ends['s']['x'] - 5150) < 1 and abs(ends['e']['x'] - 5250) < 1, ends
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tports()

        @test('Set play order: click arrows to number them, Shift-click joins a step, Esc finishes; plays in that order')
        def tplayorder():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 15000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r')
            for i in range(4): app.drag((5100 + i * 220, 15100), (5220 + i * 220, 15160))
            app.tool('a')
            for i in range(3): app.drag((5160 + i * 220, 15130), (5380 + i * 220, 15130))
            app.key('Escape')
            cs = app.els('connector')[-3:]
            page.get_by_role('menuitem', name='Animation').click()
            page.get_by_role('menuitem', name='Set play order…').click(); page.wait_for_timeout(80)
            assert app.ui()['playOrderMode'] is True
            assert page.get_by_role('toolbar', name='Set play order').is_visible()
            def along(c, f):
                e = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
                return (e['s']['x'] + (e['e']['x'] - e['s']['x']) * f, e['s']['y'] + (e['e']['y'] - e['s']['y']) * f)
            app.click(along(cs[2], 0.3)); app.click(along(cs[0], 0.3))
            x, y = app.pt(*along(cs[1], 0.3)); page.keyboard.down('Shift'); page.mouse.click(x, y); page.keyboard.up('Shift'); page.wait_for_timeout(60)
            page.screenshot(path=f'{OUT}/play-order.png')
            win = {e['id']: e.get('anim', {}).get('window') for e in app.els('connector') if e['id'] in [c['id'] for c in cs]}
            assert win[cs[2]['id']][0] == 0 and win[cs[0]['id']] == win[cs[1]['id']] and win[cs[0]['id']][0] == 0.5, win
            assert app.ui()['selection'] == [], 'clicks in the mode must not select'
            # it plays: step 1 = the third arrow alone, step 2 = the first two together
            L = app.doc()['animation']['duration']
            def lit(t):
                f = app.js('(t) => window.__flowsketch.frame(t)', t)
                return [any(p['k'] == 'line' and p.get('color') == '#3b82f6' for p in [x for x in f['items'] if x['id'] == c['id']][0]['parts']) for c in cs]
            assert lit(L * 0.2) == [False, False, True], lit(L * 0.2)
            assert lit(L * 0.7) == [True, True, False], lit(L * 0.7)
            # clicking a numbered arrow takes it out; Esc finishes
            app.click(along(cs[2], 0.3))
            assert not [e for e in app.els('connector') if e['id'] == cs[2]['id']][0].get('anim', {}).get('window')
            app.key('Escape')
            assert app.ui()['playOrderMode'] is False and not page.get_by_role('toolbar', name='Set play order').is_visible()
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tplayorder()

        @test('Quick-connect: hover handles add a connected copy (click), connect shapes or drop a copy (drag), Ctrl+Arrow')
        def tquick():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 9000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('u'); app.drag((5100, 9200), (5260, 9280)); app.key('Escape'); app.key('Escape')
            a = app.els('shape')[-1]
            cx, cy = a['x'] + a['w'] / 2, a['y'] + a['h'] / 2
            hover = lambda: page.mouse.move(*app.pt(cx, cy))
            # click the right-hand handle: a copy appears to the right, joined by an arrow, and is selected
            hover(); page.wait_for_timeout(80)
            n = len(app.els())
            app.click((a['x'] + a['w'] + 40, cy))
            b = app.els('shape')[-1]
            c = app.els('connector')[-1]
            assert len(app.els()) == n + 2, 'expected a new shape and an arrow'
            assert (b['shape'], round(b['w']), round(b['h'])) == (a['shape'], round(a['w']), round(a['h'])) and b['x'] > a['x'] + a['w'], b
            assert c['start']['elementId'] == a['id'] and c['end']['elementId'] == b['id'], (c['start'], c['end'])
            assert app.ui()['selection'] == [b['id']]
            # drag from a's bottom handle onto b: just an arrow between them
            app.key('Escape'); hover(); page.wait_for_timeout(80)
            n = len(app.els())
            app.drag((cx, a['y'] + a['h'] + 40), (b['x'] + b['w'] / 2, b['y'] + b['h'] / 2), steps=12)
            c2 = app.els('connector')[-1]
            assert len(app.els()) == n + 1 and c2['start']['elementId'] == a['id'] and c2['end']['elementId'] == b['id'], (c2['start'], c2['end'])
            # drag from a's left handle to empty canvas: a copy is dropped there
            hover(); page.wait_for_timeout(80)
            app.drag((a['x'] - 40, cy), (4800, 9500), steps=12)
            d = app.els('shape')[-1]
            assert abs(d['x'] + d['w'] / 2 - 4800) < 2 and abs(d['y'] + d['h'] / 2 - 9500) < 2, (d['x'], d['y'])
            assert app.els('connector')[-1]['end']['elementId'] == d['id']
            # Ctrl+ArrowDown from the selected shape
            app.key('Escape'); app.click((cx, cy)); assert app.ui()['selection'] == [a['id']]
            app.key('Control+ArrowDown')
            e2 = app.els('shape')[-1]
            assert e2['y'] > a['y'] + a['h'] and abs(e2['x'] - a['x']) < 1, (e2['x'], e2['y'])
            app.key('Control+z')
            assert e2['id'] not in [x['id'] for x in app.els()], 'one undo removes the shape and its arrow'
            # rest on a handle: the shape picker opens; pick an ellipse
            app.key('Escape'); hover(); page.wait_for_timeout(80)
            page.mouse.move(*app.pt(cx, a['y'] - 40)); page.wait_for_selector('.qc-pop', timeout=3000)
            page.screenshot(path=f'{OUT}/e2e-quick-picker.png')
            page.locator('.qc-pop [role=menuitem][aria-label="Ellipse / circle"]').click(); page.wait_for_timeout(80)
            el = app.els('shape')[-1]
            assert el['shape'] == 'ellipse' and el['y'] + el['h'] < a['y'], el
            assert app.els('connector')[-1]['end']['elementId'] == el['id']
            assert page.locator('.qc-pop').count() == 0
            assert app.js("() => JSON.parse(localStorage.getItem('flowsketch.prefs.v1')).recentQuickShapes")[0] == 'ellipse'
            page.screenshot(path=f'{OUT}/e2e-quick-connect.png')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tquick()

        @test('Ctrl-drawing a shape moves its fill to the next palette colour and remembers it')
        def tcycle():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 11000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r')
            base = app.js("() => window.__flowsketch.toolStyle('shape:rectangle')")['style']['fill']
            app.drag((5100, 11200), (5200, 11260))
            plain = app.els('shape')[-1]['style']['fill']
            assert plain == base, (plain, base)
            app.drag((5300, 11200), (5400, 11260), mods=['Control'])
            f1 = app.els('shape')[-1]['style']['fill']
            app.drag((5500, 11200), (5600, 11260), mods=['Control'])
            f2 = app.els('shape')[-1]['style']['fill']
            app.drag((5700, 11200), (5800, 11260))
            f3 = app.els('shape')[-1]['style']['fill']
            assert f1 != base and f2 != f1 and f3 == f2, (base, f1, f2, f3)
            assert app.js("() => window.__flowsketch.toolStyle('shape:rectangle')")['style']['fill'] == f2
            assert page.locator('.toast', has_text='Fill:').count() >= 1
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tcycle()

        @test('Match size: right-click ▸ Match size ▸ Width/Both resizes the selection to the first selected shape')
        def tmatch():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 13000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r'); app.drag((5100, 13200), (5300, 13300)); app.drag((5500, 13200), (5550, 13240)); app.key('Escape')
            a, b = app.els('shape')[-2:]
            app.click((5200, 13250)); page.keyboard.down('Shift'); app.click((5525, 13220)); page.keyboard.up('Shift')
            assert app.ui()['selection'] == [a['id'], b['id']], app.ui()['selection']
            def menu(choice):
                x, y = app.pt(5525, 13220) if choice == 'Width' else app.pt(5200, 13250)
                page.mouse.click(x, y, button='right'); page.wait_for_selector('.ctx-menu')
                page.locator('.ctx-menu [role=menuitem]', has_text='Match size').click()
                page.locator('.ctx-menu .menu-pop.sub [role^=menuitem]', has_text=choice).click(); page.wait_for_timeout(80)
            menu('Width')
            b2 = [e for e in app.els() if e['id'] == b['id']][0]
            assert round(b2['w']) == round(a['w']) and round(b2['h']) == round(b['h']), b2  # width only
            app.key('Control+z')
            menu('Both')
            b3 = [e for e in app.els() if e['id'] == b['id']][0]
            assert (round(b3['w']), round(b3['h'])) == (round(a['w']), round(a['h'])), b3
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.key('Escape')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tmatch()

        @test('Diagram from text: Mermaid dialog inserts shapes, arrows and a container; Auto-layout arranges along arrows')
        def tmermaid():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 15000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart TB\n  A[Start] --> B{OK?}\n  B -->|yes| C[(Store)]\n  subgraph Backend\n    C\n  end')
            assert 'Will add 3 shapes, 2 arrows and 1 container' in page.locator('.modal .note.ok').inner_text()
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            els = app.els()[n0:]
            kinds = sorted(e['type'] for e in els)
            assert kinds == ['connector', 'connector', 'container', 'shape', 'shape', 'shape'], kinds
            sh = {e['text']: e for e in els if e['type'] == 'shape'}
            assert sh['Start']['y'] < sh['OK?']['y'] < sh['Store']['y'], [(k, s['y']) for k, s in sh.items()]
            assert sh['OK?']['shape'] == 'diamond' and sh['Store']['shape'] == 'cylinder'
            assert [e for e in els if e['type'] == 'connector'][1]['text'] == 'yes'
            # one undo removes the whole inserted diagram
            app.key('Control+z'); assert len(app.els()) == n0
            # Auto-layout: three shapes in a row joined a -> b -> c, laid out top to bottom
            app.tool('r'); app.drag((5100, 15200), (5200, 15260)); app.drag((5400, 15200), (5500, 15260)); app.drag((5700, 15200), (5800, 15260)); app.key('Escape')
            a, b, c = app.els('shape')[-3:]
            for x, y in ((a, b), (b, c)):
                app.tool('a'); app.drag((x['x'] + 50, x['y'] + 30), (y['x'] + 50, y['y'] + 30)); app.key('Escape')
            app.key('Escape')
            page.get_by_role('menuitem', name='Arrange').click()
            page.get_by_role('menuitem', name='Auto-layout diagram').click()
            page.locator('.menu-pop.sub [role^=menuitem]', has_text='Top to bottom').click(); page.wait_for_timeout(100)
            ys = [[e for e in app.els() if e['id'] == s['id']][0]['y'] for s in (a, b, c)]
            assert ys[0] < ys[1] < ys[2], ys
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tmermaid()

        @test('Draw then type: a new shape or arrow is selected (tool stays), the Inspector shows it, typing labels it')
        def tdrawtype():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 17000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r'); app.drag((5100, 17200), (5260, 17280))
            r = app.els('shape')[-1]
            ui = app.ui()
            assert ui['tool'] == 'shape' and ui['selection'] == [r['id']], ui
            assert 'Defaults for the next shapes' not in page.locator('.inspector').inner_text(), 'Inspector should show the new shape'
            page.keyboard.type('Hello'); page.wait_for_selector('.text-editor')
            page.keyboard.press('Escape'); page.wait_for_timeout(80)
            assert [e for e in app.els() if e['id'] == r['id']][0]['text'] == 'Hello'
            # an arrow: drawn, selected, typed label
            app.tool('r'); app.drag((5500, 17200), (5660, 17280))
            app.tool('a'); app.drag((5180, 17240), (5580, 17240))
            c = app.els('connector')[-1]
            assert app.ui()['selection'] == [c['id']] and app.ui()['tool'] == 'arrow'
            page.keyboard.type('yes'); page.keyboard.press('Escape'); page.wait_for_timeout(80)
            assert [e for e in app.els() if e['id'] == c['id']][0]['text'] == 'yes'
            # Esc from a drawing tool also clears the selection, so letter shortcuts work again
            app.tool('r'); app.drag((5100, 17400), (5200, 17460))
            app.key('Escape'); assert app.ui()['tool'] == 'select' and app.ui()['selection'] == []
            app.key('o'); assert app.ui()['tool'] == 'shape' and app.ui()['shapeKind'] == 'ellipse'
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tdrawtype()

        @test('Arrow routing: Curved really curves, Elbow corners round with a corner radius')
        def trouting():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 19000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r'); app.drag((5100, 19200), (5200, 19260)); app.drag((5500, 19400), (5600, 19460))
            app.tool('a'); app.drag((5150, 19230), (5550, 19430))
            c = app.els('connector')[-1]
            assert c['routing'] == 'straight', c['routing']
            routing = page.get_by_role('radiogroup', name='Routing')
            routing.get_by_role('radio', name='Curved').click(); page.wait_for_timeout(80)
            c2 = [e for e in app.els() if e['id'] == c['id']][0]
            assert c2['routing'] == 'curved' and abs(c2['curvature']) > 0.1, (c2['routing'], c2['curvature'])
            routing.get_by_role('radio', name='Elbow').click(); page.wait_for_timeout(80)
            page.get_by_label('Corner radius value').fill('24'); page.wait_for_timeout(80)
            c3 = [e for e in app.els() if e['id'] == c['id']][0]
            assert c3['routing'] == 'elbow' and c3['elbowRadius'] == 24, (c3['routing'], c3['elbowRadius'])
            app.js('() => window.__flowsketch.pause(0)'); page.wait_for_timeout(150)
            page.screenshot(path=f'{OUT}/e2e-rounded-elbow.png')
            page.get_by_test_id('play').click()  # resume playback for the tests that follow
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        trouting()

        @test('Pages: add, rename, switch (each page keeps its own shapes), delete; sequence diagram pasted on a page')
        def tpages():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            first = app.doc()['activePage']
            page.get_by_role('button', name='Add page').click(); page.wait_for_timeout(100)
            d = app.doc()
            assert len(d['pages']) == 2 and d['activePage'] != first and app.els() == [], d['pages']
            tab = page.get_by_role('tab', name='Page 2')
            tab.dblclick(); page.get_by_label('Page name').fill('Flows'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            assert [p['name'] for p in app.doc()['pages']][1] == 'Flows'
            # a sequence diagram from text, on this page
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('sequenceDiagram\n  participant A as Client\n  participant B as API\n  A->>B: GET /orders\n  B-->>A: 200 OK')
            assert 'will add 2 participants and 2 messages' in page.locator('.modal .note.ok').inner_text()
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            kinds = sorted(e['type'] for e in app.els())
            assert kinds == ['connector'] * 4 + ['shape'] * 2, kinds  # 2 lifelines + 2 messages
            # an arrow drawn from lifeline to lifeline attaches to both participants
            a, b = [e for e in app.els() if e['type'] == 'shape']
            y = a['y'] + a['h'] + 160
            app.tool('a'); app.drag((a['x'] + a['w'] / 2, y), (b['x'] + b['w'] / 2, y)); app.key('Escape')
            c = app.els('connector')[-1]
            assert c['start']['elementId'] == a['id'] and c['end']['elementId'] == b['id'], (c['start'], c['end'])
            # switch back: page 1 is as it was; switch again: the sequence diagram is still there
            page.get_by_role('tab', name='Page 1').click(); page.wait_for_timeout(80)
            assert len(app.els()) == n0 and app.doc()['activePage'] == first
            page.get_by_role('tab', name='Flows').click(); page.wait_for_timeout(80)
            assert len(app.els()) == 7
            page.screenshot(path=f'{OUT}/e2e-pages-sequence.png')
            # delete the page (it asks first, since it has shapes)
            page.get_by_role('tab', name='Flows').click(button='right'); page.wait_for_selector('.ctx-menu')
            page.locator('.ctx-menu [role=menuitem]', has_text='Delete page').click()
            page.get_by_test_id('confirm-ok').click(); page.wait_for_timeout(100)
            assert len(app.doc()['pages']) == 1 and app.doc()['activePage'] == first and len(app.els()) == n0
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            assert len(app.doc()['pages']) == 1
        tpages()

        @test('Sequence tools: draw participants, messages, a reply, a self-message and a frame by hand')
        def tseqtools():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 21000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            def pick(label):
                app.key('Escape')
                page.get_by_role('button', name='Sequence diagram tools').click()
                page.locator('.seq-pop [role=menuitem]', has_text=label).first.click()
            pick('Actor'); app.click((5150, 21150)); page.keyboard.type('User'); page.keyboard.press('Escape')
            pick('Participant'); app.click((5450, 21170)); page.keyboard.type('API'); page.keyboard.press('Escape'); page.wait_for_timeout(80)
            boxes = [e for e in app.els('shape') if e['text'] in ('User', 'API')][-2:]
            u, api = boxes
            assert u['shape'] == 'pill' and api['shape'] == 'rectangle' and u['y'] == api['y'], (u['y'], api['y'])
            ucx, acx = u['x'] + u['w'] / 2, api['x'] + api['w'] / 2
            pick('Message'); app.drag((ucx, 21300), (acx + 3, 21330)); page.keyboard.type('GET /orders'); page.keyboard.press('Escape')
            msg = app.els('connector')[-1]
            assert msg['start']['elementId'] == u['id'] and msg['end']['elementId'] == api['id'] and msg['text'] == 'GET /orders'
            assert abs(msg['start']['anchor']['y'] - msg['end']['anchor']['y']) < 1e-9, 'messages stay level'
            pick('Reply'); app.drag((acx, 21380), (ucx, 21380)); page.keyboard.type('200 OK'); page.keyboard.press('Escape')
            rep = app.els('connector')[-1]
            assert rep['start']['elementId'] == api['id'] and rep['style']['strokeStyle'] == 'dashed' and rep['text'] == '200 OK'
            pick('Message to itself'); app.click((acx, 21440)); page.keyboard.press('Escape')
            self_m = app.els('connector')[-1]
            assert self_m['start']['elementId'] == self_m['end']['elementId'] == api['id'] and self_m['routing'] == 'curved'
            # an activation bar on API, then a message arriving while it's active stops at its edge
            pick('Activation'); app.drag((acx, 21500), (acx, 21620)); page.keyboard.press('Escape')
            bar = [e for e in app.els('connector') if e.get('bar')]
            assert len(bar) == 1 and bar[0]['start']['elementId'] == api['id'], bar
            pick('Message'); app.drag((ucx, 21560), (acx, 21560)); page.keyboard.press('Escape')
            hit = app.els('connector')[-1]
            assert hit['end']['elementId'] == api['id'] and abs(hit['end']['anchor']['x'] * api['w'] + api['x'] - (acx - 6)) < 0.5, hit['end']
            pick('Frame'); app.drag((ucx - 40, 21280), (acx + 60, 21420)); page.wait_for_selector('.text-editor')
            page.keyboard.type('loop every second'); page.keyboard.press('Escape'); page.wait_for_timeout(80)
            fr = [e for e in app.els('container') if e['text'] == 'loop every second']
            assert fr and app.els()[0]['id'] == fr[0]['id'], 'the frame goes to the back'
            # lifelines were lengthened past the self-message
            api_life = [e for e in app.els('connector') if e['start']['elementId'] == api['id'] and e['end']['elementId'] == api['id'] and e['start']['anchor']['y'] == 1][0]
            assert api['y'] + api_life['end']['anchor']['y'] * api['h'] > 21440 + 50
            app.js('() => window.__flowsketch.pause(0)'); page.wait_for_timeout(150)
            page.screenshot(path=f'{OUT}/e2e-sequence-tools.png')
            page.get_by_test_id('play').click()
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tseqtools()

        @test('Message-by-message playback: an imported sequence diagram lights up one message at a time; Play together undoes it')
        def tplayback():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 23000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('sequenceDiagram\n  A->>B: one\n  B->>C: two\n  C-->>A: three')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            new = app.els()[n0:]
            msgs = sorted([e for e in new if e['type'] == 'connector' and e.get('anim', {}).get('window')], key=lambda e: e['anim']['window'][0])
            assert [m['text'] for m in msgs] == ['one', 'two', 'three'], [m.get('text') for m in msgs]
            L = app.doc()['animation']['duration']
            def lit(t):
                f = app.js('(t) => window.__flowsketch.frame(t)', t)
                out = []
                for m in msgs:
                    it = [x for x in f['items'] if x['id'] == m['id']][0]
                    out.append(any(p['k'] == 'line' and p.get('color') == '#3b82f6' for p in it['parts']))
                return out
            assert lit(L * 0.15) == [True, False, False], lit(L * 0.15)
            assert lit(L * 0.48) == [False, True, False], lit(L * 0.48)
            assert lit(L * 0.80) == [False, False, True], lit(L * 0.80)
            # right-click a message: Play arrows together
            app.key('Escape')
            m = [e for e in app.els() if e['id'] == msgs[0]['id']][0]
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', m['id'])
            x, y = app.pt((ends['s']['x'] + ends['e']['x']) / 2, ends['s']['y'])
            page.mouse.click(x, y, button='right'); page.wait_for_selector('.ctx-menu')
            page.locator('.ctx-menu [role=menuitem]', has_text='Play arrows together').click(); page.wait_for_timeout(80)
            assert not [e for e in app.els() if e['id'] == m['id']][0].get('anim', {}).get('window')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tplayback()

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
            page.get_by_test_id('play').click() if app.ui()['playing'] is False else None
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
            assert data['format'] == 'flowsketch' and data['schemaVersion'] == 10
            page_els = [p for p in data['pages'] if p['id'] == data['activePage']][0]['elements']
            assert len(page_els) == len(app.els())
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
            assert s.count('<path') > 10 and '<text' in s and '<script' not in s
            # images in the export are only ever embedded rasters (e.g. a PNG from an icon library)
            assert all(h.startswith(('data:image/png', 'data:image/jpeg', 'data:image/gif', 'data:image/webp')) for h in re.findall(r'<image href="([^"]*)"', s))
            assert re.search(r'<(linear|radial)Gradient ', s), 'logo gradients missing from the SVG'
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
