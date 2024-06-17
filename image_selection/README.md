# DoRIAH QGIS PlugIn for Image Selection

Load a spread sheet with meta data of eligible aerial images, and show them minimized at the given locations on top of a web map. Double-click onto one of them to load and show its image content, and to judge its quality. If the respective image file is missing, then no image content is displayed. In that case, however, a preview image may be available. Use the context menu to find it.

Shift, rotate, and scale aerials with respect to the background map, or use the function for doing so automatically, in order to decide if they shall be considered for further processing. If so, mark them as *selected*, using the context menu.

For help on how to navigate the map or transform aerials, click the help button first, and then either on the map or on an aerial.

All footprints, adapted or not, are stored in an SQLite data base next to the spread sheet, together with their selection states. You can resume work at any later point by loading the same spread sheet, again.

At any point, an aerial belongs to each of these categories:

- `Availability`:
  - `missing`: no image, and no preview available.
  - `preview not yet determined`: no image available, but the preview folder for its sortie exists. However, the preview has not yet been found.
  - `preview`:  a preview is available i.e. it has been found before.
  - `image`: an image file (full resolution) is available.
- `Usage`:
  - `discarded`: the aerial has been discarded from consideration.
  - `unset`: no explicit usage has been set.
  - `selected`: the aerial shall be used in geo-referencing and image analysis. If only a preview is available, the image hence needs to be ordered.
- `Transformation modification`:
  - `original`: the aerial's transformation is the one derived from the spread sheet.
  - `changed`: the aerial's transformation has been adapted manually.
- `Transformation interaction`:
  - `Unlocked`: change the image orientation to your liking. Image is shown above locked ones.
  - `Locked`: the image transformation is fixed. Image is displayed below unlocked ones.

All states are indicated graphically. Use the buttons above the map view to control if aerials with the respective state shall be shown or not.

Tested with QGIS 3.34 LTR on Windows, installed with the *standalone installer (MSI)*.

Should work with newer releases.

## Installation on Windows

### Optional Dependencies

#### Automated Geo-Referencing

Only works with a CUDA-capable graphics card installed.

Open the OSGeo4W shell from your start menu, and enter:

```batch
python -m pip install torch==2.2.2 torchvision==0.17.2 torchaudio==2.2.2 --index-url https://download.pytorch.org/whl/cu121
python -m pip install einops yacs kornia e2cnn pytorch-lightning opencv-python-headless
```

Extract https://github.com/WKarel/se2-loftr/archive/camera-ready.zip into `%APPDATA%\Python\Python312\site-packages\`, and rename the folder `se2-loftr-camera-ready` to `se2_loftr`.

#### Excel 2010 files

For reading Excel 2010 xlsx/xlsm/xltx/xltm files, `openpyxl` needs to be installed. In the OSGeo4W shell, enter:

```batch
python -m pip install openpyxl
```

#### Contrast Limited, Adaptive Histogram Equalization

To make Contrast Limited, Adaptive Histogram Equalization available as image enhancement, enter in the OSGeo4W shell:

```batch
python -m pip install scikit-image
```

### PlugIn Itself

To make the PlugIn accessible in QGIS, use menu `PlugIns` → entry `Manage and install plugins` → tab `Install from ZIP`,  choose the path to the PlugIn's package archive (`.zip`), and hit `Install Plugin`.

Afterwards, activate the PlugIn in the QGIS PlugIn manager: menu `PlugIns` → entry `Manage and install plugins` → tab `Installed` → Check `DoRIAH Image Selection`.

You should now see the PlugIn icon in the QGIS main window. If not: menu `View` → entry `Tool boxes` → check `PlugIn tool box`.

## Configuration

Edit `image_selection/image_selection.cfg`, such that images and previews are found.