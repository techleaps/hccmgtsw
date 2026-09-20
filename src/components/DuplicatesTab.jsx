import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';
import {
  findDuplicateGroups,
  normalizePersonName,
  basePersonKey,
  sortedTokenKey,
  sameTokenBag,
} from '../lib/nameMatching';

const NAME_TABLES = [
  { table: 'offers', col: 'subscriber_name' },
  { table: 'allocation_records', col: 'subscriber_name' },
  { table: 'payments', col: 'subscriber_name' },
  { table: 'refunds', col: 'subscriber_name' },
];

async function renameAcrossTables(estateId, fromName, toName) {
  const from = String(fromName || '').trim();
  const to = String(toName || '').trim();
  if (!from || !to || from === to) return { updated: 0, errors: [] };
  let updated = 0;
  const errors = [];
  for (const { table, col } of NAME_TABLES) {
    if (table === 'refunds') {
      const r = await supabase
        .from('refunds')
        .update({ subscriber_name: to })
        .eq('subscriber_name', from)
        .eq('estate_id', estateId)
        .eq('is_deleted', false)
        .select('id');
      if (r.error) {
        const r2 = await supabase
          .from('refunds')
          .update({ subscriber_name: to })
          .eq('subscriber_name', from)
          .eq('is_deleted', false)
          .select('id');
        if (r2.error) errors.push(`${table}: ${r2.error.message}`);
        else updated += (r2.data || []).length;
      } else {
        updated += (r.data || []).length;
      }
      continue;
    }
    const { data, error } = await supabase
      .from(table)
      .update({ [col]: to })
      .eq(col, from)
      .eq('estate_id', estateId)
      .eq('is_deleted', false)
      .select('id');
    if (error) errors.push(`${table}: ${error.message}`);
    else updated += (data || []).length;
  }
  for (const col of ['previous_owner', 'new_owner']) {
    const { data, error } = await supabase
      .from('ownership_changes')
      .update({ [col]: to })
      .eq(col, from)
      .select('id');
    if (error && !/column|estate/i.test(error.message)) errors.push(`ownership_changes.${col}: ${error.message}`);
    else if (!error) updated += (data || []).length;
  }
  const { data: docs, error: docErr } = await supabase
    .from('documents')
    .update({ subscriber_name: to })
    .eq('subscriber_name', from)
    .eq('estate_id', estateId)
    .eq('is_deleted', false)
    .select('id');
  if (!docErr) updated += (docs || []).length;
  return { updated, errors };
}

/** Prefer allocation spelling, then one with payments, then longest. */
function pickCanonical(members) {
  const list = members || [];
  const withAlloc = list.find((m) => (m.sources || []).includes('Allocation'));
  if (withAlloc) return withAlloc.name;
  const withPay = list.find((m) => (m.sources || []).includes('Payment'));
  if (withPay) return withPay.name;
  return [...list].sort((a, b) => String(b.name).length - String(a.name).length)[0]?.name || '';
}

function isSafeAutoMergeGroup(group) {
  // All members share the same token bag (order/title only differences)
  const keys = new Set(group.members.map((m) => sortedTokenKey(m.name)));
  if (keys.size !== 1 || ![...keys][0]) return false;
  // If multiple distinct unit indexes of same type, treat as multi-unit — skip auto
  const indexes = group.members.map((m) => m.unitIndex).filter(Boolean);
  if (new Set(indexes).size > 1) return false;
  // Different house numbers on same property type with both having allocations can be 2 units
  const houses = group.members.flatMap((m) => m.houses || []);
  const pts = group.members.flatMap((m) => m.propertyTypes || []);
  if (new Set(houses).size > 1 && new Set(pts).size === 1 && houses.length > 1) {
    // possible multi-unit same type — still allow auto only if token bag same AND user opts "include multi-house"
    return false;
  }
  return true;
}


export default function DuplicatesTab() {
  const [estates, setEstates] = useState([]);
  const [estateId, setEstateId] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [threshold, setThreshold] = useState(0.82);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [editFrom, setEditFrom] = useState(null);
  const [editTo, setEditTo] = useState('');
  const [mergeGroup, setMergeGroup] = useState(null);
  const [mergeCanonical, setMergeCanonical] = useState('');
  const [mergeSelected, setMergeSelected] = useState([]);
  const [selectedGroups, setSelectedGroups] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    supabase.from('estates').select('*').eq('is_deleted', false).order('name')
      .then(({ data }) => setEstates(data || []));
  }, []);

  async function runScan() {
    if (!estateId) { setError('Select an estate.'); return; }
    setError('');
    setLoading(true);
    try {
      const [offers, allocs, payments, refunds] = await Promise.all([
        fetchAllFrom('offers', (q) =>
          q.select('id, subscriber_name, form_no, property_type, phone_number').eq('estate_id', estateId).eq('is_deleted', false)
        ),
        fetchAllFrom('allocation_records', (q) =>
          q.select('id, subscriber_name, house_no, property_type, phone_number').eq('estate_id', estateId).eq('is_deleted', false)
        ),
        fetchAllFrom('payments', (q) =>
          q.select('id, subscriber_name, property_type, amount').eq('estate_id', estateId).eq('is_deleted', false)
        ),
        fetchAllFrom('refunds', (q) =>
          q.select('id, subscriber_name, amount_approved, estate_id').eq('is_deleted', false)
        ),
      ]);

      const byRaw = new Map();
      function add(name, source, extra = {}) {
        const n = String(name || '').trim();
        if (!n) return;
        const key = n.toLowerCase();
        if (!byRaw.has(key)) {
          const m = n.match(/\s+([0-9]+)\s*$/);
          byRaw.set(key, {
            name: n,
            normalized: normalizePersonName(n),
            baseKey: basePersonKey(n),
            unitIndex: m ? m[1] : null,
            sources: new Set(),
            phones: new Set(),
            houses: new Set(),
            pons: new Set(),
            propertyTypes: new Set(),
            amount: 0,
          });
        }
        const rec = byRaw.get(key);
        rec.sources.add(source);
        if (extra.phone) rec.phones.add(extra.phone);
        if (extra.house) rec.houses.add(extra.house);
        if (extra.pon) rec.pons.add(extra.pon);
        if (extra.pt) rec.propertyTypes.add(extra.pt);
        if (extra.amount) rec.amount += Number(extra.amount) || 0;
      }

      offers.forEach((o) => add(o.subscriber_name, 'Offer', { phone: o.phone_number, pon: o.form_no, pt: o.property_type }));
      allocs.forEach((a) => add(a.subscriber_name, 'Allocation', { phone: a.phone_number, house: a.house_no, pt: a.property_type }));
      payments.forEach((p) => add(p.subscriber_name, 'Payment', { amount: p.amount, pt: p.property_type }));
      refunds.filter((r) => !r.estate_id || r.estate_id === estateId)
        .forEach((r) => add(r.subscriber_name, 'Refund', { amount: r.amount_approved }));

      const rows = [...byRaw.values()].map((r) => ({
        ...r,
        sources: [...r.sources],
        phones: [...r.phones],
        houses: [...r.houses],
        pons: [...r.pons],
        propertyTypes: [...r.propertyTypes],
      }));

      setGroups(findDuplicateGroups(rows, 'name', Number(threshold) || 0.82));
      setSelectedGroups(new Set());
    } catch (err) {
      console.error(err);
      setError(err.message || 'Scan failed');
    }
    setLoading(false);
  }

  const estateName = useMemo(
    () => estates.find((e) => e.id === estateId)?.name || '',
    [estates, estateId]
  );

  function openEdit(name) {
    setEditFrom(name);
    setEditTo(name);
  }

  async function applyEdit(e) {
    e.preventDefault();
    if (!editFrom || !editTo.trim()) return;
    if (editFrom === editTo.trim()) { setEditFrom(null); return; }
    if (!confirm(`Rename all records for "${editFrom}" to "${editTo.trim()}" in ${estateName}?`)) return;
    setBusy('edit');
    const { updated, errors } = await renameAcrossTables(estateId, editFrom, editTo.trim());
    setBusy('');
    if (errors?.length) alert(`Done with issues:\n${errors.join('\n')}\n\nRows updated: ${updated}`);
    else alert(`Updated ${updated} row(s).`);
    setEditFrom(null);
    runScan();
  }

  function isMultiUnitGroup(group) {
    const bases = new Set(group.members.map((m) => m.baseKey));
    return bases.size === 1 && group.members.some((m) => m.unitIndex) && group.members.length > 1;
  }

  function openMerge(group) {
    setMergeGroup(group);
    const preferred = group.members.find((m) => !m.unitIndex) || group.members[0];
    setMergeCanonical(preferred.name);
    setMergeSelected(group.members.map((m) => m.name));
  }

  async function applyMerge(e) {
    e.preventDefault();
    const canonical = mergeCanonical.trim();
    if (!canonical) { alert('Choose the official name to keep.'); return; }
    const sources = mergeSelected.filter((n) => n !== canonical);
    if (!sources.length) { alert('Select at least one other name to merge.'); return; }

    if (isMultiUnitGroup(mergeGroup)) {
      if (!confirm(
        'These look like multi-unit labels (Name 1 / Name 2) for the SAME person.\n\n'
        + 'Only merge if they are spelling mistakes — NOT if they are two real units.\n\nContinue?'
      )) return;
    } else if (!confirm(`Merge ${sources.length} variant(s) into "${canonical}" in ${estateName}?`)) {
      return;
    }

    setBusy('merge');
    let total = 0;
    const errors = [];
    for (const from of sources) {
      const { updated, errors: errs } = await renameAcrossTables(estateId, from, canonical);
      total += updated;
      if (errs?.length) errors.push(...errs);
    }
    setBusy('');
    if (errors.length) alert(`Merge finished with issues:\n${errors.join('\n')}\n\nRows: ${total}`);
    else alert(`Merged. ${total} row(s) now use "${canonical}".`);
    setMergeGroup(null);
    runScan();
  }


  function toggleGroup(gi) {
    setSelectedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(gi)) next.delete(gi);
      else next.add(gi);
      return next;
    });
  }

  function selectSafeGroups() {
    const next = new Set();
    groups.forEach((g, gi) => {
      if (isSafeAutoMergeGroup(g) && (g.score || 0) >= 0.95) next.add(gi);
    });
    setSelectedGroups(next);
  }

  function selectAllGroups() {
    setSelectedGroups(new Set(groups.map((_, i) => i)));
  }

  function clearSelection() {
    setSelectedGroups(new Set());
  }

  async function bulkMergeSelected() {
    const indices = [...selectedGroups].sort((a, b) => a - b);
    if (!indices.length) { alert('Select at least one group.'); return; }
    const preview = indices.map((i) => {
      const g = groups[i];
      const can = pickCanonical(g.members);
      return `• ${g.members.map((m) => m.name).join(' / ')} → "${can}"`;
    }).join('\n');
    if (!confirm(
      `Merge ${indices.length} group(s)?\n\nRule: keep Allocation name when present, else Payment, else longest.\n\n${preview.slice(0, 1500)}${preview.length > 1500 ? '\n…' : ''}`
    )) return;

    setBulkBusy(true);
    let total = 0;
    const errors = [];
    let mergedGroups = 0;
    for (const i of indices) {
      const g = groups[i];
      const canonical = pickCanonical(g.members);
      if (!canonical) continue;
      for (const m of g.members) {
        if (m.name === canonical) continue;
        const { updated, errors: errs } = await renameAcrossTables(estateId, m.name, canonical);
        total += updated;
        if (errs?.length) errors.push(...errs);
      }
      mergedGroups += 1;
    }
    setBulkBusy(false);
    if (errors.length) alert(`Bulk merge done with issues:\n${errors.slice(0, 8).join('\n')}\n\nGroups: ${mergedGroups}, rows: ${total}`);
    else alert(`Merged ${mergedGroups} group(s), ${total} row(s) updated.`);
    setSelectedGroups(new Set());
    runScan();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Possible duplicate names</h2>
          <p className="muted" style={{ margin: 0 }}>
            Flag only — then <b>Edit</b> one spelling or <b>Merge</b> variants into one official name
            (updates offers, payments, allocations, refunds, COO, documents for this estate).
            <br />
            <b>Multi-unit:</b> two of same type → Name 1 / Name 2 (do not merge if both units are real).
            Different types → same name is fine.
          </p>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap" style={{ alignItems: 'flex-end' }}>
          <div style={{ minWidth: 220 }}>
            <label>Estate</label>
            <select value={estateId} onChange={(e) => setEstateId(e.target.value)}>
              <option value="">Select estate…</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 140 }}>
            <label>Match sensitivity</label>
            <select value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
              <option value={0.9}>Strict (0.90)</option>
              <option value={0.82}>Balanced (0.82)</option>
              <option value={0.72}>Loose (0.72)</option>
            </select>
          </div>
          <button type="button" className="btn btn-primary" disabled={loading || !estateId} onClick={runScan}>
            {loading ? 'Scanning…' : 'Scan for duplicates'}
          </button>
        </div>
        {error && <div className="error-text" style={{ marginTop: 8 }}>{error}</div>}
      </div>

      {groups.length > 0 && (
        <div className="card" style={{ background: '#f8fafc' }}>
          <h3 style={{ marginTop: 0 }}>Bulk merge</h3>
          <p className="muted">
            Safe picks = same name tokens in any order or title only
            (e.g. Maj Moses vs MAJOR MOSES, or first/last name swapped).
            Keeps the <b>Allocation</b> spelling when available so payments link to the house.
            Groups with two different house numbers of the same type are skipped by &quot;Select safe&quot;.
          </p>
          <div className="flex wrap" style={{ gap: 8 }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={selectSafeGroups} disabled={bulkBusy}>
              Select safe high-confidence groups
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={selectAllGroups} disabled={bulkBusy}>
              Select all groups
            </button>
            <button type="button" className="btn btn-outline btn-sm" onClick={clearSelection} disabled={bulkBusy}>
              Clear selection
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={bulkMergeSelected}
              disabled={bulkBusy || selectedGroups.size === 0}
            >
              {bulkBusy ? 'Merging…' : `Merge selected (${selectedGroups.size})`}
            </button>
          </div>
        </div>
      )}

      {!loading && groups.length === 0 && estateId && (
        <p className="muted">No likely duplicate groups found for {estateName}.</p>
      )}

      {groups.map((g, gi) => {
        const multi = isMultiUnitGroup(g);
        return (
          <div className="card" key={gi} style={{ borderLeft: `4px solid ${multi ? '#3b82f6' : '#f59e0b'}` }}>
            <div className="flex wrap" style={{ justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  checked={selectedGroups.has(gi)}
                  onChange={() => toggleGroup(gi)}
                  title="Select for bulk merge"
                />
                Group {gi + 1} · {(g.score * 100).toFixed(0)}%
                {isSafeAutoMergeGroup(g) && <span className="tag approved" style={{ marginLeft: 4 }}>Safe auto</span>}
                {multi && <span className="tag PO" style={{ marginLeft: 8 }}>Multi-unit Name 1/2 — review before merge</span>}
              </h3>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => openMerge(g)} disabled={!!busy || bulkBusy}>
                Merge group…
              </button>
            </div>
            <div className="table-wrap" style={{ marginTop: 10 }}>
              <table>
                <thead>
                  <tr>
                    <th>Name as recorded</th>
                    <th>Normalized</th>
                    <th>Found in</th>
                    <th>Property types</th>
                    <th>Phone</th>
                    <th>Unit / PON</th>
                    <th className="right">Amounts</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {g.members.map((m) => (
                    <tr key={m.name}>
                      <td>
                        <b>{m.name}</b>
                        {m.unitIndex && <span className="muted"> · unit #{m.unitIndex}</span>}
                      </td>
                      <td className="muted">{m.normalized}</td>
                      <td>{m.sources.join(', ')}</td>
                      <td>{m.propertyTypes.join(', ') || '—'}</td>
                      <td>{m.phones.join(', ') || '—'}</td>
                      <td>{[...m.houses, ...m.pons].filter(Boolean).join(', ') || '—'}</td>
                      <td className="right">{m.amount ? m.amount.toLocaleString() : '—'}</td>
                      <td>
                        <div className="flex wrap">
                          <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(m.name)} disabled={!!busy}>Edit</button>
                          <Link className="btn btn-outline btn-sm" to={`/subscriber/${estateId}/${encodeURIComponent(m.name)}`}>Profile</Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {editFrom && (
        <div className="modal-overlay" onClick={() => setEditFrom(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Edit name spelling</h3>
            <form onSubmit={applyEdit}>
              <div className="field"><label>Current</label><input value={editFrom} disabled /></div>
              <div className="field"><label>Correct spelling</label>
                <input value={editTo} onChange={(e) => setEditTo(e.target.value)} required autoFocus />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setEditFrom(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy === 'edit'}>{busy === 'edit' ? 'Saving…' : 'Save spelling'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {mergeGroup && (
        <div className="modal-overlay" onClick={() => setMergeGroup(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>Merge into one official name</h3>
            {isMultiUnitGroup(mergeGroup) && (
              <p className="error-text">Looks like Name 1 / Name 2 multi-unit. Only merge if these are spelling errors, not two units.</p>
            )}
            <form onSubmit={applyMerge}>
              <div className="field">
                <label>Official name to keep (pick or type)</label>
                <select
                  value={mergeGroup.members.some((m) => m.name === mergeCanonical) ? mergeCanonical : ''}
                  onChange={(e) => setMergeCanonical(e.target.value)}
                >
                  <option value="">— type below —</option>
                  {mergeGroup.members.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
                </select>
                <input style={{ marginTop: 8 }} value={mergeCanonical} onChange={(e) => setMergeCanonical(e.target.value)} placeholder="Official full name" />
              </div>
              <div className="field">
                <label>Variants included in merge</label>
                {mergeGroup.members.map((m) => (
                  <label key={m.name} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                    <input
                      type="checkbox"
                      checked={mergeSelected.includes(m.name)}
                      disabled={m.name === mergeCanonical}
                      onChange={() => setMergeSelected((prev) =>
                        prev.includes(m.name) ? prev.filter((x) => x !== m.name) : [...prev, m.name]
                      )}
                    />
                    <span>{m.name}{m.name === mergeCanonical ? ' (canonical)' : ''}</span>
                  </label>
                ))}
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setMergeGroup(null)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={busy === 'merge'}>{busy === 'merge' ? 'Merging…' : 'Merge now'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
