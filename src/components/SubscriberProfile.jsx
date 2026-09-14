import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';

const PAYMENT_TYPE_LABELS = { property: 'Property', infrastructure: 'Infrastructure', legal_tdp: 'Legal / TDP', other: 'Other' };

export default function SubscriberProfile() {
  const { estateId, name } = useParams();
  const decodedName = decodeURIComponent(name);
  const [estate, setEstate] = useState(null);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [feeConfig, setFeeConfig] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, [estateId, name]);

  async function load() {
    setLoading(true);
    const [estateRes, offersRes, allocRes, paymentsRes, feesRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', estateId).single(),
      supabase.from('offers').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', decodedName),
      supabase.from('allocation_records').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', decodedName),
      supabase.from('payments').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', decodedName).order('date_paid', { ascending: true }),
      supabase.from('estate_property_types').select('*').eq('estate_id', estateId),
    ]);
    setEstate(estateRes.data || null);
    setOffers(offersRes.data || []);
    setAllocations(allocRes.data || []);
    setPayments(paymentsRes.data || []);
    setFeeConfig(feesRes.data || []);
    setLoading(false);
  }

  if (loading) return <p className="muted">Loading…</p>;

  const propertyTypes = [...new Set([
    ...offers.map((o) => o.property_type).filter(Boolean),
    ...allocations.map((a) => a.property_type).filter(Boolean),
  ])];
  const phone = offers.find((o) => o.phone_number)?.phone_number || allocations.find((a) => a.phone_number)?.phone_number;
  const email = offers.find((o) => o.email_address)?.email_address;

  const paidByType = { property: 0, infrastructure: 0, legal_tdp: 0, other: 0 };
  payments.forEach((p) => { paidByType[p.payment_type] = (paidByType[p.payment_type] || 0) + Number(p.amount || 0); });
  // fold the legacy "Amount Paid" field on the Offer itself into Property payments too
  const offerAmounts = offers.reduce((s, o) => s + Number(o.amount_paid || 0), 0);
  paidByType.property += offerAmounts;

  // expected fees: sum across every property type this subscriber holds here
  const expected = { property: 0, infrastructure: 0, legal_tdp: 0 };
  propertyTypes.forEach((pt) => {
    const cfg = feeConfig.find((f) => f.property_type === pt);
    if (cfg) {
      expected.property += Number(cfg.expected_property_cost || 0);
      expected.infrastructure += Number(cfg.expected_infrastructure_fee || 0);
      expected.legal_tdp += Number(cfg.expected_legal_tdp_fee || 0);
    }
  });

  const propertyPct = expected.property > 0 ? Math.round((paidByType.property / expected.property) * 100) : null;
  const allRemarks = [
    ...offers.map((o) => o.comment).filter(Boolean),
    ...offers.map((o) => o.remarks).filter(Boolean),
    ...allocations.map((a) => a.remarks).filter(Boolean),
    ...payments.map((p) => p.remarks).filter(Boolean),
  ];

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to={`/estates/${estateId}`} className="muted">&larr; {estate?.name}</Link>
          <h2>{decodedName}</h2>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{propertyTypes.join(', ') || '—'}</div><div className="label">Property Type(s)</div></div>
        <div className="stat-card blue"><div className="value">{offers.length > 0 ? (offers[0].offer_collected ? 'Collected' : 'Not Collected') : 'No Offer'}</div><div className="label">Offer Status</div></div>
        <div className="stat-card gold"><div className="value">{allocations.length > 0 ? (allocations[0].collected ? 'Collected' : 'Not Collected') : 'No Allocation'}</div><div className="label">Allocation Status</div></div>
        <div className="stat-card grey"><div className="value">{propertyPct !== null ? `${propertyPct}%` : '—'}</div><div className="label">Property Cost Paid</div></div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <h3>Contact &amp; Identification</h3>
          <p><b>Phone:</b> {phone || '—'}</p>
          <p><b>Email:</b> {email || '—'}</p>
          <p><b>Form No / PON:</b> {offers.map((o) => o.form_no).filter(Boolean).join(', ') || '—'}</p>
          <p><b>House No:</b> {allocations.map((a) => a.house_no).filter(Boolean).join(', ') || '—'}</p>
        </div>
        <div className="card">
          <h3>Who Collected What</h3>
          {offers.map((o) => (
            <p key={o.id}>Offer: {o.offer_collected ? `Collected by ${o.offer_collected_by || 'unrecorded'}${o.offer_collected_date ? ` on ${o.offer_collected_date}` : ''}` : 'Not yet collected'}</p>
          ))}
          {allocations.map((a) => (
            <p key={a.id}>Allocation ({a.house_no || 'no house no'}): {a.collected ? `Collected by ${a.collected_by || 'unrecorded'}${a.collected_date ? ` on ${a.collected_date}` : ''}` : 'Not yet collected'}</p>
          ))}
          {offers.length === 0 && allocations.length === 0 && <p className="muted">No offer or allocation record found for this name in this estate.</p>}
        </div>
      </div>

      <div className="card">
        <h3>Payments Summary</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Fee Type</th><th>Expected</th><th>Paid</th><th>Balance</th><th>% Paid</th></tr></thead>
            <tbody>
              {['property', 'infrastructure', 'legal_tdp'].map((t) => {
                const exp = expected[t];
                const paid = paidByType[t] || 0;
                const pct = exp > 0 ? Math.round((paid / exp) * 100) : null;
                return (
                  <tr key={t}>
                    <td>{PAYMENT_TYPE_LABELS[t]}</td>
                    <td className="right">{exp > 0 ? exp.toLocaleString() : 'Not configured'}</td>
                    <td className="right">{paid.toLocaleString()}</td>
                    <td className="right">{exp > 0 ? Math.max(exp - paid, 0).toLocaleString() : '—'}</td>
                    <td>{pct !== null ? `${pct}%` : '—'}</td>
                  </tr>
                );
              })}
              {paidByType.other > 0 && (
                <tr><td>Other</td><td className="right">—</td><td className="right">{paidByType.other.toLocaleString()}</td><td className="right">—</td><td>—</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {expected.property === 0 && expected.infrastructure === 0 && expected.legal_tdp === 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            No expected fee amounts are configured yet for {propertyTypes.join(', ') || 'this property type'} in {estate?.name}.
            Set them under Estates → {estate?.name} → Property Types to see accurate percentages here.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Payment History</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Amount</th><th>Reference</th><th>Remarks</th></tr></thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id}>
                  <td>{p.date_paid || '—'}</td>
                  <td>{PAYMENT_TYPE_LABELS[p.payment_type] || p.payment_type}</td>
                  <td className="right">{Number(p.amount || 0).toLocaleString()}</td>
                  <td>{p.payment_reference}</td>
                  <td>{p.remarks}</td>
                </tr>
              ))}
              {payments.length === 0 && <tr><td colSpan={5} className="empty-state">No payment entries found for this name in this estate.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {allRemarks.length > 0 && (
        <div className="card">
          <h3>All Comments &amp; Remarks on File</h3>
          <ul>
            {allRemarks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}

      <p className="muted">
        This report is built by matching the subscriber's name (spelling must match exactly, aside from
        upper/lower case) across the Offers, Allocations, and Payments records for <b>{estate?.name}</b> only.
        If this subscriber has records under a slightly different spelling, or in another estate, those
        won't appear here — search that estate separately, or correct the spelling on the source record.
      </p>
    </div>
  );
}
