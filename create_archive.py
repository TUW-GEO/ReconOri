"""Create an archive that contains everything needed to run the PlugIn somewhere else.

pb_tool is just not helpful. It even depends on an external installation of zip or 7zip."""

import os
from pathlib import Path
import zipfile

os.chdir(Path(__file__).parent)
plugInName = Path('image_selection')
archivePath = f'{plugInName}.zip'
with zipfile.ZipFile(archivePath, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write('README.md', plugInName / 'README.md')
    os.chdir(plugInName)
    for name in ('README.md'
                 'LICENSE',
                 '__init__.py',
                 'aerial_item.py',
                 'georef.py',
                 'image_selection.cfg',
                 'main.py',
                 'main_window.py',
                 'main_window_base.ui',
                 'map_scene.py',
                 'map_view.py',
                 'metadata.txt',
                 'preview_window.py',
                 'preview_window_base.ui',
                 'resources_rc.py',
                 'web_view.py'):
        archive.write(name, plugInName / name)

    for path in Path('VisAnPrototype').rglob('*'):
        archive.write(path, plugInName / path)
        

        
