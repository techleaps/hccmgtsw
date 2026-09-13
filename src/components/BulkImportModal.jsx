import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';

const IGNORE = '__ignore__';

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function guessMapping(headers, fieldDefs) {
  return headers.map((h) => {
    const norm = normalize(h);
    if (!norm || norm === 'serial' || norm === 's n' || norm === 'sn') return IGNORE;
    for (const f of fieldDefs) {
      if (f.synonyms.some((syn) => normalize(syn) === norm)) return f.key;
    }
    for (const f of fieldDefs) {
      if (f.synonyms.some((syn) => norm.includes(normalize(syn)) || normalize(syn).includes(norm))) return f.key;
    }
    return IGNORE;
  });
}

function excelDateToISO(value) {
  if (value instanceof Date && !isNaN(value)) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'string' && value.trim()) {
    const d = new Date(value);
    if (!isNaN(d)) return d.toISOString().slice(0, 10);
  }
  return null;
}

function isChecked(value) {
  const s = String(value ?? '').trim();
  return s.length > 0;
}

export default function BulkImportModal({ title, tableName, fieldDefs, estates = [], onClose, onImported, profile }) {
  const [step, setStep] = useState('estate'); // estate -> upload -> mapping -> preview -> importing -> done
  const [estateId, setEstateId] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rows, setRows] = useState([]); // array of arrays, raw
  const [mapping, setMapping] = useState([]); // array parallel to headers, field key or IGNORE
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  function handleFile(e) {
    setError('');
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const nonEmptyRows = grid.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
        if (nonEmptyRows.length < 2) {
          setError('Could not find a header row and data rows in this file.');
          return;
        }
        const hdrRow = nonEmptyRows[0].map((h) => String(h ?? '').trim());
        const dataRows = nonEmptyRows.slice(1);
        setHeaders(hdrRow);
        setRows(dataRows);
        setMapping(guessMapping(hdrRow, fieldDefs));
        setStep('mapping');
      } catch (err) {
        setError('Could not read that file. Make sure it is a valid .xlsx, .xls, or .csv file.');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  function updateMapping(idx, value) {
    const next = [...mapping];
    next[idx] = value;
    setMapping(next);
  }

  const mappedPreview = useMemo(() => {
    return buildRecords(rows.slice(0, 5), headers, mapping, fieldDefs);
  }, [rows, headers, mapping, fieldDefs]);

  function buildRecords(sourceRows, hdrs, map, defs) {
    return sourceRows.map((r) => {
      const rec = {};
      hdrs.forEach((h, i) => {
        const key = map[i];
        if (!key || key === IGNORE) return;
        const def = defs.find((f) => f.key === key);
        const raw = r[i];
        if (def.type === 'checkbox') rec[key] = isChecked(raw);
        else if (def.type === 'date') rec[key] = excelDateToISO(raw);
        else if (def.type === 'number') {
          const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
          rec[key] = isNaN(n) ? 0 : n;
        } else {
          const s = String(raw ?? '').trim();
          rec[key] = s === '' ? null : s;
        }
      });
      return rec;
    });
  }

  const requiredKey = fieldDefs.find((f) => f.required)?.key;
  const mappingHasRequired = requiredKey ? mapping.includes(requiredKey) : true;

  async function handleImport() {
    setStep('importing');
    setError('');
    const allRecords = buildRecords(rows, headers, mapping, fieldDefs)
      .filter((r) => !requiredKey || (r[requiredKey] && String(r[requiredKey]).trim()));

    const skipped = rows.length - allRecords.length;
    const CHUNK = 300;
    let imported = 0;
    let failed = 0;
    let firstErrorMsg = '';
    setProgress({ done: 0, total: allRecords.length });

    for (let i = 0; i < allRecords.length; i += CHUNK) {
      const chunk = allRecords.slice(i, i + CHUNK).map((r) => ({
        ...r,
        estate_id: estateId,
        created_by: profile.id,
      }));
      const { error: insertError } = await supabase.from(tableName).insert(chunk);
      if (insertError) {
        failed += chunk.length;
        if (!firstErrorMsg) firstErrorMsg = insertError.message;
      } else {
        imported += chunk.length;
      }
      setProgress({ done: Math.min(i + CHUNK, allRecords.length), total: allRecords.length });
    }

    setResult({ imported, failed, skipped, firstErrorMsg });
    setStep('done');
  }

  return (
    <div className="modal-overlay" onClick={step === 'importing' ? undefined : onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>

        {step === 'estate' && (
          <div>
            <p className="muted">
              This file will be imported into ONE estate. If you have subscribers across several
              estates, split them into separate files (one per estate) and import each one.
            </p>
            <div className="field">
              <label>Select Estate</label>
              <select value={estateId} onChange={(e) => setEstateId(e.target.value)}>
                <option value="">Select estate…</option>
                {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              {estates.length === 0 && (
                <p className="error-text" style={{ marginTop: 6 }}>
                  No estates found. Go to the Estates tab and create one first, then come back here.
                </p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" disabled={!estateId} onClick={() => setStep('upload')}>Next</button>
            </div>
          </div>
        )}

        {step === 'upload' && (
          <div>
            <p className="muted">Upload an Excel (.xlsx, .xls) or CSV file. The first row should be column headers.</p>
            <div className="field">
              <label>File</label>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStep('estate')}>Back</button>
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div>
            <p className="muted">
              <b>{fileName}</b> — {rows.length} data row{rows.length === 1 ? '' : 's'} found. Match each
              column from your file to a field below (or leave as "Ignore this column").
            </p>
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table>
                <thead><tr><th>Column in your file</th><th>Maps to</th></tr></thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i}>
                      <td>{h || <span className="muted">(blank)</span>}</td>
                      <td>
                        <select value={mapping[i] || IGNORE} onChange={(e) => updateMapping(i, e.target.value)}>
                          <option value={IGNORE}>Ignore this column</option>
                          {fieldDefs.map((f) => (
                            <option key={f.key} value={f.key}>{f.label}{f.required ? ' (required)' : ''}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingHasRequired && (
              <div className="error-text">
                Please map a column to "{fieldDefs.find((f) => f.required)?.label}" — it's required for every row.
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStep('upload')}>Back</button>
              <button type="button" className="btn btn-primary" disabled={!mappingHasRequired} onClick={() => setStep('preview')}>
                Preview Import
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div>
            <p className="muted">Preview of the first {mappedPreview.length} rows, as they will be saved. Total rows to import: <b>{rows.length}</b>.</p>
            <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>{fieldDefs.filter((f) => mapping.includes(f.key)).map((f) => <th key={f.key}>{f.label}</th>)}</tr>
                </thead>
                <tbody>
                  {mappedPreview.map((r, i) => (
                    <tr key={i}>
                      {fieldDefs.filter((f) => mapping.includes(f.key)).map((f) => (
                        <td key={f.key}>{f.type === 'checkbox' ? (r[f.key] ? '✓' : '') : (r[f.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Rows missing the required "{fieldDefs.find((f) => f.required)?.label}" field will be skipped automatically.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStep('mapping')}>Back</button>
              <button type="button" className="btn btn-primary" onClick={handleImport}>Import {rows.length} Rows</button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div>
            <p>Importing… {progress.done} / {progress.total} rows processed. Please don't close this window.</p>
          </div>
        )}

        {step === 'done' && result && (
          <div>
            <h4 style={{ color: '#1e9e5a' }}>Import complete</h4>
            <p><b>{result.imported}</b> row(s) imported successfully.</p>
            {result.skipped > 0 && <p><b>{result.skipped}</b> row(s) skipped (missing required field).</p>}
            {result.failed > 0 && (
              <p className="error-text"><b>{result.failed}</b> row(s) failed to save. First error: {result.firstErrorMsg}</p>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-primary" onClick={() => { onImported?.(); onClose(); }}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
