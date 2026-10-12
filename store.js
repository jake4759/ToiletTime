// Storage for restrooms, reviews and profiles: a JSON file by default, or Postgres when DATABASE_URL is set.
// Accounts themselves (email, password, sign-in) live in Supabase; a profile holds what the app adds on top.
const fs = require('node:fs');
const path = require('node:path');

const round1 = (x) => (x == null ? null : Math.round(Number(x) * 10) / 10);
const newestFirst = (a, b) => b.createdAt.localeCompare(a.createdAt);

/** Made-up sample restrooms and reviews shipped with early versions; removed wherever they still exist. */
const SAMPLE_RESTROOM_IDS = [
  '58e5f58b-be68-490a-b463-c78452f6008c',
  '466e4cb8-802c-4a91-84ce-770527b88e64',
  '90c14cb3-b611-46a7-b3c0-b93e3a4846c2',
  '5b5a4bed-ee5e-43c9-a33c-b395925e2fe5',
  '8599ba3d-896f-4681-bd69-2137f0e0e5c3',
  '71191d24-7a25-491a-9447-630d9d33b64a',
  'ca6720c5-4452-41d2-9fae-1980eadc7a6b',
  '91bf5434-9e98-429b-b44a-a249b5d75188',
  'c54f95d0-fcbe-495f-b53e-0de77ace02b4',
  '6884983b-61b4-42a0-8800-e09899105344'
];
const SAMPLE_REVIEW_IDS = [
  '0f6f4114-508a-4bca-9191-a2514405378e',
  '585f2c92-ed13-452b-953d-180736dea11f',
  '14389e89-b361-4825-9521-a03844c429e7',
  '1cebc445-9e23-45f3-84c1-23370bef1b1e',
  'b13dc2cb-0da1-424b-949b-5520f8b6115a',
  '68daeee6-01c2-4216-a99e-dc9745d66009',
  '85bc9342-921e-4c16-9d1e-08b4aa176cd3',
  '7e41f081-9dbb-40e0-8f6d-ae825a942593',
  '26e3a335-b36f-4661-8a2f-b8e454d54020',
  '9aab5129-5f6b-4960-8e50-91be221ede90',
  '39f0a6f6-11d4-43d0-9615-1fac7c35b5b8',
  '36d1e9a0-8a3d-4688-828e-739ea8bee982'
];

const avatarUrl = (p) => (p && p.avatarUpdatedAt ? `/api/avatars/${p.id}?v=${Date.parse(p.avatarUpdatedAt)}` : null);

function publicProfile(p) {
  return {
    id: p.id,
    username: p.username ?? null,
    avatarUrl: avatarUrl(p),
    markerColor: p.markerColor ?? null,
    character: p.character ?? null,
    createdAt: p.createdAt,
  };
}

function summarize(b) {
  const visible = b.reviews.filter((r) => !r.hidden);
  const n = visible.length;
  const avg = (key) => (n ? round1(visible.reduce((s, r) => s + r[key], 0) / n) : null);
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

// ---------- JSON file ----------

class JsonStore {
  constructor(file) {
    this.file = file;
    let data = { bathrooms: [] };
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    this.profiles = data.profiles || [];
    this.bathrooms = data.bathrooms || [];
    this.visits = data.visits || [];
    if (this.cleanUp(data)) this.save();
  }

  /** Removes sample data and accounts from older versions. Returns true if anything changed. */
  cleanUp(data) {
    let changed = !!(data.users || data.sessions);
    const known = new Set(this.profiles.map((p) => p.id));
    for (const b of this.bathrooms) {
      const before = b.reviews.length;
      b.reviews = b.reviews.filter((r) => !SAMPLE_REVIEW_IDS.includes(r.id));
      changed ||= b.reviews.length !== before;
      for (const r of b.reviews) {
        if (r.userId && !known.has(r.userId)) {
          r.userId = null; // account from the old built-in sign-in
          changed = true;
        }
      }
    }
    const before = this.bathrooms.length;
    this.bathrooms = this.bathrooms.filter((b) => !(SAMPLE_RESTROOM_IDS.includes(b.id) && b.reviews.length === 0));
    return changed || this.bathrooms.length !== before;
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ bathrooms: this.bathrooms, profiles: this.profiles, visits: this.visits }, null, 2));
    fs.renameSync(tmp, this.file);
  }

  profile(id) {
    return this.profiles.find((p) => p.id === id) || null;
  }

  publicReview(r) {
    const p = r.userId ? this.profile(r.userId) : null;
    return {
      id: r.id,
      userId: r.userId ?? null,
      author: p?.username ?? r.author,
      authorAvatarUrl: avatarUrl(p),
      overall: r.overall,
      cleanliness: r.cleanliness,
      supplies: r.supplies,
      privacy: r.privacy,
      comment: r.comment,
      hidden: !!r.hidden,
      createdAt: r.createdAt,
    };
  }

  async list() {
    return this.bathrooms.map(summarize);
  }

  async get(id) {
    const b = this.bathrooms.find((x) => x.id === id);
    if (!b) return null;
    const reviews = b.reviews.filter((r) => !r.hidden).map((r) => this.publicReview(r));
    return { ...summarize(b), reviews: reviews.sort(newestFirst) };
  }

  findReview(reviewId) {
    for (const b of this.bathrooms) {
      const r = b.reviews.find((x) => x.id === reviewId);
      if (r) return { b, r };
    }
    return null;
  }

  /** Records a report (one per person per review) and hides the review once enough people report it. */
  async reportReview(reviewId, reporterId, reason, hideAfter) {
    const found = this.findReview(reviewId);
    if (!found) return null;
    const { r } = found;
    if (r.userId === reporterId) return { own: true };
    r.reports = (r.reports || []).filter((x) => x.reporterId !== reporterId);
    r.reports.push({ reporterId, reason, createdAt: new Date().toISOString() });
    if (r.reports.length >= hideAfter) r.hidden = true;
    this.save();
    return { hidden: !!r.hidden };
  }

  /** Reported reviews with their reports, most reported first (for moderators). */
  async listReported() {
    const out = [];
    for (const b of this.bathrooms) {
      for (const r of b.reviews) {
        if (r.reports?.length) out.push({ ...this.publicReview(r), restroomName: b.name, reports: r.reports });
      }
    }
    return out.sort((a, b) => b.reports.length - a.reports.length);
  }

  /** Moderator action: 'delete' removes the review, 'restore' shows it again and clears its reports. */
  async moderate(reviewId, action) {
    const found = this.findReview(reviewId);
    if (!found) return false;
    if (action === 'delete') found.b.reviews = found.b.reviews.filter((x) => x.id !== reviewId);
    else Object.assign(found.r, { hidden: false, reports: [] });
    this.save();
    return true;
  }

  async findIdByOsmId(osmId) {
    return this.bathrooms.find((b) => b.osmId && b.osmId === osmId)?.id ?? null;
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
    // Editing a review starts it fresh: earlier reports no longer apply to the new text.
    if (existing >= 0) b.reviews[existing] = { ...review, id: b.reviews[existing].id };
    else b.reviews.push(review);
    this.save();
    return this.publicReview(existing >= 0 ? b.reviews[existing] : review);
  }

  async listUserReviews(userId) {
    const out = [];
    for (const b of this.bathrooms) {
      for (const r of b.reviews) {
        if (r.userId === userId) out.push({ ...this.publicReview(r), restroomId: b.id, restroomName: b.name });
      }
    }
    return out.sort(newestFirst);
  }

  async deleteReview(reviewId, userId) {
    for (const b of this.bathrooms) {
      const i = b.reviews.findIndex((r) => r.id === reviewId && r.userId === userId);
      if (i >= 0) {
        b.reviews.splice(i, 1);
        this.save();
        return true;
      }
    }
    return false;
  }

  async getProfile(id) {
    const p = this.profile(id);
    return p && publicProfile(p);
  }

  /** Restrooms this person has reviewed (hidden reviews don't count). */
  async countUserReviews(userId) {
    let n = 0;
    for (const b of this.bathrooms) if (b.reviews.some((r) => r.userId === userId && !r.hidden)) n++;
    return n;
  }

  async getRestroomPoint(id) {
    const b = this.bathrooms.find((x) => x.id === id);
    return b ? { id: b.id, lat: b.lat, lng: b.lng, osmId: b.osmId ?? null } : null;
  }

  /** Remembers that a person was near these restrooms/places just now. */
  async recordVisits(userId, keys, purgeBefore) {
    const now = new Date().toISOString();
    this.visits = this.visits.filter((v) => v.at > purgeBefore && !(v.userId === userId && keys.includes(v.key)));
    for (const key of keys) this.visits.push({ userId, key, at: now });
    this.save();
  }

  async hasVisit(userId, keys, since) {
    return this.visits.some((v) => v.userId === userId && keys.includes(v.key) && v.at > since);
  }

  async ensureProfile(id) {
    if (!this.profile(id)) {
      this.profiles.push({ id, username: null, markerColor: null, createdAt: new Date().toISOString() });
      this.save();
    }
    return this.getProfile(id);
  }

  async usernameTaken(username, exceptId) {
    const lower = username.toLowerCase();
    return this.profiles.some((p) => p.id !== exceptId && p.username?.toLowerCase() === lower);
  }

  async updateProfile(id, fields) {
    const p = this.profile(id);
    if (!p) return null;
    if (fields.username !== undefined && (await this.usernameTaken(fields.username, id))) return { conflict: 'username' };
    Object.assign(p, fields);
    this.save();
    return publicProfile(p);
  }

  async setAvatar(id, data, type) {
    const p = this.profile(id);
    if (!p) return null;
    Object.assign(p, { avatar: data ? data.toString('base64') : null, avatarType: type, avatarUpdatedAt: data ? new Date().toISOString() : null });
    this.save();
    return publicProfile(p);
  }

  async getAvatar(id) {
    const p = this.profile(id);
    return p?.avatar ? { data: Buffer.from(p.avatar, 'base64'), type: p.avatarType } : null;
  }

  /** Deletes a profile; the user's reviews stay, without their name. */
  async deleteProfile(id) {
    this.profiles = this.profiles.filter((p) => p.id !== id);
    this.visits = this.visits.filter((v) => v.userId !== id);
    for (const b of this.bathrooms) {
      for (const r of b.reviews) if (r.userId === id) Object.assign(r, { userId: null, author: 'Former member' });
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
  ALTER TABLE restrooms ADD COLUMN IF NOT EXISTS osm_id text;
  CREATE UNIQUE INDEX IF NOT EXISTS restrooms_osm_id_idx ON restrooms (osm_id) WHERE osm_id IS NOT NULL;

  CREATE TABLE IF NOT EXISTS profiles (
    id uuid PRIMARY KEY,
    username text,
    avatar bytea,
    avatar_type text,
    avatar_updated_at timestamptz,
    marker_color text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  ALTER TABLE profiles ADD COLUMN IF NOT EXISTS character jsonb;
  CREATE TABLE IF NOT EXISTS visits (
    user_id uuid NOT NULL,
    target_key text NOT NULL,
    visited_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, target_key)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_idx ON profiles (lower(username)) WHERE username IS NOT NULL;

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
  ALTER TABLE reviews ADD COLUMN IF NOT EXISTS user_id uuid;
  ALTER TABLE reviews ADD COLUMN IF NOT EXISTS hidden boolean NOT NULL DEFAULT false;
  CREATE TABLE IF NOT EXISTS review_reports (
    review_id uuid NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    reporter_id uuid NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (review_id, reporter_id)
  );
  CREATE INDEX IF NOT EXISTS reviews_restroom_id_idx ON reviews (restroom_id);
  CREATE INDEX IF NOT EXISTS reviews_user_id_idx ON reviews (user_id);
  CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_user_idx ON reviews (restroom_id, user_id);

  -- Accounts used to live here; they are in Supabase now.
  ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_user_id_fkey;
  DROP TABLE IF EXISTS sessions;
  DROP TABLE IF EXISTS users;
  UPDATE reviews SET user_id = NULL
    WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM profiles);
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reviews_user_id_profile_fkey') THEN
      ALTER TABLE reviews ADD CONSTRAINT reviews_user_id_profile_fkey
        FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;
    END IF;
  END $$;
`;

const SUMMARY_SQL = `
  SELECT r.*, count(v.id)::int AS review_count,
         avg(v.overall) AS rating, avg(v.cleanliness) AS avg_cleanliness,
         avg(v.supplies) AS avg_supplies, avg(v.privacy) AS avg_privacy
  FROM restrooms r LEFT JOIN reviews v ON v.restroom_id = r.id AND NOT v.hidden
`;

const REVIEW_SQL = `
  SELECT v.*, p.username AS profile_username, p.avatar_updated_at AS profile_avatar_at
  FROM reviews v LEFT JOIN profiles p ON p.id = v.user_id
`;

const iso = (d) => (d ? new Date(d).toISOString() : null);

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
  osmId: row.osm_id ?? null,
  createdAt: iso(row.created_at),
  reviewCount: row.review_count,
  rating: round1(row.rating),
  cleanliness: round1(row.avg_cleanliness),
  supplies: round1(row.avg_supplies),
  privacy: round1(row.avg_privacy),
});

const toReview = (row) => ({
  id: row.id,
  userId: row.user_id,
  author: row.profile_username ?? row.author,
  authorAvatarUrl: avatarUrl(row.user_id && { id: row.user_id, avatarUpdatedAt: iso(row.profile_avatar_at) }),
  overall: row.overall,
  cleanliness: row.cleanliness,
  supplies: row.supplies,
  privacy: row.privacy,
  comment: row.comment,
  hidden: !!row.hidden,
  createdAt: iso(row.created_at),
});

const toProfile = (row) =>
  row &&
  publicProfile({
    id: row.id,
    username: row.username,
    markerColor: row.marker_color,
    character: row.character,
    avatarUpdatedAt: iso(row.avatar_updated_at),
    createdAt: iso(row.created_at),
  });

class PgStore {
  constructor(pool) {
    this.pool = pool;
  }

  async init() {
    await this.pool.query(SCHEMA);
    await this.pool.query('DELETE FROM reviews WHERE id = ANY($1::uuid[])', [SAMPLE_REVIEW_IDS]);
    await this.pool.query(
      'DELETE FROM restrooms r WHERE r.id = ANY($1::uuid[]) AND NOT EXISTS (SELECT 1 FROM reviews v WHERE v.restroom_id = r.id)',
      [SAMPLE_RESTROOM_IDS],
    );
    return this;
  }

  async insert(r, reviews) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO restrooms (id, name, type, address, city, country, lat, lng, accessible, free, baby_changing, created_at, osm_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [r.id, r.name, r.type, r.address, r.city, r.country, r.lat, r.lng, r.accessible, r.free, r.babyChanging, r.createdAt, r.osmId ?? null],
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
         created_at = EXCLUDED.created_at, hidden = false
       RETURNING id`,
      [v.id, restroomId, v.userId ?? null, v.author, v.overall, v.cleanliness, v.supplies, v.privacy, v.comment, v.createdAt],
    );
    await db.query('DELETE FROM review_reports WHERE review_id = $1', [rows[0].id]);
    const full = await db.query(`${REVIEW_SQL} WHERE v.id = $1`, [rows[0].id]);
    return toReview(full.rows[0]);
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
      `${REVIEW_SQL} WHERE v.restroom_id = $1 AND NOT v.hidden ORDER BY v.created_at DESC`,
      [id],
    );
    return { ...toSummary(rows[0]), reviews: reviews.rows.map(toReview) };
  }

  async findIdByOsmId(osmId) {
    const { rows } = await this.pool.query('SELECT id FROM restrooms WHERE osm_id = $1', [osmId]);
    return rows[0]?.id ?? null;
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

  async listUserReviews(userId) {
    const { rows } = await this.pool.query(
      `SELECT v.*, p.username AS profile_username, p.avatar_updated_at AS profile_avatar_at, r.name AS restroom_name
       FROM reviews v JOIN restrooms r ON r.id = v.restroom_id LEFT JOIN profiles p ON p.id = v.user_id
       WHERE v.user_id = $1 ORDER BY v.created_at DESC`,
      [userId],
    );
    return rows.map((row) => ({ ...toReview(row), restroomId: row.restroom_id, restroomName: row.restroom_name }));
  }

  async reportReview(reviewId, reporterId, reason, hideAfter) {
    if (!isUuid(reviewId)) return null;
    const { rows } = await this.pool.query('SELECT user_id FROM reviews WHERE id = $1', [reviewId]);
    if (!rows.length) return null;
    if (rows[0].user_id === reporterId) return { own: true };
    await this.pool.query(
      `INSERT INTO review_reports (review_id, reporter_id, reason) VALUES ($1, $2, $3)
       ON CONFLICT (review_id, reporter_id) DO UPDATE SET reason = EXCLUDED.reason, created_at = now()`,
      [reviewId, reporterId, reason],
    );
    const result = await this.pool.query(
      `UPDATE reviews SET hidden = true WHERE id = $1
         AND (SELECT count(*) FROM review_reports WHERE review_id = $1) >= $2
       RETURNING id`,
      [reviewId, hideAfter],
    );
    const hidden = result.rowCount > 0 || (await this.pool.query('SELECT hidden FROM reviews WHERE id = $1', [reviewId])).rows[0].hidden;
    return { hidden };
  }

  async listReported() {
    const { rows } = await this.pool.query(
      `SELECT v.*, p.username AS profile_username, p.avatar_updated_at AS profile_avatar_at, r.name AS restroom_name,
              json_agg(json_build_object('reporterId', x.reporter_id, 'reason', x.reason, 'createdAt', x.created_at)) AS reports
       FROM review_reports x JOIN reviews v ON v.id = x.review_id JOIN restrooms r ON r.id = v.restroom_id
       LEFT JOIN profiles p ON p.id = v.user_id
       GROUP BY v.id, p.username, p.avatar_updated_at, r.name
       ORDER BY count(*) DESC`,
    );
    return rows.map((row) => ({ ...toReview(row), restroomName: row.restroom_name, reports: row.reports }));
  }

  async moderate(reviewId, action) {
    if (!isUuid(reviewId)) return false;
    if (action === 'delete') {
      return (await this.pool.query('DELETE FROM reviews WHERE id = $1', [reviewId])).rowCount > 0;
    }
    await this.pool.query('DELETE FROM review_reports WHERE review_id = $1', [reviewId]);
    return (await this.pool.query('UPDATE reviews SET hidden = false WHERE id = $1', [reviewId])).rowCount > 0;
  }

  async deleteReview(reviewId, userId) {
    if (!isUuid(reviewId)) return false;
    const { rowCount } = await this.pool.query('DELETE FROM reviews WHERE id = $1 AND user_id = $2', [reviewId, userId]);
    return rowCount > 0;
  }

  async getProfile(id) {
    const { rows } = await this.pool.query('SELECT * FROM profiles WHERE id = $1', [id]);
    return toProfile(rows[0]) || null;
  }

  async ensureProfile(id) {
    await this.pool.query('INSERT INTO profiles (id) VALUES ($1) ON CONFLICT (id) DO NOTHING', [id]);
    return this.getProfile(id);
  }

  async countUserReviews(userId) {
    const { rows } = await this.pool.query(
      'SELECT count(DISTINCT restroom_id)::int AS n FROM reviews WHERE user_id = $1 AND NOT hidden',
      [userId],
    );
    return rows[0].n;
  }

  async getRestroomPoint(id) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query('SELECT id, lat, lng, osm_id FROM restrooms WHERE id = $1', [id]);
    return rows[0] ? { id: rows[0].id, lat: rows[0].lat, lng: rows[0].lng, osmId: rows[0].osm_id } : null;
  }

  async recordVisits(userId, keys, purgeBefore) {
    await this.pool.query('DELETE FROM visits WHERE visited_at < $1', [purgeBefore]);
    for (const key of keys) {
      await this.pool.query(
        `INSERT INTO visits (user_id, target_key, visited_at) VALUES ($1, $2, now())
         ON CONFLICT (user_id, target_key) DO UPDATE SET visited_at = now()`,
        [userId, key],
      );
    }
  }

  async hasVisit(userId, keys, since) {
    const { rows } = await this.pool.query(
      'SELECT 1 FROM visits WHERE user_id = $1 AND target_key = ANY($2::text[]) AND visited_at > $3 LIMIT 1',
      [userId, keys, since],
    );
    return rows.length > 0;
  }

  async updateProfile(id, fields) {
    const sets = [];
    const values = [id];
    if (fields.username !== undefined) sets.push(`username = $${values.push(fields.username)}`);
    if (fields.markerColor !== undefined) sets.push(`marker_color = $${values.push(fields.markerColor)}`);
    if (fields.character !== undefined) sets.push(`character = $${values.push(JSON.stringify(fields.character))}::jsonb`);
    if (!sets.length) return this.getProfile(id);
    try {
      const { rows } = await this.pool.query(`UPDATE profiles SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, values);
      return toProfile(rows[0]) || null;
    } catch (err) {
      if (err.code === '23505') return { conflict: 'username' };
      throw err;
    }
  }

  async setAvatar(id, data, type) {
    const { rows } = await this.pool.query(
      `UPDATE profiles SET avatar = $2, avatar_type = $3, avatar_updated_at = CASE WHEN $2::bytea IS NULL THEN NULL ELSE now() END
       WHERE id = $1 RETURNING *`,
      [id, data, type],
    );
    return toProfile(rows[0]) || null;
  }

  async getAvatar(id) {
    if (!isUuid(id)) return null;
    const { rows } = await this.pool.query('SELECT avatar, avatar_type FROM profiles WHERE id = $1', [id]);
    return rows[0]?.avatar ? { data: rows[0].avatar, type: rows[0].avatar_type } : null;
  }

  async deleteProfile(id) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE reviews SET author = 'Former member' WHERE user_id = $1`, [id]);
      await client.query('DELETE FROM profiles WHERE id = $1', [id]); // reviews keep, user_id set null
      await client.query('DELETE FROM visits WHERE user_id = $1', [id]);
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

module.exports = { createStore, isUuid };
