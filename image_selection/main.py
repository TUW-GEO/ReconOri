"""
/***************************************************************************
 ImageSelection
                                 A QGIS plugin
 Guided selection of images with implicit coarse geo-referencing.
                               -------------------
        begin                : 2021-11-12
        git sha              : $Format:%H$
        copyright            : (C) 2021 by Photogrammetry @ GEO, TU Wien, Austria
        email                : wilfried.karel@geo.tuwien.ac.at
 ***************************************************************************/

/***************************************************************************
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 ***************************************************************************/
"""
from qgis.PyQt.QtCore import QSettings, QTranslator, QCoreApplication
from qgis.PyQt.QtGui import QIcon
from qgis.PyQt.QtWidgets import QWidget, QAction
from qgis.gui import QgisInterface

from collections.abc import Callable
import importlib
import logging
from pathlib import Path
import time
from typing import Optional

# Initialize Qt resources from file resources.py at first, so the rest can use it upon its import, already.
# This would also import resources.qCleanupResources():
# from .resources import *
# Hence, PlugIn Reloader would call it not only for resources.py itself, but also for this file.
# Hence, better use importlib to do a relative import without importing anything from it.
importlib.import_module('..resources', __name__)

from .main_window import MainWindow
from . import getLoggerAndFileHandler


logger = logging.getLogger(__name__)


class ImageSelection:

    def __init__(self, iface: QgisInterface):
        self.iface = iface
        self.plugin_dir = Path(__file__).parent

        self.actions = []
        self.menu = '&DoRIAH Image Selection'
        self.dlg = None


    def add_action(
        self,
        icon_path: str,
        text: str,
        callback: Callable,
        enabled_flag: bool = True,
        add_to_menu: bool = True,
        add_to_toolbar: bool = True,
        status_tip: Optional[str] = None,
        whats_this: Optional[str] = None,
        parent: Optional[QWidget] = None) -> QAction:
        """Add a toolbar icon to the toolbar.

        :param icon_path: Path to the icon for this action. Can be a resource
            path (e.g. ':/plugins/foo/bar.png') or a normal file system path.

        :param text: Text that should be shown in menu items for this action.

        :param callback: Function to be called when the action is triggered.

        :param enabled_flag: A flag indicating if the action should be enabled by default.

        :param add_to_menu: Flag indicating whether the action should also be added to the menu.

        :param add_to_toolbar: Flag indicating whether the action should also be added to the toolbar.

        :param status_tip: Optional text to show in a popup when mouse pointer hovers over the action.

        :param parent: Parent widget for the new action.

        :param whats_this: Optional text to show in the status bar when the mouse pointer hovers over the action.

        :returns: The action that was created. Note that the action is also added to self.actions list.
        """

        icon = QIcon(icon_path)
        action = QAction(icon, text, parent)
        action.triggered.connect(callback)
        action.setEnabled(enabled_flag)

        if status_tip is not None:
            action.setStatusTip(status_tip)

        if whats_this is not None:
            action.setWhatsThis(whats_this)

        if add_to_toolbar:
            # Adds plugin icon to Plugins toolbar
            self.iface.addToolBarIcon(action)

        if add_to_menu:
            self.iface.addPluginToMenu(self.menu, action)

        self.actions.append(action)

        return action


    def initGui(self):
        """Create the menu entries and toolbar icons inside the QGIS GUI."""

        self.add_action(
            ':/plugins/image_selection/bomb',
            text='Select Images',
            callback=self.run,
            parent=self.iface.mainWindow())


    def unload(self):
        """Removes the plugin menu item and icon from QGIS GUI."""
        for action in self.actions:
            self.iface.removePluginMenu('&DoRIAH Image Selection', action)
            self.iface.removeToolBarIcon(action)
        if self.dlg is not None:
            self.dlg.unload()
        logger.debug('Good-bye!')
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
