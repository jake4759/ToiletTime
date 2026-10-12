const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (!process.env.DATABASE_URL) process.env.DB_FILE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-')), 'db.json');
const { server, storeReady } = require('../server');

let base;
before(() => new Promise((r) => server.listen(0, () => { base = `http://localhost:${server.address().port}`; r(); })));
after(async () => {
  await new Promise((r) => server.close(r));
  await (await storeReady).close();
});

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const stars = { overall: 4, cleanliness: 5, supplies: 3, privacy: 4 };

test('lists seeded bathrooms', async () => {
  const data = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.ok(data.bathrooms.length > 0);
  assert.ok(data.types.includes('restaurant'));
});

test('adds a bathroom with a first review, then another review', async () => {
  const city = `Testville ${Date.now()}`;
  const res = await post('/api/bathrooms', { name: 'Test Diner', type: 'restaurant', city, country: 'Norway', lat: 59.91, lng: 10.75, review: { ...stars, comment: 'nice' } });
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.rating, 4);

  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 2 })).status, 201);
  const detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 2);
  assert.strictEqual(detail.rating, 3);
  assert.strictEqual(detail.reviews[1].author, 'Anonymous');

  const search = await (await fetch(`${base}/api/bathrooms?q=${encodeURIComponent(city.toLowerCase())}`)).json();
  assert.deepStrictEqual(search.bathrooms.map((x) => x.id), [b.id]);
  if (!process.env.DATABASE_URL) assert.ok(fs.existsSync(process.env.DB_FILE));
});

test('rejects invalid input', async () => {
  assert.strictEqual((await post('/api/bathrooms', { name: '', lat: 0, lng: 0 })).status, 400);
  assert.strictEqual((await post('/api/bathrooms', { name: 'X', lat: 200, lng: 0 })).status, 400);
  const { bathrooms } = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.strictEqual((await post(`/api/bathrooms/${bathrooms[0].id}/reviews`, { ...stars, overall: 9 })).status, 400);
  assert.strictEqual((await fetch(`${base}/api/bathrooms/nope`)).status, 404);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.strictEqual((await fetch(`${base}/api/bathrooms/${missing}`)).status, 404);
  assert.strictEqual((await post(`/api/bathrooms/${missing}/reviews`, stars)).status, 404);
});

test('serves the app and blocks path traversal', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /ToiletTime/);
  assert.notStrictEqual((await fetch(`${base}/..%2fserver.js`)).status, 200);
});

test('health check responds', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
});
