"""Release packaging checks: wrong artifacts and unexpected files fail closed."""
import importlib.util
from io import BytesIO
from pathlib import Path
import stat
import tempfile
import unittest
from zipfile import ZipFile, ZipInfo

spec = importlib.util.spec_from_file_location('wordpress_release', Path(__file__).resolve().parents[1] / 'tools/prepare-wordpress-release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseChecks(unittest.TestCase):
    def setUp(self):
        self.readme = '=== Fullbleed Commerce ===\nContributors: kfinkelstein\nStable tag: 0.1.6\n\n== Changelog ==\n'
        self.overlay = self.readme.replace('Contributors: kfinkelstein\n', 'Contributors: kfinkelstein\nDonate link: https://github.com/sponsors/krflol\n').replace('== Changelog ==', '== Screenshots ==\n\n1. Actual PDF.\n\n== Changelog ==')

    def archive(self, extra=None, header_version='0.1.6'):
        buffer = BytesIO()
        with ZipFile(buffer, 'w') as archive:
            archive.writestr('fullbleed-commerce/readme.txt', self.readme)
            archive.writestr('fullbleed-commerce/fullbleed-commerce.php', '<?php\n/**\n * Version: ' + header_version + '\n */\n')
            if extra:
                entry, content = extra
                if isinstance(entry, str):
                    raw_name = entry
                    entry = ZipInfo(raw_name)
                    entry.filename = raw_name  # Keep invalid Windows separators in this test fixture.
                archive.writestr(entry, content)
        data = buffer.getvalue()
        return data, {'plugin': 'fullbleed-commerce', 'version': '0.1.6', 'archive': {'bytes': len(data), 'sha256': release.digest(data)}}

    def test_only_readme_metadata_changes(self):
        data, config = self.archive()
        files = release.qualified_files(data, config, self.overlay)
        with ZipFile(BytesIO(data)) as archive:
            self.assertEqual(files['fullbleed-commerce.php'], archive.read('fullbleed-commerce/fullbleed-commerce.php'))
        self.assertEqual(files['readme.txt'], self.overlay.encode())

    def test_rejects_altered_archive(self):
        data, config = self.archive()
        with self.assertRaisesRegex(ValueError, 'checksum'):
            release.qualified_files(bytes([data[0] ^ 1]) + data[1:], config, self.overlay)

    def test_rejects_wrong_version(self):
        data, config = self.archive(header_version='0.1.5')
        with self.assertRaisesRegex(ValueError, 'header version'):
            release.qualified_files(data, config, self.overlay)

    def test_rejects_unrelated_readme_changes(self):
        data, config = self.archive()
        with self.assertRaisesRegex(ValueError, 'changes more'):
            release.qualified_files(data, config, self.overlay.replace('Stable tag: 0.1.6', 'Stable tag: 0.1.5'))

    def test_rejects_paths_outside_plugin(self):
        for path in ['fullbleed-commerce/../escape.php', '/absolute.php', 'fullbleed-commerce-pro/pro.php', 'fullbleed-commerce\\bad.php']:
            with self.subTest(path=path):
                data, config = self.archive((path, 'bad'))
                with self.assertRaises(ValueError):
                    release.qualified_files(data, config, self.overlay)

    def test_rejects_symlink(self):
        entry = ZipInfo('fullbleed-commerce/link')
        entry.external_attr = (stat.S_IFLNK | 0o777) << 16
        data, config = self.archive((entry, '../outside'))
        with self.assertRaisesRegex(ValueError, 'symbolic link'):
            release.qualified_files(data, config, self.overlay)

    def test_rejects_case_collisions(self):
        data, config = self.archive(('fullbleed-commerce/README.txt', 'wrong'))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            release.qualified_files(data, config, self.overlay)

    def test_staging_detects_missing_extra_and_altered_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            expected = release.manifest({'file.txt': b'expected'})
            with self.assertRaises(ValueError):
                release.verify_tree(root, expected)
            (root / 'file.txt').write_bytes(b'expected')
            release.verify_tree(root, expected)
            (root / 'file.txt').write_bytes(b'altered!')
            with self.assertRaisesRegex(ValueError, 'checksum'):
                release.verify_tree(root, expected)
            (root / 'file.txt').write_bytes(b'expected')
            (root / 'extra.txt').write_text('unexpected')
            with self.assertRaisesRegex(ValueError, 'Unexpected'):
                release.verify_tree(root, expected)


if __name__ == '__main__':
    unittest.main()
