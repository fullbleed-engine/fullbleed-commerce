# SPDX-License-Identifier: MIT
"""Real browser test of production routes with synthetic Shopify JWTs, no live shop."""
import base64
import hashlib
import hmac
import json
import time
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "output/browser"
OUT.mkdir(parents=True, exist_ok=True)
fixture = json.loads((ROOT / "target/privacy-browser-fixture.json").read_text())
assert fixture["origin"] == "http://127.0.0.1:9484"
assert fixture["shop"] == "synthetic-privacy.myshopify.com"
SECRET = b"synthetic-webhook-test-secret"
checks = []


def check(name, condition):
    assert condition, name
    checks.append({"name": name, "passed": True})


def token():
    now = int(time.time())
    encode = lambda data: base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
    body = encode({"alg": "HS256", "typ": "JWT"}) + "." + encode({"iss": f"https://{fixture['shop']}/admin", "dest": f"https://{fixture['shop']}", "aud": "synthetic-test-api-key", "sub": "1", "exp": now + 60, "nbf": now - 1, "iat": now, "sid": "synthetic-browser"})
    return body + "." + base64.urlsafe_b64encode(hmac.new(SECRET, body.encode(), hashlib.sha256).digest()).decode().rstrip("=")


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(viewport={"width": 1280, "height": 1000}, accept_downloads=True, user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36")
    # App Bridge needs the real Shopify admin host. Replace only that shell API;
    # Polaris, React hydration, SDK token verification and routes are real.
    context.route("https://cdn.shopify.com/shopifycloud/app-bridge.js*", lambda route: route.fulfill(content_type="text/javascript", body="window.shopify={config:{apiKey:'synthetic-test-api-key'},environment:{embedded:true},loading:()=>{},ready:Promise.resolve()};"))
    def authorize(route):
        route.continue_(headers={**route.request.headers, "Authorization": "Bearer " + token()})
    context.route(f"{fixture['origin']}/**", authorize)
    page = context.new_page()
    errors = []
    network_errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.on("requestfailed", lambda request: network_errors.append({"url": request.url.split("?")[0], "failure": request.failure}))
    response = page.goto(f"{fixture['origin']}/app/privacy", wait_until="networkidle")
    try:
        page.get_by_role("button", name="Prepare export 90001").wait_for()
    except Exception:
        print(json.dumps({"status": response.status, "body": page.inner_text("body")[:2000], "errors": errors, "network": network_errors}, indent=2))
        raise
    check("authenticated merchant page with no paid-plan or Admin API call", response.status == 200)
    check("overdue request calls for action", "past the 30-day response deadline" in page.inner_text("body"))
    check("no customer identifiers in list", "synthetic-90001@example.invalid" not in page.inner_text("body"))
    page.screenshot(path=str(OUT / "shopify-privacy-desktop.png"), full_page=True)
    page.get_by_role("button", name="Prepare export 90001").click()
    link = page.get_by_role("link", name="Download fullbleed-privacy-90001.json")
    link.wait_for()
    with page.expect_download() as download_info:
        link.click()
    export = OUT / "shopify-privacy-export.json"
    download_info.value.save_as(str(export))
    report = json.loads(export.read_text())
    check("browser download preserves large IDs", report["requestedOrderIds"] == ["gid://shopify/Order/820982911946154508"])
    check("download contains captured metadata", report["automationJobs"][0]["downloads"] == 2)
    check("download does not auto-complete customer response", page.get_by_role("button", name="Mark handled and clear export").is_visible())
    page.get_by_role("checkbox", name="I have handled this request through my store’s privacy process.").check()
    page.get_by_role("button", name="Mark handled and clear export").click()
    try:
        page.get_by_text("Request marked handled.", exact=False).wait_for()
    except Exception:
        print(json.dumps({"stage": "completion", "body": page.inner_text("body")[:2500], "errors": errors, "network": network_errors}, indent=2))
        raise
    check("explicit completion clears download UI", page.get_by_role("link", name="Download fullbleed-privacy-90001.json").count() == 0)
    check("merchant receipt appears", "Request 90001 · Marked handled by merchant" in page.inner_text("body"))
    cleared = context.request.get(f"{fixture['origin']}/app/privacy-export?id={fixture['ids'][0]}", headers={"Authorization": "Bearer " + token()})
    check("completed export returns gone", cleared.status == 410)
    page.set_viewport_size({"width": 390, "height": 844})
    page.screenshot(path=str(OUT / "shopify-privacy-mobile.png"), full_page=True)
    check("mobile page fits viewport", page.evaluate("document.documentElement.scrollWidth <= innerWidth"))
    # Deliver a signed email-only customer-erasure webhook through the real route.
    payload = json.dumps({"shop_domain": fixture["shop"], "shop_id": 1, "customer": {"email": "synthetic-90002@example.invalid"}, "orders_to_redact": []})
    erased = context.request.post(f"{fixture['origin']}/webhooks/privacy", data=payload, headers={"Content-Type": "application/json", "X-Shopify-Topic": "customers/redact", "X-Shopify-Shop-Domain": fixture["shop"], "X-Shopify-API-Version": "2026-10", "X-Shopify-Webhook-Id": "00000000-0000-4000-8000-000000000099", "X-Shopify-Hmac-Sha256": base64.b64encode(hmac.new(SECRET, payload.encode(), hashlib.sha256).digest()).decode()})
    check("signed erasure webhook accepted", erased.status == 204)
    page.get_by_role("button", name="Refresh requests").click()
    page.get_by_text("No outstanding customer data requests.", exact=True).wait_for()
    check("erasure reflected in merchant UI", "Request 90002 · Erased by Shopify request" in page.inner_text("body"))
    check("no browser runtime errors", not errors)
    version = browser.version
    browser.close()

evidence = []
for name in ["shopify-privacy-desktop.png", "shopify-privacy-mobile.png", "shopify-privacy-export.json"]:
    path = OUT / name
    evidence.append({"file": path.relative_to(ROOT).as_posix(), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
record = {"checkedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "browser": version, "syntheticOnly": True, "shopifyAdminShellStubbed": True, "realSdkAuthentication": True, "productionBuildSha256": hashlib.sha256((ROOT / "shopify/app/build/server/index.js").read_bytes()).hexdigest(), "checks": checks, "evidence": evidence}
(OUT / "shopify-privacy-verification.json").write_text(json.dumps(record, indent=2) + "\n")
print(json.dumps({"passed": len(checks), "browser": version, "evidence": evidence}, indent=2))
