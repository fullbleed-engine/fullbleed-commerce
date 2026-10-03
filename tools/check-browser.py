"""Real browser checks on disposable localhost WordPress stores only."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import os
from urllib.parse import urlparse
from urllib.request import urlopen
from zipfile import ZipFile
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from browser_runtime import browser_label, browser_metadata, engine, launch_browser, login_to

base = os.environ.get('FULLBLEED_TEST_URL', 'http://127.0.0.1:9477')
assert urlparse(base).hostname == '127.0.0.1'
with urlopen(base + '/fullbleed-fixture.json', timeout=30) as fixture_response:
    fixture = json.load(fixture_response)
order_id = str(fixture['orders'][0])
batch_ids = ','.join(str(value) for value in fixture['orders'])
pro = os.environ.get('FULLBLEED_TEST_PRO') == '1'
saved_title = os.environ.get('FULLBLEED_TEST_SAVED_TITLE')
label = browser_label(os.environ.get('FULLBLEED_TEST_LABEL', 'wordpress-pro' if pro else 'wordpress-free'))
out = Path('output/browser')
out.mkdir(parents=True, exist_ok=True)
checks = []
def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
    assert condition, name
    print(name + ': passed', flush=True)

with sync_playwright() as pw:
    browser = launch_browser(pw)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    context.tracing.start(screenshots=True, snapshots=True, sources=True)
    page = context.new_page()
    page.set_default_timeout(45000)
    errors = []
    error_details, console_errors = [], []
    def page_error(error):
        errors.append(str(error))
        error_details.append({'message': error.message, 'name': error.name, 'stack': error.stack, 'url': page.url, 'completedChecks': len(checks)})
    page.on('pageerror', page_error)
    page.on('console', lambda message: console_errors.append({'text': message.text, 'location': message.location, 'completedChecks': len(checks)}) if message.type == 'error' else None)
    try:
        document_url = base + '/wp-admin/admin.php?page=fullbleed-commerce'
        login_to(page, base, 'admin', document_url)
        page.locator('#fb-orders').fill(order_id)
        page.locator('[data-render]').click()
        page.locator('[data-preview]').wait_for(state='visible')
        with page.expect_download() as download:
            page.locator('[data-preview]').click()
        pdf = out / f'{label}-default.pdf'
        download.value.save_as(pdf)
        check('real browser worker produces a complete PDF download', len(PdfReader(pdf).pages) >= 1)
        if saved_title:
            check('template saved before the plugin upgrade survives in the browser PDF', saved_title in '\n'.join(p.extract_text() for p in PdfReader(pdf).pages))
            check('upgraded Pro exposes the merchant activity screen', not pro or page.get_by_role('link', name='Fullbleed activity', exact=True).count() == 1)

        page.evaluate("""() => {
            window.fullbleedCoreBefore = {
                backbone: window.Backbone, dollar: window.Backbone.$,
                model: window.Backbone.Model, view: window.Backbone.View,
                undo: window.Backbone.UndoManager, underscore: window._,
                jquery: window.jQuery, codemirror: window.wp.CodeMirror
            };
        }""")
        page.locator('[data-edit-template]').click()
        page.locator('[data-visual] iframe.gjs-frame').wait_for(state='visible')
        canvas = page.frame_locator('[data-visual] iframe.gjs-frame')
        canvas.locator('h1').wait_for(state='visible')
        frame = page.locator('[data-visual] iframe.gjs-frame').element_handle().content_frame()
        frame.wait_for_function("document.fonts.status === 'loaded'")
        check('visual editor renders the saved template', (saved_title or '{{document.title}}') in canvas.locator('h1').inner_text())
        check('editor uses WordPress dependencies without replacing shared globals', page.evaluate("""() => {
            const before = window.fullbleedCoreBefore;
            return before.backbone === window.Backbone && before.dollar === window.Backbone.$
                && before.model === window.Backbone.Model && before.view === window.Backbone.View
                && before.undo === window.Backbone.UndoManager && before.underscore === window._
                && before.jquery === window.jQuery && before.codemirror === window.wp.CodeMirror;
        }"""))
        block = page.locator('.gjs-block').filter(has_text='Heading')
        # Locator hover waits for stable layout after fonts and editor zoom.
        # Move through the iframe edge so the editor's custom pointer drag
        # starts before the final drop; this is not HTML5 native drag/drop.
        block.hover()
        target = canvas.locator('h1').bounding_box()
        page.mouse.down()
        page.mouse.move(target['x'] + target['width'] / 2, target['y'] + target['height'] - 2, steps=25)
        page.mouse.move(target['x'] + target['width'] / 2, target['y'] + target['height'] + 4, steps=3)
        page.mouse.up()
        canvas.get_by_role('heading', name='Make it yours.', exact=True).wait_for()
        check('dragging a block into the canvas adds real editable content', True)
        page.locator('[data-action="undo"]').click()
        canvas.get_by_role('heading', name='Make it yours.', exact=True).wait_for(state='detached')
        canvas.locator('h1').dblclick()
        page.keyboard.press('Control+a')
        page.keyboard.type('YOUR CUSTOM ORDER')
        page.locator('[data-mode="source"]').click()
        source = page.locator('[data-html]').input_value()
        check('visual text editing reaches exported HTML', 'YOUR CUSTOM ORDER' in source)
        css = page.locator('[data-css]').input_value()
        page.locator('[data-css]').fill(css + '\nh1 { color: #9b3d22; font-size: 34pt; }')
        page.locator('[data-action="save"]').click()
        page.wait_for_function("document.querySelector('[data-message]').textContent.startsWith('Saved.')")
        check('custom HTML and CSS save through authenticated editor', True)
        page.locator('[data-action="preview"]').click()
        page.locator('[data-pdf]').wait_for(state='visible')
        data = page.locator('[data-pdf-link]').evaluate("async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))")
        custom = out / f'{label}-custom.pdf'
        custom.write_bytes(bytes(data))
        text = '\n'.join(p.extract_text() for p in PdfReader(custom).pages)
        check('PDF preview contains visual edits and order data', 'YOUR CUSTOM ORDER' in text and '282.00' in text)
        page.screenshot(path=str(out / f'{label}-editor.png'), full_page=True)
        page.reload()
        page.locator('#fb-orders').fill(order_id)
        page.locator('[data-render]').click()
        page.locator('[data-preview]').wait_for(state='visible')
        with page.expect_download() as download:
            page.locator('[data-preview]').click()
        applied = out / f'{label}-saved.pdf'
        download.value.save_as(applied)
        check('saved template survives reload and applies to ordinary downloads', 'YOUR CUSTOM ORDER' in '\n'.join(p.extract_text() for p in PdfReader(applied).pages))
        if pro:
            page.locator('#fb-orders').fill(batch_ids)
            with page.expect_download() as download:
                page.locator('[data-render]').click()
            archive = out / ('wordpress-pro-batch.zip' if engine == 'chrome' else f'{label}-batch.zip')
            download.value.save_as(archive)
            with ZipFile(archive) as zipped:
                check('Pro browser download is a complete two-PDF ZIP', len(zipped.namelist()) == 2 and all(zipped.read(name).startswith(b'%PDF-') for name in zipped.namelist()))
        page.locator('[data-edit-template]').click()
        page.locator('[data-action="reset"]').click()
        page.wait_for_function("document.querySelector('[data-message]').textContent.startsWith('Built-in design restored.')")
        check('reset restores the built-in design', True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.evaluate('scrollTo(0,0)')
        check('mobile editor fits the viewport', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(out / f'{label}-mobile.png'), full_page=True)
        check('no browser JavaScript errors', not errors)
        documents = [{'file': p.as_posix(), 'sha256': sha256(p.read_bytes()).hexdigest(), 'pages': len(PdfReader(p).pages)} for p in [pdf, custom, applied]]
        record = {'checkedAt': datetime.now(timezone.utc).isoformat(), **browser_metadata(browser), 'store': base, 'pro': pro, 'upgradeTemplate': saved_title, 'checks': checks, 'pdfSha256': sha256(custom.read_bytes()).hexdigest(), 'documents': documents, 'pageErrors': errors}
        if pro:
            record['batch'] = {'file': archive.as_posix(), 'sha256': sha256(archive.read_bytes()).hexdigest()}
        (out / f'{label}-verification.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    except Exception as error:
        failure = {**browser_metadata(browser), 'error': str(error), 'checks': checks, 'errors': errors, 'errorDetails': error_details, 'consoleErrors': console_errors, 'url': page.url}
        failure_file = out / f'{label}-failure.json'
        failure_file.write_text(json.dumps(failure, indent=2), encoding='utf-8')
        try:
            failure['text'] = page.locator('body').inner_text(timeout=5000)[-12000:]
            page.screenshot(path=str(out / f'{label}-failure.png'), full_page=True, timeout=5000)
        except Exception as inspection_error:
            failure['inspectionError'] = str(inspection_error)
        failure_file.write_text(json.dumps(failure, indent=2), encoding='utf-8')
        context.tracing.stop(path=str(out / f'{label}-failure-trace.zip'))
        raise
    finally:
        context.close()
        browser.close()
