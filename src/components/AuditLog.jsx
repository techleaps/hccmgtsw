import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { fetchAllFrom } from '../lib/fetchAll';

const ACTION_COLORS = {
  INSERT: 'approved',
  UPDATE: 'pending',
  DELETE: 'rejected',
  LOGIN: 'approved',
  LOGOUT: 'PO',
  IDLE_LOGOUT: 'PO',
  LOGIN_FAILED: 'rejected',
  PASSWORD_CHANGE: 'pending',
  USER_UPDATED: 'pending',
};

const KNOWN_TABLES = [
  'profiles',
  'estates',
  'estate_property_types',
  'offers',
  'allocation_records',
  'ownership_changes',
  'payments',
  'approvals_expenditures',
  'refunds',
  'contract_awards',
  'construction_units',
  'custom_fields',
  'custom_tabs',
  'custom_tab_records',
  'documents',
  'edit_requests',
  'auth_sessions',
];

/** Default look-back so we never pull the entire history on first load. */
const DEFAULT_DAYS = 90;
/** Hard cap per query to keep the UI responsive even with broad filters. */
const MAX_ROWS = 5000;

function friendlyTable(name) {
  const map = {
    profiles: 'Users / Profiles',
    estates: 'Estates',
    estate_property_types: 'Property types',
    offers: 'Offers',
    allocation_records: 'Allocations',
    ownership_changes: 'Change of Ownership',
    payments: 'Payments',
    approvals_expenditures: 'Approvals / Expenditure',
    refunds: 'Refunds',
    contract_awards: 'Award of Contract',
    construction_units: 'Construction units',
    custom_fields: 'Custom fields',
    custom_tabs: 'Custom tabs',
    custom_tab_records: 'Custom tab records',
    documents: 'Documents',
    edit_requests: 'Edit / Delete requests',
    auth_sessions: 'Login / Logout / Auth',
  };
  return map[name] || name;
}

function recordLabel(row) {
  const d = row.new_data || row.old_data || {};
  return (
    d.subscriber_name
    || d.contractor_name
    || d.title
    || d.name
    || d.full_name
    || d.house_no
    || d.file_name
    || d.description
    || (row.record_id ? String(row.record_id).slice(0, 8) + '…' : '—')
  );
}

function daysAgoISO(days) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [profiles, setProfiles] = useState([]);

  // Applied filters (used for the query)
  const [tableFilter, setTableFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [fromDate, setFromDate] = useState(() => daysAgoISO(DEFAULT_DAYS));
  const [toDate, setToDate] = useState('');
  const [search, setSearch] = useState('');

  // Draft filters so typing dates / picks don't fire a query until Apply
  const [draftTable, setDraftTable] = useState('');
  const [draftAction, setDraftAction] = useState('');
  const [draftUser, setDraftUser] = useState('');
  const [draftFrom, setDraftFrom] = useState(() => daysAgoISO(DEFAULT_DAYS));
  const [draftTo, setDraftTo] = useState('');
  const [draftSearch, setDraftSearch] = useState('');

  const [expanded, setExpanded] = useState(null);
  const [sortKey, setSortKey] = useState('performed_at');
  const [sortDir, setSortDir] = useState('desc');

  useEffect(() => {
    loadProfiles();
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name, email')
      .order('full_name');
    setProfiles(data || []);
  }

  async function load(overrides = null) {
    const f = overrides || {
      table: tableFilter,
      action: actionFilter,
      user: userFilter,
      from: fromDate,
      to: toDate,
    };

    setLoading(true);
    setError('');
    setTruncated(false);
    setExpanded(null);

    try {
      const data = await fetchAllFrom(
        'audit_logs',
        (q) => {
          let query = q
            .select('*, profiles(full_name, email)')
            .order('performed_at', { ascending: false });

          if (f.table) query = query.eq('table_name', f.table);
          if (f.action) query = query.eq('action', f.action);
          if (f.user === 'system') query = query.is('performed_by', null);
          else if (f.user) query = query.eq('performed_by', f.user);
          if (f.from) query = query.gte('performed_at', `${f.from}T00:00:00`);
          if (f.to) query = query.lte('performed_at', `${f.to}T23:59:59.999`);

          return query;
        },
        1000
      );

      let rows = data || [];
      if (rows.length > MAX_ROWS) {
        rows = rows.slice(0, MAX_ROWS);
        setTruncated(true);
      }
      setLogs(rows);
    } catch (err) {
      setError(err.message || 'Failed to load audit log');
      // Fallback: limited query with same filters
      try {
        let q = supabase
          .from('audit_logs')
          .select('*, profiles(full_name, email)')
          .order('performed_at', { ascending: false })
          .limit(1000);
        if (f.table) q = q.eq('table_name', f.table);
        if (f.action) q = q.eq('action', f.action);
        if (f.user === 'system') q = q.is('performed_by', null);
        else if (f.user) q = q.eq('performed_by', f.user);
        if (f.from) q = q.gte('performed_at', `${f.from}T00:00:00`);
        if (f.to) q = q.lte('performed_at', `${f.to}T23:59:59.999`);
        const { data } = await q;
        setLogs(data || []);
      } catch {
        setLogs([]);
      }
    }
    setLoading(false);
  }

  function applyFilters() {
    setTableFilter(draftTable);
    setActionFilter(draftAction);
    setUserFilter(draftUser);
    setFromDate(draftFrom);
    setToDate(draftTo);
    setSearch(draftSearch.trim());
    load({
      table: draftTable,
      action: draftAction,
      user: draftUser,
      from: draftFrom,
      to: draftTo,
    });
  }

  function clearFilters() {
    const from = daysAgoISO(DEFAULT_DAYS);
    setDraftTable('');
    setDraftAction('');
    setDraftUser('');
    setDraftFrom(from);
    setDraftTo('');
    setDraftSearch('');
    setTableFilter('');
    setActionFilter('');
    setUserFilter('');
    setFromDate(from);
    setToDate('');
    setSearch('');
    load({ table: '', action: '', user: '', from, to: '' });
  }

  const tables = useMemo(() => {
    const fromLogs = logs.map((l) => l.table_name).filter(Boolean);
    return [...new Set([...KNOWN_TABLES, ...fromLogs])].sort();
  }, [logs]);

  const users = useMemo(() => {
    const list = profiles.map((p) => ({
      id: p.id,
      name: p.full_name || p.email || p.id.slice(0, 8),
    }));
    list.unshift({ id: 'system', name: 'System / unknown' });
    return list;
  }, [profiles]);

  const filtered = useMemo(() => {
    const list = logs.filter((l) => {
      // Server already applied table/action/user/date; search is client-side
      if (search.trim()) {
        const s = search.toLowerCase();
        const blob = JSON.stringify({
          table: l.table_name,
          action: l.action,
          summary: l.summary,
          old: l.old_data,
          new: l.new_data,
          who: l.profiles?.full_name || l.profiles?.email,
          record: recordLabel(l),
          id: l.record_id,
        }).toLowerCase();
        if (!blob.includes(s)) return false;
      }
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'performed_at') {
        const ta = new Date(a.performed_at).getTime() || 0;
        const tb = new Date(b.performed_at).getTime() || 0;
        return (ta - tb) * dir;
      }
      if (sortKey === 'table') {
        return friendlyTable(a.table_name).localeCompare(friendlyTable(b.table_name)) * dir;
      }
      if (sortKey === 'action') {
        return String(a.action || '').localeCompare(String(b.action || '')) * dir;
      }
      if (sortKey === 'record') {
        return recordLabel(a).localeCompare(recordLabel(b), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      }
      if (sortKey === 'summary') {
        return String(a.summary || '').localeCompare(String(b.summary || ''), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      }
      if (sortKey === 'performed_by') {
        const na = (a.profiles?.full_name || a.profiles?.email || (a.performed_by ? 'User' : 'System')).toLowerCase();
        const nb = (b.profiles?.full_name || b.profiles?.email || (b.performed_by ? 'User' : 'System')).toLowerCase();
        return na.localeCompare(nb) * dir;
      }
      // Generic fallback with natural (numeric-aware) string compare
      const va = String(a[sortKey] ?? '');
      const vb = String(b[sortKey] ?? '');
      return va.localeCompare(vb, undefined, { numeric: true, sensitivity: 'base' }) * dir;
    });
    return list;
  }, [logs, search, sortKey, sortDir]);

  const stats = useMemo(() => {
    const byAction = { INSERT: 0, UPDATE: 0, DELETE: 0, LOGIN: 0, LOGOUT: 0, LOGIN_FAILED: 0, IDLE_LOGOUT: 0 };
    filtered.forEach((l) => { byAction[l.action] = (byAction[l.action] || 0) + 1; });
    return { total: filtered.length, ...byAction };
  }, [filtered]);

  function toggleSort(key) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else {
      setSortKey(key);
      setSortDir(key === 'performed_at' ? 'desc' : 'asc');
    }
  }

  function sortLabel(key, label) {
    if (sortKey !== key) return label;
    return `${label} ${sortDir === 'asc' ? '▲' : '▼'}`;
  }

  function exportCsv() {
    const cols = ['performed_at', 'table_name', 'action', 'summary', 'record_id', 'performed_by_name', 'changed_fields', 'old_data', 'new_data'];
    const lines = [cols.join(',')];
    filtered.forEach((l) => {
      const row = [
        l.performed_at,
        l.table_name,
        l.action,
        JSON.stringify(l.summary || ''),
        l.record_id || '',
        JSON.stringify(l.profiles?.full_name || ''),
        JSON.stringify((l.changed_fields || []).join('; ')),
        JSON.stringify(l.old_data || null),
        JSON.stringify(l.new_data || null),
      ];
      lines.push(row.join(','));
    });
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Audit Log</h2>
          <p className="muted" style={{ margin: 0 }}>
            Complete system trail — every create, update, and delete on business data is recorded automatically
            (including bulk imports and soft-deletes). Use filters and export for accountability.
          </p>
        </div>
        <div className="flex wrap">
          <button type="button" className="btn btn-outline" onClick={() => load()} disabled={loading}>Refresh</button>
          <button type="button" className="btn btn-outline" onClick={exportCsv} disabled={!filtered.length}>Export CSV</button>
        </div>
      </div>

      {error && <div className="error-text">{error}</div>}

      <div className="grid cols-4">
        <div className="stat-card"><div className="value">{stats.total}</div><div className="label">Events (filtered)</div></div>
        <div className="stat-card"><div className="value">{stats.INSERT || 0}</div><div className="label">Creates</div></div>
        <div className="stat-card"><div className="value">{stats.UPDATE || 0}</div><div className="label">Updates</div></div>
        <div className="stat-card"><div className="value">{stats.DELETE || 0}</div><div className="label">Deletes</div></div>
      </div>
      <div className="grid cols-3">
        <div className="stat-card"><div className="value">{stats.LOGIN || 0}</div><div className="label">Logins</div></div>
        <div className="stat-card"><div className="value">{(stats.LOGOUT || 0) + (stats.IDLE_LOGOUT || 0)}</div><div className="label">Logouts (incl. idle)</div></div>
        <div className="stat-card"><div className="value">{stats.LOGIN_FAILED || 0}</div><div className="label">Failed logins</div></div>
      </div>

      <div className="card">
        <div className="section-label" style={{ marginTop: 0 }}>Filters</div>
        <div className="flex wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div style={{ minWidth: 160 }}>
            <label>Table</label>
            <select value={draftTable} onChange={(e) => setDraftTable(e.target.value)}>
              <option value="">All tables</option>
              {tables.map((t) => <option key={t} value={t}>{friendlyTable(t)}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label>Action</label>
            <select value={draftAction} onChange={(e) => setDraftAction(e.target.value)}>
              <option value="">All</option>
              <option value="INSERT">Create</option>
              <option value="UPDATE">Update</option>
              <option value="DELETE">Delete</option>
              <option value="LOGIN">Login</option>
              <option value="LOGOUT">Logout</option>
              <option value="IDLE_LOGOUT">Idle logout</option>
              <option value="LOGIN_FAILED">Login failed</option>
              <option value="PASSWORD_CHANGE">Password change</option>
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Performed by</label>
            <select value={draftUser} onChange={(e) => setDraftUser(e.target.value)}>
              <option value="">Anyone</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <label>Search (any field)</label>
            <input
              value={draftSearch}
              onChange={(e) => setDraftSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyFilters(); }}
              placeholder="Name, amount, id… e.g. idu"
            />
          </div>
        </div>

        <div className="section-label" style={{ marginTop: 16 }}>Date range</div>
        <div className="flex wrap" style={{ alignItems: 'flex-end', gap: 12 }}>
          <div style={{ minWidth: 160 }}>
            <label>From date</label>
            <input
              type="date"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
              style={{ minWidth: 160 }}
            />
          </div>
          <div style={{ minWidth: 160 }}>
            <label>To date</label>
            <input
              type="date"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
              style={{ minWidth: 160 }}
            />
          </div>
          <div className="flex wrap" style={{ gap: 8 }}>
            <button type="button" className="btn" onClick={applyFilters} disabled={loading}>
              Apply filters
            </button>
            <button type="button" className="btn btn-outline" onClick={clearFilters} disabled={loading}>
              Reset
            </button>
          </div>
        </div>
        <p className="muted" style={{ margin: '10px 0 0', fontSize: 12 }}>
          <b>Date range is required for fast loading.</b> Table, action, user and dates are queried on the server.
          Search runs on the loaded results. Default is the last {DEFAULT_DAYS} days — clear or widen “From date” for older history, then click Apply.
        </p>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading audit trail…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('performed_at')}>{sortLabel('performed_at', 'Date / time')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('table')}>{sortLabel('table', 'Table')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('action')}>{sortLabel('action', 'Action')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('record')}>{sortLabel('record', 'Record')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('summary')}>{sortLabel('summary', 'Summary')}</th>
                <th style={{ cursor: 'pointer' }} onClick={() => toggleSort('performed_by')}>{sortLabel('performed_by', 'Performed by')}</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <React.Fragment key={l.id}>
                  <tr>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(l.performed_at).toLocaleString()}</td>
                    <td>{friendlyTable(l.table_name)}</td>
                    <td>
                      <span className={`tag ${ACTION_COLORS[l.action] || 'PO'}`}>{l.action}</span>
                    </td>
                    <td style={{ fontSize: 13, maxWidth: 160 }}>{recordLabel(l)}</td>
                    <td style={{ fontSize: 12, maxWidth: 280 }}>
                      {l.summary || '—'}
                      {l.changed_fields?.length > 0 && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          Fields: {l.changed_fields.join(', ')}
                        </div>
                      )}
                    </td>
                    <td>{l.profiles?.full_name || l.profiles?.email || (l.performed_by ? 'User' : 'System')}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => setExpanded(expanded === l.id ? null : l.id)}
                      >
                        {expanded === l.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr>
                      <td colSpan={7}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                          <div>
                            <div className="muted" style={{ marginBottom: 4 }}>Before (old)</div>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: '#f8fafc', padding: 10, borderRadius: 6, maxHeight: 320, overflow: 'auto' }}>
                              {l.old_data ? JSON.stringify(l.old_data, null, 2) : '— (create)'}
                            </pre>
                          </div>
                          <div>
                            <div className="muted" style={{ marginBottom: 4 }}>After (new)</div>
                            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: '#f8fafc', padding: 10, borderRadius: 6, maxHeight: 320, overflow: 'auto' }}>
                              {l.new_data ? JSON.stringify(l.new_data, null, 2) : '— (delete)'}
                            </pre>
                          </div>
                        </div>
                        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                          Record ID: {l.record_id || '—'} · Source: {l.source || 'db_trigger'} · Log ID: {l.id}
                        </p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-state">
                    No audit entries match the filters. Widen the date range or clear filters, then click Apply.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted" style={{ marginTop: 12 }}>
        Showing {filtered.length.toLocaleString()} of {logs.length.toLocaleString()} loaded events
        {fromDate || toDate ? (
          <> (date range: {fromDate || '…'} → {toDate || 'now'})</>
        ) : null}
        {truncated ? (
          <> · results capped at {MAX_ROWS.toLocaleString()} — narrow the date range for a complete view</>
        ) : null}
        . Soft-deletes appear as UPDATE with <code>is_deleted</code> → true. Hard deletes appear as DELETE.
        Click column headers to sort (natural order for numbers/text, chronological for dates).
      </p>
    </div>
  );
}
