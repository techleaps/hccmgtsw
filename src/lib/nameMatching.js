/**
 * Fuzzy person-name matching for Nigerian military / civilian registers.
 * Goal: flag likely same person without auto-merging (human reviews flags).
 */

const TITLE_TOKENS = new Set([
  'sqn', 'ldr', 'lt', 'col', 'maj', 'gen', 'avm', 'air', 'cdre', 'cdr', 'wg', 'gp', 'capt',
  'flt', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'hon', 'engr', 'arc', 'barr', 'alhaji',
  'alh', 'hajiya', 'chief', 'sir', 'lady', 'mwo', 'wo', 'sgt', 'cpl', 'fs', 'acm', 'cas',
  'rtd', 'retired', 'navy', 'army', 'force', 'group', 'wing', 'flight', 'lieutenant',
  'commander', 'commodore', 'marshal', 'brigadier', 'colonel', 'major', 'captain',
  'sergeant', 'corporal', 'warrant', 'officer', 'pilot', 'officer',
]);

/** Common alternate spellings → canonical key */
const SPELLING_MAP = {
  mohammed: 'muhammad',
  muhammed: 'muhammad',
  mahammed: 'muhammad',
  muhammad: 'muhammad',
  mohamad: 'muhammad',
  muhamad: 'muhammad',
  ahmed: 'ahmad',
  ahmad: 'ahmad',
  usman: 'uthman',
  uthman: 'uthman',
  osman: 'uthman',
  fatima: 'fatimah',
  fatimah: 'fatimah',
  aisha: 'aishah',
  aishah: 'aishah',
  ishaq: 'isaac',
  isaac: 'isaac',
  yakubu: 'jacob',
  yousuf: 'yusuf',
  yusuf: 'yusuf',
  ibrahim: 'ibrahim',
  ibraheem: 'ibrahim',
  abdulahi: 'abdullahi',
  abdullahi: 'abdullahi',
  abdullah: 'abdullahi',
  sani: 'sani',
  sunny: 'sani',
};

export function normalizePersonName(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  const parts = t.split(/\s+/).filter(Boolean).filter((w) => !TITLE_TOKENS.has(w));
  return parts.map((w) => SPELLING_MAP[w] || w).join(' ').trim();
}

export function nameTokens(s) {
  return normalizePersonName(s).split(' ').filter((w) => w.length > 1);
}

/**
 * Score 0–1 how likely two display names are the same person.
 * ≥ 0.82 → strong flag candidate
 */
export function nameSimilarity(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.92;

  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;

  const setA = new Set(ta);
  const setB = new Set(tb);
  let shared = 0;
  setB.forEach((w) => { if (setA.has(w)) shared += 1; });
  const union = new Set([...ta, ...tb]).size;
  const jaccard = shared / union;

  // Bonus if last tokens match (surname often last)
  const lastBonus = ta[ta.length - 1] === tb[tb.length - 1] ? 0.15 : 0;
  // Bonus if first token matches
  const firstBonus = ta[0] === tb[0] ? 0.1 : 0;

  return Math.min(1, jaccard + lastBonus + firstBonus);
}

export function namesLikelySame(a, b, threshold = 0.82) {
  return nameSimilarity(a, b) >= threshold;
}

/**
 * Within a list of { name, ... }, find groups of likely duplicates.
 * Returns array of { score, members: rows[] }
 */
export function findDuplicateGroups(rows, nameKey = 'name', threshold = 0.82) {
  const list = (rows || []).filter((r) => r[nameKey]);
  const used = new Set();
  const groups = [];

  for (let i = 0; i < list.length; i += 1) {
    if (used.has(i)) continue;
    const members = [list[i]];
    let best = 0;
    for (let j = i + 1; j < list.length; j += 1) {
      if (used.has(j)) continue;
      const score = nameSimilarity(list[i][nameKey], list[j][nameKey]);
      if (score >= threshold) {
        members.push(list[j]);
        used.add(j);
        best = Math.max(best, score);
      }
    }
    if (members.length > 1) {
      used.add(i);
      groups.push({ score: best || nameSimilarity(members[0][nameKey], members[1][nameKey]), members });
    }
  }
  return groups.sort((a, b) => b.score - a.score);
}

/** Natural compare for "Plot Number - 12" vs "Plot Number - 100" */
export function naturalHouseNoCompare(a, b) {
  const sa = String(a || '');
  const sb = String(b || '');
  const re = /(\d+)/g;
  const partsA = sa.split(re);
  const partsB = sb.split(re);
  const len = Math.max(partsA.length, partsB.length);
  for (let i = 0; i < len; i += 1) {
    const xa = partsA[i] ?? '';
    const xb = partsB[i] ?? '';
    const na = Number(xa);
    const nb = Number(xb);
    if (xa !== '' && xb !== '' && Number.isFinite(na) && Number.isFinite(nb) && String(na) === xa && String(nb) === xb) {
      if (na !== nb) return na - nb;
    } else {
      const c = xa.localeCompare(xb, undefined, { sensitivity: 'base' });
      if (c !== 0) return c;
    }
  }
  return 0;
}
