/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina
  TODO
  + abstract timebin visualization
  + add attack records with lines that follow all the way
  + calculate real coverages
  + add hovering interaction
*/

let aerials = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
let attackDates = [];
let currentTimebin = '';
let hovered = '';
let data;

//// SKETCH

function preload() {
  attacks = loadTable('data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
}

function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  frameRate(4);
  // only for st. Poelten attack records
  attackDates = attacks.map( a => a.obj.DATUM).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
}

function draw() {
  hovered = resolveMouse();

  background(236);
  textSize(8), fill(0), noStroke();
  translate (0, 12);
  drawTimeline();
  if (currentTimebin === '') drawTimemap();
  else drawTimebin(currentTimebin);
  // debug();

  const drawAttack = function (r) {
    strokeWeight(r/2), stroke(0);
    line(0,0,0,r);
    fill(0), noStroke();
    beginShape();
    vertex(0,-r/2), vertex(r/2,-r), vertex(r/2,0), vertex(0,r/2);
    vertex(-r/2,0),  vertex(-r/2,-r), vertex(0,-r/2);
    endShape();
  }
  attackDates.forEach( a => {
    push(), translate(timelinemap(a),-4);
    drawAttack(4);
    pop();
  })
}

//// VISUALIZATION

const drawViewfinder = function (timebinData, r) {
  noStroke(), fill(126);
  arc(0,0,r,r,0,PI, CHORD);
  noStroke(), fill(166);
  arc(0,0,r,r,PI,0, CHORD);
  stroke(0), fill(0);
  arc(0,0,r/2,r/2,0,PI, CHORD);
  noStroke(), fill(255);
  arc(0,0,r/2,r/2,PI,0, CHORD);
  
}

const timelinemap = function (datum) {
  return map(Date.parse(datum),Date.parse(aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1]), 20, width-20);
}

const drawTimeline = function () {
  let years = aerialDates.map( a => a.slice(0,4)).filter(onlyUnique);
  textAlign(CENTER), textStyle(BOLD), textFont('Helvetica');
  years.forEach( a => text(a,timelinemap(a.concat('-01-01')),0));
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    strokeWeight(a===hovered || a===currentTimebin? 1:.2), noFill(), stroke(126);
    line(x,5,x,0)
  });
}

const drawTimemap = function () {
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    let x2 = map(aerialDates.indexOf(a),0,aerialDates.length-1, 20, width-20);
    fill(230,140,20,60), noStroke();
    if (a===hovered) rect(x2-10,80,20,height-24-80);
    let c = a === currentTimebin? color(255,30,30):color(126);
    
    

    
    
    aerials.filter( b => b.meta.Datum === a).forEach( (b, i, arr) => {
      push(), translate(x2,min(80+i*20,map(i,0,arr.length,80,height-20)));
      drawAerial(b);
      pop();
    })

    push(), translate(x2,55);
    drawViewfinder([],20);
    pop();

    strokeWeight(a===hovered? 1:.2), noFill(), stroke(c);
    // beginShape();
    // bezier(x, 5, x, 50/2, x2, 25, x2, 50);
    // endShape();
    line(x,5,x2,50)
    push(), noStroke(), fill(100);
    text(a.slice(5).slice(a.slice(5,6)==='0'?1:0).replace('-','.'),x2,height-12), pop();
  });
  
}

const drawTimebin = function (aerialDate) {
  noStroke(), fill(126);
  text(currentTimebin,timelinemap(currentTimebin),20);

  let timebin = aerials.filter( a => a.meta.Datum === aerialDate);
  let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
  let details = timebin.filter( a => a.meta.MASSTAB <= 20000);
  let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);

  const drawTimebinRow = function(aerialRow, r) {
    aerialRow.forEach( (a,i,arr) => {
      let p = i/(arr.length-1)*PI-PI/2;
      push(), translate(width/2,55), rotate(-i/(arr.length-1)*PI+PI/2);
      stroke(0,50), noFill(), strokeWeight(5);
      if (i > 0 && a.meta.Sortie == arr[i-1].meta.Sortie) arc(0,0,r*2,r*2,PI/2,PI/2+PI/(arr.length-1));
      pop();
    });
    aerialRow.forEach( (a,i,arr) => {
      let p = i/(arr.length-1)*PI-PI/2;
      // let x = width/2+sin(p)*r;
      // let y = 55+cos(p)*r;
      push(), translate(width/2,55), rotate(-i/(arr.length-1)*PI+PI/2);
      translate(0,r);
      drawAerial(a);
      noStroke(), fill(0), textStyle(NORMAL), textSize(6), textAlign(CENTER);
      if (PI*(r+20)/arr.length > 22) text(a.meta.Bildnr,0,20);
      textAlign(CENTER), textStyle(BOLD), rotate(-PI/2);
      if (i == 0 || arr[i-1].meta.Sortie!==a.meta.Sortie) text(a.meta.Sortie,0,max(-20,-PI*r/arr.length/4));
      pop();
    });
  }
  push(), translate(width/2,55);
  drawViewfinder([], 40), pop();
  drawTimebinRow(details, height-130);
  drawTimebinRow(overviews, height-90);

  // timebin.forEach( (a, i, arr) => {
  //   push(), translate(map(i,-1,arr.length,0,width),height-60);
  //   timebin.forEach( (b,j) => {
  //     if (j > i && a.meta.Sortie === b.meta.Sortie && a.meta.Abd+b.meta.Abd >= 200 ) {
  //       let l = width/(timebin.length+1)*(j-i);
  //       strokeWeight((a.meta.Abd+b.meta.Abd-100)/20), stroke(a.meta.Abd+b.meta.Abd == 200? color(0,20):color(0,20)), noFill();
  //       arc(l/2,0,l,l/4,-PI, 0);
  //     }
  //   })
  //   pop();
  // });
  // timebin.forEach( (a, i, arr) => {
  //   let R = (height-110);
  //   let p = i/(arr.length-1)*PI-PI/2;
  //   let x = width/2+sin(p)*R;
  //   let y = 55+cos(p)*R;
  //   timebin.forEach( (b,j) => {
  //     let p2 = j/(arr.length-1)*PI-PI/2;
  //     let x2 = width/2+sin(p2)*R;
  //     let y2 = 55+cos(p2)*R;
  //     if (j > i && a.meta.Sortie === b.meta.Sortie && a.meta.Abd+b.meta.Abd >= 200 ) {
  //       strokeWeight((a.meta.Abd+b.meta.Abd-100)/20), stroke(a.meta.Abd+b.meta.Abd == 200? color(0,20):color(0,20)), noFill();
  //       let k = R;
  //       let p3 = (p+p2)/2;
  //       let x3 = width/2+sin(p3)*k;
  //       let y3 = 55+cos(p3)*k;
  //       let d = dist(x,y,x2,y2);
  //       let r = dist(x,y,x3,y3);
  //       let angle = 2*atan(d/2,r);
  //       let h = (d/2)/sin(angle);
  //       push(), translate(width/2,55), rotate(-(p+p2)/2+PI/2);
        // arc(k,0,r,r,-angle/2,angle/2);
        // arc(k,0,r,r,angle/2,-angle/2);
        // pop();
        // let p0 = ((j+i)/2)/(arr.length-1)*PI-PI/2;
        // let x0 = width/2+sin(p0)*(height-mouseX);
        // let y0 = 55+cos(p0)*(height-mouseX);
        // x0 = width/2;
        // y0 = 55;
        // push(), translate((height-mouseX),(height-mouseX));
        // drawArc(x0,y0,x2,y2,x,y);
        // pop();
        
        // line(x,y,x2,y2);
  //     }
  //   })
  // });
}

const drawAerial = function (aerial) {
  push(), stroke(0), strokeWeight(.8), drawingContext.setLineDash(aerial.meta.Abd == 100? 1:[2, 2]);
  fill(aerial.meta.LBDB? [238,195,99]:160);
  ellipse(0,0,sqrt(aerial.meta.Abd/aerial.meta.MASSTAB)*200);
  rotate((1-aerial.meta.Abd/100)*TAU/2-HALF_PI),stroke(2);
  pop();
}

//// INTERACTION

const resolveMouse = function () {
  if (mouseY < 55) return '';
  else {
    if (currentTimebin === '') return aerialDates[floor(map(mouseX,10,width-10,0,aerialDates.length))];
    else return currentTimebin;
  }
   
}

function mouseClicked() {
  currentTimebin = resolveMouse();
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
  // timebins = aerials.reduce( (bins, a) => { // EACH AERIAL appears twice, ONE WITH META ONE WITH FOOTPRINT ALSO
  //   if (bins[bins.length-1].length == 0 || bins[bins.length-1][0] === a.meta.Datum) bins[bins.length-1].push(a.meta.Datum);
  //   else bins.push([a.meta.Datum]);
  //   return bins;
  // }, [[]] );
  aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
  let flights = aerials.map( a => a.meta.Sortie).filter(onlyUnique);
  // data = {};
  // flights.forEach( flight => {
  //   flightAerials = aerials.filter( a => a.meta.Sortie === flight);
  //   details = flightAerials.filter( a => a.meta.MASSTAB <= 20000);
  //   overviews = flightAerials.filter( a => a.meta.MASSTAB > 20000);
  //   const analyze = function (arr) {
  //     let maxCvg = max(arr.map( a => a.meta.Abd));
  //     let paired = (arr.reduce( (agg, a) => agg+(a.meta.Abd==100?1:0), 0) >= 2);
  //     return {coverage: maxCvg, pair: paired}
  //   }
  //   data[flight] = {detail: analyze(details), overview: analyze(overviews)};
  // })
  // timebins.forEach( t => {

  // })

  // data = aerials.groupBy( a => a.meta.Sortie);
  // Object.keys(data).forEach( k => {
  //   data[k].detail = data[k].filter( a => a.meta.MASSTAB <= 20000);
  //   let coverage = max(data[k].detail.map( a => a.meta.Abd));
  //   let paired = (data[k].detail.filter( a => a.meta.Abd == 100).length >= 2)
  //   data[k].detail = {coverage: coverage, paired: paired};
  //   data[k].overview = data[k].filter( a => a.meta.MASSTAB > 20000);
  // })
  currentTimebin = '';
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
  textAlign(LEFT), noStroke(), fill(0);
  aerials.forEach( (a,i) => {
    text(a.id+' '+a.footprint+' '+Date.parse(a.meta.Datum)+' '+a.meta.Datum.split('-')[2], 0, i*12);
  });
  // aoi.forEach( (a, i) => {
  //   text(a.x+' '+a.y, 400, 12*i);
  // })
  attackDates.forEach( (a,i) => {
    text(a, 400, 12*i);
  });
  // availability.entries.forEach( (a,i) => {
  //   text(a, 400, 12*i);
  // });
}

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}