import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { buildSubscribers, costByTypeMap, bucketSubscribers } from '../lib/paymentAnalysis';

export default function AnalysisEstatesTab() {
  const [estates, setEstates] = useState([]);
  const [types, setTypes] = useState([]);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const [estatesRes, typesRes, offersRes, allocRes, paymentsRes] = await Promise.all([
      supabase.from('estates').select('*').eq('is_deleted', false).order('name'),
      supabase.from('estate_property_types').select('*'),
      supabase.from('offers').select('estate_id, subscriber_name, property_type, amount_paid').eq('is_deleted', false),
      supabase.from('allocation_records').select('estate_id, subscriber_name, property_type').eq('is_deleted', false),
      supabase.from('payments').select('estate_id, subscriber_name, property_type, payment_type, amount').eq('is_deleted', false),
    ]);
    setEstates(estatesRes.data || []);
    setTypes(typesRes.data || []);
    setOffers(offersRes.data || []);
    setAllocations(allocRes.data || []);
    setPayments(paymentsRes.data || []);
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
      const buckets = bucketSubscribers(subs, costByType);
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

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-title"><h2>Payment Analysis</h2></div>
      <p className="muted">
        Who has paid 100% and above, 60–99%, or below 60% of the expected property cost, cross-referenced
        with whether they've been allocated yet — to help decide who to house, who to follow up with, and who
        may need a refund. Open an estate below for the full subscriber-by-subscriber breakdown.
      </p>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{portfolio.subscribers}</div><div className="label">Subscribers Tracked</div></div>
        <div className="stat-card blue"><div className="value">₦{portfolio.totalPaid.toLocaleString()}</div><div className="label">Total Collected</div></div>
        <div className="stat-card gold"><div className="value">{portfolio.readyForAllocation}</div><div className="label">Fully Paid, Not Yet Allocated</div></div>
        <div className="stat-card grey"><div className="value">{portfolio.belowSixty}</div><div className="label">Below 60% Paid</div></div>
      </div>

      <div className="grid cols-3">
        {perEstate.map(({ estate: e, subscriberCount, totalPaid, buckets, readyForAllocation }) => (
          <Link to={`/analysis/${e.id}`} key={e.id} className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <h3>{e.name}</h3>
            <p className="muted" style={{ marginTop: -8 }}>{(e.category || '').replace(/_/g, ' ')}</p>
            {subscriberCount === 0 ? (
              <p className="muted">No payment data recorded yet.</p>
            ) : (
              <>
                <p><b>{subscriberCount}</b> subscriber{subscriberCount === 1 ? '' : 's'} · <b>₦{totalPaid.toLocaleString()}</b> collected</p>
                <div className="flex wrap" style={{ gap: 6 }}>
                  <span className="tag approved">{buckets.hundredPlus.count} at 100%+</span>
                  <span className="tag PO">{buckets.sixtyTo99.count} at 60–99%</span>
                  <span className="tag rejected">{buckets.belowSixty.count} below 60%</span>
                  {buckets.unknown.count > 0 && <span className="tag">{buckets.unknown.count} unknown cost</span>}
                </div>
                {readyForAllocation > 0 && (
                  <p style={{ marginTop: 8 }}><b>{readyForAllocation}</b> fully paid and awaiting allocation</p>
                )}
              </>
            )}
          </Link>
        ))}
        {estates.length === 0 && <div className="empty-state">No estates yet — create one under Estates first.</div>}
      </div>
    </div>
  );
}
