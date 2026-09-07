import { supabase } from './supabaseClient';

export async function fetchCustomFields(tableName) {
  const { data } = await supabase
    .from('custom_fields')
    .select('*')
    .eq('table_name', tableName)
    .eq('is_deleted', false)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true });
  return data || [];
}

export async function addCustomField(tableName, { field_label, field_type, options }, createdBy) {
  const field_key = field_label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || `field_${Date.now()}`;

  return supabase.from('custom_fields').insert({
    table_name: tableName,
    field_key,
    field_label: field_label.trim(),
    field_type,
    options: options || [],
    created_by: createdBy,
  });
}

export async function deleteCustomField(id) {
  return supabase.from('custom_fields').update({ is_deleted: true }).eq('id', id);
}
