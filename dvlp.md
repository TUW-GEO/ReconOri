# Image Selection Tool as QGIS-Plugin

There is no real need for this tool to be integrated into QGIS, because having used it, users will most probably order images, wait for their delivery, and proceed with other tools then. Also, the geo-referencing of aerial image (previews) is generally still imprecise at this stage, and they must be viewed together with an orthophoto reference. This is better not done using QGIS layers and the QGIS main window. Still, the benefit of making it a PlugIn is that we do not need to setup a separate environment with Python interpreter, Qt, etc. However, the QGIS environment comes with its challenges (see below).

## Visual Analytics Component

Uses browser technologies: modern JavaScript (p5.js) embedded in HTML with CSS. Problems when viewing it in browsers:

- Get Around Same Origin Policy
  - Firefox: `privacy.file_unique_origin=False`

  - Chrome: seems impossible -> run (local) web server: `python -m http.server 8000 --bind 127.0.0.1` ->  http://localhost:8000/

- WebGL over RDP: p5.js needs a WebGL canvas for rendering 3d objects.
  - Firefox: can be rendered over RDP, having installed [something from nVIDIA](https://www.khronos.org/news/permalink/nvidia-provides-opengl-accelerated-remote-desktop-for-geforce-5e88fc2035e342.98417181).

  - Chrome: no problem. Still, Qt Webengine errors with: `js: Uncaught Error: Error creating webgl context`

## QGIS environment

QGIS 3.16 LTR comes with PyQt5:

```
>>> import PyQt5.Qt
>>> import PyQt5.QtCore
>>> import PyQt5.QtWebKit
>>> print(f'Qt version: {PyQt5.QtCore.QT_VERSION_STR}')
Qt version: 5.15.2
>>> print(f'PyQt version: {PyQt5.Qt.PYQT_VERSION_STR}')
PyQt version: 5.15.4
>>> print(f'WebKit version: {PyQt5.QtWebKit.qWebKitVersion()}')
WebKit version: 602.1
```

Install the QGIS PlugIn `Plugin reloader` for single-click re-loading our PlugIn having changed its source code.

## Visual Analytics Component within QGIS' PyQt5

There are basically 2 different web engines available in Qt5:

> Qt WebEngine supersedes the [Qt WebKit](http://doc.qt.io/archives/qt-5.3/qtwebkit-index.html) module, which is based on the [WebKit](https://doc.qt.io/qt-5/qtwebengine-3rdparty-webkit.html) project

> ~~The [Qt WebView](https://doc.qt.io/qt-5/qtwebview-index.html) module allows to use a native web browser on platforms where one is available.~~

... like Android

> The [Qt WebChannel](https://doc.qt.io/qt-5/qtwebchannel-index.html) module can be used to create a bi-directional communication channel between [QObject](https://doc.qt.io/qt-5/qobject.html) objects on the C++ side and JavaScript on the QML side.

https://doc.qt.io/qt-5/qtwebengine-overview.html#script-injection :

> Qt WebEngine does not allow direct access to the document object model  (DOM) of a page. However, the DOM can be inspected and adapted by  injecting scripts.

> Qt WebEngine provides C++ classes and QML types for rendering HTML ... scripted with JavaScript. HTML documents can be made fully editable by the user through the use of the `contenteditable` attribute on HTML elements.

### Qt WebEngine

Qt WebKit ist deprecated, replaced by Qt WebEngine. QGIS comes with Qt's QWebEngine DLL, but not PyQt5. To make Qt WebEngine available also in Python:

In OSGeo4W shell, install PyQtWebEngine for the present PyQt version:

```
python -m pip install PyQtWebEngine==5.15.4
```

installs into the User-dir %APPDATA%\Python\Python39\site-packages, since installation into the QGIS-Python-installation would require elevated privileges.

Re-start QGIS.

But [WebEngine does not work within QGIS](https://github.com/qgis/QGIS/issues/26048):

```
from PyQt5.QtWebEngineWidgets import QWebEngineView
ImportError: QtWebEngineWidgets must be imported before a QCoreApplication instance is created
```

The QGIS process would need to initialize the Qt WebEngine module before starting its `QCoreApplication`. Maybe QGIS will do that in the future, but not currently. The QGIS commandline option `--code` does not help, as the specified Python script is executed too late (same error as above). It seems impossible to make Qt call `QtWebEngine::initialize()` due to environment variables or command-line arguments. Without re-compiling QGIS, it might still be possible to make the QGIS-process call `QtWebEngine::initialize()` before instantiation of  `QCoreApplication` by doing so in the initialization function of a DLL that QGIS links. Loading `Qt5WebEngine.dll` would be enough, as that calls `QtWebEngine::initialize()`. If something like `patchelf` or `LD_PRELOAD` [where supported on Windows](https://en.wikipedia.org/wiki/DLL_injection#Approaches_on_Microsoft_Windows), we could make `qgis-ltr-bin.exe` load the DLL during startup.

QGIS is a Qt widget-based application, and so it is natural to use QtWebEngineWidgets like above.

However, it is possible to integrate QML into widget-based applications using [QQuickWidget](http://doc.qt.io/qt-5/qquickwidget.html). Hence, WebEngineView, the QtQuick-type for WebEngine can probably be used also in a Qt widget-based app. While I have not tested this, the [Qt docs say that also when using QtQuick, the WebEngine must be initialized before starting the QApplication](https://doc.qt.io/qt-5/qtwebengine-overview.html#embedding-web-content-into-qt-quick-applications), by calling [QtWebEngine::initialize](https://doc.qt.io/qt-5/qtwebengine.html#initialize). Calling `PyQt5.QtWebEngine.QtWebEngine.initialize()` in the QGIS console raises no error, but I guess it does not make sense to investigate this further.

Same problem with current QGIS 3.22.0

Outside of QGIS, using a stand-alone Python-Script (QtWebEngineTest/webengine.py), the VisAn-prototype can be viewed - but not by loading it as a local file: `js: Fetch API cannot load file:/// ... /data/Recherche_Metadaten_Testprojekt1.csv. URL scheme "file" is not supported.`.  This is just the same error as when loading `VisAnPrototype/index.html` in Chrome, see Chrome's browser console.

### QML Engine

With the QML engine, Qt offers its own, fully fledged JavaScript interpreter . But that interpreter does not provide access to a DOM. Instead, it just serves to process Qt objects.

### Qt WebKit

[Last documented in Qt-5.5](https://doc.qt.io/archives/qt-5.5/qtwebkitwidgets-index.html)

Since Qt WebKit has been deprecated, the Qt Designer does not offer the QWebView widget.

Problems:

- p5.js sets many callbacks/listeners by default. One of them is `ondevicemotion`. When it is called, the argument is a `DeviceMotionEvent`, but its attribute `acceleration` has an undefined value. Hence: `TypeError: null is not an object (evaluating 'e.acceleration.x')`. p5.js can be kept from defining this callback by setting `window.DeviceMotionEvent = undefined;` either at the top of p5.js, or in index.html, before loading p5.js
- in `this._setup`, p5.js uses `var canvases = document.getElementsByTagName('canvas');` and then `var _iterator2 = canvases[Symbol.iterator]()`. `canvases` is thus a `HTMLCollection`, an array-like object. [Symbol.iterator is available since Safari 10](https://caniuse.com/?search=Symbol.iterator) / [WebKit 602.1](https://en.wikipedia.org/wiki/Safari_version_history#Safari_10). Still, using p5.js within QGIS QWebView, it errors with: `TypeError: canvases[Symbol.iterator] is not a function. (In 'canvases[Symbol.iterator]()', 'canvases[Symbol.iterator]' is undefined)`. It seems that [HTMLCollection became iterable only after Symbol.iterator was introduced](https://stackoverflow.com/questions/31283360/are-htmlcollection-and-nodelist-iterables). The error can be avoided globally by specification of `HTMLCollection.prototype[Symbol.iterator] = Array.prototype[Symbol.iterator];` before loading p5.js

## PlugIn Creation

Created with the QGIS PlugIn "Plugin Builder 3": 

> Your plugin ImageSelection was created in:
>  E:\P\Projects\19_DoRIAH\ImageSelection\QGisPlugIn\image_selection 
>
> Your QGIS plugin directory is located at:
>  C:/Users/wk/AppData/Roaming/QGIS/QGIS3/profiles/default/python/plugins 
>
> ### What's Next
>
> 1. If resources.py is not present in your plugin directory, compile the resources file using pyrcc5 (simply use pb_tool or make if you have automake) 
> 2. Optionally, test the generated sources using make test (or run tests from your IDE) 
> 3. Copy the entire directory containing your new plugin to the QGIS plugin directory (see Notes below) 
> 4. Test the plugin by enabling it in the QGIS plugin manager 
> 5. Customize it by editing the implementation file image_selection.py 
> 6. Create your own custom icon, replacing the default icon.png 
> 7. Modify your user interface by opening image_selection_dialog_base.ui in Qt Designer 
>
> Notes: 
>
> - You can use pb_tool to compile, deploy, and manage your plugin. Tweak the *pb_tool.cfg* file included with your plugin as you add files. Install pb_tool using *pip* or *easy_install*. See http://loc8.cc/pb_tool for more information. 
> - You can also use the Makefile to compile and deploy when you make changes. This requires GNU make (gmake). The Makefile is ready to use, however you will have to edit it to add addional Python source files, dialogs, and translations. 
>
> For information on writing PyQGIS code, see http://loc8.cc/pyqgis_resources for a list of resources. 

- GNU Makefile deleted - let's use pb_tool instead.
- Linux shell scripts deleted.
- READMEs deleted.

To make the PlugIn accessible to the QGIS PlugIn manager, either

- create a symbolic directory link. [VS Code does not support this, as it opens the same file twice](https://github.com/microsoft/vscode/issues/100533).

  ```
  %APPDATA%\QGIS\QGIS3\profiles\default\python\plugins\image_selection 
  ->
  E:\P\Projects\19_DoRIAH\ImageSelection\QGisPlugIn\image_selection
  ```

- `set QGIS_PLUGINPATH=E:\P\Projects\19_DoRIAH\ImageSelection\QGisPlugIn`
   Note: QGIS_PLUGINPATH may contain multiple directories separated by ";"

## Compiling the PlugIn

Only necessary when `resources.qrc` has changed. If so, call in OSGeo4W shell:

```
... image_selection>pyrcc5 -o resources_rc.py resources.qrc
```

## IDE

For debugging, do NOT install the QGIS PlugIn `debugvs`, because that uses `ptvsd`, which has been superseded by `debugpy`. 

In OSGeo4W shell:

```
python -m pip install debugpy
```

### PyCharm

Remote debugging with PyCharm requires the professional edition.

### Visual Studio 2019

Debug -> Attach to Process:

1. Connection type: `Python remote (debugpy)`
2. Connection target: `tcp://localhost:5678/`

Unfortunately, Python support within Visual Studio is still buggy.

### VS Code

Recommended!

https://gist.github.com/AsgerPetersen/2000eb6f3e3307bd25190b19493dd9a3

Install the Python extension for VS Code, open "image_selection" as workspace, and select `C:\Program Files\QGIS 3.22.8\bin\python-qgis-ltr.bat` as Python interpreter.

#### Static Type Checking

use pylance as language server:

`"python.languageServer": "Pylance"`

and set

`"python.analysis.typeCheckingMode": "basic"`

(both configured in `.vscode/settings.json`). Also, in OSGeo4W-shell, so Qt-types are not all flagged:

`python -m pip install PyQt5-stubs`

#### Reformatting

Use autopep8. Simply wait for VS Code to prompt for its installation. VS Code will then install autopep8 into the Python interpreter selected for the workspace.


## Icons

Icons are from https://p.yusukekamiyamane.com/

Cursors are based on other online sources.

## States of Aerials

At all times, each aerial is in exactly one state of each of the 3 following categories. All categories are orthogonal to each other. Each category must be displayed by different means, to allow for displaying all combinations.

Just as much is stored in the DB as is necessary to re-open the image selection tool later on, and resume work where it had ended, assuming that the image and preview folders are unchanged. Hence, store everything needed except for what can be derived from the spread sheet and file system. Additionally, all spread sheet information is written to (but never read back here) in `aerials.meta`, to make it available for geo-referencing and decide only there, which of this information to use.

### Availability state

1. `missing`: no image, and no preview available. Still, if no better alternatives are found, then this image may be selected in the end for further processing (and hence, for purchase).
2. `findPreview`: no image available, but at least the folder of previews for its sortie exists, but preview-file und -rectangle are yet to be determined.
3. `preview`: only a preview is available, whose -file and -rectangle have been determined.
4. `image`: an image is available.

#### Display

- When minimized (shown as disc), use brush color as indication. 1: grey. 2: purple; 3: red; 4: yellow.
- When maximized (shown as image), use the same brush color to draw the image or preview border.

#### Interaction

When an image in states 2 or 3 is maximized, users may access the dialog to (re-) locate the preview. If that dialog is accepted, the state changes to 3. If not, the state remains unchanged.

#### DB storage

The state is not stored explicitly, because it can be derived from the file system and other DB columns:

- if `aerials.imgPath` is Null:
  - if the sortie's preview folder does not exist: state 1.
  - Otherwise: state 2.
- Otherwise:
  - if `aerials.previewRect` is Null: state 4.
  - Otherwise: state 3.

### Usage state

1. `unset`: neither explicitly selected, nor discarded.
2. `selected`: the image or preview has been selected for further processing i.e. geo-referencing and image analysis. If the image is unavailable, then this image will need to be purchased.
3. `discarded`: image or preview has been discarded from consideration (e.g. outside project area, cloudy, etc.). This helps the user to remember to not inspect it, again - unless run out of better options.

#### Display

- When minimized and state is not `unset`, then draw a green check mark or black X on top, according to state.
- When maximized, draw this check mark or X in an image corner.

#### Interaction

When an image in any state is maximized, users may freely set any different state.

#### DB storage

Stored in its own column.

### Transformation state

1. `original`: the transform is the one derived from the spread sheet.
2. `changed`: the transform has been altered manually, which indicates to the user that the image has been inspected more closely and that its footprint is probably quite accurate.

#### Display

- When minimized, use pen line style as indication (original: dashed; changed: solid).
- When maximized, use the same line style to draw the border.

#### Interaction

When an image with state 2 is maximized, users may re-set the transformation, resulting in state 1. Any manually applied transform results in state 2.

#### DB storage

None. The image selection tool compares the stored transformation with the one derived from the spread sheet. Geo-referencing shall derive the quality of transform from availability: the transform of available images is assumed to be best, the one of previews with a valid previewRect worse, and non-located previews and missing images worst.

## DB layout

The DB table `aerials` has 6 entries that are important for the image selection tool itself. Together, they must be able to store user decisions (that of course cannot be derived from the spread sheet and file system).  Additionally, it stores the whole `meta` data, to be used by fine geo-referencing:

- `imgId`: primary key. The relative file path to the image, which may not exist: `<sortie-folder>/<#img>.ecw`. Alternatively, `aerials` may store `sortie` and `<#img>` in separate columns and use their combination as primary key.
- `selected`: selection state.
- `scenePos`: the position of the whole image or preview rectangle within the scene.
- `trafo`: the transform of the whole image or preview rectangle within the scene.
- `imgPath`: the actual relative path to the image or preview file. Must exist unless NULL. If the image file according to `imgId` exists, then this is set immediately. Otherwise, this is set once the preview file and rectangle have been determined.
- `previewRect`: if not NULL: the rectangle within `imgPath` that covers the image content of this preview. Set when the preview file and rectangle have been determined. If not NULL, then imgPath must not be NULL, either.
