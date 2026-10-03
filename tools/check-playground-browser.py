"""Check the disposable sample-store journey in a fresh, owned Chrome context."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse, parse_qs
import argparse
import json
import time

from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:9488')
args = parser.parse_args()
parsed = urlparse(args.url)
assert parsed.hostname in ['127.0.0.1', 'playground.wordpress.net']
public = parsed.hostname == 'playground.wordpress.net'
if public:
    assert parse_qs(parsed.query).get('storage') == ['temp'], 'Use the disposable public demo URL.'
label = 'public' if public else 'local'
out = Path('output/playground')
out.mkdir(parents=True, exist_ok=True)
checks, errors, documents, dialogs = [], [], [], []
storage_state = None
expect.set_options(timeout=45000)

def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)

def inspect(path):
    reader = PdfReader(path)
    return '\n'.join(page.extract_text() for page in reader.pages), len(reader.pages)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(45000)
    page.on('pageerror', lambda error: errors.append(str(error)))
    def handle_dialog(dialog):
        dialogs.append({'type': dialog.type, 'message': dialog.message})
        if dialog.type == 'beforeunload':
            # This context contains only the disposable synthetic demo.
            dialog.accept()
        else:
            dialog.dismiss()
    page.on('dialog', handle_dialog)
    try:
        page.goto(args.url, timeout=60000, wait_until='domcontentloaded')
        if not public:
            page.goto(args.url + '/wp-login.php')
            page.locator('#user_login').fill('admin')
            page.locator('#user_pass').fill('password')
            page.locator('#wp-submit').click()
            page.wait_for_url('**/wp-admin/**', wait_until='domcontentloaded', timeout=45000)
            page.goto(args.url + '/wp-admin/admin.php?page=fullbleed-commerce')
        deadline = time.monotonic() + 240
        frame = None
        while time.monotonic() < deadline:
            for candidate in page.frames:
                try:
                    if candidate.locator('[data-fullbleed-demo]').count():
                        frame = candidate
                        break
                except Exception:
                    pass
            if frame:
                break
            page.wait_for_timeout(1000)
        check('sample store opens directly in the Fullbleed document screen', frame is not None)
        if public:
            page.wait_for_function('Boolean(window.playgroundSites)')
            storage_state = page.evaluate('async () => { await window.playgroundSites.isReady(); return window.playgroundSites.list().find(site => site.isActive); }')
            check('public Playground confirms temporary storage', storage_state['storage'] == 'temporary' and not storage_state.get('persistence'))
        first_order = frame.locator('#fb-orders').input_value()
        check('first sample order is preselected without looking up its ID', first_order.isdigit())
        check('demo explains its scope and offers a long-order example', frame.get_by_role('link', name='Long order #', exact=False).count() == 1 and 'Pro email attachments' in frame.locator('[data-fullbleed-demo]').inner_text())

        def download(stem):
            frame.locator('[data-render]').click()
            frame.locator('[data-preview]').wait_for(state='visible')
            with page.expect_download() as event:
                frame.locator('[data-preview]').click()
            file = out / f'{label}-{stem}.pdf'
            event.value.save_as(file)
            text, pages = inspect(file)
            documents.append({'file': file.as_posix(), 'sha256': sha256(file.read_bytes()).hexdigest(), 'pages': pages, 'downloadFilename': event.value.suggested_filename})
            return text, pages

        text, pages = download('summary')
        check('actual browser worker downloads a complete branded order summary', pages == 1 and 'Cedar & Form' in text and '282.00' in text and 'Alex Morgan' in text)
        page.screenshot(path=str(out / f'{label}-documents.png'), full_page=True)

        long_link = frame.get_by_role('link', name='Long order #', exact=False)
        long_order = long_link.inner_text().split('#')[-1]
        long_link.click()
        # The public Playground routes navigation through its service worker;
        # the old document can remain visible after click() has returned.
        expect(frame.locator('#fb-orders')).to_have_value(long_order)
        text, pages = download('long-summary')
        check('long sample paginates and preserves every item and platform total', pages > 1 and text.count('LIN-MOSS') == 16 and text.count('BWL-CHALK') == 16 and '4,332.00' in text)
        frame.locator('select[name="kind"]').select_option('packing-slip')
        text, pages = download('long-packing-slip')
        check('packing slip includes every item without order prices', pages > 1 and text.count('LIN-MOSS') == 16 and text.count('BWL-CHALK') == 16 and '$' not in text and 'Packing slip' in text)

        frame.get_by_role('link', name='Sample order #', exact=False).click()
        expect(frame.locator('#fb-orders')).to_have_value(first_order)
        frame.locator('[data-edit-template]').click()
        canvas = frame.frame_locator('[data-visual] iframe.gjs-frame')
        canvas.locator('h1').wait_for(state='visible')
        canvas.locator('h1').dblclick()
        page.keyboard.press('Control+a')
        page.keyboard.type('MADE FOR YOUR HOME')
        frame.locator('[data-mode="source"]').click()
        check('visual edits appear in the editable HTML source', 'MADE FOR YOUR HOME' in frame.locator('[data-html]').input_value())
        css = frame.locator('[data-css]').input_value()
        frame.locator('[data-css]').fill(css + '\nh1 { color: #9b3d22; font-size: 34pt; }')
        frame.locator('[data-action="save"]').click()
        frame.locator('[data-message]').filter(has_text='Saved.').wait_for()
        frame.locator('[data-action="preview"]').click()
        frame.locator('[data-pdf]').wait_for(state='visible')
        data = frame.locator('[data-pdf-link]').evaluate('async link => Array.from(new Uint8Array(await (await fetch(link.href)).arrayBuffer()))')
        preview = out / f'{label}-custom-preview.pdf'
        preview.write_bytes(bytes(data))
        text, pages = inspect(preview)
        check('Fullbleed preview applies visual edits and custom print CSS', 'MADE FOR YOUR HOME' in text and '282.00' in text and pages == 1)
        documents.append({'file': preview.as_posix(), 'sha256': sha256(preview.read_bytes()).hexdigest(), 'pages': pages})
        page.screenshot(path=str(out / f'{label}-editor.png'), full_page=True)
        # Navigate through the demo's own link: saved state must survive a full
        # WordPress page load, rather than only the editor's in-memory state.
        frame.get_by_role('link', name='Sample order #', exact=False).click()
        expect(frame.locator('[data-template-editor] [data-html]')).to_have_count(0)
        expect(frame.locator('#fb-orders')).to_have_value(first_order)
        text, pages = download('saved-summary')
        check('saved design is used by subsequent document downloads', 'MADE FOR YOUR HOME' in text and '282.00' in text)
        frame.locator('[data-edit-template]').click()
        frame.locator('[data-action="reset"]').click()
        frame.locator('[data-message]').filter(has_text='Built-in design restored.').wait_for()
        check('reset returns to the built-in template', True)
        page.set_viewport_size({'width': 390, 'height': 844})
        frame.evaluate('scrollTo(0,0)')
        check('sample-store document page fits a mobile viewport', frame.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(out / f'{label}-mobile.png'), full_page=True)
        check('demo journey has no JavaScript exceptions', not errors)
        evidence = []
        for name in ['documents', 'editor', 'mobile']:
            file = out / f'{label}-{name}.png'
            evidence.append({'file': file.as_posix(), 'sha256': sha256(file.read_bytes()).hexdigest()})
        record = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'browser': browser.version, 'publicPlayground': public, 'url': args.url, 'storage': storage_state, 'blueprintSha256': sha256(Path('playground/blueprint.json').read_bytes()).hexdigest(), 'checks': checks, 'documents': documents, 'evidence': evidence, 'pageErrors': errors, 'dialogs': dialogs}
        (out / f'{label}-browser-verification.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    except Exception:
        page.screenshot(path=str(out / f'{label}-failure.png'), full_page=True)
        (out / f'{label}-failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'dialogs': dialogs, 'frames': [f.url for f in page.frames], 'text': page.locator('body').inner_text()[-12000:]}, indent=2), encoding='utf-8')
        raise
    finally:
        context.close()
        browser.close()
