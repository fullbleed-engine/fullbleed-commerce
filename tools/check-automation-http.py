"""Settings authorization on a disposable loopback WooCommerce store."""
import os, re, json
from pathlib import Path
from urllib.parse import urlparse
import requests

base = os.environ.get('FULLBLEED_TEST_URL', 'http://127.0.0.1:9481')
assert urlparse(base).hostname == '127.0.0.1'
checks = []
def check(name, ok):
    assert ok, name
    checks.append({'name': name, 'passed': True})
def login(user):
    client = requests.Session()
    client.get(base + '/wp-login.php', timeout=30)
    client.post(base + '/wp-login.php', data={'log': user, 'pwd': 'fullbleed-local-test', 'testcookie': '1'}, timeout=30)
    return client
admin = login('admin')
page_url = base + '/wp-admin/admin.php?page=fullbleed-automation'
page = admin.get(page_url, timeout=30)
check('automation page loads without PHP warnings', page.ok and 'Attach your branded documents' in page.text and not any(x in page.text for x in ['Fatal error', '<b>Warning', 'Parse error']))
nonce = re.search(r'name="_wpnonce" value="([a-zA-Z0-9]+)"', page.text)[1]
post_url = base + '/wp-admin/admin-post.php'
config = {'action': 'fullbleed_automation_save', '_wpnonce': nonce, 'renderer_url': 'https://renderer.example.test', 'renderer_site': 'synthetic-store', 'renderer_token': 'synthetic-renderer-token-not-for-production', 'consent': '1'}
missing = admin.post(post_url, data={**config, '_wpnonce': ''}, timeout=30)
check('missing nonce cannot change automation', missing.status_code == 403)
editor = login('fb-editor')
check('editor cannot view automation settings', editor.get(page_url, timeout=30).status_code == 403)
check('editor cannot save automation even with an administrator nonce', editor.post(post_url, data=config, timeout=30).status_code == 403)
saved = admin.post(post_url, data=config, timeout=30)
check('authorized connection settings save', saved.ok and 'Automation settings saved' in saved.text)
check('secret is not returned to the browser', config['renderer_token'] not in saved.text)
check('automatic attachments remain opt-in after connection setup', not re.search(r'name="(?:summary|packing)_emails\[\]"[^>]*checked', saved.text))
check('customer downloads remain separately opt-in after connection setup', not re.search(r'name="customer_downloads"[^>]*checked', saved.text))
portal = admin.post(post_url, data={**config, 'customer_downloads': '1'}, timeout=30)
check('administrator can enable customer downloads without enabling emails', portal.ok and bool(re.search(r'name="customer_downloads"[^>]*checked', portal.text)) and not re.search(r'name="(?:summary|packing)_emails\[\]"[^>]*checked', portal.text))
without_consent = {**config, 'customer_downloads': '1'}
without_consent.pop('consent')
withdrawn = admin.post(post_url, data=without_consent, timeout=30)
check('withdrawing processing consent disables customer downloads', withdrawn.ok and not re.search(r'name="customer_downloads"[^>]*checked', withdrawn.text))
invalid = admin.post(post_url, data={**config, 'renderer_url': 'http://renderer.example.test'}, timeout=30)
check('unencrypted renderer endpoints are rejected', 'Use the HTTPS origin' in invalid.text)
nonce = re.search(r'name="_wpnonce" value="([a-zA-Z0-9]+)"', saved.text)[1]
cleared = admin.post(post_url, data={'action': 'fullbleed_automation_save', '_wpnonce': nonce, 'disconnect': '1'}, timeout=30)
check('disconnect clears the saved connection', cleared.ok and 'value="https://renderer.example.test"' not in cleared.text and 'value="synthetic-store"' not in cleared.text)
Path('output/automation/settings-http.json').write_text(json.dumps({'store': base, 'checks': checks}, indent=2))
print(f'{len(checks)} automation settings HTTP checks passed; no email types enabled.')
