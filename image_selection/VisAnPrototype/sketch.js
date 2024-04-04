/*
  DoRIAH Image Selection - Visualization
  ip: Ignacio Perez-Messina

  IMPORTANT NOTES
  + Because of the attack dates, this version is only working for Vienna projects

  DEV NOTES
  + using certain p5 functions (e.g., abs, map, probably the ones that overload js) at certain points makes plugin crash on reload
  + hovering does not switch highlighting item if untinterrupted
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
  attackData =  loadTable(isWien?'data/AttackList_Vienna.xlsx - Tabelle1.csv':'data/Attack_List_St_Poelten.xlsx - Tabelle1.csv', 'header').rows;
  if (project !== false) preselected = loadTable('data/Selected_Images_'+projects[project]+'.csv', 'header').rows;
  font1 = loadFont('assets/Akkurat-Mono.OTF');
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

  // TIME MODE BUTTON
  timeModeButton = {
    name: "DATA",
    id: 'timeModeButton',
    pos: [5,5],
    r: 4,
    draw: function () {
      push(), noStroke(), fill(100);
      textAlign(RIGHT);
      text(this.name, this.pos[0]- this.r*3, height-3.5);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      timeMode = (timeMode === 'chronological'? 'fan':'chronological');
    }
  }
  clickables.push(timeModeButton);
  // FINISH BUTTON
  finishButton = {
    name: "USER",
    id: 'finishButton',
    pos: [width-5,height-5],
    r: 4,
    draw: function () {
      push(), noStroke(), fill(urColor(1));
      textAlign(RIGHT);
      text(this.name, this.pos[0]- this.r*3, height-3.5);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      log.write('FINISH','','');
      console.log(JSON.stringify(log.log));
      console.log("Selected set");
      console.log(JSON.stringify(aerials.filter( a => a.meta.selected).map(a => a.id)));
    }
  }
  clickables.push(finishButton);
  // ORIENTING BUTTON
  orButton = {
    name: "ORIENTING",
    id: 'orButton',
    pos: [width-5,5],
    r: 4,
    draw: function () {
      push(), noStroke(), fill(orColor(1));
      textAlign(RIGHT);
      text(this.name, this.pos[0]- this.r*3, height-3.5);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      orientingOn = !orientingOn;
      log.write('orienting'+(orientingOn?'On':'Off'),'','');
    }
  }
  clickables.push(orButton);
  // PRESCRIBING BUTTON
  prButton = {
    name: "PRESCRIBING",
    id: 'prButton',
    pos: [width-5,15],
    r: 4,
    draw: function () {
      push(), noStroke(), fill(prColor(1));
      textAlign(RIGHT);
      text(this.name, this.pos[0]- this.r*3, height-3.5);
      ellipse(this.pos[0], this.pos[1], this.r*2), pop();
    },
    click: function () {
      prescribingOn = !prescribingOn;
      log.write('prescribing'+(prescribingOn?'On':'Off'),'','');
    }
  }
  clickables.push(prButton);

  // MATRIX OF ATTACK COVERAGE
  let attackVector = [];
  timebins.forEach( t => {
    attackVector.push([]);
    // let containsSelected = t.aerials.map( a => a.meta.selected).reduce((acc, a) => acc||a, false);
    attackDates.forEach( a => attackVector[attackVector.length-1].push( t.attacks.includes(a)?1:0));
  })
  // console.log(JSON.stringify(attackVector));

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
  visualizeQuality();
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

//// VISUALIZATION /////

const orColor = function (a) {
  return lerpColor(color(220),color(0,130,255),a);
}

const prColor = function (a) {
  return color(255,100,30);
}

const urColor = function (a) {
  return lerpColor(color(groundColor),color(70,225,70),a);
}

const drawStats = function () {
  push(), translate(0, height-2);
  noStroke(), fill(50);

  let x = 20;
  push(), fill(100), textFont("Helvetica"), textStyle(BOLD), textSize(10), text("DoRIAH",1.5,-1.5), pop();
  timeModeButton.pos = [x+=120, height-7]; text(aerials.length+"/"+attackDates.length,x+=10,-1.5); 
  finishButton.pos = [x+=180, height-7]; text(aerials.filter( a => a.meta.selected).length+"/"+attacks.filter(a => a.coverage>0).length,x+=10,-1.5);
  prButton.pos = [x+=180, height-7]; text(prescribingOn?prGuidance.prescribed.length+"/"+attacks.filter(a => a.prescribed>0).length:0,x+=10,-1.5);
  orButton.pos = [x+=180, height-7];
  pop();
}

const drawEqClasses = function() {
  eqClasses.forEach( (c,i,arr) => {
    let allAerials = c.map(t => t.aerials).reduce( (agg, a) => [...agg, ...a],[])
    let interest = allAerials.map( a => a.meta.interest).sort( (a1,a2) => a1 > a2? -1: 1)[0];
    let y = h[0]+15+(i%6)*7+(i%12>5?0:3.5);
    
    strokeWeight(1.5), stroke(200);
    if(orientingOn) stroke(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) stroke(urColor(1))
    line( timeline.map(c[0].attacks[0]), y, timeline.map(c[0].date), y ) // attacks line
    
    stroke(150), strokeWeight(4);
    if(orientingOn) stroke(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) stroke(urColor(1))
    if (c.length > 1) line( timeline.map(c[0].date), y, timeline.map(c[c.length-1].date), y ); // flights line
    
    noStroke(),fill(150);
    if(orientingOn) fill(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) fill(urColor(1))
    c.forEach( t => ellipse( timeline.map(t.date), y, 6 )); // dots for flights
  } ) 
}

const drawCvgMatrix = function() {
  timebins.forEach( (t, i, arr) => {
    stroke(220), strokeWeight(2);
    if (t.aerials.filter( a => a.meta.selected).length > 0) stroke(urColor(1));
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
  // let c = hovered === attack.date? color(255,130,20):56;
  push(), translate(timeline.map(attack.date),h[1]);
  // push(), drawingContext.setLineDash([2, 2]), strokeWeight(1), stroke(c);
  // line(0,0,0,h[0]), pop()
  
  // fill(attack.prescribed && prescribingOn && attack.coverage == 0? prColor(1): urColor(attack.coverage));
  noStroke(), fill(groundColor);
  rect(0,0,5,-10);
  
  if (prescribingOn) fill(prColor(1)), noStroke(), rect(0,0,5,-10*attack.coverage[1]);
  fill(urColor(1)), noStroke();
  rect(0,0,5,-10*attack.coverage[0]);
  stroke(50), strokeWeight(.4), noFill();
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
  textAlign(LEFT), textStyle(NORMAL), textFont(font1), textSize(10);
  years.forEach( a => {
    fill(80), noStroke();
    text(a,timeline.map(a.concat('-01-01')),h[0]-10)
    stroke(200);
    line(timeline.map(a.concat('-01-01')),0,timeline.map(a.concat('-01-01')),h[1]-15)
  });

  textAlign(LEFT), textStyle(NORMAL), textFont(font1), textSize(10), fill(150);
  months.forEach( (a,i) => {
    fill(100), noStroke();
    text(monthNames[i%12], timeline.map(a), h[0]-2);
    fill(150);
    if (test) {
      text(5, timeline.map(a.substring(0,8).concat('05')), h[0]);
      text(10, timeline.map(a.substring(0,8).concat('10')), h[0]);
      text(15, timeline.map(a.substring(0,8).concat('15')), h[0]);
      text(20, timeline.map(a.substring(0,8).concat('20')), h[0]);
      text(25, timeline.map(a.substring(0,8).concat('25')), h[0]);
    }
    ['01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','24','25','26','27','28','29','30','31'].forEach( (b,i) => {
      // text('.', timeline.map(a.substring(0,8).concat(b)), h[0]+3);
      stroke(200), strokeWeight(1.5);
      point(timeline.map(a.substring(0,8).concat(b)), h[0]+3);
    })
  });
  // DRAW BACKGROUND LAYOUT
  stroke(200), noFill();
  rect(0,0,windowWidth, h[1]-15, 10,10,0,0);
  rect(0,0,windowWidth, windowHeight,10,10,0,0);
  line(0,windowHeight-15,windowWidth,windowHeight-15);
}

const drawFlights = function ( aerials, params ) {

  const drawFlightCurve = function(timebin, params) {
    noFill();
    [1,-1].forEach ( m => {
      beginShape();
      // curveVertex(params.anchor[0],min(80-20,map(-1,-1,timebin.length+1,80-20,height))); 
      vertex(params.anchor[0],min(params.anchor[1]-20,map(-1,-1,timebin.length+1,params.anchor[1]-20,height))); //y position wron
      timebin.forEach( (b, i, arr) => {
        let x = b.vis.pos[0] + (b.meta.p==m?0:-params.mod*2*b.meta.p);// + (b.meta.Bildnr>=3000&&b.meta.Bildnr<5000?m:0);
        let y = b.vis.pos[1];
        vertex( x, y );
        //draw special line between pairs
        [1,2].forEach( v => {
          if (i+v < arr.length && parseInt(arr[i+v].meta.Bildnr) == parseInt(b.meta.Bildnr+1) && arr[i+v].meta.p==m) {
            // console.log(parseInt(arr[i+2].meta.Bildnr)+' '+parseInt(b.meta.Bildnr+1));
            let c = arr[i+v];
            push(), strokeWeight(12), stroke(b.meta.selected&&c.meta.selected?urColor(1):200);
            line(x,y,c.vis.pos[0]+(c.meta.p==m?0:-params.mod*2*c.meta.p),c.vis.pos[1]), pop();
          }
        })
      })
      vertex(params.anchor[0]+(timebin.length+1)*params.slope,min(params.anchor[1]+timebin.length*20,map(timebin.length,0,timebin.length,params.anchor[1],height-20)))
      // curveVertex(params.anchor[0]+(timebin.length+1)*params.slope,min(80+timebin.length*20,map(timebin.length,0,timebin.length,80,height-20)))
      strokeWeight(1), stroke(150);
      endShape();
    });
  }

  aerials.sort( (a,b) => (new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1))? 1:-1 )
  .sort( (a,b) => (a.meta.Sortie > b.meta.Sortie)?1:-1)
  .forEach( (a, i, arr) => {
    a.vis.tpos = [
      params.anchor[0]+(i+1)*params.slope+params.mod*a.meta.p,
      min(params.anchor[1]+i*20,map(i,0,arr.length,params.anchor[1],height-20))
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
    let c = color(126);

    // Draw attack lines
    if (i != 0) attackDates.forEach( b => {
      push(), stroke(200), strokeWeight(1), drawingContext.setLineDash([1,2]);
      if (Date.parse(b) > Date.parse(arr[i-1]) && Date.parse(b) <= Date.parse(a)) {
        let x3 = map( i-.5, 0, arr.length-1, 20, width-20 );
        if (timeMode === 'chronological') {
          line( timeline.map(b), h[1], timeline.map(b), h[3] );
        } else {
          line( timeline.map(b), h[1], x3, h[2]-20);
          line( x3, h[2]-20, x3, h[3] );
        }
      }
      pop();
    });

    let timebin = aerials.filter( b => b.meta.Datum === a);
    if (height >= 150) drawFlights( timebin, { anchor:[x2,h[2]], mod:5, slope:0 } );

    // strokeWeight(a===hovered? 1:.2), noFill(), stroke(c);
    // line(x,h[0],x2,min(55,height-35))
    // push(), noStroke(), fill(100), textStyle(NORMAL), textSize(8);
    // if (timeMode !== 'chronological') text(a.slice(5).slice(a.slice(5,6)==='0'?1:0).replace('-','.'),x2,height);
    // pop();

    // push(), translate(x2,min(55,height-35));
    // pop();
  });

}

// const drawTimebin = function (aerialDate) {
//   visible = [];
//   noStroke(), fill(126), textSize(9);
//   text(currentTimebin,timeline.map(currentTimebin),20);

//   let timebin = aerials.filter( a => a.meta.Datum === aerialDate);
//   // let flights = timebin.map( a => a.meta.Sortie ).filter(onlyUnique);
//   let details = timebin.filter(a => a.meta.MASSTAB <= 20000);
//   // let detailsR = timebin.filter( a => a.meta.Bildnr >=3000  && a.meta.Bildnr < 4000 && a.meta.MASSTAB <= 20000);
//   // let detailsL = timebin.filter( a => a.meta.Bildnr >= 4000 && a.meta.Bildnr < 5000 && a.meta.MASSTAB <= 20000);
//   let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000);

//   const drawTimebinRow = function(aerialRow, r) {
//     aerialRow.sort( (a,b) => new String(a.meta.Bildnr).slice(1) < new String(b.meta.Bildnr).slice(1) ? 1:-1 ).sort( (a,b) => a.meta.Sortie > b.meta.Sortie?1:-1);
//     // draw flight arcs
//     aerialRow.forEach( (a,i,arr) => { 
//       let p = i/(arr.length-1)*PI-PI/2;
//       push(), translate(width/2,55), rotate(-i/(arr.length-1)*PI+PI/2);
//       stroke(220), noFill(), strokeWeight(5);
//       if (i > 0 && a.meta.Sortie == arr[i-1].meta.Sortie) arc(0,0,r*2,r*2,PI/2,PI/2+PI/(arr.length-1));
//       pop();
//     });
//     // draw aerials
//     aerialRow.forEach( (a,i,arr) => { 
//       let p = -i/(arr.length-1)*PI+PI/2;
//       let x = width/2+sin(p)*r;
//       let y = 55+cos(p)*r;
//       a.vis.pos = [x,y];
//       // visible.push(a);
//       push(), translate(width/2,55), rotate(p);
//       translate(0,r);
//       drawAerial(a);
//       noStroke(), fill(0), textStyle(NORMAL), textSize(6), textAlign(CENTER);
//       if (PI*(r+20)/arr.length > 22) text(a.meta.Bildnr,0,20);
//       textAlign(CENTER), textStyle(BOLD), rotate(-PI/2);
//       if (i == 0 || arr[i-1].meta.Sortie!==a.meta.Sortie) text(a.meta.Sortie,0,i==0?-20:-PI*r/arr.length/4);
//       pop();
//     });
//   }
  
//   push(), translate(66-15,66-15);
//   drawViewfinder(timebins[aerialDates.indexOf(aerialDate)].aggCvg, 30), pop();
//   drawFlights( timebin, { anchor: [66,66], mod:15, slope:30 } )
//   // drawTimebinRow(details, height-130);
//   // drawTimebinRow(overviews, height-90);
// }

const visualizeQuality = function () {
  let scale = 500;
  noStroke();
  fill(orColor(1));
  rect(width,height-15,-qualityIndex([...prGuidance.prescribed, ...aerials.filter( a => a.meta.selected)])*scale,5);
  fill(prColor(1));
  rect(width,height-10,-qualityIndex(prGuidance.prescribed)*scale,5);
  fill(urColor(1));
  rect(width,height,-qualityIndex(aerials.filter( a => a.meta.selected))*scale,-5);
  
}

const drawAerial = function (aerial) {
  let r = sqrt(aerial.meta.Cvg/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
  let onArea = r==0?false:true;
  if (!onArea) r = sqrt(1/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
  aerial.vis.r = r;
  let interest = orColor(aerial.meta.interest)//color( 125-aerial.meta.interest*100, 125+aerial.meta.interest*50, 125+aerial.meta.interest*175 );
  let isSelected = aerial.meta.selected;
  push(), stroke(aerial.meta.LBDB? 100: groundColor), strokeWeight(1);//stroke(isSelected?urColor(1):50), strokeWeight(isSelected?2:.2);
  // SQM test
  if (orientingOn) fill( aerial.interest.Cvg>0? orColor(aerial.meta.value*250): 255 );
  // if (orientingOn) fill( aerial.interest.Cvg>0? orColor(aerial.meta.interest): 255 );
  else fill( 200);
  if (isSelected) fill(urColor(1));
  if (prescribingOn && aerial.meta.prescribed) fill( isSelected? urColor(.6):prColor(1)); 
  if (!onArea) fill(100,50);
  
  ellipse( 0, 0, r*2);
  fill(groundColor), noStroke();
  // if (!onArea) fill(100), stroke(100);
  // if (aerial.meta.LBDB) ellipse ( 0, -r/3*2, r/3*2);
  noStroke(), fill(0), textSize(7), textAlign(aerial.meta.p==1?LEFT:RIGHT);
  if (currentTimebin) text(aerial.meta.Bildnr, 15*(aerial.meta.p==1?1:-1), 3);
  // noFill(), stroke(0), strokeWeight(1);
  // ellipse(-mod,0,aerial.meta.Abd/5);
  fill(0,100), noStroke();
  if (aerial.previewOpen) ellipse(0, 0, r*2);
  pop();
}

//// INTERACTION

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
    log.write('START','',[orientingOn,prescribingOn]);
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
    clickedAerial.previewOpen = !clickedAerial.previewOpen;
  }
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

//// UTILS

function onlyUnique(value, index, self) {
  return self.indexOf(value) === index;
}

let qualityVis = {
  p: [0,0],
  d: [100,15],
  draw: function() {
    ellipse(this.p[0],this.p[1],20);
  }
}