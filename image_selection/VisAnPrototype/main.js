/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina

  IMPORTANT NOTES
  + Because of the attack dates, this version is currently only working for Vienna projects

  DEV NOTES
  + using certain p5 functions (e.g., abs, map, probably the ones that overload js) at certain points makes plugin crash on reload
  + hovering does not switch highlighting item if uninterrupted
*/

let aoiPoly, aoiArea;
let aerials = [];
let attackDates = ["1944-03-17","1944-05-24","1944-05-29","1944-06-16","1944-06-26","1944-07-08","1944-07-16","1944-08-22","1944-08-23","1944-09-10","1944-10-07","1944-10-11","1944-10-13","1944-10-17","1944-11-01","1944-11-03","1944-11-05","1944-11-06","1944-11-07","1944-11-17","1944-11-18","1944-11-19","1944-12-02","1944-12-03","1944-12-11","1944-12-18","1944-12-27","1945-01-15","1945-01-21","1945-02-07","1945-02-08","1945-02-13","1945-02-14","1945-02-15","1945-02-19","1945-02-20","1945-02-21","1945-03-04","1945-03-12","1945-03-15","1945-03-16","1945-03-20","1945-03-21","1945-03-22","1945-03-23","1945-03-30"];
let attacks = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
let attackData;
let currentTimebin = '';
let hoveredFlag, hoveredAerial = '';
let prevHoveredAerial = null;
let hovered = '';
let data;
let dragStart;
let timeMode = 'chronological';
let clickables = [];
let hoverables = [];
let aniSpeed = .5;
let timeline = {};
let log = { log: [] };
let orientingOn = true;
let prescribingOn = true;
let prGuidance = {};
let eqClasses;
let testOn = true; // Should be false for real tests
const test = false;
const groundColor = 256; //236
const dayRange = 25;
const isSmall = true; // for small AOIs such as Vienna samples
const isWien = true;
const h = [20,95,130];
const projects = ['Seybelgasse', 'Postgasse', 'Franz_Barwig_Weg', 'Central_Cemetery', 'BreitenleerStr'];
const project = 4;

//// SKETCH

function preload() {
  font1 = loadFont('assets/Akkurat-Mono.OTF');
  attackData =  loadTable(isWien?'data/AttackList_Vienna.xlsx - Tabelle1.csv':'data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
  if (project !== false) preselected = loadTable('data/Selected_Images_'+projects[project]+'.csv', 'header').rows;
}


function setup() {
  cnv = createCanvas(windowWidth,windowHeight);

  // LOG OBJECT
  log.write = function (operation_, obj_, guidance_) {
    this.log.push({
      operation: operation_,
      obj: obj_,
      t: new Date(),
      guidance: guidance_
    })
  }

  // TIMELINE OBJECT
  timeline.reset = function () {
    timeline.range = [Date.parse(test?"1945-01-01":aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1])];
    timeline.filterOn = false;
    sendObject([], 'unfilter');
    log.write('timeReset',0,'');
  }
  timeline.reset();
  timeline.map = function (datum) {
    return map( Date.parse(datum), this.range[0], this.range[1], 20, width-20);
  }
  timeline.inversemap = function (x) {
    return map(x, 20, width-20, this.range[0], this.range[1]);
  }
  timeline.filter = function (x1,x2) {
      this.range = [this.inversemap(x1), this.inversemap(x2)];
      this.filterOn = true;
      sendObject(aerials.filter( a => a.time >= this.range[0] && a.time <= this.range[1]).map(a => a.id), 'filter');
      log.write('timeFilter',this.range,'')
  }
  
  // PRESELECTED IMAGES FILE PROCESSING
  if (project || project === 0) {
    preselected = preselected.filter( a => a.obj['Image']).map( (a, i, arr) => {
      return {
        Sortie: (a.obj['Sortie-Nr.']? a.obj['Sortie-Nr.']: arr[i-1].obj['Sortie-Nr.']),
        Bildnr: a.obj['Image']}
    }); // Process selected images file --there are cases with no flight number
    preselected.forEach( a => {
      if (a.Bildnr.indexOf('-') >= 0) {
        let nrs = a.Bildnr.split('-');
        let nrs2 = ''
        for ( let x = parseInt(nrs[0]); x <= parseInt(nrs[1]); x++) nrs2 += x + (x!=parseInt(nrs[1])?'-':'');
        a.Bildnr = nrs2;
      } else if (a.Bildnr.indexOf(',') >= 0) {
        let nrs = a.Bildnr.split(',');
        a.Bildnr = nrs.reduce( (agg,nr) => agg.concat(nr+'-') , '');
      } // Two cases to account for: separated by - (range) or , (singles)
    });
    aerials.forEach( a => {
      let isSelected = preselected.filter( b => a.meta.Sortie === b.Sortie && b.Bildnr.indexOf( a.meta.Bildnr ) >= 0 && (test?Date.parse("1945-01-01") < a.time:true)).length==1;
      a.meta.selected = isSelected;
    }); // Add status to aerial object
  }

  //PRESELECT GUIDANCE
  // aerials.forEach( a => {
  //   let isSelected = a.meta.prescribed;
  //   a.meta.selected = isSelected;
  // });

  calculateAttackCvg();

  clickables.push(timeModeButton);
  clickables.push(finishButton);
  clickables.push(orButton);
  clickables.push(prButton);

  log.write( "prescribe", JSON.stringify(prGuidance.prescribed.map( a => a.id)), true);
}


function draw() {
  // MODEL INITIALIZATION - Prescribing guidance
  if (frameCount < 100) evaluate();

  background(groundColor);
  h[3] = height-30;
  textSize(8), fill(0), noStroke();
  drawTimeline();
  // drawCvgMatrix(); 
  drawEqClasses();
  drawTimemap();
  drawStats();
  // visualizeQuality();
  // qualityVis.draw();
  if (aoi.length > 0) attackDates.forEach( (a,i) => drawAttack(attacks[i], 8))
  clickables.forEach( a => a.draw());

  // HOVERING TIMELINE
  if (mouseY < h[1]) {
    stroke(0), strokeWeight(1);
    line(mouseX, 0, mouseX, h[1]);
    if (dragStart) {
      line(dragStart, 0, dragStart, h[1]);
      noStroke(), fill(0,20);
      rect(dragStart,0,mouseX-dragStart,h[1]);
    } 
  }

  // HOVERING AERIALS
  hoverAerials();

  // FOR EVALUATION TASKS
  if (test && !testOn) {
    fill(groundColor), noStroke();
    rect(0,0,width,height-20);
    fill(0), noStroke(), textSize(18), textAlign(CENTER);
    text("Click to start",width/2,height/2);
    textSize(14);
    text("Orienting "+(orientingOn?"On":"Off"),width/2,height/2+40);
    text("Prescribing "+(prescribingOn?"On":"Off"),width/2,height/2+60);
  }
}


//// GENERAL /////

const orColor = function (a) {
  return lerpColor(color(220),color(0,130,255),a);
}

const prColor = function (a) {
  return color(255,100,30);
}

const urColor = function (a) {
  return lerpColor(color(groundColor),color(70,225,70),a);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}