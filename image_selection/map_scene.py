from qgis.PyQt.QtCore import pyqtSignal, pyqtSlot, Qt, QPointF
from qgis.PyQt.QtGui import QPen, QPolygonF
from qgis.PyQt.QtWidgets import QFileDialog, QGraphicsPolygonItem, QGraphicsScene, QMessageBox

import pandas as pd
from osgeo import ogr, osr
import sqlite3

import glob
import logging
from pathlib import Path

from .aerial_item import ContrastStretching, Aerial, AerialImage, Status, Visualization

logger = logging.getLogger(__name__)


def _truncateMsg(msg: str, maxLen = 500):
    if len(msg) > maxLen:
        return msg[:maxLen] + ' ...'
    return msg


class MapScene(QGraphicsScene):

    aerialsLoaded = pyqtSignal()
    
    contrastStretch = pyqtSignal(ContrastStretching)

    visualizationByStatus = pyqtSignal(Status, Visualization)

    def __init__(self, *args, epsg: int, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.__wcs = osr.SpatialReference()
        self.__wcs.ImportFromEPSG(epsg)
        self.__db = None
        self.__aoi = None


    @pyqtSlot()
    def selectAoiFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Open the area of interest as a polygon", "", "Polygon formats (*.kml;*.shp);;Any type (*.*)")[0]
        if fileName:
            self.loadAoiFile(Path(fileName))


    @pyqtSlot()
    def selectAerialsFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Open DB query result", "", "Excel sheets (*.xls);;Any type (*.*)")[0]
        if fileName:
            self.loadAerialsFile(Path(fileName))


    @pyqtSlot(ContrastStretching)
    def setContrastStretch(self, stretch):
        self.contrastStretch.emit(stretch)


    @pyqtSlot(Status, Visualization)
    def setVisualizationByStatus(self, status, visualization) -> None:
        self.visualizationByStatus.emit(status, visualization)


    def unload(self):
        AerialImage.unload()
        if self.__db is not None:
            self.__db.close()


    def loadAoiFile(self, fileName: Path) -> None:
        logger.info(f'File with the area of interest to load: {fileName}')
        ds = ogr.Open(str(fileName))
        if ds.GetLayerCount() > 1:
            logger.warning('Data source has multiple layers. Will use the first one.')
        layer = ds.GetLayer(0)
        if layer.GetFeatureCount() != 1:
            return logger.error('First layer does not have a single feature. Choose another file.')
        # For both KML and Shape, layer.GetFeatureCount() reports 1.
        # For KML, GetFeature(1) returns the only feature, while for Shape it must be GetFeature(0).
        # Hence, do not rely on GetFeature(idx), but on iteration, which works for both.
        feature, = layer
        geom = feature.GetGeometryRef()
        geom.FlattenTo2D()
        if geom.GetGeometryType() != ogr.wkbPolygon:
            return logger.error(f"First layer's first feature is not a polygon, but a {geom.GetGeometryName()}. Choose another file.")
        if not geom.IsSimple():
            return logger.error("First layer's first feature is not a simple polygon. Choose another file.")
        geom.TransformTo(self.__wcs)
        assert geom.GetGeometryCount() >= 1
        outerRing = geom.GetGeometryRef(0)
        pts = outerRing.GetPoints()
        scenePos = QPointF(pts[0][0], -pts[0][1])
        qPts = []
        for pt in pts:
            qPts.append(QPointF(pt[0], -pt[1]) - scenePos)
        polyg = QGraphicsPolygonItem(QPolygonF(qPts))
        polyg.setPos(scenePos)
        polyg.setZValue(10)
        pen = QPen(Qt.magenta, 3)
        pen.setCosmetic(True)
        polyg.setPen(pen)
        if self.__aoi is not None:
            self.removeItem(self.__aoi)
        self.addItem(polyg)
        self.__aoi = polyg
        for view in self.views():
            view.fitInView(self.itemsBoundingRect(), Qt.KeepAspectRatio)


    def loadAerialsFile(self, fileName: Path) -> None:
        logger.info(f'Spreadsheet with image meta data to load: {fileName}')
        if self.__db is not None:
            self.__db.close()
        dbPath = fileName.with_suffix('.sqlite')
        if dbPath.exists():
            button = QMessageBox.question(
                None, 'Data base exists', f'Data base {dbPath} already exists.<br/>Open and load orientations? Otherwise, it will be overwritten.',
                QMessageBox.Open | QMessageBox.Discard | QMessageBox.Abort)
            if button == QMessageBox.Abort:
                return
            if button == QMessageBox.Discard:
                dbPath.unlink()
        self.__db = sqlite3.connect(dbPath, isolation_level=None)
      
        if self.__aoi is not None:
            self.removeItem(self.__aoi)
        self.clear()
        if self.__aoi is not None:
            self.addItem(self.__aoi)

        imgDir = fileName.parent / 'Images'
        imgExt = '.ecw'
        fsImgFiles = set(Path(el) for el in glob.iglob(str(imgDir / ('**/*' + imgExt)), recursive=True))
        sheet_name='Geo_Abfrage_SQL'
        df = pd.read_excel(fileName, sheet_name=sheet_name, usecols=':O', true_values=['Ja'], false_values=['Nein'])
        if not self.__cleanData(df, sheet_name):
            return

        xlsImgFiles = []
        shouldBeMissing = []
        shouldBeThere = []
        for row in df.itertuples(index=False):
            #fn = f'{row.Datum.year}-{row.Datum.month:02}-{row.Datum.day:02}_{row.Sortie}_{row.Bildnr}' + imgExt
            #imgFilePath = imgDir / fn
            imgId = Path(row.Sortie) / f'{row.Bildnr}{imgExt}'
            imgFilePath = imgDir / imgId
            if not row.LBDB and imgFilePath in fsImgFiles:
                shouldBeMissing.append(imgFilePath.name)
            elif row.LBDB and imgFilePath not in fsImgFiles:
                shouldBeThere.append(imgFilePath.name)
            xlsImgFiles.append(imgFilePath)
            csDb = osr.SpatialReference()
            csDb.ImportFromEPSG(row.EPSG_Code)
            assert csDb.IsProjected() or csDb.IsGeographic()
            db2wcs = osr.CoordinateTransformation(csDb, self.__wcs)
            x, y = row.x, row.y
            if csDb.EPSGTreatsAsNorthingEasting() or csDb.EPSGTreatsAsLatLong():
                x, y = y, x
            wcsCtr = db2wcs.TransformPoint(x, y)
            Aerial(self, QPointF(wcsCtr[0], -wcsCtr[1]), imgFilePath, row, self.__db, str(imgId))

            #if len(self.items()) > 10:
            #    break

        for view in self.views():
            view.fitInView(self.itemsBoundingRect(), Qt.KeepAspectRatio)

        if any((shouldBeMissing, shouldBeThere)):
            msgs = []
            if shouldBeMissing:
                msgs.append('{} out of {} files should be missing according to {}, but they are present: {}'.format(
                    len(shouldBeMissing), len(xlsImgFiles), sheet_name, ', '.join(shouldBeMissing)))
            if shouldBeThere:
                msgs.append('{} out of {} files should be present according to {}, but they are missing: {}'.format(
                    len(shouldBeThere), len(xlsImgFiles), sheet_name, ', '.join(shouldBeThere)))
            for msg in msgs:
                logger.warning(msg)
            QMessageBox.warning(None, "Inconsistency", _truncateMsg('\n'.join(msgs)))

        xlsImgFiles = set(xlsImgFiles)
        spare = fsImgFiles - xlsImgFiles
        if spare:
            msg = '{} files are present, but not in {}: {}'.format(len(spare), sheet_name, ', '.join(el.name for el in spare))
            logger.warning(msg)
            QMessageBox.warning(None, "Inconsistency", _truncateMsg(msg))

        aerialImgs = [el for el in self.items() if isinstance(el, AerialImage)]
        logger.info('{} of {} images available.'.format(sum(el.status() > Status.missing for el in aerialImgs), len(aerialImgs)))

        self.aerialsLoaded.emit()


    def __cleanData(self, df: pd.DataFrame, sheet_name: str) -> bool:
        def error(msg):
            logger.error(msg)
            QMessageBox.critical(None, "Erroneous Coordinate Reference System", msg)
            return False

        df['Datum'] = df['Datum'].dt.date  # strip time of day

        # EPSG codes' column seems to be named either 'EPSG-Code', or 'EPSGCode'.
        # Standardize the name into a Python identifier.
        iEpsgs = [idx for idx, el in enumerate(df.columns) if 'epsg' in el.lower()]
        iXWgs84s = [idx for idx, el in enumerate(df.columns) if 'xwgs84' in el.lower()]
        iYWgs84s = [idx for idx, el in enumerate(df.columns) if 'ywgs84' in el.lower()]
        for idxs, name in [(iEpsgs, 'EPSG code'), (iXWgs84s, 'WGS84 longitude'), (iYWgs84s, 'WGS84 latitude')]:
            if len(idxs) > 1:
                return error('Multiple columns in {} seem to provide {}: {}.'.format(sheet_name, name, ', '.join(df.columns[idx] for idx in idxs)))
        if iEpsgs and (iXWgs84s or iYWgs84s):
            return error(f'{sheet_name} defines columns both for EPSG code and WGS84 coordinates.')
        if iEpsgs:
            df.rename(columns={df.columns[iEpsgs[0]]: "EPSG_Code"}, inplace=True)
        elif iXWgs84s or iYWgs84s:
            if not (iXWgs84s and iYWgs84s):
                return error(f'{sheet_name} defines only one WGS84 coordinate.')
            #series = pd.Series([4326] * len(df))
            df['EPSG_Code'] = [4326] * len(df)
            df.rename(columns={df.columns[iXWgs84s[0]]: "x", df.columns[iYWgs84s[0]]: "y"}, inplace=True)
        else:
            return error(f"{sheet_name} seems to provide no information on coordinate system. Columns are: {', '.join(df.columns)}")
        return True