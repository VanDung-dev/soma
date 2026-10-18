from html import escape
from pathlib import Path
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
ASSET_DIR = ROOT / 'src' / 'icons' / 'line-md'
GALLERY = ROOT / 'tools' / 'line-md-gallery.html'
SOURCE = 'https://raw.githubusercontent.com/cyberalien/line-md/main/svg'
GROUPS = {
    'Công tắc': [
        'switch-off',
        'switch-to-switch-off-transition',
        'switch-off-twotone-to-switch-twotone-transition',
        'switch-twotone',
    ],
    'Giao diện': [
        'sunny-outline-to-moon-alt-loop-transition',
        'sunny',
        'moon-alt',
        'moon-to-sunny-outline-loop-transition',
    ],
    'Điều hướng': [
        'arrow-small-left',
        'arrow-small-right',
        'chevron-small-right',
        'chevron-small-down',
    ],
    'Cài đặt': [
        'cog',
    ],
    'Xác nhận': [
        'square',
        'square-to-confirm-square-twotone-transition',
        'confirm-square-twotone',
        'confirm-square-twotone-to-square-transition',
        'alert-circle',
        'close-small',
    ],
}


def download_icons():
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    for names in GROUPS.values():
        for name in names:
            destination = ASSET_DIR / f'{name}.svg'
            request = Request(f'{SOURCE}/{name}.svg', headers={'User-Agent': 'human-atlas-rs icon downloader'})
            with urlopen(request, timeout=30) as response:
                svg = response.read()
            if not svg.lstrip().startswith(b'<svg') and b'<svg' not in svg[:500]:
                raise ValueError(f'Invalid SVG response for {name}')
            destination.write_bytes(svg)
            print(f'Downloaded {destination.relative_to(ROOT)}')


def build_gallery():
    sections = []
    for group, names in GROUPS.items():
        cards = []
        for name in names:
            svg = (ASSET_DIR / f'{name}.svg').read_text(encoding='utf-8').replace('<svg ', '<svg aria-hidden="true" ', 1)
            cards.append(f'<article><div class="preview">{svg}</div><code>line-md:{escape(name)}</code></article>')
        cards = ''.join(cards)
        sections.append(f'<section><h2>{escape(group)}</h2><div class="grid">{cards}</div></section>')
    document = '''<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Line MD — icon review</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:32px;font:15px system-ui,sans-serif;background:#f4f4f2;color:#222}
h1{margin:0 0 28px;font-size:24px}section{margin:0 0 32px}h2{font-size:17px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
article{min-width:0;padding:12px;border:1px solid #ddd;border-radius:12px;background:white}
.preview{height:112px;display:grid;place-items:center}.preview img{width:80px;height:80px}
code{display:block;overflow-wrap:anywhere;font-size:12px}
</style>
<h1>Line MD — danh sách icon</h1>
'''+ '\n'.join(sections) + '''
<script>
document.querySelectorAll('.preview svg').forEach(svg => setInterval(() => svg.setCurrentTime(0), 1600));
</script>
</html>
'''
    GALLERY.parent.mkdir(parents=True, exist_ok=True)
    GALLERY.write_text(document, encoding='utf-8')
    print(f'Created {GALLERY.relative_to(ROOT)}')


if __name__ == '__main__':
    names = [name for group in GROUPS.values() for name in group]
    assert len(names) == len(set(names)), 'Icon IDs must be unique across groups'
    download_icons()
    build_gallery()
