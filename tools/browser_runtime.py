"""Select an owned test browser without touching the user's browser session."""
from importlib.metadata import version
import os
import platform

engine = os.environ.get('FULLBLEED_TEST_BROWSER', 'chrome')
if engine not in ('chrome', 'firefox', 'webkit'):
    raise ValueError('FULLBLEED_TEST_BROWSER must be chrome, firefox or webkit.')


def launch_browser(playwright):
    if engine == 'chrome':
        return playwright.chromium.launch(channel='chrome', headless=True)
    return getattr(playwright, engine).launch(headless=True)


def browser_label(base):
    return base if engine == 'chrome' else f'{base}-{engine}'


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
