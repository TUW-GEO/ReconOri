# DoRIAH QGIS PlugIn for Image Selection

Load a spread sheet with meta data of eligible aerial images, and show them minimized at the given locations on top of a web map. Double-click onto one of them to load and show its image content, and to judge its quality. If the respective image file is missing, then no image content is displayed. In that case, however, a preview image may be available. Use the context menu to find it.

Shift, rotate, and scale aerials with respect to the background map in order to decide if they shall be considered for further processing. If so, mark them as *selected*, using the context menu.

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

Tested with QGIS 3.22 LTR, installed with the *standalone installer (MSI)*.

May still work with QGIS 3.16.14 *standalone installer (MSI)*. Does not work with the QGIS 3.16.14 *network installer*, since that comes with Python 3.7 instead of 3.9.  Does not work with even older releases, but should work with newer ones.

## Compilation

Skip this step if you have received a package archive (`.zip`).

Open the *OSGeo4W* shell that comes with QGIS, and compile the resources by calling *pyQt5*'s resource compiler:

```
... image_selection>pyrcc5 -o resources_rc.py resources.qrc
```

To create a package archive:

```
... image_selection>python create_archive.py
```

## Installation on Windows

There are different ways to make the PlugIn accessible in QGIS:

1. if installing from a package archive (`.zip`), the easiest way is via menu `PlugIns` → entry `Manage and install plugins` → tab `Install from ZIP`: choose the path to the archive and hit `Install Plugin`.

2. Or: place/extract the PlugIn-folder somewhere on your file system. 

   1. Put/extract the PlugIn-folder into the place where the QGIS PlugIn manager expects it: make the PlugIn-folder *image_selection* a sub-directory of:

      ```
      %USERPROFILE%\AppData\Roaming\QGIS\QGIS3\profiles\default\python\plugins
      ```

      In case you use a non-default QGIS profile, replace `default` with that profile's name. You may make the PlugIn folder a sub-directory either as a copy, or as a symbolic link.

   2. Otherwise, you may place/extract your PlugIn-folder anywhere and tell QGIS where to find it. To do so, before starting QGIS, set the environment variable `QGIS_PLUGINPATH` to the parent directory of the PlugIn folder, wherever that is.


Afterwards, activate the PlugIn in the QGIS PlugIn manager: menu `PlugIns` → entry `Manage and install plugins` → tab `Installed` → Check `DoRIAH Image Selection`.

You should now see the PlugIn icon in the QGIS main window. If not: menu `View` → entry `Tool boxes` → check `PlugIn tool box`.

### Optional Dependencies

For reading / writing Excel 2010 xlsx/xlsm/xltx/xltm files, install openpyxl. To do so, open the OSGeo4W Shell from your start menu and enter:
```
python -m pip install openpyxl
```

To make Contrast Limited, Adaptive Histogram Equalization available as image enhancement, enter in the OSGeo4W Shell:
```
python -m pip install scikit-image
```

## Configuration

Edit `image_selection/image_selection.cfg`, such that images and previews are found.