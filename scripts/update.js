// Updates this folder to the latest ToiletTime from GitHub (for copies downloaded as a ZIP).
// Your saved data (data/db.json) and installed packages are kept.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BRANCH = 'claude/bathroom-rating-app-oqhyn0';
const ZIP_URL = `https://github.com/jake4759/ToiletTime/archive/refs/heads/${BRANCH}.zip`;
const root = path.join(__dirname, '..');
const KEEP = new Set(['node_modules', '.git', '.expo']);

/** Extracts a .zip with whatever the system has: tar (Windows 10+, macOS), PowerShell, or unzip. */
function unzip(file, dest) {
  const attempts = [
    ['tar', ['-xf', file, '-C', dest]],
    ['powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${file}' -DestinationPath '${dest}' -Force`]],
    ['unzip', ['-q', '-o', file, '-d', dest]],
  ];
  for (const [cmd, args] of attempts) {
    try {
      execFileSync(cmd, args, { stdio: 'ignore' });
      return;
    } catch {
      // try the next tool
    }
  }
  throw new Error('Could not unpack the download. Download the ZIP from GitHub manually instead.');
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'toilettime-update-'));
  const zip = path.join(work, 'update.zip');

  console.log('Downloading the latest version...');
  const res = await fetch(ZIP_URL);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

  console.log('Unpacking...');
  unzip(zip, work);
  const top = fs.readdirSync(work).find((n) => fs.statSync(path.join(work, n)).isDirectory());
  if (!top) throw new Error('The download was empty.');

  console.log('Copying new files into this folder...');
  const src = path.join(work, top);
  for (const name of fs.readdirSync(src)) {
    if (KEEP.has(name)) continue;
    fs.cpSync(path.join(src, name), path.join(root, name), { recursive: true, force: true });
  }
  fs.rmSync(work, { recursive: true, force: true });

  console.log('Installing anything new (this can take a minute)...');
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(`${npm} run setup`, { cwd: root, stdio: 'inherit', shell: true });

  console.log('\nUpdated! Start the app with:  npm run phone');
})().catch((err) => {
  console.error(`\nUpdate failed: ${err.message}`);
  process.exit(1);
});
