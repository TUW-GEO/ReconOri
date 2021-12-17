# DoRIAH QGIS PlugIn for Image Selection

Load a spread sheet with meta data of eligible aerial images, and show them minimized at the given locations on top of a web map. Double-click onto one of them to load and show its image content, and to judge its quality. If the respective image file is missing, then no image content is displayed. In that case, however, a preview image may be available. Use the context menu to find it.

Shift, rotate, and scale aerials with respect to the background map in order to decide if they shall be considered for further processing. If so, mark them as *selected*, using the context menu.

For help on how to navigate the map or transform aerials, click the help button first, and then either on the map or on an aerial.

All footprints, adapted or not, are stored in an SQLite data base next to the spread sheet, together with their selection states. You can resume work at any later point by loading the same spread sheet, again.

Each aerial belongs to one of each of these categories:

- `Availability`:
  - `missing`: no image, and not preview available.
  - `preview not yet determined`: no image available, but the preview folder for its sortie exists. However, the preview has not yet been found.
  - `preview`:  a preview is available i.e. it has been found before.
  - `image`: an image file is available.
- `Usage`:
  - `discarded`: the aerial has been discarded from consideration.
  - `unset`: no explicit usage has been set.
  - `selected`: the aerial shall be used in geo-referencing and image analysis. If no image is available, it needs to be ordered.
- `Transformation state`:
  - `original`: the aerial's transformation is the one derived from the spread sheet.
  - `changed`: the aerial's transformation has been adapted manually.

All states are indicated graphically. Use the buttons above the map view to control if aerials with the respective state shall be shown or not.

Tested with QGIS 3.16 LTR. Should work with newer releases, too.

## Compilation

Skip this step if you have received a package archive.

Open the *OSGeo4W* shell that comes with QGIS, and compile the resources by calling *pyQt5*'s resource compiler:

```
... image_selection>pyrcc5 -o resources.py resources.qrc
```

To create a package archive:

```
... image_selection>python create_archive.py
```

## Installation on Windows

There are two ways to make the PlugIn accessible to the *QGIS PlugIn manager*:

1. The PlugIn-folder *image_selection* must be a sub-directory of the directory where the PlugIn manager searches for PlugIns. That directory's path is: 

   ```
   %USERPROFILE%\AppData\Roaming\QGIS\QGIS3\profiles\default\python\plugins
   ```

   In case you use a non-default QGIS profile, replace `default` with that profile's name. You may make the PlugIn folder a sub-directory either as a copy, or as a symbolic link.

2. Before starting QGIS, set the environment variable `QGIS_PLUGINPATH` to the path of the parent directory of the PlugIn folder, wherever that is.

Activate the PlugIn in the QGIS PlugIn manager: menu `PlugIns` → entry `Manage and install plugins` → tab `Installed` → Check `DoRIAH Image Selection`.

You should now see the PlugIn icon in the QGIS main window. If not: menu `View` → entry `Tool boxes` → check `PlugIn tool box`.

## Configuration

Edit `image_selection/image_selection.cfg`, such that images and previews are found.