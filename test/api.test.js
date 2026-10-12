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
const HERE = { lat: 59.91, lng: 10.75 }; // where the test restrooms are
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
    { name: 'Test Diner', type: 'restaurant', city: `Testville ${Date.now()}`, lat: 59.91, lng: 10.75, review: stars, here: HERE, ...extra },
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

  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { here: HERE, ...stars, overall: 2 }, riley.token)).status, 201);
  const sam = await poster('sam');
  await post(`/api/bathrooms/${b.id}/reviews`, { here: HERE, ...stars, overall: 5 }, sam.token);
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
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { here: HERE, ...stars, overall: 9 }, token)).status, 400);
  assert.strictEqual((await fetch(`${base}/api/bathrooms/nope`)).status, 404);
  const missing = '00000000-0000-4000-8000-000000000000';
  assert.strictEqual((await fetch(`${base}/api/bathrooms/${missing}`)).status, 404);
  assert.strictEqual((await post(`/api/bathrooms/${missing}/reviews`, { ...stars, here: HERE }, token)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/avatars/${missing}`)).status, 404);
});

test('serves the app and blocks path traversal', async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /ToiletTime/);
  assert.notStrictEqual((await fetch(`${base}/..%2fserver.js`)).status, 200);
});

test('health check responds', async () => {
  assert.deepStrictEqual(await (await fetch(`${base}/api/health`)).json(), { ok: true });
});

test('word filter: masks strong profanity in reviews and blocks offensive usernames', async () => {
  const u = supabase.addUser();
  assert.strictEqual((await request('PATCH', '/api/me', { username: 'big_fuck3r' }, u.token)).status, 400);
  assert.strictEqual((await request('PATCH', '/api/me', { username: `dickens_${Date.now() % 1e5}` }, u.token)).status, 200);

  const b = await addRestroom(u.token, { review: { ...stars, comment: 'Clean but the fucking dryer was broken. Total shit show.' } });
  assert.strictEqual(b.reviews[0].comment, 'Clean but the f****** dryer was broken. Total shit show.');
});

test('reports: own review refused, three reports hide a review, moderators can restore it', async () => {
  const author = await poster('author');
  const b = await addRestroom(author.token, { review: { ...stars, overall: 1, comment: 'meh' } });
  const reviewId = b.reviews[0].id;
  const report = (token, reason = 'spam') => post(`/api/reviews/${reviewId}/report`, { reason }, token);

  assert.strictEqual((await report(author.token)).status, 400);
  assert.strictEqual((await report(undefined)).status, 401);
  const first = supabase.addUser();
  assert.strictEqual((await report(first.token, 'nonsense')).status, 400);
  assert.deepStrictEqual(await (await report(first.token)).json(), { ok: true, hidden: false });
  assert.deepStrictEqual(await (await report(first.token, 'offensive')).json(), { ok: true, hidden: false }); // same person again
  await report(supabase.addUser().token);
  const third = await (await report(supabase.addUser().token, 'false')).json();
  assert.strictEqual(third.hidden, true);

  let detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviews.length, 0);
  assert.strictEqual(detail.reviewCount, 0);
  assert.strictEqual(detail.rating, null);
  const mine = (await (await request('GET', '/api/me/reviews', undefined, author.token)).json()).reviews;
  assert.strictEqual(mine[0].hidden, true, 'the author can see their review is hidden');

  const store = await storeReady;
  const reported = await store.listReported();
  const entry = reported.find((r) => r.id === reviewId);
  assert.strictEqual(entry.reports.length, 3);
  assert.strictEqual(await store.moderate(reviewId, 'restore'), true);
  detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 1);
  assert.ok(!(await store.listReported()).some((r) => r.id === reviewId));

  assert.strictEqual(await store.moderate(reviewId, 'delete'), true);
  detail = await (await fetch(`${base}/api/bathrooms/${b.id}`)).json();
  assert.strictEqual(detail.reviewCount, 0);
});

test('Terms and Privacy pages are served with the contact email', async () => {
  for (const page of ['/terms', '/privacy']) {
    const html = await (await fetch(base + page)).text();
    assert.match(html, /ToiletTime/);
    assert.ok(!html.includes('{{CONTACT_EMAIL}}'));
  }
});

test('you can only rate restrooms you are at, or were near in the last 24 hours', async () => {
  const ana = await poster('ana');
  const b = await addRestroom(ana.token); // at HERE
  const far = { lat: 59.95, lng: 10.75 }; // about 4.5 km away
  const near = { lat: 59.9105, lng: 10.7503 }; // about 60 m away

  const bo = await poster('bo');
  let res = await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, here: far }, bo.token);
  assert.strictEqual(res.status, 403);
  assert.strictEqual((await res.json()).code, 'not_visited');
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, stars, bo.token)).status, 403);

  // Adding a brand-new restroom somewhere you aren't is refused too.
  res = await post('/api/bathrooms', { name: 'Far Cafe', lat: 59.95, lng: 10.75, review: stars, here: HERE }, bo.token);
  assert.strictEqual(res.status, 403);

  // The app reports you walked past it...
  res = await post('/api/visits', { ...far, accuracy: 20, restroomIds: [b.id] }, bo.token);
  assert.deepStrictEqual(await res.json(), { recorded: 0 }, 'too far away to count');
  res = await post('/api/visits', { ...near, accuracy: 20, restroomIds: [b.id] }, bo.token);
  assert.deepStrictEqual(await res.json(), { recorded: 1 });
  // ...so later, from home, you can still rate it.
  assert.strictEqual((await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, here: far }, bo.token)).status, 201);

  // Places from the map count as visits too.
  const placeId = `node/${Date.now()}`;
  res = await post('/api/visits', { ...near, places: [{ osmId: placeId, lat: 59.9104, lng: 10.7501 }] }, bo.token);
  assert.deepStrictEqual(await res.json(), { recorded: 1 });
  res = await post('/api/bathrooms', { osmId: placeId, name: 'Kiosk', lat: 59.9104, lng: 10.7501, review: stars, here: far }, bo.token);
  assert.strictEqual(res.status, 201);

  assert.strictEqual((await post('/api/visits', { lat: 'x', lng: 1 }, bo.token)).status, 400);
  assert.strictEqual((await post('/api/visits', near)).status, 401);
});

test('visits older than the review window no longer count', { skip: !!process.env.DATABASE_URL }, async () => {
  const cy = await poster('cy');
  const b = await addRestroom(cy.token);
  const dee = await poster('dee');
  await post('/api/visits', { ...HERE, restroomIds: [b.id] }, dee.token);
  const store = await storeReady;
  for (const v of store.visits) if (v.userId === dee.id) v.at = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
  const res = await post(`/api/bathrooms/${b.id}/reviews`, { ...stars, here: { lat: 59.95, lng: 10.75 } }, dee.token);
  assert.strictEqual(res.status, 403);
});

test('character: starts with defaults, locked items refused, reviews unlock rewards', async () => {
  const catalog = await (await fetch(`${base}/api/character`)).json();
  assert.ok(catalog.slots.hat.items.some((i) => i.id === 'crown'));

  const eve = await poster('eve');
  let me = (await (await request('GET', '/api/me', undefined, eve.token)).json()).user;
  assert.strictEqual(me.reviewCount, 0);
  assert.strictEqual(me.level.name, 'Newbie');
  assert.strictEqual(me.character.hat, 'none');
  assert.deepStrictEqual(me.nextUnlock.at, 1);

  let res = await request('PATCH', '/api/me', { character: { hat: 'cap' } }, eve.token);
  assert.strictEqual(res.status, 400);
  assert.match((await res.json()).error, /Baseball Cap unlocks after reviewing 1 restroom/);
  assert.strictEqual((await request('PATCH', '/api/me', { character: { hat: 'sombrero' } }, eve.token)).status, 400);
  assert.strictEqual((await request('PATCH', '/api/me', { character: { topColor: '#123456' } }, eve.token)).status, 400);

  const b = await addRestroom(eve.token);
  assert.strictEqual(b.rewards.reviewCount, 1);
  assert.strictEqual(b.rewards.level.name, 'First Flush');
  assert.strictEqual(b.rewards.levelUp, true);
  assert.ok(b.rewards.newItems.some((i) => i.id === 'cap'));

  res = await request('PATCH', '/api/me', { character: { hat: 'cap', skin: 'skin4', topColor: '#dc2626' } }, eve.token);
  assert.strictEqual(res.status, 200);
  me = (await res.json()).user;
  assert.deepStrictEqual([me.character.hat, me.character.skin, me.character.topColor], ['cap', 'skin4', '#dc2626']);

  // Rating the same restroom again doesn't unlock more.
  const again = await (await post(`/api/bathrooms/${b.id}/reviews`, { here: HERE, ...stars }, eve.token)).json();
  assert.strictEqual(again.rewards.reviewCount, 1);
  assert.deepStrictEqual(again.rewards.newItems, []);
  assert.strictEqual(again.rewards.levelUp, false);

  // Deleting the review takes the cap back off.
  const mine = (await (await request('GET', '/api/me/reviews', undefined, eve.token)).json()).reviews;
  await request('DELETE', `/api/reviews/${mine[0].id}`, undefined, eve.token);
  me = (await (await request('GET', '/api/me', undefined, eve.token)).json()).user;
  assert.strictEqual(me.character.hat, 'none');
  assert.strictEqual(me.character.skin, 'skin4');
});
