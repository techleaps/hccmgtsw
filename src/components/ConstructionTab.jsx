import React, { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { blankToNull } from '../lib/sanitize';
import { naturalHouseNoCompare } from '../lib/nameMatching';

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
  const [sortKey, setSortKey] = useState('house_no');
  const [sortDir, setSortDir] = useState('asc');
  const [clearing, setClearing] = useState(false);

  // Bulk create
  const [showBulk, setShowBulk] = useState(false);
  const [bulkPrefix, setBulkPrefix] = useState('A');
  const [bulkSuffix, setBulkSuffix] = useState('');
  const [bulkFrom, setBulkFrom] = useState(1);
  const [bulkTo, setBulkTo] = useState(10);
  const [bulkType, setBulkType] = useState('');
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

  const filtered = useMemo(() => {
    const list = units.filter((u) => {
      if (letterFilter && !(u.house_no || '').toUpperCase().startsWith(letterFilter.toUpperCase()) && (u.block_letter || '').toUpperCase() !== letterFilter.toUpperCase()) return false;
      if (statusFilter && u.status_of_work !== statusFilter) return false;
      const hay = `${u.house_no} ${u.property_name || ''} ${u.contractor_name || ''} ${u.remarks || ''}`.toLowerCase();
      return hay.includes(search.toLowerCase());
    });
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'house_no') {
        // Prefer unit_number when available for true sequential order
        const ua = a.unit_number, ub = b.unit_number;
        if (ua != null && ub != null && ua !== ub) return (ua - ub) * dir;
        return naturalHouseNoCompare(a.house_no, b.house_no) * dir;
      }
      if (sortKey === 'unit_number') {
        return ((a.unit_number || 0) - (b.unit_number || 0)) * dir;
      }
      const va = String(a[sortKey] ?? '').toLowerCase();
      const vb = String(b[sortKey] ?? '').toLowerCase();
      return va.localeCompare(vb) * dir;
    });
    return list;
  }, [units, letterFilter, statusFilter, search, sortKey, sortDir]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

  function sortLabel(key, label) {
    if (sortKey !== key) return label;
    return `${label} ${sortDir === 'asc' ? '▲' : '▼'}`;
  }

  async function handleClearAllUnits() {
    if (units.length === 0) { alert('No units to clear.'); return; }
    const ok = confirm(`Remove all ${units.length} unit(s) for ${estate?.name}? You can re-create the range afterwards.`);
    if (!ok) return;
    const typed = prompt('Type DELETE to confirm clearing all construction units for this estate.');
    if (typed !== 'DELETE') { alert('Cancelled.'); return; }
    setClearing(true);
    const { error } = await supabase
      .from('construction_units')
      .update({ is_deleted: true })
      .eq('estate_id', estateId)
      .eq('is_deleted', false);
    setClearing(false);
    if (error) { alert(error.message); return; }
    alert('All units for this estate have been cleared.');
    loadEstate();
  }

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
    const prefix = String(bulkPrefix ?? '');
    const suffix = String(bulkSuffix ?? '');
    const from = Number(bulkFrom);
    const to = Number(bulkTo);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to < from) {
      setBulkError('Enter a valid number range (e.g. 1 to 50).');
      return;
    }
    if (to - from > 500) { setBulkError('Range too large (max 500 units per batch).'); return; }

    setBulkSaving(true);
    const rows = [];
    for (let n = from; n <= to; n += 1) {
      const houseNo = `${prefix}${n}${suffix}`;
      // block_letter = leading letters only (optional analytics)
      const letterMatch = houseNo.match(/^([A-Za-z]+)/);
      rows.push({
        estate_id: estateId,
        house_no: houseNo,
        block_letter: letterMatch ? letterMatch[1].toUpperCase() : null,
        unit_number: n,
        property_type: bulkType || null,
        property_name: null,
        status_of_work: 'Not started',
        created_by: profile.id,
      });
    }
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
          <p className="muted" style={{ margin: 0 }}>
            These are the estate&apos;s unit / plot / allocation numbers (e.g. 420 plots of 600SQM).
            When you allocate a unit to a subscriber, use the same number on the allocation record —
            the system links construction, contractor and subscriber through that number.
          </p>
        </div>
        <div className="flex wrap">
          <Link className="btn btn-outline" to="/contracts">Award of Contract</Link>
          {isAdmin && (
            <button className="btn btn-danger" onClick={handleClearAllUnits} disabled={clearing || units.length === 0}>
              {clearing ? 'Clearing…' : 'Clear All Units'}
            </button>
          )}
          <button className="btn btn-primary" onClick={() => {
            setBulkPrefix('A');
            setBulkFrom(1);
            setBulkTo(10);
            setBulkSuffix('');
            setBulkType('');
            setBulkError('');
            setShowBulk(true);
          }}>
            + Create units (custom range)
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
          <div style={{ minWidth: 140 }}>
            <label>Block / prefix filter</label>
            <input value={letterFilter} onChange={(e) => setLetterFilter(e.target.value)} placeholder="A, LD, Plot…" />
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
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('house_no')}>{sortLabel('house_no', 'Unit / Plot No')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('property_type')}>{sortLabel('property_type', 'Property type')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('property_name')}>{sortLabel('property_name', 'Property name')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('awarded')}>{sortLabel('awarded', 'Awarded')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('contractor_name')}>{sortLabel('contractor_name', 'Contractor')}</th>
              <th>Phone</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('date_of_contract')}>{sortLabel('date_of_contract', 'Contract date')}</th>
              <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('status_of_work')}>{sortLabel('status_of_work', 'Status of work')}</th>
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
              Define your own pattern. Examples:
              prefix <b>A</b> + 1–50 → A1…A50;
              prefix <b>A</b> + suffix <b>-2</b> → A1-2…A50-2 (Phase 2);
              prefix <b>Plot </b> + 1–20 → Plot 1…Plot 20;
              prefix <b>LD</b> or <b>MD</b> / <b>HD</b> as needed.
            </p>
            <form onSubmit={handleBulkCreate}>
              <div className="grid cols-2">
                <div className="field">
                  <label>Prefix (letters/text before the number)</label>
                  <input value={bulkPrefix} onChange={(e) => setBulkPrefix(e.target.value)} placeholder="A  or  Plot  or  LD  or blank" />
                </div>
                <div className="field">
                  <label>Suffix (text after the number)</label>
                  <input value={bulkSuffix} onChange={(e) => setBulkSuffix(e.target.value)} placeholder="-2  or  -2B  or blank" />
                </div>
              </div>
              <div className="grid cols-2">
                <div className="field">
                  <label>From number</label>
                  <input type="number" min={0} value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} />
                </div>
                <div className="field">
                  <label>To number</label>
                  <input type="number" min={0} value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} />
                </div>
              </div>
              <div className="field">
                <label>Property type label (optional)</label>
                <input value={bulkType} onChange={(e) => setBulkType(e.target.value)} placeholder="4 Bedroom Fully Detached, Land, etc." />
              </div>
              <p className="muted">
                Will create: <b>{bulkPrefix}{bulkFrom}{bulkSuffix}</b> … <b>{bulkPrefix}{bulkTo}{bulkSuffix}</b>
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
