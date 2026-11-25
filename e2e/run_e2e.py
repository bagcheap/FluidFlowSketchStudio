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

        @test('Shift-drag moves a selected shape straight across or down (stays selected); Shift-click adds and removes')
        def tshiftmove():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 23000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r'); app.drag((5100, 23200), (5220, 23260)); app.drag((5400, 23200), (5520, 23260)); app.key('Escape')
            a, b = app.els('shape')[-2:]
            app.click((5160, 23230))
            assert app.ui()['selection'] == [a['id']]
            app.drag((5160, 23230), (5300, 23250), mods=['Shift'])  # mostly sideways, a little down
            m = [e for e in app.els() if e['id'] == a['id']][0]
            assert abs(m['x'] - (a['x'] + 140)) < 2 and abs(m['y'] - a['y']) < 0.5, ('not kept level', m['x'], m['y'], a['x'], a['y'])
            assert app.ui()['selection'] == [a['id']], ('deselected', app.ui()['selection'])
            app.drag((5300, 23230), (5310, 23330), mods=['Shift'])  # mostly down
            m = [e for e in app.els() if e['id'] == a['id']][0]
            assert abs(m['x'] - (a['x'] + 140)) < 2 and abs(m['y'] - (a['y'] + 100)) < 2, ('not kept vertical', m['x'], m['y'])
            # Shift-click: adds the other shape, then takes it out again
            x, y = app.pt(5460, 23230)
            page.keyboard.down('Shift'); page.mouse.click(x, y); page.keyboard.up('Shift'); page.wait_for_timeout(60)
            assert sorted(app.ui()['selection']) == sorted([a['id'], b['id']]), app.ui()['selection']
            page.keyboard.down('Shift'); page.mouse.click(x, y); page.keyboard.up('Shift'); page.wait_for_timeout(60)
            assert app.ui()['selection'] == [a['id']], app.ui()['selection']
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tshiftmove()

        @test('Moving a shape re-routes its routed elbow arrows round the shapes; they meet the shape straight on')
        def treroute():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 25000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r')
            app.drag((5100, 25250), (5220, 25310)); app.drag((5360, 25210), (5440, 25350)); app.drag((5580, 25250), (5700, 25310))
            a, mid, b = app.els('shape')[-3:]
            app.tool('a'); app.drag((5160, 25280), (5640, 25280))
            c = app.els('connector')[-1]
            page.get_by_role('radiogroup', name='Routing').get_by_role('radio', name='Elbow').click(); page.wait_for_timeout(60)
            page.get_by_role('menuitem', name='Arrange').click()
            page.get_by_role('menuitem', name='Route arrows around shapes').click(); page.wait_for_timeout(100)
            old = [e for e in app.els() if e['id'] == c['id']][0]
            assert old['bends'], 'not routed'
            app.key('Escape')
            before = app.js('() => window.__flowsketch.history()')['past']
            app.drag((5640, 25280), (5240, 25480), steps=12)  # b goes below and to the left, under a
            nb = [e for e in app.els() if e['id'] == b['id']][0]
            assert abs(nb['y'] - (b['y'] + 200)) < 2, 'b did not move'
            r = [e for e in app.els() if e['id'] == c['id']][0]
            assert r['bends'] != old['bends'], 'kept the old waypoints'
            assert app.js('() => window.__flowsketch.history()')['past'] == before + 1, 'not one undo step'
            f = app.js('(id) => window.__flowsketch.frame(0).items.find((i) => i.id === id)', c['id'])
            pts = [p for part in f['parts'] if part['k'] == 'line' for p in zip(part['pts'][0::2], part['pts'][1::2])]
            for s_ in (a, mid, nb):
                assert not any(s_['x'] + 3 < x < s_['x'] + s_['w'] - 3 and s_['y'] + 3 < y < s_['y'] + s_['h'] - 3 for x, y in pts), ('through a shape', s_['id'])
            # it meets b straight on: the end segment runs across b's side, not along it
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            an = r['end']['anchor']
            near = [(x, y) for x, y in pts if abs(x - ends['e']['x']) + abs(y - ends['e']['y']) < 18]
            if an['y'] in (0, 1):
                assert max(abs(x - ends['e']['x']) for x, y in near) < 4, ('not straight into the top/bottom', an, near)
            else:
                assert max(abs(y - ends['e']['y']) for x, y in near) < 4, ('not straight into the side', an, near)
            page.screenshot(path=f'{OUT}/reroute-on-move.png')
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        treroute()

        @test('Arrowhead size: set on the arrow tool, new arrows get it; set on a selected arrow, it grows')
        def theadsize():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 27000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            before_ts = app.js('() => window.__flowsketch.toolStyle("arrow")')
            app.tool('a')  # the tool's defaults are in the Inspector
            page.get_by_label('Arrowhead size value').fill('200'); page.get_by_label('Arrowhead size value').press('Enter'); page.wait_for_timeout(80)
            assert app.js('() => window.__flowsketch.toolStyle("arrow")').get('headSize') == 2, app.js('() => window.__flowsketch.toolStyle("arrow")').get('headSize')
            app.drag((5100, 27200), (5400, 27200))
            c = app.els('connector')[-1]
            assert c.get('headSize') == 2, c.get('headSize')
            # on the selected arrow (selected right after drawing): 300%
            page.get_by_label('Arrowhead size value').fill('300'); page.get_by_label('Arrowhead size value').press('Enter'); page.wait_for_timeout(80)
            c = [e for e in app.els() if e['id'] == c['id']][0]
            assert c.get('headSize') == 3, c.get('headSize')
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            # put the tool's remembered size back for the tests that follow
            app.tool('a'); page.get_by_label('Arrowhead size value').fill(str(round((before_ts.get('headSize') or 1) * 100))); page.get_by_label('Arrowhead size value').press('Enter'); app.key('Escape')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        theadsize()

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
            for i in range(4): app.drag((5100 + i * 220, 15300), (5220 + i * 220, 15360))
            app.tool('a')
            for i in range(3): app.drag((5160 + i * 220, 15330), (5380 + i * 220, 15330))
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
            mid = lambda c: (lambda w: (w[0] + w[1]) / 2 * L)(app.js('(id) => window.__flowsketch.playWindow(id)', c['id']))
            assert lit(mid(cs[2])) == [False, False, True], lit(mid(cs[2]))
            assert lit(mid(cs[0])) == [True, True, False], lit(mid(cs[0]))
            # clicking a numbered arrow takes it out; Esc finishes
            app.click(along(cs[2], 0.3))
            assert not [e for e in app.els('connector') if e['id'] == cs[2]['id']][0].get('anim', {}).get('window')
            app.key('Escape')
            assert app.ui()['playOrderMode'] is False and not page.get_by_role('toolbar', name='Set play order').is_visible()
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tplayorder()

        @test('Numbered labels: an imported flowchart plays 1, 2, 3, 4a+4b, 5; badges show 4a and 4b')
        def tlabelorder():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 21000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('graph LR\n  A -->|1. one| B\n  B -->|2. two| C\n  C -->|3. three| D\n  D -->|4a. up| E\n  D -->|4b. down| F\n  E -->|5. five| G')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            arrows = [e for e in app.els()[n0:] if e['type'] == 'connector']
            starts = {e['text']: e['anim']['window'][0] for e in arrows}
            assert starts['4a. up'] == starts['4b. down'] and starts['3. three'] < starts['4a. up'] < starts['5. five'], starts
            page.get_by_role('menuitem', name='Animation').click()
            page.get_by_role('menuitem', name='Set play order…').click(); page.wait_for_timeout(100)
            badges = page.eval_on_selector_all('svg.stage-overlay text', 'els => els.map((e) => e.textContent)')
            assert sorted(badges) == ['1', '2', '3', '4a', '4b', '5'], badges
            page.screenshot(path=f'{OUT}/label-order.png')
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tlabelorder()

        @test('Step captions and highlighted boxes: switched on from the Animation menu, shown while each step plays')
        def tcaptions():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 29000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('graph LR\n  A[Browser] -->|1. Sign in| B[Portal]\n  B -->|2. Ask the agent| C[Agent]\n  C -->|3. Answer| D[Model]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape')
            for name in ('Step captions', 'Highlight each step'):
                page.get_by_role('menuitem', name='Animation').click()
                page.get_by_role('menuitemcheckbox', name=name).click() if page.get_by_role('menuitemcheckbox', name=name).count() else page.get_by_role('menuitem', name=name).click()
                page.wait_for_timeout(60)
            a = app.doc()['animation']
            assert a.get('captions') is True and a.get('stepFocus') is True, a
            L = a['duration']
            seen = []
            for i in range(40):
                f = app.js('(t) => window.__flowsketch.frame(t)', L * (i + 0.5) / 40)
                c = f.get('caption')
                if c and c['alpha'] > 0.9 and (not seen or seen[-1] != c['text']): seen.append(c['text'])
            assert seen == ['1. Sign in', '2. Ask the agent', '3. Answer'], seen
            # mid step 2, the Portal and Agent glow and the Browser is dimmed
            new = app.els()[n0:]
            shapes = {e['text']: e for e in new if e['type'] == 'shape'}
            t2 = None
            for i in range(80):
                t = L * i / 80
                f = app.js('(t) => window.__flowsketch.frame(t)', t)
                if f.get('caption') and f['caption']['text'] == '2. Ask the agent' and f['caption']['alpha'] == 1: t2 = t; break
            assert t2 is not None
            items = {it['id']: it for it in f['items']}
            assert items[shapes['Browser']['id']]['opacity'] < 0.9 and items[shapes['Agent']['id']]['opacity'] == 1, (items[shapes['Browser']['id']]['opacity'], items[shapes['Agent']['id']]['opacity'])
            app.js('(t) => window.__flowsketch.pause(t)', t2); page.wait_for_timeout(200)
            page.screenshot(path=f'{OUT}/step-captions.png')
            page.get_by_test_id('play').click()
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tcaptions()

        @test('Camera moves: switched on from the Animation menu, the presentation zooms in on a step and back out')
        def tcamera():
            from PIL import Image, ImageChops
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 33000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('graph LR\n  A[Browser] -->|1. Sign in| B[Portal]\n  B -->|2. Ask| C[Agent]\n  C -->|3. Answer| D[Model]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape')
            L0 = app.doc()['animation']['duration']
            page.get_by_role('menuitem', name='Animation').click()
            page.get_by_role('menuitemcheckbox', name='Camera follows steps').click()
            a = app.doc()['animation']
            assert a.get('camera') is True and a['duration'] > L0 + 3, (L0, a['duration'])
            L = a['duration']
            m = 'Meta' if 'Mac' in page.evaluate('navigator.platform') else 'Control'
            try:
                app.key(f'{m}+Shift+p'); page.wait_for_timeout(400)
                shots = []
                for f in (0.0, 0.002, 0.5):
                    app.js('(t) => window.__flowsketch.pause(t)', L * f); page.wait_for_timeout(250)
                    path = f'{OUT}/camera-{int(f * 1000)}.png'; page.screenshot(path=path); shots.append(Image.open(path).convert('L'))
                def changed(a, b):
                    d = ImageChops.difference(a, b).point(lambda q: 255 if q > 40 else 0)
                    return sum(d.histogram()[255:]) / (d.width * d.height)
                # whole picture at the start, a close-up mid-loop: those two differ far more than two frames a moment apart
                still, moved = changed(shots[0], shots[1]), changed(shots[0], shots[2])
                assert moved > 0.004 and moved > 5 * still, (still, moved)
            finally:
                if page.locator('.topbar').count() == 0: page.keyboard.press('Escape'); page.wait_for_timeout(200)
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
            assert page.locator('.topbar').count() == 1
            assert not app.doc()['animation'].get('camera')
        tcamera()

        @test('Diagram from text remembers the last script; Route arrows around shapes keeps arrows out of shapes')
        def tmermaidmem():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 17000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            script = 'flowchart LR\n  A[Start] --> B[Middle] --> C[End]\n  A --> C'
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill(script)
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            # opening the dialog again shows the script just used
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            assert page.get_by_label('Flowchart text').input_value() == script, page.get_by_label('Flowchart text').input_value()
            app.key('Escape')
            # A --> C runs straight through B; routing sends it round
            new = app.els()[n0:]
            shapes = {e['text']: e for e in new if e['type'] == 'shape'}
            ac = [e for e in new if e['type'] == 'connector' and e['start']['elementId'] == shapes['Start']['id'] and e['end']['elementId'] == shapes['End']['id']][0]
            app.key('Escape')
            page.get_by_role('menuitem', name='Arrange').click()
            page.get_by_role('menuitem', name='Route arrows around shapes').click(); page.wait_for_timeout(120)
            r = [e for e in app.els() if e['id'] == ac['id']][0]
            assert r['routing'] == 'elbow' and r['bends'], (r['routing'], r['bends'])
            f = app.js('(id) => window.__flowsketch.frame(0).items.find((i) => i.id === id)', ac['id'])
            mid = shapes['Middle']
            pts = [p for part in f['parts'] if part['k'] == 'line' for p in zip(part['pts'][0::2], part['pts'][1::2])]
            assert pts and not any(mid['x'] < x < mid['x'] + mid['w'] and mid['y'] < y < mid['y'] + mid['h'] for x, y in pts), 'still runs through the middle shape'
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tmermaidmem()

        @test('Describe a diagram (AI): key stays local, draft from Claude (faked), change it, insert it')
        def tai():
            app.key('Escape')
            v = app.ui()['view']
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.js('() => window.__flowsketch.setView({x: 9000, y: 21000, zoom: 1})')
            sent = []
            replies = [
                '```mermaid\nflowchart LR\n  U([User]) -->|1. sign in| W[Web app]\n  W -->|2. check| A[(Auth)]\n```',
                'Updated:\n```mermaid\nflowchart LR\n  U([User]) -->|1. sign in| W[Web app]\n  W -->|2. check| A[(Auth)]\n  W -->|3. load| C[Cache]\n```',
                '```mermaid\nflowchart TD\n  U([User]) --> M[Mobile app]\n```',
            ]
            def handle(route):
                req = route.request
                sent.append({'body': json.loads(req.post_data or '{}'), 'headers': req.headers, 'method': req.method})
                if req.method == 'OPTIONS':
                    return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                text = replies[min(len([s for s in sent if s['method'] == 'POST']) - 1, 2)]
                route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                    'id': 'msg_e2e', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': 'end_turn', 'stop_sequence': None,
                    'content': [{'type': 'text', 'text': text}], 'usage': {'input_tokens': 1, 'output_tokens': 1}}))
            page.route('https://api.anthropic.com/**', handle)
            try:
                n0 = len(app.els())
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Describe a diagram…').click()
                assert page.get_by_test_id('ai-draw').is_disabled()  # no key, no description: nothing can be sent
                page.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                page.get_by_test_id('ai-prompt').fill('A user signs in to the web app, which checks the auth service')
                page.get_by_test_id('ai-draw').click()
                page.get_by_test_id('ai-draft').wait_for(timeout=8000)
                posts = [s for s in sent if s['method'] == 'POST']
                assert len(posts) == 1, sent
                b = posts[0]['body']
                assert b['messages'] == [{'role': 'user', 'content': 'A user signs in to the web app, which checks the auth service'}], b['messages']
                assert b['model'] == 'claude-opus-5-5', b['model']
                assert 'sk-ant-e2e-0123456789' in (posts[0]['headers'].get('authorization', '') + posts[0]['headers'].get('x-api-key', ''))
                assert 'Web app' in page.get_by_test_id('ai-draft').input_value()
                # ask for a change: the draft goes back with the request
                assert page.get_by_test_id('ai-prompt').input_value().startswith('A user signs in'), 'the prompt stays in the box'
                page.get_by_test_id('ai-prompt').fill('Add a cache the web app loads from')
                page.get_by_test_id('ai-change').click()
                page.wait_for_function("() => document.querySelector('[data-testid=ai-draft]')?.value.includes('Cache')", timeout=8000)
                b2 = [s for s in sent if s['method'] == 'POST'][1]['body']
                assert [m['role'] for m in b2['messages']] == ['user', 'assistant', 'user'], b2['messages']
                assert 'Web app' in b2['messages'][1]['content']
                page.get_by_test_id('ai-insert').click(); page.wait_for_timeout(200)
                new = app.els()[n0:]
                texts = sorted(e['text'] for e in new if e['type'] == 'shape')
                assert texts == ['Auth', 'Cache', 'User', 'Web app'], texts
                assert len([e for e in new if e['type'] == 'connector']) == 3
                # the key is not remembered unless asked
                assert app.js("() => localStorage.getItem('flowsketch:anthropicKey')") is None
                # reopening shows the prompts used and the Mermaid that was drawn; tweak a prompt and draw again
                app.key('Escape')
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Describe a diagram…').click()
                assert 'Cache' in page.get_by_test_id('ai-draft').input_value()
                assert page.get_by_test_id('ai-prompt').input_value() == 'Add a cache the web app loads from'
                assert page.locator('.ai-prompt-text').all_inner_texts() == ['A user signs in to the web app, which checks the auth service', 'Add a cache the web app loads from']
                page.locator('.ai-prompts li').first.get_by_role('button', name='Edit').click()
                assert page.get_by_test_id('ai-prompt').input_value().startswith('A user signs in')
                page.get_by_label('API key').fill('sk-ant-e2e-0123456789')  # not remembered, so typed again
                page.get_by_test_id('ai-prompt').fill('A user signs in to the mobile app')
                page.get_by_test_id('ai-draw').click()  # Draw again: from this prompt alone
                page.wait_for_function("() => document.querySelector('[data-testid=ai-draft]')?.value.includes('Mobile')", timeout=8000)
                b3 = [s for s in sent if s['method'] == 'POST'][2]['body']
                assert b3['messages'] == [{'role': 'user', 'content': 'A user signs in to the mobile app'}], b3['messages']
                assert page.locator('.ai-prompt-text').all_text_contents() == ['A user signs in to the mobile app'], page.locator('.ai-prompt-text').all_text_contents()
                app.key('Escape')
            finally:
                page.unroute('https://api.anthropic.com/**')
                app.js("() => localStorage.removeItem('flowsketch:aiSession')")
                app.key('Escape')
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)

        tai()

        @test('Change this page (AI): the page goes with the request; suggested changes are listed, one unticked, the rest applied in one undo step')
        def taiedit():
            app.key('Escape')
            v = app.ui()['view']
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.js('() => window.__flowsketch.setView({x: 9000, y: 27000, zoom: 1})')  # empty area
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  W[Web] --> A[API] --> D[(DB)]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            sent = []
            def handle(route):
                req = route.request
                if req.method == 'OPTIONS':
                    return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                body = json.loads(req.post_data or '{}'); sent.append(body)
                content = body['messages'][0]['content']
                items = json.loads(content.split('Current page:\n', 1)[1].split('\n\nRequest:', 1)[0])
                ids = {i.get('label'): i['id'] for i in items if 'label' in i and i.get('label') in ('Web', 'API', 'DB')}
                reply = {'summary': 'Adds a cache under the API and colours the database green.', 'ops': [
                    {'op': 'add_shape', 'ref': 'n1', 'label': 'Cache', 'shape': 'cylinder', 'near': ids['API'], 'place': 'below', 'container': None},
                    {'op': 'connect', 'from': ids['API'], 'to': 'n1', 'label': 'get', 'style': 'dashed', 'heads': 'end'},
                    {'op': 'set_color', 'ids': [ids['DB']], 'fill': '#d3f9d8', 'line': None},
                ]}
                route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                    'id': 'msg_e2e', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': 'end_turn', 'stop_sequence': None,
                    'content': [{'type': 'text', 'text': json.dumps(reply)}], 'usage': {'input_tokens': 1, 'output_tokens': 1}}))
            page.route('https://api.anthropic.com/**', handle)
            try:
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Quick change…').click()
                page.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                page.get_by_test_id('ai-edit-prompt').fill('Add a cache below the API and make the database green')
                page.get_by_test_id('ai-suggest').click()
                page.get_by_test_id('ai-plan').wait_for(timeout=8000)
                assert len(sent) == 1 and sent[0]['output_config']['format']['type'] == 'json_schema'
                assert 'Request: Add a cache below the API' in sent[0]['messages'][0]['content']
                lines = page.locator('.ai-ops li').all_inner_texts()
                assert lines == ['Add cylinder (database) “Cache” below “API”', 'Connect “API” → “Cache” (“get”), dashed', 'Colour “DB”: fill #d3f9d8'], lines
                page.locator('.ai-ops li').nth(2).get_by_role('checkbox').uncheck()  # keep the database's colour
                h1 = app.js('() => window.__flowsketch.history()')['past']
                page.get_by_test_id('ai-apply').click(); page.wait_for_timeout(150)
                assert app.js('() => window.__flowsketch.history()')['past'] == h1 + 1  # one undo step
                els = app.els()
                cache = [e for e in els if e['type'] == 'shape' and e['text'] == 'Cache'][-1]
                api = [e for e in els if e['type'] == 'shape' and e['text'] == 'API'][-1]
                db = [e for e in els if e['type'] == 'shape' and e['text'] == 'DB'][-1]
                assert cache['shape'] == 'cylinder' and cache['y'] > api['y'] + api['h'], (cache, api)
                arrow = [e for e in els if e['type'] == 'connector' and e['text'] == 'get'][0]
                assert arrow['start']['elementId'] == api['id'] and arrow['end']['elementId'] == cache['id'] and arrow['style']['strokeStyle'] == 'dashed'
                assert db['style']['fill'] != '#d3f9d8', 'unticked change was applied'
                assert cache['id'] in app.ui()['selection']
            finally:
                page.unroute('https://api.anthropic.com/**')
                app.js("() => localStorage.removeItem('flowsketch:aiEditAsk')")
                app.key('Escape')
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        taiedit()

        @test('AI key in the browser: remembered only encrypted with a passphrase; after a reload it unlocks with it')
        def tkeyenc():
            c7, p7, a7, e7 = fresh(browser)
            try:
                def api(route):
                    if route.request.method == 'OPTIONS':
                        return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                    route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                        'id': 'm', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': 'end_turn', 'stop_sequence': None,
                        'content': [{'type': 'text', 'text': '```mermaid\nflowchart LR\nA-->B\n```'}], 'usage': {'input_tokens': 1, 'output_tokens': 1}}))
                p7.route('https://api.anthropic.com/**', api)
                def open_dialog():
                    p7.get_by_role('menuitem', name='AI', exact=True).click()
                    p7.get_by_role('menuitem', name='Describe a diagram…').click()
                open_dialog()
                p7.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                p7.get_by_label('Remember in this browser (encrypted with a passphrase)').check()
                p7.locator('#ai-pass').fill('correct horse')
                p7.get_by_test_id('ai-prompt').fill('two boxes')
                p7.get_by_test_id('ai-draw').click()
                p7.get_by_test_id('ai-draft').wait_for(timeout=8000)
                stored = a7.js("() => Object.keys(localStorage).filter(k => k.startsWith('flowsketch:anthropicKey')).map(k => [k, localStorage.getItem(k)])")
                assert [k for k, _ in stored] == ['flowsketch:anthropicKeyEnc'], stored
                assert 'sk-ant-e2e' not in stored[0][1]
                p7.reload(); p7.wait_for_timeout(800)
                open_dialog()
                p7.get_by_test_id('ai-unlock').wait_for(timeout=3000)
                assert p7.get_by_label('API key').input_value() == ''
                p7.locator('#ai-unlock').fill('wrong passphrase'); p7.get_by_test_id('ai-unlock').click()
                p7.get_by_text('That passphrase did not open the saved key').wait_for(timeout=10000)
                p7.locator('#ai-unlock').fill('correct horse'); p7.get_by_test_id('ai-unlock').click()
                p7.wait_for_function("() => document.querySelector('#ai-key')?.value === 'sk-ant-e2e-0123456789'", timeout=10000)
                assert p7.locator('#ai-pass').count() == 0  # the same key, already stored: no new passphrase asked
                assert not e7, e7
            finally:
                c7.close()
        tkeyenc()


        @test('Moving an arrow end drops its old waypoints; an elbow arrow then routes round shapes from where it was dropped')
        def tendmove():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 19000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.tool('r')
            app.drag((5100, 19250), (5220, 19310)); app.drag((5360, 19210), (5440, 19350)); app.drag((5580, 19250), (5700, 19310)); app.drag((5580, 19470), (5700, 19530))
            a, mid, b, d = app.els('shape')[-4:]
            app.tool('a'); app.drag((5160, 19280), (5640, 19280))
            c = app.els('connector')[-1]
            page.get_by_role('radiogroup', name='Routing').get_by_role('radio', name='Elbow').click(); page.wait_for_timeout(60)
            page.get_by_role('menuitem', name='Arrange').click()
            page.get_by_role('menuitem', name='Route arrows around shapes').click(); page.wait_for_timeout(100)
            old = [e for e in app.els() if e['id'] == c['id']][0]['bends']
            assert old, 'not routed'
            # drag the arrow's end from b to the top-middle snap point of d
            ends = app.js('(id) => window.__flowsketch.connectorEnds(id)', c['id'])
            page.keyboard.press('Escape')
            # select the arrow by clicking on its route (the first segment leaves a's right side)
            app.click((ends['s']['x'] + 8, ends['s']['y']))
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            before = app.js('() => window.__flowsketch.history()')['past']
            app.drag((ends['e']['x'], ends['e']['y']), (d['x'] + d['w'] / 2, d['y'] + 1), steps=12)
            r = [e for e in app.els() if e['id'] == c['id']][0]
            assert r['end']['elementId'] == d['id'] and r['end']['anchor'] == {'x': 0.5, 'y': 0}, r['end']
            assert r['bends'] != old, 'kept the old waypoints'
            assert app.js('() => window.__flowsketch.history()')['past'] == before + 1, 'not one undo step'
            f = app.js('(id) => window.__flowsketch.frame(0).items.find((i) => i.id === id)', c['id'])
            pts = [p for part in f['parts'] if part['k'] == 'line' for p in zip(part['pts'][0::2], part['pts'][1::2])]
            for s_ in (a, mid, b, d):
                assert not any(s_['x'] + 2 < x < s_['x'] + s_['w'] - 2 and s_['y'] + 2 < y < s_['y'] + s_['h'] - 2 for x, y in pts), ('through a shape', s_['id'])
            page.screenshot(path=f'{OUT}/end-moved.png')
            app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tendmove()

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

        @test('Select similar: right-click ▸ Select similar ▸ Same kind, then one Inspector change updates them all')
        def tsimilar():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 23000, zoom: 1})')  # empty area
            h0 = app.js('() => window.__flowsketch.history()')['past']
            n0 = len(app.els())
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  A{{One}} --> B{{Two}} --> C{{Three}}\n  C --> D[(Store)]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            new = app.els()[n0:]
            hexes = [e for e in new if e['type'] == 'shape' and e['shape'] == 'hexagon']
            arrows = [e for e in new if e['type'] == 'connector']
            assert len(hexes) == 3 and len(arrows) == 3
            def similar(el, choice):
                app.key('Escape')
                if el['type'] == 'connector':
                    p = app.js('(id) => window.__flowsketch.connectorEnds(id)', el['id'])
                    x, y = app.pt((p['s']['x'] + p['e']['x']) / 2, (p['s']['y'] + p['e']['y']) / 2)
                else:
                    x, y = app.pt(el['x'] + el['w'] / 2, el['y'] + el['h'] / 2)
                page.mouse.click(x, y, button='right'); page.wait_for_selector('.ctx-menu')
                page.locator('.ctx-menu [role=menuitem]', has_text='Select similar').click()
                page.locator('.ctx-menu .menu-pop.sub').get_by_role('menuitem', name=choice, exact=True).click(); page.wait_for_timeout(80)
            similar(hexes[0], 'Same kind')
            sel = set(app.ui()['selection'])
            assert {h['id'] for h in hexes} <= sel, sel
            assert all(e['type'] == 'shape' and e['shape'] == 'hexagon' for e in app.els() if e['id'] in sel)
            assert page.locator('.inspector').get_by_text(f'{len(sel)} × Hexagon').count() >= 1
            page.get_by_label('Fill colour #ffe3e3').click()
            assert all(e['style']['fill'] == '#ffe3e3' for e in app.els() if e['id'] in {h['id'] for h in hexes})
            # arrows: same kind selects every arrow on the page; one arrowhead change applies to all
            similar(arrows[0], 'Same kind')
            sel = set(app.ui()['selection'])
            assert {a['id'] for a in arrows} <= sel and all(e['type'] == 'connector' for e in app.els() if e['id'] in sel), sel
            page.get_by_label('End arrowhead').select_option('triangle'); page.wait_for_timeout(60)
            assert all(e['endHead'] == 'triangle' for e in app.els() if e['id'] in {a['id'] for a in arrows})
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.key('Escape')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tsimilar()

        @test('Arrow highlight (all arrows): a global colour and thickness reach every arrow, replacing an arrow\'s own colour; undo restores it')
        def tglobalarrow():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            c = app.els('connector')[-1]
            # give this arrow its own highlight colour in its Inspector
            mx, my = app.js('''(id) => { const it = window.__flowsketch.frame(0).items.find((i) => i.id === id);
              const p = it.parts.find((q) => q.k === 'line').pts; const k = Math.floor(p.length / 4) * 2; return [p[k], p[k + 1]]; }''', c['id'])
            app.click((mx, my))
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            page.get_by_label('Arrow animation', exact=True).select_option('travel')
            page.get_by_label('Highlight colour #ec4899').click(); page.wait_for_timeout(60)
            mine = [e for e in app.els() if e['id'] == c['id']][0]
            assert mine['anim'].get('highlightColor') == '#ec4899', mine['anim']
            # nothing selected: the canvas Inspector's all-arrows section
            app.key('Escape'); app.key('Escape')  # Select tool, nothing selected
            page.get_by_label('Highlight colour #22c55e').click(); page.wait_for_timeout(60)
            d = app.doc()
            assert d['animation']['connector']['highlightColor'] == '#22c55e'
            mine = [e for e in app.els() if e['id'] == c['id']][0]
            assert 'highlightColor' not in (mine.get('anim') or {}), mine.get('anim')
            page.get_by_label('Thickness value').fill('5'); page.keyboard.press('Enter'); page.wait_for_timeout(60)
            assert app.doc()['animation']['connector']['highlightWidth'] == 5
            f = app.js('(id) => window.__flowsketch.frame(0.4).items.find((i) => i.id === id)', c['id'])
            widths = [p['width'] for p in f['parts'] if p['k'] == 'line' and p['color'] == '#22c55e']
            assert widths and abs(max(widths) - (mine['style']['strokeWidth'] + 5 + 18)) < 0.01, widths
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            back = [e for e in app.els() if e['id'] == c['id']][0]
            assert (back.get('anim') or {}).get('highlightColor') != '#ec4899'
            assert app.doc()['animation']['connector']['highlightColor'] == '#3b82f6'
        tglobalarrow()

        @test('Playing in order: pause between steps, caption size and position, glow for all arrows (Inspector, nothing selected)')
        def tplaysettings():
            app.key('Escape')
            v = app.ui()['view']
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.js('() => window.__flowsketch.setView({x: 9000, y: 31000, zoom: 1})')
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  A[Client] -->|1. ask| B[Server] -->|2. look up| C[(Store)]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            secs0 = app.doc()['animation']['duration']
            page.get_by_label('Pause between steps value').fill('1.5'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            a = app.doc()['animation']
            assert a['stepPause'] == 1.5 and a['duration'] > secs0 + 2, (a.get('stepPause'), secs0, a['duration'])
            page.get_by_label('Step captions').check(); page.wait_for_timeout(60)
            page.get_by_label('Caption size').get_by_role('radio', name='Large').click()
            page.get_by_label('Caption position').get_by_role('radio', name='Top').click(); page.wait_for_timeout(60)
            a = app.doc()['animation']
            assert a['captions'] and a['captionSize'] == 'large' and a['captionPosition'] == 'top', a
            f = app.js('(t) => window.__flowsketch.frame(t)', 0.3)
            assert f.get('caption') and f['caption']['position'] == 'top' and f['caption']['size'] == 'large', f.get('caption')
            page.get_by_label('Glow').first.uncheck(); page.wait_for_timeout(60)
            assert app.doc()['animation']['connector']['glow'] is False
            # the caption is drawn at the top of the live view
            app.js('() => window.__flowsketch.pause && window.__flowsketch.pause(0.3)')
            page.wait_for_timeout(200)
            page.locator('[data-testid=stage]').screenshot(path=f'{OUT}/e2e-caption-top.png')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tplaysettings()

        @test('Diagram theme, shape motion levels and the all-arrows round-trip pause')
        def tthemes():
            app.key('Escape')
            v = app.ui()['view']
            h0 = app.js('() => window.__flowsketch.history()')['past']
            bg0 = app.doc()['canvas']['background']
            app.js('() => window.__flowsketch.setView({x: 12000, y: 34000, zoom: 1})')
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  A[Ask] <--> B[Answer]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            page.locator('[data-theme-id=blueprint]').click(); page.wait_for_timeout(100)
            d = app.doc()
            assert d['canvas']['background'] == '#1c3f72' and d['canvas']['grid'] == 'lines', d['canvas']
            shapes = [e for e in d['elements'] if e['type'] == 'shape' and not e.get('locked')]
            assert shapes and all(e['style']['stroke'] == shapes[0]['style']['stroke'] for e in shapes)
            ts = app.js("() => window.__flowsketch.toolStyle('shape:rectangle')")
            assert ts['style']['stroke'] == shapes[0]['style']['stroke'], ts['style']
            page.locator('[data-testid=stage]').screenshot(path=f'{OUT}/e2e-theme-blueprint.png')
            page.get_by_label('Shape motion').get_by_role('radio', name='Lively').click(); page.wait_for_timeout(60)
            a = app.doc()['animation']
            assert a['shape']['mode'] != 'off' and a['intensityScale'] == 1.8, a
            page.get_by_label('Shape motion').get_by_role('radio', name='Still').click(); page.wait_for_timeout(60)
            assert app.doc()['animation']['shape']['mode'] == 'off'
            page.get_by_label('Round-trip pause value').fill('30'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            assert abs(app.doc()['animation']['connector']['turnPause'] - 0.3) < 1e-6
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            assert app.doc()['canvas']['background'] == bg0
            app.js('(v) => window.__flowsketch.setView(v)', v)
        tthemes()

        @test('Step numbers: typing a taken number moves later steps up and the label-made play order follows; Renumber step labels')
        def trenumber():
            app.key('Escape')
            v = app.ui()['view']
            h0 = app.js('() => window.__flowsketch.history()')['past']
            app.js('() => window.__flowsketch.setView({x: 15000, y: 40000, zoom: 1})')
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  A -->|1. ask| B -->|2a. look up| C\n  B -->|2b. fetch| D\n  D -->|3. reply| E')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            arrows = lambda: {e['text']: e for e in app.els() if e['type'] == 'connector' and e.get('text')}
            fetch_id = arrows()['2b. fetch']['id']
            app.key('Control+f'); page.keyboard.type('2b. fetch'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            app.key('Escape')
            assert app.ui()['selection'] == [fetch_id], app.ui()['selection']
            app.key('Enter'); page.wait_for_selector('.text-editor')
            page.keyboard.press('Control+a'); page.keyboard.type('3. fetch'); page.keyboard.press('Escape'); page.wait_for_timeout(100)
            a = arrows()
            assert set(a) >= {'1. ask', '2a. look up', '3. fetch', '4. reply'}, list(a)
            steps = sorted((e['anim']['window'][0], e['text']) for e in a.values() if (e.get('anim') or {}).get('window'))
            assert [t for _, t in steps] == ['1. ask', '2a. look up', '3. fetch', '4. reply'], steps
            # Renumber step labels tidies "2a" (now alone in its step) to "2"
            page.get_by_role('menuitem', name='Animation').click()
            page.get_by_role('menuitem', name='Renumber step labels').click(); page.wait_for_timeout(80)
            assert '2. look up' in arrows(), list(arrows())
            # draw a new arrow and type "3. new": it becomes step 3, the old 3 and 4 move up, and the order follows
            box = {e['text']: e for e in app.els() if e['type'] == 'shape'}
            mid = lambda e: (e['x'] + e['w'] / 2, e['y'] + e['h'] / 2)
            # the bug: "Set as default style" on an arrow in the order made new arrows join its step
            ask_id = arrows()['1. ask']['id']
            app.key('Control+f'); page.keyboard.type('1. ask'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            app.key('Escape')
            assert app.ui()['selection'] == [ask_id], app.ui()['selection']
            page.get_by_role('menuitem', name='Edit').click()
            page.get_by_role('menuitem', name='Set as default style').click(); page.wait_for_timeout(60)
            assert 'window' not in (app.js("() => window.__flowsketch.toolStyle('arrow')").get('connectorAnim') or {})
            n_before = len(app.els())
            app.tool('a'); app.drag(mid(box['C']), mid(box['E'])); page.wait_for_timeout(80)
            fresh = app.els()[n_before]
            assert fresh['type'] == 'connector' and not (fresh.get('anim') or {}).get('window'), fresh.get('anim')
            page.keyboard.type('3. new'); page.wait_for_selector('.text-editor'); page.keyboard.press('Escape'); page.wait_for_timeout(100)
            a = arrows()
            assert set(a) >= {'1. ask', '2. look up', '3. new', '4. fetch', '5. reply'}, list(a)
            steps = sorted((e['anim']['window'][0], e['text']) for e in a.values() if (e.get('anim') or {}).get('window'))
            assert [t for _, t in steps] == ['1. ask', '2. look up', '3. new', '4. fetch', '5. reply'], steps
            # delete the new step 3 with the Delete key: 4 and 5 close up again, and the order follows
            new_id = arrows()['3. new']['id']
            app.key('Control+f'); page.keyboard.type('3. new'); page.keyboard.press('Enter'); page.wait_for_timeout(80)
            app.key('Escape')
            assert app.ui()['selection'] == [new_id], app.ui()['selection']
            app.key('Delete'); page.wait_for_timeout(100)
            a = arrows()
            steps = sorted((e['anim']['window'][0], e['text']) for e in a.values() if (e.get('anim') or {}).get('window'))
            assert [t for _, t in steps] == ['1. ask', '2. look up', '3. fetch', '4. reply'], steps
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
            app.js('(v) => window.__flowsketch.setView(v)', v)
        trenumber()

        @test('Review panel: lists likely mistakes as you edit; click selects; Renumber fixes a gap; hide; page snapshot for the AI tools')
        def treview():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            page.get_by_role('button', name='Add page').click(); page.wait_for_timeout(100)
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  A[Client] -->|1. ask| B[API]\n  B -->|3. query| C[(Database)]\n  D[Alone]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            page.get_by_role('menuitem', name='View').click()
            page.get_by_role('menuitemcheckbox', name='Review diagram').click(); page.wait_for_timeout(400)
            panel = page.get_by_role('region', name='Review')
            assert panel.is_visible()
            text = panel.inner_text()
            assert 'There is no step 2' in text and '“Alone” isn’t connected to anything' in text, text
            panel.screenshot(path=f'{OUT}/e2e-review.png')
            alone = [e for e in app.els() if e['type'] == 'shape' and e['text'] == 'Alone'][0]
            panel.get_by_role('button', name='Note “Alone” isn’t connected to anything', exact=True).click(); page.wait_for_timeout(80)
            assert app.ui()['selection'] == [alone['id']], app.ui()['selection']
            panel.get_by_role('button', name='Renumber steps').click(); page.wait_for_timeout(400)
            labels = sorted(e['text'] for e in app.els('connector'))
            assert labels == ['1. ask', '2. query'], labels
            assert 'There is no step 2' not in panel.inner_text()
            panel.get_by_role('button', name='Hide: “Alone” isn’t connected to anything').click(); page.wait_for_timeout(100)
            assert 'Nothing to fix on this page' in panel.inner_text() and 'Show 1 hidden' in panel.inner_text(), panel.inner_text()
            panel.get_by_role('button', name='Show 1 hidden').click(); page.wait_for_timeout(60)
            assert 'Alone' in panel.inner_text()
            # drag one shape onto another: the overlap is listed with "Move apart", which separates them
            api = [e for e in app.els() if e['type'] == 'shape' and e['text'] == 'API'][0]
            app.key('Escape')
            app.drag((alone['x'] + alone['w'] / 2, alone['y'] + alone['h'] / 2), (api['x'] + api['w'] / 2 + 20, api['y'] + api['h'] / 2 + 10)); page.wait_for_timeout(400)
            assert '“API” and “Alone” overlap' in panel.inner_text() or '“Alone” and “API” overlap' in panel.inner_text(), panel.inner_text()
            panel.get_by_role('button', name='Move apart').click(); page.wait_for_timeout(400)
            assert 'overlap' not in panel.inner_text(), panel.inner_text()
            snap = app.js('() => window.__flowsketch.snapshot()')
            assert snap and snap['png'] and 100 < snap['width'] <= 1568 and 50 < snap['height'] <= 1568, snap
            panel.get_by_role('button', name='Close review').click(); page.wait_for_timeout(60)
            assert not page.get_by_role('region', name='Review').is_visible()
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
        treview()

        @test('Review with Claude (AI): the brief and page go with the request (strict report tool, picture); findings show in the Review panel; click selects; the brief is saved')
        def taireview():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            page.get_by_role('button', name='Add page').click(); page.wait_for_timeout(100)
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  B[Browser] -->|1. password grant| S[Auth server]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            arrow = app.els('connector')[0]
            sent = []
            def handle(route):
                req = route.request
                if req.method == 'OPTIONS':
                    return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                body = json.loads(req.post_data or '{}'); sent.append(body)
                report = {'summary': 'A SPA sign-in using the password grant, which is no longer recommended.', 'verdict': 'needs changes',
                    'findings': [{'severity': 'error', 'category': 'factual', 'items': ['a1'], 'title': 'Password grant is deprecated',
                                  'explanation': 'The OAuth 2.0 Security BCP says not to use it.', 'suggestion': 'Use authorization code with PKCE.'},
                                 {'severity': 'warning', 'category': 'missing', 'items': [], 'title': 'No token refresh', 'explanation': 'Tokens expire.', 'suggestion': 'Add a refresh step.'},
                                 {'severity': 'suggestion', 'category': 'naming', 'items': ['s2'], 'title': 'Name the server', 'explanation': '', 'suggestion': 'Call it Identity provider.'}],
                    'questions': ['Is there a backend for the frontend?']}
                route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                    'id': 'msg_e2e', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': 'tool_use', 'stop_sequence': None,
                    'content': [{'type': 'tool_use', 'id': 'toolu_1', 'name': 'report_findings', 'input': report}], 'usage': {'input_tokens': 4000, 'output_tokens': 600}}))
            page.route('https://api.anthropic.com/**', handle)
            try:
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Review this page', exact=True).hover()
                page.get_by_role('menuitem', name='Run review…').click()
                page.get_by_label('What it shows').fill('How a single-page app signs a user in')
                page.get_by_label('System or domain').fill('OAuth 2.0')
                page.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                page.locator('.ai-sent summary').click()
                preview = page.get_by_test_id('ai-review-preview').inner_text()
                assert 'What the diagram shows: How a single-page app signs a user in' in preview and '1. password grant' in preview, preview
                page.get_by_role('radiogroup', name='Effort').get_by_role('radio', name='High').click()
                page.get_by_test_id('ai-review').click()
                panel = page.get_by_role('region', name='Claude’s review')
                panel.wait_for(timeout=10000)
                assert len(sent) == 1
                b = sent[0]
                assert b['tools'][0]['name'] == 'report_findings' and b['tools'][0]['strict'] is True and len(b['tools']) == 1, b['tools']
                assert b['output_config']['effort'] == 'high'
                assert [c['type'] for c in b['messages'][0]['content']] == ['text', 'image']
                assert 'System or domain: OAuth 2.0' in b['messages'][0]['content'][0]['text']
                text = panel.inner_text()
                assert 'Password grant is deprecated' in text and 'Suggested: Use authorization code with PKCE.' in text and 'Is there a backend for the frontend?' in text, text
                assert 'needs changes' in text
                panel.screenshot(path=f'{OUT}/e2e-ai-review.png')
                panel.locator('.review-msg', has_text='Password grant is deprecated').click(); page.wait_for_timeout(80)
                assert app.ui()['selection'] == [arrow['id']], app.ui()['selection']
                assert app.doc()['brief']['about'] == 'How a single-page app signs a user in' and app.doc()['brief']['domain'] == 'OAuth 2.0'
                # tick two findings and fix them together: one request; the review list comes back after the agent
                assert panel.get_by_test_id('ai-fix-chosen').is_disabled()
                panel.get_by_role('checkbox', name='Choose: Password grant is deprecated').check()
                panel.get_by_role('checkbox', name='Choose: Name the server').check()
                assert panel.get_by_test_id('ai-fix-chosen').inner_text() == 'Fix 2 with Claude…'
                panel.get_by_test_id('ai-fix-chosen').click()
                agent = page.get_by_role('region', name='Edit with Claude')
                ask = agent.get_by_test_id('agent-ask').input_value()
                assert ask.startswith('Fix these 2 problems found in a review') and '1. Password grant is deprecated.' in ask and '2. Name the server.' in ask and 'No token refresh' not in ask, ask
                assert not page.get_by_role('region', name='Review').is_visible()
                agent.get_by_role('button', name='Close Edit with Claude').click(); page.wait_for_timeout(80)
                assert panel.is_visible(), 'the review list comes back after Edit with Claude closes'
                # mark one as dealt with by hand: it shows as fixed, and "Choose all open" leaves it out
                panel.get_by_role('button', name='Mark as fixed: No token refresh').click(); page.wait_for_timeout(60)
                assert '1 of 3 fixed' in panel.inner_text()
                panel.get_by_role('button', name='Choose all open').click()
                assert panel.get_by_role('checkbox', name='Choose: No token refresh').is_checked() is False
                assert panel.get_by_test_id('ai-fix-chosen').inner_text() == 'Fix 2 with Claude…'
                panel.screenshot(path=f'{OUT}/e2e-ai-review-choose.png')
                panel.get_by_role('button', name='Mark as not fixed: No token refresh').click(); page.wait_for_timeout(60)
                assert 'fixed' not in panel.locator('.ai-choose').inner_text()
                # save the review as Markdown notes
                with page.expect_download() as dl:
                    panel.get_by_role('button', name='Save review notes').click()
                assert dl.value.suggested_filename.endswith('review.md'), dl.value.suggested_filename
                md = open(dl.value.path(), encoding='utf-8').read()
                assert '### 1. Password grant is deprecated' in md and '**Suggested:** Use authorization code with PKCE.' in md and '- **What the diagram shows:** How a single-page app signs a user in' in md, md
                # the dialog remembers the brief and the choices; Clear form empties them
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Review this page', exact=True).hover()
                page.get_by_role('menuitem', name='Run review…').click()
                assert page.get_by_label('What it shows').input_value() == 'How a single-page app signs a user in'
                assert page.get_by_role('radiogroup', name='Effort').get_by_role('radio', name='High').get_attribute('aria-checked') == 'true'
                page.get_by_role('button', name='Clear form').click(); page.wait_for_timeout(60)
                assert page.get_by_label('What it shows').input_value() == '' and page.get_by_label('System or domain').input_value() == ''
                assert page.get_by_role('radiogroup', name='Effort').get_by_role('radio', name='Medium').get_attribute('aria-checked') == 'true'
                assert 'brief' not in app.doc()
                page.locator('.modal .modal-x').click(); page.wait_for_timeout(60)  # the ✕ closes it (the brief was already saved as typed)
                # the panel moves by its title bar, and comes back to the same place when opened again
                rp = page.get_by_role('region', name='Review', exact=True)
                b0 = rp.bounding_box()
                page.mouse.move(b0['x'] + 40, b0['y'] + 16); page.mouse.down(); page.mouse.move(b0['x'] + 340, b0['y'] + 96, steps=6); page.mouse.up(); page.wait_for_timeout(60)
                b1 = rp.bounding_box()
                assert abs(b1['x'] - b0['x'] - 300) < 3 and abs(b1['y'] - b0['y'] - 80) < 3, (b0, b1)
                page.get_by_role('button', name='Close review').click(); page.wait_for_timeout(60)
                page.get_by_role('menuitem', name='View').click(); page.get_by_role('menuitemcheckbox', name='Review diagram').click(); page.wait_for_timeout(80)
                b2 = rp.bounding_box()
                assert abs(b2['x'] - b1['x']) < 2 and abs(b2['y'] - b1['y']) < 2, (b1, b2)
                rp.locator('header').dblclick(position={'x': 30, 'y': 12}); page.wait_for_timeout(60)
                assert abs(rp.bounding_box()['x'] - b0['x']) < 2, 'double-click puts it back'
                # Claude's review and the automatic checks are told apart
                assert rp.get_by_role('region', name='Automatic checks').is_visible() and 'no AI' in rp.get_by_role('region', name='Automatic checks').inner_text()
                assert 'It doesn’t change as you edit' in panel.inner_text()
                # answer Claude's question: kept with the review and sent with the next one
                panel.get_by_label('Your answer: Is there a backend for the frontend?').fill('Yes, a BFF holds the tokens.')
                panel.get_by_test_id('review-with-answers').click()
                assert 'Your answers to 1 question from the last review go with this one' in page.get_by_test_id('ai-review-answers').inner_text()
                n = len(sent)
                page.get_by_test_id('ai-review').click()
                page.wait_for_function('() => !document.querySelector(".modal")', timeout=10000)
                assert len(sent) == n + 1
                assert 'Q: Is there a backend for the frontend?\nA: Yes, a BFF holds the tokens.' in sent[-1]['messages'][0]['content'][0]['text']
                # close Claude's review, then bring it back, with what was fixed, from the panel and from the AI menu
                panel.get_by_role('button', name='Mark as fixed: No token refresh').click(); page.wait_for_timeout(60)
                panel.get_by_role('button', name='Close Claude’s review').click(); page.wait_for_timeout(60)
                assert not page.get_by_role('region', name='Claude’s review').is_visible()
                page.get_by_test_id('show-last-review').click(); page.wait_for_timeout(150)
                assert panel.is_visible() and '1 of 3 fixed' in panel.inner_text(), panel.inner_text()
                page.get_by_role('button', name='Close review').click(); page.wait_for_timeout(60)
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Review this page', exact=True).hover()
                page.get_by_role('menuitem', name='Show last review').click(); page.wait_for_timeout(150)
                assert panel.is_visible() and panel.get_by_role('button', name='Mark as not fixed: No token refresh').is_visible()
                panel.get_by_role('button', name='Close Claude’s review').click(); page.wait_for_timeout(60)
                page.get_by_role('button', name='Close review').click()
            finally:
                page.unroute('https://api.anthropic.com/**')
                if page.locator('.modal').count(): app.key('Escape')
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
        taireview()

        @test('Edit with Claude (agent): tool calls build a draft shown on the canvas (editing blocked), Apply = one undo step, Discard keeps the page')
        def tagent():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            page.get_by_role('button', name='Add page').click(); page.wait_for_timeout(100)
            page.get_by_role('menuitem', name='Insert').click()
            page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            page.get_by_label('Flowchart text').fill('flowchart LR\n  W[Web] -->|1. request| A[API]')
            page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(150)
            app.key('Escape'); app.key('Escape')
            n0 = len(app.els())
            sent = []
            fail400 = False
            script = [
                [{'type': 'text', 'text': 'Adding a cache.'},
                 {'type': 'tool_use', 'id': 't1', 'name': 'add_shape', 'input': {'label': 'Cache', 'shape': 'cylinder', 'near': 's2', 'place': 'below', 'container': None}},
                 {'type': 'tool_use', 'id': 't2', 'name': 'connect', 'input': {'from': 's2', 'to': 's3', 'label': '2. look up', 'style': 'dashed', 'heads': 'end'}}],
                [{'type': 'tool_use', 'id': 't3', 'name': 'lint', 'input': {}}],
                [{'type': 'tool_use', 'id': 't4', 'name': 'finish', 'input': {'summary': 'Added a cache below the API and connected it as step 2.', 'confidence': 'high', 'remaining': ['Check the cache label.']}}],
            ]
            def handle(route):
                req = route.request
                if req.method == 'OPTIONS':
                    return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                body = json.loads(req.post_data or '{}'); sent.append(body)
                if fail400:
                    return route.fulfill(status=400, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                        'type': 'error', 'error': {'type': 'invalid_request_error', 'message': 'tools.5.custom: Invalid schema: ' + 'averyveryverylongunbrokenwordwithoutanyspaces' * 4}}))
                content = script[min(len(sent) - 1, len(script) - 1)]
                stop = 'tool_use' if any(c['type'] == 'tool_use' for c in content) else 'end_turn'
                route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                    'id': 'msg_e2e', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': stop, 'stop_sequence': None,
                    'content': content, 'usage': {'input_tokens': 3000, 'output_tokens': 300}}))
            page.route('https://api.anthropic.com/**', handle)
            try:
                page.get_by_role('menuitem', name='AI', exact=True).click()
                # one highlighted row: the one under the mouse (the first row loses its highlight)
                page.get_by_role('menuitem', name='Edit with Claude…').hover(); page.wait_for_timeout(60)
                lit = page.evaluate('''() => [...document.querySelectorAll('.menu-pop .menu-item')].filter((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)').map((e) => e.textContent)''')
                assert len(lit) == 1 and lit[0].startswith('Edit with Claude'), lit
                page.get_by_role('menuitem', name='Edit with Claude…').click()
                panel = page.get_by_role('region', name='Edit with Claude')
                panel.get_by_test_id('agent-ask').fill('Add a cache below the API')
                panel.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                panel.get_by_role('checkbox', name='Let Claude look at pictures of the draft').uncheck()
                # limits and the estimate before running
                panel.get_by_label('Step limit').select_option('5')
                panel.get_by_label('Spending limit').select_option('0.25')
                est = panel.get_by_test_id('agent-estimate').inner_text()
                assert est.startswith('Estimated cost:') and 'stops at 5 steps or $0.25' in est, est
                panel.get_by_test_id('agent-run').click()
                panel.get_by_test_id('agent-reply').wait_for(timeout=10000)
                assert len(sent) == 3, len(sent)
                strict = [t['name'] for t in sent[0]['tools'] if t.get('strict')]
                assert strict == ['finish'], strict  # only finish: many strict tools compile to a grammar the API rejects
                assert not any(t['name'] == 'snapshot' for t in sent[0]['tools'])
                first = sent[0]['messages'][0]['content']
                assert '## Request\nAdd a cache below the API' in (first if isinstance(first, str) else first[0]['text']), first
                results = sent[1]['messages'][2]['content']
                assert [r['tool_use_id'] for r in results] == ['t1', 't2'] and not any(r.get('is_error') for r in results), results
                text = panel.inner_text()
                assert 'Added a shape' in text and 'Added an arrow' in text and 'Checked the page' in text, text
                assert 'Added “Cache”' in text and 'Added arrow “2. look up”' in text, text
                assert 'Added a cache below the API' in text
                assert 'Claude’s confidence: high' in text and 'Check the cache label.' in text and 'limits 5 steps, $0.25' in text, text
                assert panel.get_by_test_id('agent-checks').inner_text().startswith('Automatic checks: no new problems'), panel.get_by_test_id('agent-checks').inner_text()
                assert 'You have at most 5 steps' in json.dumps(sent[0]['messages'][0])
                assert any(t['name'] == 'finish' and t.get('strict') for t in sent[0]['tools'])
                # the draft is on the canvas, the document is unchanged, and editing is blocked
                assert len(app.els()) == n0, 'the document must not change before Apply'
                page.screenshot(path=f'{OUT}/e2e-agent-draft.png')
                web = [e for e in app.els() if e['type'] == 'shape' and e['text'] == 'Web'][0]
                app.click((web['x'] + web['w'] / 2, web['y'] + web['h'] / 2))
                assert app.ui()['selection'] == [], 'no editing under a draft'
                h1 = app.js('() => window.__flowsketch.history()')['past']
                panel.get_by_test_id('agent-apply').click(); page.wait_for_timeout(150)
                assert not page.get_by_role('region', name='Edit with Claude').is_visible()
                els = app.els()
                assert len(els) == n0 + 2 and any(e['type'] == 'shape' and e['text'] == 'Cache' and e['shape'] == 'cylinder' for e in els)
                assert app.js('() => window.__flowsketch.history()')['past'] == h1 + 1  # one undo step
                app.key('Control+z'); page.wait_for_timeout(80)
                assert len(app.els()) == n0
                # a second run, then Discard: the page stays as it was
                sent.clear()
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Edit with Claude…').click()
                panel.get_by_test_id('agent-ask').fill('Add a cache below the API')
                panel.get_by_test_id('agent-run').click()
                panel.get_by_test_id('agent-reply').wait_for(timeout=10000)
                panel.get_by_role('button', name='Discard').click(); page.wait_for_timeout(80)
                assert panel.get_by_test_id('agent-run').is_visible() and len(app.els()) == n0
                # an API error reads as a plain sentence and wraps: nothing to scroll sideways
                fail400 = True
                panel.get_by_test_id('agent-run').click()
                err = panel.get_by_role('alert'); err.wait_for(timeout=10000)
                et = err.inner_text()
                assert et.startswith('Anthropic could not take that request: tools.5.custom') and '{' not in et, et
                assert page.evaluate('''() => { const s = document.querySelector('.agent-scroll'); return s.scrollWidth <= s.clientWidth + 1; }'''), 'the panel must not scroll sideways'
                fail400 = False
                # the panel resizes from its bottom-right corner, and keeps that size when opened again
                box = panel.bounding_box()
                page.mouse.move(box['x'] + box['width'] - 3, box['y'] + box['height'] - 3); page.mouse.down()
                page.mouse.move(box['x'] + box['width'] + 120, box['y'] + box['height'] + 40, steps=6); page.mouse.up(); page.wait_for_timeout(350)
                w1 = panel.bounding_box()['width']
                assert w1 > box['width'] + 80, (box, w1)
                panel.get_by_role('button', name='Close Edit with Claude').click()
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Edit with Claude…').click()
                assert abs(panel.bounding_box()['width'] - w1) < 2, (panel.bounding_box(), w1)
                panel.locator('header').dblclick(position={'x': 60, 'y': 10}); page.wait_for_timeout(80)
                assert abs(panel.bounding_box()['width'] - box['width']) < 2 and app.js("() => localStorage.getItem('flowsketch:panelSize:agent')") is None
                panel.get_by_role('button', name='Close Edit with Claude').click()
            finally:
                page.unroute('https://api.anthropic.com/**')
                # never leave the panel (and a draft that blocks editing) open for the next tests
                if page.get_by_role('region', name='Edit with Claude').count():
                    page.get_by_role('button', name='Close Edit with Claude').click(); page.wait_for_timeout(80)
                    if page.get_by_test_id('confirm-ok').count(): page.get_by_test_id('confirm-ok').click()
            while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
        tagent()

        @test('Improve the look (AI, faked): layout tools, score before and after, before/after switch, Apply = one undo step')
        def tlook():
            app.key('Escape')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            page.get_by_role('button', name='Add page').click(); page.wait_for_timeout(100)
            v = app.ui()['view']
            app.tool('r'); app.drag((300, 300), (400, 360)); app.drag((460, 308), (560, 368)); app.drag((620, 296), (720, 356)); app.key('Escape')
            app.key('Escape')
            assert len(app.els('shape')) == 3, app.els('shape')
            ys0 = [e['y'] for e in app.els('shape')]
            sent = []
            script = [
                [{'type': 'tool_use', 'id': 't1', 'name': 'layout_score', 'input': {}}],
                [{'type': 'tool_use', 'id': 't2', 'name': 'align', 'input': {'ids': ['s1', 's2', 's3'], 'edge': 'vcenter'}},
                 {'type': 'tool_use', 'id': 't3', 'name': 'layout_score', 'input': {}}],
                [{'type': 'tool_use', 'id': 't4', 'name': 'finish', 'input': {'summary': 'Lined the three shapes up in a row. Score 97 to 100.', 'confidence': 'high', 'remaining': []}}],
            ]
            def handle(route):
                req = route.request
                if req.method == 'OPTIONS':
                    return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'POST'})
                body = json.loads(req.post_data or '{}'); sent.append(body)
                content = script[min(len(sent) - 1, len(script) - 1)]
                route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=json.dumps({
                    'id': 'msg_e2e', 'type': 'message', 'role': 'assistant', 'model': 'claude-opus-5-5', 'stop_reason': 'tool_use', 'stop_sequence': None,
                    'content': content, 'usage': {'input_tokens': 3000, 'output_tokens': 300}}))
            page.route('https://api.anthropic.com/**', handle)
            try:
                page.get_by_role('menuitem', name='AI', exact=True).click()
                page.get_by_role('menuitem', name='Improve the look…').click()
                panel = page.get_by_role('region', name='Improve the look')
                assert panel.get_by_test_id('agent-ask').input_value().startswith('Tidy up the layout')
                now = panel.get_by_test_id('agent-score-now').inner_text()
                assert 'near-miss alignment' in now and '/100' in now, now
                panel.get_by_label('API key').fill('sk-ant-e2e-0123456789')
                panel.get_by_test_id('agent-run').click()
                panel.get_by_test_id('agent-reply').wait_for(timeout=10000)
                assert len(sent) == 3, len(sent)
                assert 'This run is about the LOOK of the page' in sent[0]['system'][0]['text']
                names = [t['name'] for t in sent[0]['tools']]
                assert all(n in names for n in ('align', 'distribute', 'match_size', 'move', 'layout_score')), names
                assert [t['name'] for t in sent[0]['tools'] if t.get('strict')] == ['finish']
                assert '## Layout score now' in json.dumps(sent[0]['messages'][0])
                res = sent[1]['messages'][2]['content'][0]
                assert res['tool_use_id'] == 't1' and json.loads(res['content'][0]['text'])['score'] > 0, res
                sc = ' '.join(panel.get_by_test_id('agent-score').inner_text().split())
                assert sc.startswith('Layout score:') and '→ 100' in sc, sc
                assert [e['y'] for e in app.els('shape')] == ys0, 'the document must not change before Apply'
                ba = panel.get_by_test_id('agent-before-after')
                ba.click(); page.wait_for_timeout(80)
                assert ba.get_attribute('aria-pressed') == 'true' and app.ui()['draftOriginal'] is True
                ba.click(); page.wait_for_timeout(80)
                assert ba.get_attribute('aria-pressed') == 'false'
                page.screenshot(path=f'{OUT}/e2e-look-draft.png')
                h1 = app.js('() => window.__flowsketch.history()')['past']
                panel.get_by_test_id('agent-apply').click(); page.wait_for_timeout(150)
                cy = [round(e['y'] + e['h'] / 2) for e in app.els('shape')]
                assert len(set(cy)) == 1, cy
                assert app.js('() => window.__flowsketch.history()')['past'] == h1 + 1
            finally:
                page.unroute('https://api.anthropic.com/**')
                for name in ('Improve the look', 'Edit with Claude'):
                    if page.get_by_role('region', name=name).count():
                        page.get_by_role('button', name=f'Close {name}').click(); page.wait_for_timeout(80)
                        if page.get_by_test_id('confirm-ok').count(): page.get_by_test_id('confirm-ok').click()
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tlook()

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
            assert c['routing'] == 'elbow', c['routing']  # the arrow tool's built-in default
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
            page.get_by_label('Flowchart text').fill('sequenceDiagram\n  A->>B: one\n  B->>C: two\n  C-->>B: three')
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
            mid = lambda m: (lambda w: (w[0] + w[1]) / 2 * L)(app.js('(id) => window.__flowsketch.playWindow(id)', m['id']))
            assert lit(mid(msgs[0])) == [True, False, False], lit(mid(msgs[0]))
            assert lit(mid(msgs[1])) == [False, True, False], lit(mid(msgs[1]))
            assert lit(mid(msgs[2])) == [False, False, True], lit(mid(msgs[2]))
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
            # points along the drawn line (an elbow arrow need not pass halfway between its ends); the first that selects it
            for frac in (0.5, 0.35, 0.65, 0.2, 0.8):
                mx, my = app.js('''([id, f]) => { const it = window.__flowsketch.frame(0).items.find((i) => i.id === id);
                  const p = it.parts.find((q) => q.k === 'line').pts; const k = Math.floor(p.length / 2 * f) * 2; return [p[k], p[k + 1]]; }''', [c['id'], frac])
                app.js('([x, y]) => window.__flowsketch.setView({x: x - 450, y: y - 380, zoom: 1})', [mx, my])  # the point in clear view
                page.wait_for_timeout(200)
                app.click((mx, my))
                if app.ui()['selection'] == [c['id']]: break
                app.key('Escape')
            assert app.ui()['selection'] == [c['id']], app.ui()['selection']
            # a straight arrow, so the highlight's direction shows as left/right movement (an elbow can be vertical there)
            page.get_by_role('radiogroup', name='Routing').get_by_role('radio', name='Straight').click(); page.wait_for_timeout(60)
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
            assert data['format'] == 'flowsketch' and data['schemaVersion'] == 19
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

        @test('Interactive HTML player: steps with buttons and keys, a note on hover, a link to another page and Back')
        def tinteractive():
            from PIL import Image
            c3, pg, ap, er = fresh(browser)
            if pg.get_by_test_id('start-blank').count(): pg.get_by_test_id('start-blank').click()
            pg.get_by_role('menuitem', name='Insert').click()
            pg.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
            pg.get_by_label('Flowchart text').fill('graph LR\n  A[Browser] -->|1. Sign in| B[Portal]\n  B -->|2. Ask| C[Agent]\n  C -->|3. Answer| D[Model]')
            pg.get_by_test_id('mermaid-insert').click(); pg.wait_for_timeout(200)
            ap.key('Escape')
            pg.get_by_role('button', name='Add page').click(); pg.wait_for_timeout(150)
            ap.reset_view(); ap.tool('r'); ap.drag((100, 100), (260, 190)); ap.key('Escape')
            detail = ap.doc()['activePage']
            pg.locator('.page-tab', has_text='Page 1').click(); pg.wait_for_timeout(200)
            agent = next(e for e in ap.doc()['elements'] if e['type'] == 'shape' and e['text'] == 'Agent')
            ap.click((agent['x'] + agent['w'] / 2, agent['y'] + agent['h'] / 2))
            assert ap.ui()['selection'] == [agent['id']], ap.ui()['selection']
            sec = pg.get_by_role('button', name='Interactive player')
            if sec.get_attribute('aria-expanded') != 'true': sec.click()
            pg.get_by_label('Link to page').select_option(label='Page 2')
            pg.get_by_label('Note on hover').fill('Runs the agent loop')
            el = next(e for e in ap.doc()['elements'] if e['id'] == agent['id'])
            assert el.get('link') == detail and el.get('note') == 'Runs the agent loop', el
            ap.key('Escape')
            pg.get_by_role('menuitem', name='Export').first.click()
            with pg.expect_download() as dl:
                pg.get_by_role('menuitem', name='Standalone HTML player').click()
            path = f'{OUT}/e2e-interactive.html'; dl.value.save_as(path)
            c3.close()
            pc = browser.new_context(viewport={'width': 1200, 'height': 760})
            pl = pc.new_page(); errs = []
            pl.on('pageerror', lambda e: errs.append(str(e)))
            pl.goto('file://' + os.path.abspath(path)); pl.wait_for_timeout(600)
            label = lambda: pl.locator('#fs-bar .fs-step').inner_text()
            pl.keyboard.press('Home'); pl.wait_for_timeout(100)
            assert label().startswith('Start'), label()
            def step(key, want):
                pl.keyboard.press(key)
                for _ in range(100):
                    pl.wait_for_timeout(100)
                    if pl.locator('#fs-bar button[aria-label^="Play"]').inner_text() == '▶': break
                assert label() == want, (key, label(), want)
            step('ArrowRight', 'Step 1 of 3'); step('ArrowRight', 'Step 2 of 3'); step('ArrowLeft', 'Step 1 of 3')
            pl.locator('#fs-bar button[aria-label^="Next"]').click(); pl.wait_for_timeout(100)
            for _ in range(100):
                pl.wait_for_timeout(100)
                if label() == 'Step 2 of 3' and pl.locator('#fs-bar button[aria-label^="Play"]').inner_text() == '▶': break
            assert label() == 'Step 2 of 3', label()
            # the link badge (blue) marks Agent's top-right corner; point just inside it
            pl.screenshot(path=f'{OUT}/e2e-interactive.png')
            im = Image.open(f'{OUT}/e2e-interactive.png').convert('RGB')
            blue = [(x, y) for y in range(70, im.height, 2) for x in range(0, im.width, 2) if abs(im.getpixel((x, y))[0] - 67) < 12 and abs(im.getpixel((x, y))[1] - 97) < 12 and abs(im.getpixel((x, y))[2] - 238) < 12]
            assert blue, 'no link badge'
            bx = sum(p[0] for p in blue) / len(blue); by = sum(p[1] for p in blue) / len(blue)
            pl.mouse.move(bx - 18, by + 18); pl.wait_for_timeout(150)
            tip = pl.locator('#fs-tip')
            assert tip.is_visible() and 'Runs the agent loop' in tip.inner_text() and 'Page 2' in tip.inner_text(), tip.inner_text()
            pl.mouse.click(bx - 18, by + 18); pl.wait_for_timeout(200)
            assert pl.locator('#fs-bar select').input_value() == detail
            assert pl.locator('#fs-bar button', has_text='Back').is_visible()
            pl.keyboard.press('Backspace'); pl.wait_for_timeout(200)
            assert pl.locator('#fs-bar select').input_value() != detail
            assert not pl.locator('#fs-bar button', has_text='Back').is_visible()
            assert not errs, errs
            pc.close()
        tinteractive()

        @test('Renaming the diagram: the next Save asks where, suggesting the new name, even with the title field still focused')
        def trenamesave():
            c4 = browser.new_context(viewport={'width': 1440, 'height': 900})
            # a stand-in for Chrome's save picker: records the suggested names, writes nowhere
            c4.add_init_script("""window.__picks = []; window.showSaveFilePicker = async (o) => { window.__picks.push(o.suggestedName);
              return { name: o.suggestedName, createWritable: async () => ({ write: async () => {}, close: async () => {} }) }; };""")
            pg = c4.new_page(); errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            pg.goto(BASE); pg.wait_for_function('() => !!window.__flowsketch'); pg.wait_for_timeout(300)
            ap = App(pg)
            if pg.get_by_test_id('start-blank').count(): pg.get_by_test_id('start-blank').click()
            ap.reset_view(); ap.tool('r'); ap.drag((100, 100), (260, 190)); ap.key('Escape')
            m = 'Meta' if 'Mac' in pg.evaluate('navigator.platform') else 'Control'
            picks = lambda: pg.evaluate('() => window.__picks')
            ap.key(f'{m}+s'); pg.wait_for_timeout(200)
            assert picks() == ['Untitled diagram.flowsketch'], picks()
            ap.key(f'{m}+s'); pg.wait_for_timeout(200)
            assert len(picks()) == 1, picks()  # writes back, no dialog
            t = pg.get_by_label('Document title')
            t.click(); t.press(f'{m}+a'); t.type('Gemini Enterprise Flow')  # spaces survive typing
            t.press(f'{m}+s'); pg.wait_for_timeout(200)  # still in the field
            assert picks()[-1] == 'Gemini Enterprise Flow.flowsketch', picks()
            assert ap.doc()['title'] == 'Gemini Enterprise Flow'
            ap.key(f'{m}+s'); pg.wait_for_timeout(200)
            assert len(picks()) == 2, picks()  # saved under the new name: writes back again
            assert not errs, errs
            c4.close()
        trenamesave()

        @test('Line jumps: View menu switch draws a hop where two arrows cross; one undo step')
        def tjumps():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 36000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            on0 = bool(app.doc()['canvas'].get('lineJumps'))
            try:
                app.tool('l'); app.drag((5200, 36200), (5200, 36500)); app.key('Escape')  # a vertical line…
                app.tool('a'); app.drag((5050, 36350), (5350, 36350)); app.key('Escape')  # …then an arrow across it
                ids = [e['id'] for e in app.doc()['elements'][-2:]]
                def hopped():
                    f = app.js('() => window.__flowsketch.frame(0)')
                    it = next(i for i in f['items'] if i['id'] == ids[1])
                    main = next(p for p in it['parts'] if p['k'] == 'line')  # the arrow's own line (not its head)
                    ys = [main['pts'][k + 1] for k in range(0, len(main['pts']), 2) if abs(main['pts'][k] - 5200) < 3]
                    return bool(ys) and min(ys) < 36350 - 6
                if not on0:
                    page.get_by_role('menuitem', name='View').click(); page.get_by_role('menuitemcheckbox', name='Line jumps').click()
                assert app.doc()['canvas']['lineJumps'] is True and hopped()
                page.get_by_role('menuitem', name='View').click(); page.get_by_role('menuitemcheckbox', name='Line jumps').click()
                assert app.doc()['canvas']['lineJumps'] is False and not hopped()
                app.key('Control+z')
                assert app.doc()['canvas']['lineJumps'] is True
            finally:
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tjumps()

        @test('Find and replace: Cmd+F finds text and selects each match in turn; replace all is one undo step; Esc closes')
        def tfind():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 39000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            m = 'Meta' if 'Mac' in page.evaluate('navigator.platform') else 'Control'
            try:
                page.get_by_role('menuitem', name='Insert').click()
                page.get_by_role('menuitem', name='Diagram from text (Mermaid)…').click()
                page.get_by_label('Flowchart text').fill('graph LR\n  A[Zebra portal] -->|zebra call| B[Gateway]\n  B --> C[Second zebra]')
                page.get_by_test_id('mermaid-insert').click(); page.wait_for_timeout(200)
                app.key('Escape')
                app.key(f'{m}+f'); page.wait_for_timeout(150)
                box = page.get_by_label('Find', exact=True)
                assert box.is_visible()
                box.fill('ZEBRA'); page.wait_for_timeout(100)
                count = lambda: page.locator('.find-bar .find-count').inner_text()
                n = int(count().split(' ')[0])
                assert n >= 3 and 'matches' in count(), count()  # (other tests' shapes on this page may also say zebra)
                box.press('Enter'); page.wait_for_timeout(100)
                assert count().startswith(f'1 of {n}'), count()  # the first Enter goes to the first match
                first = app.ui()['selection']
                assert len(first) == 1 and 'zebra' in next(e for e in app.els() if e['id'] == first[0])['text'].lower()
                box.press('Enter'); page.wait_for_timeout(100)
                assert app.ui()['selection'] != first
                page.screenshot(path=f'{OUT}/e2e-find.png')
                # case sensitive: no capital ZEBRA anywhere
                page.locator('.find-bar button', has_text='Aa').click(); page.wait_for_timeout(100)
                assert count() == 'No matches', count()
                page.locator('.find-bar button', has_text='Aa').click()
                # replace every "zebra" with "lion"
                page.get_by_role('button', name='Show replace').click()
                page.get_by_label('Replace with').fill('lion')
                before = app.js('() => window.__flowsketch.history()')['past']
                page.locator('.find-bar button', has_text='Replace all').click(); page.wait_for_timeout(150)
                texts = [e['text'] for e in app.els()]
                assert 'Lion portal' not in texts and 'lion portal' in texts and 'Second lion' in texts and 'lion call' in texts, [t for t in texts if 'lion' in t.lower()]
                assert not any('zebra' in t.lower() for t in texts)
                assert app.js('() => window.__flowsketch.history()')['past'] == before + 1
                assert count() == 'No matches'
                app.key(f'{m}+z'); page.wait_for_timeout(100)
                assert any(e['text'] == 'Zebra portal' for e in app.els())
                page.get_by_label('Find', exact=True).press('Escape'); page.wait_for_timeout(100)
                assert page.locator('.find-bar').count() == 0
            finally:
                if page.locator('.find-bar').count(): page.keyboard.press('Escape')
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tfind()

        @test('Equal-spacing guides: a shape dragged near an equal gap snaps to it and the gaps are marked')
        def tspacing():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 42000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            try:
                for x0 in (5100, 5300, 5500):  # three boxes 100 wide... drawn 100 apart: gaps of 100
                    app.tool('r'); app.drag((x0, 42100), (x0 + 100, 42160)); app.key('Escape')
                boxes = [e for e in app.els() if e['type'] == 'shape'][-3:]
                xs = sorted(round(bx['x']) for bx in boxes)
                gap = xs[1] - (xs[0] + round(boxes[0]['w']))
                last = max(boxes, key=lambda e: e['x'])
                # drag the last one so it sits 5 px further out than the existing gap; it should snap back to equal
                sx, sy = app.pt(last['x'] + 50, last['y'] + 30)
                page.mouse.move(sx, sy); page.mouse.down()
                page.mouse.move(sx + 3, sy, steps=2); page.mouse.move(sx + 5, sy, steps=3); page.wait_for_timeout(80)
                marks = page.evaluate("() => [...document.querySelectorAll('.stage-overlay text')].map((t) => t.textContent)")
                page.screenshot(path=f'{OUT}/e2e-spacing.png')
                page.mouse.up(); page.wait_for_timeout(80)
                moved = next(e for e in app.els() if e['id'] == last['id'])
                assert abs(moved['x'] - last['x']) < 0.01, (moved['x'], last['x'])  # snapped back: gaps equal again
                assert marks.count(str(gap)) >= 2, (marks, gap)
                # off by more than the tolerance: no snap
                page.mouse.move(sx, sy); page.mouse.down(); page.mouse.move(sx + 25, sy, steps=5); page.mouse.up(); page.wait_for_timeout(80)
                moved = next(e for e in app.els() if e['id'] == last['id'])
                assert abs(moved['x'] - last['x'] - 25) <= 6, (moved['x'], last['x'])  # (it may line up with something else on this busy page)
            finally:
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tspacing()

        @test('Same size as a neighbour: drawing a shape a few px off a nearby shape\'s size snaps to it, with size marks')
        def tsizesnap():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 45000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            try:
                app.tool('r'); app.drag((5100, 45100), (5240, 45180)); app.key('Escape')  # 140 x 80
                ref = [e for e in app.els() if e['type'] == 'shape'][-1]
                rw, rh = round(ref['w']), round(ref['h'])
                app.tool('r')
                sx, sy = app.pt(5400, 45100)
                page.mouse.move(sx, sy); page.mouse.down()
                page.mouse.move(sx + rw + 3, sy + rh - 4, steps=6); page.wait_for_timeout(60)
                marks = page.evaluate("() => [...document.querySelectorAll('.stage-overlay text')].map((t) => t.textContent)")
                page.screenshot(path=f'{OUT}/e2e-sizesnap.png')
                page.mouse.up(); app.key('Escape')
                new = [e for e in app.els() if e['type'] == 'shape'][-1]
                assert abs(new['w'] - ref['w']) < 0.01 and abs(new['h'] - ref['h']) < 0.01, (new['w'], new['h'], ref['w'], ref['h'])
                assert marks.count(str(rw)) >= 2 and marks.count(str(rh)) >= 2, (marks, rw, rh)
                # well off: drawn as dragged
                app.tool('r'); app.drag((5700, 45100), (5700 + rw + 30, 45100 + rh + 25)); app.key('Escape')
                new = [e for e in app.els() if e['type'] == 'shape'][-1]
                # (it may match some other shape on this busy page, but not the reference one)
                assert abs(new['w'] - ref['w']) > 20 and abs(new['h'] - ref['h']) > 15, (new['w'], new['h'])
            finally:
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tsizesnap()

        @test('Notation shapes: Shape library groups; a UML class keeps its sections when typed on; network icons; crow\'s-foot ends')
        def tnotation():
            app.key('Escape')
            v = app.ui()['view']
            app.js('() => window.__flowsketch.setView({x: 5000, y: 48000, zoom: 1})')
            h0 = app.js('() => window.__flowsketch.history()')['past']
            try:
                app.key('s'); page.wait_for_timeout(200)
                dlg = page.get_by_role('dialog')
                assert dlg.get_by_text('UML', exact=True).count() and dlg.get_by_text('Network', exact=True).count()
                dlg.get_by_role('button', name='UML class').click(); page.wait_for_timeout(100)
                assert app.ui()['tool'] == 'shape' and app.ui()['shapeKind'] == 'umlClass'
                app.drag((5100, 48100), (5300, 48230))
                cls = app.els()[-1]
                assert cls['shape'] == 'umlClass' and cls['text'].startswith('ClassName\n--\n'), cls['text']
                # typing on it replaces only the name; the compartments stay
                page.keyboard.type('Customer'); app.key('Escape'); page.wait_for_timeout(100)
                cls = next(e for e in app.els() if e['id'] == cls['id'])
                assert cls['text'].split('\n')[0] == 'Customer' and cls['text'].count('\n--\n') == 2, cls['text']
                # a server icon from the Network group
                app.key('Escape'); app.key('s'); page.wait_for_timeout(200)
                page.get_by_role('dialog').get_by_role('button', name='Server').click()
                page.wait_for_function("() => window.__flowsketch.doc().elements.some((e) => e.type === 'icon' && e.iconId === 'tabler:server')", timeout=8000)
                # an ER relationship: two entities and a line with crow's-foot ends
                app.key('Escape'); app.key('s'); page.wait_for_timeout(200)
                page.get_by_role('dialog').get_by_role('button', name='ER entity (table)').click()
                app.drag((5100, 48400), (5300, 48520)); app.key('Escape')
                app.key('s'); page.wait_for_timeout(200)
                page.get_by_role('dialog').get_by_role('button', name='ER entity (table)').click()
                app.drag((5600, 48400), (5800, 48520)); app.key('Escape')
                app.tool('l'); app.drag((5200, 48460), (5700, 48460)); line = app.els()[-1]
                assert line['type'] == 'connector' and line['start']['elementId'] and line['end']['elementId']
                page.get_by_label('End arrowhead').select_option(label='ER: zero or many')
                page.get_by_label('Start arrowhead').select_option(label='ER: one and only one')
                line = next(e for e in app.els() if e['id'] == line['id'])
                assert line['endHead'] == 'erZeroMany' and line['startHead'] == 'erOnlyOne', (line['startHead'], line['endHead'])
                app.key('Escape')
                page.screenshot(path=f'{OUT}/e2e-notation.png')
            finally:
                if page.get_by_role('dialog').count(): page.keyboard.press('Escape')
                while app.js('() => window.__flowsketch.history()')['past'] > h0: app.key('Control+z')
                app.js('(v) => window.__flowsketch.setView(v)', v)
        tnotation()

        @test('Import: File > Open reads draw.io and Excalidraw files; Export > Mermaid writes this page as Mermaid text')
        def tformats():
            import base64, zlib, urllib.parse
            c5, pg, ap, er = fresh(browser)
            m = 'Meta' if 'Mac' in pg.evaluate('navigator.platform') else 'Control'
            page2 = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="d" value="Deep" style="" vertex="1" parent="1"><mxGeometry x="0" y="0" width="100" height="50" as="geometry"/></mxCell></root></mxGraphModel>'
            z = zlib.compressobj(9, zlib.DEFLATED, -15); comp = z.compress(urllib.parse.quote(page2, safe='').encode()) + z.flush()
            drawio = ('<mxfile><diagram name="Overview"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>'
                      '<mxCell id="a" value="Start" style="rounded=1;fillColor=#dae8fc;" vertex="1" parent="1"><mxGeometry x="40" y="60" width="120" height="60" as="geometry"/></mxCell>'
                      '<mxCell id="b" value="Done" style="ellipse;" vertex="1" parent="1"><mxGeometry x="300" y="60" width="120" height="60" as="geometry"/></mxCell>'
                      '<mxCell id="e" value="go" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>'
                      f'</root></mxGraphModel></diagram><diagram name="Detail">{base64.b64encode(comp).decode()}</diagram></mxfile>')
            path = f'{OUT}/sample.drawio'
            open(path, 'w').write(drawio)
            open_file(pg, m, path); pg.wait_for_timeout(400)
            d = ap.doc()
            assert d['title'] == 'sample', d['title']
            assert [p['name'] for p in d['pages']] == ['Overview', 'Detail'], d['pages']
            texts = sorted(e['text'] for e in d['elements'] if e['type'] != 'connector')
            assert texts == ['Done', 'Start'], texts
            conn = [e for e in d['elements'] if e['type'] == 'connector']
            assert len(conn) == 1 and conn[0]['text'] == 'go' and conn[0]['start']['elementId'] and conn[0]['end']['elementId']
            assert pg.get_by_text('Imported', exact=False).count() >= 1  # the toast says it was converted
            # Mermaid: this page as text
            pg.get_by_role('menuitem', name='Export').first.click()
            with pg.expect_download() as dl:
                pg.get_by_role('menuitem', name='Mermaid flowchart (.mmd)').click()
            mmd = open(dl.value.path()).read()
            assert mmd.startswith('flowchart LR') and '"Start"' in mmd and '-->|"go"|' in mmd, mmd
            # Excalidraw
            ex = {'type': 'excalidraw', 'version': 2, 'elements': [
                {'id': 'r', 'type': 'rectangle', 'x': 0, 'y': 0, 'width': 160, 'height': 80, 'strokeColor': '#1971c2', 'backgroundColor': '#a5d8ff', 'fillStyle': 'hachure', 'roughness': 1, 'opacity': 100},
                {'id': 't', 'type': 'text', 'x': 10, 'y': 20, 'width': 100, 'height': 25, 'text': 'Client', 'fontSize': 20, 'fontFamily': 1, 'containerId': 'r'},
                {'id': 'o', 'type': 'ellipse', 'x': 300, 'y': 0, 'width': 120, 'height': 80},
                {'id': 'a', 'type': 'arrow', 'x': 160, 'y': 40, 'points': [[0, 0], [140, 0]], 'startBinding': {'elementId': 'r'}, 'endBinding': {'elementId': 'o'}, 'endArrowhead': 'arrow'}]}
            path = f'{OUT}/sample.excalidraw'
            open(path, 'w').write(json.dumps(ex))
            # the imported diagram isn't saved yet, so Open asks before replacing it
            pg.mouse.click(700, 600); pg.keyboard.press(f'{m}+o')
            with pg.expect_file_chooser(timeout=6000) as fc:
                pg.get_by_test_id('confirm-ok').click()
            fc.value.set_files(path); pg.wait_for_timeout(400)
            d = ap.doc()
            assert d['title'] == 'sample' and any(e['text'] == 'Client' and e['style']['fillStyle'] == 'hachure' for e in d['elements']), d['elements'][:2]
            assert sum(1 for e in d['elements'] if e['type'] == 'connector' and e['start']['elementId'] and e['end']['elementId']) == 1
            assert not er, er
            c5.close()
        tformats()

        @test('File ▸ Close: with unsaved changes asks Save / Don\'t save / Cancel; Cancel keeps it, Don\'t save gives a blank diagram; no changes: closes at once')
        def tclose():
            app.key('Escape')
            app.tool('r'); app.drag((100, 100), (220, 180)); app.key('Escape')  # an unsaved change
            n = len(app.els())
            assert n > 0
            def close():
                page.get_by_role('menuitem', name='File').click()
                page.get_by_role('menuitem', name='Close').click(); page.wait_for_timeout(80)
            close()
            dlg = page.locator('.modal', has_text='Close diagram')
            assert dlg.count() == 1 and 'save the changes' in dlg.inner_text(), dlg.all_inner_texts()
            assert dlg.get_by_role('button', name='Save', exact=True).count() == 1
            dlg.get_by_role('button', name='Cancel').click(); page.wait_for_timeout(60)
            assert len(app.els()) == n, 'Cancel must keep the diagram'
            close()
            page.get_by_test_id('confirm-alt').click(); page.wait_for_timeout(150)  # Don't save
            assert app.els() == [], app.els()[:2]
            assert app.doc()['title'] == 'Untitled diagram'
            assert page.locator('.modal').count() == 0
            close()  # nothing changed: closes without asking
            assert page.locator('.modal', has_text='Close diagram').count() == 0
        tclose()

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
