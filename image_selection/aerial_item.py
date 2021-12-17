#  ***************************************************************************
#  *                                                                         *
#  *   This program is free software; you can redistribute it and/or modify  *
#  *   it under the terms of the GNU General Public License as published by  *
#  *   the Free Software Foundation; either version 2 of the License, or     *
#  *   (at your option) any later version.                                   *
#  *                                                                         *
#  ***************************************************************************

""" Display aerials either as points, or as images.

Images shall scale with zoom, but points not.
For points to always be drawn with the same viewport size, set QGraphicsItem.ItemIgnoresTransformations.
It would be natural to combine AerialPoint and AerialImage in a common graphics item,
so they automatically stay at the same relative position, even when moved within the scene.
ItemIgnoresTransformations propagates to children and cannot be unset for a child.
Hence, AerialImage cannot be a child of AerialPoint.
AerialPoint could be a child of AerialImage: the image would scale with zoom, while the point would not.
However, it seems that the bounding rectangle that Qt computes for an item with ItemIgnoresTransformations set
is generally wrong unless it is a top-level item:
if the point is shown (and the image is hidden) and one has zoomed far out,
then the point would still be shown with the same size, but it's bounding rectangle would be a single pixel,
making it practically impossible to click onto it.
Hence, AerialPoint cannot be a child of AerialImage, either,
and it does not make a difference if both are children
of another (invisible; ItemHasNoContents) item or members of a QGraphicsItemGroup.
Hence, make them 2 separate, top-level items that reference each other.
Whenever one of them
- gets hidden, it tells the other one to show and vice versa.
- is moved, it moves the other one.

Possibly, it would work to integrate both in a common QGraphicsItem
by constantly updating AerialPoint's bounding rectangle using QGraphicsItem.deviceTransform.
However, this sounds slow.
 """

from qgis.PyQt.QtCore import pyqtSlot, QEvent, QObject, QPointF, QRect, Qt
from qgis.PyQt.QtGui import QBrush, QColor, QCursor, QFocusEvent, QIcon, QImage, QKeyEvent, QPen, QPainter, QPixmap, QTransform
from qgis.PyQt.QtWidgets import (QDialog, QGraphicsEllipseItem, QGraphicsItem, QMenu, QGraphicsPixmapItem,
                                 QGraphicsScene, QGraphicsSceneContextMenuEvent, QGraphicsSceneMouseEvent,
                                 QGraphicsSceneWheelEvent, QStyle, QStyleOptionGraphicsItem, QWhatsThis, QWidget)

import numpy as np
from osgeo import gdal

import concurrent.futures
import datetime
import enum
import json
import logging
from pathlib import Path
import sqlite3
import threading
from typing import Any, Optional, Union

from . import GdalPushLogHandler
from .preview_window import ContrastEnhancement, enhanceContrast, PreviewWindow

logger = logging.getLogger(__name__)


class Availability(enum.IntEnum):
    def __new__(cls, color):
        value = len(cls.__members__)
        obj = int.__new__(cls, value)
        obj._value_ = value
        obj.color = color
        return obj

    missing = Qt.gray
    findPreview = QColor(126, 177, 229) # Qt.blue
    preview = QColor(110, 195, 144) # Qt.green
    image = QColor(238, 195, 59) # Qt.yellow


class Usage(enum.IntEnum):
    discarded = enum.auto()
    unset = enum.auto()
    selected = enum.auto()


class TransformState(enum.IntEnum):
    def __new__(cls, penStyle):
        value = len(cls.__members__)
        obj = int.__new__(cls, value)
        obj._value_ = value
        obj.penStyle = penStyle
        return obj

    original = Qt.DotLine
    changed = Qt.SolidLine


class Visualization(enum.Enum):
    none = enum.auto()
    asPoint = enum.auto()
    asImage = enum.auto()


class AerialItem(QObject):

    def __init__(self, scene: QGraphicsScene, posScene: QPointF, imgId: str, meta, db: sqlite3.Connection):
        super().__init__()
        point = AerialPoint()
        image = AerialImage(imgId, posScene, meta, point, db)
        point.setImage(image)
        image.setVisible(False)
        scene.contrastEnhancement.connect(image.setContrastEnhancement)
        toolTip = [f'<tr><td>{name}</td><td>{value}</td></tr>' for name, value in meta._asdict().items()]
        toolTip = ''.join(['<table>'] + toolTip + ['</table>'])
        for el in point, image:
            el.setToolTip(toolTip)
            scene.addItem(el)

        self.__image = image
        self.__point = point
        self.__point.__keepMeAlive = self
        scene.visualizationByAvailability.connect(self.setVisualizationByAvailability, Qt.QueuedConnection)
        scene.visualizationByUsage.connect(self.setVisualizationByUsage, Qt.QueuedConnection)


    @pyqtSlot(Availability, Visualization, dict)
    def setVisualizationByAvailability(self, availability, visualization, usages: dict[Usage, bool]) -> None:
        if availability != self.__image.availability():
            return
        usage = self.__image.usage()
        self.__point.setVisible(visualization == Visualization.asPoint and usages[usage])
        self.__image.setVisible(visualization == Visualization.asImage and usages[usage])


    @pyqtSlot(Usage, bool, dict)
    def setVisualizationByUsage(self, usage, checked, visualizations: dict[Availability, Visualization]) -> None:
        if usage != self.__image.usage():
            return
        availability = self.__image.availability()
        self.__point.setVisible(visualizations[availability] == Visualization.asPoint and checked)
        self.__image.setVisible(visualizations[availability] == Visualization.asImage and checked)


class AerialPoint(QGraphicsEllipseItem):

    def __init__(self, radius: float = 7):
        super().__init__(-radius, -radius, radius * 2, radius * 2)
        self.setFlag(QGraphicsItem.ItemIgnoresTransformations)
        self.setFlag(QGraphicsItem.ItemIsFocusable)
        self.setCursor(Qt.PointingHandCursor)
        self.setCacheMode(QGraphicsItem.DeviceCoordinateCache)
        self.__transformState = TransformState.original
        self.__cross = _makeOverlay('cross', self)
        self.__tick = _makeOverlay('tick', self)
        self.__image: Optional[AerialImage] = None


    def mouseDoubleClickEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.LeftButton:
            self.setVisible(False)
            self.__image.setVisible(True)
            self.__image.setFocus(Qt.OtherFocusReason)
        else:
            super().mouseDoubleClickEvent(event)


    def sceneEvent(self, event: QEvent) -> bool:
        if event.type() != QEvent.WhatsThis:
            return super().sceneEvent(event)
        whatsThis = 'An aerial image shown as point. Double-click to open.'
        QWhatsThis.showText(event.globalPos(), whatsThis)
        return True


    def focusInEvent(self, event: QFocusEvent) -> None:
        self.__setPen()
        super().focusInEvent(event)


    def focusOutEvent(self, event: QFocusEvent) -> None:
        self.__setPen()
        super().focusOutEvent(event)


    # end of overrides


    def setImage(self, image: 'AerialImage') -> None:
        self.__image = image
        self.setAvailability(image.availability())
        self.setUsage(image.usage())
        self.setTransformState(image.transformState())


    def setAvailability(self, availability: Availability) -> None:
        self.setBrush(QBrush(availability.color))


    def setUsage(self, usage: Usage) -> None:
        self.setZValue(usage)
        self.__cross.setVisible(usage == Usage.discarded)
        self.__tick.setVisible(usage == Usage.selected)


    def setTransformState(self, transformState: TransformState) -> None:
        self.__transformState = transformState
        self.__setPen()


    def __setPen(self) -> None:
        self.setPen(QPen(Qt.black, 2 if self.hasFocus() else 1, self.__transformState.penStyle))


def _missingAerialPixMap(size: int) -> QPixmap:
    img = QImage(size, size, QImage.Format_RGBA8888)
    img.fill(Qt.darkMagenta)
    return QPixmap.fromImage(img)


class AerialImage(QGraphicsPixmapItem):

    __missingPixMap = _missingAerialPixMap(1000)

    __rotateCursor = QCursor(QPixmap(':/plugins/image_selection/rotate'))

    __transparencyCursor = QCursor(QPixmap(':/plugins/image_selection/eye'))

    __threadPool: Optional[concurrent.futures.ThreadPoolExecutor] = None

    imageRootDir: Path

    previewRootDir: Path

    firstInstance = True


    @staticmethod
    def unload():
        if __class__.__threadPool is not None:
            __class__.__threadPool.shutdown(wait=False, cancel_futures=True)


    @staticmethod
    def __zValueFor(usage: Usage) -> int:
        return usage + max(Usage)


    def __init__(self, imgId: str, pos: QPointF, meta, point: AerialPoint, db: sqlite3.Connection):
        super().__init__()
        self.setFlag(QGraphicsItem.ItemIsMovable)
        self.setFlag(QGraphicsItem.ItemIsFocusable)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges)
        self.setShapeMode(QGraphicsPixmapItem.BoundingRectShape)
        self.setTransformationMode(Qt.SmoothTransformation)            
        self.__origPos = pos
        self.__radiusBild = meta.Radius_Bild
        self.__point = point
        self.__opacity = 1.
        self.__loadedPixMapParams = None
        self.__currentContrast = ContrastEnhancement.histogram
        self.__futurePixmap: Optional[concurrent.futures.Future] = None
        self.__futurePixmapLock = threading.Lock()
        self.__db = db
        self.__imgId = imgId
        pixMap = self.__missingPixMap
        self.setPixmap(pixMap)
        self.setOffset(-pixMap.width() / 2, -pixMap.height() / 2)
        self.__cross = _makeOverlay('cross', self, QGraphicsItem.ItemIgnoresTransformations)
        self.__tick = _makeOverlay('tick', self, QGraphicsItem.ItemIgnoresTransformations)

        if __class__.firstInstance:
            __class__.firstInstance = False
            db.execute('PRAGMA foreign_keys = ON')
            db.execute('''
                CREATE TABLE IF NOT EXISTS usages
                (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL
                ) ''')
            db.executemany(
                'INSERT OR IGNORE INTO usages(id, name) VALUES( ?, ? )',
                ((el, el.name) for el in Usage))
            db.execute('''
                CREATE TABLE IF NOT EXISTS aerials
                (
                    imgId TEXT PRIMARY KEY NOT NULL,
                    usage INT NOT NULL REFERENCES usages(id),
                    scenePos TEXT NOT NULL,
                    trafo TEXT NOT NULL,
                    imgPath TEXT,
                    previewRect TEXT,
                    meta TEXT NOT NULL
                ) ''')

        if row := db.execute('SELECT usage, scenePos, trafo FROM aerials WHERE imgId == ?', [imgId] ).fetchone():
            self.__setUsage(Usage(row[0]))
            self.setPos(QPointF(*json.loads(row[1])))
            self.setTransform(QTransform(*json.loads(row[2])))
            if self.transform() == self.__originalTransform() and self.pos() == self.__origPos:
                trafoState = TransformState.original
            else:
                trafoState = TransformState.changed
            self.__setTransformState(trafoState)
        else:
            def toJson(value):
                if isinstance(value, datetime.date):
                    return str(value)
                raise TypeError(f'Unable to encode type {value.__class__}')

            imgPath = __class__.imageRootDir / imgId
            db.execute(
                'INSERT INTO aerials (imgId, usage, scenePos, trafo, imgPath, meta) VALUES(?, ?, ?, ?, ?, ?)',
                [imgId,
                 Usage.unset,
                 json.dumps([pos.x(), pos.y()]),
                 json.dumps(np.eye(3).ravel().tolist()),
                 str(imgPath) if imgPath.exists() else None,
                 json.dumps(meta._asdict(), default=toJson)] )
            self.__setUsage(Usage.unset)
            self.__resetTransform()
            self.__setTransformState(TransformState.original)

        self.__deriveAvailability()


    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, v: Any) -> Any:
        if change == QGraphicsItem.ItemVisibleHasChanged:
            if v:
                self.__requestPixMap()

        elif change == QGraphicsItem.ItemPositionHasChanged:
            self.__point.setPos(v)
            self.__db.execute(
                'UPDATE aerials SET scenePos = ? WHERE imgId == ?',
                [json.dumps([v.x(), v.y()]), self.__imgId])
            self.__setTransformState(TransformState.changed)

        elif change == QGraphicsItem.ItemTransformHasChanged:
            self.__db.execute(
                'UPDATE aerials SET trafo = ? WHERE imgId == ?',
                [json.dumps([
                    v.m11(), v.m12(), v.m13(),
                    v.m21(), v.m22(), v.m23(),
                    v.m31(), v.m32(), v.m33()]), self.__imgId])
            self.__setTransformState(TransformState.changed)

        return super().itemChange(change, v)


    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if not self.hasFocus():
            # Prevent this from being moved just because another item on top has ignored the event.
            return event.ignore()
        isMovable = self.flags() & QGraphicsItem.ItemIsMovable
        if event.button() == Qt.LeftButton:
            if event.modifiers() & Qt.AltModifier:
                self.__opacity = self.opacity()
                self.setOpacity(0)
            elif isMovable:
                self.setCursor(Qt.ClosedHandCursor)
            else:
                event.ignore()
        if isMovable:
            # Otherwise, super ignores the event, and so I would not receive a corresp. release event.
            super().mousePressEvent(event)


    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        self.setOpacity(self.__opacity)
        self.__chooseCursor(event)
        super().mouseReleaseEvent(event)


    def mouseDoubleClickEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.LeftButton:
            self.setVisible(False)
            self.__point.setVisible(True)
            self.__point.setFocus(Qt.OtherFocusReason)
        else:
            super().mouseDoubleClickEvent(event)


    def wheelEvent(self, event: QGraphicsSceneWheelEvent) -> None:
        if self.availability() < Availability.preview or not self.hasFocus():
            # Prevent self from being zoomed only because an item on top has ignored the event.
            return event.ignore()
        numSteps = event.delta() / 8 / 15
        if event.modifiers() & Qt.ShiftModifier:
            numSteps /= 10

        if event.modifiers() & Qt.AltModifier:
            self.__opacity = min(max(self.opacity() - numSteps * .1, .3), 1.)
            self.setOpacity(self.__opacity)
            return

        pos = event.pos() # in units of image pixels; ignores self.offset() i.e. (0, 0) is the image center.
        x, y = pos.x(), pos.y()
        if not event.modifiers() & Qt.ControlModifier:
            # self.mapToScene(pt) seems to return:
            # self.transform().map(pt) + self.scenePos()
            # , where self.scenePos() == self.pos() for top-level items.
            scale = 1.1 ** numSteps
            # trafo = QTransform.fromTranslate(x, y).scale(scale, scale).translate(-x, -y)
            trafo = QTransform.fromTranslate(x * (1-scale), y * (1-scale)).scale(scale, scale)
            # or equivalently, using standard matrix multiplications:
            # trafo = QTransform.fromTranslate(-x, -y) * QTransform.fromScale(scale, scale) * QTransform.fromTranslate(x, y)
        else:
            angle = numSteps * 10
            trafo = QTransform.fromTranslate(x, y).rotate(angle).translate(-x, -y)

        # Note: since Qt multiplies points on their right, self.transform() gets applied last.
        combined = trafo * self.transform()
        # self.pos() is my position in parent's (scene) coordinates, which is added to the result of self.transform().map
        # Let's make self.transform() map the origin of item coordinates to (0, 0) in parent (scene) coordinates,
        # and move self.pos() accordingly, so the position of my AerialPoint will move to self.pos() as well.
        # Hence, do not simply do:
        # self.setTransform(combined)
        # or equivalently:
        # self.setTransform(trafo, combine=True)

        # Multiplies QPointF on the left of the 3x3 transformation matrix (in homogeneous coordinates).
        origin = combined.map(QPointF(0., 0.))
        combined *= QTransform.fromTranslate(-origin.x(), -origin.y())
        self.setTransform(combined)
        self.moveBy(origin.x(), origin.y())
        # or equivalently:
        # self.setPos(self.pos() + origin)

        
    def keyPressEvent(self, event: QKeyEvent) -> None:
        self.__chooseCursor(event)
        super().keyPressEvent(event)


    def keyReleaseEvent(self, event: QKeyEvent) -> None:
        # Note: if QMainWindow has a QMenuBar, then only every other release of the Alt key lands here.
        # Qt Designer may set a QMenuBar in .ui
        self.__chooseCursor(event)
        super().keyReleaseEvent(event)


    def sceneEvent(self, event: QEvent) -> bool:
        if event.type() != QEvent.WhatsThis:
            return super().sceneEvent(event)
        whatsThis = '''
<h4>An aerial image shown as such.</h4>

Pan using the left mouse button.<br/>

Use mouse wheel to scale the image under the mouse cursor.<br/>

Use mouse wheel + Ctrl to rotate it under the mouse cursor.<br/>

Hold Shift to slow down zoom and rotation.<br/>

Use mouse wheel + Alt to control transparency.<br/>

Hold left mouse button + Alt to temporally hide the image.<br/>

Double-click to close.<br/>
'''
        QWhatsThis.showText(event.globalPos(), whatsThis)
        return True


    def focusInEvent(self, event: QFocusEvent) -> None:
        self.setZValue(max(Usage) * 2 + 1)
        super().focusInEvent(event)


    def focusOutEvent(self, event: QFocusEvent) -> None:
        self.setZValue(self.__zValueFor(self.usage()))
        super().focusOutEvent(event)


    def contextMenuEvent(self, event: QGraphicsSceneContextMenuEvent) -> None:
        menu = QMenu('menu')
        menu.setToolTipsVisible(True)
        if self.__availability in (Availability.findPreview, Availability.preview):
            menu.addAction(QIcon(':/plugins/image_selection/image-crop'), 'Find preview', lambda: self.__findPreview())
        menu.addSection('Usage')
        usage = self.usage()
        if usage != Usage.unset:
            menu.addAction(QIcon(':/plugins/image_selection/selection'), 'Unset', lambda: self.__setUsage(Usage.unset))
        if usage != Usage.selected:
            menu.addAction(QIcon(':/plugins/image_selection/tick'), 'Select', lambda: self.__setUsage(Usage.selected))
        if usage != Usage.discarded:
            menu.addAction(QIcon(':/plugins/image_selection/cross'), 'Discard', lambda: self.__setUsage(Usage.discarded))
        menu.addSeparator()
        if self.__transformState == TransformState.changed:
            menu.addAction(QIcon(':/plugins/image_selection/home'), 'Reset transform', self.__resetTransform)
        menu.exec(event.screenPos())


    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: Optional[QWidget] = None) -> None:
        pm = None
        with self.__futurePixmapLock:
            if self.__futurePixmap is not None:
                pm = self.__futurePixmap.result()  # result() might raise here, in the wanted thread.
                self.__futurePixmap = None

        if pm is not None:
            self.setPixmap(pm)
            self.setOffset(-pm.width() / 2, -pm.height() / 2)

        super().paint(painter, option, widget)
        painter.save()
        # Qt 5.15 docs for QGraphicsItem::paint say:
        #   "QGraphicsItem does not support use of cosmetic pens with a non-zero width."
        # But obviously, it does support them, at least on Windows.
        width = 2 if option.state & QStyle.State_HasFocus else 1
        pen = QPen(self.__availability.color, width, self.__transformState.penStyle)
        pen.setCosmetic(True)
        painter.setPen(pen)
        painter.drawRect(self.boundingRect())
        painter.restore()


    # end of overrides


    def __requestPixMap(self):
        imgPath, previewRect = self.__db.execute('SELECT imgPath, previewRect FROM aerials WHERE imgId == ?', [self.__imgId]).fetchone()

        if self.__availability in (Availability.preview, Availability.image):
            if not self.__loadedPixMapParams or self.__loadedPixMapParams != (self.__currentContrast, imgPath, previewRect):
                if __class__.__threadPool is None:
                    __class__.__threadPool = concurrent.futures.ThreadPoolExecutor(thread_name_prefix='ImageReader')

                if previewRect is not None:
                    previewRect = QRect(*json.loads(previewRect))
                future = __class__.__threadPool.submit(_getPixMap, Path(imgPath), self.__missingPixMap.width(), self.__currentContrast, previewRect or QRect())
                future.add_done_callback(self.__pixMapReady)

        self.__loadedPixMapParams = self.__currentContrast, imgPath, previewRect


    def __pixMapReady(self, future) -> None:
        with self.__futurePixmapLock:
            self.__futurePixmap = future
        self.update()


    def setContrastEnhancement(self, contrast: ContrastEnhancement):
        self.__currentContrast = contrast
        if self.isVisible():
            self.__requestPixMap()


    def availability(self) -> Availability:
        return self.__availability


    def __deriveAvailability(self) -> None:
        imgPath, previewRect = self.__db.execute('SELECT imgPath, previewRect FROM aerials WHERE imgId == ?', [self.__imgId]).fetchone()
        if imgPath is None:
            filmDir = self.previewRootDir / Path(self.__imgId).parent
            availability = Availability.findPreview if filmDir.exists() else Availability.missing
        else:
            availability = Availability.image if previewRect is None else Availability.preview
        self.setFlag(QGraphicsItem.ItemIsMovable, availability >= Availability.preview)
        self.__availability = availability
        self.__point.setAvailability(availability)


    def usage(self) -> Usage:
        value, = self.__db.execute(
            'SELECT usage FROM aerials WHERE imgId == ?',
            [self.__imgId]).fetchone()
        return Usage(value)


    def __setUsage(self, usage: Usage) -> None:
        self.setZValue(self.__zValueFor(usage))
        self.__cross.setVisible(usage == Usage.discarded)
        self.__tick.setVisible(usage == Usage.selected)
        self.__point.setUsage(usage)
        self.__db.execute(
            'UPDATE aerials SET usage = ? WHERE imgId == ?',
            [usage, self.__imgId])


    def transformState(self) -> TransformState:
        return self.__transformState


    def __setTransformState(self, transformState: TransformState) -> None:
        self.__transformState = transformState
        self.__point.setTransformState(transformState)


    def __originalTransform(self) -> QTransform:
        pm = self.pixmap()
        scale = self.__radiusBild / (pm.width() / 2)
        return QTransform.fromScale(scale, scale)


    def __resetTransform(self):
        self.setTransform(self.__originalTransform())
        self.setPos(self.__origPos)
        self.__setTransformState(TransformState.original)


    def __chooseCursor(self, event: Union[QKeyEvent, QGraphicsSceneMouseEvent]):
        if event.modifiers() & Qt.AltModifier:
            self.setCursor(self.__transparencyCursor)
        elif event.modifiers() & Qt.ControlModifier and self.availability() >= Availability.preview:
            self.setCursor(self.__rotateCursor)
        else:
            self.unsetCursor()


    def __findPreview(self):
        filmDir = self.previewRootDir / Path(self.__imgId).parent
        dialog = PreviewWindow(filmDir, Path(self.__imgId).stem)
        if dialog.exec() == QDialog.Accepted:
            path, rect = dialog.selection()
            self.__db.execute(
                'UPDATE aerials SET imgPath = ?, previewRect = ? WHERE imgId == ?',
                [str(path),
                 json.dumps([rect.left(), rect.top(), rect.width(), rect.height()]),
                 self.__imgId])
            self.__deriveAvailability()
            self.__requestPixMap()


def _getPixMap(imgPath: Path, width: int, contrast: ContrastEnhancement, rect = QRect()):
    with GdalPushLogHandler():
        ds = gdal.Open(str(imgPath))
        if rect.isNull():
            rect = QRect(0, 0, ds.RasterXSize, ds.RasterYSize)
        height = round(rect.height() / rect.width() * width)
        img = QImage(width, height, QImage.Format_RGBA8888)
        img.fill(Qt.white)
        ptr = img.bits()
        ptr.setsize(img.sizeInBytes())
        assert ds.RasterCount in (1, 3)
        iBands = [1] * 3 if ds.RasterCount == 1 else [1, 2, 3]
        ds.ReadRaster1(rect.left(), rect.top(), rect.width(), rect.height(),
                    width, height, gdal.GDT_Byte, iBands,
                    buf_pixel_space=4, buf_line_space=width * 4, buf_band_space=1,
                    resample_alg=gdal.GRIORA_Gauss,
                    inputOutputBuf=ptr)

    enhanceContrast(img, contrast)
    return QPixmap.fromImage(img)


def _makeOverlay(name: str, parent: QGraphicsItem, flag: Optional[QGraphicsItem.GraphicsItemFlag] = None):
    pm = QPixmap(':/plugins/image_selection/' + name)
    item = QGraphicsPixmapItem(pm, parent)
    item.setOffset(-pm.width() / 2, -pm.height() / 2)
    item.setTransformationMode(Qt.SmoothTransformation)
    if flag is not None:
        item.setFlag(flag)
    return item
