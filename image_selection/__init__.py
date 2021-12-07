# -*- coding: utf-8 -*-
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

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/
 This script initializes the plugin, making it known to QGIS.
"""

from qgis.gui import QgisInterface

import enum

# WMTS opens a WMS dataset for each overview level, passing timeout as option.
# But GDALWMSDataset::Initialize uses atoi, and Curl interprets 0 as 'no timeout'.
# Hence, do not use a timeout smaller than 1s.
# WMS uses this timeout accordingly.
# GDAL_HTTP_TIMEOUT seems to be always overruled by the internal default of 300s
#  - which is used if <Timeout> is not given or empty in XML.
class HttpTimeout(enum.IntEnum):
    seconds = 10


_logger = None
_logFileHandler = None


def getLoggerAndFileHandler():
    return _logger, _logFileHandler


def gdalPushLogHandler():
    from osgeo import gdal

    if not hasattr(gdal._pylog_handler, 'logger'):
        gdal.ConfigurePythonLogging(logger_name=__name__ + '.GDAL')
        gdal.SetErrorHandler(None)

    gdal.PushErrorHandler(gdal._pylog_handler)

    # Useful: inspect actual HTTP traffic.
    # gdal.SetThreadLocalConfigOption('CPL_DEBUG', 'ON')

    # Ineffective?
    # gdal.SetThreadLocalConfigOption('CPL_CURL_VERBOSE', 'YES')

    # Ineffective, since the internal default of 300 would still be used.
    # gdal.SetThreadLocalConfigOption('GDAL_HTTP_TIMEOUT', '1') # [s]

    # Maybe useful
    # gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_LIMIT', '1024')  # bytes per second
    # gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_TIME', '1')  # seconds


def gdalPopLogHandler():
    from osgeo import gdal
    
    gdal.PopErrorHandler()
    gdal.SetThreadLocalConfigOption('CPL_DEBUG', None)
    gdal.SetThreadLocalConfigOption('CPL_CURL_VERBOSE', None)
    gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_LIMIT', None)
    gdal.SetThreadLocalConfigOption('GDAL_HTTP_LOW_SPEED_TIME', None)


def classFactory(iface: QgisInterface):
    """Load ImageSelection class from file ImageSelection.

    :param iface: A QGIS interface instance.
    """
    #from osgeo import gdal

    import logging
    from pathlib import Path

    from .main import ImageSelection

    global _logger, _logFileHandler

    _logger = logging.getLogger(__name__)
    # Please note that without logging to a file by setting a filename the logging may be multithreaded which heavily slows down the output.
    _logFileHandler = logging.FileHandler(filename=Path(__file__).parent / 'log.txt', mode='w')
    logFormatter = logging.Formatter('{asctime}.{msecs:.0f} {levelname}: {name} - {message}', style='{', datefmt='%H:%M:%S')
    logFormatter.default_time_format = '%H:%M:%S'
    _logFileHandler.setFormatter(logFormatter)
    _logger.addHandler(_logFileHandler)
    _logger.setLevel(logging.DEBUG)

    # These would act application wide. Better act temporarily or thread-local.
    # gdal.ConfigurePythonLogging(logger_name=__name__ + '.GDAL')
    # gdal.SetConfigOption('CPL_DEBUG', 'ON') # same as ConfigurePythonLogging(..., enable_debug=True)
    # gdal.SetConfigOption('CPL_CURL_VERBOSE', 'YES')
    # gdal.SetConfigOption('GDAL_HTTP_TIMEOUT', '1') # [s]
    # gdal.SetConfigOption('GDAL_HTTP_LOW_SPEED_LIMIT', '1024')  # bytes per second
    # gdal.SetConfigOption('GDAL_HTTP_LOW_SPEED_TIME', '1')  # seconds

    return ImageSelection(iface)
