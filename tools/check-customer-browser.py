"""Owned test browser, synthetic local customer portal; no user browser touched."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from urllib.parse import urlencode, urlparse
import json
from playwright.sync_api import sync_playwright
from pypdf import PdfReader
from browser_runtime import browser_label, browser_metadata, launch_browser

fixture = json.loads(Path('target/wordpress/customer-browser.json').read_text())
base = fixture['base']
assert urlparse(base).hostname == '127.0.0.1'
out = Path('output/browser')
out.mkdir(parents=True, exist_ok=True)
checks, errors, error_details = [], [], []
label = browser_label('wordpress-customer')

def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)

with sync_playwright() as pw:
    browser = launch_browser(pw)
    buyer = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    merchant = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    page, admin = buyer.new_page(), merchant.new_page()
    def page_error(error, source):
        errors.append(str(error))
        error_details.append({'message': error.message, 'name': error.name, 'stack': error.stack, 'url': source.url, 'completedChecks': len(checks)})
    for current in [page, admin]:
        current.set_default_timeout(45000)
        current.on('pageerror', lambda error, source=current: page_error(error, source))
    def login(current, user, destination):
        current.goto(base + '/wp-login.php?' + urlencode({'redirect_to': destination}))
        current.locator('#user_login').fill(user)
        current.locator('#user_pass').fill('fullbleed-local-test')
        current.locator('#wp-submit').click()
        current.wait_for_url(destination, wait_until='domcontentloaded')
    try:
        login(page, 'fb-buyer-one', fixture['ordersUrl'])
        link = page.get_by_role('link', name='Download order summary PDF for order 12', exact=True)
        check('buyer finds one PDF action on the actual account orders page', link.count() == 1)
        old_url = link.get_attribute('href')
        with page.expect_download() as event:
            link.click()
        pdf = out / f'{label}-summary.pdf'
        event.value.save_as(pdf)
        check('native browser download has the promised filename and exact renderer bytes', event.value.suggested_filename == 'order-summary-12.pdf' and sha256(pdf.read_bytes()).hexdigest() == fixture['pdfSha256'])
        text = '\n'.join(item.extract_text() for item in PdfReader(pdf).pages)
        check('download contains saved brand styling and platform totals', 'YOUR CEDAR ORDER' in text and '282.00' in text and 'Alex Morgan' in text)
        check('download leaves the account page usable', page.url == fixture['ordersUrl'] and link.is_visible())
        page.screenshot(path=str(out / f'{label}-orders.png'), full_page=True)
        page.goto(fixture['viewUrl'])
        check('buyer can also find the PDF on order details', page.get_by_role('link', name='Download order summary PDF for order 12', exact=True).count() == 1)
        page.screenshot(path=str(out / f'{label}-details.png'), full_page=True)
        page.set_viewport_size({'width': 390, 'height': 844})
        page.goto(fixture['ordersUrl'])
        check('account PDF action remains visible within a mobile viewport', link.is_visible() and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        page.screenshot(path=str(out / f'{label}-mobile.png'), full_page=True)

        login(admin, 'admin', base + '/wp-admin/admin.php?page=fullbleed-automation')
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
        admin.screenshot(path=str(out / f'{label}-settings.png'), full_page=True)

        # The final installed base/Pro package must still execute its actual WASM
        # worker in this browser. No customer data or server token reaches that worker.
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-commerce')
        admin.locator('#fb-orders').fill('12')
        admin.locator('[data-render]').click()
        admin.locator('[data-preview]').wait_for(state='visible')
        with admin.expect_download() as event:
            admin.locator('[data-preview]').click()
        manual = out / f'{label}-staff-preview.pdf'
        event.value.save_as(manual)
        check('packaged staff browser worker matches the customer server-rendered PDF', sha256(manual.read_bytes()).hexdigest() == fixture['pdfSha256'])
        check('customer and merchant pages have no JavaScript errors', not errors)
        evidence = []
        for name in ['orders', 'details', 'mobile', 'settings']:
            file = out / f'{label}-{name}.png'
            evidence.append({'file': file.as_posix(), 'sha256': sha256(file.read_bytes()).hexdigest()})
        (out / f'{label}-verification.json').write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), **browser_metadata(browser), 'store': base, 'checks': checks, 'packages': fixture['packages'], 'pdfSha256': fixture['pdfSha256'], 'pageErrors': errors, 'evidence': evidence}, indent=2), encoding='utf-8')
    except Exception:
        page.screenshot(path=str(out / f'{label}-failure.png'), full_page=True)
        (out / f'{label}-failure.json').write_text(json.dumps({**browser_metadata(browser), 'checks': checks, 'pageErrors': errors, 'errorDetails': error_details, 'url': page.url, 'text': page.locator('body').inner_text()[-12000:]}, indent=2), encoding='utf-8')
        raise
    finally:
        buyer.close()
        merchant.close()
        browser.close()
