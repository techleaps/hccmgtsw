import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

export default function EditRequests() {
  const { profile, isSupervisorPlus } = useAuth();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from('edit_requests')
      .select('*, requester:profiles!edit_requests_requested_by_fkey(full_name)')
      .order('requested_at', { ascending: false });
    setRequests(data || []);
    setLoading(false);
  }

  async function review(id, approve) {
    const comment = approve ? null : prompt('Reason for rejecting (optional):');
    const { error } = await supabase.rpc('apply_edit_request', { p_request_id: id, p_approve: approve, p_review_comment: comment });
    if (error) { alert(error.message); return; }
    load();
  }

  const pending = requests.filter((r) => r.status === 'pending');
  const resolved = requests.filter((r) => r.status !== 'pending');

  return (
    <div>
      <div className="page-title"><h2>Edit / Delete Requests</h2></div>
      <p className="muted">
        {isSupervisorPlus
          ? 'Review requests submitted by your team below.'
          : 'Requests you submit to edit or delete a record appear here until a supervisor/admin reviews them.'}
      </p>

      <div className="card">
        <h3>Pending ({pending.length})</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Requested</th><th>Table</th><th>Type</th><th>Requested By</th><th>Reason</th>{isSupervisorPlus && <th>Actions</th>}</tr></thead>
            <tbody>
              {pending.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.requested_at).toLocaleString()}</td>
                  <td>{r.table_name}</td>
                  <td><span className="tag pending">{r.request_type}</span></td>
                  <td>{r.requester?.full_name}</td>
                  <td>{r.reason || '—'}</td>
                  {isSupervisorPlus && (
                    <td>
                      <div className="flex">
                        <button className="btn btn-primary btn-sm" onClick={() => review(r.id, true)}>Approve</button>
                        <button className="btn btn-danger btn-sm" onClick={() => review(r.id, false)}>Reject</button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {pending.length === 0 && <tr><td colSpan={isSupervisorPlus ? 6 : 5} className="empty-state">Nothing pending.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3>Resolved History</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Requested</th><th>Table</th><th>Type</th><th>Requested By</th><th>Status</th><th>Reviewed</th></tr></thead>
            <tbody>
              {resolved.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.requested_at).toLocaleString()}</td>
                  <td>{r.table_name}</td>
                  <td>{r.request_type}</td>
                  <td>{r.requester?.full_name}</td>
                  <td><span className={`tag ${r.status}`}>{r.status}</span></td>
                  <td>{r.reviewed_at ? new Date(r.reviewed_at).toLocaleString() : '—'}</td>
                </tr>
              ))}
              {resolved.length === 0 && <tr><td colSpan={6} className="empty-state">No history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      {loading && <p className="muted">Loading…</p>}
    </div>
  );
}
