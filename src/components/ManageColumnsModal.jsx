import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { fetchCustomFields, addCustomField, deleteCustomField } from '../lib/customFields';

const TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown (choose one)' },
  { value: 'checkbox', label: 'Checkbox (yes/no)' },
];

export default function ManageColumnsModal({ tableName, onClose, onChanged }) {
  const { profile, isAdmin } = useAuth();
  const [fields, setFields] = useState([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [type, setType] = useState('text');
  const [optionsText, setOptionsText] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { load(); }, [tableName]);

  async function load() {
    setLoading(true);
    setFields(await fetchCustomFields(tableName));
    setLoading(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    if (!label.trim()) { setError('Column name is required.'); return; }
    setSaving(true);
    const options = type === 'dropdown' ? optionsText.split(',').map((o) => o.trim()).filter(Boolean) : [];
    const { error } = await addCustomField(tableName, { field_label: label, field_type: type, options }, profile.id);
    setSaving(false);
    if (error) { setError(error.message); return; }
    setLabel(''); setOptionsText(''); setType('text');
    await load();
    onChanged?.();
  }

  async function handleRemove(id) {
    if (!confirm('Remove this column? Existing values for it will no longer be shown.')) return;
    await deleteCustomField(id);
    await load();
    onChanged?.();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Manage Extra Columns</h3>
        <p className="muted">
          Add extra columns to this register. They will appear as fields on the entry form and as extra columns in the table for everyone.
        </p>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : fields.length === 0 ? (
          <p className="muted">No extra columns added yet.</p>
        ) : (
          <div className="table-wrap" style={{ marginBottom: 16 }}>
            <table>
              <thead><tr><th>Column</th><th>Type</th><th>Options</th><th></th></tr></thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.id}>
                    <td>{f.field_label}</td>
                    <td>{TYPES.find((t) => t.value === f.field_type)?.label || f.field_type}</td>
                    <td>{(f.options || []).join(', ')}</td>
                    <td>
                      {isAdmin && <button className="btn btn-danger btn-sm" onClick={() => handleRemove(f.id)}>Remove</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isAdmin && (
          <form onSubmit={handleAdd}>
            <h4 style={{ marginTop: 0 }}>Add a New Column</h4>
            <div className="grid cols-2">
              <div className="field">
                <label>Column Name</label>
                <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Next of Kin" />
              </div>
              <div className="field">
                <label>Type</label>
                <select value={type} onChange={(e) => setType(e.target.value)}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>
            {type === 'dropdown' && (
              <div className="field">
                <label>Dropdown Options (comma separated)</label>
                <input value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Option A, Option B, Option C" />
              </div>
            )}
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Adding…' : 'Add Column'}</button>
            </div>
          </form>
        )}
        {!isAdmin && (
          <div className="modal-actions">
            <button type="button" className="btn btn-outline" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
