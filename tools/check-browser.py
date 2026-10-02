"""Real browser checks on disposable localhost WordPress stores only."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import os
from urllib.parse import urlparse
from zipfile import ZipFile
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

base = os.environ.get('FULLBLEED_TEST_URL', 'http://127.0.0.1:9477')
assert urlparse(base).hostname == '127.0.0.1'
pro = os.environ.get('FULLBLEED_TEST_PRO') == '1'
label = 'wordpress-pro' if pro else 'wordpress-free'
out = Path('output/browser')
out.mkdir(parents=True, exist_ok=True)
checks = []
def check(name, condition):
    checks.append({'name': name, 'passed': bool(condition)})
    assert condition, name
    print(name + ': passed', flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100}, accept_downloads=True)
    page = context.new_page()
    page.set_default_timeout(45000)
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.goto(base + '/wp-login.php')
        page.locator('#user_login').fill('admin')
        page.locator('#user_pass').fill('fullbleed-local-test')
        page.locator('#wp-submit').click()
        page.wait_for_url('**/wp-admin/**')
        page.goto(base + '/wp-admin/admin.php?page=fullbleed-commerce')
        page.locator('#fb-orders').fill('12')
        page.locator('[data-render]').click()
        page.locator('[data-preview]').wait_for(state='visible')
        with page.expect_download() as download:
            page.locator('[data-preview]').click()
        pdf = out / f'{label}-default.pdf'
        download.value.save_as(pdf)
        check('real browser worker produces a complete PDF download', len(PdfReader(pdf).pages) >= 1)

        page.locator('[data-edit-template]').click()
        page.locator('[data-visual] iframe.gjs-frame').wait_for(state='visible')
        canvas = page.frame_locator('[data-visual] iframe.gjs-frame')
        canvas.locator('h1').wait_for(state='visible')
        check('visual editor renders its order fields', '{{document.title}}' in canvas.locator('h1').inner_text())
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
        page.locator('#fb-orders').fill('12')
        page.locator('[data-render]').click()
        page.locator('[data-preview]').wait_for(state='visible')
        with page.expect_download() as download:
            page.locator('[data-preview]').click()
        applied = out / f'{label}-saved.pdf'
        download.value.save_as(applied)
        check('saved template survives reload and applies to ordinary downloads', 'YOUR CUSTOM ORDER' in '\n'.join(p.extract_text() for p in PdfReader(applied).pages))
        if pro:
            page.locator('#fb-orders').fill('12,13')
            with page.expect_download() as download:
                page.locator('[data-render]').click()
            archive = out / 'wordpress-pro-batch.zip'
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
        record = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'browser': browser.version, 'store': base, 'pro': pro, 'checks': checks, 'pdfSha256': sha256(custom.read_bytes()).hexdigest(), 'pageErrors': errors}
        (out / f'{label}-verification.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
    except Exception:
        page.screenshot(path=str(out / f'{label}-failure.png'), full_page=True)
        (out / f'{label}-failure.json').write_text(json.dumps({'checks': checks, 'errors': errors, 'url': page.url, 'text': page.locator('body').inner_text()[-12000:]}, indent=2), encoding='utf-8')
        raise
    finally:
        context.close()
        browser.close()
