from html import escape
from pathlib import Path
import re
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[3]
ASSET_DIR = ROOT / 'apps' / 'web' / 'src' / 'icons' / 'line-md'
GALLERY = ROOT / 'tools' / 'line-md-gallery.html'
SOURCE = 'https://raw.githubusercontent.com/cyberalien/line-md/main/svg'
GROUPS = {
    'Giao diện': {
        'star-alt': ['Chọn giao diện tự động theo hệ thống trong Cài đặt → Giao diện (18 px).'],
        'sunny': ['Chọn giao diện sáng trong Cài đặt → Giao diện (18 px).'],
        'moon-alt': ['Chọn giao diện tối trong Cài đặt → Giao diện (18 px).'],
    },
    'Điều hướng': {
        'arrow-small-left': ['Back — quay lại lần chọn hoặc focus cấu trúc/hệ trước đó trên thanh điều hướng (18 px).'],
        'arrow-small-right': ['Forward — tiến tới lần chọn hoặc focus cấu trúc/hệ sau khi đã Back trên thanh điều hướng (18 px).'],
        'chevron-small-right': ['Nhánh đang thu gọn — mở nhánh hệ/thư mục trong cây cấu trúc (24 px).'],
        'chevron-small-down': ['Nhánh đang mở — thu gọn nhánh hệ/thư mục trong cây cấu trúc (24 px).'],
    },
    'Cài đặt và trợ giúp': {
        'cog': ['Mở bảng Cài đặt từ thanh điều hướng (18 px).'],
        'alert-circle': ['Mở bảng Trợ giúp điều khiển bàn phím và chuột từ thanh điều hướng (18 px).'],
        'close-small': [
            'Đóng bảng Cài đặt (18 px).',
            'Đóng bảng Trợ giúp điều khiển bàn phím và chuột (18 px).',
        ],
    },
    'Hiển thị cấu trúc': {
        'square-to-confirm-square-twotone-transition': [
            'Checkbox đã chọn — toàn bộ cấu trúc của hệ/thư mục hoặc cấu trúc riêng lẻ đang hiển thị; bấm để ẩn (24 px).',
        ],
        'confirm-square-twotone-to-square-transition': [
            'Checkbox chưa chọn — cấu trúc đang ẩn; bấm để hiện. Khi chỉ hiện một phần hệ/thư mục, CSS thêm dấu gạch ngang cho trạng thái hỗn hợp (24 px).',
        ],
    },
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
    names = [name for group in GROUPS.values() for name in group]
    registered = re.findall(r'\./icons/line-md/([^"/]+)\.svg\?raw', (ASSET_DIR.parents[1] / 'icons.tsx').read_text(encoding='utf-8'))
    assert len(names) == len(set(names)), 'Icon IDs must be unique across groups'
    assert set(names) == set(registered), 'Gallery roles must cover exactly the registered LineIcon assets'
    sections = []
    for group, icons in GROUPS.items():
        cards = []
        for name, roles in icons.items():
            assert roles and all(roles), f'Missing roles for {name}'
            svg = (ASSET_DIR / f'{name}.svg').read_text(encoding='utf-8').replace('<svg ', '<svg aria-hidden="true" ', 1)
            role_list = ''.join(f'<li>{escape(role)}</li>' for role in roles)
            cards.append(f'<article><div class="preview">{svg}</div><code>line-md:{escape(name)}</code><ul>{role_list}</ul></article>')
        cards = ''.join(cards)
        sections.append(f'<section><h2>{escape(group)}</h2><div class="grid">{cards}</div></section>')
    document = '''<!doctype html>
<html lang="vi">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Line MD — icon và vai trò trong Human Atlas</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:clamp(16px,4vw,32px);font:15px/1.5 system-ui,sans-serif;background:#f4f4f2;color:#222}
h1{margin:0 0 8px;font-size:24px}header{margin-bottom:28px}header p{margin:0;color:#555}section{margin:0 0 32px}h2{font-size:17px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr));gap:12px}
article{min-width:0;padding:12px;border:1px solid #ddd;border-radius:12px;background:white}
.preview{height:112px;display:grid;place-items:center}.preview svg{width:64px;height:64px}
code{display:block;overflow-wrap:anywhere;font-size:12px}
ul{margin:12px 0 0;padding-left:20px}li+li{margin-top:8px}footer{font-size:13px;color:#555}a{color:inherit}
</style>
<header><h1>Line MD — icon và vai trò trong Human Atlas</h1>
<p>''' + f'{len(names)} icon · {sum(len(roles) for group in GROUPS.values() for roles in group.values())} vai trò' + '''. Preview phóng lớn; kích thước trong mô tả là kích thước đang dùng trong ứng dụng.</p></header>
<main>'''+ '\n'.join(sections) + '''</main>
<footer>Material Line Icons (line-md) © 2020 Vjacheslav Trushkin · <a href="https://github.com/cyberalien/line-md/blob/main/license.txt">MIT License</a></footer>
<script>
const previews = document.querySelectorAll('.preview svg');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
function replay() {
  previews.forEach(svg => {
    svg.unpauseAnimations();
    svg.setCurrentTime(reducedMotion.matches ? 10 : 0);
    if (reducedMotion.matches) svg.pauseAnimations();
  });
}
replay();
reducedMotion.addEventListener('change', replay);
setInterval(() => { if (!document.hidden && !reducedMotion.matches) replay(); }, 2000);
</script>
</html>
'''
    GALLERY.parent.mkdir(parents=True, exist_ok=True)
    GALLERY.write_text(document, encoding='utf-8')
    print(f'Created {GALLERY.relative_to(ROOT)}')


if __name__ == '__main__':
    download_icons()
    build_gallery()
