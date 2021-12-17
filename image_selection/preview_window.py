#  ***************************************************************************
#  *                                                                         *
#  *   This program is free software; you can redistribute it and/or modify  *
#  *   it under the terms of the GNU General Public License as published by  *
#  *   the Free Software Foundation; either version 2 of the License, or     *
#  *   (at your option) any later version.                                   *
#  *                                                                         *
#  ***************************************************************************

from qgis.PyQt.QtCore import QModelIndex, QRect, QRectF, Qt
from qgis.PyQt.QtGui import QImage, QPen, QPixmap
from qgis.PyQt.QtWidgets import QButtonGroup, QDialogButtonBox, QFileSystemModel, QGraphicsPixmapItem, QGraphicsRectItem, QGraphicsScene, QGraphicsView
from qgis.PyQt.uic import loadUiType

import numpy as np
from osgeo import gdal

import enum
from pathlib import Path
from typing import Optional

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


def enhanceContrast(img: QImage, contrastEnhancement: ContrastEnhancement) -> None:
    if contrastEnhancement != ContrastEnhancement.none:
        ptr = img.bits()
        ptr.setsize(img.sizeInBytes())
        arr = np.ndarray(shape=(img.height(), img.width(), 4), dtype=np.uint8, buffer=ptr)
        red = arr[:, :, 0]
        if contrastEnhancement == ContrastEnhancement.minMax:
            lo, hi = np.percentile(red, [3, 97])
            transformed = np.rint(np.clip((red.astype(float) - lo) / (hi - lo) * 255, 0, 255)).astype(np.uint8)
        else:
            count = np.bincount(red.flat, minlength=256)
            cumsum = np.cumsum(count)
            transfer = np.rint(cumsum * 255 / cumsum[-1]).astype(np.uint8)
            transformed = transfer[red.flat].reshape(red.shape)
        arr[:, :, :3] = transformed[:, :, None]


class PreviewWindow(FormBase):

    def __init__(self, filmDir: Path, imageName: str, parent=None) -> None:
        self.__rect: Optional[QGraphicsRectItem] = None
        self.__contrastEnhancement = ContrastEnhancement.none
        super().__init__(parent)
        ui = self.ui = Form()
        ui.setupUi(self)
        self.setWindowFlags(Qt.CustomizeWindowHint | Qt.WindowMinMaxButtonsHint | Qt.WindowCloseButtonHint)
        self.setWindowTitle(f'Locate preview of {filmDir.name}/{imageName}')
        contrastGroup = QButtonGroup()
        contrastGroup.addButton(ui.off, ContrastEnhancement.none)
        contrastGroup.addButton(ui.minMax, ContrastEnhancement.minMax)
        contrastGroup.addButton(ui.histogram, ContrastEnhancement.histogram)
        contrastGroup.idClicked.connect(lambda enhancement: self.__setContrastEnhancement(enhancement))
        self.__keepMeAlive = contrastGroup
        ui.splitter.setSizes([100, 500])
        ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(False)
        assert filmDir.exists() # otherwise, the dialog will never be shown?
        model = QFileSystemModel(self)
        model.directoryLoaded.connect(lambda _: self.__hideColumns(model.columnCount()))
        idx = model.setRootPath(str(filmDir))
        ui.treeView.setModel(model)
        ui.treeView.setRootIndex(idx)
        ui.treeView.selectionModel().currentChanged.connect(lambda current, _: self.__showFile(current))

        scene = QGraphicsScene()
        ui.graphicsView.setScene(scene)
        ui.graphicsView.rubberBandChanged.connect(lambda _, fromPt, toPt: self.__selectionChanged(QRectF(fromPt, toPt)))


    def selection(self) -> tuple[Path, QRect]:
        if self.__rect is None:
            return Path(), QRect()
        view = self.ui.treeView
        return Path(view.model().filePath(view.selectionModel().currentIndex())), self.__rect.rect().toRect()


    def __setContrastEnhancement(self, enhancement: int) -> None:
        self.__contrastEnhancement = ContrastEnhancement(enhancement)
        self.__showFile(self.ui.treeView.selectionModel().currentIndex(), False)


    def __showFile(self, idx: QModelIndex, resetTransform = True ) -> None:
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
                return
            self.__rect = QGraphicsRectItem(sceneRect)
            self.__rect.setPen(QPen(Qt.magenta, 0))
            scene.addItem(self.__rect)
            self.ui.buttonBox.button(QDialogButtonBox.Ok).setEnabled(True)
