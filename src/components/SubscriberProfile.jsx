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
  const [editingCoo, setEditingCoo] = useState(null);
  const [cooForm, setCooForm] = useState({});
  const [editingPayment, setEditingPayment] = useState(null);
  const [payForm, setPayForm] = useState({});
  const [recordBusy, setRecordBusy] = useState(false);
  const [recordError, setRecordError] = useState('');

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
    // Do NOT fall back to all DB rows — that mixed other subscribers into this profile.

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


  function openEditCoo(c) {
    setEditingCoo(c);
    setRecordError('');
    setCooForm({
      previous_owner: c.previous_owner || '',
      new_owner: c.new_owner || '',
      date_changed: c.date_changed ? String(c.date_changed).slice(0, 10) : '',
      property_type: c.property_type || '',
      status: c.status || '',
      new_allocation_no: c.new_allocation_no || c.new_pon || '',
      amount_paid: c.amount_paid ?? '',
      reason: c.reason || '',
      remarks: c.remarks || '',
      comments: c.comments || '',
    });
  }

  async function saveCoo(e) {
    e.preventDefault();
    if (!editingCoo) return;
    setRecordBusy(true);
    setRecordError('');
    const { error } = await supabase.from('ownership_changes').update({
      previous_owner: cooForm.previous_owner.trim(),
      new_owner: cooForm.new_owner.trim(),
      date_changed: cooForm.date_changed || null,
      property_type: cooForm.property_type || null,
      status: cooForm.status || null,
      new_allocation_no: cooForm.new_allocation_no || null,
      amount_paid: Number(cooForm.amount_paid) || 0,
      reason: cooForm.reason || null,
      remarks: cooForm.remarks || null,
      comments: cooForm.comments || null,
    }).eq('id', editingCoo.id);
    setRecordBusy(false);
    if (error) { setRecordError(error.message); return; }
    setEditingCoo(null);
    load();
  }

  async function deleteCoo(c) {
    if (!confirm('Delete this COO record permanently?')) return;
    const { error } = await supabase.from('ownership_changes').delete().eq('id', c.id);
    if (error) { alert(error.message); return; }
    setEditingCoo(null);
    load();
  }

  function openEditPayment(p) {
    setEditingPayment(p);
    setRecordError('');
    setPayForm({
      amount: p.amount ?? '',
      date_paid: p.date_paid ? String(p.date_paid).slice(0, 10) : '',
      payment_type: p.payment_type || 'property',
      property_type: p.property_type || '',
      payment_reference: p.payment_reference || '',
      remarks: p.remarks || '',
    });
  }

  async function savePayment(e) {
    e.preventDefault();
    if (!editingPayment) return;
    setRecordBusy(true);
    setRecordError('');
    const { error } = await supabase.from('payments').update({
      amount: Number(payForm.amount) || 0,
      date_paid: payForm.date_paid || null,
      payment_type: payForm.payment_type || 'property',
      property_type: payForm.property_type || null,
      payment_reference: payForm.payment_reference || null,
      remarks: payForm.remarks || null,
    }).eq('id', editingPayment.id);
    setRecordBusy(false);
    if (error) { setRecordError(error.message); return; }
    setEditingPayment(null);
    load();
  }

  async function deletePayment(p) {
    if (!confirm('Delete this payment record?')) return;
    const { error } = await supabase.from('payments').update({ is_deleted: true }).eq('id', p.id);
    if (error) { alert(error.message); return; }
    setEditingPayment(null);
    load();
  }

  async function handleDeleteDoc(doc) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    await deleteDocument(doc.id, doc.storage_path);
    load();
  }

  if (loading) return <p className="muted">Loading…</p>;

  // Units from real allocations only (house + type). Avoid inventing multi-units from payment tags.
  const units = (() => {
    const fromAlloc = (allocations || []).map((a) => ({
      property_type: a.property_type || null,
      house_no: a.house_no || null,
      infrastructure_waived: !!a.infrastructure_waived,
      allocation_id: a.id,
      source: 'allocation',
    }));
    if (fromAlloc.length) return fromAlloc;
    // No allocation: single logical unit from best-known type (do not explode into every payment type)
    const pt =
      (offers.find((o) => o.property_type)?.property_type)
      || (payments.find((p) => p.property_type)?.property_type)
      || null;
    const waived = offers.some((o) => o.infrastructure_waived);
    return [{ property_type: pt, house_no: null, infrastructure_waived: waived, allocation_id: null, source: 'inferred' }];
  })();

  const propertyTypes = [...new Set(units.map((u) => u.property_type).filter(Boolean))];
  const phone = offers.find((o) => o.phone_number)?.phone_number
    || allocations.find((a) => a.phone_number)?.phone_number;
  const email = offers.find((o) => o.email_address)?.email_address;
  const estateName = estate?.name || 'this estate';

  const anyInfraWaived = units.some((u) => u.infrastructure_waived)
    || offers.some((o) => o.infrastructure_waived);

  function financeForType(pt, infraWaived) {
    const multi = units.length > 1;
    const typePays = (payments || []).filter((p) => {
      const ppt = (p.property_type || '').trim();
      if (!multi) return true;
      if (!ppt || !pt) return false;
      const a = ppt.toLowerCase();
      const b = String(pt).toLowerCase();
      return a === b || a.includes(b) || b.includes(a);
    });
    const typeOffers = !multi
      ? offers
      : (offers || []).filter((o) => {
          const ot = (o.property_type || '').trim();
          if (!ot || !pt) return false;
          return ot.toLowerCase() === String(pt).toLowerCase();
        });
    const fin = allocatePaymentSummary(typePays, typeOffers, feeConfig, pt ? [pt] : []);
    if (infraWaived || anyInfraWaived && !multi) {
      fin.expected = { ...fin.expected, infrastructure: 0 };
      if (!fin.notes) fin.notes = [];
      fin.notes = [...(fin.notes || []), 'Infrastructure fee waived for this subscriber'];
    }
    return fin;
  }

  const perUnitFinance = units.map((u) => {
    const fin = financeForType(u.property_type, u.infrastructure_waived);
    const propPct = fin.expected.property > 0
      ? Math.round((fin.paid.property / fin.expected.property) * 100)
      : null;
    return { ...u, ...fin, propPct };
  });

  const untaggedPayments = units.length > 1
    ? (payments || []).filter((p) => !(p.property_type || '').trim())
    : [];
  const untaggedTotal = untaggedPayments.reduce((s, p) => s + Number(p.amount || 0), 0);

  const primaryFin = perUnitFinance[0] || allocatePaymentSummary(payments, offers, feeConfig, propertyTypes);
  const { expected, paid } = primaryFin;
  const propertyPct = primaryFin.propPct != null
    ? primaryFin.propPct
    : (expected.property > 0 ? Math.round((paid.property / expected.property) * 100) : null);
  const tdpPct = expected.legal_tdp > 0
    ? Math.round((paid.legal_tdp / expected.legal_tdp) * 100)
    : null;
  const infraPct = expected.infrastructure > 0
    ? Math.round((paid.infrastructure / expected.infrastructure) * 100)
    : null;

  const totalRefunded = refunds.reduce((s, r) => s + Number(r.amount_approved || 0), 0);
  const totalCooFees = cooRows.reduce((s, r) => s + Number(r.amount_paid || 0), 0);
  const totalPaidAll = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    + offers.reduce((s, o) => s + Number(o.amount_paid || 0), 0);
  const totalExpectedAll = perUnitFinance.reduce(
    (s, u) => s + (u.expected.property || 0) + (u.expected.infrastructure || 0) + (u.expected.legal_tdp || 0),
    0,
  );

  const summaryBits = [];
  if (units.length > 1 && units[0].source === 'allocation') {
    summaryBits.push(`${units.length} units`);
    perUnitFinance.slice(0, 3).forEach((u) => {
      if (u.propPct != null) summaryBits.push(`${(u.property_type || 'Unit').split(' ').slice(0, 2).join(' ')} ${u.propPct}%`);
    });
  } else {
    if (propertyPct !== null) summaryBits.push(`Prop ${propertyPct}%`);
    else if (paid.property > 0) summaryBits.push(`Prop ₦${paid.property.toLocaleString()}`);
    if (paid.legal_tdp > 0 || expected.legal_tdp > 0) {
      summaryBits.push(tdpPct !== null ? `TDP ${tdpPct}%` : `TDP ₦${paid.legal_tdp.toLocaleString()}`);
    }
    if (!anyInfraWaived && (paid.infrastructure > 0 || expected.infrastructure > 0)) {
      summaryBits.push(infraPct !== null ? `Infra ${infraPct}%` : `Infra ₦${paid.infrastructure.toLocaleString()}`);
    }
    if (anyInfraWaived) summaryBits.push('Infra waived');
  }
  if (paid.other > 0 && units.length <= 1) summaryBits.push(`Other ₦${paid.other.toLocaleString()}`);
  if (totalRefunded > 0) summaryBits.push(`Refund ₦${totalRefunded.toLocaleString()}`);
  if (totalCooFees > 0) summaryBits.push(`COO ₦${totalCooFees.toLocaleString()}`);

  async function toggleInfraWaiver(waive) {
    try {
      const ids = allocations.map((a) => a.id).filter(Boolean);
      if (ids.length) {
        await supabase.from('allocation_records').update({ infrastructure_waived: waive }).in('id', ids);
      }
      const offerIds = offers.map((o) => o.id).filter(Boolean);
      if (offerIds.length) {
        await supabase.from('offers').update({ infrastructure_waived: waive }).in('id', offerIds);
      }
      // refresh
      window.location.reload();
    } catch (e) {
      alert(e.message || 'Could not update infrastructure waiver');
    }
  }

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
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Scroll to a section below and use <b>Edit</b> on any row, or open the register links on the right.
          </p>
        </div>
        <div className="flex wrap" style={{ gap: 8 }}>
          <Link className="btn btn-outline btn-sm" to={`/payments/${estateId}`}>Payments register</Link>
          <Link className="btn btn-outline btn-sm" to={`/allocations/${estateId}`}>Allocations register</Link>
          <Link className="btn btn-outline btn-sm" to={`/offers/${estateId}`}>Offers register</Link>
          <Link className="btn btn-outline btn-sm" to="/coo">COO list</Link>
          <Link className="btn btn-outline btn-sm" to="/refunds">Refunds</Link>
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
            { label: 'Property fully paid', ok: perUnitFinance.length > 0 && perUnitFinance.every((u) => u.expected.property > 0 && u.paid.property >= u.expected.property) },
            { label: 'TDP settled', ok: perUnitFinance.every((u) => u.expected.legal_tdp <= 0 || u.paid.legal_tdp >= u.expected.legal_tdp) },
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
        <p className="muted" style={{ marginTop: 0 }}>
          {units.length > 1 && units[0].source === 'allocation'
            ? 'Each allocated unit is shown separately.'
            : 'Financials for this subscriber on this estate.'}
          {units.length > 1 && untaggedTotal > 0 && (
            <span> Untagged payments: <b>₦{untaggedTotal.toLocaleString()}</b> — set property type on those payment lines.</span>
          )}
        </p>
        <div className="flex wrap" style={{ gap: 8, marginBottom: 12, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={anyInfraWaived}
              onChange={(e) => toggleInfraWaiver(e.target.checked)}
            />
            <span>Infrastructure fee <b>waived</b> for this subscriber</span>
          </label>
          {anyInfraWaived && <span className="tag approved">Infra not charged</span>}
        </div>
        {perUnitFinance.length === 0 && (
          <p className="muted">No property type on file for this subscriber yet.</p>
        )}
        {perUnitFinance.map((u, ui) => (
          <div key={ui} style={{ marginBottom: 20 }}>
            <h4 style={{ margin: '12px 0 8px', fontSize: 15 }}>
              {u.property_type || 'Unspecified'}
              {u.house_no ? ` · House ${u.house_no}` : ''}
              <span className="muted" style={{ fontWeight: 500 }}> — at {estateName}</span>
              {u.propPct != null && (
                <span className="tag approved" style={{ marginLeft: 8 }}>Prop {u.propPct}%</span>
              )}
            </h4>
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
                    <td className="right">{u.expected.property > 0 ? u.expected.property.toLocaleString() : <span className="muted">Not set</span>}</td>
                    <td className="right">{u.paid.property.toLocaleString()}</td>
                    <td className="right">{formatBalance(u.expected.property, u.paid.property)}</td>
                    <td>
                      {formatPct(u.expected.property, u.paid.property)}
                      {u.expected.property > 0 && u.paid.property >= u.expected.property && (
                        <span className="tag approved" style={{ marginLeft: 6 }}>Complete</span>
                      )}
                      {u.expected.property > 0 && u.paid.property > u.expected.property && (
                        <span className="tag approved" style={{ marginLeft: 6 }}>Overpaid</span>
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td>Infrastructure{u.infrastructure_waived || anyInfraWaived ? ' (waived)' : ''}</td>
                    <td className="right">
                      {u.infrastructure_waived || anyInfraWaived
                        ? <span className="muted">Waived</span>
                        : (u.expected.infrastructure > 0 ? u.expected.infrastructure.toLocaleString() : <span className="muted">Not set</span>)}
                    </td>
                    <td className="right">{u.paid.infrastructure.toLocaleString()}</td>
                    <td className="right">
                      {u.infrastructure_waived || anyInfraWaived ? '—' : formatBalance(u.expected.infrastructure, u.paid.infrastructure)}
                    </td>
                    <td>
                      {u.infrastructure_waived || anyInfraWaived
                        ? <span className="tag approved">Waived</span>
                        : formatPct(u.expected.infrastructure, u.paid.infrastructure)}
                    </td>
                  </tr>
                  <tr>
                    <td>Legal / TDP</td>
                    <td className="right">{u.expected.legal_tdp > 0 ? u.expected.legal_tdp.toLocaleString() : <span className="muted">Not set</span>}</td>
                    <td className="right">{u.paid.legal_tdp.toLocaleString()}</td>
                    <td className="right">{formatBalance(u.expected.legal_tdp, u.paid.legal_tdp)}</td>
                    <td>
                      {formatPct(u.expected.legal_tdp, u.paid.legal_tdp)}
                      {u.expected.legal_tdp > 0 && u.paid.legal_tdp >= u.expected.legal_tdp && (
                        <span className="tag approved" style={{ marginLeft: 6 }}>TDP paid</span>
                      )}
                    </td>
                  </tr>
                  {(u.paid.other > 0) && (
                    <tr>
                      <td>Other</td>
                      <td className="right">—</td>
                      <td className="right">{u.paid.other.toLocaleString()}</td>
                      <td className="right">—</td>
                      <td>—</td>
                    </tr>
                  )}
                  <tr style={{ fontWeight: 600, background: '#f8fafc' }}>
                    <td>Subtotal this unit</td>
                    <td className="right">
                      {(u.expected.property + u.expected.infrastructure + u.expected.legal_tdp).toLocaleString()}
                    </td>
                    <td className="right">
                      {(u.paid.property + u.paid.infrastructure + u.paid.legal_tdp + u.paid.other).toLocaleString()}
                    </td>
                    <td className="right">
                      {formatBalance(
                        u.expected.property + u.expected.infrastructure + u.expected.legal_tdp,
                        u.paid.property + u.paid.infrastructure + u.paid.legal_tdp,
                      )}
                    </td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>
            {(u.notes || []).length > 0 && (
              <p className="muted" style={{ fontSize: 12 }}>{u.notes.join(' · ')}</p>
            )}
          </div>
        ))}
        <div className="table-wrap" style={{ marginTop: 8 }}>
          <table>
            <tbody>
              <tr style={{ fontWeight: 700 }}>
                <td>All payments recorded (this profile)</td>
                <td className="right">—</td>
                <td className="right">{totalPaidAll.toLocaleString()}</td>
                <td className="right">—</td>
                <td />
              </tr>
              <tr>
                <td>Refunds issued</td>
                <td className="right">—</td>
                <td className="right">{totalRefunded > 0 ? totalRefunded.toLocaleString() : '0'}</td>
                <td className="right">—</td>
                <td>
                  {totalRefunded > 0
                    ? <span className="tag PO">{refunds.length} refund(s)</span>
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
                <th>Actions</th>
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
                    <td>
                      <div className="flex">
                        <button type="button" className="btn btn-outline btn-sm" onClick={() => openEditPayment(p)}>Edit</button>
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => deletePayment(p)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {payments.length === 0 && (
                <tr><td colSpan={6} className="empty-state">No payment entries found for this name in this estate.</td></tr>
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
        <p className="muted" style={{ marginTop: 0 }}>Click <b>Edit</b> on a row below to change or delete this ownership record.</p>
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
                <th>Actions</th>
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
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => openEditCoo(c)}>Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => deleteCoo(c)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {cooRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
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


      {editingCoo && (
        <div className="modal-overlay" onClick={() => !recordBusy && setEditingCoo(null)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Edit COO record</h3>
            <form onSubmit={saveCoo}>
              <div className="grid cols-2">
                <div className="field"><label>Previous owner</label><input value={cooForm.previous_owner || ''} onChange={(e) => setCooForm({ ...cooForm, previous_owner: e.target.value })} required /></div>
                <div className="field"><label>New owner</label><input value={cooForm.new_owner || ''} onChange={(e) => setCooForm({ ...cooForm, new_owner: e.target.value })} required /></div>
                <div className="field"><label>Date</label><input type="date" value={cooForm.date_changed || ''} onChange={(e) => setCooForm({ ...cooForm, date_changed: e.target.value })} /></div>
                <div className="field"><label>Property type</label><input value={cooForm.property_type || ''} onChange={(e) => setCooForm({ ...cooForm, property_type: e.target.value })} /></div>
                <div className="field"><label>House / Allocation</label><input value={cooForm.new_allocation_no || ''} onChange={(e) => setCooForm({ ...cooForm, new_allocation_no: e.target.value })} /></div>
                <div className="field"><label>Status</label><input value={cooForm.status || ''} onChange={(e) => setCooForm({ ...cooForm, status: e.target.value })} /></div>
                <div className="field"><label>COO fee (₦)</label><input type="number" value={cooForm.amount_paid ?? ''} onChange={(e) => setCooForm({ ...cooForm, amount_paid: e.target.value })} /></div>
                <div className="field"><label>Reason</label><input value={cooForm.reason || ''} onChange={(e) => setCooForm({ ...cooForm, reason: e.target.value })} /></div>
                <div className="field"><label>Remarks</label><input value={cooForm.remarks || ''} onChange={(e) => setCooForm({ ...cooForm, remarks: e.target.value })} /></div>
                <div className="field"><label>Comments</label><input value={cooForm.comments || ''} onChange={(e) => setCooForm({ ...cooForm, comments: e.target.value })} /></div>
              </div>
              {recordError && <div className="error-text">{recordError}</div>}
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-danger" onClick={() => deleteCoo(editingCoo)}>Delete this record</button>
                <div className="flex">
                  <button type="button" className="btn btn-outline" onClick={() => setEditingCoo(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={recordBusy}>{recordBusy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingPayment && (
        <div className="modal-overlay" onClick={() => !recordBusy && setEditingPayment(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit payment</h3>
            <form onSubmit={savePayment}>
              <div className="field"><label>Amount</label><input type="number" value={payForm.amount ?? ''} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} required /></div>
              <div className="field"><label>Date</label><input type="date" value={payForm.date_paid || ''} onChange={(e) => setPayForm({ ...payForm, date_paid: e.target.value })} /></div>
              <div className="field"><label>Payment type</label>
                <select value={payForm.payment_type || 'property'} onChange={(e) => setPayForm({ ...payForm, payment_type: e.target.value })}>
                  <option value="property">Property</option>
                  <option value="infrastructure">Infrastructure</option>
                  <option value="legal_tdp">Legal / TDP</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div className="field"><label>Property type</label><input value={payForm.property_type || ''} onChange={(e) => setPayForm({ ...payForm, property_type: e.target.value })} /></div>
              <div className="field"><label>Reference</label><input value={payForm.payment_reference || ''} onChange={(e) => setPayForm({ ...payForm, payment_reference: e.target.value })} /></div>
              <div className="field"><label>Remarks</label><input value={payForm.remarks || ''} onChange={(e) => setPayForm({ ...payForm, remarks: e.target.value })} /></div>
              {recordError && <div className="error-text">{recordError}</div>}
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <button type="button" className="btn btn-danger" onClick={() => deletePayment(editingPayment)}>Delete this record</button>
                <div className="flex">
                  <button type="button" className="btn btn-outline" onClick={() => setEditingPayment(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={recordBusy}>{recordBusy ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <p className="muted">
        This report matches the subscriber&apos;s name (case-insensitive) across Offers, Allocations, and Payments
        for <b>{estate?.name}</b> only. Slightly different spellings will not match — correct the source record if needed.
      </p>
    </div>
  );
}
