// ToiletTime — a tiny zero-dependency server for rating bathrooms worldwide.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const SEED_FILE = path.join(__dirname, 'data', 'seed.json');
const MAX_BODY = 32 * 1024;

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

// ---------- storage ----------

function loadDb() {
  for (const file of [DB_FILE, SEED_FILE]) {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return { bathrooms: [] };
}

let db = loadDb();

function saveDb() {
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- helpers ----------

function summarize(b) {
  const n = b.reviews.length;
  const avg = (key) => (n ? round1(b.reviews.reduce((s, r) => s + r[key], 0) / n) : null);
  return {
    id: b.id,
    name: b.name,
    type: b.type,
    address: b.address,
    city: b.city,
    country: b.country,
    lat: b.lat,
    lng: b.lng,
    accessible: b.accessible,
    free: b.free,
    babyChanging: b.babyChanging,
    createdAt: b.createdAt,
    reviewCount: n,
    rating: avg('overall'),
    cleanliness: avg('cleanliness'),
    supplies: avg('supplies'),
    privacy: avg('privacy'),
  };
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

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

function validateReview(body) {
  return {
    id: crypto.randomUUID(),
    author: str(body.author, 40) || 'Anonymous',
    overall: stars(body.overall, 'overall'),
    cleanliness: stars(body.cleanliness, 'cleanliness'),
    supplies: stars(body.supplies, 'supplies'),
    privacy: stars(body.privacy, 'privacy'),
    comment: str(body.comment, 1000),
    createdAt: new Date().toISOString(),
  };
}

function validateBathroom(body) {
  const type = PLACE_TYPES.includes(body.type) ? body.type : 'other';
  return {
    id: crypto.randomUUID(),
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
    reviews: [],
  };
}

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
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
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'bathrooms', id?, 'reviews'?]

  if (parts[1] !== 'bathrooms') return send(res, 404, { error: 'not found' });

  // GET /api/bathrooms?q=&type=&minRating=&sort=
  if (parts.length === 2 && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').toLowerCase();
    const type = url.searchParams.get('type') || '';
    const minRating = Number(url.searchParams.get('minRating')) || 0;
    const sort = url.searchParams.get('sort') || 'rating';

    let list = db.bathrooms.map(summarize).filter((b) => {
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
    if (body.review) bathroom.reviews.push(validateReview(body.review));
    db.bathrooms.push(bathroom);
    saveDb();
    return send(res, 201, { ...summarize(bathroom), reviews: bathroom.reviews });
  }

  const bathroom = db.bathrooms.find((b) => b.id === parts[2]);
  if (!bathroom) return send(res, 404, { error: 'bathroom not found' });

  // GET /api/bathrooms/:id
  if (parts.length === 3 && req.method === 'GET') {
    const reviews = [...bathroom.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return send(res, 200, { ...summarize(bathroom), reviews });
  }

  // POST /api/bathrooms/:id/reviews
  if (parts.length === 4 && parts[3] === 'reviews' && req.method === 'POST') {
    const review = validateReview(await readJson(req));
    bathroom.reviews.push(review);
    saveDb();
    return send(res, 201, review);
  }

  return send(res, 405, { error: 'method not allowed' });
}

// ---------- static files ----------

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
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
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- server ----------

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method not allowed' });
    serveStatic(req, res, url);
  } catch (err) {
    if (err instanceof ValidationError) return send(res, 400, { error: err.message });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal error' });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`🚽 ToiletTime running at http://localhost:${PORT}`));
}

module.exports = { server, PLACE_TYPES };
