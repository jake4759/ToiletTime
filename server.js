// ToiletTime — a small server for rating restrooms worldwide.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

require('./env').loadEnvFile(path.join(__dirname, '.env'));

const { fetchPlaces, parseBbox } = require('./places');
const { createStore, isUuid } = require('./store');
const supabase = require('./supabase');
const { HIDE_AFTER_REPORTS, REPORT_REASONS, isOffensiveName, maskText } = require('./moderation');
const character = require('./character');

/** You can review a restroom if you were this close to it within the review window. */
const VISIT_RADIUS_M = Number(process.env.VISIT_RADIUS_M) || 200;
const REVIEW_WINDOW_HOURS = Number(process.env.REVIEW_WINDOW_HOURS) || 24;
/** Visit records are deleted after this long. */
const VISIT_KEEP_HOURS = Math.max(48, REVIEW_WINDOW_HOURS * 2);

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 32 * 1024;
const MAX_AVATAR_BODY = 600 * 1024;
const MAX_AVATAR_BYTES = 400 * 1024;

const PLACE_TYPES = ['restaurant', 'cafe', 'store', 'mall', 'gas_station', 'hotel', 'bar', 'public', 'other'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// ---------- storage & limits ----------

if (process.env.RENDER && !process.env.DATABASE_URL) {
  console.warn('DATABASE_URL is not set: ratings are kept in a local file and will be lost when the server restarts.');
}
if (!process.env.CONTACT_EMAIL) {
  console.warn('CONTACT_EMAIL is not set: the Terms and Privacy Policy have no contact address. Run "npm run configure" to add one.');
}
if (!supabase.isConfigured()) {
  console.warn('Supabase is not set up yet, so sign-in is turned off. Run "npm run configure" to connect it.');
}

const storeReady = createStore();
storeReady.catch((err) => {
  if (process.env.DATABASE_URL) {
    console.error(`\nCouldn't connect to the database in DATABASE_URL: ${err.message}`);
    console.error('Check the database password, or run "npm run configure" (ToiletTime.bat option 5) to fix it.');
    console.error('To keep ratings on this computer instead, answer "none" to the database question.\n');
  } else {
    console.error('Failed to open storage:', err);
  }
  process.exit(1);
});

// Simple per-client rate limits, so one client can't flood the public server.
const WINDOW_MS = 10 * 60 * 1000;
const limiters = [];

function clientIp(req) {
  const forwarded = process.env.TRUST_PROXY && req.headers['x-forwarded-for'];
  return (forwarded ? forwarded.split(',')[0] : req.socket.remoteAddress || '').trim();
}

function rateLimiter(limit) {
  const hits = new Map();
  limiters.push(hits);
  return (req) => {
    const now = Date.now();
    const ip = clientIp(req);
    const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= limit) return false;
    recent.push(now);
    hits.set(ip, recent);
    return true;
  };
}

const allowWrite = rateLimiter(Number(process.env.WRITE_LIMIT) || 30);
const allowProfileChange = rateLimiter(Number(process.env.PROFILE_LIMIT) || 30);
const allowPlacesLookup = rateLimiter(Number(process.env.PLACES_LIMIT) || 300);
const allowVisitPing = rateLimiter(Number(process.env.VISIT_LIMIT) || 200);

setInterval(() => {
  const now = Date.now();
  for (const hits of limiters) {
    for (const [ip, times] of hits) if (times.every((t) => now - t >= WINDOW_MS)) hits.delete(ip);
  }
}, WINDOW_MS).unref();

// ---------- accounts ----------

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function bearerToken(req) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  return match ? match[1] : null;
}

/** The signed-in Supabase user, or throws 401. */
async function requireUser(req) {
  if (!supabase.isConfigured()) throw new HttpError(503, 'Sign-in is not set up on this server yet.');
  let user;
  try {
    user = await supabase.getUser(bearerToken(req));
  } catch (err) {
    console.error('Supabase check failed:', err.message);
    throw new HttpError(503, 'Sign-in is unavailable right now. Please try again.');
  }
  if (!user) throw new HttpError(401, 'Please sign in.', 'signin');
  return user;
}

/** A signed-in user who may post: verified email and a username. Returns { user, profile }. */
async function requirePoster(store, req) {
  const user = await requireUser(req);
  if (!user.emailVerified) throw new HttpError(403, 'Please verify your email before posting.', 'unverified');
  const profile = await store.ensureProfile(user.id);
  if (!profile.username) throw new HttpError(403, 'Choose a username before posting.', 'username');
  return { user, profile };
}

const RESERVED = new Set(['admin', 'administrator', 'toilettime', 'support', 'moderator', 'formermember', 'anonymous']);

function username(v) {
  const u = str(v, 20, true);
  if (!/^[A-Za-z0-9_.]{3,20}$/.test(u) || /^\.|\.$|\.\./.test(u)) {
    throw new ValidationError('Usernames are 3–20 letters, numbers, underscores or dots.');
  }
  if (RESERVED.has(u.toLowerCase().replace(/[_.]/g, ''))) throw new ValidationError('That username is reserved.');
  if (isOffensiveName(u)) throw new ValidationError("That username isn't allowed. Please choose another.");
  return u;
}

function markerColor(v) {
  if (v === null) return null;
  if (typeof v !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(v)) throw new ValidationError('invalid color');
  return v.toLowerCase();
}

/** Decodes an uploaded profile picture and checks it really is a JPEG or PNG. */
function avatarImage(body) {
  const raw = typeof body.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
  if (!raw || !/^[A-Za-z0-9+/=\s]+$/.test(raw)) throw new ValidationError('Choose a photo to upload.');
  const data = Buffer.from(raw, 'base64');
  if (data.length > MAX_AVATAR_BYTES) throw new ValidationError('That photo is too large.');
  const jpeg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!jpeg && !png) throw new ValidationError('Profile pictures must be JPEG or PNG images.');
  return { data, type: jpeg ? 'image/jpeg' : 'image/png' };
}

async function progress(store, userId) {
  const reviewCount = await store.countUserReviews(userId);
  return { reviewCount, level: character.levelFor(reviewCount), nextUnlock: character.nextUnlock(reviewCount) };
}

async function me(store, user) {
  const profile = await store.ensureProfile(user.id);
  const p = await progress(store, user.id);
  return {
    ...profile,
    character: character.sanitize(profile.character, p.reviewCount),
    ...p,
    email: user.email,
    emailVerified: user.emailVerified,
    provider: user.provider,
  };
}

/** Rewards earned by a new review: level and any items it unlocked. */
async function rewardsAfter(store, userId, before) {
  const p = await progress(store, userId);
  const levelUp = character.levelFor(before).name !== p.level.name;
  return { ...p, levelUp, newItems: character.newlyUnlocked(before, p.reviewCount) };
}

// ---------- were you there? ----------

function distanceM(a, b) {
  const R = 6371e3;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** A reported position { lat, lng, accuracy } from the device, or null. */
function position(v) {
  if (!v || typeof v !== 'object') return null;
  const lat = Number(v.lat);
  const lng = Number(v.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const accuracy = Math.min(Math.max(Number(v.accuracy) || 0, 0), 100); // GPS slack, capped
  return { lat, lng, accuracy };
}

const isNear = (here, target) => !!here && distanceM(here, target) <= VISIT_RADIUS_M + here.accuracy;
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();

// Visit records are only kept for VISIT_KEEP_HOURS; clear out old ones every hour even when nobody's posting.
setInterval(() => {
  storeReady.then((store) => store.recordVisits(null, [], hoursAgo(VISIT_KEEP_HOURS))).catch(() => {});
}, 3600 * 1000).unref();

/**
 * Checks that the person is at the restroom now (`here`) or was near it within the review window.
 * `target` is { lat, lng } and `keys` identify it (restroom id and/or OpenStreetMap id).
 */
async function requirePresence(store, userId, target, keys, here) {
  if (isNear(here, target)) {
    if (keys.length) await store.recordVisits(userId, keys, hoursAgo(VISIT_KEEP_HOURS));
    return;
  }
  if (keys.length && (await store.hasVisit(userId, keys, hoursAgo(REVIEW_WINDOW_HOURS)))) return;
  throw new HttpError(
    403,
    `You can rate restrooms you've been to in the last ${REVIEW_WINDOW_HOURS} hours. ` +
      'Open ToiletTime while you\'re there (within about 200 m), then rate it here any time that day.',
    'not_visited',
  );
}

const restroomKeys = (point) => [`r:${point.id}`, ...(point.osmId ? [`osm:${point.osmId}`] : [])];

async function handleMe(req, res, store, parts) {
  const user = await requireUser(req);
  const sub = parts[2];

  // GET /api/me
  if (!sub && req.method === 'GET') return send(res, 200, { user: await me(store, user) });

  // PATCH /api/me  { username?, markerColor? }
  if (!sub && req.method === 'PATCH') {
    if (!allowProfileChange(req)) throw new HttpError(429, 'Too many changes. Please try again in a few minutes.');
    await store.ensureProfile(user.id);
    const body = await readJson(req);
    const fields = {};
    if (body.username !== undefined) fields.username = username(body.username);
    if (body.markerColor !== undefined) fields.markerColor = markerColor(body.markerColor);
    if (body.character !== undefined) {
      try {
        fields.character = character.validate(body.character, await store.countUserReviews(user.id));
      } catch (err) {
        throw new ValidationError(err.message);
      }
    }
    const result = await store.updateProfile(user.id, fields);
    if (result?.conflict) throw new HttpError(409, 'That username is taken. Try another one.');
    return send(res, 200, { user: await me(store, user) });
  }

  // DELETE /api/me  (permanently deletes the account; reviews stay without the name)
  if (!sub && req.method === 'DELETE') {
    try {
      await supabase.deleteUser(user.id);
    } catch (err) {
      console.error('Account deletion failed:', err.message);
      throw new HttpError(503, "Couldn't delete the account right now. Please try again.");
    }
    await store.deleteProfile(user.id);
    return send(res, 200, { ok: true });
  }

  // PUT /api/me/avatar  { image: base64 JPEG/PNG }   DELETE /api/me/avatar
  if (sub === 'avatar' && parts.length === 3 && (req.method === 'PUT' || req.method === 'DELETE')) {
    if (!allowProfileChange(req)) throw new HttpError(429, 'Too many changes. Please try again in a few minutes.');
    await store.ensureProfile(user.id);
    if (req.method === 'DELETE') await store.setAvatar(user.id, null, null);
    else {
      const { data, type } = avatarImage(await readJson(req, MAX_AVATAR_BODY));
      await store.setAvatar(user.id, data, type);
    }
    return send(res, 200, { user: await me(store, user) });
  }

  // GET /api/me/reviews
  if (sub === 'reviews' && parts.length === 3 && req.method === 'GET') {
    return send(res, 200, { reviews: await store.listUserReviews(user.id) });
  }

  return send(res, 404, { error: 'not found' });
}

// ---------- validation ----------

function str(v, max, required = false) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new ValidationError('missing required field');
    return '';
  }
  if (typeof v !== 'string') throw new ValidationError('expected text');
  const s = v.trim();
  if (required && !s) throw new ValidationError('missing required field');
  if (s.length > max) throw new ValidationError(`text too long (max ${max})`);
  return s;
}

function stars(v, name) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new ValidationError(`${name} must be 1-5 stars`);
  return n;
}

function num(v, min, max, name) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`invalid ${name}`);
  return n;
}

class ValidationError extends Error {}

function validateReview(body, profile) {
  if (!body || typeof body !== 'object') throw new ValidationError('missing review');
  return {
    id: crypto.randomUUID(),
    userId: profile.id,
    author: profile.username,
    overall: stars(body.overall, 'overall'),
    cleanliness: stars(body.cleanliness, 'cleanliness'),
    supplies: stars(body.supplies, 'supplies'),
    privacy: stars(body.privacy, 'privacy'),
    comment: maskText(str(body.comment, 1000)),
    createdAt: new Date().toISOString(),
  };
}

function osmId(v) {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^(node|way|relation)\/\d{1,15}$/.test(v)) throw new ValidationError('invalid place');
  return v;
}

function validateBathroom(body) {
  const type = PLACE_TYPES.includes(body.type) ? body.type : 'other';
  return {
    id: crypto.randomUUID(),
    osmId: osmId(body.osmId),
    name: str(body.name, 100, true),
    type,
    address: str(body.address, 200),
    city: str(body.city, 80),
    country: str(body.country, 80),
    lat: num(body.lat, -90, 90, 'latitude'),
    lng: num(body.lng, -180, 180, 'longitude'),
    accessible: Boolean(body.accessible),
    free: body.free === undefined ? true : Boolean(body.free),
    babyChanging: Boolean(body.babyChanging),
    createdAt: new Date().toISOString(),
  };
}

// ---------- security headers ----------

function contentSecurityPolicy() {
  const supabaseOrigin = supabase.config().url;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://*.basemaps.cartocdn.com",
    `connect-src 'self' https://nominatim.openstreetmap.org${supabaseOrigin ? ` ${supabaseOrigin}` : ''}`,
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const isHttps = (req) => process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'https';

function securityHeaders(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy());
  if (isHttps(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': MIME['.json'],
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJson(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) {
        reject(new ValidationError('request too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        resolve(parsed);
      } catch {
        reject(new ValidationError('invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------

async function handleApi(req, res, url) {
  const store = await storeReady;
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'bathrooms', id?, 'reviews'?]

  if (parts[1] === 'health') return send(res, 200, { ok: true });

  // GET /api/config  (public settings the apps need to sign in with Supabase)
  if (parts[1] === 'config' && req.method === 'GET') {
    return send(res, 200, {
      auth: supabase.publicConfig(),
      contactEmail: process.env.CONTACT_EMAIL || null,
      rules: { visitRadiusM: VISIT_RADIUS_M, reviewWindowHours: REVIEW_WINDOW_HOURS },
    });
  }

  if (parts[1] === 'me') return handleMe(req, res, store, parts);

  // GET /api/character  (the closet: items, what unlocks them, colors, levels)
  if (parts[1] === 'character' && req.method === 'GET') return send(res, 200, character.catalog());

  // GET /api/visits  (restrooms and places you were near recently, so you can still rate them)
  if (parts[1] === 'visits' && req.method === 'GET') {
    const user = await requireUser(req);
    const keys = await store.listVisits(user.id, hoursAgo(REVIEW_WINDOW_HOURS));
    return send(res, 200, {
      restroomIds: keys.filter((k) => k.startsWith('r:')).map((k) => k.slice(2)),
      osmIds: keys.filter((k) => k.startsWith('osm:')).map((k) => k.slice(4)),
    });
  }

  // POST /api/visits  { lat, lng, accuracy, restroomIds: [], places: [{ osmId, lat, lng }] }
  // The app reports which restrooms you're near while it's open, so you can rate them later that day.
  if (parts[1] === 'visits' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!allowVisitPing(req)) return send(res, 429, { error: 'Too many location updates.' });
    const body = await readJson(req);
    const here = position(body);
    if (!here) throw new ValidationError('invalid position');
    const keys = [];
    for (const id of Array.isArray(body.restroomIds) ? body.restroomIds.slice(0, 50) : []) {
      const point = typeof id === 'string' && (await store.getRestroomPoint(id));
      if (point && isNear(here, point)) keys.push(...restroomKeys(point));
    }
    for (const p of Array.isArray(body.places) ? body.places.slice(0, 100) : []) {
      const at = position(p);
      let id = null;
      try {
        id = osmId(p?.osmId);
      } catch {
        // skip malformed ids
      }
      if (id && at && isNear(here, at)) keys.push(`osm:${id}`);
    }
    if (keys.length) await store.recordVisits(user.id, [...new Set(keys)], hoursAgo(VISIT_KEEP_HOURS));
    return send(res, 200, { recorded: new Set(keys).size });
  }

  // GET /api/avatars/:userId
  if (parts[1] === 'avatars' && parts.length === 3 && req.method === 'GET') {
    const avatar = await store.getAvatar(parts[2]);
    if (!avatar) return send(res, 404, { error: 'not found' });
    res.writeHead(200, {
      'Content-Type': avatar.type === 'image/png' ? 'image/png' : 'image/jpeg',
      'Content-Length': avatar.data.length,
      'Cache-Control': 'public, max-age=86400',
      'Content-Security-Policy': "default-src 'none'",
    });
    return res.end(avatar.data);
  }

  // POST /api/reviews/:id/report  { reason }
  if (parts[1] === 'reviews' && parts.length === 4 && parts[3] === 'report' && req.method === 'POST') {
    const user = await requireUser(req);
    if (!allowWrite(req)) return send(res, 429, { error: 'Too many reports. Please try again in a few minutes.' });
    const { reason } = await readJson(req);
    if (!Object.hasOwn(REPORT_REASONS, reason)) throw new ValidationError('Choose a reason for the report.');
    const result = await store.reportReview(parts[2], user.id, reason, HIDE_AFTER_REPORTS);
    if (!result) return send(res, 404, { error: 'review not found' });
    if (result.own) return send(res, 400, { error: "You can't report your own review. You can delete it instead." });
    return send(res, 200, { ok: true, hidden: result.hidden });
  }

  // DELETE /api/reviews/:id  (your own review)
  if (parts[1] === 'reviews' && parts.length === 3 && req.method === 'DELETE') {
    const user = await requireUser(req);
    const deleted = await store.deleteReview(parts[2], user.id);
    return deleted ? send(res, 200, { ok: true }) : send(res, 404, { error: 'review not found' });
  }

  // GET /api/places?south=&west=&north=&east=  (businesses and mapped restrooms from OpenStreetMap)
  if (parts[1] === 'places' && parts.length === 2 && req.method === 'GET') {
    if (!allowPlacesLookup(req)) return send(res, 429, { error: 'Too many map requests. Please slow down.' });
    const bbox = parseBbox(url.searchParams);
    if (bbox === undefined) return send(res, 400, { error: 'invalid area' });
    if (bbox === null) return send(res, 200, { places: [], zoomIn: true });
    try {
      return send(res, 200, { places: await fetchPlaces(bbox), zoomIn: false });
    } catch (err) {
      console.error('Places lookup failed:', err.message);
      return send(res, 502, { error: 'Nearby places are unavailable right now.' });
    }
  }

  if (parts[1] !== 'bathrooms') return send(res, 404, { error: 'not found' });

  let profile = null;
  let reviewsBefore = 0;
  if (req.method === 'POST') {
    ({ profile } = await requirePoster(store, req));
    reviewsBefore = await store.countUserReviews(profile.id);
    if (!allowWrite(req)) return send(res, 429, { error: 'Too many submissions. Please try again in a few minutes.' });
  }

  // GET /api/bathrooms?q=&type=&minRating=&sort=
  if (parts.length === 2 && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const type = url.searchParams.get('type') || '';
    const minRating = Number(url.searchParams.get('minRating')) || 0;
    const sort = url.searchParams.get('sort') || 'rating';

    let list = (await store.list()).filter((b) => {
      if (type && b.type !== type) return false;
      if (minRating && (b.rating ?? 0) < minRating) return false;
      if (q && ![b.name, b.address, b.city, b.country].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });

    const sorters = {
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.reviewCount - a.reviewCount,
      reviews: (a, b) => b.reviewCount - a.reviewCount,
      newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
      worst: (a, b) => (a.rating ?? 6) - (b.rating ?? 6),
    };
    list.sort(sorters[sort] || sorters.rating);
    return send(res, 200, { bathrooms: list, types: PLACE_TYPES });
  }

  // POST /api/bathrooms  (optionally with a first review)
  if (parts.length === 2 && req.method === 'POST') {
    const body = await readJson(req);
    const bathroom = validateBathroom(body);
    const review = body.review ? validateReview(body.review, profile) : null;
    const here = position(body.here);
    // A place from the map that someone already rated: add the review to that restroom instead.
    const existingId = bathroom.osmId && (await store.findIdByOsmId(bathroom.osmId));
    if (existingId) {
      const point = await store.getRestroomPoint(existingId);
      await requirePresence(store, profile.id, point, restroomKeys(point), here);
      if (review) await store.addReview(existingId, review);
      const rewards = await rewardsAfter(store, profile.id, reviewsBefore);
      return send(res, 200, { ...(await store.get(existingId)), rewards });
    }
    // A brand-new restroom: you have to be there (or have been near this map place today).
    await requirePresence(store, profile.id, bathroom, bathroom.osmId ? [`osm:${bathroom.osmId}`] : [], here);
    const created = await store.addRestroom(bathroom, review);
    await store.recordVisits(profile.id, restroomKeys(bathroom), hoursAgo(VISIT_KEEP_HOURS));
    const rewards = await rewardsAfter(store, profile.id, reviewsBefore);
    return send(res, 201, { ...created, rewards });
  }

  // GET /api/bathrooms/:id
  if (parts.length === 3 && req.method === 'GET') {
    const bathroom = await store.get(parts[2]);
    return bathroom ? send(res, 200, bathroom) : send(res, 404, { error: 'bathroom not found' });
  }

  // POST /api/bathrooms/:id/reviews
  if (parts.length === 4 && parts[3] === 'reviews' && req.method === 'POST') {
    const point = await store.getRestroomPoint(parts[2]);
    if (!point) return send(res, 404, { error: 'bathroom not found' });
    const body = await readJson(req);
    await requirePresence(store, profile.id, point, restroomKeys(point), position(body.here));
    const review = await store.addReview(parts[2], validateReview(body, profile));
    if (!review) return send(res, 404, { error: 'bathroom not found' });
    return send(res, 201, { ...review, rewards: await rewardsAfter(store, profile.id, reviewsBefore) });
  }

  return send(res, 405, { error: 'method not allowed' });
}

// ---------- static files ----------

const LEGAL_PAGES = new Set(['terms.html', 'privacy.html']);
const escapeHtml = (v) => v.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Puts the contact email (CONTACT_EMAIL) into the Terms and Privacy Policy. */
function fillLegalPage(html) {
  const email = (process.env.CONTACT_EMAIL || '').trim();
  if (/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(email)) return html.replaceAll('{{CONTACT_EMAIL}}', escapeHtml(email));
  // No contact email set yet: show plain text instead of a broken link.
  return html
    .replace(/<a href="mailto:\{\{CONTACT_EMAIL\}\}">\{\{CONTACT_EMAIL\}\}<\/a>/g, 'the contact email shown in the app')
    .replaceAll('{{CONTACT_EMAIL}}', '');
}

function serveStatic(req, res, url) {
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel === '/') rel = '/index.html';
  if (rel === '/terms' || rel === '/privacy') rel += '.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': file.includes(`${path.sep}vendor${path.sep}`) ? 'public, max-age=604800' : 'no-cache',
    });
    res.end(LEGAL_PAGES.has(path.basename(file)) ? fillLegalPage(data.toString('utf8')) : data);
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    securityHeaders(req, res);
    // Behind a proxy that terminates TLS (e.g. Render), send plain-HTTP visitors to HTTPS.
    const host = req.headers.host || '';
    if (process.env.TRUST_PROXY && req.headers['x-forwarded-proto'] === 'http' && /^[a-z0-9.-]+(:\d+)?$/i.test(host)) {
      res.writeHead(308, { Location: `https://${host}${req.url}` }).end();
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    if (err instanceof HttpError) return send(res, err.status, { error: err.message, ...(err.code && { code: err.code }) });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`ToiletTime running at http://localhost:${PORT}`));
}

module.exports = { server, storeReady, PLACE_TYPES, isUuid };
