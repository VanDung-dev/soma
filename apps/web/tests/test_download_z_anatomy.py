import importlib.util
from io import BytesIO, StringIO
from contextlib import redirect_stdout
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch
from urllib.error import URLError
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile, ZipInfo

spec = importlib.util.spec_from_file_location(
    'download_z_anatomy', Path(__file__).resolve().parents[1] / 'scripts/download-z-anatomy.py')
importer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(importer)


def make_archive(entries=None):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        for name, contents in entries or [('Z-Anatomy/Startup.blend', b'BLENDER-v300source')]:
            archive.writestr(name, contents)
    return output.getvalue()


def response(data, expected=None):
    result = BytesIO(data)
    result.headers = {'Content-Length': str(len(data) if expected is None else expected)}
    return result


class SourcePreparationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        output = redirect_stdout(StringIO())
        output.__enter__()
        self.addCleanup(output.__exit__, None, None, None)

    def assert_unpublished(self):
        self.assertFalse((self.root / 'Z-Anatomy').exists())
        self.assertFalse((self.root / 'Z-Anatomy.zip').exists())
        self.assertEqual(list((self.root / '.cache/z-anatomy').iterdir()), [])

    def test_download_extract_and_reuse_existing_source(self):
        data = make_archive()
        with patch.object(importer, 'urlopen', return_value=response(data)) as fetch:
            source = importer.prepare_source(self.root)
            self.assertEqual(source.read_bytes(), b'BLENDER-v300source')
            self.assertEqual((self.root / 'Z-Anatomy.zip').read_bytes(), data)
            self.assertEqual(importer.prepare_source(self.root), source)
            fetch.assert_called_once()
            self.assertEqual(fetch.call_args.args[0].full_url, importer.SOURCE_URL)

    def test_cached_archive_needs_no_network(self):
        (self.root / 'Z-Anatomy.zip').write_bytes(make_archive())
        with patch.object(importer, 'urlopen', side_effect=AssertionError('Unexpected download')):
            self.assertTrue(importer.prepare_source(self.root).is_file())

    def test_failed_and_truncated_downloads_never_publish(self):
        data = make_archive()
        for remote in [URLError('offline'), response(data, len(data) + 1)]:
            with self.subTest(remote=type(remote).__name__):
                kwargs = {'side_effect': remote} if isinstance(remote, Exception) else {'return_value': remote}
                with patch.object(importer, 'urlopen', **kwargs):
                    with self.assertRaises((URLError, ValueError)):
                        importer.prepare_source(self.root)
                self.assert_unpublished()

    def test_corrupt_zip_and_missing_or_invalid_blend_never_publish(self):
        for data in [b'not a zip', make_archive([('Z-Anatomy/readme.txt', b'text')]),
                     make_archive([('Z-Anatomy/Startup.blend', b'bad blend')])]:
            with self.subTest(data=data[:12]):
                with patch.object(importer, 'urlopen', return_value=response(data)):
                    with self.assertRaises((BadZipFile, ValueError)):
                        importer.prepare_source(self.root)
                self.assert_unpublished()

    def test_unsafe_paths_are_rejected_before_extraction(self):
        for name in ['../escape', '/absolute', 'Z-Anatomy/../escape',
                     'Z-Anatomy\\escape', 'other/file', 'Z-Anatomy//file']:
            with self.subTest(path=name):
                data = make_archive([('Z-Anatomy/Startup.blend', b'BLENDERsource'), (name, b'bad')])
                with patch.object(importer, 'urlopen', return_value=response(data)):
                    with self.assertRaises(ValueError):
                        importer.prepare_source(self.root)
                self.assert_unpublished()
                self.assertFalse((self.root / 'escape').exists())

    def test_symlinks_are_rejected(self):
        link = ZipInfo('Z-Anatomy/link')
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        data = make_archive([('Z-Anatomy/Startup.blend', b'BLENDERsource'), (link, b'../outside')])
        with patch.object(importer, 'urlopen', return_value=response(data)):
            with self.assertRaises(ValueError):
                importer.prepare_source(self.root)
        self.assert_unpublished()

    def test_size_limits_leave_no_partial_source(self):
        data = make_archive()
        for limit in ['MAX_DOWNLOAD', 'MAX_EXTRACTED']:
            with self.subTest(limit=limit):
                with patch.object(importer, limit, 1), patch.object(importer, 'urlopen', return_value=response(data)):
                    with self.assertRaises(ValueError):
                        importer.prepare_source(self.root)
                self.assert_unpublished()

    def test_partial_existing_source_is_preserved(self):
        target = self.root / 'Z-Anatomy'
        target.mkdir()
        existing = target / 'local.txt'
        existing.write_text('keep')
        with patch.object(importer, 'urlopen') as fetch:
            with self.assertRaises(ValueError):
                importer.prepare_source(self.root)
            fetch.assert_not_called()
        self.assertEqual(existing.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()
