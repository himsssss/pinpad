"""Renders the Pinpad icon (via macos/make-icon.swift) into desktop/assets/icon.ico and icon.png.

Run on a Mac: `npm run icons:win`. The outputs are committed, so Windows builds don't need it.
"""
import shutil
import struct
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / 'desktop' / 'assets'

with tempfile.TemporaryDirectory() as tmp:
    iconset = Path(tmp) / 'icon.iconset'
    subprocess.run(['swift', str(ROOT / 'macos' / 'make-icon.swift'), str(iconset)], check=True)
    # Windows picks the closest size; PNG-compressed entries are supported since Vista.
    sizes = {16: 'icon_16x16.png', 32: 'icon_32x32.png', 48: None, 64: 'icon_32x32@2x.png',
             128: 'icon_128x128.png', 256: 'icon_256x256.png'}
    images = []
    for size, name in sizes.items():
        if name is None:
            out = Path(tmp) / f'{size}.png'
            subprocess.run(['sips', '-z', str(size), str(size), str(iconset / 'icon_256x256.png'), '--out', str(out)],
                           check=True, capture_output=True)
        else:
            out = iconset / name
        images.append((size, out.read_bytes()))

    header = struct.pack('<HHH', 0, 1, len(images))
    offset = len(header) + 16 * len(images)
    entries, blobs = b'', b''
    for size, data in images:
        dim = 0 if size >= 256 else size
        entries += struct.pack('<BBBBHHII', dim, dim, 0, 0, 1, 32, len(data), offset + len(blobs))
        blobs += data
    ASSETS.mkdir(parents=True, exist_ok=True)
    (ASSETS / 'icon.ico').write_bytes(header + entries + blobs)
    shutil.copy(iconset / 'icon_256x256@2x.png', ASSETS / 'icon.png')

print(f'Wrote {ASSETS / "icon.ico"} and {ASSETS / "icon.png"}')
