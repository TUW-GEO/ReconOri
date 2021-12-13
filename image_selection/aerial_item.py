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

from qgis.PyQt.QtCore import QEvent, QObject, QPointF, Qt
from qgis.PyQt.QtGui import QBrush, QCursor, QFocusEvent, QImage, QKeyEvent, QPen, QPainter, QPixmap, QTransform
from qgis.PyQt.QtWidgets import (QGraphicsDropShadowEffect, QGraphicsEffect, QGraphicsEllipseItem, QGraphicsItem, QMenu,
                                 QGraphicsPixmapItem, QGraphicsScene, QGraphicsSceneContextMenuEvent, QGraphicsSceneMouseEvent,
                                 QGraphicsSceneWheelEvent, QStyle, QStyleOptionGraphicsItem, QWhatsThis, QWidget)

import numpy as np
from osgeo import gdal

import concurrent.futures
import enum
import json
import logging
from pathlib import Path
import sqlite3
import threading
from typing import Any, Optional, Union

from . import gdalPushLogHandler, gdalPopLogHandler

logger = logging.getLogger(__name__)

class Status(enum.IntEnum):
    missing = enum.auto()
    available = enum.auto()
    selected = enum.auto()


class Visualization(enum.Enum):
    none = enum.auto()
    asPoint = enum.auto()
    asImage = enum.auto()

class ContrastStretching(enum.Enum):
    none = enum.auto()
    minMax = enum.auto()
    histogram = enum.auto()


colorFromStatus = {
    Status.missing: Qt.red,
    Status.available: Qt.yellow,
    Status.selected: Qt.green
}


class Aerial(QObject):

    def __init__(self, scene: QGraphicsScene, posScene: QPointF, imgPath: Path, data, db: sqlite3.Connection, imgId: str):
        super().__init__()
        point = AerialPoint(self)
        image = AerialImage(imgPath, posScene, data.Radius_Bild, point, db, imgId)
        point.setImage(image)
        image.setVisible(False)
        scene.contrastStretch.connect(image.setContrastStretch)

        if image.status() > Status.missing:
            point.setZValue(1)
            image.setZValue(2)

        for el in point, image:
            el.setToolTip('\n'.join('\t'.join((name, str(value))) for name, value in data._asdict().items()))
            scene.addItem(el)

        self.__image = image
        self.__point = point

        scene.visualizationByStatus.connect(self.setVisualizationByStatus, Qt.QueuedConnection)


    def setVisualizationByStatus(self, status: Status, visualization: Visualization) -> None:
        if self.__image.status() == status:
            self.__point.setVisible(visualization == Visualization.asPoint)
            self.__image.setVisible(visualization == Visualization.asImage)


class AerialPoint(QGraphicsEllipseItem):

    def __init__(self, keepMeAlive, radius: float = 5):
        super().__init__(-radius, -radius, radius * 2, radius * 2)
        self.setFlag(QGraphicsItem.ItemIgnoresTransformations)
        self.setCursor(Qt.PointingHandCursor)
        self.setCacheMode(QGraphicsItem.DeviceCoordinateCache)
        #self.setAcceptedMouseButtons(Qt.LeftButton)
        self.__keepMeAlive = keepMeAlive


    def setImage(self, image: 'AerialImage') -> None:
        self.__image = image
        self.setStatus(image.status())


    def setStatus(self, status: Status) -> None:
        self.setBrush(QBrush(colorFromStatus[status]))


    def mouseDoubleClickEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.LeftButton:
            assert self.isVisible()  # only visible items receive events.
            self.setVisible(False)
            self.__image.setVisible(True)
        else:
            super().mouseDoubleClickEvent(event)


    def sceneEvent(self, event: QEvent) -> bool:
        if event.type() != QEvent.WhatsThis:
            return super().sceneEvent(event)
        whatsThis = 'An aerial image shown as point. Double-click to open.'
        QWhatsThis.showText(event.globalPos(), whatsThis)
        return True


def _missingAerialPixMap(size: int) -> QPixmap:
    img = QImage(size, size, QImage.Format_RGBA8888)
    img.fill(Qt.gray)
    return QPixmap.fromImage(img)


# def _focusEffect() -> QGraphicsEffect:
#     focusEffect = QGraphicsDropShadowEffect()
#     focusEffect.setOffset(0)
#     focusEffect.setBlurRadius(20.)
#     return focusEffect


class AerialImage(QGraphicsPixmapItem):

    __missingPixMap = _missingAerialPixMap(1000)

    __rotateCursor = QCursor(QPixmap(':/plugins/image_selection/rotate.png'))

    __transparencyCursor = QCursor(QPixmap(':/plugins/image_selection/eye.png'))

    __threadPool: Optional[concurrent.futures.ThreadPoolExecutor] = None

    # __focusEffect: QGraphicsEffect = _focusEffect()


    @staticmethod
    def unload():
        if __class__.__threadPool is not None:
            __class__.__threadPool.shutdown(wait=False, cancel_futures=True)


    def __init__(self, imgPath: Path, pos: QPointF, radiusBild: float, point: AerialPoint, db: sqlite3.Connection, imgId: str):
        super().__init__()
        self.setFlag(QGraphicsItem.ItemIsMovable)
        self.setFlag(QGraphicsItem.ItemIsFocusable)
        self.setFlag(QGraphicsItem.ItemSendsGeometryChanges)
        self.setShapeMode(QGraphicsPixmapItem.BoundingRectShape)
        # QGraphicsPixmapItem's transformationMode seems to override QPainter's render hint of SmoothPixmapTransform
        self.setTransformationMode(Qt.SmoothTransformation)            
        self.__imgPath = imgPath
        self.__origPos = pos
        self.__status = Status.available if imgPath.exists() else Status.missing
        self.__radiusBild = radiusBild
        self.__point = point
        self.__opacity = 1.
        self.__zValue = 0
        self.__loadedContrastStretch: Optional[ContrastStretching] = None
        self.__currentContrastStretch = ContrastStretching.histogram
        self.__futurePixmap: Optional[concurrent.futures.Future] = None
        self.__futurePixmapLock = threading.Lock()
        self.__db = db
        self.__imgId = imgId
        db.execute('''CREATE TABLE IF NOT EXISTS aerials(imgFn TEXT PRIMARY KEY NOT NULL,
                                                         status INT NOT NULL CHECK(TYPEOF(status)='integer'),
                                                         scenePos TEXT NOT NULL,
                                                         trafo TEXT NOT NULL)''')
        row = db.execute('SELECT status, scenePos, trafo FROM aerials WHERE imgFn == ?', [imgId] ).fetchone()
        if row is None:
            mat = np.eye(3)
            mat[0, 0] = mat[1, 1] = self.__radiusBild / (__class__.__missingPixMap.width() / 2)
            db.execute(
                'INSERT INTO aerials (imgFn, status, scenePos, trafo) VALUES(?, ?, ?, ?)',
                [imgId, int(self.__status), json.dumps([pos.x(), pos.y()]), json.dumps(mat.ravel().tolist())] )
            self.setPos(pos)
        else:
            self.__setStatus(Status(row[0]))
            self.setPos(QPointF(*json.loads(row[1])))
            self.setTransform(QTransform(*json.loads(row[2])))
            self.setPixmap(self.__missingPixMap)  # make ItemVisibleChange not reset the transform 


    def itemChange(self, change: QGraphicsItem.GraphicsItemChange, v: Any) -> Any:
        if change == QGraphicsItem.ItemVisibleHasChanged:
            if v:
                self.setFocus(Qt.OtherFocusReason)
                firstLoad = self.pixmap().isNull()
                if self.__loadedContrastStretch != self.__currentContrastStretch:
                    self.__loadPixMap()
                    if firstLoad:
                        self.__resetTransform()

        elif change == QGraphicsItem.ItemPositionHasChanged:
            self.__point.setPos(v)
            self.__db.execute(
                'UPDATE aerials SET scenePos = ? WHERE imgFn == ?',
                [json.dumps([v.x(), v.y()]), self.__imgId])

        elif change == QGraphicsItem.ItemTransformHasChanged:
            self.__db.execute(
                'UPDATE aerials SET trafo = ? WHERE imgFn == ?',
                [json.dumps([
                    v.m11(), v.m12(), v.m13(),
                    v.m21(), v.m22(), v.m23(),
                    v.m31(), v.m32(), v.m33()]), self.__imgId])

        return super().itemChange(change, v)


    def mousePressEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.modifiers() & Qt.AltModifier:
            self.__opacity = self.opacity()
            self.setOpacity(0)
        elif event.button() == Qt.LeftButton:
            self.setCursor(Qt.ClosedHandCursor)
        super().mousePressEvent(event)


    def mouseReleaseEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        self.setOpacity(self.__opacity)        
        self.__chooseCursor(event)
        super().mouseReleaseEvent(event)


    def mouseDoubleClickEvent(self, event: QGraphicsSceneMouseEvent) -> None:
        if event.button() == Qt.LeftButton:
            assert self.isVisible()  # only visible items receive events.
            self.setVisible(False)
            self.__point.setVisible(True)
        else:
            super().mouseDoubleClickEvent(event)


    def wheelEvent(self, event: QGraphicsSceneWheelEvent) -> None:
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


    def keyReleaseEvent(self, event: QKeyEvent) -> None:
        # Note: if QMainWindow has a QMenuBar, then only every other release of the Alt key lands here.
        # Qt Designer may set a QMenuBar in .ui
        assert event.isAccepted()
        self.__chooseCursor(event)


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
        self.__zValue = self.zValue()
        self.setZValue(3)
        # Using a graphics effect does not fully work:
        # while the effect is displayed as wanted,
        # calling self.update() in self.__pixMapReady() will no longer call self.paint.
        # Hence, when the pixmap is ready, it will not be shown until some mouse click et al.
        #__class__.__focusEffect.setColor(colorFromStatus[self.__status])
        #self.setGraphicsEffect(__class__.__focusEffect)
        super().focusInEvent(event)


    def focusOutEvent(self, event: QFocusEvent) -> None:
        self.setZValue(self.__zValue)
        super().focusOutEvent(event)


    def contextMenuEvent(self, event: QGraphicsSceneContextMenuEvent) -> None:
        menu = QMenu('menu')
        menu.setToolTipsVisible(True)
        if self.__status != Status.selected:
            menu.addAction('Select', lambda: self.__setStatus(Status.selected))
        else:
            menu.addAction('Unselect', lambda: self.__setStatus(Status.available if self.pixmap().cacheKey() != __class__.__missingPixMap.cacheKey() else Status.missing))
        menu.addAction('Reset transform', self.__resetTransform)
        menu.exec(event.screenPos())


    def paint(self, painter: QPainter, option: QStyleOptionGraphicsItem, widget: Optional[QWidget] = None) -> None:
        pm = None
        with self.__futurePixmapLock:
            if self.__futurePixmap is not None:
                pm = self.__futurePixmap.result()  # Note: result() might raise here, in the wanted thread.
                self.__futurePixmap = None

        if pm is not None:
            self.setPixmap(pm)
            self.setOffset(-pm.width() / 2, -pm.height() / 2)

        super().paint(painter, option, widget)
        painter.save()
        # Qt 5.15 docs for QGraphicsItem::paint say:
        #   QGraphicsItem does not support use of cosmetic pens with a non-zero width.
        # But obviously, it does support them - which is very welcome.
        width = 3 if option.state & QStyle.State_HasFocus else 0
        pen = QPen(colorFromStatus[self.__status], width, Qt.SolidLine)
        pen.setCosmetic(True)
        painter.setPen(pen)
        painter.drawRect(self.boundingRect())
        painter.restore()


    # end of overrides

    def __loadPixMap(self):
        pixMap = self.__missingPixMap
        if self.__status != Status.missing:
            if __class__.__threadPool is None:
                __class__.__threadPool = concurrent.futures.ThreadPoolExecutor(thread_name_prefix='ImageReader')
            future = __class__.__threadPool.submit(_getPixMap, self.__imgPath, pixMap.width(), self.__currentContrastStretch)
            future.add_done_callback(self.__pixMapReady)

        self.__loadedContrastStretch = self.__currentContrastStretch
        self.setPixmap(pixMap)
        self.setOffset(-pixMap.width() / 2, -pixMap.height() / 2)


    def __pixMapReady(self, future) -> None:
        with self.__futurePixmapLock:
            self.__futurePixmap = future
        self.update()


    def setContrastStretch(self, stretch: ContrastStretching):
        self.__currentContrastStretch = stretch
        if self.__loadedContrastStretch != stretch and self.isVisible():
            self.__loadPixMap()


    def status(self) -> Status:
        return self.__status


    def __setStatus(self, status: Status) -> None:
        self.__status = status
        self.__point.setStatus(status)
        self.__db.execute(
            'UPDATE aerials SET status = ? WHERE imgFn == ?',
            [int(status), self.__imgId])


    def __resetTransform(self):
        pm = self.pixmap()
        scale = self.__radiusBild / (pm.width() / 2)
        self.setTransform(QTransform.fromScale(scale, scale))
        self.setPos(self.__origPos)


    def __chooseCursor(self, event: Union[QKeyEvent, QGraphicsSceneMouseEvent]):
        if event.modifiers() & Qt.AltModifier:
            self.setCursor(self.__transparencyCursor)
        elif event.modifiers() & Qt.ControlModifier:
            self.setCursor(self.__rotateCursor)
        else:
            self.unsetCursor()


def _getPixMap(imgPath: Path, width: int, contrastStretch: ContrastStretching):
    gdalPushLogHandler()
    try:
        ds = gdal.Open(str(imgPath))
        height = round(ds.RasterYSize / ds.RasterXSize * width)
        img = QImage(width, height, QImage.Format_RGBA8888)
        img.fill(Qt.white)
        ptr = img.scanLine(0)
        ptr.setsize(img.sizeInBytes())
        assert ds.RasterCount in (1, 3)
        iBands = [1] * 3 if ds.RasterCount == 1 else [1, 2, 3]
        ds.ReadRaster1(0, 0, ds.RasterXSize, ds.RasterYSize,
                    width, height, gdal.GDT_Byte, iBands,
                    buf_pixel_space=4, buf_line_space=width * 4, buf_band_space=1,
                    resample_alg=gdal.GRIORA_Gauss,
                    inputOutputBuf=ptr)
    finally:
        gdalPopLogHandler()

    if contrastStretch != ContrastStretching.none:
        arr = np.ndarray(shape=(img.height(), img.width(), 4), dtype=np.uint8, buffer=ptr)
        red = arr[:, :, 0]
        if contrastStretch == ContrastStretching.minMax:
            lo, hi = np.percentile(red, [3, 97])
            transformed = np.rint(np.clip((red.astype(float) - lo) / (hi - lo) * 255, 0, 255)).astype(np.uint8)
        else:
            count = np.bincount(red.flat, minlength=256)
            cumsum = np.cumsum(count)
            transfer = np.rint(cumsum * 255 / cumsum[-1]).astype(np.uint8)
            transformed = transfer[red.flat].reshape(red.shape)
        arr[:, :, :3] = transformed[:, :, None]

    return QPixmap.fromImage(img)
