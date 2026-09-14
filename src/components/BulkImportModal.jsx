import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';

const IGNORE = '__ignore__';

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Whole-word test so short tokens like "paid" or "name" do not steal longer headers.
function hasWholeWord(haystack, needle) {
  if (!needle) return false;
  const re = new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  return re.test(haystack);
}

function guessMapping(headers, fieldDefs) {
  return headers.map((h) => {
    const norm = normalize(h);
    // Always ignore pure serial / index columns and pure percentage columns
    if (!norm || norm === 'serial' || norm === 's n' || norm === 'sn') return IGNORE;
    if (norm === 'paid' || norm === '% paid' || norm === 'percent paid' ||
        norm === 'percentage paid' || norm === '%paid' || norm.endsWith(' % paid') ||
        norm === 'balance due' || norm === 'balance' || norm === 'file no' || norm === 'file number') {
      return IGNORE;
    }

    // 1. Exact synonym match (highest priority)
    for (const f of fieldDefs) {
      if (f.synonyms.some((syn) => normalize(syn) === norm)) return f.key;
    }

    // 2. Prefer the longest synonym that is a whole-word substring of the header
    //    (or vice-versa). This prevents "amount paid" matching "% Paid"
    //    just because both contain the token "paid".
    let bestKey = null;
    let bestLen = 0;
    for (const f of fieldDefs) {
      for (const syn of f.synonyms) {
        const ns = normalize(syn);
        if (!ns) continue;
        const match =
          (hasWholeWord(norm, ns) || hasWholeWord(ns, norm)) &&
          ns.length >= 3; // ignore ultra-short tokens
        if (match && ns.length > bestLen) {
          bestLen = ns.length;
          bestKey = f.key;
        }
      }
    }
    if (bestKey) return bestKey;

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

// A row that's really a section-divider / repeated-header / estate-name banner
// (common in hand-maintained registers) rather than an actual subscriber row.
function looksLikeJunkRow(record, requiredKey, knownEstateNames) {
  const requiredVal = String(record[requiredKey] ?? '').trim();
  if (!requiredVal) return true;
  const lowerEstateNames = knownEstateNames.map((n) => n.toLowerCase());
  return Object.values(record).some((v) => {
    const s = String(v ?? '').trim().toLowerCase();
    return s && lowerEstateNames.includes(s);
  });
}

export default function BulkImportModal({ title, tableName, fieldDefs, estates = [], presetEstateId, onClose, onImported, profile, transformRecord }) {
  const [step, setStep] = useState(presetEstateId ? 'upload' : 'estate');
  const [estateId, setEstateId] = useState(presetEstateId || '');
  const [defaultPropertyType, setDefaultPropertyType] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [rowsRaw, setRowsRaw] = useState([]);      // for numbers/dates/checkboxes
  const [rowsDisplay, setRowsDisplay] = useState([]); // formatted text, for text fields (avoids "100%" -> 1 bugs)
  const [mapping, setMapping] = useState([]);
  const [included, setIncluded] = useState([]); // boolean per row, whether to import it
  const [error, setError] = useState('');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);

  const hasPropertyTypeField = fieldDefs.some((f) => f.key === 'property_type');

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
        const gridRaw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        const gridDisplay = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

        const keepIdx = gridRaw
          .map((r, i) => (r.some((c) => String(c ?? '').trim() !== '') ? i : -1))
          .filter((i) => i !== -1);
        if (keepIdx.length < 2) {
          setError('Could not find a header row and data rows in this file.');
          return;
        }
        const [hdrIdx, ...dataIdx] = keepIdx;
        const hdrRow = gridRaw[hdrIdx].map((h) => String(h ?? '').trim());
        const dataRaw = dataIdx.map((i) => gridRaw[i]);
        const dataDisplay = dataIdx.map((i) => gridDisplay[i]);

        setHeaders(hdrRow);
        setRowsRaw(dataRaw);
        setRowsDisplay(dataDisplay);
        const guessed = guessMapping(hdrRow, fieldDefs);
        setMapping(guessed);
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

  function buildRecords(rawRows, displayRows, hdrs, map, defs) {
    return rawRows.map((rawRow, ri) => {
      const dispRow = displayRows[ri];
      const rec = {};
      hdrs.forEach((h, i) => {
        const key = map[i];
        if (!key || key === IGNORE) return;
        const def = defs.find((f) => f.key === key);
        const raw = rawRow[i];
        const disp = dispRow[i];
        if (def.type === 'checkbox') rec[key] = isChecked(raw);
        else if (def.type === 'date') rec[key] = excelDateToISO(raw);
        else if (def.type === 'number') {
          const n = parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
          rec[key] = isNaN(n) ? 0 : n;
        } else {
          // text: use the FORMATTED display value, so a percentage-formatted
          // cell reads as "100%" instead of the underlying number 1
          const s = String(disp ?? '').trim();
          rec[key] = s === '' ? null : s;
        }
      });
      if (hasPropertyTypeField && defaultPropertyType.trim() && !rec.property_type) {
        rec.property_type = defaultPropertyType.trim();
      }
      return transformRecord ? transformRecord(rec) : rec;
    });
  }

  const requiredKey = fieldDefs.find((f) => f.required)?.key;
  const mappingHasRequired = requiredKey ? mapping.includes(requiredKey) : true;
  const knownEstateNames = estates.map((e) => e.name);

  const allRecords = useMemo(
    () => buildRecords(rowsRaw, rowsDisplay, headers, mapping, fieldDefs),
    [rowsRaw, rowsDisplay, headers, mapping, fieldDefs, defaultPropertyType, transformRecord]
  );

  function goToPreview() {
    setIncluded(allRecords.map((r) => !looksLikeJunkRow(r, requiredKey, knownEstateNames)));
    setStep('preview');
  }

  function toggleRow(i) {
    const next = [...included];
    next[i] = !next[i];
    setIncluded(next);
  }
  function toggleAll(value) {
    setIncluded(included.map(() => value));
  }

  const flaggedCount = allRecords.filter((r) => looksLikeJunkRow(r, requiredKey, knownEstateNames)).length;
  const visibleFields = fieldDefs.filter((f) => mapping.includes(f.key));
  const importableCount = allRecords.filter((r, i) => included[i] && String(r[requiredKey] ?? '').trim()).length;

  async function handleImport() {
    setStep('importing');
    setError('');
    const toImport = allRecords.filter((r, i) => included[i] && String(r[requiredKey] ?? '').trim());
    const skipped = allRecords.length - toImport.length;
    const CHUNK = 300;
    let imported = 0;
    let failed = 0;
    let firstErrorMsg = '';
    setProgress({ done: 0, total: toImport.length });

    for (let i = 0; i < toImport.length; i += CHUNK) {
      const chunk = toImport.slice(i, i + CHUNK).map((r) => ({
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
      setProgress({ done: Math.min(i + CHUNK, toImport.length), total: toImport.length });
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
            {hasPropertyTypeField && (
              <div className="field">
                <label>Default Property Type (optional)</label>
                <input
                  value={defaultPropertyType}
                  onChange={(e) => setDefaultPropertyType(e.target.value)}
                  placeholder="e.g. 2BR — used for every row if the file has no Property Type column"
                />
              </div>
            )}
            {error && <div className="error-text">{error}</div>}
            <div className="modal-actions">
              {!presetEstateId && <button type="button" className="btn btn-outline" onClick={() => setStep('estate')}>Back</button>}
            </div>
          </div>
        )}

        {step === 'mapping' && (
          <div>
            <p className="muted">
              <b>{fileName}</b> — {rowsRaw.length} data row{rowsRaw.length === 1 ? '' : 's'} found. Match each
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
              <button type="button" className="btn btn-primary" disabled={!mappingHasRequired} onClick={goToPreview}>
                Preview Import
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div>
            <p className="muted">
              Review every row below before importing. Untick any row that shouldn't be
              imported — for example a section-divider or repeated header row from your sheet.
              {flaggedCount > 0 && (
                <> <b>{flaggedCount} row{flaggedCount === 1 ? '' : 's'}</b> looked like they might not be real
                subscriber rows, so they've been unticked for you — please double-check them.</>
              )}
            </p>
            <div className="flex" style={{ marginBottom: 8 }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleAll(true)}>Select All</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => toggleAll(false)}>Deselect All</button>
              <span className="muted" style={{ alignSelf: 'center' }}>
                {included.filter(Boolean).length} of {allRecords.length} rows selected
              </span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th></th>
                    {visibleFields.map((f) => <th key={f.key}>{f.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {allRecords.map((r, i) => (
                    <tr key={i} style={included[i] ? {} : { opacity: 0.4 }}>
                      <td><input type="checkbox" checked={!!included[i]} onChange={() => toggleRow(i)} /></td>
                      {visibleFields.map((f) => (
                        <td key={f.key}>{f.type === 'checkbox' ? (r[f.key] ? '✓' : '') : (r[f.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              Rows missing the required "{fieldDefs.find((f) => f.required)?.label}" field are skipped
              automatically even if left ticked.
            </p>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setStep('mapping')}>Back</button>
              <button type="button" className="btn btn-primary" onClick={handleImport}>
                Import {importableCount} Rows
              </button>
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
            {result.skipped > 0 && <p><b>{result.skipped}</b> row(s) not imported (unticked or missing required field).</p>}
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
