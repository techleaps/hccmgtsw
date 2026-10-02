import React from 'react';

// Renders form inputs for a list of custom_fields, bound to a `values`
// object (usually record.custom_data) and reporting changes upward.
export function CustomFieldInputs({ fields, values, onChange }) {
  if (!fields || fields.length === 0) return null;
  return (
    <div className="grid cols-2">
      {fields.map((f) => {
        const val = values?.[f.field_key] ?? '';
        const set = (v) => onChange({ ...(values || {}), [f.field_key]: v });
        return (
          <div className="field" key={f.id}>
            <label>{f.field_label}</label>
            {f.field_type === 'dropdown' ? (
              <select value={val} onChange={(e) => set(e.target.value)}>
                <option value="">Select…</option>
                {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            ) : f.field_type === 'checkbox' ? (
              <input type="checkbox" checked={!!val} onChange={(e) => set(e.target.checked)} style={{ width: 20, height: 20 }} />
            ) : f.field_type === 'number' ? (
              <input type="number" value={val} onChange={(e) => set(e.target.value)} />
            ) : f.field_type === 'date' ? (
              <input type="date" value={val} onChange={(e) => set(e.target.value)} />
            ) : (
              <input type="text" value={val} onChange={(e) => set(e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Extra <th> headers for a table that shows custom fields as columns.
export function CustomFieldHeaders({ fields }) {
  return fields.map((f) => <th key={f.id}>{f.field_label}</th>);
}

// Extra <td> cells matching CustomFieldHeaders, for one record's custom_data.
export function CustomFieldCells({ fields, values }) {
  return fields.map((f) => {
    const val = values?.[f.field_key];
    return (
      <td key={f.id}>
        {f.field_type === 'checkbox' ? (val ? '✓' : '') : (val ?? '')}
      </td>
    );
  });
}
