const drawAerial = function (aerial) {
    // Define the radius of the glyph, determined by their information measure
    let r = sqrt(aerial.meta.Cvg/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
    let onArea = r==0?false:true;
    if (!onArea || r < 3) r = 3;// sqrt(1/aerial.meta.MASSTAB)*1000*(isSmall?1.5:4)/2;
    aerial.vis.r = r;

    // let interest = orColor(aerial.meta.interest)//color( 125-aerial.meta.interest*100, 125+aerial.meta.interest*50, 125+aerial.meta.interest*175 );
    let isSelected = (aerial.usage == 2);
    push();
    if (isSelected) {
      noStroke();
      fill(0,255,0,100);
      ellipse(0,0, (r+5)*2);
    }
    stroke(aerial.meta.LBDB? 100: groundColor);
    strokeWeight(1);//stroke(isSelected?urColor(1):50), strokeWeight(isSelected?2:.2);
    if (orientingOn) fill( aerial.interest.post? orColor(aerial.interest.post): 255 );
    // if (orientingOn) fill( aerial.interest.Cvg>0? orColor(aerial.meta.interest): 255 );
    else fill( 200);
    // if (isSelected) fill(urColor(1));
    if (prescribingOn && aerial.meta.prescribed) fill(prColor(1));//fill( isSelected? urColor(.6):prColor(1)); 
    // if (!onArea) fill(100,50); 
    push();
    fill(0,50), noStroke();
    if (aerial.previewOpen) ellipse(0, 0, r*2);
    pop();
    
    ellipse( 0, 0, r*2);
    fill(groundColor), noStroke();
    // if (!onArea) fill(100), stroke(100);
    // if (aerial.meta.LBDB) ellipse ( 0, -r/3*2, r/3*2);
    noStroke(), fill(0), textSize(7), textAlign(aerial.meta.p==1?LEFT:RIGHT);
    if (currentTimebin) text(aerial.meta.Bildnr, 15*(aerial.meta.p==1?1:-1), 3);
    // noFill(), stroke(0), strokeWeight(1);
    // ellipse(-mod,0,aerial.meta.Abd/5);
    
    
    pop();
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
          // Draw Pair Band between image pairs
          [1,2].forEach( v => {
            if (i+v < arr.length && parseInt(arr[i+v].meta.Bildnr) == parseInt(b.meta.Bildnr+1) && arr[i+v].meta.p==m) {
              // console.log(parseInt(arr[i+2].meta.Bildnr)+' '+parseInt(b.meta.Bildnr+1));
              let c = arr[i+v];
              push(), strokeWeight(12), stroke((b.meta.selected&&c.meta.selected)?color(0,255,0,100):color(200, 100));
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