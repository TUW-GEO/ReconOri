//
// IMAGE SELECTION GUIDANCE MODEL
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
    state: 1,
    timer: 60,
    prescribed: [],
    log: {
        values: []
    }
}

// Guidance loop
guidance.loop = function () {
    guidance.timer = constrain(guidance.timer-=1,0,Infinity);
    // console.log(guidance.timer);
    // console.log(guidance.timer);
    if (guidance.state == 0) {
        return 0;
    }
    // Inner phase: hard constraints not yet satisfied, building a complete solution
    else if (guidance.state == 1 && guidance.timer == 0) {
        let delay = 4;
        if (frameCount%delay===0) guidance.orientModel();
        else if (frameCount%delay===(delay-1)) guidance.generateSelectionFrom(aerials.filter(a => !guidance.prescribed.includes(a) && a.usage !== 0));
    }
    // Outer phase: exploring the solution space with simulated annealing
    else if (guidance.state == 2) {
        let bestNew = simmulatedAnnealing(guidance.prescribed);
        if (bestNew) makeNewPrescription(bestNew);
    }
}

guidance.shuffleWorst = function (n) {
    // Order ascending
    let shuffled = guidance.prescribed.slice().sort( (a,b) => a.meta.value > b.meta.value? 1:-1).splice(0, n);
    shuffled.forEach( a => guidanceDeselect(a));
}

// Returns the value of an image given a selection and if the image is contained or not
// guidance.calculateExchangeValue(aerial, selection, contained)

// Calculates and assigns the individual interest of an aerial and updates its info measure
function calculateInterest( a ) {
    let info = a.meta.Cvg/a.meta.MASSTAB*1000;
    a.meta.information = info;
    let interest = 0;
    if (a.type=='detail') interest = info*(a.meta.LBDB?1:.5)*(a.meta.pairs?1:.5);
    else interest = info*(a.meta.LBDB?1:.5)*4;
    a.interest.pre = interest;
    // console.log(a.interest.pre);
    return interest;
}

// Calculates and assigns post interest (normalized within global day-range)
function calculateInterestPost( a ) {
    let neighborhood = aerials.filter( b => Math.abs(a.time.getTime()- b.time.getTime()) < 1000 * 3600 * 24 * dayRange );
    let range = neighborhood.reduce((acc, c) => {
        acc[0] = Math.min(acc[0] || c.interest.pre, c.interest.pre);
        acc[1] = Math.max(acc[1] || c.interest.pre, c.interest.pre);
        return acc;
    }, [Infinity, -Infinity]);
    

    neighborhood.forEach( b => {
        b.interest.post = b.interest.pre/range[1];
    });
}

// Orient model gives a value to every image by considering its contribution to a solution consisting of both SELECTED and PRESCRIBED images
// TODO Make solution arrays not contain repeated images
guidance.orientModel = function() {
    let jointSolution = [...guidance.prescribed, ...aerials.filter( b => b.usage==2 && !guidance.prescribed.includes(b))]
    let solutionValue = qualityIndex(jointSolution);
    guidance.log.values.push(solutionValue);
    // console.log(guidance.log.values);
    // TODO: aerials.filter( a => a.usage != 1) does not work
    aerials.forEach( a => {
        // if (a.usage == 0) { // User-discarded
        //     a.meta.value = -99; // Exile
        // } else 
        if (guidance.prescribed.includes(a) || a.meta.selected) {
            let selectionWithoutAerial = [...jointSolution.filter( b => b !== a)];
            a.meta.value = qualityIndex(selectionWithoutAerial)-solutionValue;
        } else {
            let selectionWithAerial = [...jointSolution, a];
            a.meta.value = qualityIndex(selectionWithAerial)-solutionValue;
        }
    });
    let valueRange = aerials.reduce( (agg, a) => [Math.min(agg[0],a.meta.value), Math.max(agg[1],a.meta.value)], [Infinity, -Infinity]);
    aerials.forEach( a => {
        a.meta.normalValue =  (a.meta.value - valueRange[0]) / (valueRange[1] - valueRange[0]);
    });
}

guidance.generateSelectionFrom = function (aerials) {
    let imageLimit = test?16:40;
    let bestPick = aerials.reduce((highest, current) => {
        return current.meta.value > highest.meta.value? current : highest;
      }, aerials[0]);
    if (bestPick.meta.value > .0001 && guidance.prescribed.length < imageLimit) {
        guidanceSelect(bestPick);
        prescribedSelectionValue += bestPick.meta.value;
    } else guidance.state = 0;
}

guidance.reconsider = function (a) {
   guidanceDeselect(a);
//    shuffleWorst(3);
   guidance.state = 1;
}


function guidanceSelect(a) {
    console.log("Prescribing "+a.id);
    a.meta.prescribed = true;
    prGuidance.prescribed.push(a);
    guidance.prescribed.push(a)
    log.write('guide','prescribe', a.id, [a.meta.value, a.interest.post]);
    calculateAttackCvg();
}

function guidanceDeselect(a) {
    a.meta.prescribed = false;
    prGuidance.prescribed.splice(prGuidance.prescribed.indexOf(a),prGuidance.prescribed.indexOf(a));
    guidance.prescribed.splice(guidance.prescribed.indexOf(a),guidance.prescribed.indexOf(a));
    log.write('guide','unprescribe', a.id, [a.meta.value, a.interest.post]);
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
        if (coveringImgs.filter( b => b.type == 'detail').length >= 2 && coveringImgs.some( i => (coveringImgs.filter( b => {
            let sortieNr0 = [i.id.split('/')[0],parseInt(i.id.split('/')[1])];
            let sortieNr1 = [b.id.split('/')[0],parseInt(b.id.split('/')[1])];
            return (sortieNr1[0] === sortieNr0[0] && Math.abs(sortieNr0[1]-sortieNr1[1]) === 1 && i!=b)
        }).length > 0))) bestShot = 2;
        // else if (coveringImgs.filter( b => b.type == 'detail').length >= 2) bestShot = .8; 
        else if (coveringImgs.filter( b => b.type == 'detail' && b.meta.pairs.length > 0).length == 1) bestShot = .8;
        else if (coveringImgs.filter( b => b.type == 'detail').length == 1) bestShot = .4; 
        else if (coveringImgs.filter( b => b.type == 'overview').length >= 0) bestShot = .2; 
        // bestShot *= coveringImgs.map( b => b.meta.info).reduce( (b, agg) => (agg+b)/coveringImgs.length, 0)/1000;

        let delayDays = Math.round((firstCoveringImg.time.getTime() - t0)/(1000 * 3600 * 24));
        return agg +=(bestShot/coveringImgs.length)*(1-1/delayThreshold)/attackDates.length;
    }, 0);
}

function qualityIndex(selection) {
    return economyIndex(selection)*timeCvgSawIndex(selection)+(ownedIndex(selection)+spatialCvgIndex(selection)+infoIndex(selection));
}

// TODO: Eliminate this function as it overwrites p5
// function constrain(value, min, max) {
//     return Math.min(Math.max(value, min), max);
// }

// SIMULATED ANNEALING

function simmulatedAnnealing (startSolution) {
    let T = 100;
    let dT = 0.05;
    let currentSolution = startSolution;
    let currentValue = qualityIndex(startSolution);
    let bestValue = qualityIndex(guidance.prescribed);
    let bestNewSolution = null;
    while ( T > 0 ) {
        let candidateSolution = randomSwap(currentSolution, aerials);
        let candidateValue = qualityIndex(candidateSolution);
        if (candidateValue > bestValue) {
            // accept candidate solution
            currentSolution = candidateSolution;
            currentValue = candidateValue;
            // set as best
            bestNewSolution = candidateSolution;
            currentValue = candidateValue;
        } else if (random() < Math.exp(candidateValue-currentValue)/T) {
            // accept candidate solution
            currentSolution = candidateSolution;
            currentValue = candidateValue;
        }
        T -= dT;
    } 
    return bestNewSolution;
}

function randomSwap(selectedSet, fullSet) {
    // Check if both sets are not empty
    if (selectedSet.length === 0 || fullSet.length === 0) {
        console.log("One of the sets is empty. Cannot perform swap.");
        return selectedSet;
    }

    // Filter selectedSet to include only elements that are not selected (usage!== 2)
    const availableSelectedElements = PRESELECTED? selectedSet: selectedSet.filter(element => element.usage!== 2);

    // If there are no available elements in selectedSet to swap, return the original set
    if (availableSelectedElements.length === 0) {
        console.log("No available elements in selectedSet to swap.");
        return selectedSet;
    }

    // Remove a random element from the filtered selectedSet
    const indexToRemove = Math.floor(Math.random() * availableSelectedElements.length);
    const removedElement = availableSelectedElements.splice(indexToRemove, 1)[0];

    // Filter out elements from fullSet that are already in selectedSet, prescribed, or discarded
    const availableElements = fullSet.filter(element => 
       !selectedSet.includes(element) && 
       !element.meta.prescribed && 
        element.usage!== 0
    );

    // Check if there are any available elements to swap
    if (availableElements.length === 0) {
        console.log("No available elements to swap.");
        return selectedSet;
    }

    // Select a random element from the filtered fullSet
    const indexToAdd = Math.floor(Math.random() * availableElements.length);
    const elementToAdd = availableElements[indexToAdd];

    // Add the selected element to selectedSet
    selectedSet.push(elementToAdd);

    // Return the updated selectedSet
    return selectedSet;
}

function makeNewPrescription(newPrescription) {
    // Elements to be added to guidance.prescribed
    const toAdd = newPrescription.filter(element =>!guidance.prescribed.includes(element));

    // Elements to be removed from guidance.prescribed
    const toRemove = guidance.prescribed.filter(element =>!newPrescription.includes(element));

    // Add new elements to guidance.prescribed
    toAdd.forEach(element => {
        guidanceSelect(element);
    });

    // Remove elements from guidance.prescribed
    toRemove.forEach(element => {
        guidanceDeselect(element);
    });
}