// TIMELINE OBJECT

let timeline = {};

timeline.reset = function () {
  timeline.range = [Date.parse(test?"1945-01-01":aerialDates[0]),Date.parse(aerialDates[aerialDates.length-1])];
  timeline.filterOn = false;
  sendObject([], 'unfilter');
  log.write('timeReset',0,'');
}
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

// TIME BANNER
const YEAR_LABEL_OFFSET = 10;
const MONTH_LABEL_OFFSET = 2;
const MONTH_LABEL_HEIGHT = 10;
const MONTH_POINT_HEIGHT = 3;
const MONTH_POINT_SPACING = 20;
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_DAYS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', '21', '22', '23', '24', '25', '26', '27', '28', '29', '30', '31'];

// Function to draw year labels
function drawYearLabels(years, timeline) {
    textFont("Helvetica");
    textAlign(LEFT);
    textStyle(BOLD);
    textSize(10);
    years.forEach(year => {
        fill(80);
        noStroke();
        text(year, timeline.map(year + '-01-01'), h[0] - YEAR_LABEL_OFFSET);
        stroke(200);
        line(timeline.map(year + '-01-01'), 0, timeline.map(year + '-01-01'), h[0]);
    });
}

// Function to draw month labels and points
function drawMonthLabelsAndPoints(months, timeline) {
    textAlign(LEFT);
    textStyle(NORMAL);
    textFont(font1);
    textSize(10);
    fill(150);
    months.forEach((month, index) => {
        fill(100);
        noStroke();
        text(MONTH_NAMES[index % 12], timeline.map(month), h[0] - MONTH_LABEL_OFFSET);
        fill(150);
        MONTH_DAYS.forEach((day, dayIndex) => {
            stroke(200);
            strokeWeight(1.5);
            point(timeline.map(month.substring(0, 8) + day), h[0] + MONTH_POINT_HEIGHT);
        });
    });
}

// Draw Time references in timeline
function drawTimeline() {
   // Draw background layout
   stroke(200);
   fill(255);
   rect(0, 0, windowWidth, h[1] - 15, 10, 10, 0, 0);
   rect(0, 0, windowWidth, windowHeight, 10, 10, 0, 0);
   line(0, windowHeight - 15, windowWidth, windowHeight - 15);

  let years = aerialDates.map(date => date.slice(0, 4)).filter(onlyUnique);
  let months = years.reduce((months, year) => {
      let a = [];
      for (let i = 1; i <= 12; i++) a.push(year + '-' + (i < 10 ? '0' + i : i) + '-01');
      return months.concat(a);
  }, []);

  drawYearLabels(years, timeline);
  drawMonthLabelsAndPoints(months, timeline);
}

const drawTimelineDrag = function () {
  if (mouseY < h[1]) {
    stroke(0), strokeWeight(1);
    line(mouseX, h[0]+3, mouseX, h[1]);
    if (dragStart) {
      line(dragStart, h[0]+3, dragStart, h[1]);
      noStroke(), fill(0,20);
      rect(dragStart,h[0]+3,mouseX-dragStart,h[1]-(h[0]+3));
    } 
  }
}

// Attack-coverage Banner

const drawEqClasses = function() {
  eqClasses.forEach( (c,i,arr) => {
    push();
    let allAerials = c.map(t => t.aerials).reduce( (agg, a) => [...agg, ...a],[])
    let interest = allAerials.map( a => a.meta.interest).sort( (a1,a2) => a1 > a2? -1: 1)[0];
    let y =  (h[0]+15+7*6)-((i%6)*7+(i%12>5?0:3.5));
    
    // Attack line
    strokeWeight(1.5), stroke(200);
    if(orientingOn) stroke(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) stroke(urColor(1))
    line( timeline.map(c[0].attacks[0]), y, timeline.map(c[0].date), y );
    
    // Inter flight line
    stroke(150), strokeWeight(1.5);
    if(orientingOn) stroke(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) stroke(urColor(1))
    if (c.length > 1) line( timeline.map(c[0].date), y, timeline.map(c[c.length-1].date), y );
    
    // Flight circles
    noStroke(),fill(150);
    if(orientingOn) fill(orColor(interest));
    if(allAerials.some( a => a.meta.selected)) fill(urColor(1))
    c.forEach( t => ellipse( timeline.map(t.date), y, 6 ));

    // Attack circle
    // stroke(150), fill(255), strokeWeight(1.5);
    // if(orientingOn) stroke(orColor(interest));
    // if(allAerials.some( a => a.meta.selected)) stroke(urColor(1))
    // if (c[0].attacks[0]) ellipse( timeline.map(c[0].attacks[0]), y, 5 );

    pop();
  }); 
}

const drawAttack = function (attack, r) {
  // let c = hovered === attack.date? color(255,130,20):56;
  push(), translate(timeline.map(attack.date),h[1]);
  // push(), drawingContext.setLineDash([2, 2]), strokeWeight(1), stroke(c);
  // line(0,0,0,h[0]), pop()
  
  // fill(attack.prescribed && prescribingOn && attack.coverage == 0? prColor(1): urColor(attack.coverage));
  noStroke(), fill(groundColor);
  rect(-3,0,6,-10);
  
  if (prescribingOn) fill(prColor(1)), noStroke(), rect(-3,0,6,-10*attack.coverage[1]);
  fill(urColor(1)), noStroke();
  rect(-3,0,6,-10*attack.coverage[0]);
  stroke(50), strokeWeight(.4), noFill();
  rect(-3,0,6,-10);
  // beginShape();
  // vertex(0,-r/2), vertex(r/2,-r), vertex(r/2,0), vertex(0,r/2);
  // vertex(-r/2,0),  vertex(-r/2,-r), vertex(0,-r/2);
  // endShape();
  pop();
}

const drawAttack2 = function (attack, r) {
  // let c = hovered === attack.date? color(255,130,20):56;
  push(), translate(timeline.map(attack.date),h[0]);
  // push(), drawingContext.setLineDash([2, 2]), strokeWeight(1), stroke(c);
  // line(0,0,0,h[0]), pop()
  
  // fill(attack.prescribed && prescribingOn && attack.coverage == 0? prColor(1): urColor(attack.coverage));
  noStroke(), fill(groundColor);
  rect(-3,10,6,70);
  
  // if (prescribingOn) fill(prColor(1)), noStroke(), rect(-3,10,6,70*attack.coverage[1]);
  fill(urColor(1)), noStroke();
  rect(-3,10,6,70*attack.coverage[0]);
  stroke(50), strokeWeight(.4), noFill();
  rect(-3,10,6,70);
  pop();
}


//TIME MAPPING
const drawTimemap = function () {
  aerialDates.forEach( (a, i, arr) => {
    let x = timeline.map(a);
    let x2 = timeMode === 'chronological'? x:map( i, 0, arr.length-1, 20, width-20 );
    // fill(230,140,20,60), noStroke();
    // if (a===hovered) rect(x2-10,80,20,height-24-80);
    let c = color(126);

    // Vertical attack lines
    if (i != 0) attackDates.forEach( b => {
      push(), stroke(200), strokeWeight(1), drawingContext.setLineDash([1,2]);
      if (Date.parse(b) > Date.parse(arr[i-1]) && Date.parse(b) <= Date.parse(a)) {
        let x3 = map( i-.5, 0, arr.length-1, 20, width-20 );
        line( timeline.map(b), h[0]+3, timeline.map(b), h[1] );
        if (timeMode !== 'chronological') {
          line( timeline.map(b), h[1], x3, h[2]-20);
          line( x3, h[2]-20, x3, h[3] );
        }
      }
      pop();
    });

    let timebin = aerials.filter( b => b.meta.Datum === a);
    if (height >= 150) drawFlights( timebin, { anchor:[x2,h[2]], mod:5, slope:0 } );
  });
}