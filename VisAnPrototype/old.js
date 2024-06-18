  // MATRIX OF ATTACK COVERAGE
//   let attackVector = [];
//   timebins.forEach( t => {
//     attackVector.push([]);
//     // let containsSelected = t.aerials.map( a => a.meta.selected).reduce((acc, a) => acc||a, false);
//     attackDates.forEach( a => attackVector[attackVector.length-1].push( t.attacks.includes(a)?1:0));
//   })
  // console.log(JSON.stringify(attackVector));

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
// drawViewfinder() = {
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
//}

// const drawViewfinder = function (aggCvg, r) {
//     fill(100,100,200), noStroke();
//     ellipse(0,0,sqrt(aggCvg[1])*r);
//     fill(150,150,255);
//     ellipse(0,0,sqrt(aggCvg[0])*r);
//     stroke(r), noFill(), strokeWeight(.5);
//     ellipse(0,0,sqrt(1)*r); 
// }

// const visualizeQuality = function () {
//     let scale = 500;
//     noStroke();
//     fill(orColor(1));
//     rect(width,height-15,-qualityIndex([...prGuidance.prescribed, ...aerials.filter( a => a.meta.selected)])*scale,5);
//     fill(prColor(1));
//     rect(width,height-10,-qualityIndex(prGuidance.prescribed)*scale,5);
//     fill(urColor(1));
//     rect(width,height,-qualityIndex(aerials.filter( a => a.meta.selected))*scale,-5);
// }