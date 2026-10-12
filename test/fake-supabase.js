// A stand-in for Supabase Auth, good enough for tests and local browser checks: email/password
// sign-up with emailed codes, sign-in, password reset, the user endpoint and admin deletion.
const crypto = require('node:crypto');
const http = require('node:http');

const SECRET = 'test-secret-key';
const PUBLIC = 'test-public-key';

function startFakeSupabase() {
  const users = new Map(); // id -> { id, email, password, confirmed }
  const tokens = new Map(); // access token -> user id
  const refreshTokens = new Map(); // refresh token -> user id
  const codes = new Map(); // `${type}:${email}` -> code
  const deleted = [];
  const outbox = []; // emails "sent": { to, type, code }

  const userJson = (u) => ({
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: u.confirmed ? u.confirmedAt : null,
    confirmed_at: u.confirmed ? u.confirmedAt : null,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    created_at: u.createdAt,
    updated_at: u.createdAt,
  });
  const session = (u) => {
    const access = `access-${crypto.randomUUID()}`;
    const refresh = `refresh-${crypto.randomUUID()}`;
    tokens.set(access, u.id);
    refreshTokens.set(refresh, u.id);
    return {
      access_token: access,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refresh,
      user: userJson(u),
    };
  };
  const sendCode = (type, email) => {
    const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
    codes.set(`${type}:${email}`, code);
    outbox.push({ to: email, type, code });
    return code;
  };
  const byEmail = (email) => [...users.values()].find((u) => u.email === String(email || '').toLowerCase());
  const bearerUser = (req) => users.get(tokens.get((req.headers.authorization || '').replace(/^Bearer /, '')));

  const server = http.createServer((req, res) => {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'x-supabase-api-version': '2024-01-01',
    };
    const json = (status, body) => res.writeHead(status, headers).end(JSON.stringify(body));
    const fail = (status, code, msg) => json(status, { code, error_code: code, msg, message: msg });
    if (req.method === 'OPTIONS') return res.writeHead(204, headers).end();

    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      const url = new URL(req.url, 'http://x');
      const route = `${req.method} ${url.pathname}`;
      const isAdmin = req.headers.apikey === SECRET;
      if (req.headers.apikey !== PUBLIC && !isAdmin) return fail(401, 'no_authorization', 'Invalid API key');

      if (route === 'GET /auth/v1/settings') return json(200, { external: { email: true, google: false, apple: false } });

      if (route === 'POST /auth/v1/signup') {
        const email = String(body.email || '').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(400, 'email_address_invalid', 'Invalid email');
        if (String(body.password || '').length < 8) return fail(422, 'weak_password', 'Password should be at least 8 characters.');
        if (byEmail(email)) return fail(422, 'user_already_exists', 'User already registered');
        const u = { id: crypto.randomUUID(), email, password: body.password, confirmed: false, createdAt: new Date().toISOString() };
        users.set(u.id, u);
        sendCode('signup', email);
        return json(200, userJson(u));
      }

      if (route === 'POST /auth/v1/resend') {
        if (byEmail(body.email)) sendCode('signup', body.email.toLowerCase());
        return json(200, {});
      }

      if (route === 'POST /auth/v1/recover') {
        if (byEmail(body.email)) sendCode('recovery', body.email.toLowerCase());
        return json(200, {});
      }

      if (route === 'POST /auth/v1/verify') {
        const email = String(body.email || '').toLowerCase();
        const kind = body.type === 'recovery' ? 'recovery' : 'signup';
        const u = byEmail(email);
        if (!u || codes.get(`${kind}:${email}`) !== body.token) return fail(403, 'otp_expired', 'Token has expired or is invalid');
        codes.delete(`${kind}:${email}`);
        if (!u.confirmed) Object.assign(u, { confirmed: true, confirmedAt: new Date().toISOString() });
        return json(200, session(u));
      }

      if (route === 'POST /auth/v1/token') {
        const grant = url.searchParams.get('grant_type');
        if (grant === 'refresh_token') {
          const u = users.get(refreshTokens.get(body.refresh_token));
          return u ? json(200, session(u)) : fail(400, 'refresh_token_not_found', 'Invalid Refresh Token');
        }
        const u = byEmail(body.email);
        if (!u || u.password !== body.password) return fail(400, 'invalid_credentials', 'Invalid login credentials');
        if (!u.confirmed) return fail(400, 'email_not_confirmed', 'Email not confirmed');
        return json(200, session(u));
      }

      if (route === 'GET /auth/v1/user') {
        const u = bearerUser(req);
        return u ? json(200, userJson(u)) : fail(401, 'bad_jwt', 'invalid JWT');
      }

      if (route === 'PUT /auth/v1/user') {
        const u = bearerUser(req);
        if (!u) return fail(401, 'bad_jwt', 'invalid JWT');
        if (body.password !== undefined) {
          if (String(body.password).length < 8) return fail(422, 'weak_password', 'Password should be at least 8 characters.');
          if (body.password === u.password) return fail(422, 'same_password', 'New password should be different.');
          u.password = body.password;
        }
        return json(200, userJson(u));
      }

      if (route === 'POST /auth/v1/logout') {
        tokens.delete((req.headers.authorization || '').replace(/^Bearer /, ''));
        return res.writeHead(204, headers).end();
      }

      const admin = /^DELETE \/auth\/v1\/admin\/users\/([\w-]+)$/.exec(route);
      if (admin) {
        if (!isAdmin) return fail(401, 'not_admin', 'User not allowed');
        deleted.push(admin[1]);
        users.delete(admin[1]);
        for (const [t, id] of tokens) if (id === admin[1]) tokens.delete(t);
        return json(200, {});
      }

      fail(404, 'not_found', `No route ${route}`);
    });
  });

  return {
    server,
    deleted,
    outbox,
    /** Creates a user directly and returns an access token for them. */
    addUser({ verified = true, email } = {}) {
      const u = {
        id: crypto.randomUUID(),
        email: email || `user${users.size + 1}-${Date.now()}@example.com`,
        password: 'longpassword1',
        confirmed: verified,
        confirmedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      users.set(u.id, u);
      const token = `access-${crypto.randomUUID()}`;
      tokens.set(token, u.id);
      return { id: u.id, token };
    },
    verify(token) {
      const u = users.get(tokens.get(token));
      Object.assign(u, { confirmed: true, confirmedAt: new Date().toISOString() });
    },
    /** The latest code emailed to an address. */
    lastCode: (email) => [...outbox].reverse().find((m) => m.to === email.toLowerCase())?.code,
    async listen(port = 0) {
      await new Promise((r) => server.listen(port, '127.0.0.1', r));
      process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
      process.env.SUPABASE_ANON_KEY = PUBLIC;
      process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

module.exports = { startFakeSupabase, PUBLIC, SECRET };

// Run directly to get a fake Supabase for trying the apps locally: node test/fake-supabase.js [port]
if (require.main === module) {
  const fake = startFakeSupabase();
  fake.listen(Number(process.argv[2]) || 54321).then(() => {
    console.log(`Fake Supabase on ${process.env.SUPABASE_URL} (public key: ${PUBLIC}, secret key: ${SECRET})`);
    setInterval(() => {
      while (fake.outbox.length) {
        const m = fake.outbox.shift();
        console.log(`[email] ${m.type} code for ${m.to}: ${m.code}`);
      }
    }, 500);
  });
}
