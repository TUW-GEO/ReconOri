/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina
  TODO
  + add time filter
  + add other filters (transparencies)
  + make button to change timemode
  + move viewfinders to attacks (and erase viewfinder for flights, just leave interattack interest: in-direct answer)
  + add hovering interaction
  + add usage and availability
  + add different time layouts
  + add prescribing guidance

  IMPORTANT DEV NOTICE
  + using certain p5 functions (e.g., abs, map, probably ones that overload js) at certain points makes plugin crash on reload
  + only 3 AOIs working: st. polten, 04 & 10 (since interest function implemented)
  + 2 datasets from Vienna are not working
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
let visible = [];
let isSmall = true; // for small AOIs such as St.Poelten and Vienna
let isWien = true;
let topDiv = 12;
let projects = ['Seybelgasse', 'Postgasse', 'Franz_Barwig_Weg12', 'Central_Cemetery', 'Breitenleer_Str'];
let orientingOn = true;
let timeMode = 'chronological';
let clickables = [];
let hoverables = [];
let aniSpeed = .5;

//// SKETCH

function preload() {
  attacks =  loadTable(isWien?'data/AttackList_Vienna.xlsx - Tabelle1.csv':'data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
  selected = loadTable('data/Selected_Images_'+projects[0]+'.csv', 'header').rows;
}

function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  frameRate(14);
  // only for non st. Poelten attack records (DATUM vs. Datum)
  selected = selected.filter( a => a.obj['#']).map( a => {return {Sortie:a.obj['Sortie-Nr.'], Bildnr:a.obj['Image']}});
  selected.forEach( a => {
    let nrs = a.Bildnr.split('-');
    if ( nrs.length==2) {
      let nrs2 = ''
      for ( let x = parseInt(nrs[0]); x <= parseInt(nrs[1]); x++) nrs2 += x + (x!=parseInt(nrs[1])?'-':'');
      a.Bildnr = nrs2;
    }
  })

  const timeModeButton = {
    id: 'timeModeButton',
    pos: [5,5],
    r: 3,
    draw: function () {
      push(), noStroke(), fill(10,150,150);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      timeMode = (timeMode === 'chronological'? 'flights':'chronological');
    }
  }
  clickables.push(timeModeButton);

  console.log(JSON.stringify(selected));
  attackDates = attacks.filter(a => a.obj[isWien?'Datum':'DATUM']).map( a => a.obj[isWien?'Datum':'DATUM']).slice(0,attacks.length-1)
  .map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
}

function draw() {
  hovered = resolveMouse();
  hoveredAerial = resolveMouseAerial();
  background(250);//236
  textSize(8), fill(0), noStroke();
  // translate (0, 12);
  drawTimeline();
  if (currentTimebin === '') drawTimemap();
  else drawTimebin(currentTimebin);
  if (aoi) attackDates.forEach( a => drawAttack(a, 4))
  clickables.forEach( a => a.draw());
}

//// VISUALIZATION

const drawAttack = function (attack, r) {
  let c = hovered === attack? color(255,130,20):56;
  push(), translate(timelinemap(attack),0);
  strokeWeight(.5), stroke(c);
  line(0,0,0,topDiv);
  fill(c), noStroke();
  // beginShape();
  // vertex(0,-r/2), vertex(r/2,-r), vertex(r/2,0), vertex(0,r/2);
  // vertex(-r/2,0),  vertex(-r/2,-r), vertex(0,-r/2);
  // endShape();
  pop();
}

const drawViewfinder = function (aggCvg, r) {
  // let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
  // let details = timebin.filter(a => a.meta.MASSTAB <= 20000);
  // let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);
  // const getMaxCvg = function (aerials) {
  //   return max(aerials.map( a=> a.meta.Cvg));
  // }
  // const getPaired = function (aerials, flights) {
  //   return flights.reduce( (v, flight) => {
  //     let flightAerials = aerials.filter( a => a.meta.Sortie === flight);
  //     return v || (flightAerials.reduce ( (agg, a) => agg+(a.meta.Cvg==100?1:0), 0) >= 2? true:false);
  //   }, false)
  // }
  // noStroke(), fill(166, getMaxCvg(overviews)==100?255:0);
  // if (getMaxCvg(overviews)==100) arc(0,0,r,r,0,PI, CHORD);
  // fill(166,getPaired(overviews,flights)?255:0);
  // if (getPaired(overviews,flights)) arc(0,0,r,r,PI,0, CHORD);
  // stroke(236), strokeWeight(1), fill(getMaxCvg(details)==100?100:236);
  // arc(0,0,r/2,r/2,0,PI, CHORD);
  // stroke(236), fill(getPaired(details,flights)?100:236);
  // if (getPaired(details,flights) || getPaired(overviews,flights)) arc(0,0,r/2,r/2,PI,0, CHORD);

  fill(100,100,200), noStroke();
  ellipse(0,0,sqrt(aggCvg[1])*r);
  fill(150,150,255);
  ellipse(0,0,sqrt(aggCvg[0])*r);
  stroke(r), noFill(), strokeWeight(.5);
  ellipse(0,0,sqrt(1)*r);
  
}

const timelinemap = function (datum) {
  let linear = map( Date.parse(datum), Date.parse(aerialDates[0]), Date.parse(aerialDates[aerialDates.length-1]), 20, width-20);
  return linear;
}

const drawTimeline = function () {
  let years = aerialDates.map( a => a.slice(0,4)).filter(onlyUnique);
  textAlign(CENTER), textStyle(NORMAL), textFont('Helvetica'), textSize(15), fill(186);
  years.forEach( a => text(a,timelinemap(a.concat('-01-01')),topDiv));
  aerialDates.forEach( a => {
    let x = timelinemap(a);
    strokeWeight(a===hovered || a===currentTimebin? 1:.2), noFill(), stroke(126);
    line(x,0,x,topDiv)
  });
  // draw days as points
  // let oneDay = 60 * 60 * 24 * 1000;
  // let startDate = Date.parse(aerialDates[0]);
  // let lastDate = Date.parse(aerialDates[aerialDates.length-1]);
  // let totalDays =  Math.round(Math.abs((startDate - lastDate) / oneDay));
  // let aDay = startDate;
  // for (let i=0; i<=totalDays; i++) {
  //   stroke(0), strokeWeight(1.5);
  //   point(timelinemap(aDay),10);
  //   aDay = new Date(new Date(aDay).getTime() + oneDay);
  // }
}

const drawFlights = function ( aerials, params ) {

  const drawFlightCurve = function(timebin, params) {
    noFill(), stroke(100), strokeWeight(1);
    [1,-1].forEach ( m => {
      beginShape();
      vertex(params.anchor[0],min(80-20,map(-1,-1,timebin.length+1,80-20,height))); //y position wron
      timebin.forEach( (b,i,arr) => {
        let x = b.vis.pos[0] + (b.meta.p==m?0:-params.mod*2*b.meta.p);// + (b.meta.Bildnr>=3000&&b.meta.Bildnr<5000?m:0);
        let y = b.vis.pos[1];
        vertex( x, y );
      })
      vertex(params.anchor[0]+(timebin.length+1)*params.slope,min(80+timebin.length*20,map(timebin.length,0,timebin.length,80,height-20)))
      endShape();
    });
  }

  aerials.sort( (a,b) => (new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1))? 1:-1 )
  .sort( (a,b) => (a.meta.Sortie > b.meta.Sortie)?1:-1)
  .forEach( (a, i, arr) => {
    a.vis.tpos = [
      params.anchor[0]+(i+1)*params.slope+params.mod*a.meta.p,
      min(80+i*20,map(i,0,arr.length,80,height-20))
    ];
  });

  drawFlightCurve( aerials, params );
  drawFlightCurve( aerials, params );
  aerials.forEach( a => {
    a.vis.pos[0] = lerp(a.vis.pos[0],a.vis.tpos[0],aniSpeed);
    a.vis.pos[1] = lerp(a.vis.pos[1],a.vis.tpos[1],aniSpeed);
    push(), translate(a.vis.pos[0],a.vis.pos[1]);
    drawAerial(a);
    pop();
  });
}

const drawTimemap = function () {
  aerialDates.forEach( (a, i, arr) => {
    let x = timelinemap(a);
    let x2 = timeMode === 'chronological'? x:map( i, 0, arr.length-1, 20, width-20 );
    fill(230,140,20,60), noStroke();
    if (a===hovered) rect(x2-10,80,20,height-24-80);
    let c = a === currentTimebin? color(255,30,30):color(126);
    // Draw attack lines
    if (i != 0) attackDates.forEach( b => {
      stroke(0), strokeWeight(a===hovered? 1:.5);
      if (Date.parse(b) > Date.parse(arr[i-1]) && Date.parse(b) <= Date.parse(a)) {
        let x3 = map( i-.5, 0, arr.length-1, 20, width-20 );
        if (timeMode === 'chronological') {
          line( timelinemap(b), topDiv, timelinemap(b), height );
        } else {
          line( timelinemap(b), topDiv, x3, min(55,height-35) );
          line( x3, min(55,height-35), x3, height );
        }
      }
    });

    let timebin = aerials.filter( b => b.meta.Datum === a);
    if (height >= 150) drawFlights( timebin, { anchor:[x2,66], mod:5, slope:0 } );

    strokeWeight(a===hovered? 1:.2), noFill(), stroke(c);
    // line(x,topDiv,x2,min(55,height-35))
    push(), noStroke(), fill(100), textStyle(NORMAL), textSize(8);
    if (timeMode !== 'chronological') text(a.slice(5).slice(a.slice(5,6)==='0'?1:0).replace('-','.'),x2,height);
    pop();

    push(), translate(x2,min(55,height-35));
    // drawViewfinder(timebins[i],18);
    pop();
  });

}

const drawTimebin = function (aerialDate) {
  visible = [];
  noStroke(), fill(126), textSize(9);
  text(currentTimebin,timelinemap(currentTimebin),20);

  let timebin = aerials.filter( a => a.meta.Datum === aerialDate);
  // let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
  let details = timebin.filter(a => a.meta.MASSTAB <= 20000);
  // let detailsR = timebin.filter( a => a.meta.Bildnr >=3000  && a.meta.Bildnr < 4000 && a.meta.MASSTAB <= 20000);
  // let detailsL = timebin.filter( a => a.meta.Bildnr >= 4000 && a.meta.Bildnr < 5000 && a.meta.MASSTAB <= 20000);
  let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);

  const drawTimebinRow = function(aerialRow, r) {
    aerialRow.sort( (a,b) => new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1) ? 1:-1 ).sort( (a,b) => a.meta.Sortie > b.meta.Sortie?1:-1);
    // draw flight arcs
    aerialRow.forEach( (a,i,arr) => { 
      let p = i/(arr.length-1)*PI-PI/2;
      push(), translate(width/2,55), rotate(-i/(arr.length-1)*PI+PI/2);
      stroke(220), noFill(), strokeWeight(5);
      if (i > 0 && a.meta.Sortie == arr[i-1].meta.Sortie) arc(0,0,r*2,r*2,PI/2,PI/2+PI/(arr.length-1));
      pop();
    });
    // draw aerials
    aerialRow.forEach( (a,i,arr) => { 
      let p = -i/(arr.length-1)*PI+PI/2;
      let x = width/2+sin(p)*r;
      let y = 55+cos(p)*r;
      a.vis.pos = [x,y];
      // visible.push(a);
      push(), translate(width/2,55), rotate(p);
      translate(0,r);
      drawAerial(a);
      noStroke(), fill(0), textStyle(NORMAL), textSize(6), textAlign(CENTER);
      if (PI*(r+20)/arr.length > 22) text(a.meta.Bildnr,0,20);
      textAlign(CENTER), textStyle(BOLD), rotate(-PI/2);
      if (i == 0 || arr[i-1].meta.Sortie!==a.meta.Sortie) text(a.meta.Sortie,0,i==0?-20:-PI*r/arr.length/4);
      pop();
    });
  }
  
  push(), translate(66-15,66-15);
  drawViewfinder(timebins[aerialDates.indexOf(aerialDate)], 30), pop();
  drawFlights( timebin, { anchor: [66,66], mod:15, slope:30 } )
  // drawTimebinRow(details, height-130);
  // drawTimebinRow(overviews, height-90);
}

const drawAerial = function (aerial) {
  let r = sqrt(aerial.meta.Cvg/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
  if (r == 0) r = 4;
  aerial.vis.r = r;
  let interest = color( 125-aerial.meta.interest*100, 125+aerial.meta.interest*50, 125+aerial.meta.interest*175 );
  let isSelected = selected.filter( b => aerial.meta.Sortie === b.Sortie && b.Bildnr.indexOf( aerial.meta.Bildnr ) >= 0 ).length==1;
  push(), stroke(isSelected?color(255,155,255):100), strokeWeight(isSelected?2:1);
  // aerial.meta.MASSTAB > 20000? drawingContext.setLineDash([2, 2]):null;
  // fill( r>0? 155+aerial.meta.interest*50*sin(frameCount/(3/aerial.meta.interest)): 236 );
  if (orientingOn) fill(aerial.interest.Cvg>0? interest: 236 );
  else fill(200);
  ellipse( 0, 0, r*2)
  fill(isSelected?color(255,155,255):100), noStroke();
  if (aerial.meta.LBDB) ellipse ( 0, -r/3*2, r/3*2)
  noStroke(), fill(100), textSize(7), textAlign(aerial.meta.p==1?LEFT:RIGHT);
  if (currentTimebin) text(aerial.meta.Bildnr, 15*(aerial.meta.p==1?1:-1), 3);
  if (aerial == hoveredAerial) {
    fill(255,60), stroke(255);
    rect(0,0,120,-100);
    fill('black'), textSize(11), textAlign(LEFT);
    Object.keys(aerial.interest).forEach( (k,i) => {
      text(k+': '+(typeof(aerial.interest[k])==='number'?round(aerial.interest[k],2):aerial.interest[k]),10,-78+12*i);
    })
    
  }
  // noFill(), stroke(0), strokeWeight(1);
  // ellipse(-mod,0,aerial.meta.Abd/5);
  pop();
}

//// INTERACTION

const resolveMouse = function () {
  if (mouseY < 55) return '';
  else {
    if (currentTimebin === '') return aerialDates[floor(map(mouseX,10,width-10,0,aerialDates.length))];
    else return currentTimebin;
    // {
    //   return visible.filter( a => dist(a.visualization.pos[0], a.visualization.pos[1], mouseX, mouseY) <= a.visualization.size);
    // };
  }
}
const resolveMouseAerial = function () {
  return aerials.filter( a => a.meta.Datum === currentTimebin && dist(a.vis.pos[0], a.vis.pos[1], mouseX, mouseY) <= a.vis.r)[0];
}

function mouseClicked() {
  clickables.forEach( a => (dist(a.pos[0],a.pos[1],mouseX,mouseY) <= a.r)? a.click():null );
  // currentTimebin = resolveMouse();
  // sendObject(aerials.filter( a => a.meta.Datum === currentTimebin).map(a => a.id), 'link');

  // let pickedAerial = resolveMouseAerial();
  // else sendObject(resolveMouseAerial(), 'link');
  // sendObject(visible.filter( a => dist(a.visualization.pos[0], a.visualization.pos[1], mouseX, mouseY) <= a.visualization.size, 'link'));
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//// COMMUNICATION

// wk
qgisplugin.aerialsLoaded.connect(function(_aerials) {
  console.log(JSON.stringify(_aerials, null, 4));
  aerials = _aerials.sort( (a,b) => a.meta.Datum > b.meta.Datum).filter( a => a.footprint);
  aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
  currentTimebin = '';
});

qgisplugin.attackDataLoaded.connect(function(_attackData){
  console.log("Attack data: " + JSON.stringify(_attackData, null, 4));
  // only for non st. Poelten attack records (DATUM vs. Datum)
  // attackDates = attacks.filter(a => a.obj.Datum).map( a => a.obj.Datum).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
});
  
qgisplugin.areaOfInterestLoaded.connect(function(_aoi){
  const toPolygon = function (footprint) {
    let convertedCoorArr = [footprint.map( a => turf.toWgs84([a.x,a.y]))];
    convertedCoorArr[0].push(convertedCoorArr[0][0]);
    return turf.polygon(convertedCoorArr);
  }

  console.log("Area of interest loaded: " + JSON.stringify(_aoi, null, 4));
  aoi = _aoi;
  let aoiPoly =  toPolygon(aoi);
  aoiArea = turf.area(aoiPoly);
  console.log("Area of AOI: " + aoiArea);

  aerials.forEach( a => {
    let aerialPoly = toPolygon(a.footprint);
    let center = turf.center(aerialPoly);
    let radius = Math.sqrt(2)/1.75*turf.distance(aerialPoly.geometry.coordinates[0][0],aerialPoly.geometry.coordinates[0][1],{units: 'kilometers'});
    let options = {steps: 10, units: 'kilometers'};
    let circle = turf.circle(center, radius, options);
    aerialPoly = circle;
    let intersection = turf.intersect( aerialPoly, aoiPoly);
    let cvg = intersection? turf.area(intersection): 0;
    let info = cvg/a.meta.MASSTAB;
    a.polygon = {
      full: aerialPoly,
      aoi: intersection
    }
    a.vis = { pos: [0,0] };
    a.interest = {};
    a.meta.Cvg = cvg/aoiArea;
    a.interest.Cvg = a.meta.Cvg;
    a.interest.owned = a.meta.LBDB?1:0;
    a.meta.information = info;
    a.meta.interest = 0;
    let nr = new String(a.meta.Bildnr);
    a.meta.p = nr.slice(0,1) === '3'? -1:nr.slice(0,1) === '4'? 1:0; // polarity: -1, 0, 1 (left, center, right)
  });

  const aggregateCoverage = function( polygons ) {
    polygons = polygons.filter( a => a );
    if (polygons.length > 0) {
      polygons = polygons.reduce( (union, a) => turf.union(union,a), polygons[0]);
      return turf.area(polygons)/aoiArea;
    } else return 0;
  }

  timebins = []; // restart on reload
  //calculate guidance (isolate)
  aerialDates.forEach( d => {
    let timebin = aerials.filter( a => a.meta.Datum === d);
    let details = timebin.filter(a => a.meta.MASSTAB <= 20000 && a.polygon.aoi);
    let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000 && a.polygon.aoi);

    
    timebins.push( [
      aggregateCoverage(details.map( a => a.polygon.aoi)),
      aggregateCoverage(overviews.map( a => a.polygon.aoi))
    ]);
    
    details.forEach( a => {
        let possiblePairs = details.filter( b => b.meta.Sortie === a.meta.Sortie && Math.abs(b.meta.Bildnr-a.meta.Bildnr) == 1 && b.polygon.aoi && a!=b );
        let pairedIntersection = 0;
        a.interest.type = 'detail'
        if (possiblePairs.length > 0) {
          let possiblePairsPoly =  possiblePairs.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), possiblePairs[0].polygon.aoi);
          pairedIntersection = turf.intersect( a.polygon.aoi, possiblePairsPoly );
          a.interest.paired = pairedIntersection? turf.area(pairedIntersection)/turf.area(a.polygon.aoi):0;
          a.meta.interest = (a.meta.Cvg + (pairedIntersection? turf.area(pairedIntersection)/aoiArea:0))*(a.meta.LBDB?2:1);
        } else a.meta.interest = a.meta.Cvg*(a.meta.LBDB?2:1);
        a.interest.pre = a.meta.interest;
    })
    overviews.forEach( a => {
      a.interest.type = 'overview'
      if (details.length > 0) {
        let detailPoly = details.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), details[0].polygon.aoi);
        let intersectionPoly = turf.intersect( a.polygon.aoi, detailPoly );
        a.interest.overlap = -(intersectionPoly? turf.area(intersectionPoly)/turf.area(a.polygon.aoi):0);
        a.meta.interest = .5*(a.meta.Cvg - (intersectionPoly? turf.area(intersectionPoly)/aoiArea:0))*(a.meta.LBDB?2:1);
      } a.meta.interest = .5*a.meta.Cvg*(a.meta.LBDB?2:1);
      a.interest.pre = a.meta.interest;
      // shared information-based timebin-secluded interest measure calculation
      // timebin.forEach( b => {
      //   if (a.polygon.aoi && b.polygon.aoi && a != b) {
      //     let inter = turf.intersect( a.polygon.aoi, b.polygon.aoi );
      //     if (inter) sharedInfo += turf.area(inter)/b.meta.MASSTAB;
      //     a.meta.interest = a.meta.Cvg - ;
      //   } else a.meta.interest = a.meta.Cvg;
      // })
    })
    
    let ranges = timebin.map( a => a.meta.interest).reduce ( (agg, a) => [Math.min(agg[0],a),Math.max(agg[1],a)], [0,0]);
    timebin.forEach( a => {a.meta.interest = a.meta.interest/ranges[1]; a.interest.post=a.meta.interest}); // normalize by range
  })
});

qgisplugin.aerialFootPrintChanged.connect(function(imgId, _footprint) {
  console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
  footprints[imgId] = _footprint;
  // aerials = aerials.map( a => a.id === imgId? {...a, footprint: _footprint}: a); // is there ellipse syntax?
});

qgisplugin.aerialAvailabilityChanged.connect(function(imgId, _availability, path){
  console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
  // availability[imgId] = _availability;
});

qgisplugin.aerialUsageChanged.connect(function(imgId, usage){
  console.log("Usage of " + imgId + " has changed to " + usage);
});

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object, interaction) {
  document.getElementById(interaction).href = "#" +  encodeURIComponent(JSON.stringify(object));
  document.getElementById(interaction).click();
  return 0;
}

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}