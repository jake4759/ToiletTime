/**
 * Draws a ToiletTime character ("Flush Buddy") as a list of simple SVG shapes.
 * Kept free of React so the same drawing can be rendered in the app and in previews.
 * The body is drawn around x = 60; the picture is 148 wide (room for raised arms) and 182 tall.
 */
export const DEFAULT_CHARACTER = {
    skin: 'skin2',
    hair: 'short',
    hairColor: '#5a3825',
    hat: 'none',
    glasses: 'none',
    top: 'tshirt',
    topColor: '#0f3d3e',
    bottom: 'jeans',
    bottomColor: '#2563eb',
    shoes: 'sneakers',
    held: 'none',
    pose: 'stand',
    bgColor: '#cfe8df',
};
export const VIEW_WIDTH = 148;
export const VIEW_HEIGHT = 182;
export const VIEWBOX = `-14 -12 ${VIEW_WIDTH} ${VIEW_HEIGHT}`;
const SKIN = {
    skin1: '#fde3d0',
    skin2: '#f3c7a3',
    skin3: '#d8a070',
    skin4: '#a86b45',
    skin5: '#6b4128',
};
/** Darkens (amount < 0) or lightens (amount > 0) a #rrggbb color. */
export function shade(hex, amount) {
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
    const r = mix((n >> 16) & 255);
    const g = mix((n >> 8) & 255);
    const b = mix(n & 255);
    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}
const s = (t, p, c) => (c ? { t, p, c } : { t, p });
const OUTLINE = { stroke: 'rgba(0,0,0,0.18)', strokeWidth: 1 };
// Arms hang from the shoulders and swing by pose. Angles are degrees (SVG rotate):
// 0 is straight down, the left arm swings out with positive angles, the right with negative ones.
const SHOULDERS = { left: { x: 32, y: 86 }, right: { x: 88, y: 86 } };
const ARM_LENGTH = 34;
const POSES = {
    stand: { left: 10, right: -10 },
    wave: { left: 10, right: -155 },
    point: { left: 10, right: -90 },
    thumbsup: { left: 10, right: -125 },
    cheer: { left: 155, right: -155 },
    dance: { left: 125, right: -45, tilt: -6 },
    tada: { left: 115, right: -115 },
};
const poseOf = (c) => { var _a; return (_a = POSES[c.pose]) !== null && _a !== void 0 ? _a : POSES.stand; };
/** Where a hand ends up for an arm angle. */
function handAt(side, angle) {
    const a = (angle * Math.PI) / 180;
    const s0 = SHOULDERS[side];
    return { cx: +(s0.x - ARM_LENGTH * Math.sin(a)).toFixed(1), cy: +(s0.y + ARM_LENGTH * Math.cos(a)).toFixed(1) };
}
const hands0 = (c) => {
    const pose = poseOf(c);
    return { left: handAt('left', pose.left), right: handAt('right', pose.right) };
};
function defs() {
    return s('defs', {}, [
        s('linearGradient', { id: 'rainbow', x1: 0, y1: 0, x2: 1, y2: 0 }, [
            s('stop', { offset: '0', stopColor: '#ef4444' }),
            s('stop', { offset: '0.25', stopColor: '#f59e0b' }),
            s('stop', { offset: '0.5', stopColor: '#22c55e' }),
            s('stop', { offset: '0.75', stopColor: '#3b82f6' }),
            s('stop', { offset: '1', stopColor: '#a855f7' }),
        ]),
        s('linearGradient', { id: 'gold', x1: 0, y1: 0, x2: 0, y2: 1 }, [
            s('stop', { offset: '0', stopColor: '#fde68a' }),
            s('stop', { offset: '0.5', stopColor: '#f5c542' }),
            s('stop', { offset: '1', stopColor: '#b8860b' }),
        ]),
    ]);
}
// ---------- behind the body ----------
function back(c) {
    const out = [];
    if (c.top === 'hero') {
        const cape = c.topColor === '#dc2626' ? '#1d4ed8' : '#dc2626';
        out.push(s('path', { d: 'M40 84 Q60 78 80 84 L92 150 Q60 158 28 150 Z', fill: cape, ...OUTLINE }));
    }
    if (c.hair === 'long') {
        out.push(s('path', { d: 'M30 46 C30 14 90 14 90 46 L93 92 Q60 102 27 92 Z', fill: shade(c.hairColor, -0.12) }));
    }
    if (c.hair === 'curly') {
        for (const [cx, cy] of [[30, 60], [90, 60], [32, 72], [88, 72]]) {
            out.push(s('circle', { cx, cy, r: 8, fill: shade(c.hairColor, -0.12) }));
        }
    }
    return out;
}
// ---------- legs, bottoms, shoes ----------
function legs(c) {
    var _a;
    const skin = (_a = SKIN[c.skin]) !== null && _a !== void 0 ? _a : SKIN.skin2;
    const color = c.bottomColor;
    const out = [];
    const leg = (x, fill, y = 116, h = 34) => s('rect', { x, y, width: 14, height: h, rx: 5, fill, ...OUTLINE });
    if (c.bottom === 'jeans' || c.bottom === 'joggers') {
        out.push(leg(44, color), leg(62, color));
        out.push(s('rect', { x: 40, y: 110, width: 40, height: 12, rx: 5, fill: color }));
        if (c.bottom === 'jeans') {
            out.push(s('line', { x1: 51, y1: 124, x2: 51, y2: 148, stroke: shade(color, 0.35), strokeWidth: 1, strokeDasharray: '2 2' }));
            out.push(s('line', { x1: 69, y1: 124, x2: 69, y2: 148, stroke: shade(color, 0.35), strokeWidth: 1, strokeDasharray: '2 2' }));
        }
        else {
            out.push(s('rect', { x: 44, y: 142, width: 14, height: 6, rx: 3, fill: shade(color, -0.25) }));
            out.push(s('rect', { x: 62, y: 142, width: 14, height: 6, rx: 3, fill: shade(color, -0.25) }));
            out.push(s('line', { x1: 47, y1: 120, x2: 47, y2: 140, stroke: '#ffffff', strokeWidth: 1.5, opacity: 0.7 }));
            out.push(s('line', { x1: 73, y1: 120, x2: 73, y2: 140, stroke: '#ffffff', strokeWidth: 1.5, opacity: 0.7 }));
        }
    }
    else if (c.bottom === 'shorts') {
        out.push(leg(44, skin), leg(62, skin));
        out.push(s('path', { d: 'M40 110 H80 L79 132 H62 L60 122 L58 132 H41 Z', fill: color, ...OUTLINE }));
    }
    else {
        // skirt
        out.push(leg(44, skin), leg(62, skin));
        out.push(s('path', { d: 'M41 110 H79 L87 136 Q60 141 33 136 Z', fill: color, ...OUTLINE }));
        out.push(s('path', { d: 'M48 116 L44 136 M60 116 V139 M72 116 L76 136', stroke: shade(color, -0.2), strokeWidth: 1, fill: 'none' }));
    }
    return out;
}
function shoes(c) {
    var _a;
    const skin = (_a = SKIN[c.skin]) !== null && _a !== void 0 ? _a : SKIN.skin2;
    const out = [];
    for (const cx of [50, 70]) {
        if (c.shoes === 'boots') {
            out.push(s('rect', { x: cx - 8, y: 138, width: 16, height: 14, rx: 4, fill: '#7c4a25', ...OUTLINE }));
            out.push(s('ellipse', { cx: cx + 1, cy: 153, rx: 11, ry: 5, fill: '#5b3519' }));
        }
        else if (c.shoes === 'slides') {
            out.push(s('ellipse', { cx, cy: 153, rx: 10, ry: 5, fill: skin, ...OUTLINE }));
            out.push(s('rect', { x: cx - 9, y: 148, width: 18, height: 5, rx: 2.5, fill: c.topColor }));
            out.push(s('ellipse', { cx, cy: 157, rx: 11, ry: 2.5, fill: '#475569' }));
        }
        else {
            const fill = c.shoes === 'rainbow' ? 'url(#rainbow)' : '#ffffff';
            out.push(s('ellipse', { cx: cx + 1, cy: 153, rx: 11, ry: 6.5, fill, stroke: '#9ca3af', strokeWidth: 1 }));
            out.push(s('path', { d: `M${cx - 9} 155 Q${cx + 1} 160 ${cx + 11} 155`, stroke: '#9ca3af', strokeWidth: 2, fill: 'none' }));
            if (c.shoes === 'sneakers') {
                out.push(s('path', { d: `M${cx - 4} 150 L${cx + 4} 152`, stroke: c.topColor, strokeWidth: 2.5, strokeLinecap: 'round' }));
            }
        }
    }
    return out;
}
// ---------- torso and arms ----------
function torso(c) {
    const color = c.topColor;
    const out = [];
    const body = (fill) => s('rect', { x: 38, y: 80, width: 44, height: 40, rx: 14, fill, ...OUTLINE });
    switch (c.top) {
        case 'hoodie':
            out.push(s('ellipse', { cx: 60, cy: 82, rx: 18, ry: 7, fill: shade(color, -0.25) }));
            out.push(body(color));
            out.push(s('rect', { x: 47, y: 104, width: 26, height: 10, rx: 4, fill: shade(color, -0.15) }));
            out.push(s('path', { d: 'M56 84 V96 M64 84 V96', stroke: '#ffffff', strokeWidth: 1.5, strokeLinecap: 'round' }));
            break;
        case 'stripes':
            out.push(body(color));
            for (const y of [88, 98, 108])
                out.push(s('rect', { x: 39, y, width: 42, height: 4, fill: '#ffffff', opacity: 0.85 }));
            break;
        case 'overalls':
            out.push(body('#f8fafc'));
            out.push(s('rect', { x: 45, y: 92, width: 30, height: 28, rx: 6, fill: color, ...OUTLINE }));
            out.push(s('path', { d: 'M48 93 L45 81 M72 93 L75 81', stroke: color, strokeWidth: 4, strokeLinecap: 'round' }));
            out.push(s('circle', { cx: 49, cy: 95, r: 1.8, fill: '#facc15' }), s('circle', { cx: 71, cy: 95, r: 1.8, fill: '#facc15' }));
            out.push(s('rect', { x: 54, y: 100, width: 12, height: 8, rx: 2, fill: shade(color, -0.2) }));
            break;
        case 'tux':
            out.push(body('#1f2937'));
            out.push(s('path', { d: 'M51 80 L60 106 L69 80 Z', fill: '#ffffff' }));
            out.push(s('path', { d: 'M52 82 L59 86 L52 90 Z M68 82 L61 86 L68 90 Z', fill: color }));
            out.push(s('circle', { cx: 60, cy: 86, r: 2, fill: shade(color, -0.2) }));
            for (const y of [96, 103])
                out.push(s('circle', { cx: 60, cy: y, r: 1.3, fill: '#1f2937' }));
            break;
        case 'hero':
            out.push(body(color));
            out.push(s('circle', { cx: 60, cy: 98, r: 8, fill: '#facc15', ...OUTLINE }));
            out.push(s('path', { d: 'M55 94 H65 M60 94 V103', stroke: color, strokeWidth: 2.5, strokeLinecap: 'round' }));
            out.push(s('rect', { x: 39, y: 110, width: 42, height: 5, fill: '#facc15' }));
            break;
        default:
            out.push(body(color));
            out.push(s('path', { d: 'M53 80 Q60 87 67 80', stroke: shade(color, -0.25), strokeWidth: 2, fill: 'none' }));
    }
    return out;
}
function arms(c) {
    var _a;
    const skin = (_a = SKIN[c.skin]) !== null && _a !== void 0 ? _a : SKIN.skin2;
    const sleeve = c.top === 'tux' ? '#1f2937' : c.top === 'overalls' ? '#f8fafc' : c.top === 'stripes' ? c.topColor : c.topColor;
    const longSleeves = c.top === 'hoodie' || c.top === 'tux' || c.top === 'hero';
    const out = [];
    const pose = poseOf(c);
    for (const [x, transform] of [
        [26, `rotate(${pose.left} ${SHOULDERS.left.x} ${SHOULDERS.left.y})`],
        [81, `rotate(${pose.right} ${SHOULDERS.right.x} ${SHOULDERS.right.y})`],
    ]) {
        out.push(s('g', { transform }, [
            s('rect', { x, y: 84, width: 13, height: 34, rx: 6.5, fill: skin, ...OUTLINE }),
            s('rect', { x: x - 0.5, y: 83, width: 14, height: longSleeves ? 32 : 15, rx: 6.5, fill: sleeve, ...OUTLINE }),
            ...(c.top === 'stripes' ? [s('rect', { x: x - 0.5, y: 90, width: 14, height: 3, fill: '#ffffff', opacity: 0.85 })] : []),
        ]));
    }
    return out;
}
function hands(c) {
    var _a;
    const skin = (_a = SKIN[c.skin]) !== null && _a !== void 0 ? _a : SKIN.skin2;
    const glove = c.top === 'hero' ? '#facc15' : skin;
    const { left, right } = hands0(c);
    const out = [s('circle', { ...left, r: 6.5, fill: glove, ...OUTLINE }), s('circle', { ...right, r: 6.5, fill: glove, ...OUTLINE })];
    if (c.pose === 'thumbsup') {
        out.push(s('rect', { x: right.cx - 2.6, y: right.cy - 14, width: 5.2, height: 11, rx: 2.6, fill: glove, ...OUTLINE }));
    }
    if (c.pose === 'point') {
        out.push(s('rect', { x: right.cx + 3, y: right.cy - 2, width: 9, height: 4, rx: 2, fill: glove, ...OUTLINE }));
    }
    return out;
}
/** Little extras that go with a pose: wave lines, music notes, sparkles. */
function poseEffects(c) {
    const { left, right } = hands0(c);
    const ink = { stroke: '#64748b', strokeWidth: 1.8, fill: 'none', strokeLinecap: 'round' };
    switch (c.pose) {
        case 'wave':
            return [
                s('path', { d: `M${right.cx + 9} ${right.cy - 6} q4 6 0 12`, ...ink }),
                s('path', { d: `M${right.cx + 14} ${right.cy - 9} q6 9 0 18`, ...ink }),
            ];
        case 'dance': {
            const note = (x, y) => [
                s('ellipse', { cx: x, cy: y, rx: 3.2, ry: 2.4, fill: '#7c3aed' }),
                s('path', { d: `M${x + 2.8} ${y} V${y - 10} l5 2`, stroke: '#7c3aed', strokeWidth: 1.6, fill: 'none' }),
            ];
            return [...note(16, 40), ...note(102, 30)];
        }
        case 'tada':
        case 'cheer':
            return [left, right].flatMap(({ cx, cy }) => [[-9, -8], [8, -10], [0, -14]].map(([dx, dy]) => s('path', {
                d: `M${cx + dx} ${cy + dy - 3} l1 2 l2 1 l-2 1 l-1 2 l-1 -2 l-2 -1 l2 -1 Z`,
                fill: '#f5b301',
            })));
        default:
            return [];
    }
}
// ---------- held item (right hand) ----------
function held(c) {
    const { cx, cy } = hands0(c).right;
    switch (c.held) {
        case 'tp':
            return [
                s('path', { d: `M${cx + 6} ${cy + 6} Q${cx + 10} ${cy + 18} ${cx + 4} ${cy + 26}`, stroke: '#f1f5f9', strokeWidth: 6, fill: 'none', strokeLinecap: 'round' }),
                s('rect', { x: cx - 4, y: cy - 14, width: 18, height: 22, rx: 4, fill: '#ffffff', stroke: '#d1d5db', strokeWidth: 1 }),
                s('ellipse', { cx: cx + 5, cy: cy - 14, rx: 9, ry: 3.5, fill: '#f8fafc', stroke: '#d1d5db', strokeWidth: 1 }),
                s('ellipse', { cx: cx + 5, cy: cy - 14, rx: 3.5, ry: 1.4, fill: '#c4b5a5' }),
            ];
        case 'duck':
            return [
                s('ellipse', { cx: cx + 6, cy: cy - 4, rx: 12, ry: 8.5, fill: '#facc15', ...OUTLINE }),
                s('circle', { cx: cx + 12, cy: cy - 15, r: 6.5, fill: '#facc15', ...OUTLINE }),
                s('path', { d: `M${cx + 17} ${cy - 15} L${cx + 23} ${cy - 13} L${cx + 17} ${cy - 11} Z`, fill: '#f97316' }),
                s('circle', { cx: cx + 13.5, cy: cy - 17, r: 1.3, fill: '#1f2937' }),
                s('path', { d: `M${cx} ${cy - 6} Q${cx + 5} ${cy - 1} ${cx + 10} ${cy - 5}`, stroke: '#eab308', strokeWidth: 1.5, fill: 'none' }),
            ];
        case 'plunger':
        case 'goldplunger': {
            const gold = c.held === 'goldplunger';
            const shapes = [
                s('rect', { x: cx - 2, y: cy - 30, width: 4, height: 44, rx: 2, fill: gold ? 'url(#gold)' : '#b5835a' }),
                s('path', { d: `M${cx - 11} ${cy + 22} Q${cx - 11} ${cy + 10} ${cx} ${cy + 10} Q${cx + 11} ${cy + 10} ${cx + 11} ${cy + 22} Z`, fill: gold ? 'url(#gold)' : '#dc2626', ...OUTLINE }),
            ];
            if (gold) {
                shapes.push(s('path', { d: `M${cx + 9} ${cy - 30} l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2 Z`, fill: '#fff7cc' }));
            }
            return shapes;
        }
        case 'map':
            return [
                s('path', { d: `M${cx - 6} ${cy - 18} L${cx + 4} ${cy - 21} L${cx + 14} ${cy - 18} L${cx + 24} ${cy - 21} L${cx + 24} ${cy + 1} L${cx + 14} ${cy + 4} L${cx + 4} ${cy + 1} L${cx - 6} ${cy + 4} Z`, fill: '#fef3c7', stroke: '#d6b25e', strokeWidth: 1 }),
                s('path', { d: `M${cx + 4} ${cy - 21} V${cy + 1} M${cx + 14} ${cy - 18} V${cy + 4}`, stroke: '#d6b25e', strokeWidth: 1 }),
                s('path', { d: `M${cx + 9} ${cy - 3} c-3 -4 -5 -6 -5 -8 a5 5 0 0 1 10 0 c0 2 -2 4 -5 8z`, fill: '#dc2626' }),
                s('circle', { cx: cx + 9, cy: cy - 11, r: 1.6, fill: '#ffffff' }),
            ];
        case 'flag':
            return [
                s('rect', { x: cx - 1.5, y: cy - 44, width: 3, height: 54, rx: 1.5, fill: '#8b5a2b' }),
                s('path', { d: `M${cx + 1.5} ${cy - 43} L${cx + 26} ${cy - 35} L${cx + 1.5} ${cy - 27} Z`, fill: '#16a34a', ...OUTLINE }),
                s('path', {
                    d: `M${cx + 10} ${cy - 38.5} l1.2 2.4 l2.6 .4 l-1.9 1.8 l.5 2.6 l-2.4 -1.3 l-2.4 1.3 l.5 -2.6 l-1.9 -1.8 l2.6 -.4 Z`,
                    fill: '#fde68a',
                }),
                s('circle', { cx, cy: cy - 45, r: 2.5, fill: '#f5c542' }),
            ];
        default:
            return [];
    }
}
// ---------- head ----------
function head(c) {
    var _a;
    const skin = (_a = SKIN[c.skin]) !== null && _a !== void 0 ? _a : SKIN.skin2;
    return [
        s('rect', { x: 54, y: 72, width: 12, height: 10, rx: 4, fill: shade(skin, -0.08) }),
        s('circle', { cx: 32, cy: 54, r: 5.5, fill: skin, ...OUTLINE }),
        s('circle', { cx: 88, cy: 54, r: 5.5, fill: skin, ...OUTLINE }),
        s('circle', { cx: 60, cy: 50, r: 28, fill: skin, ...OUTLINE }),
        // face
        s('ellipse', { cx: 43, cy: 61, rx: 5, ry: 2.8, fill: '#ff7a7a', opacity: 0.4 }),
        s('ellipse', { cx: 77, cy: 61, rx: 5, ry: 2.8, fill: '#ff7a7a', opacity: 0.4 }),
        s('ellipse', { cx: 50, cy: 52, rx: 3.8, ry: 4.8, fill: '#2b2420' }),
        s('ellipse', { cx: 70, cy: 52, rx: 3.8, ry: 4.8, fill: '#2b2420' }),
        s('circle', { cx: 51.3, cy: 50.3, r: 1.4, fill: '#ffffff' }),
        s('circle', { cx: 71.3, cy: 50.3, r: 1.4, fill: '#ffffff' }),
        s('path', { d: 'M54 62 Q60 68.5 66 62', stroke: '#7a3b2e', strokeWidth: 2.2, fill: 'none', strokeLinecap: 'round' }),
    ];
}
function hairFront(c) {
    const color = c.hairColor;
    const dark = shade(color, -0.15);
    switch (c.hair) {
        case 'short':
        case 'long':
        case 'bun': {
            const shapes = [];
            if (c.hair === 'bun')
                shapes.push(s('circle', { cx: 60, cy: 18, r: 9, fill: dark, ...OUTLINE }));
            shapes.push(s('path', { d: 'M32 50 C30 18 90 18 88 50 C84 40 74 34 64 36 C58 30 46 34 42 40 C38 42 34 46 32 50 Z', fill: color, ...OUTLINE }));
            if (c.hair === 'long') {
                shapes.push(s('path', { d: 'M32 48 C30 60 31 72 34 80 L38 62 Z M88 48 C90 60 89 72 86 80 L82 62 Z', fill: color }));
            }
            return shapes;
        }
        case 'curly':
            return [[36, 42, 8], [44, 31, 9], [56, 26, 9], [68, 27, 9], [79, 33, 9], [85, 44, 8], [50, 36, 7], [64, 34, 7], [74, 40, 6]].map(([cx, cy, r]) => s('circle', { cx, cy, r, fill: color, ...OUTLINE }));
        case 'spiky':
            return [s('path', { d: 'M32 48 L34 24 L44 34 L46 14 L56 30 L61 10 L67 29 L76 15 L77 33 L87 24 L88 48 C80 38 70 36 60 38 C50 36 40 38 32 48 Z', fill: color, ...OUTLINE })];
        case 'mohawk':
            return [
                s('path', { d: 'M53 42 L51 6 Q60 0 69 6 L67 42 Z', fill: color, ...OUTLINE }),
                s('path', { d: 'M55 10 L65 10 M54 20 L66 20 M54 30 L66 30', stroke: dark, strokeWidth: 1.2 }),
            ];
        default:
            return [s('ellipse', { cx: 50, cy: 30, rx: 7, ry: 3.5, fill: '#ffffff', opacity: 0.3 })];
    }
}
function glasses(c) {
    switch (c.glasses) {
        case 'round':
            return [
                s('circle', { cx: 50, cy: 52, r: 7.5, fill: '#ffffff', fillOpacity: 0.15, stroke: '#3f3f46', strokeWidth: 2 }),
                s('circle', { cx: 70, cy: 52, r: 7.5, fill: '#ffffff', fillOpacity: 0.15, stroke: '#3f3f46', strokeWidth: 2 }),
                s('path', { d: 'M57.5 52 Q60 50 62.5 52 M42.5 50 L33 48 M77.5 50 L87 48', stroke: '#3f3f46', strokeWidth: 2, fill: 'none' }),
            ];
        case 'shades':
            return [
                s('rect', { x: 40.5, y: 46, width: 18, height: 12, rx: 5, fill: '#111827' }),
                s('rect', { x: 61.5, y: 46, width: 18, height: 12, rx: 5, fill: '#111827' }),
                s('path', { d: 'M58.5 50 H61.5 M40.5 49 L33 47 M79.5 49 L87 47', stroke: '#111827', strokeWidth: 2.5 }),
                s('path', { d: 'M44 49 L48 49 M65 49 L69 49', stroke: '#ffffff', strokeWidth: 1.5, opacity: 0.6, strokeLinecap: 'round' }),
            ];
        case 'stars': {
            const star = (cx, cy) => {
                const pts = [];
                for (let i = 0; i < 10; i++) {
                    const r = i % 2 ? 4.2 : 10;
                    const a = (Math.PI / 5) * i - Math.PI / 2;
                    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
                }
                return s('polygon', { points: pts.join(' '), fill: '#f472b6', stroke: '#be185d', strokeWidth: 1.2, strokeLinejoin: 'round' });
            };
            return [star(50, 52), star(70, 52), s('path', { d: 'M58 52 H62', stroke: '#be185d', strokeWidth: 2 })];
        }
        default:
            return [];
    }
}
function hat(c) {
    const color = c.topColor;
    switch (c.hat) {
        case 'cap':
            return [
                s('path', { d: 'M32 40 C31 12 89 12 88 40 Z', fill: color, ...OUTLINE }),
                s('path', { d: 'M60 38 C76 36 96 38 102 42 C96 46 76 45 60 42 Z', fill: shade(color, -0.2), ...OUTLINE }),
                s('circle', { cx: 60, cy: 15, r: 2.5, fill: shade(color, -0.2) }),
                s('path', { d: 'M60 15 V39', stroke: shade(color, -0.2), strokeWidth: 1 }),
            ];
        case 'beanie':
            return [
                s('path', { d: 'M31 42 C30 10 90 10 89 42 Z', fill: color, ...OUTLINE }),
                s('rect', { x: 30, y: 35, width: 60, height: 10, rx: 5, fill: shade(color, -0.2), ...OUTLINE }),
                s('path', { d: 'M40 36 V44 M48 36 V44 M56 36 V44 M64 36 V44 M72 36 V44 M80 36 V44', stroke: shade(color, -0.35), strokeWidth: 1 }),
                s('circle', { cx: 60, cy: 11, r: 6.5, fill: '#ffffff', ...OUTLINE }),
            ];
        case 'party':
            return [
                s('polygon', { points: '40,34 80,34 61,-6', fill: '#a855f7', ...OUTLINE }),
                s('path', { d: 'M46 24 L76 26 M52 12 L71 15', stroke: '#facc15', strokeWidth: 3, strokeLinecap: 'round' }),
                s('circle', { cx: 61, cy: -7, r: 5, fill: '#f472b6' }),
                s('circle', { cx: 51, cy: 30, r: 1.8, fill: '#22d3ee' }),
                s('circle', { cx: 68, cy: 20, r: 1.8, fill: '#22d3ee' }),
            ];
        case 'cowboy':
            return [
                s('path', { d: 'M40 34 C38 6 82 6 80 34 Z', fill: '#9a6534', ...OUTLINE }),
                s('path', { d: 'M60 12 L60 22', stroke: '#7c4a25', strokeWidth: 2 }),
                s('rect', { x: 40, y: 27, width: 40, height: 5, fill: color }),
                s('path', { d: 'M18 34 Q60 46 102 34 Q104 40 98 42 Q60 52 22 42 Q16 40 18 34 Z', fill: '#7c4a25', ...OUTLINE }),
            ];
        case 'tophat':
            return [
                s('rect', { x: 44, y: 0, width: 32, height: 32, rx: 3, fill: '#1f2937', ...OUTLINE }),
                s('rect', { x: 44, y: 22, width: 32, height: 6, fill: color }),
                s('ellipse', { cx: 60, cy: 33, rx: 30, ry: 5, fill: '#111827' }),
            ];
        case 'crown':
            return [
                s('polygon', { points: '38,34 38,12 48,23 54,6 60,19 66,6 72,23 82,12 82,34', fill: 'url(#gold)', stroke: '#b8860b', strokeWidth: 1.2, strokeLinejoin: 'round' }),
                s('circle', { cx: 60, cy: 28, r: 3, fill: '#dc2626' }),
                s('circle', { cx: 47, cy: 29, r: 2.2, fill: '#2563eb' }),
                s('circle', { cx: 73, cy: 29, r: 2.2, fill: '#16a34a' }),
            ];
        case 'explorer':
            return [
                s('path', { d: 'M33 38 C32 6 88 6 87 38 Z', fill: '#d6c49a', ...OUTLINE }),
                s('rect', { x: 33, y: 30, width: 54, height: 6, fill: '#7c5a2e' }),
                s('ellipse', { cx: 60, cy: 38, rx: 34, ry: 6, fill: '#c9b483', ...OUTLINE }),
                s('path', { d: 'M48 12 Q60 6 72 12', stroke: '#ebe0c2', strokeWidth: 2, fill: 'none', strokeLinecap: 'round' }),
            ];
        case 'tpcrown':
            return [36, 60, 84].flatMap((cx, i) => {
                const top = i === 1 ? 2 : 10;
                return [
                    s('rect', { x: cx - 9, y: top, width: 18, height: 34 - top, rx: 4, fill: '#ffffff', stroke: '#d1d5db', strokeWidth: 1 }),
                    s('ellipse', { cx, cy: top, rx: 9, ry: 3.5, fill: '#f8fafc', stroke: '#d1d5db', strokeWidth: 1 }),
                    s('ellipse', { cx, cy: top, rx: 3.5, ry: 1.4, fill: '#c4b5a5' }),
                    s('path', { d: `M${cx - 9} ${top + 12} H${cx + 9}`, stroke: '#e5e7eb', strokeWidth: 1, strokeDasharray: '2 2' }),
                ];
            });
        default:
            return [];
    }
}
/** All the shapes for a character, back to front. */
export function drawCharacter(config) {
    const c = { ...DEFAULT_CHARACTER, ...(config !== null && config !== void 0 ? config : {}) };
    const body = [
        ...back(c),
        ...legs(c),
        ...shoes(c),
        ...arms(c),
        ...torso(c),
        ...held(c),
        ...hands(c),
        ...head(c),
        ...glasses(c),
        ...hairFront(c),
        ...hat(c),
        ...poseEffects(c),
    ];
    const tilt = poseOf(c).tilt;
    return [
        defs(),
        s('ellipse', { cx: 60, cy: 160, rx: 30, ry: 5, fill: '#000000', opacity: 0.12 }), // ground shadow
        ...(tilt ? [s('g', { transform: `rotate(${tilt} 60 158)` }, body)] : body),
    ];
}
/** The same drawing as an SVG string (for previews and the website). */
export function characterSvg(config, height = 182) {
    const attr = (k) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
    const render = (sh) => {
        const tag = sh.t === 'linearGradient' ? 'linearGradient' : sh.t;
        const props = Object.entries(sh.p)
            .map(([k, v]) => `${k === 'stopColor' ? 'stop-color' : ['x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'rx', 'ry'].includes(k) ? k : attr(k)}="${v}"`)
            .join(' ');
        return sh.c ? `<${tag} ${props}>${sh.c.map(render).join('')}</${tag}>` : `<${tag} ${props}/>`;
    };
    const width = Math.round((height * VIEW_WIDTH) / VIEW_HEIGHT);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${VIEWBOX}" width="${width}" height="${height}">${drawCharacter(config).map(render).join('')}</svg>`;
}
