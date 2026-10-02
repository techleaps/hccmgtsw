import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';
import { buildSubscribers, costByTypeMap, bucketSubscribers } from '../lib/paymentAnalysis';

export default function AnalysisEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [types, setTypes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [estatesRes, typesRes] = await Promise.all([
        supabase.from('estates').select('*').eq('is_deleted', false).order('name'),
        supabase.from('estate_property_types').select('*'),
      ]);
      setEstates(estatesRes.data || []);
      setTypes(typesRes.data || []);

      // Full datasets — page past the 1000-row default
      const [offersAll, allocAll, paymentsAll] = await Promise.all([
        fetchAllFrom('offers', (q) =>
          q.select('estate_id, subscriber_name, property_type, amount_paid').eq('is_deleted', false)
        ),
        fetchAllFrom('allocation_records', (q) =>
          q.select('estate_id, subscriber_name, property_type').eq('is_deleted', false)
        ),
        fetchAllFrom('payments', (q) =>
          q.select('estate_id, subscriber_name, property_type, payment_type, amount').eq('is_deleted', false)
        ),
      ]);
      setOffers(offersAll);
      setAllocations(allocAll);
      setPayments(paymentsAll);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Failed to load analysis data');
    }
    setLoading(false);
  }

  const perEstate = useMemo(() => {
    return estates.map((e) => {
      const eTypes = types.filter((t) => t.estate_id === e.id);
      const eOffers = offers.filter((o) => o.estate_id === e.id);
      const eAlloc = allocations.filter((a) => a.estate_id === e.id);
      const ePayments = payments.filter((p) => p.estate_id === e.id);
      const subs = buildSubscribers(eOffers, eAlloc, ePayments);
      const costByType = costByTypeMap(eTypes);
      const buckets = bucketSubscribers(subs, costByType, eTypes);
      const totalPaid = subs.reduce((s, r) => s + r.paid, 0);
      const readyForAllocation = buckets.hundredPlus.unallocated;
      return { estate: e, subscriberCount: subs.length, totalPaid, buckets, readyForAllocation };
    });
  }, [estates, types, offers, allocations, payments]);

  const portfolio = useMemo(() => {
    return perEstate.reduce((acc, row) => {
      acc.subscribers += row.subscriberCount;
      acc.totalPaid += row.totalPaid;
      acc.hundredPlus += row.buckets.hundredPlus.count;
      acc.readyForAllocation += row.readyForAllocation;
      acc.belowSixty += row.buckets.belowSixty.count;
      return acc;
    }, { subscribers: 0, totalPaid: 0, hundredPlus: 0, readyForAllocation: 0, belowSixty: 0 });
  }, [perEstate]);

  if (loading) return <p className="muted">Loading full payment data (this may take a moment)…</p>;
  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="page-title"><h2>Payment Analysis</h2></div>
      <p className="muted">
        Who has paid 100% and above, 60–99%, or below 60% of the expected property cost, cross-referenced
        with whether they&apos;ve been allocated yet — to help decide who to house, who to follow up with, and who
        may need a refund. Open an estate below for the full subscriber-by-subscriber breakdown.
      </p>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{portfolio.subscribers.toLocaleString()}</div><div className="label">Subscribers Tracked</div></div>
        <div className="stat-card blue"><div className="value">₦{portfolio.totalPaid.toLocaleString()}</div><div className="label">Total Collected</div></div>
        <div className="stat-card gold"><div className="value">{portfolio.readyForAllocation.toLocaleString()}</div><div className="label">Fully Paid, Not Yet Allocated</div></div>
        <div className="stat-card grey"><div className="value">{portfolio.belowSixty.toLocaleString()}</div><div className="label">Below 60% Paid</div></div>
      </div>

      <div className="grid cols-3">
        {perEstate.map(({ estate: e, subscriberCount, totalPaid, buckets, readyForAllocation }) => (
          <Link
            to={`/analysis/${e.id}`}
            key={e.id}
            className="card"
            style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
          >
            <h3>{e.name}</h3>
            <p className="muted">{subscriberCount.toLocaleString()} subscribers · ₦{totalPaid.toLocaleString()} collected</p>
            <div className="flex wrap" style={{ gap: 6 }}>
              <span className="tag approved">100%+: {buckets.hundredPlus.count}</span>
              <span className="tag PO">60–99%: {buckets.sixtyTo99.count}</span>
              <span className="tag rejected">&lt;60%: {buckets.belowSixty.count}</span>
            </div>
            <p style={{ marginTop: 8 }}>
              <b>{readyForAllocation}</b> fully paid, not yet allocated
            </p>
            {totalPaid === 0 && subscriberCount === 0 && (
              <p className="muted" style={{ marginTop: 6 }}>No payment data recorded yet.</p>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
