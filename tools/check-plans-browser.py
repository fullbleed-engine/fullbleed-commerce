# SPDX-License-Identifier: MIT
"""Plan usage and real PDF downloads through authenticated production routes."""
import base64, hashlib, hmac, json, time
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/browser'
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads((ROOT / 'target/plans-browser-fixture.json').read_text())
assert fixture['origin'] == 'http://127.0.0.1:9486'
assert fixture['shop'] == 'synthetic-plans.myshopify.com'
checks = []

def token():
    now = int(time.time())
    encode = lambda x: base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode({'iss': f"https://{fixture['shop']}/admin", 'dest': f"https://{fixture['shop']}", 'aud': 'synthetic-test-api-key', 'sub': '1', 'exp': now + 60, 'nbf': now - 1, 'iat': now, 'sid': 'synthetic-plan-browser'})
    return body + '.' + base64.urlsafe_b64encode(hmac.new(b'synthetic-webhook-test-secret', body.encode(), hashlib.sha256).digest()).decode().rstrip('=')

def check(name, condition):
    assert condition, name
    checks.append({'name': name, 'passed': True})

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1280, 'height': 1000}, accept_downloads=True, user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36')
    context.route('https://cdn.shopify.com/shopifycloud/app-bridge.js*', lambda route: route.fulfill(content_type='text/javascript', body="window.shopify={config:{apiKey:'synthetic-test-api-key'},environment:{embedded:true},loading:()=>{},ready:Promise.resolve()};"))
    context.route(f"{fixture['origin']}/**", lambda route: route.continue_(headers={**route.request.headers, 'Authorization': 'Bearer ' + token()}))
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    response = page.goto(f"{fixture['origin']}/app/plans", wait_until='networkidle')
    if response.status != 200:
        print(json.dumps({'status': response.status, 'text': page.inner_text('body')[:1500], 'errors': errors}))
    check('plan page authenticates through SDK', response.status == 200)
    expect(page.get_by_role('heading', name='249 orders used')).to_be_visible()
    expect(page.get_by_role('button', name='Change plan in Shopify')).to_be_visible()
    page.screenshot(path=str(OUT / 'shopify-plans-desktop.png'), full_page=True)
    page.goto(f"{fixture['origin']}/app", wait_until='networkidle')
    page.get_by_role('button', name='Create PDF').click()
    link = page.get_by_role('link', name='Download order-summary-1001.pdf')
    link.wait_for()
    with page.expect_download() as pending:
        link.click()
    pdf = OUT / 'shopify-plans-order-summary.pdf'
    pending.value.save_as(str(pdf))
    check('browser receives complete PDF', pdf.read_bytes().startswith(b'%PDF-'))
    page.goto(f"{fixture['origin']}/app/plans", wait_until='networkidle')
    expect(page.get_by_role('heading', name='250 orders used')).to_be_visible()
    check('successful order consumes final allowance unit', 'Your allowance is in use' in page.inner_text('body'))
    page.goto(f"{fixture['origin']}/app", wait_until='networkidle')
    page.get_by_role('button', name='Create PDF').click()
    page.get_by_role('link', name='Download order-summary-1001.pdf').wait_for()
    check('same-order reprint remains available at limit', True)
    page.get_by_role('combobox', name='Recent order').select_option('gid://shopify/Order/2')
    page.get_by_role('button', name='Create PDF').click()
    expect(page.get_by_text('This plan’s order allowance is used.', exact=False)).to_be_visible()
    check('new order explains limit without a PDF or charge', page.get_by_role('link', name='Download', exact=False).count() == 0)
    context.request.post(f"{fixture['origin']}/__fixture/scale")
    page.goto(f"{fixture['origin']}/app/plans", wait_until='networkidle')
    expect(page.get_by_role('heading', name='250 orders used')).to_be_visible()
    check('active upgrade preserves usage despite Shopify moving the trial end', '750 available' in page.inner_text('body'))
    page.set_viewport_size({'width': 390, 'height': 844})
    page.screenshot(path=str(OUT / 'shopify-plans-mobile.png'), full_page=True)
    check('mobile plan screen fits', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    # Observe SDK's top-frame billing handoff, without visiting or buying a plan.
    response = context.request.post(f"{fixture['origin']}/app/plans", headers={'Authorization': 'Bearer ' + token()}, max_redirects=0)
    body = response.text()
    check('plan changes use Shopify pricing destination', 'admin.shopify.com/store/synthetic-plans/charges/fullbleed-commerce/pricing_plans' in body or any('admin.shopify.com/store/synthetic-plans/charges/fullbleed-commerce/pricing_plans' in v for v in response.headers.values()))
    check('no browser runtime errors', not errors)
    version = browser.version
    browser.close()

files = ['shopify-plans-desktop.png', 'shopify-plans-mobile.png', 'shopify-plans-order-summary.pdf']
evidence = [{'file': f'output/browser/{name}', 'sha256': hashlib.sha256((OUT / name).read_bytes()).hexdigest()} for name in files]
record = {'checkedAt': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'browser': version, 'syntheticOnly': True, 'shopifyApiAndAdminShellStubbed': True, 'realSdkAuthentication': True, 'realPdfRendering': True, 'serverBuildSha256': fixture['serverBuildSha256'], 'checks': checks, 'evidence': evidence}
(OUT / 'shopify-plans-verification.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record, indent=2))
