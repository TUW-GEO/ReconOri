"""
/***************************************************************************
 ImageSelectionDialog
                                 A QGIS plugin
 Guided selection of images with implicit coarse geo-referencing.
                             -------------------
        begin                : 2021-11-12
        git sha              : $Format:%H$
        copyright            : (C) 2021 by Photogrammetry @ GEO, TU Wien, Austria
        email                : wilfried.karel@geo.tuwien.ac.at
 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/
"""
from qgis.PyQt.QtCore import QElapsedTimer, Qt, pyqtSignal, pyqtSlot
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QActionGroup, QDialogButtonBox, QMainWindow, QMenu, QToolButton, QWhatsThis 
from qgis.PyQt.uic import loadUiType

import logging
from pathlib import Path
import traceback

from osgeo import gdal

from . import HttpTimeout, getLoggerAndFileHandler, gdalPushLogHandler, gdalPopLogHandler
from .map_scene import ContrastStretching, MapScene, Status, Visualization

gdal.UseExceptions()

# This loads your .ui file so that PyQt can populate your plugin with the elements from Qt Designer
Form, _ = loadUiType(Path(__file__).parent / 'dialog_base.ui')

logger = logging.getLogger(__name__)


class ImageSelectionDialog(QMainWindow):

    showLogMessage = pyqtSignal(str)


    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        ui = self.ui = Form()
        ui.setupUi(self)
        ui.splitter.setSizes([100, 500])
        self.setWindowIcon(QIcon(':/plugins/image_selection/bomb.png'))
        ui.buttonBox.button(QDialogButtonBox.Help).setToolTip('Click here and then somewhere else to get help.')
        #ui.buttonBox.button(QDialogButtonBox.Help).setIcon(QApplication.style().standardIcon(QStyle.SP_DialogHelpButton))
        #ui.buttonBox.button(QDialogButtonBox.Help).setText('')
        ui.buttonBox.helpRequested.connect(QWhatsThis.enterWhatsThisMode)

        gdalPushLogHandler()

        # QGIS seems to set the CWD to %USERPROFILE%/Documents, and the default WMTS cache path is ./gdalwmscache
        for prefix, url in [('', 'https://maps.wien.gv.at/basemap/1.0.0/WMTSCapabilities.xml'),
                            ('Stadt Wien ', 'https://maps.wien.gv.at/wmts/1.0.0/WMTSCapabilities.xml')]:
            base = gdal.Open(url)
            for path, desc in base.GetSubDatasets():
                desc = desc.removeprefix('Layer ')
                if desc == 'Geoland Basemap Orthofoto':
                    defIdx = ui.mapSelect.count()
                # If we simply passed path, then HTTP error codes 202 and 404 would return a blank image instead of raising.
                # However, instead of returning a blank image, MapReadThread shall try reading at a higher overview level.
                # To get the XML we want, we could open the dataset using path, query its XML using dataset.GetMetadataItem('XML', 'WMTS'),
                # and edit that. Instead, let's just roll our own.
                layers = [el.removeprefix('layer=') for el in path.split(',') if el.startswith('layer=')]
                assert len(layers) == 1
                xml = (
                    '<GDAL_WMTS>'
                        f'<GetCapabilitiesUrl>{url}</GetCapabilitiesUrl>'
                        f'<Layer>{layers[0]}</Layer>'
                        #'<OfflineMode>true</OfflineMode>'
                        '<Cache />'
                        f'<Timeout>{HttpTimeout.seconds}</Timeout>'
                    '</GDAL_WMTS>')
                ui.mapSelect.addItem(prefix + desc, xml)
            ui.mapSelect.insertSeparator(ui.mapSelect.count())


        for url in ['WMS:http://ows.terrestris.de/osm/service']:
            base = gdal.Open(url)
            for path, desc in base.GetSubDatasets():
                ui.mapSelect.addItem(desc, path)

        gdalPopLogHandler()

        # bbox Austria EPSG:3857
        maxX, maxY = 1913530, 6281290
        minX, minY =  977650, 5838030
        epsg = 3857
        scene = MapScene(minX, -maxY, maxX - minX, maxY - minY, self, epsg=epsg)
        ui.mapView.epsg = epsg
        ui.mapView.setScene(scene)
        ui.mapView.fitInView(scene.sceneRect(), Qt.KeepAspectRatio)

        ui.mapView.isReading.connect(lambda b: ui.progressBar.setMaximum(0 if b else 1))
        ui.mapView.datasetResolution.connect(lambda f: ui.mapResolution.setText(f'Map resolution: {f:.2f}m'))
        ui.mapView.reportResponseTime.connect(lambda x: ui.responseTime.setText(f'Response time: {x // 60:02.0f}:{x % 60:05.2f}'))
        
        self.__responseElapsedTimer = QElapsedTimer()
        self.__responseElapsedTimer.start()
        self.startTimer(250)
        ui.mapView.newImage.connect(lambda: self.__responseElapsedTimer.restart())

        ui.mapSelect.currentIndexChanged.connect(lambda idx: ui.mapView.load(ui.mapSelect.itemData(idx)))
        ui.mapSelect.setCurrentIndex(defIdx)

        self.__statusBarLogHandler = StatusBarLogHandler(logging.INFO, self.showLogMessage)
        packageLogger, _ = getLoggerAndFileHandler()
        packageLogger.addHandler(self.__statusBarLogHandler)
        self.showLogMessage.connect(lambda msg: self.statusBar().showMessage(msg, 5000))

        mapView = ui.mapView
        for button, icon, func in ((ui.mapZoomIn , 'zoom-in' , lambda: mapView.zoom(+1, False)),
                                   (ui.mapZoomOut, 'zoom-out', lambda: mapView.zoom(-1, False)),
                                   (ui.mapZoomNative, 'zoom-native', lambda: mapView.zoom(None, False)),
                                   (ui.mapZoomFit, 'zoom-fit', lambda: mapView.fitInView(scene.itemsBoundingRect(), Qt.KeepAspectRatio))):
            button.setIcon(QIcon(f':/plugins/image_selection/{icon}'))
            button.setText('')
            button.pressed.connect(func)

        ui.loadAoi.setIcon(QIcon(':/plugins/image_selection/layer-shape-polygon'))
        ui.loadAoi.clicked.connect(scene.selectAoiFile)

        ui.loadAerials.setIcon(QIcon(':/plugins/image_selection/films'))
        ui.loadAerials.clicked.connect(scene.selectAerialsFile)

        ui.aerialsContrastStretch.setIcon(QIcon(':/plugins/image_selection/contrast-stretch'))
        menu = QMenu(self)
        group = QActionGroup(menu)
        arrowResize090 = QIcon(':/plugins/image_selection/arrow-resize-090')
        minMax = group.addAction(menu.addAction(arrowResize090, 'MinMax', lambda: scene.setContrastStretch(ContrastStretching.minMax)))
        minMax.setCheckable(True)
        chart = QIcon(':/plugins/image_selection/chart')
        histogram = group.addAction(menu.addAction(chart, 'Histogram', lambda: scene.setContrastStretch(ContrastStretching.histogram)))
        histogram.setCheckable(True)
        histogram.setChecked(True)
        ui.aerialsContrastStretch.setMenu(menu)
        ui.aerialsContrastStretch.toggled.connect(self.onContrastStretchToggled)

        scene.aerialsLoaded.connect(lambda: ui.aerialsContrastStretch.setEnabled(True))

        target = QIcon(':/plugins/image_selection/target')
        picture = QIcon(':/plugins/image_selection/picture')
        for button, icon, status in ((ui.aerialsRed, 'red', Status.missing),
                                     (ui.aerialsYellow, 'yellow', Status.available),
                                     (ui.aerialsGreen, 'green', Status.selected)):
            button.setIcon(QIcon(f':/plugins/image_selection/traffic-light-{icon}'))
            button.toggled.connect(lambda checked, button=button, status=status: self.onStatusToggled(button, status, checked))
            menu = QMenu(self)
            group = QActionGroup(menu)
            asPoints = group.addAction(menu.addAction(target, 'as points', lambda status=status: scene.setVisualizationByStatus(status, Visualization.asPoint)))
            asPoints.setCheckable(True)
            asPoints.setChecked(True)
            asImage = group.addAction(menu.addAction(picture, 'as images', lambda status=status: scene.setVisualizationByStatus(status, Visualization.asImage)))
            asImage.setCheckable(True)
            button.setMenu(menu)

            scene.aerialsLoaded.connect(lambda button=button: button.setEnabled(True))

        ui.aerialsFreeze.setIcon(QIcon(':/plugins/image_selection/freeze'))
        ui.aerialsFreeze.toggled.connect(lambda checked: mapView.setInteractive(not checked))

        #ui.scene.loadAerialsFile(Path(r'P:\Projects\19_DoRIAH\07_Work_Data\OwnCloud\Projekte LBDB\Meeting_2021-06-10_Testprojekte\Testprojekt1\Recherche_Metadaten_Testprojekt1.xls'))
        


    def unload(self) -> None:
        try:
            self.ui.webView.unload()
            self.ui.mapView.unload()
            self.ui.mapView.scene().unload()
        except Exception as ex:
            logger.exception('Unloading failed.', exc_info=ex)
        try:
            packageLogger, _ = getLoggerAndFileHandler()
            packageLogger.removeHandler(self.__statusBarLogHandler)
        except:
            traceback.print_exc()


    def timerEvent(self, event) -> None:
        secs = self.__responseElapsedTimer.elapsed() / 1000
        self.ui.responseElapsed.setText(f'{secs // 60:02.0f}:{secs % 60:02.0f} ago')


    @pyqtSlot(bool)
    def onContrastStretchToggled(self, checked: bool) -> None:
        if not checked:
            self.ui.mapView.scene().setContrastStretch(ContrastStretching.none)
        else:
            self.ui.aerialsContrastStretch.menu().actions()[0].actionGroup().checkedAction().trigger()
        

    @pyqtSlot(QToolButton, Status, bool)
    def onStatusToggled(self, button, status: Status, checked: bool) -> None:
        if not checked:
            self.ui.mapView.scene().setVisualizationByStatus(status, Visualization.none)
        else:
            button.menu().actions()[0].actionGroup().checkedAction().trigger()



class StatusBarLogHandler(logging.Handler):
    def __init__(self, level: int, signal) -> None:
        super().__init__(level)
        self.__signal = signal
        formatter = logging.Formatter('{asctime}.{msecs:.0f} {levelname}: {name} - {message}', style='{', datefmt='%H:%M:%S')
        self.setFormatter(formatter)

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        # Must be async, so the timout of QStatusBar.showMessage works.
        self.__signal.emit(msg)
