# geo/

Geodesy and small offline maps: distances, bearings and boxes on the Earth, coordinate parsing and formatting, Web
Mercator and tiles, encoded polylines, line clipping / simplification / chaining and the coastline → sea rule,
OpenStreetMap classification and a map style, SVG maps rendered to a string (tiles or a view of any size, with
collision-free labels, markers and a route), visiting order of stops with pickup-before-delivery constraints and a
trip sheet, a place tree country → region → city → street → building with a gazetteer search, and Georgian address
parsing in three scripts. Pure ES modules without dependencies: no DOM, they work in Node and in a page. Ported from
the KristinaHouse regional portal (geo tree, address parsing, own tile renderer) and the retail platform (haversine,
coordinate pairs with decimal commas, sender-before-receiver stop order), and extended. Reuses `portal/text.js`
(folding, inflection-tolerant word comparison, slugs) and `lingua/kartuli.js` (Georgian transliteration).

## Files

| file | contents |
|---|---|
| `sphere.js` | `EARTH_RADIUS`, `WGS84`, `latLng(p)`, `wrapLng`, `haversine(a, b)`, `vincenty(a, b)` → `{ distance, initial, final }`, `distance(a, b, { ellipsoid })`, `bearing`, `finalBearing`, `compass(deg, { points, lang, words })`, `destination(a, bearing, m)`, `interpolate(a, b, f)`, `midpoint`, `crossTrack(p, a, b)`, `pathLength(points)`, `polygonArea(ring)`, `bboxOf`, `bboxAround(p, m)`, `bboxContains`, `bboxIntersects`, `bboxUnion`, `bboxCenter`, `bboxPad`, `bboxToArray` / `bboxFromArray` |
| `coords.js` | `parseLatLng(text, { order })` → `{ lat, lng }` \| null, `parseAngle(text)`, `toDMS(deg)`, `formatLatLng(p, { format: 'dd' \| 'ddm' \| 'dms', digits, lang })`, `geoUri(p)`, `osmUrl(p, zoom)` |
| `mercator.js` | `TILE_SIZE`, `MERCATOR_MAX_LAT`, `lonToTileX` / `latToTileY` / `tileXToLon` / `tileYToLat`, `tileOf`, `tileBBox(z, x, y, padPx)`, `tileProjector(z, x, y, size)`, `toMeters` / `fromMeters`, `metersPerPixel(lat, z)`, `tileCoordOk`, `tilesInBBox(bbox, z)`, `fitBBox(bbox, w, h, { padding, fractional })`, `viewOf(center, zoom, w, h)` → `{ project, unproject, bbox }`, `quadkey` / `fromQuadkey`, `tileUrl(template, z, x, y)` |
| `polyline.js` | `encodePolyline(points, precision)`, `decodePolyline(str, precision)`, `encodeLines` / `decodeLines`, `encodePts` / `decodePts` |
| `lines.js` | `insideBBox`, `clipSegment`, `clipToBBox(points, box)`, `clipRingToBBox(ring, box)`, `simplify(points, toleranceM)` (Douglas–Peucker), `simplifyRadial`, `chainWays(ways, { reverse })`, `ringSignedArea`, `isClosed`, `pointInRing(p, ring \| [outer, …holes])`, `ringCentroid`, `lineMidpoint`, `perimeterT`, `boundaryWalk`, `strictlyInside`, `coastlineWaterRings(chains, box)` |
| `osm.js` | `OSM_ATTRIBUTION`, `OSM_COPYRIGHT_URL`, `STYLE_VERSION`, `LAND_COLOR`, `MAP_STYLE`, `SHAPE_KINDS`, `isShapeKind`, `kindMinZoom`, `shapeMinZoom(kind, bbox)`, `strokeWidth(base, z)`, `classifyOsmWay(tags)`, `wayName(tags, langs)`, `namesOf(tags)`, `CITY_BBOX`, `BUILDING_TYPES`, `mapOsmBuildingType(tags, map)`, `overpassToShapes(json, { langs, bbox })` → `{ shapes, places, addresses, coastline }` |
| `render.js` | `renderTileSvg(shapes, { z, x, y, size, labels })`, `renderMapSvg(shapes \| geojson, { width, height, bbox \| center + zoom, coastline, markers, route, places, style, land, labels, attribution, title })` → `{ svg, view, labels }`, `featuresToShapes(geojson)`, `placeLabels(candidates, { width, height, spacing })`, `pathD`, `labelAngle`, `labelCellKey`, `LABEL_CELL_DEG`, `labelFontSize`, `escXml` |
| `route.js` | `distanceMatrix(points, metric)`, `routeLength(order, dist, closed)`, `respects(order, before)`, `nearestNeighbour(dist, { start, end, before })`, `improveRoute(order, dist, { closed, fixedEnd, before })` (2-opt + or-opt), `planRoute(stops, { start, end, closed, before, roadFactor })` → `{ order, km, legs, valid }`, `tripSheet(stops, order, { start, speedKmh, serviceMin, roadFactor, closed })`, `clock(min)`, `routeKm(points)`, `orderByDistance(ids, movements, coordOf)` |
| `tree.js` | `GEO_KINDS`, `GEO_KIND_LABEL`, `isGeoKind`, `geoLevel`, `canNest`, `geoIndex(list)`, `geoAncestors`, `geoBreadcrumbs`, `geoIsWithin`, `wouldCycle`, `geoName(node, lang)`, `geoLoc`, `GEO_LOC_SUFFIX`, `geoPathLabel`, `sortGeo`, `geoTreeOrder`, `geoChildren`, `geoSlug`, `geoPathSlugs`, `geoHref(id, idx, prefix)`, `geoResolvePath(segments, list)`, `normalizeSelection`, `selectionWithin`, `selectionIsSet`, `selectionIds`, `gazetteer(list)`, `searchPlaces(index, query, { lang, kinds, limit })` |
| `address.js` | `parseHouseNumber(raw)` → `{ house, korpus, fraction, raw }`, `houseKey`, `korpusTwinSpellings(korpus)`, `houseNumberText(parts, lang)`, `addressText(parts, { lang, city, flat })`, `normStreetName`, `streetType`, `streetSkeleton`, `sameStreet(a, b, { anyOrder })`, `streetVariants`, `streetKeyIndex(nodes)`, `nearestStreetKey(keys, raw)`, `streetLocGuess(name, lang)`, `parseAddress(text, { cities })` |
| `fixture.js` | `FIXTURE`, `FIXTURE_BBOX`: 28 OSM ways around Europe Square, Batumi, for the tests (ODbL, see below) |
| `test.js` | unit tests: `node geo/test.js` (importing it runs nothing) |

## Conventions

- Points of geometry are `[lat, lng]` arrays (the polyline and Leaflet order); `sphere.js` and `route.js` also accept
  `{ lat, lng }` / `{ lat, lon }`. GeoJSON input (`[lng, lat]`) goes through `featuresToShapes`. Boxes are
  `{ south, west, north, east }`; `bboxToArray` gives the Overpass order `[south, west, north, east]`.
- Distances are metres, angles degrees clockwise from north. Haversine uses the mean radius 6 371 008.8 m (error up to
  ~0.5 %); `vincenty` matches the 1975 reference (Flinders Peak → Buninyong 54 972.271 m) and returns `null` when it
  does not converge (nearly antipodal points; `distance` then falls back to haversine).

## Coordinates (coords.js)

Decimal pairs with points or decimal commas ("41,6516 41,6367", "41,6516; 41,6367"), DMS / DDM with ° ′ ″ ' " or
spaces, hemisphere letters in Latin, Cyrillic ("с. ш.", "в. д.", С Ю В З) or Georgian (ჩ ს ა დ) before or after the
number — a pair is put in place by its letters ("41.6 E 41.7 N") — `geo:` URIs, OpenStreetMap links (`#map=z/lat/lng`,
`mlat` / `mlon`) and Google links (`@lat,lng`, `q=lat,lng`). Out-of-range values and two latitudes are rejected.

## Lines and coastline (lines.js)

`clipToBBox` ends a piece when the next ORIGINAL point is outside (a + (b − a) · 1 is not always b in floating point).
`chainWays` grows chains from heads — pieces whose start is nobody's end — so the Overpass answer order does not
matter (a naive pass split the Batumi coast into four pieces). OSM coastline has land on the left: water rings are
closed along the box edge walking clockwise; pieces that end inside the box (islands, truncated downloads) are skipped,
because painting land as sea is worse than not painting the sea. `simplify` keeps both ends (tile seams).

## Maps (osm.js, render.js)

- The style is a table: order, minimum zoom, fill / stroke / width at z16 / casing / dash, labels. Roads draw all
  casings before all fills (otherwise crossings break). Widths grow 2^0.55 per zoom. `shapeMinZoom` hides areas
  smaller than ~8 px, never road segments. Unknown tag values are not drawn.
- `renderTileSvg` is the portal's own 256 px tile renderer (labels from z16, anchored at the middle of the line by
  length, so neighbouring tiles agree). `renderMapSvg` renders a view: it fits a box (or a centre and zoom), builds
  sea polygons from coastline for the view, chains street ways by name and labels them every ~300 px where the text
  fits, adds place labels, markers (always drawn, labels first) and a route; `placeLabels` accepts labels greedily by
  priority with rotated boxes (separating axes) and keeps repeats of one name 220 px apart.
- Names are never machine-translated: `wayName` takes `name:<lang>` in the given order, then `name`.

## Routes (route.js)

`planRoute` builds a nearest-neighbour order from a fixed start (optionally a fixed end or a return to the start),
then improves it with 2-opt and or-opt; every move that breaks a precedence pair (`before: [[pickup, delivery]]`) is
rejected, and the construction only takes stops whose predecessors are visited. Stops without coordinates go last.
Straight lines underestimate streets: `roadFactor` (1.3 is a usual urban detour index) scales kilometres and times.
`tripSheet` gives leg and cumulative kilometres and arrival / departure times for a speed and service minutes.
`orderByDistance` / `routeKm` keep the retail project's API (a stop is allowed when all senders of its movements were
visited).

## Places and addresses (tree.js, address.js)

- The tree allows skipping levels (a city directly in a country), guards every walk against cycles (re-parenting in
  two clicks can make an ancestor a descendant) and shows orphans as roots so they can be fixed. Regions are not part
  of paths (`/georgia/batumi/rustaveli`), and the same rule builds and resolves them. Selections include and exclude
  subtrees; exclusion always wins. `searchPlaces` matches every query word to a word of one name in any language
  (equal, a prefix, or the same word with another ending), words naming an ancestor narrow the result.
- `parseHouseNumber` is the one parser for every path: "65б", "65 б" and "65-б" are one house; letters are recognised
  in Latin, Cyrillic and Mkhedruli but never converted; korpus markers in Russian, English and Georgian (კორპ.). Twins
  in other scripts are found by the place in the house-letter series, as a question for a person.
- Street keys drop generic words; `streetType` keeps the kind (street / avenue / lane / dead end …) so "X Street" and
  "X Lane" stay apart; `streetSkeleton` / `sameStreet` compare Georgian, Russian and Latin spellings (Georgian and
  Russian genitive endings dropped); `nearestStreetKey` suggests a street for an `addr:street` in another case
  ("მემედ აბაშიძეს" → "მემედ აბაშიძის", a real case of the fixture). Matches are suggestions, never merges.

## OpenStreetMap data and the ODbL

The library contains no map data except `fixture.js`. Data derived from OpenStreetMap — the fixture, an embedded city
map or a gazetteer built with `overpassToShapes` — is © OpenStreetMap contributors and available under the Open
Database Licence 1.0. An application that shows such data must display the attribution ("© OpenStreetMap
contributors", linking to https://www.openstreetmap.org/copyright; `renderMapSvg` draws `OSM_ATTRIBUTION` unless
`attribution: false`), and an application that distributes a derived database (an embedded dataset is one) must offer
that database under the ODbL. The map style (colours, widths) is our own and not covered by the ODbL.
