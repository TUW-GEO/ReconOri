let flags = ['rectangular','fanion','gonfalon'];
let selectedFlag = 1;
let selectedImg, div;

function setup(){
  cnv = createCanvas(windowWidth,windowHeight);
  data = preprocessing(data.map(a => a.obj)).sort( (a,b) => {return a.y > b.y? 1:-1});
  ratio = width/height;
  div = createDiv('Selected').hide().id('lastHovered');
  console.log(data);
}
function draw() {
  clear();
  drawMap();
  // data.forEach( (a,i) => {
  //   push(),translate(a.pos[0],a.pos[1]);
  //   fill(map(+a.Abd,0,100,0,255)), stroke(0), strokeWeight(.1);
  //   ellipse(0,0,a.Radius_Bild*radiusK*2*ratio/40,a.Radius_Bild*radiusK*2/60);
  //   pop();
  // });
  translate(width/2,height/2);
  // AOI
  // stroke(0), noFill();
  // ellipse(0,0,1000/scale*2)

  data.forEach( (a,i) => {
    push(),translate(a.pos[0],a.pos[1]);
    let flagHeight = 6;
    let flagWidth = 12;
    
    let d = dist(mouseX,mouseY,a.pos[0]+width/2,a.pos[1]+height/2);
    let k = constrain(20-d,0,20);
    let h = -(5+a.Radius_Bild/300)-k; //*21-24-30
    stroke(0),strokeWeight(.2),noFill();
    if (d < 2) ellipse(0,0,a.Radius_Bild*radiusK*2,a.Radius_Bild*radiusK*2);
    

    // rotate(map(a.Abd,0,100,0,PI/2));
    // stroke(0),strokeWeight(1);
    // line(-h,0,h,0);

    strokeWeight(1), stroke(160);
    line(0,0,0,h);
    fill(map(+a.Abd,0,100,0,255)), noStroke();
    fill(a.owned? color(235,255,40):map(+a.Abd,0,100,0,255))
    if (d < 2) fill('orange');
    translate(0,h);
    let angle = map(+a.Abd,0,100,0,PI*.5);
    beginShape();
    if (flags[selectedFlag] === 'rectangular') {
      vertex(0,flagHeight);
      vertex(flagWidth*sin(angle),flagWidth*cos(angle)+flagHeight);
      vertex(flagWidth*sin(angle),flagWidth*cos(angle));
      vertex(0,0);
    } else if (flags[selectedFlag] === 'gonfalon') {
      vertex(0,flagHeight);
      vertex((flagWidth-2)*sin(angle),(flagWidth-2)*cos(angle)+flagHeight);
      vertex(flagWidth*sin(angle),flagWidth*cos(angle)+flagHeight/2);
      vertex((flagWidth-2)*sin(angle),(flagWidth-2)*cos(angle));
      vertex(0,0);
    } else if (flags[selectedFlag] === 'fanion') {
      beginShape();
      vertex(0,flagHeight);
      vertex(flagWidth*sin(angle),flagWidth*cos(angle)+2);
      vertex(0,0);
    }
    endShape();
    pop();
    push(), translate(a.pos[0],a.pos[1]-100)//+(mouseY < height/2? 500:-100));
    if (d < 2) {
      noStroke(), fill(0);
      rect(-150,-80,300,60);
      textSize(10), fill(255), textAlign(CENTER), textFont(monotype);
      text(a.Sortie+" "+a.Bildnr,0,-52);
      text(a.Datum +" - Abd. "+a.Abd+"%",0,-40);
      if (images[i%images.length]) image(images[i%images.length],-150,-380,300,300); 
      selectedImg = a;
      div.html(i);
    } 
    pop();
  });
  
}

function drawMap() {
  noStroke(), fill(220);
  rect(0,0,width,height);
}

function keyPressed() {
  selectedFlag = (selectedFlag+1)%flags.length;

  // wk inform the PlugIn
  qgisplugin.keyPressedAtPos(mouseX, mouseY);
}

// wk
qgisplugin.aerialsLoaded.connect(function(aerials) {
  console.log(JSON.stringify(aerials, null, 4));
});

qgisplugin.aerialFootPrintChanged.connect(function(imgId, footprint) {
  console.log("Footprint of " + imgId + " has changed to " + footprint);
});

qgisplugin.aerialPreviewFound.connect(function(imgId, path, rect){
  console.log("Preview found for " + imgId + ": " + path + " " + rect);
});

qgisplugin.aerialUsageChanged.connect(function(imgId, usage){
  console.log("Usage of " + imgId + " has changed to " + usage);
});