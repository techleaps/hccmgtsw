import React, { useEffect, useMemo, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';
import { buildSubscribers, costByTypeMap, bucketSubscribers, breakdownByPropertyType, findLikelyDoublePayments } from '../lib/paymentAnalysis';

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
    const [estateRes, typesRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', estateId).single(),
      supabase.from('estate_property_types').select('*').eq('estate_id', estateId),
    ]);
    setEstate(estateRes.data || null);
    setTypes(typesRes.data || []);

    const [offersAll, allocAll, paymentsAll] = await Promise.all([
      fetchAllFrom('offers', (q) =>
        q.select('subscriber_name, property_type, amount_paid').eq('estate_id', estateId).eq('is_deleted', false)
      ),
      fetchAllFrom('allocation_records', (q) =>
        q.select('subscriber_name, property_type').eq('estate_id', estateId).eq('is_deleted', false)
      ),
      fetchAllFrom('payments', (q) =>
        q.select('id, subscriber_name, property_type, payment_type, amount, date_paid, payment_reference').eq('estate_id', estateId).eq('is_deleted', false)
      ),
    ]);
    setOffers(offersAll);
    setAllocations(allocAll);
    setPayments(paymentsAll);
    setLoading(false);
  }

  const allSubscribers = useMemo(
    () => buildSubscribers(offers, allocations, payments),
    [offers, allocations, payments]
  );

  const subscribers = useMemo(
    () => (propertyTypeFilter ? allSubscribers.filter((s) => s.propertyType === propertyTypeFilter) : allSubscribers),
    [allSubscribers, propertyTypeFilter]
  );

  const costByType = useMemo(() => costByTypeMap(types), [types]);

  const buckets = useMemo(() => bucketSubscribers(subscribers, costByType, types), [subscribers, costByType, types]);

  const typeBreakdown = useMemo(
    () => breakdownByPropertyType(allSubscribers, costByType, types),
    [allSubscribers, costByType, types]
  );

  const doublePay = useMemo(() => findLikelyDoublePayments(payments), [payments]);

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

      {doublePay.flagCount > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2' }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>⚠ Possible double / repeated payments</h3>
          <p className="muted">
            Review these before relying on totals. Exact matches mean the same person, amount and date
            appear more than once (often from re-importing a cumulative file). Repeated same amount
            (3+ times) may also need a check.
          </p>
          <div className="grid cols-2">
            <div>
              <b>Exact duplicates</b> ({doublePay.exactDupes.length} groups, {doublePay.totalExactDuapeRows} payment lines)
              <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto', marginTop: 8 }}>
                <table>
                  <thead>
                    <tr><th>Subscriber</th><th className="right">Amount</th><th>Date</th><th>Times</th><th></th></tr>
                  </thead>
                  <tbody>
                    {doublePay.exactDupes.slice(0, 50).map((d, i) => (
                      <tr key={i}>
                        <td>{d.name}</td>
                        <td className="right">{d.amount.toLocaleString()}</td>
                        <td>{d.date_paid}</td>
                        <td><span className="tag rejected">{d.count}×</span></td>
                        <td>
                          <Link className="btn btn-outline btn-sm" to={`/subscriber/${estateId}/${encodeURIComponent(d.name)}`}>
                            Profile
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {doublePay.exactDupes.length === 0 && (
                      <tr><td colSpan={5} className="muted">None</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div>
              <b>Same amount 3+ times</b> ({doublePay.repeatedSameAmount.length})
              <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto', marginTop: 8 }}>
                <table>
                  <thead>
                    <tr><th>Subscriber</th><th className="right">Amount</th><th>Times</th><th></th></tr>
                  </thead>
                  <tbody>
                    {doublePay.repeatedSameAmount.slice(0, 50).map((d, i) => (
                      <tr key={i}>
                        <td>{d.name}</td>
                        <td className="right">{d.amount.toLocaleString()}</td>
                        <td><span className="tag PO">{d.times}×</span></td>
                        <td>
                          <Link className="btn btn-outline btn-sm" to={`/subscriber/${estateId}/${encodeURIComponent(d.name)}`}>
                            Profile
                          </Link>
                        </td>
                      </tr>
                    ))}
                    {doublePay.repeatedSameAmount.length === 0 && (
                      <tr><td colSpan={4} className="muted">None</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

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
        <h3>Breakdown by Property Type</h3>
        <p className="muted" style={{ marginTop: -8 }}>
          Each exact Property Type label (e.g. separate "Old Rate" / "New Rate" entries for the same house type)
          gets its own line here, each measured against its own Expected Property Cost.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Property Type</th><th>Subscribers</th><th>Expected Cost (₦)</th>
                <th>Total Collected (₦)</th><th>Total Expected (₦)</th><th>Fully Paid</th><th>Allocated</th>
              </tr>
            </thead>
            <tbody>
              {typeBreakdown.map((row) => (
                <tr key={row.propertyType}>
                  <td>{row.propertyType}</td>
                  <td>{row.count}</td>
                  <td className="right">{row.expectedCost > 0 ? row.expectedCost.toLocaleString() : <span className="muted">Not set</span>}</td>
                  <td className="right">{row.totalPaid.toLocaleString()}</td>
                  <td className="right">{row.totalExpected > 0 ? row.totalExpected.toLocaleString() : '—'}</td>
                  <td>{row.expectedCost > 0 ? `${row.fullyPaidCount} / ${row.count}` : '—'}</td>
                  <td>{row.allocatedCount} / {row.count}</td>
                </tr>
              ))}
              {typeBreakdown.length === 0 && <tr><td colSpan={7} className="empty-state">No subscriber data found for this estate.</td></tr>}
            </tbody>
          </table>
        </div>
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
