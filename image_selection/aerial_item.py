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

Display aerials either as points, or as images.

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

from qgis.PyQt.QtCore import pyqtSlot, QEvent, QObject, QPointF, QSize, QRect, Qt
from qgis.PyQt.QtGui import QBitmap, QBrush, QColor, QCursor, QFocusEvent, QHelpEvent, QIcon, QImage, QKeyEvent, QPen, QPainter, QPixmap, QTransform
from qgis.PyQt.QtWidgets import (QDialog, QGraphicsEffect, QGraphicsEllipseItem, QGraphicsItem, QMenu, QGraphicsPixmapItem,
                                 QGraphicsSceneContextMenuEvent, QGraphicsSceneMouseEvent,
                                 QGraphicsSceneWheelEvent, QStyle, QStyleOptionGraphicsItem, QWhatsThis, QWidget)

import numpy as np
from osgeo import gdal

from concurrent import futures
import datetime
import enum
import json
import logging
from pathlib import Path
import sqlite3
import threading
from typing import cast, Final, Optional, Union
import weakref

from . import GdalPushLogHandler
from .preview_window import claheAvailable, ContrastEnhancement, enhanceContrast, PreviewWindow
from . import map_scene

logger: Final = logging.getLogger(__name__)


class Availability(enum.IntEnum):
    def __new__(cls, color):
        value = len(cls.__members__)
        obj = int.__new__(cls, value)
        obj._value_ = value
        obj.color = color
        return obj

    color: Union[Qt.GlobalColor, QColor]

    missing = Qt.gray
    findPreview = QColor(126, 177, 229)  # Qt.blue
    preview = QColor(110, 195, 144)  # Qt.green
    image = QColor(238, 195, 59)  # Qt.yellow


class Usage(enum.IntEnum):
    discarded = 0
    unset = 1
    selected = 2


class TransformState(enum.IntEnum):
    def __new__(cls, penStyle):
        value = len(cls.__members__)
        obj = int.__new__(cls, value)
        obj._value_ = value
        obj.penStyle = penStyle
        return obj

    penStyle: Qt.PenStyle

    original = Qt.DotLine
    changed = Qt.SolidLine


class Visualization(enum.Enum):
    none = enum.auto()
    asPoint = enum.auto()
    asImage = enum.auto()


class InversionEffect(QGraphicsEffect):
    def draw(self, painter):
        pixmap, offset = self.sourcePixmap(Qt.DeviceCoordinates)
        img = pixmap.toImage()
        img.invertPixels()
        painter.setWorldTransform(QTransform())
        painter.drawPixmap(offset, QPixmap.fromImage(img))


class AerialObject(QObject):

    __timerId: Optional[int] = None

    def __init__(self, scene: 'map_scene.MapScene', posScene: QPointF, imgId: str, meta, db: sqlite3.Connection):
        super().__init__()
        point = AerialPoint()
        image = AerialImage(imgId, posScene, meta, point, db, self)
        self.__point: Final = weakref.ref(point)
        self.image: Final = weakref.ref(image)
        point.setImage(image)
        image.setVisible(False)
        scene.contrastEnhancementChanged.connect(image.setContrastEnhancement)
        scene.visualizationChanged.connect(self.__setVisualization)
        scene.highlightAerials.connect(self.__highlight)
        toolTip = [f'<tr><td>{name}</td><td>{value}</td></tr>' for name, value in meta._asdict().items()]
        toolTip = ''.join(['<table>'] + toolTip + ['</table>'])
        for el in point, image:
            el.setToolTip(toolTip)
            effect = InversionEffect()
            effect.setEnabled(False)
            el.setGraphicsEffect(effect)
            # Add the items to the scene only now, such that they have not emitted scene signals during their setup.
            scene.addItem(el)

    def timerEvent(self, event) -> None:
        for item in (self.image(), self.__point()):
            if item:
                if effect := item.graphicsEffect():
                    effect.setEnabled(not effect.isEnabled())

    # end of overrides

    def isAnimated(self) -> bool:
        return self.__timerId is not None

    @pyqtSlot(dict, dict, set)
    def __setVisualization(self, usages: dict[Usage, bool], visualizations: dict[Availability, Visualization], filteredImageIds: set[str]):
        if image := self.image():
            usageIsOn = usages.get(image.usage())
            visualization = visualizations.get(image.availability())
            if usageIsOn is None or visualization is None:
                return
            isFiltered = not filteredImageIds or image.id() in filteredImageIds
            image.setVisible(visualization == Visualization.asImage and usageIsOn and isFiltered)
            if point := self.__point():
                point.setVisible(visualization == Visualization.asPoint and usageIsOn and isFiltered)

    @pyqtSlot(set)
    def __highlight(self, imgIds) -> None:
        image = self.image()
        if image and image.id() in imgIds:
            # animate
            if self.__timerId is None:
                self.__timerId = self.startTimer(500)
                self.__updateZValues()
        else:
            # stop animation
            if self.__timerId is not None:
                self.killTimer(self.__timerId)
                self.__timerId = None
                for item in (image, self.__point()):
                    if item:
                        if effect := item.graphicsEffect():
                            effect.setEnabled(False)
                self.__updateZValues()

    def __updateZValues(self) -> None:
        if image := self.image():
            usage = image.usage()
            updateZValue(image, usage)
            if point := self.__point():
                updateZValue(point, usage)


class AerialPoint(QGraphicsEllipseItem):

    def __init__(self, radius: float = 7):
        super().__init__(-radius, -radius, radius * 2, radius * 2)
        self.setFlag(QGraphicsItem.ItemIgnoresTransformations)
        self.setFlag(QGraphicsItem.ItemIsFocusable)
        self.setCursor(Qt.PointingHandCursor)
        self.setCacheMode(QGraphicsItem.DeviceCoordinateCache)
        self.__transformState = TransformState.original
        self.__cross: Final = _makeOverlay('cross', self)
        self.__tick: Final = _makeOverlay('tick', self)
        self.__image: Optional[weakref.ref] = None

    def mouseDoubleClickEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.LeftButton:
            self.setVisible(False)
            if image := self.image():
                image.setVisible(True)
                image.setFocus(Qt.OtherFocusReason)
        else:
            super().mouseDoubleClickEvent(event)

    def sceneEvent(self, event: QEvent) -> bool:
        if event.type() != QEvent.WhatsThis:
            return super().sceneEvent(event)
        whatsThis = 'An aerial image shown as point. Double-click to open.'
        QWhatsThis.showText(cast(QHelpEvent, event).globalPos(), whatsThis)
        return True

    def focusInEvent(self, event: QFocusEvent) -> None:
        self.__setPen()
        if image := self.image():
            updateZValue(self, image.usage())
        super().focusInEvent(event)

    def focusOutEvent(self, event: QFocusEvent) -> None:
        self.__setPen()
        if image := self.image():
            updateZValue(self, image.usage())
        super().focusOutEvent(event)

    # end of overrides

    def setImage(self, image: 'AerialImage') -> None:
        self.__image = weakref.ref(image)
        self.setAvailability(image.availability())
        self.setUsage(image.usage())
        self.setTransformState(image.transformState())

    def image(self) -> Optional['AerialImage']:
        if self.__image is not None:
            return self.__image()

    def setAvailability(self, availability: Availability) -> None:
        self.setBrush(QBrush(availability.color))

    def setUsage(self, usage: Usage) -> None:
        updateZValue(self, usage)
        self.__cross.setVisible(usage == Usage.discarded)
        self.__tick.setVisible(usage == Usage.selected)

    def setTransformState(self, transformState: TransformState) -> None:
        self.__transformState = transformState
        self.__setPen()

    def __setPen(self) -> None:
        self.setPen(QPen(Qt.black, 2 if self.hasFocus() else 1, self.__transformState.penStyle))


class AerialImage(QGraphicsPixmapItem):

    __pixMapWidth: Final = 1000

    __rotateCursor: Final = QCursor(QPixmap(':/plugins/image_selection/rotate'))

    __transparencyCursor: Final = QCursor(QPixmap(':/plugins/image_selection/eye'))

    __threadPool: Optional[futures.ThreadPoolExecutor] = None

    # To be set beforehand by the scene:

    imageRootDir: Path

    previewRootDir: Path

    @staticmethod
    def createTables(db: sqlite3.Connection) -> None:
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
                id TEXT PRIMARY KEY NOT NULL,
                usage INT NOT NULL REFERENCES usages(id),
                scenePos TEXT NOT NULL,
                trafo TEXT NOT NULL,
                path TEXT,
                previewRect TEXT,
                meta TEXT NOT NULL
            ) ''')

    @staticmethod
    def unload():
        if __class__.__threadPool is not None:
            __class__.__threadPool.shutdown(wait=False, cancel_futures=True)

    def __init__(self, imgId: str, pos: QPointF, meta, point: AerialPoint, db: sqlite3.Connection, obj: AerialObject):
        super().__init__()
        self.setFlag(QGraphicsItem.ItemIsMovable)
        self.setFlag(QGraphicsItem.ItemIsFocusable)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges)
        self.setShapeMode(QGraphicsPixmapItem.BoundingRectShape)
        self.setTransformationMode(Qt.SmoothTransformation)
        self.__origPos: Final = pos
        self.__radiusBild: Final[float] = meta.Radius_Bild
        self.__point: Final = point
        self.__opacity: float = 1.
        self.__requestedPixMapParams: Optional[tuple[str, QRect, int, ContrastEnhancement]]  = None
        self.__currentContrast: ContrastEnhancement = ContrastEnhancement.clahe if claheAvailable else ContrastEnhancement.histogram
        self.__futurePixmap: Optional[futures.Future] = None
        self.__futurePixmapLock: Final = threading.Lock()
        self.__lastRequestedFuture: Optional[futures.Future] = None
        self.__lastRequestedFutureLock: Final = threading.Lock()
        self.__db: Final = db
        self.object: Final = obj
        self.__id: Final = imgId
        self.__availability: Optional[Availability] = None
        self.__cross: Final = _makeOverlay('cross', self, QGraphicsItem.ItemIgnoresTransformations)
        self.__tick: Final = _makeOverlay('tick', self, QGraphicsItem.ItemIgnoresTransformations)

        if row := db.execute('SELECT usage, scenePos, trafo FROM aerials WHERE id == ?', [imgId]).fetchone():
            usage = Usage(row[0])
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

            path = __class__.imageRootDir / imgId
            db.execute(
                'INSERT INTO aerials (id, usage, scenePos, trafo, path, meta) VALUES(?, ?, ?, ?, ?, ?)',
                [imgId,
                 Usage.unset,
                 json.dumps([pos.x(), pos.y()]),
                 json.dumps(np.eye(3).ravel().tolist()),
                 str(path) if path.exists() else None,
                 json.dumps(meta._asdict(), default=toJson)])
            usage = Usage.unset
            self.__resetTransform()
            self.__setTransformState(TransformState.original)
        self.__deriveAvailability()
        self.__setUsage(usage)
        self.__setPixMap()

    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, v):
        if change == QGraphicsItem.ItemVisibleHasChanged:
            if v:
                self.__requestPixMap()

        elif change == QGraphicsItem.ItemPositionHasChanged:
            self.__point.setPos(v)
            self.__db.execute(
                'UPDATE aerials SET scenePos = ? WHERE id == ?',
                [json.dumps([v.x(), v.y()]), self.__id])
            if scene := self.scene():
                scene.aerialFootPrintChanged.emit(self.__id, self.footprint())
            self.__setTransformState(TransformState.changed)

        elif change == QGraphicsItem.ItemTransformHasChanged:
            self.__db.execute(
                'UPDATE aerials SET trafo = ? WHERE id == ?',
                [json.dumps([
                    v.m11(), v.m12(), v.m13(),
                    v.m21(), v.m22(), v.m23(),
                    v.m31(), v.m32(), v.m33()]), self.__id])
            if scene := self.scene():
                scene.aerialFootPrintChanged.emit(self.__id, self.footprint())
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
        pos = event.pos()  # in units of image pixels; ignores self.offset() i.e. (0, 0) is the image center.
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
        QWhatsThis.showText(cast(QHelpEvent, event).globalPos(), whatsThis)
        return True

    def focusInEvent(self, event: QFocusEvent) -> None:
        updateZValue(self, self.usage())
        super().focusInEvent(event)

    def focusOutEvent(self, event: QFocusEvent) -> None:
        updateZValue(self, self.usage())
        super().focusOutEvent(event)

    def contextMenuEvent(self, event: QGraphicsSceneContextMenuEvent) -> None:
        menu = QMenu('menu')
        menu.setToolTipsVisible(True)
        if self.__availability in (Availability.findPreview, Availability.preview):
            menu.addAction(QIcon(':/plugins/image_selection/image-crop'), 'Find preview', lambda: self.__findPreview())
        menu.addSection('Usage')
        usage = self.usage()
        if usage != Usage.unset:
            menu.addAction(QIcon(':/plugins/image_selection/selection'),
                           'Unset', lambda: self.__setUsage(Usage.unset))
        if usage != Usage.selected:
            menu.addAction(QIcon(':/plugins/image_selection/tick'),
                           'Select', lambda: self.__setUsage(Usage.selected))
        if usage != Usage.discarded:
            menu.addAction(QIcon(':/plugins/image_selection/cross'),
                           'Discard', lambda: self.__setUsage(Usage.discarded))
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
            self.__setPixMap(pm)
        super().paint(painter, option, widget)
        painter.save()
        # Qt 5.15 docs for QGraphicsItem::paint say:
        #   "QGraphicsItem does not support use of cosmetic pens with a non-zero width."
        # But obviously, it does support them, at least on Windows.
        width = 2 if option.state & QStyle.State_HasFocus else 1
        assert self.__availability is not None
        pen = QPen(self.__availability.color, width, self.__transformState.penStyle)
        pen.setCosmetic(True)
        painter.setPen(pen)
        painter.drawRect(self.boundingRect())
        painter.restore()

    def scene(self) -> 'map_scene.MapScene':
        return cast(map_scene.MapScene, super().scene())

    # end of overrides

    def __setPixMap(self, pm: Optional[QPixmap] = None):
        if pm is None:
            pixMapWidth = __class__.__pixMapWidth
            path, previewRect = self.__db.execute('SELECT path, previewRect FROM aerials WHERE id == ?',
                                                  [self.__id]).fetchone()
            if previewRect:
                width, height, rotation = json.loads(previewRect)[2:]
                if rotation % 2:
                    width, height = height, width
            elif path:
                with GdalPushLogHandler():
                    ds = gdal.Open(path)
                    width, height = ds.RasterXSize, ds.RasterYSize
            else:
                width, height = [pixMapWidth] * 2
            pm = QBitmap(pixMapWidth, _pixMapHeightFor(pixMapWidth, QSize(width, height)))
            pm.fill(Qt.color1)
        origPm = self.pixmap()
        self.setPixmap(pm)
        self.setOffset(-pm.width() / 2, -pm.height() / 2)
        if origPm.size() != pm.size():
            if scene := self.scene():
                scene.aerialFootPrintChanged.emit(self.__id, self.footprint())

    def __requestPixMap(self):
        path, previewRect = self.__db.execute('SELECT path, previewRect FROM aerials WHERE id == ?',
                                              [self.__id]).fetchone()
        if previewRect is None:
            rotationCcw = 0
            previewRect = QRect()
        else:
            *rect, rotationCcw = json.loads(previewRect)
            previewRect = QRect(*rect)
        if self.__availability in (Availability.preview, Availability.image):
            if not self.__requestedPixMapParams or self.__requestedPixMapParams != (path, previewRect, rotationCcw, self.__currentContrast):
                if __class__.__threadPool is None:
                    __class__.__threadPool = futures.ThreadPoolExecutor(thread_name_prefix='AerialReader')
                future = __class__.__threadPool.submit(_getPixMap, Path(path), __class__.__pixMapWidth,
                                                       previewRect, rotationCcw, self.__currentContrast)
                future.add_done_callback(self.__pixMapReady)
                with self.__lastRequestedFutureLock:
                    if self.__lastRequestedFuture:
                        self.__lastRequestedFuture.cancel()
                    self.__lastRequestedFuture = future
        self.__requestedPixMapParams = path, previewRect, rotationCcw, self.__currentContrast

    def __pixMapReady(self, future: futures.Future) -> None:
         # This is called from a worker thread.
        with self.__lastRequestedFutureLock:
            if self.__lastRequestedFuture is not future:
                # Another pixmap has been requested after this one.
                # Still, this one has been received after the other one.
                # This is possible only if they were computed in different worker threads of the pool,
                # and it is more probable if the computation of this pixmap has been more elaborate.
                return
        with self.__futurePixmapLock:
            self.__futurePixmap = future
        self.update()

    def setContrastEnhancement(self, contrast: ContrastEnhancement):
        self.__currentContrast = contrast
        if self.isVisible():
            self.__requestPixMap()

    def availability(self) -> Availability:
        assert self.__availability is not None
        return self.__availability

    def __deriveAvailability(self) -> None:
        path, rect = self.__db.execute('SELECT path, previewRect FROM aerials WHERE id == ?', [self.__id]).fetchone()
        if path is None:
            filmDir = self.previewRootDir / Path(self.__id).parent
            availability = Availability.findPreview if filmDir.exists() else Availability.missing
        else:
            availability = Availability.image if rect is None else Availability.preview
        self.setFlag(QGraphicsItem.ItemIsMovable, availability >= Availability.preview)
        if self.__availability != availability:
            if scene := self.scene():
                scene.aerialAvailabilityChanged.emit(self.__id, int(availability), path or '')
        self.__availability = availability
        self.__point.setAvailability(availability)

    def usage(self) -> Usage:
        value, = self.__db.execute(
            'SELECT usage FROM aerials WHERE id == ?',
            [self.__id]).fetchone()
        return Usage(value)

    def __setUsage(self, usage: Usage) -> None:
        updateZValue(self, usage)
        self.__cross.setVisible(usage == Usage.discarded)
        self.__tick.setVisible(usage == Usage.selected)
        self.__point.setUsage(usage)
        if scene := self.scene():
            scene.aerialUsageChanged.emit(self.__id, int(usage))
        self.__db.execute(
            'UPDATE aerials SET usage = ? WHERE id == ?',
            [usage, self.__id])

    def transformState(self) -> TransformState:
        return self.__transformState

    def __setTransformState(self, transformState: TransformState) -> None:
        self.__transformState = transformState
        self.__point.setTransformState(transformState)

    def __originalTransform(self) -> QTransform:
        scale = self.__radiusBild / (__class__.__pixMapWidth / 2)
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
        filmDir = self.previewRootDir / Path(self.__id).parent
        dialog = PreviewWindow(filmDir, Path(self.__id).stem)
        if dialog.exec() == QDialog.Accepted:
            path, rect, viewRotationCcw = dialog.selection()
            self.__db.execute(
                'UPDATE aerials SET path = ?, previewRect = ? WHERE id == ?',
                [str(path),
                 json.dumps([rect.left(), rect.top(), rect.width(), rect.height(), viewRotationCcw]),
                 self.__id])
            self.__deriveAvailability()
            self.__requestPixMap()

    def id(self):
        return self.__id

    def footprint(self):
        # CS QGraphicsScene -> WCS: invert y-coordinate
        return [{'x': pt.x(), 'y': -pt.y()} for pt in self.mapToScene(self.boundingRect())[:-1]]


def _pixMapHeightFor(width: int, size: QSize) -> int:
    return round(size.height() / size.width() * width)

def _getPixMap(path: Path, width: int, rect: QRect, rotationCcw: int, contrast: ContrastEnhancement):
    with GdalPushLogHandler():
        ds = gdal.Open(str(path))
        if rect.isNull():
            rect = QRect(0, 0, ds.RasterXSize, ds.RasterYSize)
        height = _pixMapHeightFor(width, rect.size())
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
    if rotationCcw != 0:
        #arr = np.ndarray(shape=(img.height(), img.width(), 4), dtype=np.uint8, buffer=ptr)
        #rotated = np.rot90(arr, k=rotationCcw)
        #linear = arr.reshape(-1)
        #linear[:] = rotated.reshape(-1)
        # Cannot reshape a (rectangular) QImage ...
        # So use QImage directly:
        # "Rotates the coordinate system counterclockwise by the given angle. The angle is specified in degrees."
        img = img.transformed(QTransform().rotate(-90 * rotationCcw))
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


"""
Rules for z-stacking, with decreasing priority:
- display the focus item and animated items above non-animated ones (there is at most one focused item at a time).
- display images above points.
- selected -> unset -> discarded items.
- available -> preview selected -> preview available -> missing
"""
def updateZValue(item: Union[AerialImage, AerialPoint], usage: Usage) -> None:
    isImage = isinstance(item, AerialImage)
    image = item if isImage else item.image()
    if image:
        object = image.object
        availability = image.availability()
    else:
        object = None
        availability = Availability.missing
    if item.hasFocus() or object and object.isAnimated():
        level = 2
    else:
        level = int(isImage)
    nextAvailability = max(Availability) + 1
    nextUsage = max(Usage) + 1
    item.setZValue(nextUsage * nextAvailability * level + nextAvailability * usage + availability)
