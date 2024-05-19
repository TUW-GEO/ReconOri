/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina

  IMPORTANT NOTES
  + Because of the harcoded attack dates, this version is currently only working for Vienna projects

  DEV NOTES
  + using certain p5 functions (e.g., abs, map, probably the ones that overload js) at certain points makes plugin crash on reload
*/

let aoiPoly, aoiArea;
let aerials = [];
let attackDates = ["1944-03-17","1944-05-24","1944-05-29","1944-06-16","1944-06-26","1944-07-08","1944-07-16","1944-08-22","1944-08-23","1944-09-10","1944-10-07","1944-10-11","1944-10-13","1944-10-17","1944-11-01","1944-11-03","1944-11-05","1944-11-06","1944-11-07","1944-11-17","1944-11-18","1944-11-19","1944-12-02","1944-12-03","1944-12-11","1944-12-18","1944-12-27","1945-01-15","1945-01-21","1945-02-07","1945-02-08","1945-02-13","1945-02-14","1945-02-15","1945-02-19","1945-02-20","1945-02-21","1945-03-04","1945-03-12","1945-03-15","1945-03-16","1945-03-20","1945-03-21","1945-03-22","1945-03-23","1945-03-30"];
let attacks = [];
// let attackTable = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
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
let orientingOn = true;
let userOn = true; // User can operate
let prescribingOn = true;
let prGuidance = {};
let eqClasses;
let userSolutionValues = [];
let testOn = true; // Should be false for real tests
const TASK = 2;
const test = true;
const groundColor = 236; //236
const dayRange = 25;
const isSmall = true; // for small AOIs such as Vienna samples
const isWien = true;
const h = [20,95,130];
const projects = ['Seybelgasse', 'Postgasse', 'Franz_Barwig_Weg', 'Central_Cemetery', 'BreitenleerStr'];
const project = 0;
const PRESELECTED = true; // Guidance starts from preselected data as prescription

//// SKETCH

function preload() {
  font1 = loadFont('assets/Akkurat-Mono.OTF');
  attackTable =  loadTable(isWien?'data/AttackList_Vienna.xlsx - Tabelle1.csv':'data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
  preselected = loadTable('data/Selected_Images_'+projects[project]+'.csv', 'header').rows;
}


function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  resetSketch();
}

// function convertDateFormat(inputDate) {
//   const [day, month, year] = inputDate.split('.');
//   const date = new Date(year, month - 1, day); // Subtract 1 because months are 0-indexed
//   return date.toISOString().split('T')[0]; // Formats to YYYY-MM-DD
// }

// function areDatesEquivalent(date1, date2) {
//   const formattedDate2 = convertDateFormat(date2);
//   return date1 === formattedDate2;
// }

function resetSketch() {
  // TASK BEHAVIOUR FOR USER STUDY
  // if (TASK==2) {
  //   guidance.prescribed.forEach( a => guidance.reconsider(a));
  // }
  // ATTACK TABLE DATA
  attackRows = attackTable.map ( a => a.obj );
  console.log(JSON.stringify(attackRows));
  attackObjs = [];
  let lastAttack = null;
  attackRows.forEach( row => {
    row.pos = [0,0];
    if (row["Datum"]) {
      let datum = row["Datum"].split('/');
      if (datum[0].length == 1) datum[0] = "0"+datum[0];
      if (datum[1].length == 1) datum[1] = "0"+datum[1];
      // console.log(datum);
      let formattedDate = datum[2]+"-"+datum[1]+"-"+datum[0];
      // console.log(formattedDate);
      let attack = attacks.find( a => formattedDate == a.date);
      // console.log(attack);
      
      if (attack) {
        Object.keys(row).forEach( key => {
          attack[key] = row[key];
        });
        lastAttack = attack;
      } 
    } else if (lastAttack && row["Ziel"]) {
      lastAttack["Bomb Type"] = lastAttack["Bomb Type"]+"\n"+row["Bomb Type"];
      lastAttack["Ziel"] = lastAttack["Ziel"]+"\n"+row["Ziel"];
    }
  });
  // console.log(JSON.stringify(attacks));
  // attackDates.forEach( d => )
  // console.log(JSON.stringify(attackObjs.map(a => (a.Datum)).filter(a => a)));

  let preselection = preselectImages(preselected);
  // if (PRESELECTED) preselection.forEach( a => guidanceSelect(a));

  timeline.reset();
  clickables.push(timeModeButton);
  clickables.push(finishButton);
  clickables.push(orButton);
  clickables.push(prButton);
  calculateAttackCvg();
}

function draw() {
  background(groundColor);

  if (prescribingOn) guidance.loop();
  drawTimeline();
  drawEqClasses();
  drawTimemap();
  drawStats();
  if (aoi.length > 0) attackDates.forEach( (a,i) => drawAttack(attacks[i], 8))
  clickables.forEach( a => a.draw());

  // HOVERINGS
  hoverAerials();
  hoverAttacks();
  drawTimelineDrag();
//  if (frameCount == 10) noLoop();
  // drawDateTooltip();

  // FOR EVALUATION TASKS
  // if (test && !testOn) {
  //   fill(groundColor), noStroke();
  //   rect(0,0,width,height-20);
  //   fill(0), noStroke(), textSize(18), textAlign(CENTER);
  //   text("Click to start",width/2,height/2);
  //   textSize(14);
  //   text("Orienting "+(orientingOn?"On":"Off"),width/2,height/2+40);
  //   text("Prescribing "+(prescribingOn?"On":"Off"),width/2,height/2+60);
  // }
}


//// GENERAL /////

const orColor = function (a) {
  return lerpColor(color(220),color(0,130,255),a);
}

const prColor = function (a) {
  return color(255,100,30);
}

const urColor = function (a) {
  return lerpColor(color(255),color(70,200,70),a);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  h[3] = height-30; // Adjust ruler
}

//// UTILS

function formatDate(inputString) {
  // Create a Date object from the input string
  const date = new Date(inputString);

  // Extract the day, month, and year
  const day = String(date.getDate()).padStart(2, '0'); // padStart ensures two digits
  const month = String(date.getMonth() + 1).padStart(2, '0'); // getMonth returns 0-based months, so we add 1
  const year = date.getFullYear();

  // Return the formatted date string
  return `${year}-${month}-${day}`;
}

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

// PRESELECTED IMAGES FILE PROCESSING
const preselectImages = function (preselected) {
  console.log("***PRESELECTION PROCESSING***");
  // Process selected images file --there are cases with no flight number
  preselected = preselected.filter( a => a.obj['Image']).map( (a, i, arr) => {
      return {
        Sortie: (a.obj['Sortie-Nr.']? a.obj['Sortie-Nr.']: arr[i-1].obj['Sortie-Nr.']),
        Bildnr: a.obj['Image']
      }
  }); 
  // Two cases to account for: separated by - (range) or , (singles)
  preselected.forEach( a => {
    if (a.Bildnr.indexOf('-') >= 0) {
      let nrs = a.Bildnr.split('-');
      let nrs2 = '';
      for ( let x = parseInt(nrs[0]); x <= parseInt(nrs[1]); x++) nrs2 += x + (x!=parseInt(nrs[1])?'-':'');
      a.Bildnr = nrs2;
    } else if (a.Bildnr.indexOf(',') >= 0) {
      let nrs = a.Bildnr.split(',');
      a.Bildnr = nrs.reduce( (agg,nr) => agg.concat(nr+'-') , '');
    } 
  });
  
  let preselectedAerials = []
  // Add status to aerial object
  aerials.forEach( a => {
    let isSelected = preselected.filter( b => a.meta.Sortie === b.Sortie && b.Bildnr.indexOf( a.meta.Bildnr ) >= 0 && (test?Date.parse("1945-01-01") < a.time:true)).length==1;
    a.meta.selected = isSelected;
    a.usage = isSelected? 2: 1; // TODO: Signal to plugin an image is selected
    if (isSelected) preselectedAerials.push(a);
  }); 
  // console.log(preselectedAerials.map(a => a.id));
  return preselectedAerials;
}

// ATTACK DATA
// function createAttacks(attackTable) {
//   let attackData = [];
//   let previousValidDatum = null;

//   attackTable.map( a => a.obj ).forEach((row, index) => {
//       if (row.Datum!== "") {
//           // If the current row has a valid Datum, add it to the attacks array
//           attackData.push(row);
//           previousValidDatum = row.Datum; // Update the previousValidDatum to the current row's Datum
//       } else {
//           // If the current row's Datum is empty, concatenate its fields with the previousValidDatum
//           const concatenatedRow = {
//              ...previousValidDatum, // Include all fields from the previousValidDatum
//              ...row // Include all fields from the current row
//           };
//           attackData.push(concatenatedRow);
//       }
//   });
//   console.log(JSON.stringify(attackData));
//   return attackData;
// }