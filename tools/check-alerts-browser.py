"""Synthetic local administrator controls; no outbound email or customer actions."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
from playwright.sync_api import sync_playwright, expect
from browser_runtime import browser_label, browser_metadata, launch_browser, login_to, wait_for_fixture_page

base = 'http://127.0.0.1:9478'
destination = base + '/wp-admin/admin.php?page=fullbleed-automation'
out = Path('output/browser')
out.mkdir(parents=True, exist_ok=True)
label = browser_label('wordpress-alerts')
checks, errors = [], []


def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)


with sync_playwright() as pw:
    browser = launch_browser(pw)
    admin_context = browser.new_context(viewport={'width': 1440, 'height': 1050})
    staff_context = browser.new_context()
    admin, staff = admin_context.new_page(), staff_context.new_page()
    for page in [admin, staff]:
        page.set_default_timeout(45000)
        page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        login_to(admin, base, 'admin', destination)
        panel = admin.locator('#fullbleed-failure-alerts')
        enabled = panel.get_by_role('checkbox', name='Email the site administrator about unresolved PDF failures.')
        if enabled.is_checked():
            enabled.uncheck()
            panel.get_by_role('button', name='Save failure alerts', exact=True).click()
            wait_for_fixture_page(admin)
        expect(enabled).not_to_be_checked()
        check('administrator finds opt-in alerts with the scheduling and mail limits', panel.is_visible() and 'at most one email' in panel.inner_text().lower() and 'working site mail service' in panel.inner_text())
        enabled.check()
        panel.get_by_role('button', name='Save failure alerts', exact=True).click()
        wait_for_fixture_page(admin)
        expect(enabled).to_be_checked()
        check('administrator enables failure alerts through the real settings form', admin.get_by_text('Failure alert settings saved.', exact=True).is_visible())
        admin.reload()
        wait_for_fixture_page(admin)
        expect(enabled).to_be_checked()
        check('saved opt-in survives a new WordPress request', enabled.is_checked())
        check('alert controls do not expose renderer credentials or customer details', all(value not in panel.inner_text() for value in ['synthetic-renderer-token', 'Alex Morgan', '42 Example Street']))
        panel.screenshot(path=str(out / f'{label}-desktop.png'), animations='disabled')
        bad_nonce = admin_context.request.post(base + '/wp-admin/admin-post.php', form={'action': 'fullbleed_failure_alerts_save', 'failure_alerts': '1', '_wpnonce': 'invalid'})
        check('alert settings reject an invalid administrator nonce', bad_nonce.status == 403)
        login_to(staff, base, 'fb-shop_manager', destination)
        check('shop manager can use automation but cannot configure administrator alerts', staff.locator('#fullbleed-failure-alerts').count() == 0)
        denied = staff_context.request.post(base + '/wp-admin/admin-post.php', form={'action': 'fullbleed_failure_alerts_save', 'failure_alerts': '1'})
        check('shop manager cannot bypass the settings permission through POST', denied.status == 403)
        admin.set_viewport_size({'width': 390, 'height': 844})
        panel.scroll_into_view_if_needed()
        check('mobile alert controls fit the viewport', panel.is_visible() and admin.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        panel.screenshot(path=str(out / f'{label}-mobile.png'), animations='disabled')
        enabled.uncheck()
        panel.get_by_role('button', name='Save failure alerts', exact=True).click()
        wait_for_fixture_page(admin)
        expect(enabled).not_to_be_checked()
        check('administrator can disable alerts without editing renderer settings', admin.get_by_text('Failure alert settings saved.', exact=True).is_visible() and admin.locator('#fb-renderer-url').input_value() == 'https://renderer.example.test')
        check('alert settings have no JavaScript errors', not errors)
        evidence = [{'file': path.as_posix(), 'sha256': sha256(path.read_bytes()).hexdigest()} for path in [out / f'{label}-desktop.png', out / f'{label}-mobile.png']]
        (out / f'{label}-verification.json').write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), **browser_metadata(browser), 'store': base, 'checks': checks, 'pageErrors': errors, 'evidence': evidence, 'scope': 'Synthetic administrator settings only. WP-Cron is disabled in this fixture; no email is sent by browser actions.'}, indent=2), encoding='utf-8')
    except Exception:
        admin.screenshot(path=str(out / f'{label}-failure.png'), full_page=True)
        raise
    finally:
        admin_context.close()
        staff_context.close()
        browser.close()
