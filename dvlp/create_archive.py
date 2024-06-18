"""Create an archive ready for installation in QGis.
Unfortunately, the release-archives created by GitHub contain the version number,
and so they cannot be used as PlugIn archives."""

import os
from pathlib import Path
import zipfile

os.chdir(Path(__file__).parent)
plugInName = Path('selorecon')
archivePath = f'{plugInName}.zip'
with zipfile.ZipFile(archivePath, 'w', zipfile.ZIP_DEFLATED) as archive:
    os.chdir('..')
    for name in ('__init__.py',
                 'aerial_item.py',
                 'georef.py',
                 'LICENSE',
                 'main.py',
                 'main_window.py',
                 'main_window_base.ui',
                 'map_scene.py',
                 'map_view.py',
                 'metadata.txt',
                 'preview_window.py',
                 'preview_window_base.ui',
                 'README.md',
                 'readme.png',
                 'resources_rc.py',
                 'selorecon.cfg',
                 'web_view.py'):
        archive.write(name, plugInName / name)

    for path in Path('VisAnPrototype').rglob('*'):
        archive.write(path, plugInName / path)
        

        
