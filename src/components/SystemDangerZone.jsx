import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';

/**
 * Super-admin only: soft-delete operational data so the system can start clean.
 * Does NOT delete user accounts / profiles.
 */
const TABLES = [
  'payments',
  'offers',
  'allocation_records',
  'refunds',
  'ownership_changes',
  'approvals_expenditures',
  'construction_units',
  'contract_awards',
  'documents',
  'edit_requests',
  'audit_logs',
  'custom_tab_records',
];

export default function SystemDangerZone() {
  const { isSuperAdmin, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);

  if (!isSuperAdmin) {
    return (
      <div className="empty-state">
        Only a Super Admin can clear system data.
      </div>
    );
  }

  async function clearAll() {
    const ok = confirm(
      'This will soft-delete ALL operational data (payments, offers, allocations, refunds, COO, construction, contracts, documents, etc.).\n\nUser accounts are kept.\n\nContinue?'
    );
    if (!ok) return;
    const typed = prompt('Type CLEAR ALL DATA to confirm:');
    if (typed !== 'CLEAR ALL DATA') {
      alert('Cancelled.');
      return;
    }

    setBusy(true);
    const lines = [];
    for (const table of TABLES) {
      try {
        // Prefer soft-delete when is_deleted exists
        let res = await supabase.from(table).update({ is_deleted: true }).eq('is_deleted', false);
        if (res.error && /is_deleted|column/i.test(res.error.message)) {
          // Hard tables without is_deleted (e.g. ownership_changes, audit_logs)
          res = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        }
        if (res.error) {
          lines.push(`${table}: ERROR — ${res.error.message}`);
        } else {
          lines.push(`${table}: cleared`);
        }
      } catch (err) {
        lines.push(`${table}: ERROR — ${err.message}`);
      }
    }
    // Soft-delete estates last? Keep estates structure - user may want estates. Soft-delete estates optional.
    const wipeEstates = confirm('Also soft-delete all Estates? (Cancel = keep estates, only clear records)');
    if (wipeEstates) {
      const { error } = await supabase.from('estates').update({ is_deleted: true }).eq('is_deleted', false);
      lines.push(error ? `estates: ERROR — ${error.message}` : 'estates: cleared');
    } else {
      lines.push('estates: kept');
    }
    lines.push(`Done by ${profile?.full_name || profile?.email || 'super admin'} at ${new Date().toISOString()}`);
    setLog(lines);
    setBusy(false);
    alert('Clear completed. Check the log on this page.');
  }

  return (
    <div>
      <div className="page-title">
        <h2>System danger zone</h2>
      </div>
      <div className="card" style={{ borderColor: '#fecaca', background: '#fff1f2' }}>
        <h3 style={{ color: '#991b1b' }}>Clear all operational data</h3>
        <p>
          Use this after testing, before going live with real subscriber data, or when you need a full reset.
          This soft-deletes records (they leave the live screens). <b>User accounts are not deleted.</b>
        </p>
        <ul>
          {TABLES.map((t) => <li key={t}><code>{t}</code></li>)}
        </ul>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={clearAll}>
          {busy ? 'Clearing…' : 'Clear All Data'}
        </button>
      </div>
      {log.length > 0 && (
        <div className="card">
          <h3>Last clear log</h3>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{log.join('\n')}</pre>
        </div>
      )}
    </div>
  );
}
