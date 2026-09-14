import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

function norm(s) { return String(s || '').trim().toLowerCase(); }

export default function Analysis() {
  const { estateId } = useParams();
  const [estate, setEstate] = useState(null);
  const [types, setTypes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [estateId]);

  async function load() {
    setLoading(true);
    const [estateRes, typesRes, offersRes, allocRes, paymentsRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', estateId).single(),
      supabase.from('estate_property_types').select('*').eq('estate_id', estateId),
      supabase.from('offers').select('subscriber_name, property_type, amount_paid').eq('estate_id', estateId).eq('is_deleted', false),
      supabase.from('allocation_records').select('subscriber_name, property_type').eq('estate_id', estateId).eq('is_deleted', false),
      supabase.from('payments').select('subscriber_name, property_type, payment_type, amount').eq('estate_id', estateId).eq('is_deleted', false),
    ]);
    setEstate(estateRes.data || null);
    setTypes(typesRes.data || []);
    setOffers(offersRes.data || []);
    setAllocations(allocRes.data || []);
    setPayments(paymentsRes.data || []);
    setLoading(false);
  }

  const subscribers = useMemo(() => {
    const map = new Map(); // key: normalized name -> { name, propertyType, paid, hasAllocation }
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
      if (rec && p.payment_type === 'property') rec.paid += Number(p.amount || 0);
    });

    const list = Array.from(map.values());
    return propertyTypeFilter ? list.filter((s) => s.propertyType === propertyTypeFilter) : list;
  }, [offers, allocations, payments, propertyTypeFilter]);

  const costByType = useMemo(() => {
    const m = {};
    types.forEach((t) => { m[t.property_type] = Number(t.expected_property_cost || 0); });
    return m;
  }, [types]);

  const buckets = useMemo(() => {
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
  }, [subscribers, costByType]);

  if (loading) return <p className="muted">Loading…</p>;

  const propertyTypes = types.map((t) => t.property_type);
  const missingCostTypes = propertyTypes.filter((pt) => !costByType[pt]);

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to={`/estates/${estateId}`} className="muted">&larr; {estate?.name}</Link>
          <h2>Payment Analysis — {estate?.name}</h2>
        </div>
      </div>

      <div className="card">
        <label>Filter by Property Type</label>
        <select value={propertyTypeFilter} onChange={(e) => setPropertyTypeFilter(e.target.value)}>
          <option value="">All Property Types</option>
          {propertyTypes.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
        </select>
        {missingCostTypes.length > 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            No expected property cost is set for: <b>{missingCostTypes.join(', ')}</b> — subscribers on these
            types show under "Unknown" below until you set a cost under Estates → {estate?.name} → Property Types.
          </p>
        )}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Payment Bracket</th><th>Subscribers</th><th>Total Paid (₦)</th>
              <th>Allocated</th><th>Not Yet Allocated</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span className="tag approved">100% and above</span></td>
              <td>{buckets.hundredPlus.count}</td>
              <td className="right">{buckets.hundredPlus.total.toLocaleString()}</td>
              <td>{buckets.hundredPlus.allocated}</td>
              <td><b>{buckets.hundredPlus.unallocated}</b></td>
            </tr>
            <tr>
              <td><span className="tag PO">60% – 99%</span></td>
              <td>{buckets.sixtyTo99.count}</td>
              <td className="right">{buckets.sixtyTo99.total.toLocaleString()}</td>
              <td>{buckets.sixtyTo99.allocated}</td>
              <td>{buckets.sixtyTo99.unallocated}</td>
            </tr>
            <tr>
              <td><span className="tag rejected">Below 60%</span></td>
              <td>{buckets.belowSixty.count}</td>
              <td className="right">{buckets.belowSixty.total.toLocaleString()}</td>
              <td>{buckets.belowSixty.allocated}</td>
              <td>{buckets.belowSixty.unallocated}</td>
            </tr>
            <tr>
              <td><span className="tag">Unknown (no cost configured)</span></td>
              <td>{buckets.unknown.count}</td>
              <td className="right">{buckets.unknown.total.toLocaleString()}</td>
              <td colSpan={2} className="muted">—</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>What This Means</h3>
        <ul>
          <li>
            <b>{buckets.hundredPlus.unallocated}</b> subscriber(s) have paid 100% or more but have{' '}
            <b>no allocation yet</b> — these are the priority candidates for house allocation.
          </li>
          <li>
            <b>{buckets.sixtyTo99.count}</b> subscriber(s) are at 60–99% — worth reaching out to so they can
            complete payment (₦{buckets.sixtyTo99.total.toLocaleString()} collected from this group so far).
          </li>
          <li>
            <b>{buckets.belowSixty.count}</b> subscriber(s) are below 60%, totalling{' '}
            <b>₦{buckets.belowSixty.total.toLocaleString()}</b> paid — this is the group to consider for a
            refund policy decision.
          </li>
        </ul>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Subscriber</th><th>Property Type</th><th>Paid (₦)</th><th>Expected (₦)</th><th>% Paid</th><th>Allocated?</th></tr>
          </thead>
          <tbody>
            {subscribers.map((s) => {
              const expected = costByType[s.propertyType];
              const pct = expected > 0 ? Math.round((s.paid / expected) * 100) : null;
              return (
                <tr key={s.name}>
                  <td><Link to={`/subscriber/${estateId}/${encodeURIComponent(s.name)}`}>{s.name}</Link></td>
                  <td>{s.propertyType || '—'}</td>
                  <td className="right">{s.paid.toLocaleString()}</td>
                  <td className="right">{expected > 0 ? expected.toLocaleString() : '—'}</td>
                  <td>{pct !== null ? `${pct}%` : '—'}</td>
                  <td>{s.hasAllocation ? '✓' : ''}</td>
                </tr>
              );
            })}
            {subscribers.length === 0 && <tr><td colSpan={6} className="empty-state">No subscriber data found for this estate/property type.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
