const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { parsePlaces, buildQuery } = require('../places');
const { startFakeSupabase } = require('./fake-supabase');

const supabase = startFakeSupabase();

// A fake Overpass server standing in for OpenStreetMap.
const elements = [
  { type: 'node', id: 1, lat: 28.4177, lon: -81.5812, tags: { amenity: 'toilets', wheelchair: 'yes', changing_table: 'yes' } },
  { type: 'node', id: 2, lat: 28.418, lon: -81.581, tags: { amenity: 'toilets', access: 'private' } },
  { type: 'way', id: 3, center: { lat: 28.4185, lon: -81.5815 }, tags: { amenity: 'fast_food', name: 'Burger Spot', 'toilets:access': 'customers', 'addr:housenumber': '12', 'addr:street': 'Main St', 'addr:city': 'Orlando' } },
  { type: 'node', id: 4, lat: 28.419, lon: -81.582, tags: { shop: 'supermarket', brand: 'FreshMart' } },
  { type: 'node', id: 5, lat: 28.42, lon: -81.583, tags: { amenity: 'restaurant' } },
  { type: 'node', id: 6, lat: 28.421, lon: -81.584, tags: { amenity: 'bench', name: 'Not a place' } },
];
let overpassHits = 0;
let busyHits = 0;
let active = 0;
let maxActive = 0;
// A server that is always busy, to check that lookups fall back to the next one.
const busy = http.createServer((req, res) => {
  busyHits++;
  req.resume();
  res.writeHead(429).end('rate limited');
});
const overpass = http.createServer((req, res) => {
  overpassHits++;
  active++;
  maxActive = Math.max(maxActive, active);
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    assert.match(decodeURIComponent(body), /amenity/);
    setTimeout(() => {
      active--;
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ elements }));
    }, 30);
  });
});

if (!process.env.DATABASE_URL) process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-')), 'db.json');
const { server, storeReady } = require('../server');

let base;
before(async () => {
  await supabase.listen();
  await new Promise((r) => overpass.listen(0, r));
  await new Promise((r) => busy.listen(0, r));
  process.env.OVERPASS_URL = [busy, overpass].map((s) => `http://127.0.0.1:${s.address().port}/api/interpreter`).join(',');
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => overpass.close(r));
  await new Promise((r) => busy.close(r));
  await supabase.close();
  await (await storeReady).close();
});

test('parses OpenStreetMap places, including unnamed restrooms', () => {
  const places = parsePlaces(elements);
  assert.deepStrictEqual(places.map((p) => p.osmId), ['node/1', 'way/3', 'node/4']);
  const [toilet, burger, market] = places;
  assert.strictEqual(toilet.name, 'Restroom near Burger Spot');
  assert.strictEqual(toilet.isRestroom, true);
  assert.strictEqual(toilet.type, 'public');
  assert.strictEqual(toilet.accessible, true);
  assert.strictEqual(toilet.babyChanging, true);
  assert.strictEqual(burger.lat, 28.4185);
  assert.strictEqual(burger.type, 'restaurant');
  assert.strictEqual(burger.free, false);
  assert.strictEqual(burger.address, '12 Main St');
  assert.strictEqual(market.name, 'FreshMart');
  assert.strictEqual(market.type, 'store');
});

test('query covers restrooms, food, stores and hotels', () => {
  const q = buildQuery({ south: 1, west: 2, north: 3, east: 4 });
  for (const word of ['toilets', 'fast_food', 'supermarket', 'hotel', '(1,2,3,4)']) assert.ok(q.includes(word), word);
});

test('places endpoint: validates the area, asks to zoom in, and caches lookups', async () => {
  assert.strictEqual((await fetch(`${base}/api/places?south=a&west=0&north=1&east=1`)).status, 400);
  const wide = await (await fetch(`${base}/api/places?south=0&west=0&north=5&east=5`)).json();
  assert.deepStrictEqual(wide, { places: [], zoomIn: true });

  const area = 'south=28.41&west=-81.59&north=28.43&east=-81.57';
  const first = await (await fetch(`${base}/api/places?${area}`)).json();
  assert.strictEqual(first.places.length, 3);
  await fetch(`${base}/api/places?${area}`);
  assert.strictEqual(overpassHits, 1);
  assert.strictEqual(busyHits, 1, 'tried the busy server first, then fell back');
});

test('lookups for different areas go to Overpass one at a time', async () => {
  const areas = [0, 1, 2, 3].map((i) => `south=${40 + i * 0.1}&west=-97.8&north=${40.05 + i * 0.1}&east=-97.75`);
  const results = await Promise.all(areas.map((a) => fetch(`${base}/api/places?${a}`).then((r) => r.json())));
  assert.ok(results.every((r) => r.places.length === 3));
  assert.strictEqual(maxActive, 1);
});

test('rating a map place twice keeps a single restroom', async () => {
  const signUp = async (name) => {
    const { token } = supabase.addUser();
    await fetch(`${base}/api/me`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ username: `${name}_${Date.now() % 100000}` }),
    });
    return token;
  };
  const placeId = `way/${Date.now()}`;
  const rate = (token, overall) =>
    fetch(`${base}/api/bathrooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        osmId: placeId, name: 'Burger Spot', type: 'restaurant', lat: 28.4185, lng: -81.5815,
        review: { overall, cleanliness: 3, supplies: 3, privacy: 3 },
        here: { lat: 28.4185, lng: -81.5815 },
      }),
    });

  const a = await rate(await signUp('ana'), 4);
  assert.strictEqual(a.status, 201);
  const b = await rate(await signUp('ben'), 2);
  assert.strictEqual(b.status, 200);
  const [first, second] = [await a.json(), await b.json()];
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(second.reviewCount, 2);
  assert.strictEqual(second.osmId, placeId);

  const bad = await fetch(`${base}/api/bathrooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await signUp('cy')}` },
    body: JSON.stringify({ osmId: 'node/1; drop', name: 'X', lat: 1, lng: 1 }),
  });
  assert.strictEqual(bad.status, 400);
});

test('responses carry security headers', async () => {
  for (const p of ['/', '/api/health']) {
    const res = await fetch(base + p);
    assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
    assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.strictEqual((await fetch(`${base}/api/health`)).headers.get('cache-control'), 'no-store');
});
