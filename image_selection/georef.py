# For User Workshop only:
import sys
sys.path.append(r'x:\guests\DoRIAH\common\PythonPackages\Python312\site-packages')

import logging
from pathlib import Path
import threading
from typing import Final

logger: Final = logging.getLogger(__name__)
matcher = None

def loadMatcher():
    global matcher
    try:
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
        torch.set_default_tensor_type(torch.cuda.FloatTensor)
        matcher = LoFTR(config=lower_config(loftr_ds_e2.cfg.LOFTR))
        weightsFn = Path(src.__file__).parents[1] / "weights" / "4rot.ckpt"
        matcher.load_state_dict(torch.load(weightsFn)['state_dict'])
        matcher = matcher.eval().cuda()
    except:
        logger.warning('Failed to load the matcher. Automatic georeferencing unavailable!')
    else:
        logger.info('Matcher ready for automatic georeferencing.')

# If the main thread is idle for some time, async loading will have finished before the matcher is needed, despite the GIL.
loadThread = threading.Thread(target=loadMatcher)
loadThread.start()

def georef():
    if loadThread.is_alive():
        logger.info('Waiting for the matcher load.')
    loadThread.join()
    if matcher is None:
        logger.warning('Automatic georeferencing unavailable!')
        return
    logger.info('TODO: implement auto-geoferencing.')
