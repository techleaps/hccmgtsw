/**
 * Intelligent expense sub-grouping from description text.
 * Used so recurring "Others" (and other) lines can be filtered like RCA/DTA.
 */

const RULES = [
  {
    group: 'Site allowance (staff stipend)',
    patterns: [
      /site\s*all(?:owance|ce)/i,
      /staff\s*allowance/i,
      /\bstipend\b/i,
      /seconded\s*staff/i,
      /augment(?:ation)?\s*(of\s*)?salar/i,
      /monthly\s*allowance/i,
    ],
  },
  {
    group: 'Recharge cards / airtime',
    patterns: [
      /\brecharge\b/i, /\bairtime\b/i, /\bcall\s*card/i, /\bdata\s*bundle/i,
      /\bsim\b/i, /\bmtn\b/i, /\bairtel\b/i, /\bglo\b/i, /\b9mobile\b/i,
    ],
  },
  {
    group: 'PMS / Petrol (staff car)',
    patterns: [
      /\bpms\b/i, /premium\s*motor\s*spirit/i, /\bpetrol\b/i,
      /staff\s*car/i, /md'?s?\s*(official\s*)?(staff\s*)?car/i, /official\s*staff\s*car/i,
    ],
  },
  {
    group: 'Coy / company vehicle fuel',
    patterns: [
      /coy\s*vehicle/i, /company\s*vehicle/i, /coy\s*vehicles/i,
      /fuel(?:ing)?\s+for\s+(the\s+)?coy/i,
    ],
  },
  {
    group: 'AGO / Diesel',
    patterns: [
      /\bago\b/i, /automotive\s*gas\s*oil/i, /\bdiesel\b/i,
    ],
  },
  {
    group: 'Stationary / office supplies',
    patterns: [
      /\bstationer/i, /\btoner\b/i, /\bprinter\b/i, /\bpaper\b/i,
      /\bcartridge\b/i, /office\s*suppl/i,
    ],
  },
  {
    group: 'Utilities (power / water)',
    patterns: [
      /\belectric/i, /\bphcn\b/i, /\bnepa\b/i, /\bprepaid\b/i, /\bmeter\b/i,
      /\bwater\s*bill/i, /\butility/i, /\bgenerator\b/i, /\bdiesel\s+for\s+gen/i,
    ],
  },
  {
    group: 'Internet / communication',
    patterns: [
      /\binternet\b/i, /\bwi-?fi\b/i, /\bbroadband\b/i, /\bisp\b/i,
      /\bsubscription\b/i, /\bdstv\b/i, /\bgotv\b/i,
    ],
  },
  {
    group: 'Maintenance / repairs',
    patterns: [
      /\bmaintenance\b/i, /\brepair/i, /\bservicing\b/i, /\bservice\s+of\b/i,
    ],
  },
  {
    group: 'Security (non-RCA)',
    patterns: [
      /\bsecurity\b/i, /\bguard\b/i, /\bcctv\b/i, /\bsurveillance\b/i,
    ],
  },
  {
    group: 'Transportation / logistics',
    patterns: [
      /\btransport/i, /\blogistics\b/i, /\bhire\s+(of\s+)?vehicle/i, /\bcourier\b/i,
    ],
  },
  {
    group: 'Hospitality / entertainment',
    patterns: [
      /\bhospitality\b/i, /\bentertainment\b/i, /\brefreshment/i, /\bcatering\b/i,
    ],
  },
  {
    group: 'Medical / welfare',
    patterns: [
      /\bmedical\b/i, /\bwelfare\b/i, /\bhospital\b/i, /\bclinic\b/i,
    ],
  },
  {
    group: 'Legal / professional fees',
    patterns: [
      /\blegal\b/i, /\bsolicitor/i, /\baudit\b/i, /\bconsultant/i, /\bprofessional\s*fee/i,
    ],
  },
  {
    group: 'Bank charges / financial',
    patterns: [
      /\bbank\s*charge/i, /\bcommission\b/i, /\bvat\b/i, /\blevy\b/i,
    ],
  },
];

/** Normalize description for clustering near-duplicates */
export function normalizeExpenseTitle(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|for|of|and|a|an|to|in|on|at|nafilhcc|hq|dated)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Classify a single description into a sub-group.
 * @param {string} title
 * @param {string} [category] main category RCA/DTA/Salary/Others
 * @param {string} [manualGroup] stored override
 */
export function classifyExpenseGroup(title, category, manualGroup) {
  if (manualGroup && String(manualGroup).trim()) return String(manualGroup).trim();

  const cat = String(category || '').trim();
  // Main categories already act as groups
  if (cat === 'RCA') return 'RCA (security / guards)';
  if (cat === 'DTA') return 'DTA / travel / flights';
  if (cat === 'Salary') return 'Salary / staff pay';
  if (cat === 'Site Allowance') return 'Site allowance (staff stipend)';

  const text = String(title || '');
  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) return rule.group;
  }

  // Fallback: short label from first meaningful words (clusters recurring same wording)
  const norm = normalizeExpenseTitle(text);
  if (!norm) return 'Unclassified';
  const words = norm.split(' ').filter(Boolean).slice(0, 5);
  if (words.length === 0) return 'Unclassified';
  // Title-case for display
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** All known rule groups (for dropdowns) */
export function knownExpenseGroups() {
  return [
    'RCA (security / guards)',
    'DTA / travel / flights',
    'Salary / staff pay',
    'Site allowance (staff stipend)',
    ...RULES.map((r) => r.group).filter((x) => x !== 'Site allowance (staff stipend)'),
    'Unclassified',
  ];
}

/**
 * Group rows for analysis: { group, count, approved, applied, months: Set }
 */
export function groupExpensesByType(rows) {
  const map = new Map();
  (rows || []).forEach((r) => {
    const g = r.expense_group
      || classifyExpenseGroup(r.title, r.category, null);
    if (!map.has(g)) {
      map.set(g, {
        name: g,
        count: 0,
        approved: 0,
        applied: 0,
        months: new Set(),
      });
    }
    const rec = map.get(g);
    rec.count += 1;
    rec.approved += Number(r.amount_approved || 0);
    rec.applied += Number(r.amount_applied || 0);
    if (r.month_label) rec.months.add(r.month_label);
  });
  return [...map.values()]
    .map((x) => ({ ...x, months: [...x.months].sort(), monthCount: x.months.size }))
    .sort((a, b) => b.approved - a.approved);
}
