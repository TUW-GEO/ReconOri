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

from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QWidget, QAction
from qgis.gui import QgisInterface

from collections.abc import Callable
import importlib
import logging
from pathlib import Path
import time

# Initialize Qt resources from file resources_rc.py at first, so the rest can use it upon its import, already.
# This would also import resources.qCleanupResources():
# from .resources import *
# Hence, PlugIn Reloader would call it not only for resources.py itself, but also for this file.
# Hence, better use importlib to do a relative import without importing anything from it.
importlib.import_module('..resources_rc', __name__)

from . import getLoggerAndFileHandler
from .main_window import MainWindow


logger = logging.getLogger(__name__)


class SelORecon:

    def __init__(self, iface: QgisInterface):
        self.iface = iface
        self.plugin_dir = Path(__file__).parent
        self.actions = []
        self.menu = '&SelORecon'
        self.dlg = None

    def add_action(self, icon_path: str, text: str, callback: Callable, parent: QWidget | None = None) -> None:
        action = QAction(QIcon(icon_path), text, parent)
        action.triggered.connect(callback)
        self.iface.addToolBarIcon(action)
        self.iface.addPluginToMenu(self.menu, action)
        self.actions.append(action)

    def initGui(self):
        """Create the menu entries and toolbar icons inside the QGIS GUI."""

        self.add_action(
            ':/plugins/selorecon/bomb',
            'SelORecon',
            self.run,
            self.iface.mainWindow())

    def unload(self):
        """Removes the plugin menu item and icon from QGIS GUI."""
        for action in self.actions:
            self.iface.removePluginMenu('&SelORecon', action)
            self.iface.removeToolBarIcon(action)
        if self.dlg is not None:
            self.dlg.unload()
        logger.debug('Cheers!')
        packageLogger, packageLogFileHandler = getLoggerAndFileHandler()
        packageLogger.removeHandler(packageLogFileHandler)
        packageLogFileHandler.close()
        if self.dlg:
            self.dlg.close()
        time.sleep(0.5)  # Give the log monitor some time to notice the last logs, before the log file may be re-opened.

    def run(self):
        """Run method that performs all the real work"""

        if self.dlg is None:
            self.dlg = MainWindow()

        self.dlg.show()
