import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';
import { findDuplicateGroups, nameSimilarity, normalizePersonName } from '../lib/nameMatching';

/**
 * Flag possible duplicate subscribers for human review.
 * Does NOT auto-merge — AA decides.
 */
export default function DuplicatesTab() {
  const [estates, setEstates] = useState([]);
  const [estateId, setEstateId] = useState('');
  const [loading, setLoading] = useState(false);
  const [groups, setGroups] = useState([]);
  const [threshold, setThreshold] = useState(0.82);
  const [error, setError] = useState('');

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
          q.select('id, subscriber_name, amount_approved').eq('estate_id', estateId).eq('is_deleted', false)
        ),
      ]);

      // Build unique display rows by raw name, then group similar names
      const byRaw = new Map();
      function add(name, source, extra = {}) {
        const n = String(name || '').trim();
        if (!n) return;
        const key = n.toLowerCase();
        if (!byRaw.has(key)) {
          byRaw.set(key, {
            name: n,
            normalized: normalizePersonName(n),
            sources: new Set(),
            phones: new Set(),
            houses: new Set(),
            pons: new Set(),
            amount: 0,
          });
        }
        const rec = byRaw.get(key);
        rec.sources.add(source);
        if (extra.phone) rec.phones.add(extra.phone);
        if (extra.house) rec.houses.add(extra.house);
        if (extra.pon) rec.pons.add(extra.pon);
        if (extra.amount) rec.amount += Number(extra.amount) || 0;
      }

      offers.forEach((o) => add(o.subscriber_name, 'Offer', { phone: o.phone_number, pon: o.form_no }));
      allocs.forEach((a) => add(a.subscriber_name, 'Allocation', { phone: a.phone_number, house: a.house_no }));
      payments.forEach((p) => add(p.subscriber_name, 'Payment', { amount: p.amount }));
      refunds.forEach((r) => add(r.subscriber_name, 'Refund', { amount: r.amount_approved }));

      const rows = [...byRaw.values()].map((r) => ({
        ...r,
        sources: [...r.sources],
        phones: [...r.phones],
        houses: [...r.houses],
        pons: [...r.pons],
      }));

      const dupGroups = findDuplicateGroups(rows, 'name', Number(threshold) || 0.82);
      setGroups(dupGroups);
      if (!dupGroups.length) setError('');
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

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Possible duplicate names</h2>
          <p className="muted" style={{ margin: 0 }}>
            Records are <b>allowed in</b> first. This screen only <b>flags</b> names that look like the same person
            (ranks stripped, spelling variants like Mohammed/Muhammed). Review and fix manually — nothing is merged automatically.
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

      {!loading && groups.length === 0 && estateId && (
        <p className="muted">No likely duplicate groups found for {estateName} at this sensitivity.</p>
      )}

      {groups.map((g, gi) => (
        <div className="card" key={gi} style={{ borderLeft: '4px solid #f59e0b' }}>
          <div className="flex" style={{ justifyContent: 'space-between' }}>
            <h3 style={{ margin: 0 }}>Group {gi + 1} · match score {(g.score * 100).toFixed(0)}%</h3>
            <span className="tag PO">{g.members.length} name variants</span>
          </div>
          <div className="table-wrap" style={{ marginTop: 10 }}>
            <table>
              <thead>
                <tr>
                  <th>Name as recorded</th>
                  <th>Normalized</th>
                  <th>Found in</th>
                  <th>Phone</th>
                  <th>Unit / PON</th>
                  <th className="right">₹ linked amounts*</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {g.members.map((m) => (
                  <tr key={m.name}>
                    <td><b>{m.name}</b></td>
                    <td className="muted">{m.normalized}</td>
                    <td>{m.sources.join(', ')}</td>
                    <td>{m.phones.join(', ') || '—'}</td>
                    <td>
                      {[...m.houses, ...m.pons].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="right">{m.amount ? m.amount.toLocaleString() : '—'}</td>
                    <td>
                      <Link
                        className="btn btn-outline btn-sm"
                        to={`/subscriber/${estateId}/${encodeURIComponent(m.name)}`}
                      >
                        Open profile
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            Suggested action: pick the official spelling, edit the other records to match, so payments/offers/allocations line up.
            *Amounts are summed from payment/refund rows under that exact name spelling only.
          </p>
        </div>
      ))}
    </div>
  );
}
