// Your ToiletTime character ("Flush Buddy"): the closet of items, what unlocks them, and levels.
// Items unlock by the number of restrooms you've reviewed. The app draws each item by its id.

const COLORS = {
  hair: ['#2b1d16', '#5a3825', '#a0632f', '#e0b45a', '#d2483b', '#9aa0a6', '#f4f1ea', '#3f6fd8', '#e05aa8', '#3fb37f'],
  clothes: ['#0f3d3e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#334155', '#f8fafc'],
  /** The circle behind your character on the map. */
  background: ['#cfe8df', '#dbeafe', '#e9d5ff', '#fbcfe8', '#fecaca', '#fed7aa', '#fef08a', '#bbf7d0', '#e2e8f0', '#ffffff'],
};

/** slot -> list of items. `unlock` is how many restrooms you must have reviewed. */
const SLOTS = {
  skin: {
    label: 'Skin',
    items: [
      { id: 'skin1', name: 'Light', unlock: 0 },
      { id: 'skin2', name: 'Fair', unlock: 0 },
      { id: 'skin3', name: 'Tan', unlock: 0 },
      { id: 'skin4', name: 'Brown', unlock: 0 },
      { id: 'skin5', name: 'Deep', unlock: 0 },
    ],
  },
  hair: {
    label: 'Hair',
    color: 'hair',
    items: [
      { id: 'short', name: 'Short', unlock: 0 },
      { id: 'long', name: 'Long', unlock: 0 },
      { id: 'curly', name: 'Curly', unlock: 0 },
      { id: 'bun', name: 'Bun', unlock: 0 },
      { id: 'none', name: 'Bald', unlock: 0 },
      { id: 'spiky', name: 'Spiky', unlock: 2 },
      { id: 'mohawk', name: 'Mohawk', unlock: 6 },
    ],
  },
  hat: {
    label: 'Hats',
    items: [
      { id: 'none', name: 'No hat', unlock: 0 },
      { id: 'cap', name: 'Baseball Cap', unlock: 1 },
      { id: 'beanie', name: 'Beanie', unlock: 2 },
      { id: 'party', name: 'Party Hat', unlock: 4 },
      { id: 'cowboy', name: 'Cowboy Hat', unlock: 6 },
      { id: 'tophat', name: 'Top Hat', unlock: 9 },
      { id: 'crown', name: 'Crown', unlock: 12 },
      { id: 'tpcrown', name: 'TP Tiara', unlock: 20 },
    ],
  },
  glasses: {
    label: 'Glasses',
    items: [
      { id: 'none', name: 'None', unlock: 0 },
      { id: 'round', name: 'Round Glasses', unlock: 0 },
      { id: 'shades', name: 'Sunglasses', unlock: 3 },
      { id: 'stars', name: 'Star Shades', unlock: 7 },
    ],
  },
  top: {
    label: 'Tops',
    color: 'clothes',
    items: [
      { id: 'tshirt', name: 'T-Shirt', unlock: 0 },
      { id: 'hoodie', name: 'Hoodie', unlock: 1 },
      { id: 'stripes', name: 'Striped Tee', unlock: 3 },
      { id: 'overalls', name: 'Overalls', unlock: 5 },
      { id: 'tux', name: 'Tuxedo', unlock: 10 },
      { id: 'hero', name: 'Superhero Suit', unlock: 15 },
    ],
  },
  bottom: {
    label: 'Bottoms',
    color: 'clothes',
    items: [
      { id: 'jeans', name: 'Jeans', unlock: 0 },
      { id: 'shorts', name: 'Shorts', unlock: 0 },
      { id: 'skirt', name: 'Skirt', unlock: 0 },
      { id: 'joggers', name: 'Joggers', unlock: 2 },
    ],
  },
  shoes: {
    label: 'Shoes',
    items: [
      { id: 'sneakers', name: 'Sneakers', unlock: 0 },
      { id: 'slides', name: 'Slides', unlock: 1 },
      { id: 'boots', name: 'Boots', unlock: 3 },
      { id: 'rainbow', name: 'Rainbow Kicks', unlock: 8 },
    ],
  },
  held: {
    label: 'Extras',
    items: [
      { id: 'none', name: 'Nothing', unlock: 0 },
      { id: 'tp', name: 'Toilet Paper', unlock: 1 },
      { id: 'duck', name: 'Rubber Duck', unlock: 4 },
      { id: 'plunger', name: 'Plunger', unlock: 5 },
      { id: 'map', name: 'Restroom Map', unlock: 8 },
      { id: 'goldplunger', name: 'Golden Plunger', unlock: 25 },
    ],
  },
};

const LEVELS = [
  { min: 0, name: 'Newbie' },
  { min: 1, name: 'First Flush' },
  { min: 3, name: 'Regular' },
  { min: 5, name: 'Throne Scout' },
  { min: 10, name: 'Porcelain Pro' },
  { min: 25, name: 'Royal Flush' },
];

const DEFAULT_CHARACTER = {
  skin: 'skin2',
  hair: 'short',
  hairColor: COLORS.hair[1],
  hat: 'none',
  glasses: 'none',
  top: 'tshirt',
  topColor: COLORS.clothes[0],
  bottom: 'jeans',
  bottomColor: COLORS.clothes[1],
  shoes: 'sneakers',
  held: 'none',
  bgColor: COLORS.background[0],
};

const item = (slot, id) => SLOTS[slot]?.items.find((i) => i.id === id);

function levelFor(count) {
  let level = LEVELS[0];
  for (const l of LEVELS) if (count >= l.min) level = l;
  const next = LEVELS.find((l) => l.min > count) || null;
  return { name: level.name, next: next && { name: next.name, at: next.min } };
}

/** The next item(s) you'll unlock, to show as a goal. */
function nextUnlock(count) {
  const upcoming = Object.entries(SLOTS)
    .flatMap(([slot, s]) => s.items.map((i) => ({ slot, ...i })))
    .filter((i) => i.unlock > count)
    .sort((a, b) => a.unlock - b.unlock);
  if (!upcoming.length) return null;
  const at = upcoming[0].unlock;
  return { at, items: upcoming.filter((i) => i.unlock === at).map(({ slot, id, name }) => ({ slot, id, name })) };
}

/** Items that unlocked when the review count went from `before` to `after`. */
function newlyUnlocked(before, after) {
  return Object.entries(SLOTS).flatMap(([slot, s]) =>
    s.items.filter((i) => i.unlock > before && i.unlock <= after).map(({ id, name }) => ({ slot, id, name })),
  );
}

/** Fills gaps with defaults and swaps out anything not (or no longer) unlocked. */
function sanitize(character, count) {
  const out = { ...DEFAULT_CHARACTER };
  const c = character && typeof character === 'object' ? character : {};
  for (const slot of Object.keys(SLOTS)) {
    const it = item(slot, c[slot]);
    if (it && it.unlock <= count) out[slot] = it.id;
  }
  if (COLORS.hair.includes(c.hairColor)) out.hairColor = c.hairColor;
  if (COLORS.clothes.includes(c.topColor)) out.topColor = c.topColor;
  if (COLORS.clothes.includes(c.bottomColor)) out.bottomColor = c.bottomColor;
  if (COLORS.background.includes(c.bgColor)) out.bgColor = c.bgColor;
  return out;
}

/** Validates a character someone wants to save. Throws a readable message if something isn't allowed. */
function validate(character, count) {
  if (!character || typeof character !== 'object' || Array.isArray(character)) throw new Error('invalid character');
  for (const slot of Object.keys(SLOTS)) {
    if (character[slot] === undefined) continue;
    const it = item(slot, character[slot]);
    if (!it) throw new Error(`Unknown ${SLOTS[slot].label.toLowerCase()} item.`);
    if (it.unlock > count) {
      throw new Error(`${it.name} unlocks after reviewing ${it.unlock} restroom${it.unlock === 1 ? '' : 's'}.`);
    }
  }
  for (const [key, palette] of [['hairColor', COLORS.hair], ['topColor', COLORS.clothes], ['bottomColor', COLORS.clothes], ['bgColor', COLORS.background]]) {
    if (character[key] !== undefined && !palette.includes(character[key])) throw new Error('invalid color');
  }
  return sanitize(character, count);
}

const catalog = () => ({ slots: SLOTS, colors: COLORS, levels: LEVELS, defaults: DEFAULT_CHARACTER });

module.exports = { catalog, sanitize, validate, levelFor, nextUnlock, newlyUnlocked, DEFAULT_CHARACTER };
