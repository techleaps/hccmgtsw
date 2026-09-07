import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

export default function AuditLog() {
  const [logs, setLogs] = useState([]);
  const [tableFilter, setTableFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('audit_logs').select('*, profiles(full_name)').order('performed_at', { ascending: false }).limit(500);
    setLogs(data || []);
    setLoading(false);
  }

  const tables = useMemo(() => [...new Set(logs.map((l) => l.table_name))], [logs]);
  const filtered = useMemo(() => (tableFilter ? logs.filter((l) => l.table_name === tableFilter) : logs), [logs, tableFilter]);

  return (
    <div>
      <div className="page-title"><h2>Audit Log</h2></div>
      <p className="muted">Every create, edit, and delete across the system is recorded here automatically for accountability. Showing the latest 500 events.</p>

      <div className="card">
        <label>Filter by Table</label>
        <select value={tableFilter} onChange={(e) => setTableFilter(e.target.value)}>
          <option value="">All Tables</option>
          {tables.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr><th>Date/Time</th><th>Table</th><th>Action</th><th>Performed By</th><th>Details</th></tr>
            </thead>
            <tbody>
              {filtered.map((l) => (
                <React.Fragment key={l.id}>
                  <tr>
                    <td>{new Date(l.performed_at).toLocaleString()}</td>
                    <td>{l.table_name}</td>
                    <td><span className={`tag ${l.action === 'DELETE' ? 'rejected' : l.action === 'INSERT' ? 'approved' : 'pending'}`}>{l.action}</span></td>
                    <td>{l.profiles?.full_name || '—'}</td>
                    <td>
                      <button className="btn btn-outline btn-sm" onClick={() => setExpanded(expanded === l.id ? null : l.id)}>
                        {expanded === l.id ? 'Hide' : 'View'}
                      </button>
                    </td>
                  </tr>
                  {expanded === l.id && (
                    <tr>
                      <td colSpan={5}>
                        <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f8fafc', padding: 10, borderRadius: 6 }}>
                          {JSON.stringify({ old: l.old_data, new: l.new_data }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {filtered.length === 0 && <tr><td colSpan={5} className="empty-state">No audit entries yet.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
