let radiusScale = .05;

function setup(){
  cnv = createCanvas(windowWidth,windowHeight,WEBGL);
  data = preprocessing(data.map(a => a.obj));
  camera(0,01,2000,0,0,100,0,0,-1);
  // noLoop();
}

function draw() {
  orbitControl();
  clear();
  drawMap();
  
  // Z AXIS
  push(), translate(-width,-height,0), stroke(colors[1]);
  line(0,0,0,0,0,height*2);
  textFont(monotype), textSize(50), fill(colors[1]), noStroke();
  rotateY(-PI/2), rotateX(-PI/2);
  text('flughöhe',0,-30,0);
  pop();
  // COLOR AXIS
  push(), translate(-width,height,0), noStroke();
  for (let i = 12; i--;) fill(i*25), rect(i*50,0,50);
  textFont(monotype), textSize(50), fill(colors[1]), noStroke();
  text('abdeckung',0,100,0);
  pop();
  // RADIUS AXIS
  push(), translate(width,height,0), stroke(colors[1]), noFill();
  ellipse(-100,80,120);
  textFont(monotype), textSize(50), fill(colors[1]), noStroke();
  text('bildradius 1:'+(1/radiusScale),-600,60,0);
  pop();
  // Y AXIS
  push(), translate(width,height,0),  stroke(colors[1]), noFill();
  for (let i = 10; i--;) fill(i%2? 'black':'white'), rect(0,i*-1000/scale,10,-1000/scale);
  textFont(monotype), textSize(50), fill(colors[1]), noStroke();
  text('10km',50,5*-1000/scale,0);
  pop();

  translate(0,0);
  data.forEach( (a,i) => {
    push();
    let radius = a.Radius_Bild/scale*radiusScale;
    // SHADOW
    translate(a.pos[0],a.pos[1],1); 
    noStroke(), fill(200);
    if (radiusScale !== 1) ellipse(0,0,radius*2);
    // FLAG
    // stroke(0);
    // let flagH = 50; 
    // line(0,0,0,0,0,flagH);
    // fill(100,100,0);
    // rect(0,0,20,flagH,10,100);
    // PHOTO
    stroke(0), strokeWeight(.5), fill(map(+a.Abd,0,100,0,255));
    let z = a.flughohe/22;// /scale
    translate(0,0,constrain(z,2,9999)+i%20/10); 
    ellipse(0,0,radius*2);
    pop();
  });
  
}

function drawMap() {
  noStroke(), fill(220);
  rect(-width,-height,width*2,height*2);
  // rect(0,0,width,height);
}

function keyPressed() {
  radiusScale == 1? radiusScale = .05: radiusScale = 1;

  // wk inform the PlugIn
  qgisplugin.keyPressedAtPos(mouseX, mouseY);
}