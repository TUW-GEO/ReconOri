//
// SELECTION QUALITY MODEL
//
// ip 2023-04-10:
// This SQM considers type of images, pairing status, and temporal relations to attacks
// This SQM does NOT consider actual spatial coverage, information amount and the bestshot measure 
// is purposedly limited to the first covering image pair (in time) of an attack
//
// IMPORTANT NOTE: timespan of the project and threshold delay are HARDCODED
// SQM should ignore images with discarded status

let prescribedSelectionValue = 0;

let guidance = {
    state: 0,
    log: {
        values: []
    }
}

// Guidance loop
guidance.loop = function () {
    if (guidance.state == 0) {
        return 0;
    }
    // Inner phase: hard constraints not yet satisfied, building a complete solution
    else if (guidance.state == 1) {
        let delay = 2;
        if (frameCount%delay===0) guidance.orientModel();
        else if (frameCount%delay===(delay-1)) guidance.generateSelection();
    }
    // Outer phase: exploring the solution space with simulated annealing
    else if (guidance.state == 2) {
        // TODO: simulated annealing
        // guidance.shuffleWorst(5);
        // guidance.state = 0;
    }
}

guidance.shuffleWorst = function (n) {
    // Order ascending
    prGuidance.prescribed.sort( (a,b) => a.meta.value > b.meta.value? 1:-1).splice(0, n);
}

// Returns the value of an image given a selection and if the image is contained or not
// guidance.calculateExchangeValue(aerial, selection, contained)

guidance.orientModel = function() {
    let solutionValue = qualityIndex([...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected)]);
    guidance.log.values.push(solutionValue);
    // TODO: aerials.filter( a => a.usage != 1) does not work
    aerials.forEach( a => {
        if (a.usage == 0) { // User-discarded
            a.meta.value = -99; // Exile
        } else if (a.prescribed || a.selected) {
            let selectionWithoutAerial = [...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected && b !== a)];
            a.meta.value = qualityIndex(selectionWithoutAerial)-solutionValue;
        } else {
            let selectionWithAerial = [...prGuidance.prescribed, ...aerials.filter( b => b.meta.selected), a];
            a.meta.value = qualityIndex(selectionWithAerial)-solutionValue;
        }
    });
    let valueRange = aerials.reduce( (agg, a) => [Math.min(agg[0],a.meta.value), Math.max(agg[1],a.meta.value)], [Infinity, -Infinity]);
    aerials.forEach( a => {
        a.meta.normalValue =  (a.meta.value - valueRange[0]) / (valueRange[1] - valueRange[0]);
    });
}

guidance.generateSelection = function () {
    let imageLimit = 35;
    let sortedImages = aerials.slice().sort( (a,b) => a.meta.value < b.meta.value? 1:-1);
     //apply constrain
    // prGuidance.prescribed = prGuidance.prescribed.filter( a => a.usage == 0);
    // sortedImages = sortedImages.filter( a => a.usage == 0);
    let bestPick = sortedImages[0];
    if (bestPick.meta.value > .001 && prGuidance.prescribed.length < imageLimit) {
        guidanceSelect(bestPick);
        prescribedSelectionValue += bestPick.meta.value;
    } //else guidance.state = 1;
}

guidance.reconsider = function (a) {
   guidanceDeselect(a);
   guidance.state = 1;
}


function guidanceSelect(a) {
    a.meta.prescribed = true;
    prGuidance.prescribed.push(a);
    log.write('prescribe', a.id, [a.meta.value, a.meta.prescribed]);
    calculateAttackCvg();
}

function guidanceDeselect(a) {
    a.meta.prescribed = false;
    prGuidance.prescribed.splice(prGuidance.prescribed.indexOf(a),prGuidance.prescribed.indexOf(a));
    log.write('unprescribe', a.id, [a.meta.value, a.meta.prescribed]);
    calculateAttackCvg();
}


// QUALITY AND VALUE INDEXES

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

function spatialCvgIndex(selection) {
    return selection.reduce( (agg, i) => {
        return agg +=  i.meta.Cvg/selection.length;
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
    return economyIndex(selection)*timeCvgSawIndex(selection)+ownedIndex(selection)*.05+spatialCvgIndex(selection)//*infoIndex(selection);
}

// TODO: Eliminate this function as it overwrites p5
function constrain(value, min, max) {
    return Math.min(Math.max(value, min), max);
}