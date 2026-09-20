import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { blankToNull } from '../lib/sanitize';

/** Default letter → property type (SVE / current naming) */
export const BLOCK_TYPE_DEFAULTS = {
  A: '4 Bedroom Fully Detached',
  B: '4 Bedroom Semi Detached',
  C: '3 Bedroom',
  D: '2 Bedroom',
};

const WORK_STATUS = [
  'Not started', 'Foundation', 'Superstructure', 'Roofing',
  'Finishing', 'Completed', 'On hold', 'Issue / dispute',
];

const UNIT_BLANK = {
  house_no: '', property_type: '', property_name: '', awarded: false,
  contractor_name: '', contractor_phone: '', date_of_contract: '',
  status_of_work: 'Not started', remarks: '', contract_award_id: '',
};

export default function ConstructionTab() {
  const { estateId } = useParams();
  const navigate = useNavigate();
  const { profile, isSupervisorPlus, isAdmin } = useAuth();
  const [estates, setEstates] = useState([]);
  const [estate, setEstate] = useState(null);
  const [units, setUnits] = useState([]);
  const [awards, setAwards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [letterFilter, setLetterFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');

  // Bulk create
  const [showBulk, setShowBulk] = useState(false);
  const [bulkLetter, setBulkLetter] = useState('A');
  const [bulkFrom, setBulkFrom] = useState(1);
  const [bulkTo, setBulkTo] = useState(10);
  const [bulkType, setBulkType] = useState(BLOCK_TYPE_DEFAULTS.A);
  const [bulkError, setBulkError] = useState('');
  const [bulkSaving, setBulkSaving] = useState(false);

  // Edit unit
  const [editRow, setEditRow] = useState(null);
  const [form, setForm] = useState(UNIT_BLANK);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('estates').select('*').eq('is_deleted', false).order('name')
      .then(({ data }) => setEstates(data || []));
  }, []);

  useEffect(() => {
    if (estateId) loadEstate();
    else setLoading(false);
  }, [estateId]);

  async function loadEstate() {
    setLoading(true);
    const [eRes, uRes, aRes] = await Promise.all([
      supabase.from('estates').select('*').eq('id', estateId).single(),
      supabase.from('construction_units').select('*').eq('estate_id', estateId).eq('is_deleted', false).order('house_no'),
      supabase.from('contract_awards').select('*').eq('estate_id', estateId).eq('is_deleted', false).order('contractor_name'),
    ]);
    setEstate(eRes.data || null);
    setUnits(uRes.data || []);
    setAwards(aRes.data || []);
    setLoading(false);
  }

  const filtered = useMemo(() => units.filter((u) => {
    if (letterFilter && (u.block_letter || '').toUpperCase() !== letterFilter.toUpperCase()) return false;
    if (statusFilter && u.status_of_work !== statusFilter) return false;
    const hay = `${u.house_no} ${u.property_name || ''} ${u.contractor_name || ''} ${u.remarks || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }), [units, letterFilter, statusFilter, search]);

  const byLetter = useMemo(() => {
    const m = {};
    units.forEach((u) => {
      const L = (u.block_letter || '?').toUpperCase();
      m[L] = (m[L] || 0) + 1;
    });
    return m;
  }, [units]);

  // —— Estate picker ——
  if (!estateId) {
    return (
      <div>
        <div className="page-title">
          <div>
            <h2>Construction</h2>
            <p className="muted" style={{ margin: 0 }}>Track units, contractors and work status per estate.</p>
          </div>
          <Link className="btn btn-outline" to="/contracts">Award of Contract</Link>
        </div>
        <div className="grid cols-3">
          {estates.map((e) => (
            <button
              key={e.id}
              type="button"
              className="card"
              style={{ textAlign: 'left', cursor: 'pointer', border: '1px solid #e5e7eb' }}
              onClick={() => navigate(`/construction/${e.id}`)}
            >
              <h3>{e.name}</h3>
              <p className="muted">{(e.category || '').replace(/_/g, ' ')}</p>
              <span className="tag PO">Open units</span>
            </button>
          ))}
          {estates.length === 0 && <div className="empty-state">Create an estate first under Estates.</div>}
        </div>
      </div>
    );
  }

  async function handleBulkCreate(e) {
    e.preventDefault();
    setBulkError('');
    const letter = String(bulkLetter || '').trim().toUpperCase();
    const from = Number(bulkFrom);
    const to = Number(bulkTo);
    if (!/^[A-Z]$/.test(letter)) { setBulkError('Block letter must be a single letter A–Z.'); return; }
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) {
      setBulkError('Enter a valid number range (e.g. 1 to 50).');
      return;
    }
    if (to - from > 500) { setBulkError('Range too large (max 500 units per batch).'); return; }

    setBulkSaving(true);
    const rows = [];
    for (let n = from; n <= to; n += 1) {
      rows.push({
        estate_id: estateId,
        house_no: `${letter}${n}`,
        block_letter: letter,
        unit_number: n,
        property_type: bulkType || BLOCK_TYPE_DEFAULTS[letter] || null,
        property_name: null,
        status_of_work: 'Not started',
        created_by: profile.id,
      });
    }
    // Upsert-like: insert, ignore duplicates on unique (estate_id, house_no)
    const { error } = await supabase.from('construction_units').upsert(rows, {
      onConflict: 'estate_id,house_no',
      ignoreDuplicates: true,
    });
    setBulkSaving(false);
    if (error) { setBulkError(error.message); return; }
    setShowBulk(false);
    loadEstate();
  }

  function openEdit(row) {
    setEditRow(row);
    setForm({
      house_no: row.house_no || '',
      property_type: row.property_type || '',
      property_name: row.property_name || '',
      awarded: !!row.awarded,
      contractor_name: row.contractor_name || '',
      contractor_phone: row.contractor_phone || '',
      date_of_contract: row.date_of_contract || '',
      status_of_work: row.status_of_work || 'Not started',
      remarks: row.remarks || '',
      contract_award_id: row.contract_award_id || '',
    });
    setError('');
  }

  async function handleSaveUnit(e) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const payload = blankToNull({
      ...form,
      awarded: !!form.awarded,
      contract_award_id: form.contract_award_id || null,
      block_letter: (form.house_no || '').replace(/[0-9]/g, '').toUpperCase() || null,
      unit_number: parseInt(String(form.house_no).replace(/[^0-9]/g, ''), 10) || null,
    }, ['date_of_contract']);

    // If linked to an award, copy contractor name/phone
    if (payload.contract_award_id) {
      const award = awards.find((a) => a.id === payload.contract_award_id);
      if (award) {
        payload.contractor_name = award.contractor_name;
        payload.contractor_phone = award.phone_number;
        payload.awarded = true;
      }
    }

    const { error } = await supabase.from('construction_units').update(payload).eq('id', editRow.id);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setEditRow(null);
    loadEstate();
  }

  async function handleDeleteUnit(row) {
    if (!confirm(`Remove unit ${row.house_no}?`)) return;
    await supabase.from('construction_units').update({ is_deleted: true }).eq('id', row.id);
    loadEstate();
  }

  if (loading) return <p className="muted">Loading…</p>;

  return (
    <div>
      <div className="page-title">
        <div>
          <Link to="/construction" className="muted">&larr; All estates</Link>
          <h2>Construction — {estate?.name}</h2>
        </div>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/contracts">Award of Contract</Link>
          <button className="btn btn-primary" onClick={() => {
            setBulkLetter('A');
            setBulkFrom(1);
            setBulkTo(10);
            setBulkType(BLOCK_TYPE_DEFAULTS.A);
            setBulkError('');
            setShowBulk(true);
          }}>
            + Create units (letter + range)
          </button>
        </div>
      </div>

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{units.length}</div><div className="label">Total Units</div></div>
        {Object.entries(byLetter).sort(([a], [b]) => a.localeCompare(b)).slice(0, 3).map(([L, c]) => (
          <div className="stat-card grey" key={L}>
            <div className="value">{c}</div>
            <div className="label">Block {L} · {BLOCK_TYPE_DEFAULTS[L] || '—'}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 120 }}>
            <label>Block</label>
            <select value={letterFilter} onChange={(e) => setLetterFilter(e.target.value)}>
              <option value="">All</option>
              {Object.keys(BLOCK_TYPE_DEFAULTS).map((L) => (
                <option key={L} value={L}>{L} — {BLOCK_TYPE_DEFAULTS[L]}</option>
              ))}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Work status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All</option>
              {WORK_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="House no, contractor…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>House No</th>
              <th>Property type</th>
              <th>Property name</th>
              <th>Awarded</th>
              <th>Contractor</th>
              <th>Phone</th>
              <th>Contract date</th>
              <th>Status of work</th>
              <th>Remarks</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u, i) => (
              <tr key={u.id}>
                <td>{i + 1}</td>
                <td><b>{u.house_no}</b></td>
                <td>{u.property_type || '—'}</td>
                <td>{u.property_name || '—'}</td>
                <td>{u.awarded ? '✓' : ''}</td>
                <td>{u.contractor_name || '—'}</td>
                <td>{u.contractor_phone || '—'}</td>
                <td>{u.date_of_contract || '—'}</td>
                <td><span className="tag">{u.status_of_work || '—'}</span></td>
                <td>{u.remarks || '—'}</td>
                <td>
                  <div className="flex">
                    <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(u)}>Edit</button>
                    {isAdmin && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteUnit(u)}>Del</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-state">
                  No units yet. Use <b>Create units (letter + range)</b> — e.g. letter A, 1–50 for 4BR Fully.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showBulk && (
        <div className="modal-overlay" onClick={() => setShowBulk(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Create house units</h3>
            <p className="muted">
              Naming: <b>A</b> = 4BR Fully, <b>B</b> = 4BR Semi, <b>C</b> = 3BR, <b>D</b> = 2BR.
              Enter letter and number range; system creates A1, A2, … automatically.
            </p>
            <form onSubmit={handleBulkCreate}>
              <div className="grid cols-3">
                <div className="field">
                  <label>Block letter</label>
                  <select
                    value={bulkLetter}
                    onChange={(e) => {
                      const L = e.target.value;
                      setBulkLetter(L);
                      setBulkType(BLOCK_TYPE_DEFAULTS[L] || bulkType);
                    }}
                  >
                    {Object.keys(BLOCK_TYPE_DEFAULTS).map((L) => (
                      <option key={L} value={L}>{L}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>From number</label>
                  <input type="number" min={1} value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To number</label>
                  <input type="number" min={1} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Property type label</label>
                <input value={bulkType} onChange={(e) => setBulkType(e.target.value)} />
              </div>
              <p className="muted">
                Will create: <b>{String(bulkLetter).toUpperCase()}{bulkFrom}</b> … <b>{String(bulkLetter).toUpperCase()}{bulkTo}</b>
                {' '}({Math.max(0, Number(bulkTo) - Number(bulkFrom) + 1)} units). Existing house numbers are skipped.
              </p>
              {bulkError && <div className="error-text">{bulkError}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowBulk(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={bulkSaving}>
                  {bulkSaving ? 'Creating…' : 'Create units'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editRow && (
        <div className="modal-overlay" onClick={() => setEditRow(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit unit {editRow.house_no}</h3>
            <form onSubmit={handleSaveUnit}>
              <div className="field"><label>House / property number</label>
                <input value={form.house_no} onChange={(e) => setForm({ ...form, house_no: e.target.value })} />
              </div>
              <div className="field"><label>Property type</label>
                <input value={form.property_type} onChange={(e) => setForm({ ...form, property_type: e.target.value })} />
              </div>
              <div className="field"><label>Property name</label>
                <input value={form.property_name} onChange={(e) => setForm({ ...form, property_name: e.target.value })} />
              </div>
              <div className="field">
                <label>Link to contract award</label>
                <select
                  value={form.contract_award_id}
                  onChange={(e) => setForm({ ...form, contract_award_id: e.target.value })}
                >
                  <option value="">— None —</option>
                  {awards.map((a) => (
                    <option key={a.id} value={a.id}>{a.contractor_name} ({a.house_numbers || 'no houses listed'})</option>
                  ))}
                </select>
              </div>
              <div className="field check-field">
                <input type="checkbox" checked={form.awarded} onChange={(e) => setForm({ ...form, awarded: e.target.checked })} />
                <label style={{ margin: 0 }}>Awarded for construction</label>
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Contractor</label>
                  <input value={form.contractor_name} onChange={(e) => setForm({ ...form, contractor_name: e.target.value })} />
                </div>
                <div className="field"><label>Contractor phone</label>
                  <input value={form.contractor_phone} onChange={(e) => setForm({ ...form, contractor_phone: e.target.value })} />
                </div>
              </div>
              <div className="grid cols-2">
                <div className="field"><label>Date of contract</label>
                  <input type="date" value={form.date_of_contract} onChange={(e) => setForm({ ...form, date_of_contract: e.target.value })} />
                </div>
                <div className="field"><label>Status of work</label>
                  <select value={form.status_of_work} onChange={(e) => setForm({ ...form, status_of_work: e.target.value })}>
                    {WORK_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="field"><label>Remarks / construction issues</label>
                <textarea rows={3} value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
              </div>
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setEditRow(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
