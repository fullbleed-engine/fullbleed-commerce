"""Capture the free plugin in a disposable public sample store.

Uses the released browser package; never connects to a merchant store. The
resulting PNGs are native UI captures, not mockups. The caller owns this browser.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import time
from urllib.parse import parse_qs, urlsplit

from playwright.sync_api import expect, sync_playwright
from pypdf import PdfReader


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='https://playground.wordpress.net/?storage=temp&blueprint-url=https://raw.githubusercontent.com/fullbleed-engine/fullbleed-commerce/main/playground/blueprint.json')
parser.add_argument('--version', default=json.loads((Path(__file__).resolve().parents[1] / 'package.json').read_text(encoding='utf-8'))['version'])
parser.add_argument('--output', type=Path, default=Path('output/wordpress-directory'))
parser.add_argument('--candidate-editor', type=Path, help='Test a local editor bundle in this owned disposable store; never publish these captures as released UI.')
parser.add_argument('--require-fonts', action='store_true', help='Fail if the visual editor does not load every bundled font.')
parser.add_argument('--require-local-icons', action='store_true', help='Require the bundled icon assets and block the former CDN fallback.')
args = parser.parse_args()
parsed = urlsplit(args.url)
assert parsed.scheme == 'https' and parsed.hostname == 'playground.wordpress.net'
assert parse_qs(parsed.query).get('storage') == ['temp']
args.output.mkdir(parents=True, exist_ok=True)
expect.set_options(timeout=45000)
checks, errors = [], []


def check(name, value):
    assert value, name
    checks.append(name)
    print(name, flush=True)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1600, 'height': 1500}, accept_downloads=True)
    icon_responses, blocked_icons = [], []
    context.on('response', lambda response: icon_responses.append({'url': response.url, 'status': response.status}) if '/fonts/editor-icons.' in response.url else None)
    if args.require_local_icons:
        def block_remote_icons(route):
            blocked_icons.append(route.request.url)
            route.abort()
        context.route('https://cdnjs.cloudflare.com/**', block_remote_icons)
    page = context.new_page()
    page.set_default_timeout(45000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(args.url, timeout=60000, wait_until='domcontentloaded')
        frame = None
        deadline = time.monotonic() + 240
        while time.monotonic() < deadline and frame is None:
            for candidate in page.frames:
                try:
                    if candidate.locator('[data-fullbleed-demo]').count():
                        frame = candidate
                        break
                except Exception:
                    pass
            if frame is None:
                page.wait_for_timeout(1000)
        check('Disposable sample store opened', frame is not None)
        page.wait_for_function('Boolean(window.playgroundSites)')
        storage = page.evaluate('async () => { await window.playgroundSites.isReady(); return window.playgroundSites.list().find(site => site.isActive); }')
        check('Temporary storage is active', storage['storage'] == 'temporary' and not storage.get('persistence'))
        check('Only the free Studio design is enabled', frame.locator('#fb-theme option').all_text_contents() == ['Studio'])
        check('Free preview version is ' + args.version, frame.locator('[data-fullbleed-demo] a').filter(has_text='Download the preview').get_attribute('href').endswith('/v' + args.version))
        frame.locator('[data-render]').click()
        frame.locator('[data-preview]').wait_for(state='visible')
        with page.expect_download() as download:
            frame.locator('[data-preview]').click()
        pdf = args.output / 'sample-order.pdf'
        download.value.save_as(pdf)
        reader = PdfReader(pdf)
        text = '\n'.join(p.extract_text() for p in reader.pages)
        check('Actual PDF contains the fictional order and store total', len(reader.pages) == 1 and all(v in text for v in ['Cedar & Form', 'Alex Morgan', '282.00']))
        check('PDF matches the verified 0.1.3 sample', sha256(pdf.read_bytes()).hexdigest() == 'cbb6b0aca94c33965d7615860e1863b18a8033e52999d625fbba23a5a0d46ee1')
        frame.locator('.fb-layout').screenshot(path=str(args.output / 'screenshot-1.png'))
        frame.locator('[data-edit-template]').click()
        canvas = frame.frame_locator('[data-visual] iframe.gjs-frame')
        canvas.locator('h1').wait_for(state='visible')
        icons = None
        if args.require_local_icons:
            frame.wait_for_function('Boolean(document.querySelector(\'link[href$="/fonts/editor-icons.css"]\')?.sheet)')
            icons = frame.evaluate('''async () => {
                const href = document.querySelector('link[href$="/fonts/editor-icons.css"]').href;
                const faces = await document.fonts.load('14px FontAwesome', '\\uf040');
                return {href, sameOrigin: new URL(href).origin === location.origin,
                    loaded: faces.length === 1 && faces[0].status === 'loaded'};
            }''')
            check('Editor icons load from local plugin assets without the CDN', icons['sameOrigin'] and icons['loaded'] and not blocked_icons and len(icon_responses) == 2 and all(r['status'] == 200 for r in icon_responses))
        if args.candidate_editor:
            frame.add_script_tag(path=str(args.candidate_editor / 'editor.js'))
            frame.add_style_tag(path=str(args.candidate_editor / 'editor.css'))
            previous_canvas = frame.locator('[data-visual] iframe.gjs-frame').element_handle()
            frame.locator('[data-edit-template]').click()
            previous_canvas.wait_for_element_state('hidden')
            canvas.locator('h1').wait_for(state='visible')
        if args.require_fonts:
            handle = frame.locator('[data-visual] iframe.gjs-frame').element_handle().content_frame()
            handle.wait_for_function('Array.from(document.fonts).filter(f => f.status === "loaded").length >= 4', timeout=20000)
        canvas_fonts = canvas.locator('body').evaluate('async element => { const doc = element.ownerDocument; await doc.fonts.ready; return {headingFamily: doc.defaultView.getComputedStyle(doc.querySelector("h1")).fontFamily, faces: Array.from(doc.fonts, font => ({family: font.family, status: font.status}))}; }')
        (args.output / 'visual-editor-fonts.json').write_text(json.dumps(canvas_fonts, indent=2) + '\n', encoding='utf-8')
        canvas.locator('h1').click()
        (args.output / 'style-controls.html').write_text(frame.locator('[data-styles]').inner_html(), encoding='utf-8')
        controls = frame.locator('.gjs-sm-property__font-size').evaluate('e => { const input = e.querySelector("input"); const style = getComputedStyle(input); return {valueWidth: input.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), unitWidth: e.querySelector("select").getBoundingClientRect().width}; }')
        if args.require_fonts:
            check('Visual canvas loads all four bundled font faces', len(canvas_fonts['faces']) == 4 and all(f['status'] == 'loaded' for f in canvas_fonts['faces']))
            check('Typography value and unit controls have usable width', controls['valueWidth'] >= 60 and controls['unitWidth'] >= 30)
        frame.locator('[data-template-editor]').screenshot(path=str(args.output / 'screenshot-2.png'))
        frame.locator('[data-mode="source"]').click()
        check('HTML and print CSS are editable', '{{seller.name}}' in frame.locator('[data-html]').input_value() and '@page' in frame.locator('[data-css]').input_value())
        frame.locator('[data-template-editor]').screenshot(path=str(args.output / 'screenshot-3.png'))
        check('No browser JavaScript exceptions', not errors)
        assets = [{ 'file': p.name, 'bytes': p.stat().st_size, 'sha256': sha256(p.read_bytes()).hexdigest() } for p in sorted(args.output.iterdir()) if p.suffix in ('.png', '.pdf') and 'failure' not in p.name]
        candidate = {name: sha256((args.candidate_editor / name).read_bytes()).hexdigest() for name in ['editor.js', 'editor.css']} if args.candidate_editor else None
        record = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'url': args.url, 'browser': browser.version, 'pluginVersion': args.version, 'syntheticOnly': True, 'checks': checks, 'assets': assets, 'pageErrors': errors, 'canvasFonts': canvas_fonts, 'styleControls': controls, 'iconAssets': icons, 'iconResponses': icon_responses, 'blockedIconRequests': blocked_icons, 'candidateEditor': candidate, 'captureMethod': 'Native Playwright element screenshots. Candidate injection, if any, is recorded separately; captures with candidateEditor are not released-plugin evidence.'}
        (args.output / 'capture-verification.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    except Exception:
        page.screenshot(path=str(args.output / 'failure.png'), full_page=True)
        (args.output / 'failure.json').write_text(json.dumps({'checks': checks, 'errors': errors}, indent=2) + '\n', encoding='utf-8')
        raise
    finally:
        context.close()
        browser.close()
