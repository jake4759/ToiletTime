const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { startFakeSupabase } = require('./fake-supabase');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-'));
if (!process.env.DATABASE_URL) process.env.DB_FILE = path.join(tmp, 'db.json');
const supabase = startFakeSupabase();
const { server, storeReady } = require('../server');

let base;
before(async () => {
  await supabase.listen();
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});
after(async () => {
  await new Promise((r) => server.close(r));
  await supabase.close();
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
let usernames = 0;

/** A verified user with a username, ready to post. */
async function poster(name) {
  const u = supabase.addUser();
  const username = `${name}${++usernames}_${Date.now() % 1e6}`;
  const res = await request('PATCH', '/api/me', { username }, u.token);
  assert.strictEqual(res.status, 200);
  return { ...u, username };
}

async function addRestroom(token, extra = {}) {
  const res = await post(
    '/api/bathrooms',
    { name: 'Test Diner', type: 'restaurant', city: `Testville ${Date.now()}`, lat: 59.91, lng: 10.75, review: stars, ...extra },
    token,
  );
  assert.strictEqual(res.status, 201);
  return res.json();
}

test('starts without the old made-up sample restrooms', { skip: !!process.env.DATABASE_URL }, async () => {
  const data = await (await fetch(`${base}/api/bathrooms`)).json();
  assert.ok(!data.bathrooms.some((b) => /Buc-ee|IKEA|Harrods/.test(b.name)));
  assert.ok(data.types.includes('restaurant'));
});

test('config tells apps how to reach Supabase', async () => {
  const { auth } = await (await fetch(`${base}/api/config`)).json();
  assert.strictEqual(auth.supabaseUrl, process.env.SUPABASE_URL);
  assert.strictEqual(auth.supabaseKey, 'test-public-key');
  assert.strictEqual(JSON.stringify(auth).includes('secret'), false);
});

test('profile: requires sign-in, then sets a valid, unique username', async () => {
  assert.strictEqual((await fetch(`${base}/api/me`)).status, 401);
  assert.strictEqual((await request('GET', '/api/me', undefined, 'bogus')).status, 401);

  const u = supabase.addUser({ email: 'jake@example.com' });
  const me = (await (await request('GET', '/api/me', undefined, u.token)).json()).user;
  assert.deepStrictEqual([me.id, me.username, me.email, me.emailVerified], [u.id, null, 'jake@example.com', true]);

  for (const bad of ['ab', 'has space', 'bad!chars', '.dot', 'a..b', 'admin', 'x'.repeat(21)]) {
    assert.strictEqual((await request('PATCH', '/api/me', { username: bad }, u.token)).status, 400, bad);
  }
  const name = `Jake_${Date.now() % 1e6}`;
  const ok = await request('PATCH', '/api/me', { username: name, markerColor: '#FF6B35' }, u.token);
  const updated = (await ok.json()).user;
  assert.strictEqual(updated.username, name);
  assert.strictEqual(updated.markerColor, '#ff6b35');

  const other = supabase.addUser();
  assert.strictEqual((await request('PATCH', '/api/me', { username: name.toLowerCase() }, other.token)).status, 409);
});

test('posting needs a verified email and a username', async () => {
  const u = supabase.addUser({ verified: false });
  let res = await post('/api/bathrooms', { name: 'X', lat: 1, lng: 1 }, u.token);
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await res.json()).code, 'unverified');

  supabase.verify(u.token);
  res = await post('/api/bathrooms', { name: 'X', lat: 1, lng: 1 }, u.token);
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await res.json()).code, 'username');

  assert.strictEqual((await post('/api/bathrooms', { name: 'X', lat: 1, lng: 1 })).status, 401);
});

test('reviews: one per person, listed under My Reviews, and deletable by their author only', async () => {
  const riley = await poster('riley');
  const b = await addRestroom(riley.token);
  assert.strictEqual(b.reviews[0].author, riley.username);
  assert.strictEqual(b.reviews[0].userId, riley.id);

  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 2 }, riley.token)).status, 201);
  const sam = await poster('sam');
  await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 5 }, sam.token);
  let detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 2);
  assert.strictEqual(detail.rating, 3.5);

  const mine = (await (await request('GET', '/api/me/reviews', undefined, riley.token)).json()).reviews;
  assert.strictEqual(mine.length, 1);
  assert.strictEqual(mine[0].restroomName, 'Test Diner');
  assert.strictEqual(mine[0].restroomId, b.id);

  assert.strictEqual((await request('DELETE', `/api/reviews/${mine[0].id}`, undefined, sam.token)).status, 404);
  assert.strictEqual((await request('DELETE', `/api/reviews/${mine[0].id}`)).status, 401);
  assert.strictEqual((await request('DELETE', `/api/reviews/${mine[0].id}`, undefined, riley.token)).status, 200);
  detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 1);
  assert.strictEqual(detail.reviews[0].author, sam.username);
});

// 1×1 PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('profile pictures: only real images, shown on reviews, removable', async () => {
  const pat = await poster('pat');
  assert.strictEqual((await request('PUT', '/api/me/avatar', { image: Buffer.from('<svg>').toString('base64') }, pat.token)).status, 400);
  assert.strictEqual((await request('PUT', '/api/me/avatar', { image: 'not base64!' }, pat.token)).status, 400);

  const res = await request('PUT', '/api/me/avatar', { image: `data:image/png;base64,${PNG}` }, pat.token);
  const { user } = await res.json();
  assert.match(user.avatarUrl, new RegExp(`^/api/avatars/${pat.id}\\?v=\\d+$`));

  const img = await fetch(base + user.avatarUrl);
  assert.strictEqual(img.headers.get('content-type'), 'image/png');
  assert.deepStrictEqual(Buffer.from(await img.arrayBuffer()), Buffer.from(PNG, 'base64'));

  const b = await addRestroom(pat.token);
  assert.strictEqual(b.reviews[0].authorAvatarUrl, user.avatarUrl);

  const cleared = (await (await request('DELETE', '/api/me/avatar', undefined, pat.token)).json()).user;
  assert.strictEqual(cleared.avatarUrl, null);
  assert.strictEqual((await fetch(base + user.avatarUrl)).status, 404);
});

test('deleting an account removes it from Supabase and keeps its reviews anonymously', async () => {
  const lee = await poster('lee');
  const b = await addRestroom(lee.token, { review: { ...stars, comment: 'bye' } });

  assert.strictEqual((await request('DELETE', '/api/me', undefined, lee.token)).status, 200);
  assert.ok(supabase.deleted.includes(lee.id));
  assert.strictEqual((await request('GET', '/api/me', undefined, lee.token)).status, 401);

  const kept = (await (await fetch(`${base}/api/bathrooms/${b.id}`)).json()).reviews.find((r) => r.comment === 'bye');
  assert.strictEqual(kept.author, 'Former member');
  assert.strictEqual(kept.userId, null);
});

test('rejects invalid input', async () => {
  const { token } = await poster('val');
  assert.strictEqual((await post('/api/bathrooms', { name: '', lat: 0, lng: 0 }, token)).status, 400);
  assert.strictEqual((await post('/api/bathrooms', { name: 'X', lat: 200, lng: 0 }, token)).status, 400);
  const b = await addRestroom(token);
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, overall: 9 }, token)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/bathrooms/nope`)).status, 404);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.strictEqual((await fetch(`${base}/api/bathrooms/${missing}`)).status, 404);
  assert.strictEqual((await post(`/api/bathrooms/${missing}/reviews`, stars, token)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/avatars/${missing}`)).status, 404);
});

test('serves the app and blocks path traversal', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /ToiletTime/);
  assert.notStrictEqual((await fetch(`${base}/..%2fserver.js`)).status, 200);
});

test('health check responds', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
});
