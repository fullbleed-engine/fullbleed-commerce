"""Exercise a disposable localhost WordPress/WooCommerce install over HTTP."""
import html
import json
import re
import os
from pathlib import Path
from urllib.parse import urlparse
import requests

BASE = os.environ.get('FULLBLEED_TEST_URL', 'http://127.0.0.1:9475')
assert urlparse(BASE).hostname == '127.0.0.1'
out = Path('output/wordpress')
out.mkdir(parents=True, exist_ok=True)
fixtures = requests.get(BASE + '/fullbleed-fixture.json', timeout=30).json()
records = {'versions': fixtures, 'checks': []}

def check(label, condition):
    records['checks'].append({'name': label, 'passed': bool(condition)})
    assert condition, label

def login(username):
    session = requests.Session()
    session.get(BASE + '/wp-login.php', timeout=30)
    response = session.post(BASE + '/wp-login.php', data={'log': username, 'pwd': 'fullbleed-local-test', 'wp-submit': 'Log In', 'redirect_to': BASE + '/wp-admin/', 'testcookie': '1'}, timeout=30)
    check(username + ' login', 'wordpress_logged_in_' in ';'.join(session.cookies.keys()))
    nonce = session.get(BASE + '/wp-admin/admin-ajax.php?action=rest-nonce', timeout=30).text.strip()
    check(username + ' nonce', bool(re.fullmatch(r'[a-zA-Z0-9]{10}', nonce)))
    return session, nonce

admin, nonce = login('admin')
page = admin.get(BASE + '/wp-admin/admin.php?page=fullbleed-commerce&order_ids=' + str(fixtures['orders'][0]), timeout=30)
check('admin page loads', page.status_code == 200 and 'data-config=' in page.text)
check('no PHP warnings in admin page', not any(value in page.text for value in ['Fatal error:', 'Warning:', 'Parse error:']))
config = json.loads(html.unescape(re.search(r'data-config="([^"]+)"', page.text).group(1)))
check('configured assets served by merchant origin', urlparse(config['assets']).netloc == urlparse(BASE).netloc)
check('page nonce matches session', config['nonce'] == nonce)
endpoint = config['endpoint'] + '/' + str(fixtures['orders'][0])
response = admin.get(endpoint, headers={'X-WP-Nonce': nonce}, timeout=30)
check('authorized order read', response.status_code == 200)
check('order responses cannot be cached', 'no-store' in response.headers.get('Cache-Control', ''))
order = response.json()
check('WooCommerce money preserved', order['totals'][-1]['amount'] == '$282.00')
check('customer address returned to authorized staff', order['shipping']['name'] == 'Alex Morgan')
(out / 'order.json').write_text(json.dumps(order, indent=2), encoding='utf-8')
check('anonymous order access denied', requests.get(endpoint, timeout=30).status_code == 401)
check('missing nonce denied', admin.get(endpoint, timeout=30).status_code == 401)
check('invalid nonce denied', admin.get(endpoint, headers={'X-WP-Nonce': 'invalid'}, timeout=30).status_code == 403)
refund = admin.get(config['endpoint'] + '/' + str(fixtures['refunded']), headers={'X-WP-Nonce': nonce}, timeout=30)
check('refunded order explicitly rejected', refund.status_code == 422 and refund.json()['code'] == 'fullbleed_refund_unsupported')
for role, expected in [('editor', 403), ('subscriber', 403), ('shop_manager', 200)]:
    session, role_nonce = login('fb-' + role)
    result = session.get(endpoint, headers={'X-WP-Nonce': role_nonce}, timeout=30)
    check(role + ' order permission', result.status_code == expected)

template_endpoint = config['templatesEndpoint'] + '/order-summary'
current = admin.get(template_endpoint, headers={'X-WP-Nonce': nonce}, timeout=30)
check('authorized template read and cache control', current.status_code == 200 and 'no-store' in current.headers.get('Cache-Control', ''))
revision = current.json()['revision']
custom = {'schema': 'fullbleed.commerce-template.v1', 'html': '<h1>{{seller.name}}</h1><p>Custom {{order.number}}</p>', 'css': '@page { size: A4; margin: 16mm; } h1 { color: #203a32; }'}
saved = admin.post(template_endpoint, headers={'X-WP-Nonce': nonce}, json={'revision': revision, 'template': custom}, timeout=30)
check('authorized template save preserves HTML and CSS', saved.status_code == 200 and saved.json()['template'] == custom)
stale = admin.post(template_endpoint, headers={'X-WP-Nonce': nonce}, json={'revision': revision, 'template': None}, timeout=30)
check('stale template overwrite rejected', stale.status_code == 409)
check('anonymous template access denied', requests.get(template_endpoint, timeout=30).status_code == 401)
check('template write without nonce denied', admin.post(template_endpoint, json={'revision': saved.json()['revision'], 'template': custom}, timeout=30).status_code == 401)
for role, expected in [('editor', 403), ('subscriber', 403), ('shop_manager', 200)]:
    session, role_nonce = login('fb-' + role)
    result = session.post(template_endpoint, headers={'X-WP-Nonce': role_nonce}, json={'revision': saved.json()['revision'], 'template': custom}, timeout=30)
    check(role + ' template permission', result.status_code == expected)
    if result.status_code == 200:
        saved = result
bad = admin.post(template_endpoint, headers={'X-WP-Nonce': nonce}, json={'revision': saved.json()['revision'], 'template': {'schema': 'other', 'html': 'x', 'css': ''}}, timeout=30)
check('invalid template schema rejected', bad.status_code == 422)
large = admin.post(template_endpoint, headers={'X-WP-Nonce': nonce}, json={'revision': saved.json()['revision'], 'template': {**custom, 'html': 'x' * 350001}}, timeout=30)
check('oversized template rejected', large.status_code == 422)
reset = admin.post(template_endpoint, headers={'X-WP-Nonce': nonce}, json={'revision': saved.json()['revision'], 'template': None}, timeout=30)
check('template reset restores built-in design', reset.status_code == 200 and reset.json()['template'] is None)

for filename in ['engine.wasm', 'worker.js', 'admin.js', 'editor.js', 'editor.css', 'fonts/Inter-Variable.ttf']:
    response = admin.get(config['assets'] + filename, timeout=30)
    expected = Path('wordpress/fullbleed-commerce/assets/generated', filename).read_bytes()
    check('bundled asset ' + filename, response.status_code == 200 and response.content == expected)

records['configuration'] = {'maxBatch': config['maxBatch'], 'designs': [t['value'] for t in config['themes']]}
(out / 'admin.html').write_text(page.text, encoding='utf-8')
(out / 'verification.json').write_text(json.dumps(records, indent=2), encoding='utf-8')
print(json.dumps(records, ensure_ascii=True, indent=2))
