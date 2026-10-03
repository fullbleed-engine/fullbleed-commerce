"""Select an owned test browser without touching the user's browser session."""
from importlib.metadata import version
import os
import platform
from urllib.parse import urlencode, urlsplit

engine = os.environ.get('FULLBLEED_TEST_BROWSER', 'chrome')
if engine not in ('chrome', 'firefox', 'webkit'):
    raise ValueError('FULLBLEED_TEST_BROWSER must be chrome, firefox or webkit.')


def launch_browser(playwright):
    if engine == 'chrome':
        return playwright.chromium.launch(channel='chrome', headless=True)
    return getattr(playwright, engine).launch(headless=True)


def browser_label(base):
    return base if engine == 'chrome' else f'{base}-{engine}'


def wait_for_fixture_page(page):
    # These disposable stores have no polling, analytics or external requests.
    # Finish WordPress preferences/cart requests before the next navigation or
    # form submission, and finish theme fonts before testing a native download.
    # This is test synchronization, not a production application's ready signal.
    page.wait_for_load_state('networkidle')
    page.wait_for_function("document.fonts.status === 'loaded'")


def login_to(page, base, user, destination):
    page.goto(base + '/wp-login.php?' + urlencode({'redirect_to': destination}))
    page.locator('#user_login').fill(user)
    page.locator('#user_pass').fill('fullbleed-local-test')
    page.locator('#wp-submit').click()
    # A newly activated WooCommerce can redirect the first administrator visit
    # to its home screen even when login requested another protected page.
    woo_home = base + '/wp-admin/admin.php?page=wc-admin'
    page.wait_for_url(lambda url: str(url) in (destination, woo_home), wait_until='load')
    wait_for_fixture_page(page)
    if page.url == woo_home and destination != woo_home:
        assert user == 'admin' and urlsplit(destination).path.startswith('/wp-admin/')
        page.goto(destination)
        wait_for_fixture_page(page)
    assert page.url == destination


def browser_metadata(browser):
    return {
        'browser': browser.version,
        'browserEngine': engine,
        'browserDistribution': {
            'chrome': 'Google Chrome channel',
            'firefox': 'Playwright Firefox',
            'webkit': 'Playwright WebKit (not branded Safari)',
        }[engine],
        'playwright': version('playwright'),
        'platform': platform.platform(),
    }
