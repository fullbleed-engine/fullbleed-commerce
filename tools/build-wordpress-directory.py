"""Build WordPress directory artwork and metadata from verified release inputs.

Requires the existing browser requirements. The release ZIP is read only; no
plugin code or package version changes. Native screenshot inputs are captured
separately with capture-wordpress-directory.py.
"""
import argparse
import base64
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import shutil
import struct
import zipfile

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / '.wordpress-org'
DOCS = ROOT / 'docs/wordpress-directory'
EXPECTED_ZIP = 'e5544fc080223e0700ec53e89d94a847073faa0d5a8a49893a8015410b397fc8'
EXPECTED_SAMPLE = 'cbb6b0aca94c33965d7615860e1863b18a8033e52999d625fbba23a5a0d46ee1'
EXPECTED_PREVIEW = '4dfbcb380a7876912e7019b971a44a90cd5d65014c1eb5f71bb7d05babb515d7'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plugin-zip', type=Path, required=True)
parser.add_argument('--captures', type=Path, default=ROOT / 'output/wordpress-directory')
parser.add_argument('--sample-preview', type=Path, required=True)
args = parser.parse_args()


def uri(mime, value):
    return 'data:' + mime + ';base64,' + base64.b64encode(value).decode('ascii')


def dimensions(path):
    data = path.read_bytes()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    return struct.unpack('>II', data[16:24])


assert sha256(args.plugin_zip.read_bytes()).hexdigest() == EXPECTED_ZIP
assert sha256((args.captures / 'sample-order.pdf').read_bytes()).hexdigest() == EXPECTED_SAMPLE
assert sha256(args.sample_preview.read_bytes()).hexdigest() == EXPECTED_PREVIEW
capture = json.loads((args.captures / 'capture-verification.json').read_text(encoding='utf-8'))
assert capture['pluginVersion'] == '0.1.5' and capture['syntheticOnly'] and not capture['pageErrors']
assert not capture.get('candidateEditor'), 'Publish directory images only from the released plugin.'
assert capture['iconAssets']['loaded'] and capture['iconAssets']['sameOrigin'] and not capture['blockedIconRequests']
assert len(capture['canvasFonts']['faces']) == 4 and all(font['status'] == 'loaded' for font in capture['canvasFonts']['faces'])
for asset in capture['assets']:
    assert sha256((args.captures / asset['file']).read_bytes()).hexdigest() == asset['sha256']
with zipfile.ZipFile(args.plugin_zip) as archive:
    font = archive.read('fullbleed-commerce/assets/generated/fonts/Inter-Variable.ttf')
    readme = archive.read('fullbleed-commerce/readme.txt').decode('utf-8')
icon = (ROOT / 'docs/marketplace/app-icon.svg').read_bytes()
ASSETS.mkdir(exist_ok=True)
(ASSETS / 'icon.svg').write_bytes(icon)
for number in range(1, 4):
    shutil.copyfile(args.captures / f'screenshot-{number}.png', ASSETS / f'screenshot-{number}.png')
shutil.copyfile(args.sample_preview, ASSETS / 'screenshot-4.png')
html = (DOCS / 'banner.html').read_text(encoding='utf-8')
for key, value in {'font': uri('font/ttf', font), 'icon': uri('image/svg+xml', icon), 'sample': uri('image/png', args.sample_preview.read_bytes())}.items():
    html = html.replace('{{' + key + '}}', value)
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for scale in (1, 2):
        context = browser.new_context(viewport={'width': 772, 'height': 250}, device_scale_factor=scale)
        page = context.new_page()
        page.set_content(html)
        page.evaluate('document.fonts.ready')
        page.wait_for_function('Array.from(document.images).every(image => image.complete && image.naturalWidth > 0)')
        assert page.evaluate('document.fonts.check("16px Inter")')
        page.screenshot(path=str(ASSETS / f'banner-{772 * scale}x{250 * scale}.png'))
        context.close()
    for size in (128, 256):
        context = browser.new_context(viewport={'width': size, 'height': size})
        page = context.new_page()
        page.set_content('<style>html,body{margin:0;}svg{display:block;width:100vw;height:100vh;}</style>' + icon.decode('utf-8'))
        page.screenshot(path=str(ASSETS / f'icon-{size}x{size}.png'))
        context.close()
    browser_version = browser.version
    browser.close()

captions = '''== Screenshots ==

1. Create an order summary or packing slip from a WooCommerce order. Choose paper size, an accent color and a closing note; download the PDF generated in your browser.
2. Customize a template in the included visual editor. Select text and blocks, adjust their styling, and save a separate design for each document type.
3. Paste static HTML and print CSS, insert order fields, and preview the actual PDF before saving. The visual editor and source editor work on the same template.
4. Actual one-page order summary from the free Studio design, with embedded fonts and WooCommerce's original totals. All names, addresses and order data are fictional.

'''
assert '== Screenshots ==' not in readme
readme = readme.replace('Contributors: kfinkelstein\n', 'Contributors: kfinkelstein\nDonate link: https://github.com/sponsors/krflol\n')
(DOCS / 'readme.txt').write_text(readme.replace('== Changelog ==', captions + '== Changelog =='), encoding='utf-8', newline='\n')
blueprint = ASSETS / 'blueprints/blueprint.json'
blueprint.parent.mkdir(exist_ok=True)
shutil.copyfile(ROOT / 'playground/blueprint.json', blueprint)
assets = []
for path in sorted(ASSETS.rglob('*')):
    if not path.is_file():
        continue
    item = {'file': path.relative_to(ASSETS).as_posix(), 'bytes': path.stat().st_size, 'sha256': sha256(path.read_bytes()).hexdigest()}
    if path.suffix == '.png':
        item['dimensions'] = dimensions(path)
        if path.name.startswith(('banner-', 'icon-')):
            assert list(item['dimensions']) == [int(v) for v in path.stem.split('-')[-1].split('x')]
        assert item['bytes'] < (4 if path.name.startswith('banner') else 1 if path.name.startswith('icon') else 10) * 1024 * 1024
    assets.append(item)
manifest = {'checkedAt': datetime.now(timezone.utc).isoformat(), 'status': 'Prepared; WordPress approval and directory publication are not established.', 'pluginVersion': '0.1.5', 'pluginZipSha256': EXPECTED_ZIP, 'samplePdfSha256': EXPECTED_SAMPLE, 'samplePreviewSha256': sha256(args.sample_preview.read_bytes()).hexdigest(), 'browser': browser_version, 'capture': capture, 'assets': assets, 'readmeSha256': sha256((DOCS / 'readme.txt').read_bytes()).hexdigest(), 'blueprintMatchesPublicDemoSource': blueprint.read_bytes() == (ROOT / 'playground/blueprint.json').read_bytes(), 'claims': ['Only free plugin features are shown.', 'Order summary is not represented as a fiscal invoice.', 'Screenshots contain fictional sample-store data.', 'No changes to released plugin ZIP bytes.']}
(DOCS / 'verification.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'assets': len(assets), 'browser': browser_version, 'output': str(ASSETS)}, indent=2))
