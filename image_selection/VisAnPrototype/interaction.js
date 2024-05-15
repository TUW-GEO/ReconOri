const resolveMouseAerial = function () {
    return aerials.filter( a => dist(a.vis.pos[0], a.vis.pos[1], mouseX, mouseY) <= a.vis.r)[0];
  }
  
function hoverAerials() {
  prevHoveredAerial = hoveredAerial?hoveredAerial:prevHoveredAerial;
  hoveredAerial = resolveMouseAerial();
  if (hoveredAerial) {
    if (!hoveredFlag) {
      sendObject(hoveredAerial.id, 'highlight');
      // sendObject(hoveredAerial.id, 'openPreview');
    
      hoveredFlag = true
    }
    drawTooltip(hoveredAerial);
  } else {
    if (hoveredFlag) {
      sendObject([], 'unhighlight');
      // sendObject(prevHoveredAerial.id, 'closePreview');
    }
    hoveredFlag = false;
  }
}

function mousePressed() {
  if (test && !testOn && mouseY < height-20) {
    testOn = true;
    log.write('user','START','',[orientingOn,prescribingOn]);
  } 
  if (mouseY < h[1]) dragStart = mouseX;
}

function mouseReleased() {
  if (mouseY < h[1]) {
    if (Math.abs(dragStart-mouseX) > 1) timeline.filter(min(dragStart,mouseX),max(dragStart,mouseX));
    else timeline.reset();
    dragStart = null;
  }
}

function mouseClicked() {
  clickables.forEach( a => (dist(a.pos[0],a.pos[1],mouseX,mouseY) <= a.r)? a.click():null );
  let clickedAerial = resolveMouseAerial();
  if (clickedAerial) {
    sendObject(clickedAerial.id, clickedAerial.previewOpen? 'closePreview':'openPreview');
    log.write('user','preview', clickedAerial.id, [clickedAerial.meta.value, clickedAerial.meta.prescribed]);
    clickedAerial.previewOpen = !clickedAerial.previewOpen;
  }
}

// OPERATIONS (PERSISTENT INTERACTION)

const userUnset = function (aerial) {
  aerial.usage = 1;
  aerial.meta.selected = false;
  log.write('user','unset', aerial.id, [aerial.meta.value, aerial.meta.prescribed]);
  calculateAttackCvg();
  
}

const userSelect = function (aerial) {
  aerial.usage = 2;
  aerial.meta.selected = true;
  log.write('user','select', aerial.id, [aerial.meta.value, aerial.meta.prescribed]);
  calculateAttackCvg();
  guidance.reconsider(aerial);
}

const userDiscard = function (aerial) {
  aerial.usage = 0;
  aerial.meta.selected = false;
  log.write('user','discard', aerial.id, [aerial.meta.value, aerial.meta.prescribed]);
  calculateAttackCvg();
  guidance.reconsider(aerial);
}