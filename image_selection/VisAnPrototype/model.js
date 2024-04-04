//
// SELECTION QUALITY MODEL
//
// ip 2023-04-10:
// This SQM considers type of images, pairing status, and temporal relations to attacks
// This SQM does NOT consider actual spatial coverage, information amount and the bestshot measure 
// is purposedly limited to the first covering image pair (in time) of an attack
//
// IMPORTANT NOTE: timespan of the project and threshold delay are HARDCODED
// SQM should ignore discarded status images

let prescribedSelectionValue = 0;

function infoIndex(selection) {
    return selection.reduce( (agg, i) => {
        return agg += i.meta.information/selection.length;
    }, 0);
}

function ownedIndex(selection) {
    return selection.reduce( (agg, i) => {
        return agg +=  (i.interest.owned?1:0)/selection.length;
    }, 0);
}

function timeCvgSawIndex(selection) {
    const projectTimespan = 21*30*25; // days
    return selection.slice().sort( (i,j) => i.time.getTime() < j.time.getTime()?1:-1).reduce( (agg, i, j, arr) => {
        if (j === arr.length-1) return (agg+25*12.5)/projectTimespan;
        else {
          let dayDiff = Math.round((i.time.getTime()-arr[j+1].time.getTime())/(1000 * 3600 * 24));
          return agg+constrain(25*dayDiff-dayDiff*dayDiff/2, 0, 25*12.5);
        }
    }, 0);
}

function economyIndex(selection) {
    const delayThreshold = 20; // days
    return attackDates.reduce( (agg, d, j) => {
        // for each attack create an array with all the images that cover it within the
        // delayThreshold (extended coverage) from the SELECTION
        let t0 = new Date(d).getTime(); // time of attack
        let coveringImgs = selection.filter ( i => {
            let td = i.time.getTime() - t0;
            return (td >= 0 && td < 1000 * 3600 * 24 * delayThreshold) 
        });
        // if there are no images covering last attack selection value is 0
        // BUT RETURN STATEMENT MAY BE PROBLEMATIC
        if (coveringImgs.length == 0) return j == attackDates.length-1?0:agg; 

        let firstCoveringImg = coveringImgs.sort( (i,j) => i.time.getTime < j.time.getTime? -1:1)[0]
        
        // TODO: To resolve conflicts, add a little consideration for owned/information subcriteria
        // Model is showing a preference for "last images"
        // Also, model shows a strange preference for images which cover no attacks
        let bestShot = 0;
        if (coveringImgs.filter( b => b.interest.type == 'detail').length >= 2 && coveringImgs.some( i => (coveringImgs.filter( b => {
            let sortieNr0 = [i.id.split('/')[0],parseInt(i.id.split('/')[1])];
            let sortieNr1 = [b.id.split('/')[0],parseInt(b.id.split('/')[1])];
            return (sortieNr1[0] === sortieNr0[0] && Math.abs(sortieNr0[1]-sortieNr1[1]) === 1 && i!=b)
        }).length > 0))) bestShot = 2;
        // else if (coveringImgs.filter( b => b.interest.type == 'detail').length >= 2) bestShot = .8; 
        else if (coveringImgs.filter( b => b.interest.type == 'detail' && b.meta.pairs.length > 0).length == 1) bestShot = .8;
        else if (coveringImgs.filter( b => b.interest.type == 'detail').length == 1) bestShot = .4; 
        else if (coveringImgs.filter( b => b.interest.type == 'overview').length >= 0) bestShot = .2; 
        // bestShot *= coveringImgs.map( b => b.meta.info).reduce( (b, agg) => (agg+b)/coveringImgs.length, 0)/1000;

        let delayDays = Math.round((firstCoveringImg.time.getTime() - t0)/(1000 * 3600 * 24));
        return agg +=(bestShot/coveringImgs.length)*(1-1/delayThreshold)/attackDates.length;
    }, 0);
}

function qualityIndex(selection) {
    return economyIndex(selection)*timeCvgSawIndex(selection)+ownedIndex(selection)*.05//*infoIndex(selection);
}

function orientModel() {
    let currentQualityIndex = qualityIndex([...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected)])
    aerials.forEach( a => {
        let selectionWithAerial = [...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected), a];
        let selectionWithoutAerial = [...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected && b !== a)]
        // if the images are already select, measure their negative value of deselection
        if (a.prescribed || a.selected) a.meta.value = qualityIndex(selectionWithoutAerial)-currentQualityIndex;
        else a.meta.value = qualityIndex(selectionWithAerial)-currentQualityIndex;
    });
    console.log(currentQualityIndex);
    // let valueRange = aerials.reduce( (agg, a) => [Math.min(agg[0],a.meta.value), Math.max(agg[1],a.meta.value)], [Infinity, -Infinity]);
    // aerials.forEach( a => {
    //     a.meta.valueNormalized =  (a.meta.value - valueRange[0]) / (valueRange[1] - valueRange[0]);
    // });
}

function generateSelection() {
    // Sort all images by SQM value
    let imageLimit = 35;
    let sortedImages = aerials.slice().sort( (a,b) => a.meta.value < b.meta.value? 1:-1);
     //apply constrain
    // prGuidance.prescribed = prGuidance.prescribed.filter( a => a.usage == 0);
    // sortedImages = sortedImages.filter( a => a.usage == 0);

    let bestPick = sortedImages[0];
    if (bestPick.meta.value > .001 && prGuidance.prescribed.length < imageLimit) {
        guidanceSelect(bestPick);
        prescribedSelectionValue += bestPick.meta.value;
        // console.log("Prescribed Selection Value  "+ prescribedSelectionValue);
    }
}

// NOTE: this function is having no effect
// Let's turn this into an annealing phase
function correctModel() {
    aerials.forEach( a => {
        // if a prescribed image has 0 change-value, deselect
        if (a.prescribed && a.meta.value <= 0) guidanceDeselect(a);
    });
}

function evaluate() {
    let modelSpeed =2; // only divisible by 2
    if (frameCount > 15 && frameCount%(modelSpeed/2)==0) {
        if (frameCount%modelSpeed==0) orientModel();
        else generateSelection();
        // correctModel();
    }
}

function constrain(value, min, max) {
    return Math.min(Math.max(value, min), max);
}