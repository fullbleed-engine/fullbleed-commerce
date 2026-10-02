"""Update assets from the final ZIP on named disposable Playground instances.

This does not touch merchant sites, browser sessions or plugin state. The first
install/activation is performed by the Playground blueprint; this is a frontend
asset refresh during testing. Every destination is confined to that owned site.
"""
from pathlib import Path
from zipfile import ZipFile
import argparse
import json
import os
from hashlib import sha256

parser = argparse.ArgumentParser()
parser.add_argument('--pid', type=int, required=True)
args = parser.parse_args()
temporary = Path(os.environ['TEMP']).resolve()
sites = list(temporary.glob(f'node.exe-playground-cli-site-{args.pid}--*/wordpress/wp-content/plugins'))
assert len(sites) == 1, 'Expected exactly one named Playground instance.'
plugins = sites[0].resolve()
assert plugins.is_relative_to(temporary)
records = []
for package in json.loads(Path('dist/packages.json').read_text()):
    with ZipFile(Path('dist', package['filename'])) as zipped:
        for entry in zipped.infolist():
            name = entry.filename.split('/')[0]
            assert name in ('fullbleed-commerce', 'fullbleed-commerce-pro')
            if not (plugins / name).is_dir():
                continue
            # Preserve PHP, store data and editor state; update generated assets
            # and public notices only. The ZIP's PHP is required to match first.
            destination = (plugins / entry.filename).resolve()
            assert destination.is_relative_to(plugins / name)
            content = zipped.read(entry)
            if '/assets/' in entry.filename or '/source/' in entry.filename or entry.filename.endswith('/readme.txt'):
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_bytes(content)
            else:
                assert destination.read_bytes() == content, 'Restart the package install if PHP changed.'
        records.append({'archive': package['filename'], 'sha256': sha256(Path('dist', package['filename']).read_bytes()).hexdigest()})
print(json.dumps({'sitePid': args.pid, 'method': 'initial ZIP install; frontend assets refreshed from final archive', 'packages': records}))
