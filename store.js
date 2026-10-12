// Storage for restrooms, reviews and accounts: a JSON file by default, or Postgres when DATABASE_URL is set.
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
const publicReview = ({ userId = null, ...r }) => ({ ...r, userId });

// ---------- JSON file ----------

class JsonStore {
  constructor(file) {
    this.file = file;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      data = { bathrooms: readSeed() };
    }
    this.bathrooms = data.bathrooms;
    this.users = data.users || [];
    this.sessions = data.sessions || [];
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    const data = { bathrooms: this.bathrooms, users: this.users, sessions: this.sessions };
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  async list() {
    return this.bathrooms.map(summarize);
  }

  async get(id) {
    const b = this.bathrooms.find((x) => x.id === id);
    return b ? { ...summarize(b), reviews: b.reviews.map(publicReview).sort(newestFirst) } : null;
  }

  async addRestroom(restroom, firstReview) {
    const b = { ...restroom, reviews: firstReview ? [firstReview] : [] };
    this.bathrooms.push(b);
    this.save();
    return this.get(b.id);
  }

  /** Adds a review, replacing the same user's earlier review of this restroom. */
  async addReview(restroomId, review) {
    const b = this.bathrooms.find((x) => x.id === restroomId);
    if (!b) return null;
    const existing = review.userId ? b.reviews.findIndex((r) => r.userId === review.userId) : -1;
    if (existing >= 0) b.reviews[existing] = { ...review, id: b.reviews[existing].id };
    else b.reviews.push(review);
    this.save();
    return publicReview(existing >= 0 ? b.reviews[existing] : review);
  }

  async createUser(user) {
    if (this.users.some((u) => u.email === user.email)) return null;
    this.users.push(user);
    this.save();
    return user;
  }

  async findUserByEmail(email) {
    return this.users.find((u) => u.email === email) || null;
  }

  async createSession(session) {
    this.sessions.push(session);
    this.save();
  }

  async findSessionUser(tokenHash) {
    const s = this.sessions.find((x) => x.tokenHash === tokenHash);
    return (s && this.users.find((u) => u.id === s.userId)) || null;
  }

  async deleteSession(tokenHash) {
    this.sessions = this.sessions.filter((s) => s.tokenHash !== tokenHash);
    this.save();
  }

  /** Deletes the account and its sessions; the user's reviews stay, without their name. */
  async deleteUser(userId) {
    this.users = this.users.filter((u) => u.id !== userId);
    this.sessions = this.sessions.filter((s) => s.userId !== userId);
    for (const b of this.bathrooms) {
      for (const r of b.reviews) {
        if (r.userId === userId) Object.assign(r, { userId: null, author: 'Former member' });
      }
    }
    this.save();
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
  CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY,
    email text NOT NULL UNIQUE,
    name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;
  CREATE INDEX IF NOT EXISTS reviews_restroom_id_idx ON reviews (restroom_id);
  CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_user_idx ON reviews (restroom_id, user_id);
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
  userId: row.user_id,
  author: row.user_id ? row.user_name ?? row.author : row.author,
  overall: row.overall,
  cleanliness: row.cleanliness,
  supplies: row.supplies,
  privacy: row.privacy,
  comment: row.comment,
  createdAt: row.created_at.toISOString(),
});

const toUser = (row) =>
  row && {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.password_hash,
    createdAt: row.created_at.toISOString(),
  };

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
      for (const v of reviews) await this.upsertReview(client, r.id, v);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async upsertReview(db, restroomId, v) {
    const { rows } = await db.query(
      `INSERT INTO reviews (id, restroom_id, user_id, author, overall, cleanliness, supplies, privacy, comment, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (restroom_id, user_id) DO UPDATE SET
         author = EXCLUDED.author, overall = EXCLUDED.overall, cleanliness = EXCLUDED.cleanliness,
         supplies = EXCLUDED.supplies, privacy = EXCLUDED.privacy, comment = EXCLUDED.comment,
         created_at = EXCLUDED.created_at
       RETURNING *`,
      [v.id, restroomId, v.userId ?? null, v.author, v.overall, v.cleanliness, v.supplies, v.privacy, v.comment, v.createdAt],
    );
    return toReview(rows[0]);
  }

  async list() {
    const { rows } = await this.pool.query(`${SUMMARY_SQL} GROUP BY r.id`);
    return rows.map(toSummary);
  }

  async get(id) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query(`${SUMMARY_SQL} WHERE r.id = $1 GROUP BY r.id`, [id]);
    if (!rows.length) return null;
    const reviews = await this.pool.query(
      `SELECT v.*, u.name AS user_name FROM reviews v LEFT JOIN users u ON u.id = v.user_id
       WHERE v.restroom_id = $1 ORDER BY v.created_at DESC`,
      [id],
    );
    return { ...toSummary(rows[0]), reviews: reviews.rows.map(toReview) };
  }

  async addRestroom(restroom, firstReview) {
    await this.insert(restroom, firstReview ? [firstReview] : []);
    return this.get(restroom.id);
  }

  async addReview(restroomId, review) {
    if (!isUuid(restroomId)) return null;
    try {
      return await this.upsertReview(this.pool, restroomId, review);
    } catch (err) {
      if (err.code === '23503') return null; // restroom does not exist
      throw err;
    }
  }

  async createUser(user) {
    const { rows } = await this.pool.query(
      `INSERT INTO users (id, email, name, password_hash, created_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (email) DO NOTHING RETURNING *`,
      [user.id, user.email, user.name, user.passwordHash, user.createdAt],
    );
    return toUser(rows[0]) || null;
  }

  async findUserByEmail(email) {
    const { rows } = await this.pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return toUser(rows[0]) || null;
  }

  async createSession({ tokenHash, userId, createdAt }) {
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, created_at) VALUES ($1,$2,$3)', [
      tokenHash,
      userId,
      createdAt,
    ]);
  }

  async findSessionUser(tokenHash) {
    const { rows } = await this.pool.query(
      'SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1',
      [tokenHash],
    );
    return toUser(rows[0]) || null;
  }

  async deleteSession(tokenHash) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async deleteUser(userId) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE reviews SET author = 'Former member' WHERE user_id = $1`, [userId]);
      await client.query('DELETE FROM users WHERE id = $1', [userId]); // sessions cascade, reviews keep (user_id set null)
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
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
