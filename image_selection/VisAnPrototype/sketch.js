/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina
  TODO
  + add filtering interaction
  + timebin view
  + abstract timebin visualization
  + find image pairs
  + add attack records with lines that follow all the way
  + calculate real coverages
*/

let aerials = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
let currentTimebin = '';

//// SKETCH

function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  frameRate(4);
}

function draw() {
  background(236);
  textSize(8), fill(0), noStroke();
  translate (0, 12);
  drawTimemap();
  if (currentTimebin === '') drawTimeline();
  else drawTimebin(currentTimebin);
  // debug();
}

//// VISUALIZATION

const timelinemap = function (datum) {
  // return map(Date.parse(datum),Date.parse(aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1]), 20, width-20);
  return map(Date.parse(datum),Date.parse('1943-01-01'),Date.parse('1946-01-01'), 20, width-20);
}

const drawTimemap = function () {
  let years = ['1943','1944','1945','1946'];
  textAlign(CENTER);
  years.forEach( a => text(a,timelinemap(a.concat('-01-01')),0));
}

const drawTimeline = function () {
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    stroke(160), strokeWeight(5);
    point (x,5);
    let x2 = map(aerialDates.indexOf(a),0,aerialDates.length-1, 20, width-20);
    strokeWeight(.2), noFill(), stroke(a === currentTimebin? 255: 0);
    beginShape();
    bezier(x, 5, x, 50/2, x2, 25, x2, 50);
    endShape();
    push(), noStroke(), fill(0);
    text(a.slice(5),x2,height-12), pop();
    
    aerials.filter( b => b.meta.Datum === a).forEach( (b, i, arr) => {
      push(), translate(x2,map(i,0,arr.length,55,height-20));
      drawAerial(b);
      pop();
      
      // noStroke();
      // text(b.meta.Sortie,x2,55+i*5); // why not working for all?
    })
  });
}

const drawTimebin = function (aerialDate) {
  text(currentTimebin,width/2,12);
  let timebin = aerials.filter( a => a.meta.Datum === aerialDate);
  timebin.forEach( (a, i, arr) => {
    push(), translate(map(i,-1,arr.length,0,width),height/2);
    drawAerial(a);
    stroke(0,50),strokeWeight(10), noFill();
    let l = width/(arr.length+1);
    if (arr[i+1] && a.meta.Sortie === arr[i+1].meta.Sortie  && a.meta.Abd+arr[i+1].meta.Abd-100 > 0) strokeWeight((a.meta.Abd+arr[i+1].meta.Abd-100)/10), arc(l/2,0,l,l,-PI,0);
    noStroke(), fill(0);
    text(a.meta.Sortie,0,20);
    text(a.meta.Bildnr,0,30);
    pop();
  });
}

const drawAerial = function (aerial) {
  stroke(0), strokeWeight(.8), drawingContext.setLineDash(aerial.meta.Abd == 100? 1:[2, 2]);
  fill(aerial.meta.LBDB? [238,195,99]:160);
  ellipse(0,0,sqrt(aerial.meta.Abd/aerial.meta.MASSTAB)*200); // aerial.meta.MASSTAB <= 20000? 12:8 // aerial.meta.Abd/aerial.meta.MASSTAB*2000
  push(), rotate((1-aerial.meta.Abd/100)*TAU/2-HALF_PI),stroke(2);
  // arc(0,0,sqrt(aerial.meta.Abd/aerial.meta.MASSTAB)*200,sqrt(aerial.meta.Abd/aerial.meta.MASSTAB)*200,0,aerial.meta.Abd/100*TAU);
  pop();
}

//// INTERACTION

function mouseClicked() {
  if (mouseY > 55) currentTimebin = aerialDates[floor(map(mouseX,10,width-10,0,aerialDates.length))];
  else currentTimebin = '';
  sendObject(aerials.filter( a => a.meta.Datum === currentTimebin).map(a => a.id));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//// COMMUNICATION

// wk
qgisplugin.aerialsLoaded.connect(function(_aerials) {
  console.log(JSON.stringify(_aerials, null, 4));
  aerials = _aerials.sort( (a,b) => a.meta.Datum > b.meta.Datum).filter( a => a.footprint);
  // aerials.forEach( a => {
  //   a.meta.richness = a.meta.Abd/a.meta.MASSTAB;
  // })
  timebins = aerials.reduce( (bins, a) => { // EACH AERIAL appears twice, ONE WITH META ONE WITH FOOTPRINT ALSO
    if (bins[bins.length-1].length == 0 || bins[bins.length-1][0] === a.meta.Datum) bins[bins.length-1].push(a.meta.Datum);
    else bins.push([a.meta.Datum]);
    return bins;
  }, [[]] );
  function onlyUnique(value, index, self) {
    return self.indexOf(value) === index;
  }
  aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
});
  
qgisplugin.areaOfInterestLoaded.connect(function(_aoi){
  console.log("Area of interest loaded: " + JSON.stringify(_aoi, null, 4));
  aoi = _aoi;
});

qgisplugin.aerialFootPrintChanged.connect(function(imgId, _footprint) {
  console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
  footprints[imgId] = _footprint;
  // this function is not being called yet and also there is no ellipses syntax
  // aerials = aerials.map( a => a.id === imgId? {...a, footprint: _footprint}: a);
});

qgisplugin.aerialAvailabilityChanged.connect(function(imgId, _availability, path){
  console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
  // availability[imgId] = _availability;
});

qgisplugin.aerialUsageChanged.connect(function(imgId, usage){
  console.log("Usage of " + imgId + " has changed to " + usage);
});

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object) {
  document.getElementById("link").href = "#" +  encodeURIComponent(JSON.stringify(object));
  document.getElementById("link").click();
}

//// DEBUGGING

const debug = function () {
  aerials.forEach( (a,i) => {
    text(a.id+' '+a.footprint+' '+Date.parse(a.meta.Datum)+' '+a.meta.Datum.split('-')[2], 0, i*12);
  });
  aoi.forEach( (a, i) => {
    text(a.x+' '+a.y, 400, 12*i);
  })
  Object.keys(footprints).forEach( (a,i) => {
    text(a, 400, 12*i);
  })
  aerialDates.forEach( (a,i) => {
    text(a, 400, 12*i);
  });
  timebins.forEach( (a,i) => { 
    text(a, 600, 12*i);
  });
  availability.entries.forEach( (a,i) => {
    text(a, 400, 12*i);
  });
}