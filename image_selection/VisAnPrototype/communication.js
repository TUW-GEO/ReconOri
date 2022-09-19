//// GEOMETRIC

const aggregateCoverage = function( polygons ) {
    polygons = polygons.filter( a => a );
    if (polygons.length > 0) {
        polygons = polygons.reduce( (union, a) => turf.union(union,a), polygons[0]);
        return turf.area(polygons)/aoiArea;
    } else return 0;
}

const calculateAttackCvg = function () {
    attacks.forEach( (a ,i) => {
        let selectedImages = [];
        a.extFlights.forEach( (d, j) => {
            selectedImages = [...selectedImages, ...aerials.filter( aerial => aerial.meta.Datum === d).filter( aerial => aerial.meta.selected)];
        })
        a.coverage = aggregateCoverage(selectedImages.map( b => b.polygon.aoi));
    })
}

//// COMMUNICATION

// wk 2022-08-04: exceptions must not escape from Qt slots!
const handleErrors = function(func) {
    return function(...args) {
        try {
            return func(...args);
        }
        catch(error) {
            console.error(error);
        }
    }
}

// INBOUND
qgisplugin.aerialsLoaded.connect(handleErrors(function(_aerials) {
    console.log(JSON.stringify(_aerials, null, 4));
    aerials = _aerials.sort( (a,b) => a.meta.Datum > b.meta.Datum).filter( a => a.footprint);
    aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
    currentTimebin = '';
}));
  
qgisplugin.attackDataLoaded.connect(handleErrors(function(_attackData){
    console.log("Attack data: " + JSON.stringify(_attackData, null, 4));
    // only for non st. Poelten attack records (DATUM vs. Datum)
    // attackDates = attacks.filter(a => a.obj.Datum).map( a => a.obj.Datum).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
}));
    
qgisplugin.areaOfInterestLoaded.connect(handleErrors(function(_aoi){
    const toPolygon = function (footprint) {
        let convertedCoorArr = [footprint.map( a => turf.toWgs84([a.x,a.y]))];
        convertedCoorArr[0].push(convertedCoorArr[0][0]);
        return turf.polygon(convertedCoorArr);
    }
  
    console.log("Area of interest loaded: " + JSON.stringify(_aoi, null, 4));
    aoi = _aoi;
    aoiPoly =  toPolygon(aoi);
    aoiArea = turf.area(aoiPoly);
    console.log("Area of AOI: " + aoiArea);
  
    aerials.forEach( a => {
        let aerialPoly = toPolygon(a.footprint);
        let center = turf.center(aerialPoly);
        let radius = Math.sqrt(2)/1.6*turf.distance(aerialPoly.geometry.coordinates[0][0],aerialPoly.geometry.coordinates[0][1],{units: 'kilometers'});
        let options = {steps: 10, units: 'kilometers'};
        let circle = turf.circle(center, radius, options);
        aerialPoly = circle;
        let intersection = turf.intersect( aerialPoly, aoiPoly);
        let cvg = intersection? turf.area(intersection): 0;
        let info = cvg/a.meta.MASSTAB;
        a.polygon = {
            full: aerialPoly,
            aoi: intersection
        }
        a.time = new Date(a.meta.Datum);
        a.vis = { pos: [0,0] };
        a.interest = {};
        a.meta.Cvg = cvg/aoiArea;
        a.interest.Cvg = a.meta.Cvg;
        a.interest.owned = a.meta.LBDB?1:0;
        a.meta.information = info;
        a.meta.detail = (a.meta.MASSTAB <= 20000);
        a.meta.pairs = [];
        a.meta.interest = 0;
        a.meta.prescribed = false;
        let nr = new String(a.meta.Bildnr);
        a.meta.p = nr.slice(0,1) === '3'? -1:nr.slice(0,1) === '4'? 1:0; // polarity: -1, 0, 1 (left, center, right)
    });
  
    timebins = []; // restart on reload
    //calculate guidance (isolate)
    aerialDates.forEach( d => {
        let timebin = aerials.filter( a => a.meta.Datum === d);
        let details = timebin.filter(a => a.meta.MASSTAB <= 20000 && a.polygon.aoi);
        let overviews = timebin.filter ( a => a.meta.MASSTAB > 20000 && a.polygon.aoi);
    
        
        timebins.push( {
            date: d,
            time: new Date(d),
            aerials: timebin,
            aggCvg: [
                aggregateCoverage(details.map( a => a.polygon.aoi)),
                aggregateCoverage(overviews.map( a => a.polygon.aoi))
            ]
        });
      
        details.forEach( a => {
            let possiblePairs = details.filter( b => b.meta.Sortie === a.meta.Sortie && Math.abs(b.meta.Bildnr-a.meta.Bildnr) == 1 && b.polygon.aoi && a!=b );
            // let pairedIntersection = 0;
            a.interest.type = 'detail'
            if (possiblePairs.length > 0) {
                a.meta.pairs = possiblePairs;
                let pairedValue = 0;
                [true, false].forEach ( (v, i) => {
                    let possiblePairsPartial = possiblePairs.filter( b => b.meta.LBDB == v );
                    if (possiblePairsPartial.length > 0) {
                        let possiblePairsPoly =  possiblePairs.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), possiblePairs[0].polygon.aoi);
                        let pairedIntersection = turf.intersect( a.polygon.aoi, possiblePairsPoly );
                        pairedValue += (pairedIntersection? turf.area(pairedIntersection)/aoiArea:0)*(i==0?1:.5);
                    }
                })
                // let possiblePairsOwned = possiblePairs.filter( b => b.meta.LBDB );
                // let possiblePairsUnowned = possiblePairs.filter( b => !b.meta.LBDB );
                // let possiblePairsPoly =  possiblePairs.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), possiblePairs[0].polygon.aoi);
                // pairedIntersection = turf.intersect( a.polygon.aoi, possiblePairsPoly );
                a.interest.paired = pairedValue//pairedIntersection? turf.area(pairedIntersection)/turf.area(a.polygon.aoi):0;
                a.interest.pre = (a.meta.Cvg + pairedValue)*(a.meta.LBDB?2:1);
            } else a.interest.pre = a.meta.Cvg*(a.meta.LBDB?2:1);
        })
        overviews.forEach( a => {
            a.interest.type = 'overview'
            if (details.length > 0) {
            let detailPoly = details.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), details[0].polygon.aoi);
            let intersectionPoly = turf.intersect( a.polygon.aoi, detailPoly );
            a.interest.overlap = -(intersectionPoly? turf.area(intersectionPoly)/turf.area(a.polygon.aoi):0);
            a.interest.pre = .5*(a.meta.Cvg - (intersectionPoly? turf.area(intersectionPoly)/aoiArea:0))*(a.meta.LBDB?2:1);
            } a.interest.pre = .5*a.meta.Cvg*(a.meta.LBDB?2:1);
        // shared information-based timebin-secluded interest measure calculation
        // timebin.forEach( b => {
        //   if (a.polygon.aoi && b.polygon.aoi && a != b) {
        //     let inter = turf.intersect( a.polygon.aoi, b.polygon.aoi );
        //     if (inter) sharedInfo += turf.area(inter)/b.meta.MASSTAB;
        //     a.meta.interest = a.meta.Cvg - ;
        //   } else a.meta.interest = a.meta.Cvg;
        // })
        })
        
        // normalize interest by range within timebin
        // let ranges = timebin.map( a => a.interest.pre).reduce ( (agg, a) => [Math.min(agg[0],a),Math.max(agg[1],a)], [0,0]);
        // timebin.forEach( a => {
        //     a.interest.post = a.interest.pre/ranges[1];
        //     a.meta.interest = a.interest.post;
        // });
    })
    // normalize interest within a dayRange period before and after 
    aerials.forEach( a => {
        let aerialSet = aerials.filter( b => Math.abs(a.time.getTime()- b.time.getTime()) < 1000 * 3600 * 24 * dayRange );
        let ranges = aerialSet.map( a => a.interest.pre).reduce ( (agg, a) => {
            if (a) return [Math.min(agg[0],a),Math.max(agg[1],a)];
            else return agg;
        }, [0,0]);
        a.interest.post = a.interest.pre/ranges[1];
        a.meta.interest = a.interest.post;
    })

    attackDates.unshift(aerialDates[0]); // add a zero-attack
    if (test) attackDates = attackDates.splice(0,attackDates.length-9);
    attacks = attackDates.map( (a, i) => {
        atTime = new Date(a).getTime();
        return {
          date: attackDates[i],
          flights: aerialDates.filter( d => d >= a && ((i+1)<attackDates.length? d < attackDates[i+1]: true) ),
          extFlights: aerialDates.filter( d => d >= a && (new Date(d).getTime())-atTime < 1000 * 3600 * 24 * dayRange),
          coverage: 0, // calculated in setup because of preselected images
          prescribed: false
        }
    });
    
    // EQUIVALENCE CLASS CREATION
    timebins.forEach( (t,i) => {
        t.attacks = attackDates.filter( a => t.date >= a && ((new Date(t.date).getTime())-(new Date(a).getTime())) < 1000 * 3600 * 24 * dayRange);
    })
    function arraysEqual(a, b) {
        if (a === b) return true;
        if (a == null || b == null) return false;
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; ++i) {
          if (a[i] !== b[i]) return false;
        }
        return true;
    }
    // console.log(JSON.stringify(timebins.map( a => a.attacks)));
    eqClasses = timebins.reduce( (groups, t) => {
            if (groups.length == 0 || !arraysEqual(groups[groups.length-1][0].attacks, t.attacks)) groups.push([t]);
            else groups[groups.length-1].push(t);
            return groups;
        }, []);
    // console.log(JSON.stringify(eqClasses.map( a => a.length)));
    
    // PRESCRIBING GUIDANCE
    // let reverseAttacks = attacks.slice().reverse();
    // console.log('hasasd');
    // reverseAttacks.forEach( (a, i) => {
    //     console.log('hasd');
    //     if (a.coverage == 0) {
    //         console.log('hasd');
    //         let cvgClasses = eqClasses.filter( c => c[0].attacks.includes(a.date));
    //         console.log(cvgClasses.length);
    //         cvgClasses.sort( (c1,c2) => c1[0].attacks.length > c2[0].attacks.length?1:-1 );
    //         let bestClass = cvgClasses[0];
    //         let allAerials = timebins.filter( t => [bestClass].map( a => a.date).includes(t.date)).map(t => t.aerials).reduce( (agg, a) => [...agg, ...a],[]);
    //         let bestPick = allAerials.sort( (a1,a2) => a1.meta.interest < a2.meta.interest? 1:-1)[0];
    //         bestPick.meta.prescribed = true; // pick the most interesting image 
    //         if (bestPick.meta.pairs.length > 0) bestPick.meta.pairs.sort( (a1,a2) => a1.interest > a2.interest?-1:1)[0].meta.prescribed = true; // pick the best pair if possible
    //     }
    // });
    prGuidance.prescribed = [];; 
    let reducedEqClasses = eqClasses.filter( (c, i, arr) => {
        let isContainedByNext = i==arr.length-1? false: c[0].attacks.every( a => arr[i+1][0].attacks.indexOf(a) > -1);
        let isContainedByPrev = i==0? false: c[0].attacks.every( a => arr[i-1][0].attacks.indexOf(a) > -1);
        return !isContainedByNext && !isContainedByPrev;
    });
    reducedEqClasses.forEach( c => {
        let allAerials = timebins.filter( t => c.map( a => a.date).includes(t.date)).map (t => t.aerials).reduce( (agg, a) => [...agg, ...a],[]).filter(a => a.meta.interest);
        let bestPick = allAerials.sort( (a,b) => a.meta.interest < b.meta.interest? 1:-1)[0];
        bestPick.meta.prescribed = true; 
        prGuidance.prescribed.push(bestPick);
        attacks.filter( a => c[0].attacks.indexOf(a.date) > -1).forEach( a => a.prescribed = true);
        if (bestPick.meta.pairs.length > 0) {
            let bestPair = bestPick.meta.pairs.sort( (a,b) => a.interest > b.interest?-1:1)[0];
            bestPair.meta.prescribed = true;
            prGuidance.prescribed.push(bestPair);
         } // pick the best pair if possible
    }) // pick the most interesting images for each eqclass
    
}));
  
qgisplugin.aerialFootPrintChanged.connect(handleErrors(function(imgId, _footprint) {
    console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
    footprints[imgId] = _footprint;
    // aerials = aerials.map( a => a.id === imgId? {...a, footprint: _footprint}: a); 
}));
  
qgisplugin.aerialAvailabilityChanged.connect(handleErrors(function(imgId, _availability, path){
    console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
    // availability[imgId] = _availability;
}));

qgisplugin.aerialUsageChanged.connect(handleErrors(function(imgId, usage){
    console.log("Usage of " + imgId + " has changed to " + usage);
    let aerial = aerials.filter( a => a.id === imgId)[0];
    aerial.usage = usage;
    aerial.meta.selected = (usage == 2? true: false);
    log.write((usage == 2?'select':'discard'),aerial.id,aerial.interest.post);
    calculateAttackCvg();
}));
  
// OUTBOUND

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object, link) {
    // if (link === 'link') document.getElementById(link).href = "#" +  encodeURIComponent(JSON.stringify(object));
    if (link === 'filter') qgisplugin.filterAerials(object);
    else if (link === 'unfilter') qgisplugin.filterAerials([]);
    else if (link === 'highlight') qgisplugin.highlightAerials(object);
    else if (link === 'unhighlight') qgisplugin.highlightAerials([]);

    // document.getElementById(link).click();
    return 0;
}