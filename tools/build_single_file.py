"""Bundle index.html + style.css + game.js + assets/ into one self-contained HTML file.

Usage: python3 tools/build_single_file.py [output.html]
Default output: dist/battle-fleet-predreadnought.html
"""
import base64, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIME = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'mp3': 'audio/mpeg'}
ASSET_REF = re.compile(r'(?<=["\'(])(assets/[\w.-]+\.(png|jpe?g|mp3))(?=["\')])', re.I)


def read(name):
    with open(os.path.join(ROOT, name), encoding='utf-8') as f:
        return f.read()


def data_uri(m):
    with open(os.path.join(ROOT, m.group(1)), 'rb') as f:
        data = base64.b64encode(f.read()).decode()
    return f'data:{MIME[m.group(2).lower()]};base64,{data}'


html = read('index.html')
html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + read('style.css') + '</style>', 1)
html = html.replace('<script src="game.js"></script>', '<script>\n' + read('game.js') + '</script>', 1)
html = ASSET_REF.sub(data_uri, html)

out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'battle-fleet-predreadnought.html')
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'wrote {out} ({len(html) / 1e6:.1f} MB)')
