# DoRIAH QGIS PlugIn for Image Selection

Load a spread sheet with meta data of eligible aerial images, and show them minimized at the given locations on top of a web map. Double-click onto one of them to load and show its image content, and to judge its quality. Shift, rotate, and scale it with respect to the background map in order to decide if it shall be considered for further processing. If so, mark it as *selected*. All footprints, adapted or not, are stored in an SQLite data base next to the spread sheet, together with their selection states.

Tested with QGIS 3.16 LTR. Should work with all versions 3.16+.

## Compilation

Open the *OSGeo4W* shell that comes with QGIS, and compile the resources by calling *pyQt5*'s resource compiler:

```
... image_selection>pyrcc5 -o resources.py resources.qrc
```

## Installation on Windows

There are two ways to make the PlugIn accessible to the *QGIS PlugIn manager*:

1. The PlugIn-folder *image_selection* must be a sub-directory of the directory where the PlugIn manager searches for PlugIns. That directory's path is: 

   ```
   %USERPROFILE%\AppData\Roaming\QGIS\QGIS3\profiles\default\
   ```

   In case you use a non-default QGIS profile, replace `default` with that profile's name. You may make the PlugIn folder a sub-directory either as a copy, or as a symbolic link.

2. Before starting QGIS, set the environment variable `QGIS_PLUGINPATH` to the path of the parent directory of the PlugIn folder, wherever that is.

Activate the PlugIn in the QGIS PlugIn manager: menu `PlugIns` → entry `Manage and install plugins` → tab `Installed` → Check `DoRIAH Image Selection`.

You should now see the PlugIn icon in the QGIS main window. If not: menu `View` → entry `Tool boxes` → check `PlugIn tool box`.

## Configuration

Edit `image_selection/image_selection.cfg`, such that images and previews are found.