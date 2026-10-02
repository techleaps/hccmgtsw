import { supabase } from './supabaseClient';

// Users below supervisor rank cannot directly update/delete rows (RLS blocks it).
// This helper submits an edit_request instead, or performs a direct update/delete
// when the signed-in profile is a supervisor/admin/super_admin.
//
// Optimistic concurrency: pass expectedUpdatedAt (row.updated_at when the form opened).
// If another user saved the same row first, the update matches 0 rows and we return conflict.

const CONFLICT_MSG =
  'This record was changed by someone else since you opened it. Click OK, refresh the list, then edit again.';

export async function submitOrApplyUpdate({
  profile,
  tableName,
  recordId,
  changes,
  reason,
  expectedUpdatedAt,
}) {
  const canDirect = ['super_admin', 'admin', 'supervisor'].includes(profile.role);
  if (canDirect) {
    const payload = { ...changes, updated_at: new Date().toISOString() };
    let q = supabase.from(tableName).update(payload).eq('id', recordId);
    if (expectedUpdatedAt) {
      q = q.eq('updated_at', expectedUpdatedAt);
    }
    const { data, error } = await q.select('id');
    if (error) return { error, requiresApproval: false, conflict: false };
    if (expectedUpdatedAt && (!data || data.length === 0)) {
      return {
        error: { message: CONFLICT_MSG },
        requiresApproval: false,
        conflict: true,
      };
    }
    return { error: null, requiresApproval: false, conflict: false };
  }
  const { error } = await supabase.from('edit_requests').insert({
    table_name: tableName,
    record_id: recordId,
    request_type: 'update',
    proposed_changes: changes,
    reason: reason || null,
    requested_by: profile.id,
  });
  return { error, requiresApproval: true, conflict: false };
}

export async function submitOrApplyDelete({
  profile,
  tableName,
  recordId,
  reason,
  expectedUpdatedAt,
}) {
  const canDirect = ['super_admin', 'admin', 'supervisor'].includes(profile.role);
  if (canDirect) {
    let q = supabase
      .from(tableName)
      .update({ is_deleted: true, updated_at: new Date().toISOString() })
      .eq('id', recordId);
    if (expectedUpdatedAt) {
      q = q.eq('updated_at', expectedUpdatedAt);
    }
    const { data, error } = await q.select('id');
    if (error) return { error, requiresApproval: false, conflict: false };
    if (expectedUpdatedAt && (!data || data.length === 0)) {
      return {
        error: { message: CONFLICT_MSG },
        requiresApproval: false,
        conflict: true,
      };
    }
    return { error: null, requiresApproval: false, conflict: false };
  }
  const { error } = await supabase.from('edit_requests').insert({
    table_name: tableName,
    record_id: recordId,
    request_type: 'delete',
    reason: reason || null,
    requested_by: profile.id,
  });
  return { error, requiresApproval: true, conflict: false };
}
