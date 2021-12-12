# Image Selection Tool as QGIS-Plugin

There is no real need for this tool to be integrated into QGIS, because having used it, users will most probably order images, wait for their delivery, and use other tools then. Also, the geo-referencing of aerial image (previews) is generally still imprecise at this stage, and they must be viewed together with an orthophoto reference. This is better not done using QGIS layers and the QGIS main window. Still, the benefit of making it a PlugIn is that we do not need to setup a separate environment with Python interpreter, Qt, etc. However, the QGIS environment comes with its challenges (see below).

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

## Compiling the PlugIn

Only necessary when introducing an .ui-file other than the main one, or if a resource file has changed. If so, call in OSGeo4W shell:

```
... image_selection>python -m pip install pb_tool
... image_selection>%APPDATA%\Python\Python39\Scripts\pb_tool.exe compile
```

Or call `pyrcc5 -o resources.py resources.qrc` directly.

## Debugging the PlugIn

Do NOT install the QGIS PlugIn `debugvs`, because that uses `ptvsd`, which has been superseded by `debugpy`. 

In OSGeo4W shell:

```
pip3 install debugpy
```

### PyCharm

Remote debugging with PyCharm requires the professional edition.

### Using Visual Studio 2019

Debug -> Attach to Process:

1. Connection type: `Python remote (debugpy)`
2. Connection target: `tcp://localhost:5678/`

Unfortunately, Python support within Visual Studio is still buggy.

### Using VS Code

https://gist.github.com/AsgerPetersen/2000eb6f3e3307bd25190b19493dd9a3

## Icons

Icons are from https://p.yusukekamiyamane.com/

Cursors are based on other online sources.

