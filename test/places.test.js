const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const { parsePlaces, buildQuery } = require('../places');

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
const overpass = http.createServer((req, res) => {
  overpassHits++;
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    assert.match(decodeURIComponent(body), /amenity/);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ elements }));
  });
});

if (!process.env.DATABASE_URL) process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-')), 'db.json');
const { server, storeReady } = require('../server');

let base;
before(async () => {
  await new Promise((r) => overpass.listen(0, r));
  process.env.OVERPASS_URL = `http://127.0.0.1:${overpass.address().port}/api/interpreter`;
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await new Promise((r) => overpass.close(r));
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
});

test('rating a map place twice keeps a single restroom', async () => {
  const signUp = async (name) =>
    (await (await fetch(`${base}/api/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email: `${name}${Date.now()}@example.com`, password: 'longpassword1' }),
    })).json()).token;
  const rate = (token, overall) =>
    fetch(`${base}/api/bathrooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        osmId: 'way/3', name: 'Burger Spot', type: 'restaurant', lat: 28.4185, lng: -81.5815,
        review: { overall, cleanliness: 3, supplies: 3, privacy: 3 },
      }),
    });

  const a = await rate(await signUp('ana'), 4);
  assert.strictEqual(a.status, 201);
  const b = await rate(await signUp('ben'), 2);
  assert.strictEqual(b.status, 200);
  const [first, second] = [await a.json(), await b.json()];
  assert.strictEqual(second.id, first.id);
  assert.strictEqual(second.reviewCount, 2);
  assert.strictEqual(second.osmId, 'way/3');

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

test('expired sessions are rejected', { skip: !!process.env.DATABASE_URL }, async () => {
  const res = await fetch(`${base}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Old', email: `old${Date.now()}@example.com`, password: 'longpassword1' }),
  });
  const { token } = await res.json();
  const store = await storeReady;
  for (const s of store.sessions) s.createdAt = '2000-01-01T00:00:00.000Z';
  assert.strictEqual((await fetch(`${base}/api/auth/me`, { headers: { Authorization: `Bearer ${token}` } })).status, 401);
});
