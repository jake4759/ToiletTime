// Accounts are handled by Supabase Auth (sign-up, email verification, password resets, Apple and
// Google sign-in, sessions). The server only checks the access token each request carries, and uses
// the secret key to delete an account when its owner asks.
const crypto = require('node:crypto');

const config = () => ({
  url: (process.env.SUPABASE_URL || '').replace(/\/+$/, ''),
  // Public key that apps use to talk to Supabase (the "anon" or "publishable" key).
  publicKey: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY || '',
  // Secret key, only ever used on the server (the "service_role" or "secret" key).
  secretKey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '',
});

const isConfigured = () => {
  const c = config();
  return !!(c.url && c.publicKey);
};

/** Headers for a Supabase API key: new-style keys go only in `apikey`, legacy JWT keys in both. */
function keyHeaders(key, bearer) {
  const headers = { apikey: key };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  else if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

const CACHE_MS = 60 * 1000;
const cache = new Map(); // sha256(token) -> { at, user }

/**
 * Returns the Supabase user for an access token, or null if the token is invalid or expired.
 * Throws if Supabase can't be reached.
 */
async function getUser(token) {
  if (!isConfigured() || !token) return null;
  const key = crypto.createHash('sha256').update(token).digest('hex');
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.user;

  const { url, publicKey } = config();
  const res = await fetch(`${url}/auth/v1/user`, { headers: keyHeaders(publicKey, token) });
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`Supabase responded ${res.status}`);
  const u = await res.json();
  const user = {
    id: u.id,
    email: u.email || '',
    emailVerified: !!(u.email_confirmed_at || u.confirmed_at),
    provider: u.app_metadata?.provider || 'email',
  };
  // Only cache verified accounts, so a fresh email verification takes effect immediately.
  if (user.emailVerified) cache.set(key, { at: Date.now(), user });
  if (cache.size > 1000) cache.delete(cache.keys().next().value);
  return user;
}

/** Forget cached sign-ins for a user (after their account is deleted). */
function forgetUser(userId) {
  for (const [k, v] of cache) if (v.user?.id === userId) cache.delete(k);
}

/** Permanently deletes a Supabase account. Needs the secret key. */
async function deleteUser(userId) {
  const { url, secretKey } = config();
  if (!url || !secretKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: keyHeaders(secretKey),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Supabase responded ${res.status}`);
  forgetUser(userId);
}

/** What apps need to sign in directly with Supabase. Both values are public by design. */
function publicConfig() {
  if (!isConfigured()) return null;
  const { url, publicKey } = config();
  return { supabaseUrl: url, supabaseKey: publicKey };
}

module.exports = { getUser, deleteUser, publicConfig, isConfigured, config };
