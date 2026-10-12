// Draws people's characters on the website, using the same drawing code as the app
// (built from mobile/src/character/draw.ts with `npm run build:character`).
import { characterSvg } from './vendor/character/draw.js';

window.characterSvg = characterSvg;
window.dispatchEvent(new Event('characters-ready'));
