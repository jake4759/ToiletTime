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

const request = (method, p, body, token) =>
  fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const post = (p, body, token) => request('POST', p, body, token);
const stars = { overall: 4, cleanliness: 5, supplies: 3, privacy: 4 };
const uniqueEmail = () => `user${Date.now()}${Math.random().toString(36).slice(2, 7)}@example.com`;

async function signUp(name = 'Test User') {
  const email = uniqueEmail();
  const res = await post('/api/auth/signup', { email, name, password: 'correct horse' });
  assert.strictEqual(res.status, 201);
  return { email, ...(await res.json()) };
}

test('lists seeded bathrooms without signing in', async () => {
  const data = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.ok(data.bathrooms.length > 0);
  assert.ok(data.types.includes('restaurant'));
});

test('sign up, sign in, me, sign out', async () => {
  const { email, token, user } = await signUp('Dana');
  assert.strictEqual(user.name, 'Dana');
  assert.strictEqual(user.passwordHash, undefined);

  assert.strictEqual((await post('/api/auth/signup', { email, name: 'Again', password: 'whatever123' })).status, 409);
  assert.strictEqual((await post('/api/auth/login', { email, password: 'wrong password' })).status, 401);

  const login = await post('/api/auth/login', { email: email.toUpperCase(), password: 'correct horse' });
  assert.strictEqual(login.status, 200);
  const second = (await login.json()).token;

  const me = await (await request('GET', '/api/auth/me', undefined, second)).json();
  assert.strictEqual(me.user.email, email);

  assert.strictEqual((await post('/api/auth/logout', {}, second)).status, 200);
  assert.strictEqual((await request('GET', '/api/auth/me', undefined, second)).status, 401);
  assert.strictEqual((await request('GET', '/api/auth/me', undefined, token)).status, 200);
});

test('rejects weak sign-up input', async () => {
  assert.strictEqual((await post('/api/auth/signup', { email: 'nope', name: 'X', password: 'longenough' })).status, 400);
  assert.strictEqual((await post('/api/auth/signup', { email: uniqueEmail(), name: 'X', password: 'short' })).status, 400);
  assert.strictEqual((await post('/api/auth/signup', { email: uniqueEmail(), name: '', password: 'longenough' })).status, 400);
});

test('writing requires an account', async () => {
  assert.strictEqual((await post('/api/bathrooms', { name: 'X', lat: 1, lng: 1 })).status, 401);
  const { bathrooms } = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.strictEqual((await post(`/api/bathrooms/${bathrooms[0].id}/reviews`, stars, 'bogus-token')).status, 401);
});

test('adds a bathroom with a first review; one review per user per bathroom', async () => {
  const { token, user } = await signUp('Riley');
  const city = `Testville ${Date.now()}`;
  const res = await post(
    '/api/bathrooms',
    { name: 'Test Diner', type: 'restaurant', city, country: 'Norway', lat: 59.91, lng: 10.75, review: { ...stars, comment: 'nice' } },
    token,
  );
  assert.strictEqual(res.status, 201);
  const b = await res.json();
  assert.strictEqual(b.rating, 4);
  assert.strictEqual(b.reviews[0].author, 'Riley');
  assert.strictEqual(b.reviews[0].userId, user.id);

  // The same user rating again replaces their review instead of adding one.
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 2 }, token)).status, 201);
  let detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 1);
  assert.strictEqual(detail.rating, 2);

  // A different user adds a second review.
  const other = await signUp('Sam');
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 5 }, other.token)).status, 201);
  detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 2);
  assert.strictEqual(detail.rating, 3.5);

  const search = await (await fetch(`${base}/api/bathrooms?q=${encodeURIComponent(city.toLowerCase())}`)).json();
  assert.deepStrictEqual(search.bathrooms.map((x) => x.id), [b.id]);
  if (!process.env.DATABASE_URL) assert.ok(fs.existsSync(process.env.DB_FILE));
});

test('deleting an account signs it out and keeps its reviews anonymously', async () => {
  const { token, email } = await signUp('Leaving Soon');
  const { bathrooms } = await (await fetch(`${base}/api/bathrooms`)).json();
  const id = bathrooms[0].id;
  await post(`/api/bathrooms/${id}/reviews`, { ...stars, comment: 'bye' }, token);

  assert.strictEqual((await request('DELETE', '/api/auth/me', undefined, token)).status, 200);
  assert.strictEqual((await request('GET', '/api/auth/me', undefined, token)).status, 401);
  assert.strictEqual((await post('/api/auth/login', { email, password: 'correct horse' })).status, 401);

  const detail = await (await fetch(`${base}/api/bathrooms/${id}`)).json();
  const kept = detail.reviews.find((r) => r.comment === 'bye');
  assert.strictEqual(kept.author, 'Former member');
  assert.strictEqual(kept.userId, null);
});

test('rejects invalid input', async () => {
  const { token } = await signUp();
  assert.strictEqual((await post('/api/bathrooms', { name: '', lat: 0, lng: 0 }, token)).status, 400);
  assert.strictEqual((await post('/api/bathrooms', { name: 'X', lat: 200, lng: 0 }, token)).status, 400);
  const { bathrooms } = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.strictEqual((await post(`/api/bathrooms/${bathrooms[0].id}/reviews`, { ...stars, overall: 9 }, token)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/bathrooms/nope`)).status, 404);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.strictEqual((await fetch(`${base}/api/bathrooms/${missing}`)).status, 404);
  assert.strictEqual((await post(`/api/bathrooms/${missing}/reviews`, stars, token)).status, 404);
});

test('serves the app and blocks path traversal', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /ToiletTime/);
  assert.notStrictEqual((await fetch(`${base}/..%2fserver.js`)).status, 200);
});

test('health check responds', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
});
