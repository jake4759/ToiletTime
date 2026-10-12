// Starts the API server and the Expo dev server together so the iPhone app can connect.
const { spawn } = require('node:child_process');
const path = require('node:path');

const root = path.join(__dirname, '..');
const children = [
  spawn(process.execPath, ['server.js'], { cwd: root, stdio: 'inherit' }),
  spawn('npx', ['expo', 'start', ...process.argv.slice(2)], {
    cwd: path.join(root, 'mobile'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }),
];

const stop = () => children.forEach((c) => c.kill());
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((c) => c.on('exit', (code) => { stop(); process.exitCode = code ?? 0; }));
