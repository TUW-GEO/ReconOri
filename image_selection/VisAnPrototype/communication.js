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

    if (test) {
        aerials = aerials.filter( a => Date.parse("1945-01-01") < Date.parse(a.meta.Datum) );
        attackDates = attackDates.filter( a => Date.parse("1945-01-01") < Date.parse(a) );
        aerialDates = aerialDates.filter( a => Date.parse("1945-01-01") < Date.parse(a) );
    }
}));
  
qgisplugin.attackDataLoaded.connect(handleErrors(function(_attackData){
    console.log("Attack data: " + JSON.stringify(_attackData, null, 4));
    // only for non st. Poelten attack records (DATUM vs. Datum)
    // attackDates = attacks.filter(a => a.obj.Datum).map( a => a.obj.Datum).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
}));

const calculatePolygons = function (a) {
    let aerialPoly = toPolygon(a.footprint);
    // let center = turf.center(aerialPoly);
    // let radius = Math.sqrt(2)/1.6*turf.distance(aerialPoly.geometry.coordinates[0][0],aerialPoly.geometry.coordinates[0][1],{units: 'kilometers'});
    // let options = {steps: 10, units: 'kilometers'};
    // let circle = turf.circle(center, radius, options);
    // aerialPoly = circle;
    let intersection = turf.intersect( aerialPoly, aoiPoly );
    return {
        full: aerialPoly,
        aoi: intersection
    }
}
    
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
        // In the beginning start by assuming a buffer around images, as they are not georef yet
        // This changes to their actual polygon when they are manually georef
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
            full: circle,
            aoi: intersection
        }//calculatePolygons(a);
        a.time = new Date(a.meta.Datum);
        a.vis = { pos: [0,0] };
        a.interest = {};
        a.type = (a.meta.MASSTAB <= 20000?"detail":"overview");
        a.meta.Cvg = cvg/aoiArea;
        a.owned = a.meta.LBDB?1:0;
        a.meta.information = info;
        a.meta.detail = (a.meta.MASSTAB <= 20000);
        a.meta.pairs = [];
        a.meta.interest = 0;
        a.meta.prescribed = false;
        a.previewOpen = false;

        // PRESELECT from database
        // Not working
        // if (a.usage == 2) userSelect(a);//a.meta.selected = true;
        
        let nr = new String(a.meta.Bildnr);
        a.meta.p = nr.slice(0,1) === '3'? -1:nr.slice(0,1) === '4'? 1:0; // polarity: -1, 0, 1 (left, center, right)
    });
  
    timebins = []; // restart on reload
    
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
            } else a.interest.pre = a.meta.Cvg*(a.meta.LBDB?1:.5);
        })
        overviews.forEach( a => {
            if (details.length > 0) {
            let detailPoly = details.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), details[0].polygon.aoi);
            let intersectionPoly = turf.intersect( a.polygon.aoi, detailPoly );
            a.interest.overlap = -(intersectionPoly? turf.area(intersectionPoly)/turf.area(a.polygon.aoi):0);
            a.interest.pre = .5*(a.meta.Cvg - (intersectionPoly? turf.area(intersectionPoly)/aoiArea:0))*(a.meta.LBDB?2:1);
            } a.interest.pre = .5*a.meta.Cvg*(a.meta.LBDB?1:.5); // 30000/a.meta.MASSTAB
        })
    })
    // Nullify all previous processing and calculate interest again
    aerials.forEach( a => calculateInterest(a));
    aerials.forEach( a => calculateInterestPost(a));

    attackDates.unshift(aerialDates[0]); // add a zero-attack
    

    // console.log(JSON.stringify(aerials.filter( a => Date.parse("1945-01-01") < a.time ).map( a=> a.id)));
    // Create attack objects
    attacks = attackDates.map( (a, i) => {
        atTime = new Date(a).getTime();
        // atacksRows.find( row => row.Datum == a);
        return {
          date: attackDates[i],
          time: atTime,
          flights: aerialDates.filter( d => d >= a && ((i+1)<attackDates.length? d < attackDates[i+1]: true) ),
          extFlights: aerialDates.filter( d => d >= a && (new Date(d).getTime())-atTime < 1000 * 3600 * 24 * dayRange),
          coverage: 0, // calculated in setup because of preselected images
          prescribed: false,
          pos: [0,0]
        }
    });
    
    
    // EQUIVALENCE CLASS CREATION
    timebins.forEach( (t,i) => {
        t.attacks = attackDates.filter( a => t.date >= a && ((new Date(t.date).getTime())-(new Date(a).getTime())) < 1000 * 3600 * 24 * dayRange);
        // if (t.date < attackDates[1]) t.attacks = attacks[0].date; // make flights before 1st attack cover attack-0
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

    // PRESCRIBING (AND ORIENTING) GUIDANCE
    prGuidance.prescribed = [];
    guidance.prescribed = [];

    // resetSketch();
}));
  
qgisplugin.aerialFootPrintChanged.connect(handleErrors(function(imgId, _footprint) {
    // console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
    footprints[imgId] = _footprint;
    let a = aerials.find( a => a.id === imgId);
    a.footprint = _footprint; 
    a.polygon = calculatePolygons(a);
    // console.log(turf.area(a.polygon.aoi));
    a.meta.Cvg= a.polygon.aoi? turf.area(a.polygon.aoi)/aoiArea: 0;

    calculateInterest(a);
    calculateInterestPost(a);
    calculateAttackCvg();
    
    // guidance.timer = 50;
    guidance.reconsider(a); 
}));
  
qgisplugin.aerialAvailabilityChanged.connect(handleErrors(function(imgId, _availability, path){
    console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
    // availability[imgId] = _availability;
}));

qgisplugin.aerialUsageChanged.connect(handleErrors(function(imgId, usage){
    console.log("Usage of " + imgId + " has changed to " + usage);
    let aerial = aerials.find( a => a.id === imgId);
    if (usage==2) userSelect(aerial);
    else if (usage==1) userUnset(aerial);
    else if (usage==0) userDiscard(aerial);
    // Trigger Guidance behaviour
    // guidance.reconsider(aerial);
}));


  
// OUTBOUND

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object, link) {
    // if (link === 'link') document.getElementById(link).href = "#" +  encodeURIComponent(JSON.stringify(object));
    if (link === 'filter') qgisplugin.filterAerials(object);
    else if (link === 'unfilter') qgisplugin.filterAerials([]);
    else if (link === 'highlight') qgisplugin.highlightAerials(object);
    else if (link === 'unhighlight') qgisplugin.highlightAerials([]);
    else if (link === 'openPreview') qgisplugin.showAsImage(object, true);
    else if (link === 'closePreview') qgisplugin.showAsImage(object, false);
    // document.getElementById(link).click();
    return 0;
}

//// GEOMETRIC


function calculateImageCoverage(aoiPoly, aoiArea, aerialPoly) {
    // Find the intersection of the circle with the AOI
    let intersection = turf.intersect(aerialPoly, aoiPoly);

    // Calculate the coverage as the area of the intersection divided by the AOI area
    let coverage = intersection ? turf.area(intersection) / aoiArea : 0;

    return coverage;
}

// Convert a footprint to a polygon
const toPolygon = function (footprint) {
    let convertedCoorArr = [footprint.map(a => turf.toWgs84([a.x, a.y]))];
    convertedCoorArr[0].push(convertedCoorArr[0][0]);
    return turf.polygon(convertedCoorArr);
}


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
            selectedImages = [...selectedImages, ...aerials.filter( aerial => aerial.meta.Datum === d && (aerial.meta.selected || aerial.meta.prescribed))];
        })
        a.coverage = [
            aggregateCoverage(selectedImages.filter( i => i.meta.selected).map( b => b.polygon.aoi)),
            aggregateCoverage(selectedImages.filter( i => i.meta.prescribed).map( b => b.polygon.aoi))
        ]
        // console.log(a.coverage);
    })
}
