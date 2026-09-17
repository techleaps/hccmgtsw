// Shared logic for turning raw offers/allocations/payments rows into a
// per-subscriber, per-property-type payment picture. Used by both the
// Payment Analysis estate-picker (portfolio-wide totals) and the
// per-estate Analysis page (detailed breakdown), so the two always agree.

export function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Treat blank / null / 'other' as property payments — bulk Excel imports
// historically landed here when the Payment Type column was missing.
export function isPropertyPayment(paymentType) {
  const t = String(paymentType || '').toLowerCase().trim();
  return !t || t === 'property' || t === 'other' || t.includes('prop');
}

export function isTdpPayment(paymentType) {
  const t = String(paymentType || '').toLowerCase().trim();
  return t.includes('legal') || t.includes('tdp');
}

export function isInfraPayment(paymentType) {
  const t = String(paymentType || '').toLowerCase().trim();
  return t.includes('infra');
}

/**
 * Find fee config for a property type label. Tries exact, then normalised,
 * then loose includes — so "3 Bedroom Terrace - Old Rate" still matches
 * a config saved as "3 Bedroom Terrace - Old Rate" or similar variants.
 */
export function findFeeConfig(feeConfigList, propertyType) {
  if (!propertyType || !feeConfigList?.length) return null;
  const exact = feeConfigList.find((f) => f.property_type === propertyType);
  if (exact) return exact;
  const n = norm(propertyType);
  const byNorm = feeConfigList.find((f) => norm(f.property_type) === n);
  if (byNorm) return byNorm;
  // Prefer longest overlapping label to avoid matching "3BR" to "3 Bedroom ..."
  let best = null;
  let bestLen = 0;
  for (const f of feeConfigList) {
    const fn = norm(f.property_type);
    if (!fn) continue;
    if (n.includes(fn) || fn.includes(n)) {
      if (fn.length > bestLen) {
        best = f;
        bestLen = fn.length;
      }
    }
  }
  return best;
}

// Builds one row per distinct subscriber name within a single estate's
// offers/allocations/payments. { name, propertyType, paid, hasAllocation }
export function buildSubscribers(offers, allocations, payments) {
  const map = new Map();
  function ensure(nameRaw, propertyType) {
    const key = norm(nameRaw);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        name: nameRaw.trim(),
        propertyType: propertyType || null,
        paid: 0,
        tdpPaid: 0,
        infraPaid: 0,
        otherPaid: 0,
        hasAllocation: false,
      });
    }
    const rec = map.get(key);
    if (!rec.propertyType && propertyType) rec.propertyType = propertyType;
    return rec;
  }

  offers.forEach((o) => {
    const rec = ensure(o.subscriber_name, o.property_type);
    if (rec) rec.paid += Number(o.amount_paid || 0);
  });
  allocations.forEach((a) => {
    if (!a.subscriber_name) return;
    const rec = ensure(a.subscriber_name, a.property_type);
    if (rec) rec.hasAllocation = true;
  });
  payments.forEach((p) => {
    const rec = ensure(p.subscriber_name, p.property_type);
    if (!rec) return;
    const amt = Number(p.amount || 0);
    if (isTdpPayment(p.payment_type)) {
      rec.tdpPaid += amt;
    } else if (isInfraPayment(p.payment_type)) {
      rec.infraPaid += amt;
    } else if (isPropertyPayment(p.payment_type)) {
      rec.paid += amt;
    } else {
      rec.otherPaid += amt;
    }
  });

  return Array.from(map.values());
}

// { property_type -> expected_property_cost } — also keeps full config for lookup
export function costByTypeMap(types) {
  const m = {};
  (types || []).forEach((t) => {
    m[t.property_type] = Number(t.expected_property_cost || 0);
  });
  return m;
}

export function getExpectedCost(costByType, propertyType, feeConfigList) {
  if (propertyType && costByType[propertyType] > 0) return costByType[propertyType];
  const cfg = findFeeConfig(feeConfigList || Object.keys(costByType).map((k) => ({
    property_type: k,
    expected_property_cost: costByType[k],
  })), propertyType);
  return cfg ? Number(cfg.expected_property_cost || 0) : 0;
}

// Buckets subscribers into 100%+, 60-99%, below 60%, and unknown (no cost configured).
export function bucketSubscribers(subscribers, costByType, feeConfigList) {
  const result = {
    hundredPlus: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    sixtyTo99: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    belowSixty: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    unknown: { count: 0, total: 0 },
  };
  subscribers.forEach((s) => {
    const expected = getExpectedCost(costByType, s.propertyType, feeConfigList);
    if (!expected || expected <= 0) {
      result.unknown.count += 1;
      result.unknown.total += s.paid;
      return;
    }
    const pct = (s.paid / expected) * 100;
    const bucket = pct >= 100 ? 'hundredPlus' : pct >= 60 ? 'sixtyTo99' : 'belowSixty';
    result[bucket].count += 1;
    result[bucket].total += s.paid;
    if (s.hasAllocation) result[bucket].allocated += 1;
    else result[bucket].unallocated += 1;
  });
  return result;
}

export function breakdownByPropertyType(subscribers, costByType, feeConfigList) {
  const m = new Map();
  subscribers.forEach((s) => {
    const key = s.propertyType || 'Unspecified';
    if (!m.has(key)) {
      m.set(key, {
        propertyType: key,
        count: 0,
        totalPaid: 0,
        fullyPaidCount: 0,
        allocatedCount: 0,
      });
    }
    const row = m.get(key);
    row.count += 1;
    row.totalPaid += s.paid;
    if (s.hasAllocation) row.allocatedCount += 1;
    const expected = getExpectedCost(costByType, key, feeConfigList);
    if (expected > 0 && s.paid >= expected) row.fullyPaidCount += 1;
  });
  return Array.from(m.values()).map((row) => {
    const expectedCost = getExpectedCost(costByType, row.propertyType, feeConfigList);
    return {
      ...row,
      expectedCost,
      totalExpected: expectedCost * row.count,
    };
  }).sort((a, b) => a.propertyType.localeCompare(b.propertyType));
}

/**
 * Allocate a subscriber's payments into display buckets for the profile page.
 *
 * Rules (per management request):
 * - Property payments count toward property cost first.
 * - If total property-like payments exceed expected property cost, the excess
 *   goes to Other — unless explicit Legal/TDP payments were recorded, in which
 *   case those sit under TDP.
 * - TDP is ONLY filled from payments explicitly typed as legal_tdp (receipt collected).
 * - Infrastructure only from explicit infrastructure payments.
 */
export function allocatePaymentSummary(payments, offers, feeConfig, propertyTypes) {
  const paidRaw = { property: 0, infrastructure: 0, legal_tdp: 0, other: 0 };
  (payments || []).forEach((p) => {
    const amt = Number(p.amount || 0);
    const t = String(p.payment_type || '').toLowerCase().trim();
    if (isTdpPayment(t)) paidRaw.legal_tdp += amt;
    else if (isInfraPayment(t)) paidRaw.infrastructure += amt;
    else if (t === 'other') paidRaw.other += amt;
    else paidRaw.property += amt; // property, blank, unknown
  });
  const offerAmounts = (offers || []).reduce((s, o) => s + Number(o.amount_paid || 0), 0);
  paidRaw.property += offerAmounts;

  let expected = { property: 0, infrastructure: 0, legal_tdp: 0 };
  const pts = propertyTypes?.length ? propertyTypes : [];
  if (pts.length) {
    pts.forEach((pt) => {
      const cfg = findFeeConfig(feeConfig, pt);
      if (cfg) {
        expected.property += Number(cfg.expected_property_cost || 0);
        expected.infrastructure += Number(cfg.expected_infrastructure_fee || 0);
        expected.legal_tdp += Number(cfg.expected_legal_tdp_fee || 0);
      }
    });
  } else if (feeConfig?.length === 1) {
    const cfg = feeConfig[0];
    expected.property = Number(cfg.expected_property_cost || 0);
    expected.infrastructure = Number(cfg.expected_infrastructure_fee || 0);
    expected.legal_tdp = Number(cfg.expected_legal_tdp_fee || 0);
  }

  // Display allocation:
  // Show full amount paid under Property (so % can exceed 100).
  // Explicit TDP / infra stay in their columns.
  // "other" typed payments stay under Other.
  // Excess over property cost is still visible via negative balance / % > 100.
  const display = {
    property: paidRaw.property,
    infrastructure: paidRaw.infrastructure,
    legal_tdp: paidRaw.legal_tdp,
    other: paidRaw.other,
  };

  return { expected, paid: display, paidRaw };
}
