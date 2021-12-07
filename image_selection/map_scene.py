from qgis.PyQt.QtCore import pyqtSignal, pyqtSlot, Qt, QPointF
from qgis.PyQt.QtWidgets import QFileDialog, QGraphicsScene, QMessageBox

import pandas as pd
from osgeo import osr
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

    projectLoaded = pyqtSignal()
    
    contrastStretch = pyqtSignal(ContrastStretching)

    visualizationByStatus = pyqtSignal(Status, Visualization)

    def __init__(self, *args, epsg: int, **kwargs) -> None:
        super().__init__(*args, **kwargs)
        self.__wcs = osr.SpatialReference()
        self.__wcs.ImportFromEPSG(epsg)
        self.__db = None


    @pyqtSlot()
    def selectProjectFile(self):
        fileName = QFileDialog.getOpenFileName(None, "Open DB query result", "", "Excel sheets (*.xls);;Any type (*.*)")[0]
        if fileName:
            self.loadProjectFile(Path(fileName))


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


    def loadProjectFile(self, fileName: Path) -> None:
        logger.info(f'Project file to load: {fileName}')
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
      

        self.clear()
        imgDir = fileName.parent / 'Bilder'
        imgExt = '.ecw'
        fsImgFiles = set(Path(el) for el in glob.iglob(str(imgDir / ('*' + imgExt))))
        sheet_name='Geo_Abfrage_SQL'
        df = pd.read_excel(fileName, sheet_name=sheet_name, usecols=':O', true_values=['Ja'], false_values=['Nein'])
        if not self.__cleanData(df, sheet_name):
            return

        xlsImgFiles = []
        shouldBeMissing = []
        shouldBeThere = []
        for row in df.itertuples(index=False):
            fn = f'{row.Datum.year}-{row.Datum.month:02}-{row.Datum.day:02}_{row.Sortie}_{row.Bildnr}' + imgExt
            imgFilePath = imgDir / fn
            if not row.LBDB and imgFilePath in fsImgFiles:
                shouldBeMissing.append(imgFilePath.name)
            elif row.LBDB and imgFilePath not in fsImgFiles:
                shouldBeThere.append(imgFilePath.name)
            xlsImgFiles.append(imgFilePath)
            csDb = osr.SpatialReference()
            csDb.ImportFromEPSG(row.EPSG_Code)
            assert csDb.IsProjected()
            db2wcs = osr.CoordinateTransformation(csDb, self.__wcs)
            x, y = row.x, row.y
            if csDb.EPSGTreatsAsNorthingEasting():
                x, y = y, x
            wcsCtr = db2wcs.TransformPoint(x, y)
            Aerial(self, QPointF(wcsCtr[0], -wcsCtr[1]), imgFilePath, row, self.__db, fn)

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

        self.projectLoaded.emit()


    def __cleanData(self, df: pd.DataFrame, sheet_name: str) -> bool:
        df['Datum'] = df['Datum'].dt.date  # strip time of day

        # EPSG codes' column seems to be named either 'EPSG-Code', or 'EPSGCode'.
        # Standardize the name into a Python identifier.
        iEpsgs = [idx for idx, el in enumerate(df.columns) if 'epsg' in el.lower()]
        if not iEpsgs:
            msg = 'No column in {} seems to provide an EPSG code. Columns are: {}'.format(sheet_name, ', '.join(df.columns))
            logger.error(msg)
            QMessageBox.critical(None, "Missing Coordinate Reference System", msg)
            return False
        if len(iEpsgs) > 1:
            msg = 'Multiple columns in {} seem to provide an EPSG code: {}'.format(sheet_name, ', '.join(df.columns[iEpsg] for iEpsg in iEpsgs))
            logger.error(msg)
            QMessageBox.critical(None, "Ambiguous Coordinate Reference System", msg)
            return False
        df.rename(columns={df.columns[iEpsgs[0]]: "EPSG_Code"}, inplace=True)
        return True