"""Stage the qualified free release and listing assets; never commit to SVN."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path, PurePosixPath
import re
import stat
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]


def require(value, message):
    if not value:
        raise ValueError(message)


def digest(data):
    return sha256(data).hexdigest()


def qualified_files(data, spec, overlay):
    """Allow only listing metadata to differ from the released archive."""
    require(len(data) == spec['archive']['bytes'], 'Release archive size differs')
    require(digest(data) == spec['archive']['sha256'], 'Release archive checksum differs')
    files = {}
    names = set()
    with ZipFile(BytesIO(data)) as archive:
        for item in archive.infolist():
            path = PurePosixPath(item.filename)
            require(item.orig_filename == item.filename, 'Unsafe normalized archive path')
            require(not path.is_absolute() and '..' not in path.parts and '\\' not in item.filename,
                    'Unsafe archive path')
            require(path.parts and path.parts[0] == spec['plugin'], 'Unexpected plugin in archive')
            require(not stat.S_ISLNK(item.external_attr >> 16), 'Archive contains a symbolic link')
            if item.is_dir():
                continue
            name = path.relative_to(spec['plugin']).as_posix()
            require(name and name.casefold() not in names, 'Duplicate archive path')
            names.add(name.casefold())
            files[name] = archive.read(item)
    original = files['readme.txt'].decode('utf-8')
    require(re.search(r'^Stable tag: ' + re.escape(spec['version']) + r'\s*$', original, re.M),
            'Readme version differs')
    header = files[spec['plugin'] + '.php'].decode('utf-8')
    require(re.search(r'^\s*\*?\s*Version:\s*' + re.escape(spec['version']) + r'\s*$', header, re.M),
            'Plugin header version differs')
    require(overlay.count('== Screenshots ==') == 1, 'Missing or duplicate screenshot captions')
    require(overlay.count('Donate link: https://github.com/sponsors/krflol\n') == 1,
            'Unexpected donation link')
    stripped = overlay.replace('Donate link: https://github.com/sponsors/krflol\n', '')
    stripped = re.sub(r'== Screenshots ==\n.*?(?=== Changelog ==)', '', stripped, flags=re.S)
    require(stripped == original, 'Directory readme changes more than captions and donation metadata')
    files['readme.txt'] = overlay.encode('utf-8')
    return files


def verify_tree(directory, entries):
    expected = {item['file']: item for item in entries}
    actual = {p.relative_to(directory).as_posix(): p for p in directory.rglob('*') if p.is_file()}
    require(actual.keys() == expected.keys(), 'Unexpected or missing staged files')
    for name, path in actual.items():
        require(not path.is_symlink(), 'Symbolic link in staged files')
        require(path.stat().st_size == expected[name]['bytes'] and digest(path.read_bytes()) == expected[name]['sha256'],
                'Staged checksum differs: ' + name)


def manifest(files):
    return [{'file': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in sorted(files.items())]


def prepare(output, plugin_zip=None):
    spec = json.loads((ROOT / 'docs/wordpress-directory/publication.json').read_text(encoding='utf-8'))
    capture = json.loads((ROOT / 'docs/wordpress-directory/verification.json').read_text(encoding='utf-8'))
    require(spec['plugin'] == 'fullbleed-commerce', 'Only the free plugin is supported')
    require(capture['pluginVersion'] == spec['version'] and capture['pluginZipSha256'] == spec['archive']['sha256'],
            'Listing assets do not match the qualified release')
    if plugin_zip:
        data = plugin_zip.read_bytes()
    else:
        with urlopen(spec['archive']['url'], timeout=60) as response:
            data = response.read(spec['archive']['bytes'] + 1)
    with urlopen(spec['verification']['url'], timeout=60) as response:
        proof = response.read(1024 * 1024)
    require(digest(proof) == spec['verification']['sha256'], 'Release evidence checksum differs')
    release = json.loads(proof)
    require(release['version'] == spec['version'] and release['sourceCommit'] == spec['sourceCommit'],
            'Release evidence does not match the pinned source')
    require(any(p['plugin'] == spec['plugin'] and p['sha256'] == spec['archive']['sha256']
                for p in release['packages']), 'Qualified archive is missing from release evidence')
    require(release['checks'] and all(c['conclusion'] == 'SUCCESS' for c in release['checks']),
            'Release evidence contains unsuccessful checks')
    overlay = (ROOT / 'docs/wordpress-directory/readme.txt').read_text(encoding='utf-8')
    require(digest(overlay.encode('utf-8')) == capture['readmeSha256'], 'Listing readme checksum differs')
    files = qualified_files(data, spec, overlay)
    assets_root = ROOT / '.wordpress-org'
    verify_tree(assets_root, capture['assets'])
    assets = {p.relative_to(assets_root).as_posix(): p.read_bytes() for p in assets_root.rglob('*') if p.is_file()}
    require(assets['blueprints/blueprint.json'] == (ROOT / 'playground/blueprint.json').read_bytes(),
            'Directory preview differs from the tested Blueprint')
    require(spec['archive']['url'] in assets['blueprints/blueprint.json'].decode('utf-8'),
            'Directory preview installs a different release')
    require(not output.exists() or not any(output.iterdir()), 'Use an empty staging directory')
    for kind, items in [('plugin', files), ('assets', assets)]:
        for name, value in items.items():
            path = output / kind / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(value)
    record = {
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'version': spec['version'], 'plugin': spec['plugin'], 'archive': spec['archive'],
        'sourceCommit': spec['sourceCommit'], 'releaseEvidenceSha256': digest(proof),
        'pluginFiles': manifest(files), 'assets': manifest(assets),
        'changedReleaseFiles': ['readme.txt'],
        'readmeChanges': ['Four screenshot captions', 'Optional GitHub Sponsors link'],
        'status': 'Prepared; no SVN mutation performed',
    }
    verify_tree(output / 'plugin', record['pluginFiles'])
    verify_tree(output / 'assets', record['assets'])
    (output / 'manifest.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / 'target/wordpress-release')
    parser.add_argument('--plugin-zip', type=Path)
    parser.add_argument('--verify', action='store_true', help='Verify an already prepared artifact without network or writes.')
    parser.add_argument('--svn-checkout', type=Path, help='Also verify the actual staged SVN trunk, tag and assets.')
    args = parser.parse_args()
    if args.verify:
        record = json.loads((args.output / 'manifest.json').read_text(encoding='utf-8'))
        verify_tree(args.output / 'plugin', record['pluginFiles'])
        verify_tree(args.output / 'assets', record['assets'])
    else:
        record = prepare(args.output, args.plugin_zip)
    if args.svn_checkout:
        for path in ['trunk', 'tags/' + record['version']]:
            verify_tree(args.svn_checkout / path, record['pluginFiles'])
        verify_tree(args.svn_checkout / 'assets', record['assets'])
    print(json.dumps({'version': record['version'], 'pluginFiles': len(record['pluginFiles']),
                      'assets': len(record['assets']), 'changedReleaseFiles': record['changedReleaseFiles']}))
