// Shared logic for turning raw offers/allocations/payments rows into a
// per-subscriber, per-property-type payment picture. Used by both the
// Payment Analysis estate-picker (portfolio-wide totals) and the
// per-estate Analysis page (detailed breakdown), so the two always agree.

export function norm(s) {
  return String(s || '').trim().toLowerCase();
}

// Treat blank / null / 'other' as property payments — bulk Excel imports
// historically landed here when the Payment Type column was missing.
export function isPropertyPayment(paymentType) {
  const t = String(paymentType || '').toLowerCase().trim();
  return !t || t === 'property' || t === 'other' || t.includes('prop');
}

// Builds one row per distinct subscriber name within a single estate's
// offers/allocations/payments. { name, propertyType, paid, hasAllocation }
export function buildSubscribers(offers, allocations, payments) {
  const map = new Map();
  function ensure(nameRaw, propertyType) {
    const key = norm(nameRaw);
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, { name: nameRaw.trim(), propertyType: propertyType || null, paid: 0, hasAllocation: false });
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
    if (!a.subscriber_name) return; // vacant/unallocated units aren't a "subscriber"
    const rec = ensure(a.subscriber_name, a.property_type);
    if (rec) rec.hasAllocation = true;
  });
  payments.forEach((p) => {
    const rec = ensure(p.subscriber_name, p.property_type);
    if (!rec) return;
    if (isPropertyPayment(p.payment_type)) rec.paid += Number(p.amount || 0);
  });

  return Array.from(map.values());
}

// { property_type -> expected_property_cost }
export function costByTypeMap(types) {
  const m = {};
  (types || []).forEach((t) => { m[t.property_type] = Number(t.expected_property_cost || 0); });
  return m;
}

// Buckets subscribers into 100%+, 60-99%, below 60%, and unknown (no cost configured).
export function bucketSubscribers(subscribers, costByType) {
  const result = {
    hundredPlus: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    sixtyTo99: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    belowSixty: { count: 0, total: 0, allocated: 0, unallocated: 0 },
    unknown: { count: 0, total: 0 },
  };
  subscribers.forEach((s) => {
    const expected = costByType[s.propertyType];
    if (!expected || expected <= 0) {
      result.unknown.count += 1;
      result.unknown.total += s.paid;
      return;
    }
    const pct = (s.paid / expected) * 100;
    const bucket = pct >= 100 ? 'hundredPlus' : pct >= 60 ? 'sixtyTo99' : 'belowSixty';
    result[bucket].count += 1;
    result[bucket].total += s.paid;
    if (s.hasAllocation) result[bucket].allocated += 1; else result[bucket].unallocated += 1;
  });
  return result;
}

// Groups subscribers by their exact property_type label — this is what makes an
// "Old Rate" vs "New Rate" split (or any other per-type split) show up as its own
// line, each measured against its own expected cost.
export function breakdownByPropertyType(subscribers, costByType) {
  const m = new Map();
  subscribers.forEach((s) => {
    const key = s.propertyType || 'Unspecified';
    if (!m.has(key)) m.set(key, { propertyType: key, count: 0, totalPaid: 0, fullyPaidCount: 0, allocatedCount: 0 });
    const row = m.get(key);
    row.count += 1;
    row.totalPaid += s.paid;
    if (s.hasAllocation) row.allocatedCount += 1;
    const expected = costByType[key];
    if (expected > 0 && s.paid >= expected) row.fullyPaidCount += 1;
  });
  return Array.from(m.values()).map((row) => ({
    ...row,
    expectedCost: costByType[row.propertyType] || 0,
    totalExpected: (costByType[row.propertyType] || 0) * row.count,
  })).sort((a, b) => a.propertyType.localeCompare(b.propertyType));
}
