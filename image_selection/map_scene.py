#  ***************************************************************************
#  *                                                                         *
#  *   This program is free software; you can redistribute it and/or modify  *
#  *   it under the terms of the GNU General Public License as published by  *
#  *   the Free Software Foundation; either version 2 of the License, or     *
#  *   (at your option) any later version.                                   *
#  *                                                                         *
#  ***************************************************************************

from qgis.PyQt.QtCore import pyqtSignal, pyqtSlot, Qt, QPointF, QSettings
from qgis.PyQt.QtGui import QPen, QPolygonF
from qgis.PyQt.QtWidgets import QFileDialog, QGraphicsPolygonItem, QGraphicsScene, QInputDialog, QMessageBox

import pandas as pd
from osgeo import ogr, osr
import sqlite3

import collections
import configparser
import json
import logging
from pathlib import Path
from typing import Optional

from .aerial_item import ContrastEnhancement, AerialObject, AerialImage, Availability, Usage, Visualization

logger = logging.getLogger(__name__)


def _truncateMsg(msg: str, maxLen=500):
    if len(msg) > maxLen:
        return msg[:maxLen] + ' ...'
    return msg


class MapScene(QGraphicsScene):

    aerialsLoaded = pyqtSignal(list)

    attackDataLoaded = pyqtSignal(list)

    areaOfInterestLoaded = pyqtSignal(list)

    aerialFootPrintChanged = pyqtSignal(str, list)

    aerialAvailabilityChanged = pyqtSignal(str, int, str)

    aerialUsageChanged = pyqtSignal(str, int)

    contrastEnhancementChanged = pyqtSignal(ContrastEnhancement)

    visualizationChanged = pyqtSignal(dict, dict, set)

    def __init__(self, *args, epsg: int, config: configparser.ConfigParser, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.__wcs = osr.SpatialReference()
        self.__wcs.ImportFromEPSG(epsg)
        self.__db = None
        self.__attackData = None
        self.__aoi = None
        self.__config = config

    @pyqtSlot()
    def selectAerialsFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Load aerial meta data",
                                               self.__lastDir, "Excel sheets (*.xls;*.xlsx);;Any type (*.*)")[0]
        if fileName:
            self.__lastDir = str(Path(fileName).parent)
            self.loadAerialsFile(Path(fileName))

    @pyqtSlot()
    def selectAttackDataFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Load attack data",
                                               self.__lastDir, "Excel sheets (*.xls;*.xlsx);;Any type (*.*)")[0]
        if fileName:
            self.__lastDir = str(Path(fileName).parent)
            self.loadAttackDataFile(Path(fileName))

    @pyqtSlot()
    def selectAoiFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Load an area of interest as a polygon, or as polyline / point to buffer",
                                               self.__lastDir, "Geometry formats (*.kml;*.shp);;Any type (*.*)")[0]
        if fileName:
            self.__lastDir = str(Path(fileName).parent)
            self.loadAoiFile(Path(fileName))

    @pyqtSlot(set)
    def highlightAerial(self, imageIds):
        logger.info(f'highlight {imageIds}')
        for item in self.items():
            if isinstance(item, AerialImage):
                if imageIds:
                    if item.id() in imageIds:
                        item.object.animate()
                else:
                    item.object.stopAnimation()

    def unload(self):
        AerialImage.unload()
        if self.__db is not None:
            self.__db.close()

    def loadAoiFile(self, fileName: Path) -> None:
        def error(msg):
            __class__.__error("Erroneous Area of Interest", msg)

        logger.info(f'File with the area of interest to load: {fileName}')
        ds = ogr.Open(str(fileName))
        if ds.GetLayerCount() > 1:
            logger.warning('Data source has multiple layers. Will use the first one.')
        layer = ds.GetLayer(0)
        if not layer.GetFeatureCount():
            return error('First layer does not have any feature. Choose another file.')
        if layer.GetFeatureCount() > 1:
            logger.warning('First layer has several features. Will use the first one.')
        # For both KML and Shape, layer.GetFeatureCount() reports 1.
        # For KML, GetFeature(1) returns the only feature, while for Shape it must be GetFeature(0).
        # Hence, do not rely on GetFeature(idx), but on iteration, which works for both.
        feature, *_ = layer
        geom = feature.GetGeometryRef()
        geom.FlattenTo2D()
        if not geom.IsSimple():
            return error("First layer's first feature is not a simple geometry. Choose another file.")
        geom.TransformTo(self.__wcs)
        if geom.GetGeometryType() in (ogr.wkbPoint, ogr.wkbLineString):
            bufferRadius, ok = QInputDialog.getDouble(None, f'Buffer {geom.GetGeometryName()}', 'radius [m]', 100, 1)
            if not ok:
                return
            geom = geom.Buffer(bufferRadius)
        elif geom.GetGeometryType() != ogr.wkbPolygon:
            return error(f"First layer's first feature is not a polygon, point, or polyline, but a {geom.GetGeometryName()}. "
                         "Choose another file.")
        assert geom.GetGeometryCount() >= 1
        outerRing = geom.GetGeometryRef(0)
        pts = outerRing.GetPoints()
        scenePos = QPointF(pts[0][0], -pts[0][1])
        qPts = []
        for pt in pts:
            qPts.append(QPointF(pt[0], -pt[1]) - scenePos)
        polyg = QGraphicsPolygonItem(QPolygonF(qPts))
        polyg.setPos(scenePos)
        polyg.setZValue(100)
        pen = QPen(Qt.magenta, 3)
        pen.setCosmetic(True)
        polyg.setPen(pen)
        if self.__aoi is not None:
            self.removeItem(self.__aoi)
        self.addItem(polyg)
        self.__aoi = polyg
        for view in self.views():
            view.fitInView(self.itemsBoundingRect(), Qt.KeepAspectRatio)
        self.emitAreaOfInterestLoaded()

    def loadAerialsFile(self, fileName: Path) -> None:
        logger.info(f'Spreadsheet with image meta data to load: {fileName}')
        dbPath = fileName.with_suffix('.sqlite')
        rmDb = False
        if dbPath.exists():
            button = QMessageBox.question(
                None, 'Data base exists', f'Data base {dbPath} already exists.<br/>Open and load orientations? Otherwise, it will be overwritten.',
                QMessageBox.Open | QMessageBox.Discard | QMessageBox.Abort)
            if button == QMessageBox.Abort:
                return
            if button == QMessageBox.Discard:
                rmDb = True

        sheet_name = 'Geo_Abfrage_SQL'
        df = pd.read_excel(fileName, sheet_name=sheet_name, true_values=['Ja', 'ja'], false_values=['Nein', 'nein'])
        if not self.__cleanAerialData(df, sheet_name):
            return

        AerialImage.previewRootDir = Path(self.__config['PREVIEWS']['rootDir'])
        if not AerialImage.previewRootDir.is_absolute():
            AerialImage.previewRootDir = fileName.parent / AerialImage.previewRootDir
        AerialImage.imageRootDir = Path(self.__config['IMAGES']['rootDir'])
        if not AerialImage.imageRootDir.is_absolute():
            AerialImage.imageRootDir = fileName.parent / AerialImage.imageRootDir

        if self.__aoi is not None:
            self.removeItem(self.__aoi)
        self.clear()
        if self.__aoi is not None:
            self.addItem(self.__aoi)
        if self.__db is not None:
            self.__db.close()
            self.__db = None
        if rmDb:
            dbPath.unlink()
        self.__db = sqlite3.connect(dbPath, isolation_level=None)
        self.__db.execute('PRAGMA foreign_keys = ON')
        AerialImage.createTables(self.__db)

        xlsImgFiles = []
        shouldBeMissing = []
        shouldBeThere = []
        aerialObjects = []
        # Speed up the creating of a new DB, especially if it is located on a network drive.
        # Also, errors during setup will leave an existing DB in its original state.
        self.__db.execute('BEGIN TRANSACTION')
        for row in df.itertuples(index=False):
            #fn = f'{row.Datum.year}-{row.Datum.month:02}-{row.Datum.day:02}_{row.Sortie}_{row.Bildnr}.ecw'
            imgId = (Path(row.Sortie) / f'{row.Bildnr}.ecw').as_posix()
            imgFilePath = AerialImage.imageRootDir / imgId
            if not row.LBDB and imgFilePath.exists():
                shouldBeMissing.append(imgFilePath.name)
            elif row.LBDB and not imgFilePath.exists():
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
            # WCS -> CS QGraphicsScene: invert y-coordinate
            aerialObjects.append(AerialObject(self, QPointF(wcsCtr[0], -wcsCtr[1]), str(imgId), row, self.__db))

        self.__db.execute('COMMIT TRANSACTION')

        for view in self.views():
            view.fitInView(self.itemsBoundingRect(), Qt.KeepAspectRatio)

        msgs = []
        if shouldBeMissing:
            msgs.append('{} out of {} files should be missing according to {}, but they are present: {}'.format(
                len(shouldBeMissing), len(xlsImgFiles), sheet_name, ', '.join(shouldBeMissing)))
        if shouldBeThere:
            msgs.append('{} out of {} files should be present according to {}, but they are missing: {}'.format(
                len(shouldBeThere), len(xlsImgFiles), sheet_name, ', '.join(shouldBeThere)))
        for msg in msgs:
            logger.warning(msg)
            QMessageBox.warning(None, 'Inconsistency', _truncateMsg(msg))

        images = [el.image() for el in aerialObjects]
        availabilityCounts = collections.Counter((image.availability() for image in images))
        title = 'Availabilities of {} aerials'.format(len(aerialObjects))
        msgs = [f'{el.name}:\t{availabilityCounts[el]}' for el in reversed(Availability)]
        logger.info(title + ': ' + ','.join(msgs))
        QMessageBox.information(None, title, title + '\n' + '\n'.join(msgs))

        self.emitAerialsLoaded(images)

    def loadAttackDataFile(self, fileName: Path) -> None:
        def date2str(arg):
            if isinstance(arg, str):
                return arg
            return f'{arg.day:02}.{arg.month:02}.{arg.year}'  # a datetime.datetime

        logger.info(f'Spreadsheet with attack data to load: {fileName}')
        # Excel stores dates as numeric values (type=1; displayed according to the cell format),
        # and pd converts these to datetime.datetime.
        # LBDB seems to typically store attack dates as such (type=1).
        # However, 'Projekte LBDB\Image_Selection_Projektbeispiel\Attack_List_St_Poelten.xlsx'
        # contains as last attack a range of dates, stored as TEXT (type=2):
        # '11.-15.04.1945'
        # -> convert all attack dates (type=1) to a similar string, formatted like LBDBs format for dates. E.g.:
        # '08.12.1944'
        # Need to treat column names case insensitively:
        # - Attack_List_St_Poelten.xlsx stores them in all upper case,
        # - Projekte LBDB\Image_Selection_Projektbeispiel\Image_Selection_Sample_Vienna\AttackList_Vienna.xlsx in mixed case.
        df = pd.read_excel(fileName, sheet_name='Tabelle1',
                           converters=dict.fromkeys(['DATUM', 'Datum', 'datum'], date2str))
        # Homogenize the column names.
        df.rename(mapper=str.capitalize, axis='columns', inplace=True)
        # If we only read the column of attack dates, the rest could be skipped.
        # However, in addition to the dates, the fuse types (column 'Bombentyp') may be needed by the browser page.
        # Reading at least these 2 columns complicates things.
        # AttackList_Vienna.xlsx contains a non-empty cell (a comment) in its 55th row,
        # to the right of the right-most actual column.
        # read_excel reads an 'Unnamed:8'-column for that.
        df.drop(columns=[el for el in df.columns if el.startswith('Unnamed:')], inplace=True)
        # Below the actual data, AttackList_Vienna.xlsx contains empty cells merged horizontally.
        # read_excel returns rows for these with all-NaN values.
        df.dropna(how='all', inplace=True)
        # AttackList_Vienna.xlsx contains vertically merged cells in its actual data:
        # multiple attacks on the same day (and by the same 'Airforce', from the same 'Quelle'),
        # where the cell in column 'Datum' (and 'Airforce', 'Quelle') is merged for all these attacks.
        # read_excel returns NaN for all but the first row of such vertically merged cells.
        # Use fillna to replace such NaN with the preceding not-NaN.
        df.fillna(method='ffill', inplace=True)
        self.__attackData = df.to_dict('records')
        self.emitAttackDataLoaded()

    def emitAerialsLoaded(self, images: Optional[list[AerialImage]] = None) -> None:
        if self.__db is None:
            return
        if images is None:
            images = [item for item in self.items() if isinstance(item, AerialImage)]
        aerials = {}
        cursor = self.__db.execute('SELECT * FROM aerials')
        iId = [el[0] for el in cursor.description].index('id')
        for row in cursor:
            aerial = {name: val for (name, *_), val in zip(cursor.description, row)
                      if name not in ('trafo', 'scenePos', 'previewRect')}
            aerial['meta'] = json.loads(aerial['meta'])
            aerials[row[iId]] = aerial

        for image in images:
            imgId, footprint = image.id(), image.footprint()
            aerials[imgId].update([('footprint', footprint),
                                   ('availability', int(image.availability()))])

        self.aerialsLoaded.emit(list(aerials.values()))

    def emitAttackDataLoaded(self):
        if self.__attackData is not None:
            self.attackDataLoaded.emit(self.__attackData)

    def emitAreaOfInterestLoaded(self):
        if self.__aoi is not None:
            scenePos = self.__aoi.pos()
            polyg = self.__aoi.polygon()
            self.areaOfInterestLoaded.emit(
                # CS QGraphicsScene -> WCS: invert y-coordinate
                [{'x': pt_.x(), 'y': -pt_.y()}
                 for pt in polyg for pt_ in (pt + scenePos,)])

    @property
    def __lastDir(self):
        settings = QSettings("TU WIEN", "Image Selection", self)
        return settings.value("lastDir", ".")

    @__lastDir.setter
    def __lastDir(self, value: str):
        settings = QSettings("TU WIEN", "Image Selection", self)
        settings.setValue("lastDir", value)

    @staticmethod
    def __error(title, msg):
        logger.error(msg)
        QMessageBox.critical(None, title, msg)
        return False

    @staticmethod
    def __cleanAerialData(df: pd.DataFrame, sheet_name: str) -> bool:
        def error(msg):
            return __class__.__error("Erroneous Coordinate Reference System", msg)

        df['Datum'] = df['Datum'].dt.date  # strip time of day

        # EPSG codes' column seems to be named either 'EPSG-Code', or 'EPSGCode'.
        # Standardize the name into a Python identifier.
        iEpsgs = [idx for idx, el in enumerate(df.columns) if 'epsg' in el.lower()]
        iXWgs84s = [idx for idx, el in enumerate(df.columns) if 'xwgs84' in el.lower()]
        iYWgs84s = [idx for idx, el in enumerate(df.columns) if 'ywgs84' in el.lower()]
        for idxs, name in [(iEpsgs, 'EPSG code'), (iXWgs84s, 'WGS84 longitude'), (iYWgs84s, 'WGS84 latitude')]:
            if len(idxs) > 1:
                return error('Multiple columns in {} seem to provide {}: {}.'.format(sheet_name, name, ', '.join(str(df.columns[idx]) for idx in idxs)))
        if iEpsgs and (iXWgs84s or iYWgs84s):
            return error(f'{sheet_name} defines columns both for EPSG code and for WGS84 coordinates.')
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
