"""Owned headless Chrome, synthetic local customer portal; no user browser touched."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright
from pypdf import PdfReader

fixture = json.loads(Path('target/wordpress/customer-browser.json').read_text())
base = fixture['base']
assert urlparse(base).hostname == '127.0.0.1'
out = Path('output/browser')
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []

def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    buyer = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    merchant = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    page, admin = buyer.new_page(), merchant.new_page()
    for current in [page, admin]:
        current.set_default_timeout(45000)
        current.on('pageerror', lambda error: errors.append(str(error)))
    def login(current, user):
        current.goto(base + '/wp-login.php')
        current.locator('#user_login').fill(user)
        current.locator('#user_pass').fill('fullbleed-local-test')
        current.locator('#wp-submit').click()
        current.wait_for_url(lambda url: 'wp-login.php' not in url)
    try:
        login(page, 'fb-buyer-one')
        page.goto(fixture['ordersUrl'])
        link = page.get_by_role('link', name='Download order summary PDF for order 12', exact=True)
        check('buyer finds one PDF action on the actual account orders page', link.count() == 1)
        old_url = link.get_attribute('href')
        with page.expect_download() as event:
            link.click()
        pdf = out / 'wordpress-customer-summary.pdf'
        event.value.save_as(pdf)
        check('native browser download has the promised filename and exact renderer bytes', event.value.suggested_filename == 'order-summary-12.pdf' and sha256(pdf.read_bytes()).hexdigest() == fixture['pdfSha256'])
        text = '\n'.join(item.extract_text() for item in PdfReader(pdf).pages)
        check('download contains saved brand styling and platform totals', 'YOUR CEDAR ORDER' in text and '282.00' in text and 'Alex Morgan' in text)
        check('download leaves the account page usable', page.url == fixture['ordersUrl'] and link.is_visible())
        page.screenshot(path=str(out / 'wordpress-customer-orders.png'), full_page=True)
        page.goto(fixture['viewUrl'])
        check('buyer can also find the PDF on order details', page.get_by_role('link', name='Download order summary PDF for order 12', exact=True).count() == 1)
        page.screenshot(path=str(out / 'wordpress-customer-details.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto(fixture['ordersUrl'])
        check('account PDF action remains visible within a mobile viewport', link.is_visible() and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(out / 'wordpress-customer-mobile.png'), full_page=True)

        login(admin, 'admin')
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-automation')
        toggle = admin.get_by_role('checkbox', name='Show Order summary PDF in My Account.')
        check('merchant sees the enabled customer-download setting without the access token', toggle.is_checked() and admin.locator('#fb-renderer-token').input_value() == '')
        toggle.uncheck()
        admin.get_by_role('button', name='Save automation settings', exact=True).click()
        page.reload()
        check('merchant can remove customer downloads without disabling email configuration', page.locator('a.fullbleed-summary').count() == 0)
        response = buyer.request.get(old_url)
        check('previously issued account link fails immediately after disabling', response.status == 404 and 'no-store' in response.headers['cache-control'])
        toggle.check()
        admin.get_by_role('button', name='Save automation settings', exact=True).click()
        page.reload()
        check('re-enabling restores the customer action', link.is_visible())
        admin.screenshot(path=str(out / 'wordpress-customer-settings.png'), full_page=True)

        # The final installed base/Pro package must still execute its actual WASM
        # worker in Chrome. No customer data or server token reaches that worker.
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-commerce')
        admin.locator('#fb-orders').fill('12')
        admin.locator('[data-render]').click()
        admin.locator('[data-preview]').wait_for(state='visible')
        with admin.expect_download() as event:
            admin.locator('[data-preview]').click()
        manual = out / 'wordpress-customer-staff-preview.pdf'
        event.value.save_as(manual)
        check('packaged staff browser worker matches the customer server-rendered PDF', sha256(manual.read_bytes()).hexdigest() == fixture['pdfSha256'])
        check('customer and merchant pages have no JavaScript errors', not errors)
        evidence = []
        for name in ['orders', 'details', 'mobile', 'settings']:
            file = out / f'wordpress-customer-{name}.png'
            evidence.append({'file': file.as_posix(), 'sha256': sha256(file.read_bytes()).hexdigest()})
        (out / 'wordpress-customer-verification.json').write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), 'browser': browser.version, 'store': base, 'checks': checks, 'packages': fixture['packages'], 'pdfSha256': fixture['pdfSha256'], 'pageErrors': errors, 'evidence': evidence}, indent=2), encoding='utf-8')
    except Exception:
        page.screenshot(path=str(out / 'wordpress-customer-failure.png'), full_page=True)
        raise
    finally:
        buyer.close()
        merchant.close()
        browser.close()
