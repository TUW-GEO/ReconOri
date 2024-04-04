
// Called in the draw loop while an aerial a is being hovered
const drawTooltip = function (a) {
    let w = 200, h = 130;
    let x = 8, y = 16;
    let aerialMargin = a.vis.r+1;
    let lineSpace = 14;
    
    push(), translate(a.vis.pos[0]+aerialMargin,a.vis.pos[1]+aerialMargin);
    if (a.vis.pos[0] > width/2) translate(-w-aerialMargin, 0);
    if (a.vis.pos[1] > height/2) translate(0, -h-aerialMargin);
    fill('white'), stroke(200), strokeWeight(1);
    rect(0,0,w,h,0,15,15,15);
    
    fill('black'), textSize(11), textAlign(LEFT), textFont('Helvetica'), textStyle(BOLD), noStroke();
    text(a.meta.Sortie+'/'+a.meta.Bildnr, x, y)
    
    textStyle(NORMAL);
    text("This "+ a.interest.type +" image...", x, y += lineSpace);
    text("is " +( a.interest.owned?"":"not ") + "owned by LBDB", x, y += lineSpace);
    text("has a "+Math.round(a.interest.Cvg,2)*100+"% coverage over the AOI", x, y += lineSpace);
    text("has a scale of "+a.meta.MASSTAB, x, y += lineSpace);
    if (a.meta.pairs.length > 0) text("can be paired", x, y += lineSpace);
    if (orientingOn) {
        fill(orColor(1));
        // text("has a local interest value of "+Math.round(a.interest.post,2), x, y += lineSpace);
        // text("has a SQM value of "+a.meta.value, x, y += lineSpace);
        // text("has a normalized SQM value of "+a.meta.valueNormalized, x, y += lineSpace);
        // text("has a global interest value of "+Math.round(a.interest.pre,2), x, y += lineSpace);
    }
    if (prescribingOn) {
        fill(a.meta.prescribed?prColor(1):0);
        text("is "+( a.meta.prescribed?"":"not ") +"being prescribed", x, y += lineSpace);
    }
    pop();
}