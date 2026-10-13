"""Prepare the upstream Blender source using only the Python standard library."""
from pathlib import Path, PurePosixPath
import stat
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

SOURCE_URL = 'https://raw.githubusercontent.com/Z-Anatomy/Models-of-human-anatomy/master/Z-Anatomy.zip'
MAX_DOWNLOAD = 512 * 1024 * 1024
MAX_EXTRACTED = 2 * 1024 * 1024 * 1024


def download_archive(url, destination):
    request = Request(url, headers={'User-Agent': 'human-atlas-rs model importer'})
    print(f'Downloading Z-Anatomy source: {url}', flush=True)
    with urlopen(request, timeout=60) as response, destination.open('wb') as output:
        expected = response.headers.get('Content-Length')
        expected = int(expected) if expected is not None else None
        if expected is not None and not 0 < expected <= MAX_DOWNLOAD:
            raise ValueError('Unexpected archive download size')
        downloaded = 0
        while chunk := response.read(1024 * 1024):
            downloaded += len(chunk)
            if downloaded > MAX_DOWNLOAD:
                raise ValueError('Archive download exceeds size limit')
            output.write(chunk)
        if not downloaded or (expected is not None and downloaded != expected):
            raise ValueError('Incomplete archive download')


def extract_archive(archive_path, destination):
    with ZipFile(archive_path) as archive:
        names = set()
        total = 0
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            components = entry.filename.rstrip('/').split('/')
            if ('\\' in entry.filename or path.is_absolute()
                    or any(part in {'', '.', '..'} for part in components)
                    or components[0] != 'Z-Anatomy'):
                raise ValueError(f'Unsafe archive path: {entry.filename}')
            if str(path) in names:
                raise ValueError(f'Duplicate archive path: {entry.filename}')
            names.add(str(path))
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in {0, stat.S_IFREG, stat.S_IFDIR} or entry.flag_bits & 1:
                raise ValueError(f'Unsupported archive entry: {entry.filename}')
            total += entry.file_size
            if total > MAX_EXTRACTED:
                raise ValueError('Extracted source exceeds size limit')
        if 'Z-Anatomy/Startup.blend' not in names:
            raise ValueError('Archive is missing Z-Anatomy/Startup.blend')
        archive.extractall(destination)
    source = destination / 'Z-Anatomy' / 'Startup.blend'
    with source.open('rb') as file:
        if file.read(7) != b'BLENDER':
            raise ValueError('Startup.blend is not a supported Blender source file')


def prepare_source(root):
    target = root / 'Z-Anatomy'
    source = target / 'Startup.blend'
    if source.is_file():
        print(f'Using existing Blender source: {source}', flush=True)
        return source
    if target.exists():
        raise ValueError(f'{target} exists without Startup.blend; move it aside before importing')
    cache = root / '.cache' / 'z-anatomy'
    cache.mkdir(parents=True, exist_ok=True)
    archive = root / 'Z-Anatomy.zip'
    with TemporaryDirectory(prefix='source-', dir=cache) as temporary:
        stage = Path(temporary)
        downloaded = not archive.exists()
        staged_archive = stage / 'Z-Anatomy.zip' if downloaded else archive
        if downloaded:
            download_archive(SOURCE_URL, staged_archive)
        print(f'Extracting Z-Anatomy source: {staged_archive}', flush=True)
        extract_archive(staged_archive, stage)
        if downloaded:
            staged_archive.replace(archive)
        (stage / 'Z-Anatomy').rename(target)
    print(f'Prepared Blender source: {source}', flush=True)
    return source


if __name__ == '__main__':
    try:
        prepare_source(Path(__file__).resolve().parents[3])
    except (OSError, ValueError, BadZipFile, RuntimeError) as error:
        raise SystemExit(f'Z-Anatomy source preparation failed: {error}') from error
