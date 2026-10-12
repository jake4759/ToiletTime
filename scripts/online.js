// Runs the iPhone app against the hosted server, reachable from any network (Expo tunnel).
// Usage: npm run phone:online [-- https://your-server.onrender.com]
const { spawn } = require('node:child_process');
const path = require('node:path');

const eas = require('../mobile/eas.json');
const url = (process.argv[2] || eas.build.production.env.EXPO_PUBLIC_API_URL).replace(/\/+$/, '');

console.log(`Using the ToiletTime server at ${url}\n`);
const child = spawn('npx expo start --tunnel', {
  cwd: path.join(__dirname, '..', 'mobile'),
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_API_URL: url },
});
child.on('exit', (code) => process.exit(code ?? 0));
process.on('SIGINT', () => child.kill('SIGINT'));
