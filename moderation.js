// Content rules: a word filter for reviews and usernames, and the report reasons people can pick.

// Strong profanity and slurs. Milder bathroom words (like "crap" or "shit") are allowed, since this
// is an app about toilets. Matching ignores case and common letter swaps (0→o, 1→i, 3→e, 4→a, 5→s, @→a, $→s).
const BLOCKED = [
  'fuck', 'fucker', 'fucking', 'motherfucker', 'cunt', 'cock', 'dick', 'pussy', 'bitch', 'bastard', 'asshole',
  'whore', 'slut', 'twat', 'wanker', 'nigger', 'nigga', 'faggot', 'fag', 'retard', 'spic', 'chink', 'kike',
  'tranny', 'dyke', 'coon', 'gook', 'wetback',
];

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', '@': 'a', $: 's', '!': 'i' };
const normalize = (s) => s.toLowerCase().replace(/[013457@$!]/g, (c) => LEET[c]);

// Whole words only, so place names like "Scunthorpe" or "Dickens Cafe" aren't flagged in reviews.
const WORD = new RegExp(`\\b(${BLOCKED.join('|')})(s|es|ed|ing|y)?\\b`, 'gi');

/** Replaces blocked words in review text with asterisks, keeping the first letter. */
function maskText(text) {
  if (!text) return text;
  const normalized = normalize(text);
  let out = '';
  let last = 0;
  for (const m of normalized.matchAll(WORD)) {
    out += text.slice(last, m.index) + text[m.index] + '*'.repeat(m[0].length - 1);
    last = m.index + m[0].length;
  }
  return out + text.slice(last);
}

// Short words that also appear inside ordinary names (Dickens, Hitchcock, Raccoon…) only count as whole words.
const WHOLE_WORD_ONLY = new Set(['cock', 'dick', 'coon', 'spic', 'fag', 'gook', 'dyke', 'kike', 'twat', 'chink']);

/** True if a username contains a blocked word (usernames have no spaces, so check inside the name too). */
function isOffensiveName(name) {
  const lower = normalize(name);
  const squashed = lower.replace(/[^a-z]/g, '');
  const parts = lower.split(/[^a-z]+/).filter(Boolean);
  return BLOCKED.some((w) =>
    WHOLE_WORD_ONLY.has(w) ? parts.some((p) => p === w || p === `${w}s`) : squashed.includes(w),
  );
}

const REPORT_REASONS = {
  spam: 'Spam or advertising',
  offensive: 'Offensive or hateful',
  false: 'False or misleading',
  private: "Shares someone's private information",
  other: 'Something else',
};

/** Reviews reported by this many different people are hidden until a moderator looks. */
const HIDE_AFTER_REPORTS = Number(process.env.HIDE_AFTER_REPORTS) || 3;

module.exports = { maskText, isOffensiveName, REPORT_REASONS, HIDE_AFTER_REPORTS };
