"""Build an installable archive containing only reviewed extension files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from hashlib import sha256
import json

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'manifest.json').read_text())['version']
files = ['manifest.json', 'index.js', 'extension.js', 'extension.css', 'host.js', 'isolated-generation.js', 'chronicle.js', 'links.js',
         'world-info.js', 'migration.js', 'README.md', 'CHANGELOG.md', 'LICENSE', 'NOTICE.md',
         'docs/MIGRATION.md', 'docs/EMBEDDINGS.md', 'docs/embedding-visual-guide.html']
output = root / 'dist'
output.mkdir(exist_ok=True)
archive = output / f'memoryVaultSilly_{version}.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as bundle:
    for name in files:
        bundle.write(root / name, f'memoryVaultSilly/{name}')
with ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert len(bundle.namelist()) == len(files)
digest = sha256(archive.read_bytes()).hexdigest()
(archive.with_suffix('.sha256')).write_text(f'{digest}  {archive.name}\n')
print(f'{archive} ({archive.stat().st_size} bytes)')
print(f'SHA-256: {digest}')
