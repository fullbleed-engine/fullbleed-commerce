"""Owned headless Chrome, loopback synthetic store; the user's tabs stay open."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect
from pypdf import PdfReader

base = 'http://127.0.0.1:9478'
out = Path('output/activity')
out.mkdir(parents=True, exist_ok=True)
checks, errors = [], []


def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    merchant = browser.new_context(viewport={'width': 1440, 'height': 1050}, accept_downloads=True)
    buyer = browser.new_context()
    admin, customer = merchant.new_page(), buyer.new_page()
    for page in [admin, customer]:
        page.set_default_timeout(45000)
        page.on('pageerror', lambda error: errors.append(str(error)))

    def login(page, username):
        page.goto(base + '/wp-login.php')
        page.locator('#user_login').fill(username)
        page.locator('#user_pass').fill('fullbleed-local-test')
        page.locator('#wp-submit').click()
        page.wait_for_url(lambda url: 'wp-login.php' not in url)

    try:
        login(admin, 'admin')
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-automation')
        check('WooCommerce displays a failure notice without needing to open each order', admin.get_by_role('link', name='Review Fullbleed activity', exact=True).is_visible())
        admin.get_by_role('link', name='View activity and failures', exact=True).click()
        admin.wait_for_url('**/admin.php?page=fullbleed-activity')
        admin.get_by_role('heading', name='Fullbleed activity', exact=True).wait_for(state='visible')
        table = admin.locator('.fullbleed-activity-table')
        expect(table.locator('tbody tr')).to_have_count(3)
        check('merchant opens activity directly from automation settings', admin.url.endswith('page=fullbleed-activity') and table.locator('tbody tr').count() == 3)
        text = table.inner_text()
        check('activity distinguishes failed, prepared-attachment and ready-response results', all(label in text for label in ['Failed', 'Attachment prepared', 'PDF response ready']))
        check('activity reveals no customer fields or renderer token', all(value not in admin.content() for value in ['Alex Morgan', '42 Example Street', 'synthetic-renderer-token-not-for-production']))
        admin.screenshot(path=str(out / 'merchant-desktop.png'), full_page=True, animations='disabled')
        admin.get_by_role('link', name='Failed', exact=True).click()
        admin.wait_for_url('**/admin.php?page=fullbleed-activity&fb_result=failed')
        expect(table.locator('tbody tr')).to_have_count(1)
        check('failed filter shows only the affected workflow', table.locator('tbody tr').count() == 1 and '#13' in table.inner_text() and 'connection_failed' in table.inner_text())
        check('failure provides connection and resend guidance without a send action', 'availability or capacity' in table.inner_text() and 'use WooCommerce to resend' in table.inner_text() and table.get_by_role('button').count() == 0)
        admin.screenshot(path=str(out / 'merchant-failed.png'), full_page=True, animations='disabled')
        table.get_by_role('link', name='#13', exact=True).click()
        admin.wait_for_url('**/admin.php?page=wc-orders&action=edit&id=13')
        admin.get_by_role('heading', name='Edit order', exact=True).wait_for(state='visible')
        check('order action opens the native HPOS order screen', 'page=wc-orders' in admin.url and 'id=13' in admin.url and admin.get_by_role('heading', name='Edit order', exact=True).count() == 1)
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-activity&fb_result=failed')
        admin.set_viewport_size({'width': 390, 'height': 844})
        check('mobile activity and recovery link stay within the viewport', table.is_visible() and admin.get_by_role('link', name='Connection and automation settings').is_visible() and admin.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('mobile recovery guidance uses full-width labelled cells', table.locator('td[data-label="Next step"]').evaluate("el => getComputedStyle(el).display === 'block' && el.getBoundingClientRect().width > 300"))
        admin.screenshot(path=str(out / 'merchant-mobile.png'), full_page=True, animations='disabled')
        login(customer, 'activity-buyer')
        denied = buyer.request.get(base + '/wp-admin/admin.php?page=fullbleed-activity')
        check('customer HTTP session is forbidden from merchant activity', denied.status == 403 and 'connection_failed' not in denied.text())

        # A real browser-worker PDF also checks the unchanged staff recovery path.
        admin.set_viewport_size({'width': 1440, 'height': 1050})
        admin.goto(base + '/wp-admin/admin.php?page=fullbleed-commerce')
        admin.locator('#fb-orders').fill('12')
        admin.locator('[data-render]').click()
        admin.locator('[data-preview]').wait_for(state='visible')
        with admin.expect_download() as event:
            admin.locator('[data-preview]').click()
        pdf = out / 'staff-summary.pdf'
        event.value.save_as(pdf)
        rendered = '\n'.join(page.extract_text() for page in PdfReader(pdf).pages)
        check('staff recovery still generates and downloads a real browser PDF', pdf.read_bytes().startswith(b'%PDF-') and 'Alex Morgan' in rendered and '282.00' in rendered)
        check('merchant and customer pages have no JavaScript errors', not errors)
        evidence = [{'file': path.as_posix(), 'sha256': sha256(path.read_bytes()).hexdigest()} for path in [out / name for name in ['merchant-desktop.png', 'merchant-failed.png', 'merchant-mobile.png']]]
        (out / 'browser-verification.json').write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), 'browser': browser.version, 'store': base, 'checks': checks, 'pdfSha256': sha256(pdf.read_bytes()).hexdigest(), 'pageErrors': errors, 'evidence': evidence}, indent=2), encoding='utf-8')
    except Exception:
        admin.screenshot(path=str(out / 'browser-failure.png'), full_page=True)
        raise
    finally:
        merchant.close()
        buyer.close()
        browser.close()
