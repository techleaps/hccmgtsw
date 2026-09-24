import { normalizePersonName } from './nameMatching';

function clean(s) {
  return String(s ?? '').trim().toLowerCase();
}

function num(v) {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : '0';
}

function dateKey(v) {
  if (!v) return '';
  const s = String(v).slice(0, 10);
  return s;
}

/** Stable fingerprint for "already uploaded" detection (cumulative Excel files). */
export function recordFingerprint(tableName, rec) {
  switch (tableName) {
    case 'payments':
      return [
        normalizePersonName(rec.subscriber_name),
        num(rec.amount),
        dateKey(rec.date_paid),
        clean(rec.payment_type || 'property'),
        clean(rec.property_type),
        clean(rec.payment_reference),
      ].join('|');
    case 'offers':
      return [
        normalizePersonName(rec.subscriber_name),
        clean(rec.form_no),
        clean(rec.property_type),
      ].join('|');
    case 'allocation_records':
      return [
        normalizePersonName(rec.subscriber_name),
        clean(rec.house_no),
        clean(rec.property_type),
      ].join('|');
    case 'refunds':
      return [
        normalizePersonName(rec.subscriber_name),
        num(rec.amount_approved ?? rec.amount),
        dateKey(rec.date_of_approval ?? rec.date_paid),
      ].join('|');
    case 'refundsCrossEstate':
      // Same person + same approved amount (date optional) — possible double recording across estates
      return [
        normalizePersonName(rec.subscriber_name),
        num(rec.amount_approved ?? rec.amount),
      ].join('|');
    case 'ownership_changes':
      return [
        normalizePersonName(rec.previous_owner),
        normalizePersonName(rec.new_owner),
        dateKey(rec.date_changed),
        clean(rec.property_type),
      ].join('|');
    default:
      return normalizePersonName(rec.subscriber_name || rec.name || '') + '|' + JSON.stringify(rec).slice(0, 80);
  }
}

export function fingerprintSetFromRows(tableName, rows) {
  const set = new Set();
  (rows || []).forEach((r) => {
    const fp = recordFingerprint(tableName, r);
    if (fp && !fp.startsWith('|')) set.add(fp);
  });
  return set;
}
