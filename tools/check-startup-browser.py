"""Real-browser regression for slow base/Pro scripts on synthetic local stores."""
from pathlib import Path
from datetime import datetime, timezone
from urllib.parse import urlparse
from hashlib import sha256
import json
import time
from playwright.sync_api import sync_playwright, expect

out = Path('output/playground')
checks = []
def check(name, value):
    assert value, name
    checks.append({'name': name, 'passed': True})
    print(name + ': passed', flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for label, base, password, pattern, pro in [
        ('base', 'http://127.0.0.1:9488', 'password', '**/fullbleed-commerce/assets/generated/admin.js*', False),
        ('Pro', 'http://127.0.0.1:9490', 'fullbleed-local-test', '**/fullbleed-commerce-pro/assets/admin.js*', True),
    ]:
        assert urlparse(base).hostname == '127.0.0.1'
        context = browser.new_context()
        page = context.new_page()
        page.set_default_timeout(45000)
        page.goto(base + '/wp-login.php')
        page.locator('#user_login').fill('admin')
        page.locator('#user_pass').fill(password)
        page.locator('#wp-submit').click()
        page.wait_for_url('**/wp-admin/**')
        held = []
        context.route(pattern, lambda route: held.append(route))
        page.goto(base + '/wp-admin/admin.php?page=fullbleed-commerce&order_ids=12', wait_until='commit')
        expect(page.locator('[data-render]')).to_be_disabled()
        expect(page.locator('[data-edit-template]')).to_be_disabled()
        page.wait_for_function("document.querySelector('[data-status]').textContent.includes('Loading document tools')")
        check(label + ': controls explain loading and remain disabled while the script is delayed', True)
        if pro:
            page.wait_for_function('Boolean(window.FullbleedCommerce)')
            check('Pro: base tools wait for the declared add-on', page.evaluate("window.FullbleedCommerce.config.extensions.includes('fullbleed-commerce-pro')"))
        navigations = []
        page.on('request', lambda request: navigations.append(request.url) if request.is_navigation_request() else None)
        before = page.url
        page.locator('#fb-orders').press('Enter')
        page.wait_for_timeout(250)
        check(label + ': Enter cannot submit an unhandled form during startup', page.url == before and not navigations)
        deadline = time.monotonic() + 30
        while not held and time.monotonic() < deadline:
            page.wait_for_timeout(50)
        check(label + ': actual script request was intercepted', len(held) == 1)
        held[0].continue_()
        expect(page.locator('[data-render]')).to_be_enabled(timeout=45000)
        expect(page.locator('[data-edit-template]')).to_be_enabled(timeout=45000)
        check(label + ': controls enable only after initialization completes', True)
        page.locator('[data-render]').click()
        page.locator('[data-preview]').wait_for(state='visible')
        check(label + ': initialized controls generate a real PDF without leaving the screen', page.url == before and page.locator('[data-preview]').get_attribute('href').startswith('blob:'))
        context.close()
    browser.close()

packages = json.loads(Path('dist/packages.json').read_text())
for item in packages:
    assert sha256(Path('dist', item['filename']).read_bytes()).hexdigest() == item['sha256']
out.mkdir(parents=True, exist_ok=True)
(out / 'startup-browser-verification.json').write_text(json.dumps({'checkedAt': datetime.now(timezone.utc).isoformat(), 'syntheticOnly': True, 'packages': packages, 'checks': checks}, indent=2) + '\n', encoding='utf-8')
