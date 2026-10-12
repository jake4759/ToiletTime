// Storage for restrooms and reviews: a JSON file by default, or Postgres when DATABASE_URL is set.
const fs = require('node:fs');
const path = require('node:path');

const SEED_FILE = path.join(__dirname, 'data', 'seed.json');

const round1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);

function readSeed() {
  return JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')).bathrooms;
}

function summarize(b) {
  const n = b.reviews.length;
  const avg = (key) => (n ? round1(b.reviews.reduce((s, r) => s + r[key], 0) / n) : null);
  const { reviews, ...fields } = b;
  return {
    ...fields,
    reviewCount: n,
    rating: avg('overall'),
    cleanliness: avg('cleanliness'),
    supplies: avg('supplies'),
    privacy: avg('privacy'),
  };
}

const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);

// ---------- JSON file ----------

class JsonStore {
  constructor(file) {
    this.file = file;
    try {
      this.bathrooms = JSON.parse(fs.readFileSync(file, 'utf8')).bathrooms;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      this.bathrooms = readSeed();
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ bathrooms: this.bathrooms }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async list() {
    return this.bathrooms.map(summarize);
  }

  async get(id) {
    const b = this.bathrooms.find((x) => x.id === id);
    return b ? { ...summarize(b), reviews: [...b.reviews].sort(newestFirst) } : null;
  }

  async addRestroom(restroom, firstReview) {
    const b = { ...restroom, reviews: firstReview ? [firstReview] : [] };
    this.bathrooms.push(b);
    this.save();
    return this.get(b.id);
  }

  async addReview(restroomId, review) {
    const b = this.bathrooms.find((x) => x.id === restroomId);
    if (!b) return null;
    b.reviews.push(review);
    this.save();
    return review;
  }

  async close() {}
}

// ---------- Postgres ----------

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS restrooms (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    type text NOT NULL,
    address text NOT NULL DEFAULT '',
    city text NOT NULL DEFAULT '',
    country text NOT NULL DEFAULT '',
    lat double precision NOT NULL,
    lng double precision NOT NULL,
    accessible boolean NOT NULL DEFAULT false,
    free boolean NOT NULL DEFAULT true,
    baby_changing boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS reviews (
    id uuid PRIMARY KEY,
    restroom_id uuid NOT NULL REFERENCES restrooms(id) ON DELETE CASCADE,
    author text NOT NULL,
    overall smallint NOT NULL,
    cleanliness smallint NOT NULL,
    supplies smallint NOT NULL,
    privacy smallint NOT NULL,
    comment text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS reviews_restroom_id_idx ON reviews (restroom_id);
`;

const SUMMARY_SQL = `
  SELECT r.*, count(v.id)::int AS review_count,
         avg(v.overall) AS rating, avg(v.cleanliness) AS avg_cleanliness,
         avg(v.supplies) AS avg_supplies, avg(v.privacy) AS avg_privacy
  FROM restrooms r LEFT JOIN reviews v ON v.restroom_id = r.id
`;

const toSummary = (row) => ({
  id: row.id,
  name: row.name,
  type: row.type,
  address: row.address,
  city: row.city,
  country: row.country,
  lat: row.lat,
  lng: row.lng,
  accessible: row.accessible,
  free: row.free,
  babyChanging: row.baby_changing,
  createdAt: row.created_at.toISOString(),
  reviewCount: row.review_count,
  rating: round1(row.rating),
  cleanliness: round1(row.avg_cleanliness),
  supplies: round1(row.avg_supplies),
  privacy: round1(row.avg_privacy),
});

const toReview = (row) => ({
  id: row.id,
  author: row.author,
  overall: row.overall,
  cleanliness: row.cleanliness,
  supplies: row.supplies,
  privacy: row.privacy,
  comment: row.comment,
  createdAt: row.created_at.toISOString(),
});

class PgStore {
  constructor(pool) {
    this.pool = pool;
  }

  async init() {
    await this.pool.query(SCHEMA);
    const { rows } = await this.pool.query('SELECT count(*)::int AS n FROM restrooms');
    if (rows[0].n === 0) {
      for (const b of readSeed()) {
        const { reviews, ...restroom } = b;
        await this.insert(restroom, reviews);
      }
    }
    return this;
  }

  async insert(r, reviews) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO restrooms (id, name, type, address, city, country, lat, lng, accessible, free, baby_changing, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [r.id, r.name, r.type, r.address, r.city, r.country, r.lat, r.lng, r.accessible, r.free, r.babyChanging, r.createdAt],
      );
      for (const v of reviews) await this.insertReview(client, r.id, v);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  insertReview(db, restroomId, v) {
    return db.query(
      `INSERT INTO reviews (id, restroom_id, author, overall, cleanliness, supplies, privacy, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [v.id, restroomId, v.author, v.overall, v.cleanliness, v.supplies, v.privacy, v.comment, v.createdAt],
    );
  }

  async list() {
    const { rows } = await this.pool.query(`${SUMMARY_SQL} GROUP BY r.id`);
    return rows.map(toSummary);
  }

  async get(id) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query(`${SUMMARY_SQL} WHERE r.id = $1 GROUP BY r.id`, [id]);
    if (!rows.length) return null;
    const reviews = await this.pool.query('SELECT * FROM reviews WHERE restroom_id = $1 ORDER BY created_at DESC', [id]);
    return { ...toSummary(rows[0]), reviews: reviews.rows.map(toReview) };
  }

  async addRestroom(restroom, firstReview) {
    await this.insert(restroom, firstReview ? [firstReview] : []);
    return this.get(restroom.id);
  }

  async addReview(restroomId, review) {
    if (!isUuid(restroomId)) return null;
    try {
      await this.insertReview(this.pool, restroomId, review);
      return review;
    } catch (err) {
      if (err.code === '23503') return null; // restroom does not exist
      throw err;
    }
  }

  close() {
    return this.pool.end();
  }
}

const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

async function createStore() {
  const url = process.env.DATABASE_URL;
  if (!url) return new JsonStore(process.env.DB_FILE || path.join(__dirname, 'data', 'db.json'));
  const { Pool } = require('pg');
  // SSL settings come from the URL itself (e.g. ?sslmode=require for hosted databases).
  const pool = new Pool({ connectionString: url, max: 5 });
  return new PgStore(pool).init();
}

module.exports = { createStore };
