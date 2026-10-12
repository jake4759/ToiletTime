// Businesses and mapped restrooms from OpenStreetMap (via the Overpass API), so places
// show up on the map before anyone has rated them.

const overpassUrl = () => process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter';
const USER_AGENT = 'ToiletTime/1.0 (+https://github.com/jake4759/ToiletTime)';

/** Largest area (in degrees of latitude/longitude) we ask Overpass about in one go. */
const MAX_SPAN = 0.12;
const MAX_RESULTS = 400;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 300;

const AMENITY_TYPES = {
  toilets: 'public',
  restaurant: 'restaurant',
  fast_food: 'restaurant',
  food_court: 'restaurant',
  ice_cream: 'cafe',
  cafe: 'cafe',
  bar: 'bar',
  pub: 'bar',
  fuel: 'gas_station',
};
const SHOP_TYPES = {
  mall: 'mall',
  department_store: 'store',
  supermarket: 'store',
  convenience: 'store',
  general: 'store',
  variety_store: 'store',
  wholesale: 'store',
  hardware: 'store',
  doityourself: 'store',
  furniture: 'store',
  electronics: 'store',
  clothes: 'store',
};
const TOURISM_TYPES = { hotel: 'hotel', motel: 'hotel' };

const alternation = (obj) => Object.keys(obj).join('|');

function buildQuery({ south, west, north, east }) {
  const bbox = `${south},${west},${north},${east}`;
  return `[out:json][timeout:20];
(
  nwr["amenity"~"^(${alternation(AMENITY_TYPES)})$"](${bbox});
  nwr["shop"~"^(${alternation(SHOP_TYPES)})$"](${bbox});
  nwr["tourism"~"^(${alternation(TOURISM_TYPES)})$"](${bbox});
);
out center tags ${MAX_RESULTS};`;
}

const yes = (v) => v === 'yes' || v === 'designated';

/** Turns raw Overpass elements into the places the apps show. */
function parsePlaces(elements) {
  const places = [];
  for (const el of elements || []) {
    const t = el.tags || {};
    const type = AMENITY_TYPES[t.amenity] || SHOP_TYPES[t.shop] || TOURISM_TYPES[t.tourism];
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (!type || typeof lat !== 'number' || typeof lng !== 'number') continue;

    const isToilet = t.amenity === 'toilets';
    if (isToilet && ['private', 'no', 'staff'].includes(t.access)) continue; // not open to visitors
    const name = (t.name || t['name:en'] || t.brand || t.operator || '').trim();
    if (!name && !isToilet) continue; // unnamed businesses aren't useful to rate

    const fee = isToilet ? t.fee : t['toilets:fee'];
    const access = isToilet ? t.access : t['toilets:access'];
    places.push({
      osmId: `${el.type}/${el.id}`,
      name: (name || (t.description ? `Restroom · ${t.description}` : '')).slice(0, 100),
      type,
      isRestroom: isToilet,
      address: [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ').slice(0, 200),
      city: (t['addr:city'] || '').slice(0, 80),
      country: (t['addr:country'] || '').slice(0, 80),
      lat,
      lng,
      free: !(yes(fee) || access === 'customers' || access === 'private'),
      accessible: yes(isToilet ? t.wheelchair : t['toilets:wheelchair']),
      babyChanging: yes(t.changing_table) || yes(t['toilets:changing_table']) || yes(t.diaper),
    });
  }
  nameUnnamedRestrooms(places);
  return places;
}

/** Distance in meters between two points (good enough at these short ranges). */
function metersBetween(a, b) {
  const x = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  const y = b.lat - a.lat;
  return Math.sqrt(x * x + y * y) * 111_320;
}

/** Restrooms often have no name (e.g. in theme parks); call them after the closest named place. */
function nameUnnamedRestrooms(places) {
  const landmarks = places.filter((p) => !p.isRestroom);
  for (const p of places) {
    if (p.name) continue;
    let best = null;
    let bestDistance = 250;
    for (const l of landmarks) {
      const d = metersBetween(p, l);
      if (d < bestDistance) [best, bestDistance] = [l, d];
    }
    p.name = best ? `Restroom near ${best.name}`.slice(0, 100) : 'Restroom';
  }
}

// ---------- cached fetching ----------

const cache = new Map(); // key -> { at, places }

/** Snap the area outward to a 0.01° grid so nearby map positions share cache entries. */
function snap(b) {
  const down = (x) => Math.floor(x * 100) / 100;
  const up = (x) => Math.ceil(x * 100) / 100;
  return { south: down(b.south), west: down(b.west), north: up(b.north), east: up(b.east) };
}

async function fetchPlaces(bbox) {
  const area = snap(bbox);
  const key = `${area.south},${area.west},${area.north},${area.east}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.places;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  let res;
  try {
    res = await fetch(overpassUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: new URLSearchParams({ data: buildQuery(area) }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Overpass responded ${res.status}`);
  const places = parsePlaces((await res.json()).elements);

  cache.set(key, { at: Date.now(), places });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return places;
}

/** Validates ?south=&west=&north=&east= and returns the bbox, or null if it's too large. */
function parseBbox(params) {
  const nums = ['south', 'west', 'north', 'east'].map((k) => Number(params.get(k)));
  const [south, west, north, east] = nums;
  const valid =
    nums.every(Number.isFinite) && south >= -90 && north <= 90 && south < north && west >= -180 && east <= 180 && west < east;
  if (!valid) return undefined;
  if (north - south > MAX_SPAN || east - west > MAX_SPAN) return null;
  return { south, west, north, east };
}

module.exports = { fetchPlaces, parsePlaces, parseBbox, buildQuery, MAX_SPAN };
