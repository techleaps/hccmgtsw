import { supabase } from './supabaseClient';

const BUCKET = 'documents';

export async function uploadDocument({ file, description, linkedUserId, linkedTable, linkedRecordId, uploadedBy }) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${uploadedBy}/${Date.now()}_${safeName}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (uploadError) return { error: uploadError };

  const { data, error } = await supabase.from('documents').insert({
    file_name: file.name,
    storage_path: path,
    mime_type: file.type || null,
    size_bytes: file.size,
    description: description || null,
    linked_user_id: linkedUserId || null,
    linked_table: linkedTable || null,
    linked_record_id: linkedRecordId || null,
    uploaded_by: uploadedBy,
  }).select().single();

  return { data, error };
}

export async function listDocuments({ linkedUserId, linkedTable, linkedRecordId } = {}) {
  let query = supabase
    .from('documents')
    .select('*, uploader:profiles!documents_uploaded_by_fkey(full_name), linked_user:profiles!documents_linked_user_id_fkey(full_name)')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (linkedUserId) query = query.eq('linked_user_id', linkedUserId);
  if (linkedTable) query = query.eq('linked_table', linkedTable);
  if (linkedRecordId) query = query.eq('linked_record_id', linkedRecordId);
  const { data } = await query;
  return data || [];
}

export async function getDownloadUrl(storagePath) {
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 60 * 5);
  return data?.signedUrl || null;
}

export async function deleteDocument(id, storagePath) {
  await supabase.storage.from(BUCKET).remove([storagePath]);
  return supabase.from('documents').update({ is_deleted: true }).eq('id', id);
}
