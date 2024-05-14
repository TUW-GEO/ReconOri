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
"""

# For User Workshop only:
import sys
sys.path.append(r'x:\guests\DoRIAH\common\PythonPackages\Python312\site-packages')

import logging
from pathlib import Path
import threading
import traceback
from typing import Final

logger: Final = logging.getLogger(__name__)
matcher = None

def loadMatcher():
    global matcher
    try:
        import io
        import sys
        import torch
        from yacs.config import CfgNode as CN
        from se2_loftr import src
        from se2_loftr.src.loftr import LoFTR
        from se2_loftr.configs.loftr.outdoor import loftr_ds_e2

        def lower_config(yacs_cfg):
            if not isinstance(yacs_cfg, CN):
                return yacs_cfg
            return {k.lower(): lower_config(v) for k, v in yacs_cfg.items()}

        assert torch.cuda.is_available()
        # If the QGIS Python console is not open, then sys.stderr is None,
        # and cpuMatcher.load_state_dict fails when importing pretty_errors.__init__:
        #     terminal_is_interactive = sys.stderr.isatty()
        # QGIS 3.34.6\apps\qgis-ltr\python\console\console_output.py
        # sets sys.stderr to its own implementation, independent if sys.stderr is None, or not.
        if sys.stderr is None:
            sys.stderr = io.IOBase()
        torch.set_default_tensor_type(torch.cuda.FloatTensor)
        cpuMatcher = LoFTR(config=lower_config(loftr_ds_e2.cfg.LOFTR))
        weightsFn = Path(src.__file__).parents[1] / "weights" / "4rot.ckpt"
        cpuMatcher.load_state_dict(torch.load(weightsFn)['state_dict'])
        matcher = cpuMatcher.eval().cuda()
    except Exception as ex:
        logger.warning(f'Failed to load the matcher. Automatic georeferencing unavailable:\n{"".join(traceback.format_exception(ex))}')        
    except:
        logger.warning('Failed to load the matcher. Automatic georeferencing unavailable!')
    else:
        logger.info('Matcher ready for automatic georeferencing.')

# If the main thread is idle for some time, async loading will have finished before the matcher is needed, despite the GIL.
loadThread = threading.Thread(target=loadMatcher)
loadThread.start()

def georef():
    if loadThread.is_alive():
        logger.info('Waiting for the matcher to load.')
    loadThread.join()
    if matcher is None:
        logger.error('Automatic georeferencing unavailable!')
        return
    logger.error('TODO: implement auto-geoferencing.')
