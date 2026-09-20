import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { allocatePaymentSummary } from '../lib/paymentAnalysis';
import { uploadDocument, getDownloadUrl, deleteDocument } from '../lib/documents';

const PAYMENT_TYPE_LABELS = {
  property: 'Property',
  infrastructure: 'Infrastructure',
  legal_tdp: 'Legal / TDP',
  other: 'Other',
};

const DOC_TYPES = [
  'Payment evidence',
  'Allocation letter',
  'Offer letter',
  'Application for COO',
  'COO payment evidence',
  'TDP / Legal receipt',
  'Other',
];


/** Strip ranks/titles and collapse whitespace for fuzzy name compare */
function normalizePersonName(s) {
  let t = String(s || '').toLowerCase();
  t = t.replace(/[^a-z0-9\s]/g, ' ');
  const titles = [
    'sqn', 'ldr', 'lt', 'col', 'maj', 'gen', 'avm', 'air', 'cdre', 'cdr', 'wg', 'gp', 'capt',
    'flt', 'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'hon', 'engr', 'arc', 'barr', 'alhaji',
    'alh', 'hajiya', 'chief', 'sir', 'lady', 'mwo', 'wo', 'sgt', 'cpl', 'fs', 'acm',
    'cas', 'rtd', 'retired',
  ];
  const parts = t.split(/\s+/).filter(Boolean).filter((w) => !titles.includes(w));
  return parts.join(' ').trim();
}

function namesMatch(a, b) {
  const na = normalizePersonName(a);
  const nb = normalizePersonName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = new Set(na.split(' ').filter((w) => w.length > 1));
  const tb = nb.split(' ').filter((w) => w.length > 1);
  const shared = tb.filter((w) => ta.has(w));
  const need = Math.min(2, Math.min(ta.size, tb.length));
  return shared.length >= need && shared.length > 0;
}

function dedupeByKey(rows, keyFn) {
  const seen = new Set();
  const out = [];
  for (const r of rows || []) {
    const k = keyFn(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

export default function SubscriberProfile() {
  const { estateId, name } = useParams();
  const decodedName = decodeURIComponent(name);
  const { profile } = useAuth();
  const [estate, setEstate] = useState(null);
  const [offers, setOffers] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [payments, setPayments] = useState([]);
  const [feeConfig, setFeeConfig] = useState([]);
  const [docs, setDocs] = useState([]);
  const [cooRows, setCooRows] = useState([]);
  const [refunds, setRefunds] = useState([]);
  const [constructionUnits, setConstructionUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [docFile, setDocFile] = useState(null);
  const [docError, setDocError] = useState('');

  useEffect(() => { load(); }, [estateId, name]);

  async function load() {
    setLoading(true);
    const safeName = decodedName.replace(/,/g, ' ').trim();
    // Use contains-match so slight spacing/title differences still hit the DB
    const pattern = `%${safeName}%`;
    // Also try the longest word in the name (helps when titles differ)
    const tokens = normalizePersonName(safeName).split(' ').filter((w) => w.length >= 3);
    const tokenPattern = tokens.length ? `%${tokens[tokens.length - 1]}%` : pattern;

    const [estateRes, offersRes, allocRes, paymentsRes, feesRes, docsRes, cooRes, refundRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', estateId).single(),
      supabase.from('offers').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', pattern),
      supabase.from('allocation_records').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', pattern),
      supabase.from('payments').select('*').eq('estate_id', estateId).eq('is_deleted', false).ilike('subscriber_name', pattern).order('date_paid', { ascending: true }),
      supabase.from('estate_property_types').select('*').eq('estate_id', estateId),
      supabase
        .from('documents')
        .select('*')
        .eq('is_deleted', false)
        .eq('estate_id', estateId)
        .ilike('subscriber_name', pattern)
        .order('created_at', { ascending: false }),
      supabase
        .from('ownership_changes')
        .select('*')
        .or(`previous_owner.ilike.${pattern},new_owner.ilike.${pattern}`)
        .order('date_changed', { ascending: false }),
      supabase
        .from('refunds')
        .select('*')
        .eq('is_deleted', false)
        .ilike('subscriber_name', pattern)
        .order('date_of_approval', { ascending: false }),
    ]);

    // If payments still empty, broaden search by last name token within this estate
    let paymentRows = paymentsRes.data || [];
    if (paymentRows.length === 0 && tokenPattern !== pattern) {
      const { data: morePay } = await supabase
        .from('payments')
        .select('*')
        .eq('estate_id', estateId)
        .eq('is_deleted', false)
        .ilike('subscriber_name', tokenPattern)
        .order('date_paid', { ascending: true });
      paymentRows = morePay || [];
    }

    // Client-side fuzzy filter so we only keep rows that really belong to this person
    const filterName = (rows, field = 'subscriber_name') =>
      (rows || []).filter((r) => namesMatch(r[field], decodedName));

    let offers = filterName(offersRes.data);
    let allocs = filterName(allocRes.data);
    let pays = filterName(paymentRows);
    // If fuzzy filter removed everything but DB returned rows, keep DB rows (exact-ish contains)
    if (offers.length === 0 && (offersRes.data || []).length) offers = offersRes.data;
    if (allocs.length === 0 && (allocRes.data || []).length) allocs = allocRes.data;
    if (pays.length === 0 && paymentRows.length) pays = paymentRows;

    // Deduplicate identical allocation/offer lines (same house + name)
    offers = dedupeByKey(offers, (r) => `${(r.subscriber_name || '').toLowerCase()}|${r.form_no || ''}|${r.property_type || ''}`);
    allocs = dedupeByKey(allocs, (r) => `${(r.subscriber_name || '').toLowerCase()}|${r.house_no || ''}|${r.property_type || ''}`);

    setEstate(estateRes.data || null);
    setOffers(offers);
    setAllocations(allocs);
    setPayments(pays);
    setFeeConfig(feesRes.data || []);
    setDocs(filterName(docsRes.data).length ? filterName(docsRes.data) : (docsRes.data || []));
    const coo = (cooRes.data || []).filter((c) => {
      if (c.estate_id && c.estate_id !== estateId) return false;
      return namesMatch(c.previous_owner, decodedName) || namesMatch(c.new_owner, decodedName)
        || String(c.previous_owner || '').toLowerCase().includes(safeName.toLowerCase())
        || String(c.new_owner || '').toLowerCase().includes(safeName.toLowerCase());
    });
    setCooRows(coo);
    const ref = (refundRes.data || []).filter((r) => {
      if (r.estate_id && r.estate_id !== estateId) return false;
      return namesMatch(r.subscriber_name, decodedName)
        || String(r.subscriber_name || '').toLowerCase().includes(safeName.toLowerCase());
    });
    setRefunds(ref);

    // Construction units linked by allocated house numbers
    const houseNos = [...new Set(allocs.map((a) => (a.house_no || '').trim()).filter(Boolean))];
    if (houseNos.length) {
      const { data: cu } = await supabase
        .from('construction_units')
        .select('*')
        .eq('estate_id', estateId)
        .eq('is_deleted', false)
        .in('house_no', houseNos);
      setConstructionUnits(cu || []);
    } else {
      setConstructionUnits([]);
    }
    setLoading(false);
  }

  async function handleUploadDoc(e) {
    e.preventDefault();
    setDocError('');
    if (!docFile) { setDocError('Choose a file.'); return; }
    setUploading(true);
    const { error } = await uploadDocument({
      file: docFile,
      description: docType,
      uploadedBy: profile.id,
      linkedTable: 'subscriber',
      estateId,
      subscriberName: decodedName,
    });
    setUploading(false);
    if (error) { setDocError(error.message); return; }
    setDocFile(null);
    load();
  }

  async function handleDownload(doc) {
    const url = await getDownloadUrl(doc.storage_path);
    if (url) window.open(url, '_blank');
    else alert('Could not generate download link.');
  }

  async function handleDeleteDoc(doc) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    await deleteDocument(doc.id, doc.storage_path);
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;

  const propertyTypes = [...new Set([
    ...offers.map((o) => o.property_type).filter(Boolean),
    ...allocations.map((a) => a.property_type).filter(Boolean),
    ...payments.map((p) => p.property_type).filter(Boolean),
  ])];

  const phone = offers.find((o) => o.phone_number)?.phone_number
    || allocations.find((a) => a.phone_number)?.phone_number;
  const email = offers.find((o) => o.email_address)?.email_address;

  const { expected, paid } = allocatePaymentSummary(payments, offers, feeConfig, propertyTypes);

  const propertyPct = expected.property > 0
    ? Math.round((paid.property / expected.property) * 100)
    : null;
  const tdpPct = expected.legal_tdp > 0
    ? Math.round((paid.legal_tdp / expected.legal_tdp) * 100)
    : null;
  const infraPct = expected.infrastructure > 0
    ? Math.round((paid.infrastructure / expected.infrastructure) * 100)
    : null;

  const totalRefunded = refunds.reduce((s, r) => s + Number(r.amount_approved || 0), 0);
  const totalCooFees = cooRows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const totalPaidAll = (paid.property || 0) + (paid.infrastructure || 0) + (paid.legal_tdp || 0) + (paid.other || 0);
  const totalExpectedAll = (expected.property || 0) + (expected.infrastructure || 0) + (expected.legal_tdp || 0);

  // Compact headline for the right-hand summary card
  const summaryBits = [];
  if (propertyPct !== null) summaryBits.push(`Prop ${propertyPct}%`);
  else if (paid.property > 0) summaryBits.push(`Prop ₦${paid.property.toLocaleString()}`);
  if (paid.legal_tdp > 0 || expected.legal_tdp > 0) {
    summaryBits.push(tdpPct !== null ? `TDP ${tdpPct}%` : `TDP ₦${paid.legal_tdp.toLocaleString()}`);
  }
  if (paid.infrastructure > 0 || expected.infrastructure > 0) {
    summaryBits.push(infraPct !== null ? `Infra ${infraPct}%` : `Infra ₦${paid.infrastructure.toLocaleString()}`);
  }
  if (paid.other > 0) summaryBits.push(`Other ₦${paid.other.toLocaleString()}`);
  if (totalRefunded > 0) summaryBits.push(`Refund ₦${totalRefunded.toLocaleString()}`);
  if (totalCooFees > 0) summaryBits.push(`COO ₦${totalCooFees.toLocaleString()}`);

  const allRemarks = [
    ...offers.map((o) => o.comment).filter(Boolean),
    ...offers.map((o) => o.remarks).filter(Boolean),
    ...allocations.map((a) => a.remarks).filter(Boolean),
    ...payments.map((p) => p.remarks).filter(Boolean),
    ...refunds.map((r) => r.remarks || r.reason).filter(Boolean),
    ...cooRows.map((c) => c.comments || c.reason).filter(Boolean),
  ];

  function formatBalance(exp, paidAmt) {
    if (!(exp > 0)) return '—';
    return (exp - paidAmt).toLocaleString();
  }

  function formatPct(exp, paidAmt) {
    if (!(exp > 0)) return '—';
    return `${Math.round((paidAmt / exp) * 100)}%`;
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to={`/estates/${estateId}`} className="muted">&larr; {estate?.name}</Link>
          <h2>{decodedName}</h2>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card">
          <div className="value" style={{ fontSize: propertyTypes.join(', ').length > 24 ? 16 : undefined }}>
            {propertyTypes.join(', ') || '—'}
          </div>
          <div className="label">Property Type(s)</div>
        </div>
        <div className="stat-card blue">
          <div className="value">
            {offers.length > 0 ? (offers[0].offer_collected ? 'Collected' : 'Not Collected') : 'No Offer'}
          </div>
          <div className="label">Offer Status</div>
        </div>
        <div className="stat-card gold">
          <div className="value">
            {allocations.length > 0 ? (allocations[0].collected ? 'Collected' : 'Not Collected') : 'No Allocation'}
          </div>
          <div className="label">Allocation Status</div>
        </div>
        <div className="stat-card grey">
          <div className="value" style={{ fontSize: summaryBits.length > 2 ? 15 : undefined, lineHeight: 1.25 }}>
            {summaryBits.length > 0 ? summaryBits.join(' · ') : '—'}
          </div>
          <div className="label">Financial Summary</div>
        </div>
      </div>

      <div className="card">
        <h3>Subscription workflow status</h3>
        <div className="flex wrap" style={{ gap: 8 }}>
          {[
            { label: 'Offer on file', ok: offers.length > 0 },
            { label: 'Offer printed', ok: offers.some((o) => o.offer_printed) },
            { label: 'Offer collected', ok: offers.some((o) => o.offer_collected) },
            { label: 'Payments recorded', ok: payments.length > 0 || paid.property > 0 },
            { label: 'Property fully paid', ok: expected.property > 0 && paid.property >= expected.property },
            { label: 'TDP settled', ok: expected.legal_tdp <= 0 || paid.legal_tdp >= expected.legal_tdp },
            { label: 'Allocated (FA)', ok: allocations.length > 0 },
            { label: 'FA collected', ok: allocations.some((a) => a.collected) },
            { label: 'Construction linked', ok: constructionUnits.length > 0 },
          ].map((s) => (
            <span
              key={s.label}
              className={s.ok ? 'tag approved' : 'tag'}
              style={{ opacity: s.ok ? 1 : 0.55 }}
            >
              {s.ok ? '✓' : '○'} {s.label}
            </span>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Complete Financial Commitment</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th className="right">Expected</th>
                <th className="right">Paid / Done</th>
                <th className="right">Balance</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Property</td>
                <td className="right">{expected.property > 0 ? expected.property.toLocaleString() : <span className="muted">Not set</span>}</td>
                <td className="right">{paid.property.toLocaleString()}</td>
                <td className="right">{formatBalance(expected.property, paid.property)}</td>
                <td>
                  {formatPct(expected.property, paid.property)}
                  {expected.property > 0 && paid.property >= expected.property && (
                    <span className="tag approved" style={{ marginLeft: 6 }}>Complete</span>
                  )}
                  {expected.property > 0 && paid.property > expected.property && (
                    <span className="tag approved" style={{ marginLeft: 6 }}>Overpaid</span>
                  )}
                </td>
              </tr>
              <tr>
                <td>Infrastructure</td>
                <td className="right">{expected.infrastructure > 0 ? expected.infrastructure.toLocaleString() : <span className="muted">Not set</span>}</td>
                <td className="right">{paid.infrastructure.toLocaleString()}</td>
                <td className="right">{formatBalance(expected.infrastructure, paid.infrastructure)}</td>
                <td>{formatPct(expected.infrastructure, paid.infrastructure)}</td>
              </tr>
              <tr>
                <td>Legal / TDP</td>
                <td className="right">{expected.legal_tdp > 0 ? expected.legal_tdp.toLocaleString() : <span className="muted">Not set</span>}</td>
                <td className="right">{paid.legal_tdp.toLocaleString()}</td>
                <td className="right">{formatBalance(expected.legal_tdp, paid.legal_tdp)}</td>
                <td>
                  {formatPct(expected.legal_tdp, paid.legal_tdp)}
                  {paid.legal_tdp > 0 && expected.legal_tdp > 0 && paid.legal_tdp >= expected.legal_tdp && (
                    <span className="tag approved" style={{ marginLeft: 6 }}>TDP paid</span>
                  )}
                  {paid.legal_tdp === 0 && expected.legal_tdp > 0 && (
                    <span className="tag PO" style={{ marginLeft: 6 }}>TDP outstanding</span>
                  )}
                </td>
              </tr>
              {paid.other > 0 && (
                <tr>
                  <td>Other payments</td>
                  <td className="right">—</td>
                  <td className="right">{paid.other.toLocaleString()}</td>
                  <td className="right">—</td>
                  <td><span className="tag">Recorded</span></td>
                </tr>
              )}
              <tr>
                <td><b>Total payments in</b></td>
                <td className="right">{totalExpectedAll > 0 ? totalExpectedAll.toLocaleString() : '—'}</td>
                <td className="right"><b>{totalPaidAll.toLocaleString()}</b></td>
                <td className="right">{totalExpectedAll > 0 ? (totalExpectedAll - totalPaidAll).toLocaleString() : '—'}</td>
                <td />
              </tr>
              <tr>
                <td>Refunds issued</td>
                <td className="right">—</td>
                <td className="right">{totalRefunded > 0 ? totalRefunded.toLocaleString() : '0'}</td>
                <td className="right">—</td>
                <td>
                  {refunds.length > 0
                    ? <span className="tag rejected">{refunds.length} refund(s)</span>
                    : <span className="muted">None</span>}
                </td>
              </tr>
              <tr>
                <td>Change of Ownership (COO) fees</td>
                <td className="right">—</td>
                <td className="right">{totalCooFees > 0 ? totalCooFees.toLocaleString() : '0'}</td>
                <td className="right">—</td>
                <td>
                  {cooRows.length > 0
                    ? <span className="tag PO">{cooRows.length} COO record(s)</span>
                    : <span className="muted">None</span>}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
            <p key={o.id}>
              Offer: {o.offer_collected
                ? `Collected by ${o.offer_collected_by || 'unrecorded'}${o.offer_collected_date ? ` on ${o.offer_collected_date}` : ''}`
                : 'Not yet collected'}
            </p>
          ))}
          {allocations.map((a) => (
            <p key={a.id}>
              Allocation ({a.house_no || 'no house no'}): {a.collected
                ? `Collected by ${a.collected_by || 'unrecorded'}${a.collected_date ? ` on ${a.collected_date}` : ''}`
                : 'Not yet collected'}
            </p>
          ))}
          {offers.length === 0 && allocations.length === 0 && (
            <p className="muted">No offer or allocation record found for this name in this estate.</p>
          )}
        </div>
      </div>

      <div className="card">
        <h3>Payments Summary</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fee Type</th>
                <th className="right">Expected</th>
                <th className="right">Paid</th>
                <th className="right">Balance</th>
                <th>% Paid</th>
              </tr>
            </thead>
            <tbody>
              {['property', 'infrastructure', 'legal_tdp'].map((t) => {
                const exp = expected[t] || 0;
                const paidAmt = paid[t] || 0;
                return (
                  <tr key={t}>
                    <td>{PAYMENT_TYPE_LABELS[t]}</td>
                    <td className="right">
                      {exp > 0 ? exp.toLocaleString() : <span className="muted">Not configured</span>}
                    </td>
                    <td className="right">{paidAmt.toLocaleString()}</td>
                    <td className="right">{formatBalance(exp, paidAmt)}</td>
                    <td>
                      {formatPct(exp, paidAmt)}
                      {exp > 0 && paidAmt > exp && (
                        <span className="tag approved" style={{ marginLeft: 6 }}>Overpaid</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {paid.other > 0 && (
                <tr>
                  <td>Other</td>
                  <td className="right">—</td>
                  <td className="right">{paid.other.toLocaleString()}</td>
                  <td className="right">—</td>
                  <td>—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {expected.property === 0 && expected.infrastructure === 0 && expected.legal_tdp === 0 && (
          <p className="muted" style={{ marginTop: 8 }}>
            No expected fee amounts match <b>{propertyTypes.join(', ') || 'this property type'}</b> in {estate?.name}.
            Go to <b>Estates → {estate?.name} → Property Types</b> and enter the Expected Property Cost
            (use the same label as above, e.g. &quot;3 Bedroom Terrace - Old Rate&quot;).
          </p>
        )}
        <p className="muted" style={{ marginTop: 8 }}>
          Legal/TDP is only counted when a payment is recorded with type <b>Legal / TDP</b> (receipt collected).
          Extra amounts paid above the property cost show as a negative balance and % above 100 — they are not
          auto-moved into TDP.
        </p>
      </div>

      <div className="card">
        <h3>Payment History</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: '15%' }}>Date</th>
                <th style={{ width: '15%' }}>Type</th>
                <th style={{ width: '20%', textAlign: 'right' }}>Amount (₦)</th>
                <th style={{ width: '20%' }}>Reference</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => {
                const t = String(p.payment_type || 'property').toLowerCase();
                let label = PAYMENT_TYPE_LABELS[t] || p.payment_type || 'Property';
                if (t.includes('tdp') || t.includes('legal')) label = 'Legal / TDP';
                else if (t.includes('infra')) label = 'Infrastructure';
                else if (t === 'other') label = 'Other';
                else label = 'Property';
                return (
                  <tr key={p.id}>
                    <td>{p.date_paid || '—'}</td>
                    <td>{label}</td>
                    <td className="right" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {Number(p.amount || 0).toLocaleString()}
                    </td>
                    <td>{p.payment_reference || '—'}</td>
                    <td>{p.remarks || '—'}</td>
                  </tr>
                );
              })}
              {payments.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No payment entries found for this name in this estate.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Refunds</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th className="right">Amount Refunded (₦)</th>
                <th>Property Type</th>
                <th>Reason</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td>{r.date_of_approval || '—'}</td>
                  <td className="right"><b>{Number(r.amount_approved || 0).toLocaleString()}</b></td>
                  <td>{r.property_type || '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td>{r.remarks || '—'}</td>
                </tr>
              ))}
              {refunds.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No refunds recorded for this subscriber in this estate.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Change of Ownership (COO)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Previous Owner</th>
                <th>New Owner</th>
                <th className="right">COO Fee (₦)</th>
                <th>Reason</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {cooRows.map((c) => (
                <tr key={c.id}>
                  <td>{c.date_changed || '—'}</td>
                  <td>{c.previous_owner}</td>
                  <td>{c.new_owner}</td>
                  <td className="right">{Number(c.amount_paid || 0).toLocaleString()}</td>
                  <td>{c.reason || '—'}</td>
                  <td>{c.comments || c.remarks || '—'}</td>
                </tr>
              ))}
              {cooRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-state">
                    No COO records for this name in this estate. Record one from Allocations → the house row → <b>Record COO</b>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Construction / Contractor</h3>
        {constructionUnits.length === 0 ? (
          <p className="muted">
            No construction unit linked. When this subscriber has a house number on their allocation
            and that unit exists under <b>Construction</b>, the contractor appears here.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>House No</th>
                  <th>Property type</th>
                  <th>Contractor</th>
                  <th>Phone</th>
                  <th>Status of work</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {constructionUnits.map((u) => (
                  <tr key={u.id}>
                    <td><b>{u.house_no}</b></td>
                    <td>{u.property_type || '—'}</td>
                    <td>{u.contractor_name || '—'}</td>
                    <td>{u.contractor_phone || '—'}</td>
                    <td>{u.status_of_work || '—'}</td>
                    <td>{u.remarks || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Subscriber Documents</h3>
        <p className="muted">
          Attach payment evidence, allocation letter, offer letter, COO application, receipts, etc.
        </p>
        <form onSubmit={handleUploadDoc} className="flex wrap" style={{ gap: 12, alignItems: 'flex-end', marginBottom: 16 }}>
          <div className="field" style={{ minWidth: 180 }}>
            <label>Document type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)}>
              {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label>File</label>
            <input type="file" onChange={(e) => setDocFile(e.target.files?.[0] || null)} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={uploading}>
            {uploading ? 'Uploading…' : 'Upload'}
          </button>
        </form>
        {docError && <div className="error-text">{docError}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Type / Description</th>
                <th>File</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.description || '—'}</td>
                  <td>{d.file_name}</td>
                  <td>{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => handleDownload(d)}>Download</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteDoc(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={4} className="empty-state">No documents attached yet.</td></tr>
              )}
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
        This report matches the subscriber&apos;s name (case-insensitive) across Offers, Allocations, and Payments
        for <b>{estate?.name}</b> only. Slightly different spellings will not match — correct the source record if needed.
      </p>
    </div>
  );
}
