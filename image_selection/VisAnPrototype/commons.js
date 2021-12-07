let testProject = 1;

let colors;
let radiusK = .07;
let images = ['1','2','3','4','5','6','7','8','9']

let scale = testProject == 1? 17: 30;
let margin = 50;
let center;
let sorties

function getRange( d, field ) {
  return d.map( a => a[field]).reduce( (acc,a) => [min(acc[0],a),max(acc[1],a)], [Infinity,-Infinity]);
}

function preload() {
  data = loadTable('data/Recherche_Metadaten_Testprojekt'+testProject+'.csv','header').rows;
  monotype = loadFont('assets/Akkurat-Mono.OTF');
  images = images.map( a => loadImage('images/Test'+ '1' + '.' + a + '.png'));
  colors = [color(220),color(110)];
}

function preprocessing(data) {
  let rangeX = getRange(data, 'x');
  let rangeY = getRange(data, 'y');
  center = [(rangeX[1]-rangeX[0])/2,(rangeY[1]-rangeY[0])/2];
  // if (testProject == 2) center[0] -= 40000;
  data.forEach( (a,i) => {
    a.pos = [
      map(a.x,rangeX[0],rangeX[1],-center[0]/scale,center[0]/scale), // margin,height-margin
      map(a.y,rangeY[0],rangeY[1],-center[1]/scale,center[1]/scale),
    ]
    a.ts = lineDate(a.Datum);
    a.ratio = pow(50,2)*a.Abd/pow(a.Radius_Bild,2);
    a.owned = a.LBDB === 'Ja'? true:false;
    a.specificity = a.Abd*pow(1000,2)/pow(a.Radius_Bild,2)
  });
  sorties = data.reduce( (acc, a) => {return acc.includes(a.Sortie)? acc: acc.concat(a.Sortie)}, [])
  return data;
}

function lineDate(date) {
  let mdy = date.split('/');
  return +(mdy[0]-1)*30+1*mdy[1]+1*mdy[2]*365;
}

function drawMap() {
  noStroke(), fill(colors[0]);
  rect(-z-margin,-z-margin,(z+margin)*2,(z+margin)*2);
}


function colorSortie(sortie) {
  return color((sorties.indexOf(sortie)*111)%255, (sorties.indexOf(sortie)*8)%255, (sorties.indexOf(sortie)*38)%255);
}

