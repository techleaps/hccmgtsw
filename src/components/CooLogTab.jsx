import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import BulkImportModal from './BulkImportModal';

/** Maps your COO Excel columns to ownership_changes */
export const COO_FIELD_DEFS = [
  {
    key: 'previous_owner',
    label: 'Initial Name / Previous Owner',
    type: 'text',
    required: true,
    synonyms: ['initial name', 'previous owner', 'old name', 'from', 'former owner', 'seller'],
  },
  {
    key: 'new_owner',
    label: 'New Name / New Owner',
    type: 'text',
    required: true,
    synonyms: ['new name', 'new owner', 'to', 'buyer', 'current owner'],
  },
  {
    key: 'date_changed',
    label: 'Date Processed',
    type: 'date',
    synonyms: ['date processed', 'date changed', 'processed date', 'coo date', 'date of coo'],
  },
  {
    key: 'property_type',
    label: 'Property Type',
    type: 'text',
    synonyms: ['property type', 'type', 'house type'],
  },
  {
    key: 'status',
    label: 'Status',
    type: 'text',
    synonyms: ['status', 'coo status', 'state'],
  },
  {
    key: 'new_allocation_no',
    label: 'Allocation / House No',
    type: 'text',
    synonyms: ['allocation', 'allocation no', 'house no', 'house number', 'unit'],
  },
  {
    key: 'previous_phone',
    label: 'Initial Phone',
    type: 'text',
    synonyms: ['phone number', 'initial phone', 'old phone'],
  },
  {
    key: 'previous_email',
    label: 'Initial Email',
    type: 'text',
    synonyms: ['email address', 'initial email', 'old email'],
  },
  {
    key: 'previous_address',
    label: 'Initial Address',
    type: 'text',
    synonyms: ['initial address', 'old address', 'address'],
  },
  {
    key: 'new_phone',
    label: 'New Phone',
    type: 'text',
    synonyms: ['new phone', 'new phone number'],
  },
  {
    key: 'new_email',
    label: 'New Email',
    type: 'text',
    synonyms: ['new email', 'new email address'],
  },
  {
    key: 'new_address',
    label: 'New Address',
    type: 'text',
    synonyms: ['new address'],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    type: 'text',
    synonyms: ['remarks', 'remark', 'notes', 'note'],
  },
  {
    key: 'comments',
    label: 'Comments / MD note',
    type: 'text',
    synonyms: ['comments', 'comment', "md's first comment", 'md comment'],
  },
];

function ensureIsoDate(v) {
  if (!v) return null;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  // last-resort parse for values that slipped through
  const s = String(v).trim();
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const m2 = s.match(/^(\d{1,2})[\/\-\s]+([A-Za-z]{3,9})[\/\-\s]+(\d{2,4})$/);
  if (m2) {
    const dd = m2[1].padStart(2, '0');
    const mon = months[m2[2].toLowerCase().slice(0, 3)];
    let y = m2[3];
    if (y.length === 2) y = Number(y) > 50 ? `19${y}` : `20${y}`;
    if (mon) return `${y.padStart(4, '0')}-${String(mon).padStart(2, '0')}-${dd}`;
  }
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}

function transformCooRecord(r) {
  const bits = [];
  if (r.previous_address) bits.push(`Prev address: ${r.previous_address}`);
  if (r.previous_phone) bits.push(`Prev phone: ${r.previous_phone}`);
  if (r.previous_email) bits.push(`Prev email: ${r.previous_email}`);
  if (r.new_address) bits.push(`New address: ${r.new_address}`);
  if (r.new_phone) bits.push(`New phone: ${r.new_phone}`);
  if (r.new_email) bits.push(`New email: ${r.new_email}`);
  if (r.status) bits.push(`Status: ${r.status}`);
  const extra = bits.join(' · ');
  const comments = [r.comments, extra].filter(Boolean).join(' | ') || null;
  let dateChanged = ensureIsoDate(r.date_changed);
  // DB requires date_changed NOT NULL — use today only if sheet left it blank
  if (!dateChanged) dateChanged = new Date().toISOString().slice(0, 10);
  return {
    previous_owner: String(r.previous_owner || '').trim(),
    new_owner: String(r.new_owner || '').trim(),
    date_changed: dateChanged,
    property_type: r.property_type || null,
    status: r.status || null,
    new_allocation_no: r.new_allocation_no || null,
    remarks: r.remarks || null,
    comments,
    reason: r.status ? `COO (${r.status})` : 'Change of ownership',
  };
}

export default function CooLogTab() {
  const { profile } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [estateFilter, setEstateFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [importStep, setImportStep] = useState(null); // null | 'estate' | 'file'
  const [importEstateId, setImportEstateId] = useState('');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    const { data } = await supabase
      .from('ownership_changes')
      .select('*, offers(estate_id, estates(name)), allocation_records(estate_id, estates(name)), estates(name)')
      .order('created_at', { ascending: false });
    setRows(data || []);
    setLoading(false);
  }

  function estateOf(r) {
    return r.estates?.name
      || r.offers?.estates?.name
      || r.allocation_records?.estates?.name
      || '—';
  }
  function estateIdOf(r) {
    return r.estate_id || r.offers?.estate_id || r.allocation_records?.estate_id || null;
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (estateFilter && estateIdOf(r) !== estateFilter) return false;
      const hay = `${r.previous_owner} ${r.new_owner} ${r.property_type || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
  }, [rows, estateFilter, search]);

  const totalFees = useMemo(
    () => filtered.reduce((s, r) => s + Number(r.amount_paid || 0), 0),
    [filtered]
  );

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Change of Ownership — History</h2>
          <p className="muted" style={{ margin: 0 }}>
            Import from Excel (one sheet per estate) or record COO from Allocations / Offers.
          </p>
        </div>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/offers">Offers</Link>
          <Link className="btn btn-outline" to="/allocations">Allocations</Link>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setImportEstateId(estateFilter || (estates[0]?.id || ''));
              setImportStep('estate');
            }}
          >
            Bulk Import COO
          </button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card">
          <div className="value">{filtered.length}</div>
          <div className="label">Total Ownership Changes</div>
        </div>
        <div className="stat-card gold">
          <div className="value">₦{totalFees.toLocaleString()}</div>
          <div className="label">Total COO Fees Recorded</div>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 180 }}>
            <label>Filter by Estate</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All Estates</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 220, flex: 1 }}>
            <label>Search</label>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search previous or new owner name…"
            />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Estate</th>
                <th>Previous Owner</th>
                <th>New Owner</th>
                <th>Property type</th>
                <th>House / Allocation</th>
                <th>Status</th>
                <th className="right">COO Fee (₦)</th>
                <th>Remarks / Comments</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id}>
                  <td>{r.date_changed || '—'}</td>
                  <td>{estateOf(r)}</td>
                  <td>{r.previous_owner}</td>
                  <td>
                    {estateIdOf(r) ? (
                      <Link to={`/subscriber/${estateIdOf(r)}/${encodeURIComponent(r.new_owner)}`}>
                        {r.new_owner}
                      </Link>
                    ) : r.new_owner}
                  </td>
                  <td>{r.property_type || '—'}</td>
                  <td>{r.new_pon || r.new_allocation_no || '—'}</td>
                  <td>{r.status || '—'}</td>
                  <td className="right">{Number(r.amount_paid || 0).toLocaleString()}</td>
                  <td>{[r.remarks, r.comments].filter(Boolean).join(' · ') || '—'}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="empty-state">
                    No ownership changes yet. Use <b>Bulk Import COO</b> or <b>Record COO</b> on an allocation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {importStep === 'estate' && (
        <div className="modal-overlay" onClick={() => setImportStep(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <h3>Which estate is this COO sheet for?</h3>
            <p className="muted">
              Workbooks often have one sheet per estate. Select the estate, then choose the matching sheet in the file picker.
            </p>
            <div className="field">
              <label>Estate *</label>
              <select value={importEstateId} onChange={(e) => setImportEstateId(e.target.value)}>
                <option value="">— Select —</option>
                {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setImportStep(null)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!importEstateId}
                onClick={() => setImportStep('file')}
              >
                Continue to file…
              </button>
            </div>
          </div>
        </div>
      )}

      {importStep === 'file' && importEstateId && (
        <BulkImportModal
          title={`Bulk Import COO — ${estates.find((e) => e.id === importEstateId)?.name || ''}`}
          tableName="ownership_changes"
          fieldDefs={COO_FIELD_DEFS}
          estates={estates}
          presetEstateId={importEstateId}
          profile={profile}
          onClose={() => { setImportStep(null); setImportEstateId(''); }}
          onImported={() => { setImportStep(null); setImportEstateId(''); load(); }}
          transformRecord={(r) => ({
            ...transformCooRecord(r),
            estate_id: importEstateId,
            created_by: profile?.id,
            amount_paid: Number(r.amount_paid) || 0,
          })}
        />
      )}
    </div>
  );
}

