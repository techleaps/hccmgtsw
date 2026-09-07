import { supabase } from './supabaseClient';

// Users below supervisor rank cannot directly update/delete rows (RLS blocks it).
// This helper submits an edit_request instead, or performs a direct update/delete
// when the signed-in profile is a supervisor/admin/super_admin.

export async function submitOrApplyUpdate({ profile, tableName, recordId, changes, reason }) {
  const canDirect = ['super_admin', 'admin', 'supervisor'].includes(profile.role);
  if (canDirect) {
    const { error } = await supabase.from(tableName).update(changes).eq('id', recordId);
    return { error, requiresApproval: false };
  }
  const { error } = await supabase.from('edit_requests').insert({
    table_name: tableName,
    record_id: recordId,
    request_type: 'update',
    proposed_changes: changes,
    reason: reason || null,
    requested_by: profile.id,
  });
  return { error, requiresApproval: true };
}

export async function submitOrApplyDelete({ profile, tableName, recordId, reason }) {
  const canDirect = ['super_admin', 'admin', 'supervisor'].includes(profile.role);
  if (canDirect) {
    const { error } = await supabase.from(tableName).update({ is_deleted: true }).eq('id', recordId);
    return { error, requiresApproval: false };
  }
  const { error } = await supabase.from('edit_requests').insert({
    table_name: tableName,
    record_id: recordId,
    request_type: 'delete',
    reason: reason || null,
    requested_by: profile.id,
  });
  return { error, requiresApproval: true };
}
