// Connects ToiletTime to your Supabase project by saving its keys in a .env file next to server.js.
// Run with: npm run configure
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');

const ENV_FILE = path.join(__dirname, '..', '.env');

function readEnv() {
  const env = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
    }
  } catch {
    // no .env yet
  }
  return env;
}

(async () => {
  // Queue typed (or pasted) lines so none are lost between questions.
  const rl = readline.createInterface({ input: process.stdin });
  const lines = [];
  const waiting = [];
  let ended = false;
  rl.on('line', (line) => (waiting.length ? waiting.shift()(line) : lines.push(line)));
  rl.on('close', () => {
    ended = true;
    while (waiting.length) waiting.shift()('');
  });
  const nextLine = () => (lines.length ? Promise.resolve(lines.shift()) : ended ? Promise.resolve('') : new Promise((r) => waiting.push(r)));

  const env = readEnv();
  const ask = async (question, key, { optional = false } = {}) => {
    const current = env[key];
    const hint = current ? ` [press Enter to keep the current one]` : optional ? ' [optional, press Enter to skip]' : '';
    process.stdout.write(`${question}${hint}\n> `);
    const answer = (await nextLine()).trim();
    if (answer) env[key] = answer;
    console.log('');
  };

  console.log('\nConnect ToiletTime to Supabase');
  console.log('==============================');
  console.log('In your Supabase project, open Project Settings, then "API Keys" and "Data API".\n');

  await ask('1. Project URL (looks like https://abcdefgh.supabase.co):', 'SUPABASE_URL');
  await ask('2. Publishable key (or the legacy "anon public" key):', 'SUPABASE_ANON_KEY');
  await ask('3. Secret key (or the legacy "service_role" key). Keep this private:', 'SUPABASE_SERVICE_ROLE_KEY');
  await ask(
    '4. Database connection string, to keep ratings in Supabase too.\n   (Project > Connect > "Session pooler" URI, with your database password filled in)',
    'DATABASE_URL',
    { optional: true },
  );
  rl.close();

  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
    console.log('The Project URL and publishable key are required. Nothing was saved.');
    process.exit(1);
  }
  env.SUPABASE_URL = env.SUPABASE_URL.replace(/\/+$/, '');

  process.stdout.write('Checking the connection... ');
  try {
    const res = await fetch(`${env.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: env.SUPABASE_ANON_KEY } });
    if (!res.ok) throw new Error(`Supabase answered ${res.status}. Double-check the URL and publishable key.`);
    const settings = await res.json();
    const on = Object.entries(settings.external || {}).filter(([, v]) => v === true).map(([k]) => k);
    console.log(`connected. Sign-in methods turned on: ${on.join(', ') || 'none yet'}.`);
  } catch (err) {
    console.log(`\nCouldn't reach Supabase: ${err.message}`);
    console.log('Saving anyway; you can run this again to fix it.');
  }

  const output = Object.entries(env).map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_FILE, `# ToiletTime settings (keep this file private; it is not uploaded to GitHub)\n${output.join("\n")}\n`);
  console.log(`\nSaved to ${ENV_FILE}. Restart ToiletTime to use it.`);
})();
