const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createStore } = require('../store');

test('removes the old made-up sample data but keeps real data', { skip: !!process.env.DATABASE_URL }, async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-')), 'db.json');
  const real = { id: '11111111-1111-4111-8111-111111111111', name: 'My Cafe', reviews: [{ id: 'r1', userId: 'old-user', author: 'Me', overall: 5, cleanliness: 5, supplies: 5, privacy: 5, comment: '', createdAt: '2026-01-01T00:00:00Z' }] };
  const sample = { id: '58e5f58b-be68-490a-b463-c78452f6008c', name: "Buc-ee's New Braunfels", reviews: [{ id: 'a29d3c59-placeholder', overall: 5 }] };
  fs.writeFileSync(file, JSON.stringify({ bathrooms: [real, sample], users: [{ id: 'old-user' }], sessions: [] }));

  // Use the real sample review id from the store's list so the sample restroom ends up empty.
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  const sampleReviewId = /SAMPLE_REVIEW_IDS = \[\s*'([^']+)'/.exec(src)[1];
  sample.reviews[0].id = sampleReviewId;
  fs.writeFileSync(file, JSON.stringify({ bathrooms: [real, sample], users: [{ id: 'old-user' }], sessions: [] }));

  process.env.DB_FILE = file;
  const store = await createStore();
  const names = (await store.list()).map((b) => b.name);
  assert.deepStrictEqual(names, ['My Cafe']);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(saved.users, undefined);
  assert.strictEqual(saved.bathrooms[0].reviews[0].userId, null);
  assert.strictEqual(saved.bathrooms[0].reviews[0].author, 'Me');
});
