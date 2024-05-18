#  ***************************************************************************
#  *                                                                         *
#  *   This program is free software; you can redistribute it and/or modify  *
#  *   it under the terms of the GNU General Public License as published by  *
#  *   the Free Software Foundation; either version 2 of the License, or     *
#  *   (at your option) any later version.                                   *
#  *                                                                         *
#  ***************************************************************************

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

"""
from qgis.PyQt.QtCore import pyqtSignal, pyqtSlot, QElapsedTimer, QMargins, QRectF, Qt, QUrl
from qgis.PyQt.QtGui import QDesktopServices, QIcon, QStandardItem
from qgis.PyQt.QtWidgets import QActionGroup, QDialog, QDialogButtonBox, QComboBox, QMenu, QMessageBox, QTableView, QTextEdit, QToolButton, QVBoxLayout, QWhatsThis
from qgis.PyQt.uic import loadUiType

import configparser
import logging
from pathlib import Path
import traceback

from osgeo import gdal
gdal.UseExceptions()

from . import Config, getLoggerAndFileHandler, GdalPushLogHandler
from .map_scene import MapScene, Availability, Usage
from .aerial_item import Visualization
from .preview_window import claheAvailable, ContrastEnhancement


class AerialCombo(QComboBox):
    """The drop-down table of loaded aerials."""
    __scene = None

    def setScene(self, scene):
        self.__scene = scene

    def hidePopup(self):
        if self.__scene:
            self.__scene.highlightAerials.emit(set())
        super().hidePopup()
        self.setCurrentIndex(-1)


Form, FormBase = loadUiType(Path(__file__).parent / 'main_window_base.ui',
                            from_imports=True, import_from=__name__.rpartition('.')[0])

logger = logging.getLogger(__name__)


class MainWindow(FormBase):

    showLogMessage = pyqtSignal(str)

    __nVisibleAerials: int = 0
    __nTotalAerials: int = 0

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        ui = self.ui = Form()
        ui.setupUi(self)
        self.__config = configparser.ConfigParser()
        with open(Path(__file__).parent / 'image_selection.cfg') as fin:
            self.__config.read_file(fin)

        ui.splitter.setSizes([100, 500])
        ui.buttonBox.button(QDialogButtonBox.Help).setToolTip('View the documentation.')
        ui.buttonBox.helpRequested.connect(self.__readme)
        ui.whatsThis.clicked.connect(QWhatsThis.enterWhatsThisMode)

        self.__initMap()
        self.__initAerials()
        self.ui.GEO.clicked.connect(lambda: QDesktopServices.openUrl(QUrl('https://photo.geo.tuwien.ac.at/')))
        self.__statusBarLogHandler = StatusBarLogHandler(logging.INFO, self.showLogMessage)
        packageLogger, _ = getLoggerAndFileHandler()
        packageLogger.addHandler(self.__statusBarLogHandler)
        self.showLogMessage.connect(lambda msg: self.statusBar().showMessage(msg, 5000))

        scene = self.ui.mapView.scene()
        webView = self.ui.webView
        scene.aerialsLoaded.connect(webView.aerialsLoaded)
        scene.attackDataLoaded.connect(webView.attackDataLoaded)
        scene.areaOfInterestLoaded.connect(webView.areaOfInterestLoaded)
        scene.aerialFootPrintChanged.connect(webView.aerialFootPrintChanged)
        scene.aerialAvailabilityChanged.connect(webView.aerialAvailabilityChanged)
        scene.aerialUsageChanged.connect(webView.aerialUsageChanged)
        self.__filteredImageIds: set[str] = set()
        webView.filterAerials.connect(self.__filterAerials)
        webView.highlightAerials.connect(scene.highlightAerials)
        webView.showAsImage.connect(scene.showAsImage)
        # Having re-loaded the web page (with possibly changed JavaScript), re-transmit to the page the data we have.
        # Otherwise, the whole PlugIn would need to be re-loaded, meaning a shut-down and re-start of the HTTP-server, which takes time.
        webView.loadFinished.connect(lambda ok: scene.emitAerialsLoaded() if ok else None)
        webView.loadFinished.connect(lambda ok: scene.emitAttackDataLoaded() if ok else None)
        webView.loadFinished.connect(lambda ok: scene.emitAreaOfInterestLoaded() if ok else None)

        #ui.scene.loadAerialsFile(Path(r'P:\Projects\19_DoRIAH\07_Work_Data\OwnCloud\Projekte LBDB\Meeting_2021-06-10_Testprojekte\Testprojekt1\Recherche_Metadaten_Testprojekt1.xls'))

    def __initMap(self):
        ui = self.ui
        with GdalPushLogHandler():
            austria = QIcon(':/plugins/image_selection/austria')
            vienna = QIcon(':/plugins/image_selection/vienna')
            globe = QIcon(':/plugins/image_selection/globe-green')
            defIdx = 0
            # QGIS seems to set the CWD to %USERPROFILE%/Documents, and the default WMTS cache path is ./gdalwmscache
            for isWMTS, icon, prefix, url in [
                (True, austria, '', 'https://mapsneu.wien.gv.at/basemapneu/1.0.0/WMTSCapabilities.xml'),
                (False, austria, 'BEV ', 'https://data.bev.gv.at/geoserver/BEVdataKAT/wms?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities&CRS=EPSG:3857'),
                (True, vienna, 'Stadt Wien ', 'https://maps.wien.gv.at/wmts/1.0.0/WMTSCapabilities.xml'),
                (False, globe, '', 'WMS:http://ows.terrestris.de/osm/service')]:
                try:
                    base = gdal.Open(url)
                except RuntimeError as ex:
                    logger.exception(f'Failed to open {url}', exc_info=ex)
                    QMessageBox.warning(
                        self, 'Server connection failed',
                        f'Failed to open {url}\n. Respective maps will be missing. This may be a temporary problem.\n' + str(ex))
                    continue
                for path, desc in base.GetSubDatasets():
                    desc = desc.removeprefix('Layer ')
                    if desc == 'Geoland Basemap Orthofoto':
                        defIdx = ui.mapSelect.count()
                    if isWMTS:
                        # If we simply passed path, then HTTP error codes 202 and 404 would return a blank image instead of raising.
                        # However, instead of returning a blank image, MapReadThread shall try reading at a higher overview level.
                        # To get the XML we want, we could open the dataset using path, query its XML using dataset.GetMetadataItem('XML', 'WMTS'),
                        # and edit that. Instead, let's just roll our own.
                        layers = [el.removeprefix('layer=') for el in path.split(',') if el.startswith('layer=')]
                        assert len(layers) == 1
                        path = (
                            '<GDAL_WMTS>'
                            f'<GetCapabilitiesUrl>{url}</GetCapabilitiesUrl>'
                            f'<Layer>{layers[0]}</Layer>'
                            # '<OfflineMode>true</OfflineMode>'
                            f'<Cache><Path>{Config.gdalCachePath.value}/gdalwmscache</Path></Cache>'
                            f'<Timeout>{Config.httpTimeoutSeconds.value}</Timeout>'
                            '</GDAL_WMTS>')
                    ui.mapSelect.addItem(icon, prefix + desc, path)
                ui.mapSelect.insertSeparator(ui.mapSelect.count())

        # bbox Austria EPSG:3857
        maxX, maxY = 1913530, 6281290
        minX, minY = 977650, 5838030
        epsg = 3857
        scene = MapScene(minX, -maxY, maxX - minX, maxY - minY, self, epsg=epsg, config=self.__config)
        mapView = ui.mapView
        mapView.epsg = epsg
        mapView.setScene(scene)
        mapView.fitInView(scene.sceneRect(), Qt.KeepAspectRatio)

        mapView.isReading.connect(lambda b: ui.progressBar.setMaximum(0 if b else 1))
        mapView.datasetResolution.connect(lambda f: ui.mapResolution.setText(f'Map resolution: {f:.3f}m'))
        mapView.reportResponseTime.connect(lambda x: ui.responseTime.setText(
            f'Response time: {x // 60:02.0f}:{x % 60:05.2f}'))

        self.__responseElapsedTimer = QElapsedTimer()
        self.__responseElapsedTimer.start()
        self.startTimer(250)
        mapView.newImage.connect(self.__responseElapsedTimer.restart)

        ui.mapSelect.setCurrentIndex(-1)
        ui.mapSelect.currentIndexChanged.connect(lambda idx: ui.mapView.load(ui.mapSelect.itemData(idx)))
        ui.mapSelect.setCurrentIndex(defIdx)

        def fitVisible():
            rect = QRectF()
            for item in scene.items():
                if item.isVisible():
                    rect |= item.sceneBoundingRect()
            if rect:
                rect = mapView.mapFromScene(rect).boundingRect().marginsAdded(QMargins() + 20)
                rect = mapView.mapToScene(rect).boundingRect()
            mapView.fitInView(rect, Qt.KeepAspectRatio)

        for button, func in (
                (ui.mapZoomIn, lambda: mapView.zoom(+1, False)),
                (ui.mapZoomOut, lambda: mapView.zoom(-1, False)),
                (ui.mapZoomNative, lambda: mapView.zoom(None, False)),
                #(ui.mapZoomFit, lambda: mapView.fitInView(scene.itemsBoundingRect(), Qt.KeepAspectRatio))
                (ui.mapZoomFit, fitVisible)):
            button.pressed.connect(func)

    def __initAerials(self):
        ui = self.ui
        scene = ui.mapView.scene()
        ui.loadAoi.clicked.connect(scene.selectAoiFile)
        ui.loadAttackData.clicked.connect(scene.selectAttackDataFile)
        ui.loadAerials.clicked.connect(scene.selectAerialsFile)

        menu = QMenu(self)
        group = QActionGroup(menu)
        arrowResize090 = QIcon(':/plugins/image_selection/arrow-resize-090')
        minMax = group.addAction(menu.addAction(arrowResize090, 'Stretch to minimum / maximum',
                                 self.__onContrastEnhancement))
        minMax.setData(ContrastEnhancement.minMax)
        minMax.setCheckable(True)
        chart = QIcon(':/plugins/image_selection/chart')
        histogram = group.addAction(menu.addAction(chart, 'Histogram equalization',
                                    self.__onContrastEnhancement))
        histogram.setData(ContrastEnhancement.histogram)
        histogram.setCheckable(True)
        if claheAvailable:
            chartPlus = QIcon(':/plugins/image_selection/chart--plus')
            clahe = group.addAction(menu.addAction(chartPlus, 'Contrast limited, adaptive histogram equalization',
                                    self.__onContrastEnhancement))
            clahe.setData(ContrastEnhancement.clahe)
            clahe.setCheckable(True)
            clahe.setChecked(True)
        else:
            histogram.setChecked(True)
        ui.aerialsContrastEnhancement.setMenu(menu)
        ui.aerialsContrastEnhancement.toggled.connect(self.__onContrastEnhancement)
        scene.aerialsLoaded.connect(lambda: ui.aerialsContrastEnhancement.setEnabled(True))
        scene.aerialsLoaded.connect(self.__onContrastEnhancement)

        self.__availabilities = ((ui.aerialsGray, Availability.missing),
                                 (ui.aerialsBlue, Availability.findPreview),
                                 (ui.aerialsGreen, Availability.preview),
                                 (ui.aerialsYellow, Availability.image))
        target = QIcon(':/plugins/image_selection/target')
        picture = QIcon(':/plugins/image_selection/picture')
        for button, avail in self.__availabilities:
            def func(button=button, avail=avail):
                return self.__onAvailabilityChanged(button, avail)

            button.toggled.connect(lambda *_, _func=func: _func())
            menu = QMenu(self)
            group = QActionGroup(menu)
            asPoints = group.addAction(menu.addAction(target, 'as points', func))
            asPoints.setData(Visualization.asPoint)
            asPoints.setCheckable(True)
            asPoints.setChecked(True)
            asImage = group.addAction(menu.addAction(picture, 'as images', func))
            asImage.setData(Visualization.asImage)
            asImage.setCheckable(True)
            group.triggered.connect(lambda *_, _button=button: _button.setChecked(True))
            button.setMenu(menu)
            scene.aerialsLoaded.connect(lambda *_, _button=button: _button.setEnabled(True))

        self.__usages = ((ui.usageUnset, Usage.unset),
                         (ui.usageSelected, Usage.selected),
                         (ui.usageDiscarded, Usage.discarded))
        for button, usage in self.__usages:
            button.toggled.connect(lambda checked, _usage=usage: self.__onVisualizationChanged(usages={_usage: checked}))
            scene.aerialsLoaded.connect(lambda *_, _button=button: _button.setEnabled(True))

        ui.aerialsFreeze.toggled.connect(lambda checked: ui.mapView.setInteractive(not checked))

        class TableView(QTableView):
            def currentChanged(self, current, previous):
                if current.isValid():
                    scene.highlightAerials.emit({current.data()})

        view = TableView()
        view.setSelectionBehavior(QTableView.SelectRows)
        view.verticalHeader().hide()
        view.setSortingEnabled(True)
        ui.highlight.setScene(scene)
        ui.highlight.setView(view)
        scene.aerialsLoaded.connect(lambda: ui.highlight.setEnabled(True))

        ui.exportSelectedImages.clicked.connect(scene.exportSelectedImages)
        scene.aerialsLoaded.connect(lambda: ui.exportSelectedImages.setEnabled(True))

        scene.aerialsLoaded.connect(lambda: self.__filterAerials(set()))

        scene.addAerialsVisible.connect(self.__addAerialsVisible)
        scene.noAerialsVisible.connect(self.__noAerialsVisible)
        scene.aerialsLoaded.connect(self.__onAerialsLoaded)
        scene.projectChanged.connect(lambda projectName: self.setWindowTitle(f'DoRIAH Image Selection: {projectName}'))

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

    @pyqtSlot()
    def __onContrastEnhancement(self) -> None:
        ui = self.ui
        if ui.aerialsContrastEnhancement.isChecked():
            enhancement = ui.aerialsContrastEnhancement.menu().actions()[0].actionGroup().checkedAction().data()
        else:
            enhancement = ContrastEnhancement.none
        ui.mapView.scene().contrastEnhancementChanged.emit(enhancement)

    @pyqtSlot(QToolButton, Availability)
    def __onAvailabilityChanged(self, button, availability) -> None:
        visualization = Visualization.none
        if button.isChecked():
            visualization = button.menu().actions()[0].actionGroup().checkedAction().data()
        self.__onVisualizationChanged(visualizations={availability: visualization})

    @pyqtSlot(set)
    def __filterAerials(self, imageIds: set[str]):
        self.__filteredImageIds = imageIds
        self.__onVisualizationChanged()

    @pyqtSlot(dict, dict)
    def __onVisualizationChanged(self, usages={}, visualizations={}):
        if not usages:
            usages = {usage: button.isChecked() for button, usage in self.__usages}
        if not visualizations:
            visualizations = {
                avail: button.menu().actions()[0].actionGroup().checkedAction(
                ).data() if button.isChecked() else Visualization.none
                for button, avail in self.__availabilities}
        self.ui.mapView.scene().visualizationChanged.emit(usages, visualizations, self.__filteredImageIds)

    @pyqtSlot()
    def __noAerialsVisible(self):
        self.__nVisibleAerials = 0
        self.__updateNAerialsShown()

    @pyqtSlot(int)
    def __addAerialsVisible(self, v):
        self.__nVisibleAerials += v
        self.__updateNAerialsShown()
        
    @pyqtSlot(list)
    def __onAerialsLoaded(self, aerials):
        self.__nTotalAerials = len(aerials)
        self.__updateNAerialsShown()
        # Fill the drop-down list of aerials.
        highlight = self.ui.highlight
        view = highlight.view()
        model = view.model()
        model.clear()
        interesting = 'Datum MASSTAB'.split()
        model.setHorizontalHeaderLabels(['id'] + interesting)
        for aerial in aerials:
            metaLo = {key.lower(): val for key, val in aerial['meta'].items()}
            items = [QStandardItem(aerial['id'])]
            for col in interesting:
                # Insert numbers as such and not as text, or sorting by MASSTAB fails.
                items.append(QStandardItem(1))
                items[-1].setData(metaLo.get(col.lower(), ''), Qt.DisplayRole)
            model.appendRow(items)
        view.resizeColumnsToContents()
        view.resizeRowsToContents()
        view.setMinimumWidth(view.horizontalHeader().length())
        highlight.setCurrentIndex(-1)

    def __updateNAerialsShown(self):
        self.ui.nAerialsShown.setText(f'Showing {self.__nVisibleAerials:3} of {self.__nTotalAerials:3} aerials')


    @pyqtSlot()
    def __readme(self):
        path = Path(__file__).parent.parent / 'README.md'
        with path.open() as fin:
            contents = fin.read()
        txtEdt = QTextEdit(self)
        txtEdt.setMarkdown(contents)
        txtEdt.setReadOnly(True)
        dialog = QDialog(self)
        dialog.setWindowTitle('ReadMe')
        dialog.resize(500, 500)
        layout = QVBoxLayout(dialog)
        layout.addWidget(txtEdt)
        dialog.show()


class StatusBarLogHandler(logging.Handler):
    def __init__(self, level: int, signal) -> None:
        super().__init__(level)
        self.__signal = signal
        formatter = logging.Formatter('{asctime}.{msecs:.0f} {levelname}: {name} - {message}',
                                      style='{', datefmt='%H:%M:%S')
        self.setFormatter(formatter)

    def emit(self, record: logging.LogRecord) -> None:
        msg = self.format(record)
        # Must be async, so the timout of QStatusBar.showMessage works.
        self.__signal.emit(msg)
