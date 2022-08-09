/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina
  TODO
  + add log
  + normalize orienting guidance within interattack periods
  + add hovering interaction
  + add prescribing guidance

  IMPORTANT DEV NOTICE
  + using certain p5 functions (e.g., abs, map, probably ones that overload js) at certain points makes plugin crash on reload
  + only 3 AOIs working: st. polten, 04 & 10 (since interest function implemented): 'Franz_Barwig_Weg12', 'Breitenleer_Str' not working
  + hovering does not switch highlighting item if untinterrupted
*/

let aoiPoly, aoiArea;
let aerials = [];
let attackDates = ["1944-03-17","1944-05-24","1944-05-29","1944-06-16","1944-06-26","1944-07-08","1944-07-16","1944-08-22","1944-08-23","1944-09-10","1944-10-07","1944-10-11","1944-10-13","1944-10-17","1944-11-01","1944-11-03","1944-11-05","1944-11-06","1944-11-07","1944-11-17","1944-11-18","1944-11-19","1944-12-02","1944-12-03","1944-12-11","1944-12-18","1944-12-27","1945-01-15","1945-01-21","1945-02-07","1945-02-08","1945-02-13","1945-02-14","1945-02-15","1945-02-19","1945-02-20","1945-02-21","1945-03-04","1945-03-12","1945-03-15","1945-03-16","1945-03-20","1945-03-21","1945-03-22","1945-03-23","1945-03-30"];
let preselected;
let attacks = [];
let aoi = [];
let footprints = {};
let availability = {};
let timebins = [];
let aerialDates = [];
let attackData;
let currentTimebin = '';
let hoveredFlag, hoveredAerial = '';
let hovered = '';
let data;
let visible = [];
let isSmall = true; // for small AOIs such as St.Poelten and Vienna
let isWien = true;
let h = [20,35,70];
let projects = ['Seybelgasse', 'Postgasse', 'Franz_Barwig_Weg12', 'Central_Cemetery', 'Breitenleer_Str'];
let orientingOn = true;
let timeMode = 'chronological';
let clickables = [];
let hoverables = [];
let aniSpeed = .5;
let timeline = {};
let log = { log: []};
let groundColor = 236;

//// SKETCH

function preload() {
  attackData =  loadTable(isWien?'data/AttackList_Vienna.xlsx - Tabelle1.csv':'data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
  preselected = loadTable('data/Selected_Images_'+projects[0]+'.csv', 'header').rows;
  font1 = loadFont('assets/Akkurat-Mono.OTF');
}


function setup() {
  cnv = createCanvas(windowWidth,windowHeight);
  frameRate(14);

  // LOG OBJECT
  log.write = function (operation_, obj_, guidance_) {
    this.log.push({
      operation: operation_,
      obj: obj_,
      t: new Date(),
      guidance: guidance_
    })
  }
  log.write('START','',orientingOn);

  // TIMELINE OBJECT
  timeline.reset = function () {
    timeline.range = [Date.parse(aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1])];
    timeline.filterOn = false;
    sendObject([], 'unfilter');
    log.write('timeFilter',0,'');
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
    let isSelected = preselected.filter( b => a.meta.Sortie === b.Sortie && b.Bildnr.indexOf( a.meta.Bildnr ) >= 0 ).length==1;
    a.meta.selected = (isSelected? true:false);
  }); // Add status to aerial object

  calculateAttackCvg();

  // TIME MODE BUTTON
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
  // FINISH BUTTON
  const finishButton = {
    id: 'finishButton',
    pos: [width-5,height-5],
    r: 3,
    draw: function () {
      push(), noStroke(), fill(200,50,50);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      log.write('finish','','');
      console.log(JSON.stringify(log.log));
    }
  }
  clickables.push(finishButton);
}


function draw() {
  background(groundColor);
  h[3] = height-30;
  textSize(8), fill(0), noStroke();
  // translate (0, 12);
  drawTimeline();
  // drawCvgMatrix(); 
  if (currentTimebin === '') drawTimemap();
  else drawTimebin(currentTimebin);
  if (aoi) attackDates.forEach( (a,i) => drawAttack(attacks[i], 8))
  clickables.forEach( a => a.draw()); // timemodebutton

  hoveredAerial = resolveMouseAerial();
  if (hoveredAerial) {
    if (!hoveredFlag) sendObject(hoveredAerial.id, 'highlight');
    hoveredFlag = true
    push(), translate(hoveredAerial.vis.pos[0],hoveredAerial.vis.pos[1]);
    fill(255,90), noStroke();
    rect(0,0,120,-100);
    fill('black'), textSize(11), textAlign(LEFT);
    text(hoveredAerial.meta.Sortie+'/'+hoveredAerial.meta.Bildnr, 10,-2)
    Object.keys(hoveredAerial.interest).forEach( (k,i) => {
      text(k+': '+(typeof(hoveredAerial.interest[k])==='number'?round(hoveredAerial.interest[k],2):hoveredAerial.interest[k]),10,-78+12*i);
    }) 
    pop();
  } else {
    if (hoveredFlag) sendObject([], 'unhighlight');
    hoveredFlag = false;
  }
}

//// VISUALIZATION /////

const orColor = function (a) {
  // if (a > .95) return color(0,180,255);
  // else return color(255)
  return lerpColor(color(220),color(0,180,255),a);
}

const prColor = function (a) {
  return color(255,50,50);
}

const urColor = function (a) {
  return lerpColor(color(groundColor),color(70,225,70),a);
}

const drawCvgMatrix = function() {
  timebins.forEach( (t, i, arr) => {
    stroke(220), strokeWeight(2);
    if (t.aerials.filter( a => a.meta.selected).length > 0) stroke(urColor());
    let x = attacks.filter( a => a.extFlights.includes(t.date)).map( a => a.date).map( a => timeline.map(a));
    let y = map(i,0,arr.length,50,height);
    line(x[0], y, timeline.map(t.date), y);
    strokeWeight(4);
    x.forEach( a => point(a,y))
    let best = t.aerials.sort( (a, b) => (a.meta.interest > b.meta.interest)?-1:1)[0];
    push(), translate(timeline.map(t.date),y);
    drawAerial(best), pop();
  })
}

const drawAttack = function (attack, r) {
  let c = hovered === attack.date? color(255,130,20):56;
  push(), translate(timeline.map(attack.date),h[1]);
  // push(), drawingContext.setLineDash([2, 2]), strokeWeight(1), stroke(c);
  // line(0,0,0,h[0]), pop()
  stroke(50), strokeWeight(.4);
  fill(urColor(attack.coverage));
  rect(0,0,5,-10);
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

const drawTimeline = function () {
  let years = aerialDates.map( a => a.slice(0,4)).filter(onlyUnique);
  let monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let months = years.reduce( (months, year) => {
    let a = [];
    for ( let i=1; i<=12; i++) a.push(year+'-'+(i<10?'0'+i:i)+'-01');
    return months.concat(a);
  }, []) 
  textAlign(LEFT), textStyle(NORMAL), textFont(font1), textSize(10), fill(80);
  years.forEach( a => text(a,timeline.map(a.concat('-01-01')),h[0]-10));
  textAlign(LEFT), textStyle(NORMAL), textFont(font1), textSize(10), fill(150);
  months.forEach( (a,i) => text(monthNames[i%12],timeline.map(a),h[0]));
  // aerialDates.forEach( a => {
  //   let x = timeline.map(a);
  //   strokeWeight(a===hovered || a===currentTimebin? 1:.2), noFill(), stroke(126);
  //   line(x,0,x,h[0])
  // });
}

const drawFlights = function ( aerials, params ) {

  const drawFlightCurve = function(timebin, params) {
    noFill();
    [1,-1].forEach ( m => {
      beginShape();
      curveVertex(params.anchor[0],min(80-20,map(-1,-1,timebin.length+1,80-20,height))); 
      curveVertex(params.anchor[0],min(80-20,map(-1,-1,timebin.length+1,80-20,height))); //y position wron
      timebin.forEach( (b, i, arr) => {
        let x = b.vis.pos[0] + (b.meta.p==m?0:-params.mod*2*b.meta.p);// + (b.meta.Bildnr>=3000&&b.meta.Bildnr<5000?m:0);
        let y = b.vis.pos[1];
        curveVertex( x, y );
        //draw special line between pairs
        [1,2].forEach( v => {
          if (i+v < arr.length && parseInt(arr[i+v].meta.Bildnr) == parseInt(b.meta.Bildnr+1) && arr[i+v].meta.p==m) {
            // console.log(parseInt(arr[i+2].meta.Bildnr)+' '+parseInt(b.meta.Bildnr+1));
            let c = arr[i+v];
            push(), strokeWeight(b.meta.selected&&c.meta.selected?4:2), stroke(b.meta.selected&&c.meta.selected?urColor(1):50);
            line(x,y,c.vis.pos[0]+(c.meta.p==m?0:-params.mod*2*c.meta.p),c.vis.pos[1]), pop();
          }
        })
      })
      curveVertex(params.anchor[0]+(timebin.length+1)*params.slope,min(80+timebin.length*20,map(timebin.length,0,timebin.length,80,height-20)))
      curveVertex(params.anchor[0]+(timebin.length+1)*params.slope,min(80+timebin.length*20,map(timebin.length,0,timebin.length,80,height-20)))
      strokeWeight(1);
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
    let x = timeline.map(a);
    let x2 = timeMode === 'chronological'? x:map( i, 0, arr.length-1, 20, width-20 );
    // fill(230,140,20,60), noStroke();
    // if (a===hovered) rect(x2-10,80,20,height-24-80);
    let c = a === currentTimebin? color(255,30,30):color(126);
    // Draw attack lines
    if (i != 0) attackDates.forEach( b => {
      push(), stroke(200), strokeWeight(1), drawingContext.setLineDash([1,2]);
      if (Date.parse(b) > Date.parse(arr[i-1]) && Date.parse(b) <= Date.parse(a)) {
        let x3 = map( i-.5, 0, arr.length-1, 20, width-20 );
        if (timeMode === 'chronological') {
          line( timeline.map(b), h[1], timeline.map(b), h[3] );
        } else {
          line( timeline.map(b), h[1], x3, min(55, h[3]));
          line( x3, min(55,height-35), x3, h[3] );
        }
      }
      pop();
    });

    let timebin = aerials.filter( b => b.meta.Datum === a);
    if (height >= 150) drawFlights( timebin, { anchor:[x2,66], mod:5, slope:0 } );

    strokeWeight(a===hovered? 1:.2), noFill(), stroke(c);
    // line(x,h[0],x2,min(55,height-35))
    push(), noStroke(), fill(100), textStyle(NORMAL), textSize(8);
    // if (timeMode !== 'chronological') text(a.slice(5).slice(a.slice(5,6)==='0'?1:0).replace('-','.'),x2,height);
    pop();

    push(), translate(x2,min(55,height-35));
    pop();
  });

}

const drawTimebin = function (aerialDate) {
  visible = [];
  noStroke(), fill(126), textSize(9);
  text(currentTimebin,timeline.map(currentTimebin),20);

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
  drawViewfinder(timebins[aerialDates.indexOf(aerialDate)].aggCvg, 30), pop();
  drawFlights( timebin, { anchor: [66,66], mod:15, slope:30 } )
  // drawTimebinRow(details, height-130);
  // drawTimebinRow(overviews, height-90);
}

const drawAerial = function (aerial) {
  let r = sqrt(aerial.meta.Cvg/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
  let onArea = r==0?false:true;
  if (!onArea) r = 4;
  aerial.vis.r = r;
  let interest = orColor(aerial.meta.interest)//color( 125-aerial.meta.interest*100, 125+aerial.meta.interest*50, 125+aerial.meta.interest*175 );
  let isSelected = aerial.meta.selected;
  push(), stroke(groundColor)//stroke(isSelected?urColor(1):50), strokeWeight(isSelected?2:.2);
  // aerial.meta.MASSTAB > 20000? drawingContext.setLineDash([2, 2]):null;
  // fill( r>0? 155+aerial.meta.interest*50*sin(frameCount/(3/aerial.meta.interest)): 236 );
  if (orientingOn) fill( aerial.interest.Cvg>0? interest: 255 );
  else fill( 200);
  if (isSelected) fill(urColor(1));
  if (!onArea) noFill();
  ellipse( 0, 0, r*2);
  fill(groundColor), noStroke();
  if (!onArea) fill(200);
  if (aerial.meta.LBDB) ellipse ( 0, -r/3*2, r/3*2);
  noStroke(), fill(0), textSize(7), textAlign(aerial.meta.p==1?LEFT:RIGHT);
  if (currentTimebin) text(aerial.meta.Bildnr, 15*(aerial.meta.p==1?1:-1), 3);
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
  return aerials.filter( a => dist(a.vis.pos[0], a.vis.pos[1], mouseX, mouseY) <= a.vis.r)[0];
}

function mousePressed() {
  if (mouseY < 20) dragStart = mouseX;
}

function mouseReleased() {
  if (mouseY < 20) {
    if (Math.abs(dragStart-mouseX) > 1) timeline.filter(dragStart,mouseX);
    else timeline.reset();
  }
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

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}