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
 ImageSelection
                                 A QGIS plugin
 Guided selection of images with implicit coarse geo-referencing.
                              -------------------
        begin                : 2021-11-12
        copyright            : (C) 2021 by Photogrammetry @ GEO, TU Wien, Austria
        email                : wilfried.karel@geo.tuwien.ac.at
        git sha              : $Format:%H$
 ***************************************************************************/
"""
from __future__ import annotations

from qgis.PyQt.QtCore import pyqtSlot, QModelIndex, QRect, QRectF, Qt
from qgis.PyQt.QtGui import QIcon, QImage, QPen, QPixmap
from qgis.PyQt.QtWidgets import QActionGroup, QDialogButtonBox, QFileSystemModel, QGraphicsPixmapItem, QGraphicsRectItem, QGraphicsScene, QGraphicsView, QMenu
from qgis.PyQt.uic import loadUiType

import numpy as np
from osgeo import gdal

import enum
from pathlib import Path
from typing import cast

try:
    import skimage.exposure
except ImportError:
    claheAvailable = False
else:
    claheAvailable = True

from . import GdalPushLogHandler


class GraphicsView(QGraphicsView):

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

    def resizeEvent(self, event) -> None:
        sceneRect = self.scene().sceneRect()
        if not sceneRect.isNull():
            currScale = self.viewportTransform().determinant() ** .5
            wantedScale = self.viewport().width() / sceneRect.width()
            factor = wantedScale / currScale
            self.scale(factor, factor)
        super().resizeEvent(event)


Form, FormBase = loadUiType(Path(__file__).parent / 'preview_window_base.ui',
                            from_imports=True, import_from=__name__.rpartition('.')[0])


class ContrastEnhancement(enum.IntEnum):
    none = enum.auto()
    minMax = enum.auto()
    histogram = enum.auto()
    clahe = enum.auto()  # contrast limited adaptive histogram equalization.


def enhanceContrast(img: QImage, contrastEnhancement: ContrastEnhancement) -> None:
    if contrastEnhancement != ContrastEnhancement.none:
        ptr = img.bits()
        ptr.setsize(img.sizeInBytes())
        arr = np.ndarray(shape=(img.height(), img.width(), 4), dtype=np.uint8, buffer=cast(memoryview, ptr))
        red = arr[:, :, 0]
        if contrastEnhancement == ContrastEnhancement.minMax:
            lo, hi = np.percentile(red, [3, 97])
            transformed = np.rint(np.clip((red.astype(float) - lo) / (hi - lo) * 255, 0, 255)).astype(np.uint8)
        elif contrastEnhancement == ContrastEnhancement.histogram:
            count = np.bincount(red.flat, minlength=256)
            cumsum = np.cumsum(count)
            transfer = np.rint(cumsum * 255 / cumsum[-1]).astype(np.uint8)
            transformed = transfer[red.flat].reshape(red.shape)
        else:
            assert contrastEnhancement == ContrastEnhancement.clahe
            # Especially for large microfilm scans, this is quite slow (~10s).
            # Even more, while QGIS 3.22 on Windows comes with NumPy with SIMD optimizations:
            #    for item in np.core._multiarray_umath.__cpu_features__.items():  print(item)
            # , it lacks BLAS and LAPACK:
            #    np.show_config()
            # , which further slows down this image enhancement. Hence, let's not make it the default.
            transformed = skimage.exposure.equalize_adapthist(red, clip_limit=0.03)
            transformed = np.round(transformed * 255).astype(np.uint8)

        arr[:, :, :3] = transformed[:, :, None]


class PreviewWindow(FormBase):

    def __init__(self, filmDir: Path, imageName: str, parent=None) -> None:
        self.__rect: QGraphicsRectItem | None = None
        # Preview images (typically containing low-resolution scans of multiple aerials) seem to be arbitrarly rotated.
        # Full-resolution scans, however, seem to always be delivered upright i.e. the image number is shown upright.
        # Hence, support rotating the QGraphicsView, so the image numbers can easily be recognized.
        # Also, store the rotation of the view at the time a preview rectangle is returned:
        # - for display in the map window, consider the rotation:
        #   the map window will show the preview with the same rotation as here, until the user further rotates it.
        # - in fine-georeferencing, when the rull-res image has been delivered,
        #   ignore the stored rotation of the QGraphicsView here, and only consider the user-supplied
        #   rotation/scaling/shifting done in the map window.
        #   If users ensure that the image number is shown upright when selecting a preview,
        #   and if the full-res image is indeed delivered with the image number shown upright as well,
        #   then fine-georeferencing does not need to guess the coarse in-plane rotation of the full-res image.
        self.__viewRotationCcw: int = 0
        self.__contrastEnhancement = ContrastEnhancement.none
        super().__init__(parent)
        ui = self.ui = Form()
        ui.setupUi(self)
        self.setWindowFlags(Qt.CustomizeWindowHint | Qt.WindowMinMaxButtonsHint | Qt.WindowCloseButtonHint)
        self.setWindowTitle(f'Locate preview of {filmDir.name}/{imageName}')
        ui.splitter.setSizes([100, 500])
        ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(False)
        assert filmDir.exists()  # otherwise, the dialog will never be shown?
        model = QFileSystemModel(self)
        model.directoryLoaded.connect(lambda: self.__hideColumns(model.columnCount()))
        idx = model.setRootPath(str(filmDir))
        ui.treeView.setModel(model)
        ui.treeView.setRootIndex(idx)
        ui.treeView.selectionModel().currentChanged.connect(lambda current: self.__showFile(current))

        scene = QGraphicsScene()
        ui.graphicsView.setScene(scene)
        ui.graphicsView.rubberBandChanged.connect(lambda _, fromPt, toPt: self.__selectionChanged(QRectF(fromPt, toPt)))

        ui.rotateLeft.clicked.connect(lambda: self.__rotate(True))
        ui.rotateRight.clicked.connect(lambda: self.__rotate(False))

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
        chartPlus = QIcon(':/plugins/image_selection/chart--plus')
        if claheAvailable:
            clahe = group.addAction(menu.addAction(chartPlus, 'Contrast limited, adaptive histogram equalization',
                                    self.__onContrastEnhancement))
            clahe.setData(ContrastEnhancement.clahe)
            clahe.setCheckable(True)

        histogram.setChecked(True)

        ui.contrastEnhancement.setMenu(menu)
        ui.contrastEnhancement.toggled.connect(self.__onContrastEnhancement)

    def selection(self) -> tuple[Path, QRect, int]:
        if self.__rect is None:
            return Path(), QRect(), 0
        view = self.ui.treeView
        return Path(view.model().filePath(view.selectionModel().currentIndex())), self.__rect.rect().toRect(), self.__viewRotationCcw

    @pyqtSlot()
    def __onContrastEnhancement(self) -> None:
        ui = self.ui
        if ui.contrastEnhancement.isChecked():
            self.__contrastEnhancement = ui.contrastEnhancement.menu().actions()[0].actionGroup().checkedAction().data()
        else:
            self.__contrastEnhancement = ContrastEnhancement.none
        self.__showFile(ui.treeView.selectionModel().currentIndex(), False)

    @pyqtSlot(bool)
    def __rotate(self, ccw: bool) -> None:
        factor = +1 if ccw else -1
        self.ui.graphicsView.rotate(-90 * factor)
        self.__viewRotationCcw += factor


    def __showFile(self, idx: QModelIndex, resetTransform=True) -> None:
        model = self.ui.treeView.model()
        if model.isDir(idx):
            return
        imgPath = Path(model.filePath(idx))
        assert imgPath.exists()
        self.setCursor(Qt.WaitCursor)
        try:
            with GdalPushLogHandler():
                ds = gdal.Open(str(imgPath))
                img = QImage(ds.RasterXSize, ds.RasterYSize, QImage.Format_RGBA8888)
                img.fill(Qt.white)
                ptr = img.scanLine(0)
                ptr.setsize(img.sizeInBytes())
                assert ds.RasterCount in (1, 3)
                iBands = [1] * 3 if ds.RasterCount == 1 else [1, 2, 3]
                ds.ReadRaster1(0, 0, ds.RasterXSize, ds.RasterYSize,
                               ds.RasterXSize, ds.RasterYSize, gdal.GDT_Byte, iBands,
                               buf_pixel_space=4, buf_line_space=ds.RasterXSize * 4, buf_band_space=1,
                               resample_alg=gdal.GRIORA_NearestNeighbour,
                               inputOutputBuf=ptr)

            enhanceContrast(img, self.__contrastEnhancement)

            graphicsView = self.ui.graphicsView
            scene = graphicsView.scene()
            scene.clear()
            self.__rect = None
            self.ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(False)
            scene.setSceneRect(0, 0, img.width(), img.height())
            pixMap = QGraphicsPixmapItem(QPixmap.fromImage(img))
            pixMap.setTransformationMode(Qt.SmoothTransformation)
            pixMap.setShapeMode(QGraphicsPixmapItem.BoundingRectShape)
            scene.addItem(pixMap)
            if resetTransform:
                graphicsView.fitInView(scene.sceneRect(), Qt.KeepAspectRatioByExpanding)
                graphicsView.ensureVisible(0, 0, 1, 1, 0, 1)  # scroll to top.
        finally:
            self.unsetCursor()

    def __hideColumns(self, columnCount: int) -> None:
        # Hide file size, type, etc.
        for idx in range(1, columnCount):
            self.ui.treeView.hideColumn(idx)

    def __selectionChanged(self, sceneRect: QRectF) -> None:
        if sceneRect.isNull():
            scene = self.ui.graphicsView.scene()
            if self.__rect is not None:
                scene.removeItem(self.__rect)
            # The rubber band can actually be dragged outside the scene=view limits!
            sceneRect = scene.selectionArea().boundingRect() & scene.sceneRect()
            if sceneRect.isNull():
                return self.ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(False)
            self.__rect = QGraphicsRectItem(sceneRect)
            self.__rect.setPen(QPen(Qt.magenta, 0))
            scene.addItem(self.__rect)
            self.ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(True)
