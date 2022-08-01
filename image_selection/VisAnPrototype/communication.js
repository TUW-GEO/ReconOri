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

// INBOUND
qgisplugin.aerialsLoaded.connect(function(_aerials) {
    console.log(JSON.stringify(_aerials, null, 4));
    aerials = _aerials.sort( (a,b) => a.meta.Datum > b.meta.Datum).filter( a => a.footprint);
    aerialDates = aerials.map( a => a.meta.Datum).filter(onlyUnique);
    currentTimebin = '';
});
  
qgisplugin.attackDataLoaded.connect(function(_attackData){
    console.log("Attack data: " + JSON.stringify(_attackData, null, 4));
    // only for non st. Poelten attack records (DATUM vs. Datum)
    // attackDates = attacks.filter(a => a.obj.Datum).map( a => a.obj.Datum).slice(0,attacks.length-1).map( a => {let d = a.split('/'); return d[2]+(d[1].length==1?'-0':'-')+d[1]+(d[0].length==1?'-0':'-')+d[0]});
});
    
qgisplugin.areaOfInterestLoaded.connect(function(_aoi){
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
        let radius = Math.sqrt(2)/1.75*turf.distance(aerialPoly.geometry.coordinates[0][0],aerialPoly.geometry.coordinates[0][1],{units: 'kilometers'});
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
        a.meta.interest = 0;
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
            let pairedIntersection = 0;
            a.interest.type = 'detail'
            if (possiblePairs.length > 0) {
                let possiblePairsPoly =  possiblePairs.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), possiblePairs[0].polygon.aoi);
                pairedIntersection = turf.intersect( a.polygon.aoi, possiblePairsPoly );
                a.interest.paired = pairedIntersection? turf.area(pairedIntersection)/turf.area(a.polygon.aoi):0;
                a.meta.interest = (a.meta.Cvg + (pairedIntersection? turf.area(pairedIntersection)/aoiArea:0))*(a.meta.LBDB?2:1);
            } else a.meta.interest = a.meta.Cvg*(a.meta.LBDB?2:1);
            a.interest.pre = a.meta.interest;
        })
        overviews.forEach( a => {
            a.interest.type = 'overview'
            if (details.length > 0) {
            let detailPoly = details.reduce( (poly, b) => turf.union(b.polygon.aoi,poly), details[0].polygon.aoi);
            let intersectionPoly = turf.intersect( a.polygon.aoi, detailPoly );
            a.interest.overlap = -(intersectionPoly? turf.area(intersectionPoly)/turf.area(a.polygon.aoi):0);
            a.meta.interest = .5*(a.meta.Cvg - (intersectionPoly? turf.area(intersectionPoly)/aoiArea:0))*(a.meta.LBDB?2:1);
            } a.meta.interest = .5*a.meta.Cvg*(a.meta.LBDB?2:1);
            a.interest.pre = a.meta.interest;
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
        let ranges = timebin.map( a => a.meta.interest).reduce ( (agg, a) => [Math.min(agg[0],a),Math.max(agg[1],a)], [0,0]);
        timebin.forEach( a => {a.meta.interest = a.meta.interest/ranges[1]; a.interest.post=a.meta.interest});
    })
    attackDates.unshift(aerialDates[0]); // add a zero-attack
    attacks = attackDates.map( (a, i) => {
        atTime = new Date(a).getTime();
        return {
          date: attackDates[i],
          flights: aerialDates.filter( d => d >= a && ((i+1)<attackDates.length? d < attackDates[i+1]: true) ),
          extFlights: aerialDates.filter( d => d >= a && (new Date(d).getTime())-atTime < 1000 * 3600 * 24 * 31),
          coverage: 0 // calculated in setup because of preselected images
        }
      });
      console.log(JSON.stringify(attacks.map( a => a.date)));
      console.log(JSON.stringify(attacks.map( a => a.extFlights)));
    // attacks.forEach( (a, i, arr) => {
    //     a.date = attackDates[i];
    //     a.flights = aerialDates.filter( d => d >= a.date )//&& ((i+1)<arr.length? d < arr[i+1].date: true));
    //     a.posflights = [];
    //     a.coverage = 0;
    // })
    // console.log(JSON.stringify(attacks.map( a => a.date)));
    // console.log(JSON.stringify(attackDates));
});
  
qgisplugin.aerialFootPrintChanged.connect(function(imgId, _footprint) {
    console.log("Footprint of " + imgId + " has changed to " + JSON.stringify(_footprint, null, 4));
    footprints[imgId] = _footprint;
    // aerials = aerials.map( a => a.id === imgId? {...a, footprint: _footprint}: a); 
});
  
qgisplugin.aerialAvailabilityChanged.connect(function(imgId, _availability, path){
    console.log("Availability of " + imgId + " has changed to: " + _availability + " with file path: " + path);
    // availability[imgId] = _availability;
});
  
qgisplugin.aerialUsageChanged.connect(function(imgId, usage){
    console.log("Usage of " + imgId + " has changed to " + usage);
    let aerial = aerials.filter( a => a.id === imgId)[0];
    aerial.usage = usage;
    aerial.meta.selected = (usage == 2? true: false);
    calculateAttackCvg();
});
  
// OUTBOUND

// ip: uses the hidden link to send a text message to the plugin
const sendObject = function (object, link) {
    document.getElementById(link).href = "#" +  encodeURIComponent(JSON.stringify(object));
    document.getElementById(link).click();
    return 0;
}