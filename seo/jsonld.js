// seo/jsonld.js - schema.org JSON-LD builders: Organization / LocalBusiness, Person and ProfilePage, WebSite with
// a SearchAction, BreadcrumbList, Event, Product with Offers (price ranges, availability, sale / rent), ItemList,
// ApartmentComplex and Accommodation, Recipe, Article, FAQPage, Order; a @graph wrapper, the <script> embedding
// that cannot break out of the element, and a reader of the JSON-LD nodes of a page. Empty fields are never
// printed (a description of '' reads as a careless page), URLs are expected absolute (the canonical address of a
// page is the @id of its entity).

export const SCHEMA = 'https://schema.org';
const S = (t) => SCHEMA + '/' + t;

const empty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'number' && !Number.isFinite(v));
// Drops empty fields (recursively in plain objects and arrays); an object left with only '@type' disappears too.
// Applied to every node: builders can pass optional fields straight through (undefined, '', []) without an if per
// field, and the output never contains the empty values validators warn about. Dates become ISO strings here.
export function compact(v) {
  if (Array.isArray(v)) { const a = v.map(compact).filter((x) => !empty(x)); return a.length ? a : undefined; }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = {};
    for (const [k, x] of Object.entries(v)) { const c = compact(x); if (!empty(c)) o[k] = c; }
    const keys = Object.keys(o);
    return !keys.length || (keys.length === 1 && keys[0] === '@type') ? undefined : o;
  }
  return v instanceof Date ? v.toISOString() : v;
}
const node = (type, fields) => compact({ '@type': type, ...fields }) || { '@type': type };
const withContext = (n) => ({ '@context': SCHEMA, ...n });
const httpOnly = (list) => (list || []).filter((u) => /^https?:\/\//i.test(String(u)));
const ref = (id) => (id ? { '@id': id } : undefined);

// JSON for a <script type="application/ld+json">: '<' and the JS line separators escaped, so '</script>' or
// '<!--' inside a value cannot end the element.
// '>' and '&' are escaped too: harmless in JSON (\u003E parses back to '>'), and it keeps the text inert even if
// a consumer embeds it in an HTML attribute or an XHTML document. U+2028 / U+2029 are escaped for old JS parsers.
export const ldJson = (x) => JSON.stringify(x).replace(/</g, '\\u003C').replace(/>/g, '\\u003E').replace(/&/g, '\\u0026')
  .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
export const ldScript = (x) => `<script type="application/ld+json">${ldJson(x)}</script>`;
// Several nodes as one document with @graph (nodes keep their own @id references).
export const graph = (...nodes) => ({ '@context': SCHEMA, '@graph': nodes.flat().filter(Boolean).map((n) => { const { '@context': _, ...rest } = n; return rest; }) });

// --- building blocks ---------------------------------------------------------------------------------------------

export const postalAddress = (a) => (!a || (!a.street && !a.locality && !a.postalCode) ? undefined
  : node('PostalAddress', { streetAddress: a.street, addressLocality: a.locality, addressRegion: a.region, postalCode: a.postalCode, addressCountry: a.country }));
export const geoCoordinates = (g) => (g && Number.isFinite(+g.lat) && Number.isFinite(+g.lon) && g.lat !== '' ? node('GeoCoordinates', { latitude: +g.lat, longitude: +g.lon }) : undefined);
export const imageObject = (u) => (u ? (typeof u === 'string' ? node('ImageObject', { url: u }) : node('ImageObject', { url: u.url, width: u.width, height: u.height, caption: u.caption })) : undefined);
const party = (p, type = 'Organization') => (!p ? undefined : typeof p === 'string' ? node(type, { name: p }) : node(p.type || type, { '@id': p.id, name: p.name, url: p.url }));

// --- site --------------------------------------------------------------------------------------------------------

// { url, name, logo, sameAs, phone, email, address, geo, type ('Organization' | 'LocalBusiness' | 'RealEstateAgent' | …),
//   id (default url + '#org'), description, openingHours }
export function organizationLd(o) {
  return withContext(node(o.type || 'Organization', {
    '@id': o.id || (o.url ? o.url.replace(/\/?$/, '/') + '#org' : undefined), name: o.name, url: o.url, description: o.description,
    logo: imageObject(o.logo), image: o.image, telephone: o.phone, email: o.email, address: postalAddress(o.address), geo: geoCoordinates(o.geo),
    openingHours: o.openingHours, sameAs: httpOnly(o.sameAs), priceRange: o.priceRange,
  }));
}

// { url, name, languages, publisher (an @id), searchUrl ('https://x/search?q={q}') }
export function websiteLd(o) {
  const site = node('WebSite', {
    '@id': o.id || (o.url ? o.url.replace(/\/?$/, '/') + '#website' : undefined), url: o.url, name: o.name, description: o.description,
    inLanguage: o.languages && o.languages.length === 1 ? o.languages[0] : o.languages, publisher: ref(o.publisher),
  });
  if (o.searchUrl) {
    site.potentialAction = { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: o.searchUrl.replace('{q}', '{search_term_string}') }, 'query-input': 'required name=search_term_string' };
  }
  return withContext(site);
}

// [{ name, url }] -> BreadcrumbList (the last item may omit its url: it is the page itself).
export const breadcrumbLd = (items) => withContext({
  '@type': 'BreadcrumbList',
  itemListElement: (items || []).filter((c) => c && c.name).map((c, i) => compact({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
});

// { url, name, alternateName, description, image, jobTitle, sameAs, worksFor } -> Person
export const personLd = (o) => withContext(node('Person', {
  '@id': o.id || (o.url ? o.url + '#person' : undefined), name: o.name, alternateName: o.alternateName, url: o.url, description: o.description,
  image: o.image, jobTitle: o.jobTitle, sameAs: httpOnly(o.sameAs), worksFor: party(o.worksFor),
}));
// A profile page about a person: only what the page shows (no private contacts).
export function profilePageLd(o) {
  const { '@context': _, ...person } = personLd(o);
  return withContext(node('ProfilePage', { '@id': o.url, url: o.url, inLanguage: o.lang, dateCreated: o.created, dateModified: o.modified, mainEntity: person }));
}

// --- content -----------------------------------------------------------------------------------------------------

// Event: { url, name, description, image(s), lang, start, end (ISO), status ('scheduled' | 'cancelled' | 'postponed' |
// 'rescheduled' | 'moved-online'), online (true | 'mixed'), place, address, geo, onlineUrl, organizer, performer,
// offers: [{ price, currency, url, availability, validFrom }] }
const EVENT_STATUS = { scheduled: 'EventScheduled', cancelled: 'EventCancelled', postponed: 'EventPostponed', rescheduled: 'EventRescheduled', 'moved-online': 'EventMovedOnline' };
export function eventLd(o) {
  const mode = o.online === 'mixed' ? 'MixedEventAttendanceMode' : o.online ? 'OnlineEventAttendanceMode' : 'OfflineEventAttendanceMode';
  const locations = [];
  if (o.place || o.address) locations.push(node('Place', { name: o.place || (o.address && o.address.locality), address: postalAddress(o.address) || o.place, geo: geoCoordinates(o.geo) }));
  if (o.online && o.onlineUrl) locations.push(node('VirtualLocation', { url: o.onlineUrl }));
  return withContext(node('Event', {
    '@id': o.url, url: o.url, name: o.name, description: o.description, inLanguage: o.lang, image: [].concat(o.image || []),
    startDate: o.start, endDate: o.end, eventStatus: S(EVENT_STATUS[o.status] || 'EventScheduled'), eventAttendanceMode: S(mode),
    location: locations.length > 1 ? locations : locations[0], organizer: party(o.organizer), performer: party(o.performer, 'Person'),
    offers: (o.offers || []).map((x) => offerLd(x, o.url)),
  }));
}

// Offer { price | min / max, currency, url, availability ('in-stock' | 'out-of-stock' | 'sold-out' | 'limited' |
// 'preorder' | 'discontinued' | a schema URL), kind ('sale' | 'rent'), per ('day' | 'month' | 'night'), condition
// ('new' | 'used' | 'refurbished'), validFrom, validUntil, seller }
const AVAIL = { 'in-stock': 'InStock', 'out-of-stock': 'OutOfStock', 'sold-out': 'SoldOut', limited: 'LimitedAvailability', preorder: 'PreOrder', discontinued: 'Discontinued', online: 'OnlineOnly' };
const UNIT = { day: ['DAY', 'day'], night: ['DAY', 'night'], month: ['MON', 'month'], hour: ['HUR', 'hour'], year: ['ANN', 'year'] };
// Short tokens ('in-stock', 'rent', 'month') map to schema.org enumeration URLs / UN/CEFACT unit codes (DAY, MON,
// ANN ...) so forms never ask users for vocabulary terms.
export function offerLd(o, url) {
  const min = o.min ?? o.price, max = o.max;
  const price = min ?? max;
  const out = node('Offer', {
    url: o.url || url, price, priceCurrency: o.currency, validFrom: o.validFrom, priceValidUntil: o.validUntil,
    availability: o.availability ? (/^https?:/.test(o.availability) ? o.availability : S(AVAIL[o.availability] || 'InStock')) : undefined,
    itemCondition: o.condition ? S({ new: 'NewCondition', used: 'UsedCondition', refurbished: 'RefurbishedCondition', damaged: 'DamagedCondition' }[o.condition] || 'NewCondition') : undefined,
    businessFunction: o.kind === 'rent' ? 'http://purl.org/goodrelations/v1#LeaseOut' : o.kind === 'sale' ? 'http://purl.org/goodrelations/v1#Sell' : undefined,
    seller: party(o.seller), sku: o.sku, inventoryLevel: o.qty != null ? node('QuantitativeValue', { value: o.qty }) : undefined,
  });
  if ((min != null && max != null && max !== min) || (o.per && UNIT[o.per])) {
    out.priceSpecification = node('UnitPriceSpecification', {
      price, priceCurrency: o.currency, minPrice: max != null && max !== min ? min : undefined, maxPrice: max !== min ? max : undefined,
      unitCode: o.per && UNIT[o.per] ? UNIT[o.per][0] : undefined, unitText: o.per && UNIT[o.per] ? UNIT[o.per][1] : undefined,
    });
  }
  return out;
}
// Several offers of one product collapse into an AggregateOffer (lowPrice / highPrice / offerCount).
export function aggregateOfferLd(offers, currency) {
  const prices = offers.map((x) => x.min ?? x.price).filter((p) => Number.isFinite(+p)).map(Number);
  return node('AggregateOffer', { priceCurrency: currency || (offers[0] && offers[0].currency), lowPrice: prices.length ? Math.min(...prices) : undefined, highPrice: prices.length ? Math.max(...prices) : undefined, offerCount: offers.length });
}

// Product: { url, name, description, image(s), sku, gtin, mpn, brand, category, color, offers: [offer], rating:
// { value, count, best }, reviews: [{ author, rating, body, date }], type (second type, e.g. 'Apartment') }
export function productLd(o) {
  const offers = (o.offers || []).map((x) => offerLd(x, o.url));
  const gtin = o.gtin ? String(o.gtin).replace(/\D/g, '') : '';
  return withContext(node(o.type ? ['Product', o.type] : 'Product', {
    '@id': o.url, url: o.url, name: o.name, description: o.description, image: [].concat(o.image || []), sku: o.sku, mpn: o.mpn, productID: o.id,
    ...(gtin ? { ['gtin' + (gtin.length === 8 || gtin.length === 12 || gtin.length === 13 || gtin.length === 14 ? gtin.length : '')]: gtin } : {}),
    brand: o.brand ? party(typeof o.brand === 'string' ? { name: o.brand, type: 'Brand' } : { type: 'Brand', ...o.brand }) : undefined,
    category: o.category, color: o.color,
    offers: offers.length > 1 && o.aggregate ? aggregateOfferLd(o.offers) : offers.length === 1 ? offers[0] : offers,
    aggregateRating: o.rating && o.rating.count ? node('AggregateRating', { ratingValue: o.rating.value, reviewCount: o.rating.count, bestRating: o.rating.best }) : undefined,
    review: (o.reviews || []).map((r) => node('Review', { author: party(r.author, 'Person'), datePublished: r.date, reviewBody: r.body, reviewRating: r.rating != null ? node('Rating', { ratingValue: r.rating }) : undefined })),
  }));
}

// ItemList of entities or links: items [{ url, name?, item? (a full node) }]; `refs` keeps only @id references (the
// full entities live elsewhere on the page). numberOfItems is `total` when the list is one page of many.
export function itemListLd(items, { name, url, total, refs = false, id } = {}) {
  return withContext(node('ItemList', {
    '@id': id, name, url, numberOfItems: Math.max(total || 0, (items || []).length),
    itemListElement: (items || []).map((it, i) => {
      const { '@context': _, ...full } = it.item || {};
      return compact({ '@type': 'ListItem', position: i + 1, url: it.url, name: refs ? undefined : it.name, item: refs ? ref(it.url) : it.item ? full : undefined });
    }),
  }));
}

// Residential complex: { url, name, description, image, address, geo, developer, units (available), ready (date) }
export const apartmentComplexLd = (o) => withContext(node('ApartmentComplex', {
  '@id': o.url, url: o.url, name: o.name, description: o.description, image: [].concat(o.image || []), address: postalAddress(o.address), geo: geoCoordinates(o.geo),
  numberOfAvailableAccommodationUnits: o.units > 0 ? node('QuantitativeValue', { value: o.units }) : undefined, brand: party(o.developer),
  ...(o.ready ? { additionalProperty: node('PropertyValue', { name: 'completion', value: o.ready }) } : {}),
}));
// Accommodation (Apartment, House, Room, Suite…): { type, url, name, rooms, bedrooms, bathrooms, floorSize (m²),
// floor, address, geo, amenities: [], pets, offers }
export function accommodationLd(o) {
  const offers = (o.offers || []).map((x) => offerLd(x, o.url));
  return withContext(node(o.offers && o.offers.length ? [o.type || 'Apartment', 'Product'] : o.type || 'Apartment', {
    '@id': o.url, url: o.url, name: o.name, description: o.description, image: [].concat(o.image || []), numberOfRooms: o.rooms,
    numberOfBedrooms: o.bedrooms, numberOfBathroomsTotal: o.bathrooms, floorLevel: o.floor != null ? String(o.floor) : undefined,
    floorSize: o.floorSize ? node('QuantitativeValue', { value: o.floorSize, unitCode: 'MTK' }) : undefined,
    address: postalAddress(o.address), geo: geoCoordinates(o.geo), petsAllowed: o.pets,
    amenityFeature: (o.amenities || []).map((a) => node('LocationFeatureSpecification', { name: a, value: true })),
    offers: offers.length === 1 ? offers[0] : offers,
  }));
}

// Recipe: { url, name, description, image, author, prepMinutes, cookMinutes, servings, ingredients: [], steps: [],
// category, cuisine, calories, keywords }
const isoMinutes = (m) => (m > 0 ? `PT${Math.floor(m / 60) ? Math.floor(m / 60) + 'H' : ''}${m % 60 ? (m % 60) + 'M' : ''}` : undefined);
export const recipeLd = (o) => withContext(node('Recipe', {
  '@id': o.url, url: o.url, name: o.name, description: o.description, image: [].concat(o.image || []), author: party(o.author, 'Person'), datePublished: o.date,
  prepTime: isoMinutes(o.prepMinutes), cookTime: isoMinutes(o.cookMinutes), totalTime: isoMinutes((o.prepMinutes || 0) + (o.cookMinutes || 0)),
  recipeYield: o.servings ? String(o.servings) : undefined, recipeCategory: o.category, recipeCuisine: o.cuisine, keywords: Array.isArray(o.keywords) ? o.keywords.join(', ') : o.keywords,
  recipeIngredient: o.ingredients, recipeInstructions: (o.steps || []).map((s, i) => node('HowToStep', { position: i + 1, text: s })),
  nutrition: o.calories ? node('NutritionInformation', { calories: `${o.calories} calories` }) : undefined,
}));

// Article / BlogPosting / NewsArticle: { type, url, title, description, image, author, publisher (an @id or party),
// published, modified, lang, section, words }
export const articleLd = (o) => withContext(node(o.type || 'Article', {
  '@id': o.url, url: o.url, mainEntityOfPage: o.url, headline: String(o.title || '').slice(0, 110), description: o.description, image: [].concat(o.image || []),
  author: party(o.author, 'Person'), publisher: typeof o.publisher === 'string' ? ref(o.publisher) : party(o.publisher), datePublished: o.published,
  dateModified: o.modified || o.published, inLanguage: o.lang, articleSection: o.section, wordCount: o.words,
}));

// [{ q, a }] -> FAQPage
export const faqLd = (items) => withContext({ '@type': 'FAQPage', mainEntity: (items || []).filter((x) => x && x.q && x.a).map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: x.a } })) });

// Order: { number, date, seller, customer, status, items: [{ name, sku, qty, price }], currency, total }
export const orderLd = (o) => withContext(node('Order', {
  orderNumber: o.number, orderDate: o.date, seller: party(o.seller), customer: party(o.customer, 'Person'),
  orderStatus: o.status ? S('Order' + String(o.status).replace(/(^|[-_ ])(\w)/g, (_, __, c) => c.toUpperCase())) : undefined,
  orderedItem: (o.items || []).map((it) => node('OrderItem', { orderQuantity: it.qty, orderedItem: node('Product', { name: it.name, sku: it.sku }), ...(it.price != null ? { acceptedOffer: node('Offer', { price: it.price, priceCurrency: o.currency }) } : {}) })),
  ...(o.total != null ? { totalPaymentDue: node('PriceSpecification', { price: o.total, priceCurrency: o.currency }) } : {}),
}));

// --- reading -----------------------------------------------------------------------------------------------------

// Every JSON-LD node of an HTML page (each <script type="application/ld+json">, @graph expanded, @context carried).
// Broken JSON throws: markup a search engine cannot read is a defect, not "nothing".
export function ldNodes(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<script\b[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const x = JSON.parse(m[1]);
    for (const doc of Array.isArray(x) ? x : [x]) {
      const ctx = doc['@context'];
      for (const n of Array.isArray(doc['@graph']) ? doc['@graph'] : [doc]) out.push(ctx && !n['@context'] ? { '@context': ctx, ...n } : n);
    }
  }
  return out;
}
// Nodes of a type (also matching multi-typed nodes).
export const ldOfType = (nodes, type) => nodes.filter((n) => [].concat(n['@type'] || []).includes(type));
