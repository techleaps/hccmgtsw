import { supabase } from './supabaseClient';

const BUCKET = 'documents';

export async function uploadDocument({
  file,
  description,
  linkedUserId,
  linkedTable,
  linkedRecordId,
  uploadedBy,
  estateId,
  subscriberName,
}) {
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${uploadedBy || 'anon'}/${Date.now()}_${safeName}`;

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
    estate_id: estateId || null,
    subscriber_name: subscriberName || null,
    uploaded_by: uploadedBy,
  }).select().single();

  return { data, error };
}

export async function listDocuments({
  linkedUserId,
  linkedTable,
  linkedRecordId,
  estateId,
  subscriberName,
} = {}) {
  let query = supabase
    .from('documents')
    .select('*')
    .eq('is_deleted', false)
    .order('created_at', { ascending: false });
  if (linkedUserId) query = query.eq('linked_user_id', linkedUserId);
  if (linkedTable) query = query.eq('linked_table', linkedTable);
  if (linkedRecordId) query = query.eq('linked_record_id', linkedRecordId);
  if (estateId) query = query.eq('estate_id', estateId);
  if (subscriberName) query = query.ilike('subscriber_name', subscriberName);
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
