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
 SelORecon
                                 A QGIS plugin
 Guided selection and orientation of aerial reconnaissance images.
                              -------------------
        copyright            : (C) 2021 by Photogrammetry @ GEO, TU Wien, Austria
        email                : wilfried.karel@geo.tuwien.ac.at
 ***************************************************************************/
"""
from __future__ import annotations

from qgis.PyQt.QtCore import Qt, QEvent, QLineF, QPoint, QPointF, QRect, QRectF, pyqtSignal
from qgis.PyQt.QtGui import QBrush, QHelpEvent, QImage, QKeyEvent, QPainter, QPaintEvent, QPen, QWheelEvent
from qgis.PyQt.QtWidgets import QGraphicsView, QGraphicsScene, QMessageBox, QScrollBar
from qgis.PyQt import sip

from collections.abc import Callable
import logging
import math
import threading
import time
from typing import cast, Final
import xml.etree.ElementTree

import numpy as np
from numpy.linalg import det
from osgeo import gdal, osr

from . import Config, GdalPushLogHandler

logger = logging.getLogger(__name__)


class NoWheelScrollBar(QScrollBar):

    def wheelEvent(self, event: QWheelEvent) -> None:
        event.ignore()


class MapView(QGraphicsView):

    reportResponseTime = pyqtSignal(float)

    newImage = pyqtSignal()

    isReading = pyqtSignal(bool)

    datasetResolution = pyqtSignal(float)

    def __init__(self, *args, **kwargs) -> None:
        super().__init__(*args, **kwargs)

        # Overload QGraphicsView.wheelEvent to support zooming with the mouse wheel.
        # To still provide to graphics items the option to handle wheel events themselves,
        # MapView.wheelEvent must pass wheel events first to its scene.
        # The only way to pass events to the scene here seems to be
        # to call the respective base class methods.
        # QGraphicsView.wheelEvent first passes a wheel event to its scene.
        # If the scene ignores it, then it passes the event to its scroll bars,
        # and there seems to be no way to stop QScrollBar from accepting wheel events
        # seems to be to subclass it.
        # Otherwise, QGraphicsView.wheelEvent would accept all wheel events in the end.
        self.setHorizontalScrollBar(NoWheelScrollBar(Qt.Horizontal, self))
        self.setVerticalScrollBar(NoWheelScrollBar(Qt.Vertical, self))

        self.setVerticalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)
        self.setCacheMode(QGraphicsView.CacheBackground)
        self.setDragMode(QGraphicsView.ScrollHandDrag)
        self.setRenderHints(QPainter.Antialiasing | QPainter.TextAntialiasing | QPainter.SmoothPixmapTransform)
        self.setResizeAnchor(QGraphicsView.AnchorViewCenter)
        self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)
        self.setBackgroundBrush(QBrush(Qt.gray))
        self.setWhatsThis('''
<h4>Map navigation</h4>
<ul>
  <li>
    By mouse:
    <ul>
      <li>Left-click and drag somewhere on the map to pan.</li>
      <li>Use mouse wheel to zoom.</li>
    </ul>
  </li>
  <li>
    By keys:
    <ul>
      <li>Use arrow keys to pan.</li>
      <li>Use <b>+</b> and <b>-</b> to zoom.</li>
    </ul>
  </li>
</ul>''')

        self.epsg: int | None = None  # How to set this in __init__ via ui.setupUi?
        self.__readThread = None
        self.__mapLock = threading.Lock()
        self.__sceneRectAndImg = None
        self.__mapResolution = -1.

    def resizeEvent(self, event) -> None:
        # Also called upon (first) show. Calling this in 'load' does not help, because the viewport size has not been adapted yet.
        self.zoom(0)
        super().resizeEvent(event)

    # def drawForeground(self, painter: QPainter, rect: QRectF):
    #     rect = self.mapToScene(self.viewport().rect()).boundingRect()
    #     ctr = rect.center()
    #     leftCtr = QPointF(rect.left(), ctr.y())
    #     rightCtr = QPointF(rect.right(), ctr.y())
    #     lineHorF = QLineF(leftCtr, rightCtr)
    #     topCtr = QPointF(ctr.x(), rect.top())
    #     botCtr = QPointF(ctr.x(), rect.bottom())
    #     lineVerF = QLineF(topCtr, botCtr)
    #     pen = QPen(Qt.red)
    #     pen.setWidth(0)
    #     painter.setPen(pen)
    #     painter.drawLine(lineHorF)
    #     painter.drawLine(lineVerF)
    #     #for radius in (9.5, 11.5):  # Flughafen
    #     for radius in (45,):  # Hauptkläranlage Wien
    #         painter.drawEllipse(ctr, radius, radius)

    def drawBackground(self, painter: QPainter, sceneRect: QRectF) -> None:
        super().drawBackground(painter, sceneRect)
        with self.__mapLock:
            sceneRectAndImg = self.__sceneRectAndImg
        if sceneRectAndImg is not None:
            painter.drawImage(*sceneRectAndImg)

    def paintEvent(self, event: QPaintEvent) -> None:
        if self.__readThread is not None:
            rect: QRect = self.viewport().rect()
            mW, mH = (el // 2 for el in (rect.width(), rect.height()))
            rect.adjust(-mW, -mH, mW, mH)
            # Note: exposedSceneRect may partially lie outside the scene limits, even without rect.adjust
            exposedSceneRect: QRectF = self.mapToScene(rect).boundingRect()
            pxPerMeter = self.transform().determinant() ** .5
            exposedWcsRect = QRectF(exposedSceneRect.left(), -exposedSceneRect.top(),
                                    exposedSceneRect.width(), -exposedSceneRect.height())
            self.__readThread.requestImage(exposedWcsRect, pxPerMeter)
        super().paintEvent(event)

    def keyPressEvent(self, event: QKeyEvent) -> None:
        super().keyPressEvent(event)
        if event.isAccepted():
            return
        if event.key() == Qt.Key_Plus:
            self.zoom(1, False)
        elif event.key() == Qt.Key_Minus:
            self.zoom(-1, False)

    def wheelEvent(self, event: QWheelEvent) -> None:
        super().wheelEvent(event)
        if event.isAccepted():
            return
        numDegrees = event.angleDelta()
        numSteps = math.ceil(float(numDegrees.y()) / 8. / 15.)
        self.zoom(numSteps)

    def viewportEvent(self, event: QEvent) -> bool:
        if event.type() == QEvent.WhatsThis:
            for item in self.items(cast(QHelpEvent, event).pos()):
                if self.scene().sendEvent(item, event):
                    return True

        return super().viewportEvent(event)

    # end of overrides

    def load(self, datasetPath: str) -> None:
        self.unload()
        self.__readThread = MapReadThread(datasetPath, self.receiveImage,
                                          self.reportResponseTime.emit, self.isReading.emit)
        dataCs = osr.SpatialReference(self.__readThread.dataset.GetProjection())
        sceneCs = osr.SpatialReference()
        sceneCs.ImportFromEPSG(self.epsg)
        if not dataCs.IsSame(sceneCs, []):  # we really don't want to re-project images. Returns 1 for 3857 and 900913
            raise Exception('Dataset coordinate reference system (EPSG:{}) does not match the one of the scene (EPSG:{})'.format(
                dataCs.GetAuthorityCode('PROJCS'), self.epsg))
        self.__mapResolution = self.__readThread.mapResolution
        self.datasetResolution.emit(self.__mapResolution)

        wcsFromPx = self.__readThread.dataset.GetGeoTransform()
        wcsLeftTop = QPointF(*gdal.ApplyGeoTransform(wcsFromPx, 0., 0.))
        wcsRightBot = QPointF(*gdal.ApplyGeoTransform(wcsFromPx,
                              self.__readThread.dataset.RasterXSize, self.__readThread.dataset.RasterYSize))
        wcsRect = QRectF(wcsLeftTop, wcsRightBot)
        sceneRectF = QRectF(wcsRect.x(), -wcsRect.y(), wcsRect.width(), -wcsRect.height())

        # terrestris.de reports extents far north of the north pole, and far south of the south pole.
        # Zooming that far out would result in integer overflow.
        # Hence, limit the scene rectangle by the bounding rectangle of the scene CRS.
        wgs84geog = osr.SpatialReference()
        wgs84geog.ImportFromEPSG(4326)
        areaOfUse = sceneCs.GetAreaOfUse()
        wgs2wcs = osr.CoordinateTransformation(wgs84geog, sceneCs)
        leftTop = wgs2wcs.TransformPoint(areaOfUse.north_lat_degree, areaOfUse.west_lon_degree)
        rightBot = wgs2wcs.TransformPoint(areaOfUse.south_lat_degree, areaOfUse.east_lon_degree)
        wcsBWin = QRectF(QPointF(*leftTop[:2]), QPointF(*rightBot[:2]))
        sceneRectF &= QRectF(wcsBWin.x(), -wcsBWin.y(), wcsBWin.width(), -wcsBWin.height())

        self.setSceneRect(sceneRectF)
        if not self.mapToScene(self.viewport().rect()).boundingRect().intersects(sceneRectF):
            self.ensureVisible(sceneRectF, 0, 0)

        with self.__mapLock:
            self.__sceneRectAndImg = None

        self.__readThread.start()
        assert self.__readThread.is_alive()
        #self.invalidateScene(self.scene().sceneRect(), QGraphicsScene.BackgroundLayer)
        self.resetCachedContent()
        # self.zoom(0) # dataset resolution may have changed -> maybe zoom out.

        itemsBoundingRect = self.scene().itemsBoundingRect()
        if not itemsBoundingRect.isNull() and not sceneRectF.contains(itemsBoundingRect):
            QMessageBox.warning(self, 'Items outside map',
                                "Items lie outside of map's bounding rectangle and will become invisible.<br/>"
                                'Choose a different map with larger coverage to view them, again.')

    def unload(self):
        if self.__readThread is not None:
            self.__readThread.stop()

    def receiveImage(self, img: QImage, wcsRect: QRectF) -> None:
        self.newImage.emit()
        sceneRectF = QRectF(wcsRect.x(), -wcsRect.y(), wcsRect.width(), -wcsRect.height())
        with self.__mapLock:
            self.__sceneRectAndImg = sceneRectF, img
        self.invalidateScene(sceneRectF, QGraphicsScene.BackgroundLayer)

    def zoom(self, numSteps: int | None, underMouse: bool = True) -> None:
        currScale = self.viewportTransform().determinant() ** .5
        currExp = math.log2(currScale * self.__mapResolution)
        if numSteps is not None:
            wantedScale = 2 ** (round(currExp) + numSteps) / self.__mapResolution
        else:
            wantedScale = 1 / self.__mapResolution

        maxScale = 4. / self.__mapResolution

        sceneRect = self.sceneRect()
        viewportRect = self.viewport().rect()
        minScale = min(
            viewportRect.width() / sceneRect.width(),
            viewportRect.height() / sceneRect.height())

        wantedScale = min(maxScale, max(minScale, wantedScale))

        factor = wantedScale / currScale

        if not underMouse:
            self.setTransformationAnchor(QGraphicsView.AnchorViewCenter)
        try:
            self.scale(factor, factor)
        finally:
            if not underMouse:
                self.setTransformationAnchor(QGraphicsView.AnchorUnderMouse)


class MapReadThread(threading.Thread):

    def __init__(self, datasetPath: str,
                 cbImageRead: Callable[[QImage, QRectF], None],
                 cbResponseTime: Callable[[float], None],
                 cbIsReading: Callable[[bool], None]) -> None:
        super().__init__(daemon=True, name='MapRead')
        logger.debug(f'Open {datasetPath}')
        with GdalPushLogHandler():
            self.dataset = gdal.Open(datasetPath)
            if self.dataset.GetDriver().ShortName == 'WMS':
                # Make WMS also use the file cache.
                # Unlike with WMTS, it seems difficult to guess the right XML without opening the dataset first. Do so on demand only.
                text = self.dataset.GetMetadataItem('XML', 'WMS')
                root = xml.etree.ElementTree.fromstring(text)
                cache = root.find('Cache')
                timeout = root.find('Timeout')
                if not all((cache, timeout)):
                    if cache is None:
                        xml.etree.ElementTree.SubElement(root, 'Cache')
                    if timeout is None:
                        elem = xml.etree.ElementTree.SubElement(root, 'Timeout')
                        elem.text = str(Config.httpTimeoutSeconds.value)
                    self.dataset = gdal.Open(xml.etree.ElementTree.tostring(root, encoding='unicode'))

        geoTrafo = np.array(self.dataset.GetGeoTransform()).reshape((2, 3))
        self.mapResolution: Final = np.abs(det(geoTrafo[:, 1:])) ** .5
        self.__stop: Final = threading.Event()
        self.__cbImageRead: Final = cbImageRead
        self.__cbResponseTime: Final = cbResponseTime
        self.__cbIsReading: Final = cbIsReading
        self.__jobCondition: Final = threading.Condition(threading.Lock())
        self.__job = QRectF(), -1.
        self.__exc = None
        assert self.dataset.RasterCount in (3, 4)
        assert all(self.dataset.GetRasterBand(idx + 1).DataType == gdal.GDT_Byte
                   for idx in range(self.dataset.RasterCount))

    def requestImage(self, wcsRect: QRectF, pxPerMeter: float) -> None:
        with self.__jobCondition:
            if self.__exc is not None:
                raise Exception(f'Error in thread {self.name}') from self.__exc
            if not self.is_alive():
                raise Exception(f'Thread {self.name} is dead.')
            self.__job = wcsRect, pxPerMeter
            self.__jobCondition.notify()

    def stop(self) -> None:
        if self.is_alive():
            logger.debug(f'Stopping thread {self.name} ...')
            self.__stop.set()
            with self.__jobCondition:
                self.__jobCondition.notify()
            self.join(timeout=10)  # [s]
            if self.is_alive():
                logger.warning(f'Failed to stop thread {self.name} within 10s.')
            else:
                logger.debug(f'Thread {self.name} stopped.')

        with self.__jobCondition:
            if self.__exc is not None:
                raise Exception(f'Error in thread {self.name}') from self.__exc

    def run(self) -> None:
        with GdalPushLogHandler():
            try:
                self.__run()
            except Exception as oops:
                with self.__jobCondition:
                    self.__exc = oops

        self.__cbIsReading(False)

    def __run(self) -> None:
        # gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_LIMIT', '1024')  # bytes per second
        # gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_TIME', '1')  # seconds
        # gdal.SetCacheMax(0)

        # Initial element values of self.__job:
        wcsRect = QRectF()
        viewPxPerMeter = -1.

        wcsFromPx = self.dataset.GetGeoTransform()
        pxFromWcs = gdal.InvGeoTransform(wcsFromPx)

        RasterXSize, RasterYSize, RasterCount = self.dataset.RasterXSize, self.dataset.RasterYSize, self.dataset.RasterCount
        firstBand = self.dataset.GetRasterBand(1)
        overviewCount = firstBand.GetOverviewCount()
        scales = np.array([1.] + [RasterXSize / firstBand.GetOverview(idx).XSize for idx in range(overviewCount)])
        logger.debug('{}: estimated overview scales would be: {}'.format(
            self.dataset.GetMetadataItem("TITLE") or self.dataset.GetMetadataItem("ABSTRACT"),
            ", ".join(f"{el:.6f}" for el in scales)))
        # The GDAL raster data model says that independent of their scale, overviews cover the same areas as their main bands.
        # Hence, dividing their resolutions by the resolution of their main band should give their relative scales,
        # and this is what GDALBandGetBestOverviewLevel2 does.
        # This contradicts the definition of OGC's GoogleMapsCompatible-TileMatrixSet scales, which go in exact powers of 2!
        # https://portal.ogc.org/files/?artifact_id=35326 e.g. on page 105
        # "Tile matrix bounding boxes at each scale will usually vary slightly due to pixel alignment, and it is important for the client and server to take this variation into account."
        # While GDAL seems to provide no way to either query the WellKnownScaleSet of a WMTS dataset, or an overview's ScaleDenominator,
        # they all seem to use GoogleMapsCompatible.
        # So let's just round to whole powers of 2 here, and also round the argument of np.searchsorted this way.
        scales = np.array([2 ** round(np.log2(el)) for el in scales])
        assert np.all(np.diff(scales) > 0), 'Overview scales are not sorted'

        while not self.__stop.is_set():
            with self.__jobCondition:
                if self.__job == (wcsRect, viewPxPerMeter):
                    self.__cbIsReading(False)
                    self.__jobCondition.wait()
                    continue
                wcsRect, viewPxPerMeter = self.__job

            self.__cbIsReading(True)
            assert viewPxPerMeter > 0

            # Note QRect's right() function returns left() + width() - 1, and the bottom() function returns top() + height() - 1.
            # >>> r = QRect(0, 0, 1, 1); (r.width(), r.height()), (r.right(), r.bottom())
            # ((1, 1), (0, 0))
            # >>> r = QRect(QPoint(0, 0), QSize(1, 1)); (r.width(), r.height()), (r.right(), r.bottom())
            # ((1, 1), (0, 0))
            # >>> >>> r = QRect(QPoint(0, 0), QPoint(1, 1)); (r.width(), r.height()), (r.right(), r.bottom())
            # ((2, 2), (1, 1))
            # -> When constructing a QRect from 2 QPoints, then the second one is the bottom right pixel WITHIN the rect.
            pxLeftTop = QPoint(*[math.floor(el)
                               for el in gdal.ApplyGeoTransform(pxFromWcs, wcsRect.left(), wcsRect.top())])
            pxRightBot = QPoint(*[math.ceil(el)
                                for el in gdal.ApplyGeoTransform(pxFromWcs, wcsRect.right(), wcsRect.bottom())])
            pxRect = QRect(pxLeftTop, pxRightBot)
            pxRect &= QRect(0, 0, RasterXSize, RasterYSize)
            if pxRect.width() == 0 or pxRect.height() == 0:
                # Surely inside scene rect, but completely outside of dataset bbox, e.g. Stadt Wien maps viewed outside of Wien.
                continue

            # WMTS may not provide their highest resolution everywhere.
            # In these locations, reading a Dataset or Band that is not an overview fails.
            # Also, reading this way at very low resolutions fails sometimes.
            # Hence, we could try reading from a non-overview first - and if that fails, try reading at increasing overview levels.
            # We then need to have the logic for reading from appropriate overview levels, anyway.
            # So: try reading from the appropriate overview first. If that fails, try reading from the next higher overview level.
            # Note: reading may only raise here because of the lack of 404 in ZeroBlockHttpCodes, and because of gdal.UseExceptions().

            viewScale = 1 / (viewPxPerMeter * self.mapResolution)
            # View itself makes sure that zoom levels are always powers of 2.
            # However, fitInView may result in intermediate levels. So do not:
            # bestScale = 2 ** round(np.log2(viewScale))
            exponent = np.log2(viewScale)
            if abs(math.modf(exponent)[0]) < 0.01:
                exponent = round(exponent)
            else:
                exponent = int(exponent)
            bestScale = 2 ** exponent
            iBestScale = np.searchsorted(scales, bestScale, side='right')
            # If argument is in between 2 scales, searchsorted always returns the larger index. We want the lower one, so subtract 1.
            # If argument matches a scale, side='right' returns the next larger index.
            iBestOverview = max(min(iBestScale - 1, overviewCount), 0)
            # Scale indices are shifted by 1, so subtract 1 more.
            iBestOverview -= 1

            for iOvr in range(iBestOverview, overviewCount):
                msg = f'overview level {iOvr} pxScale=1:{viewScale:.2f}'
                logger.debug(msg + '...')
                scale = float(scales[iOvr + 1])
                if iOvr == -1:
                    pxRectOvr = pxRect
                else:
                    # GDALCreateOverviewDataset is unavailable in Python. Hence, for reading at a certain overview level
                    # via a Dataset, there seems to be no other way than to re-open the dataset.
                    # Must not use OF_SHARED, or the already opened self.dataset will be returned unchanged, ignoring open_options.
                    # Without OF_SHARED, the overview datasets use their own caches and their own server connections.
                    # But servers seem to respond much slower when using many connections.
                    # VRTs do not help, either.
                    # Fortunately, reading each band separately should be fast due to GDALs block cache, which is organized in bands.
                    bandOverview = firstBand.GetOverview(iOvr)
                    pxRectOvr = QRect(
                        QPoint(math.floor(pxRect.left() / scale),
                               math.floor(pxRect.top() / scale)),
                        QPoint(math.ceil((pxRect.right()) / scale),
                               math.ceil((pxRect.bottom()) / scale)))
                    pxRectOvr &= QRect(0, 0, bandOverview.XSize, bandOverview.YSize)

                # QImage requires all scanlines to be 32-bit-aligned.
                # Hence, for 3-channel 8-bit images, there may be unused memory between scanlines.
                # While we may construct an ndarray that views external data with appropriate strides,
                # and pass that ndarray as buffer to Dataset.ReadRaster1,
                # Dataset.ReadRaster1 calls PyObject_GetBuffer(..., PyBUF_SIMPLE | PyBUF_WRITABLE),
                # which requires the memory to be contiguous (failing with "buf_obj is not a simple writable buffer").
                # https://raw.githubusercontent.com/OSGeo/gdal/release/3.4/gdal/swig/python/extensions/gdal_wrap.cpp
                # One way to achieve 32-bit-aligned contiguous memory, considering that the data type size is 8 bit, is to always use 4 channels.
                img = QImage(pxRectOvr.width(), pxRectOvr.height(), QImage.Format_RGBA8888)
                if RasterCount < 4:
                    img.fill(Qt.white)  # make opaque
                ptr = img.scanLine(0)
                assert int(ptr) % 4 == 0
                assert (int(img.scanLine(1)) - int(ptr)) % 4 == 0
                ptr.setsize(img.sizeInBytes())

                start = time.monotonic()
                try:
                    for iBand in range(RasterCount):
                        bandPtr = sip.voidptr(int(ptr) + iBand)
                        bandPtr.setsize(img.sizeInBytes())
                        band = self.dataset.GetRasterBand(iBand + 1)
                        if iOvr > -1:
                            band = band.GetOverview(iOvr)
                        band.ReadRaster1(
                            pxRectOvr.left(), pxRectOvr.top(),  # xoff, yoff
                            pxRectOvr.width(), pxRectOvr.height(),  # xsize, ysize
                            pxRectOvr.width(), pxRectOvr.height(),  # buf_xsize, buf_ysize
                            gdal.GDT_Byte,  # buf_type
                            4, pxRectOvr.width() * 4,  # buf_pixel_space, buf_line_space
                            gdal.GRIORA_NearestNeighbour,  # resample_alg
                            None, None,  # callback, callback_data
                            bandPtr  # inputOutputBuf
                        )
                except RuntimeError:
                    logger.debug(msg + f' failed: {time.monotonic() - start:.2f}s')
                    if iOvr + 1 < overviewCount:
                        continue
                    logger.exception('Reading failed at highest overview level.')
                    img.fill(Qt.magenta)
                else:
                    logger.debug(msg + f' success: {time.monotonic() - start:.2f}s')
                finally:
                    self.__cbResponseTime(time.monotonic() - start)
                break
            else:
                raise Exception('Failed to read image at all overview levels')

            self.__cbImageRead(img, __class__.__wcsRectFromPxRect(wcsFromPx, pxRectOvr, scale))

    @staticmethod
    def __wcsRectFromPxRect(wcsFromPx, pxRect: QRect, scale: float = 1.) -> QRectF:
        left, top = pxRect.left(), pxRect.top()
        width, height = pxRect.width(), pxRect.height()
        # Top left corner of top left pixel.
        wcsLeftTop = QPointF(*gdal.ApplyGeoTransform(wcsFromPx, left * scale, top * scale))
        # Bottom right corner of bottom right pixel.
        wcsRightBot = QPointF(*gdal.ApplyGeoTransform(wcsFromPx, (left + width) * scale, (top + height) * scale))
        return QRectF(wcsLeftTop, wcsRightBot)
