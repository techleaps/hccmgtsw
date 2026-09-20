import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '../lib/supabaseClient';

/**
 * Import the wide finance sheet:
 * Names | Total Amount Paid | Payment 1 | Pmt Date | Payment 2 | Pmt Date | …
 * Expands each subscriber into one payment row per installment with a date.
 */
function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').replace(/₦/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === 'number' && v > 20000) {
    // Excel serial date
    const d = XLSX.SSF.parse_date_code(v);
    if (d) {
      const mm = String(d.m).padStart(2, '0');
      const dd = String(d.d).padStart(2, '0');
      return `${d.y}-${mm}-${dd}`;
    }
  }
  const s = String(v).trim();
  // 14-Oct-24 / 14-Oct-2024
  const m = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[-\/ ](\d{2,4})$/);
  if (m) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const mon = months[m[2].toLowerCase()];
    if (mon) {
      let y = Number(m[3]);
      if (y < 100) y += 2000;
      return `${y}-${String(mon).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    }
  }
  // ISO or yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function findCol(headers, predicates) {
  for (let i = 0; i < headers.length; i += 1) {
    const h = normalize(headers[i]);
    if (predicates.some((fn) => fn(h))) return i;
  }
  return -1;
}

export default function InstallmentPaymentImport({ estateId, profile, onClose, onImported }) {
  const [rows, setRows] = useState([]); // expanded payment rows ready to insert
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState([]);
  const [propertyTypes, setPropertyTypes] = useState([]);
  const [defaultPropertyType, setDefaultPropertyType] = useState('');

  useEffect(() => {
    if (!estateId) return;
    supabase
      .from('estate_property_types')
      .select('property_type')
      .eq('estate_id', estateId)
      .then(({ data }) => {
        const types = (data || []).map((r) => r.property_type).filter(Boolean);
        setPropertyTypes(types);
        if (types.length === 1) setDefaultPropertyType(types[0]);
      });
  }, [estateId]);

  function handleFile(e) {
    setError('');
    setInfo('');
    setRows([]);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array', cellDates: true });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
        if (!grid.length) { setError('Empty sheet.'); return; }

        // Find header row (contains Names and Payment)
        let headerIdx = 0;
        for (let i = 0; i < Math.min(grid.length, 15); i += 1) {
          const joined = (grid[i] || []).map(normalize).join(' | ');
          if (joined.includes('name') && (joined.includes('payment') || joined.includes('total amount'))) {
            headerIdx = i;
            break;
          }
        }
        const headers = (grid[headerIdx] || []).map((h) => String(h || ''));
        const nameCol = findCol(headers, [
          (h) => h === 'names' || h === 'name' || h === 'subscriber name' || h.includes('subscriber'),
          (h) => h === 'names',
        ]);
        if (nameCol < 0) {
          setError('Could not find a Names column.');
          return;
        }

        const receiptCol = findCol(headers, [(h) => h.includes('receipt')]);
        const fileCol = findCol(headers, [(h) => h.includes('file no') || h === 'file']);
        const propTypeCol = findCol(headers, [
          (h) => h === 'property type' || h === 'type' || h === 'house type' || h.includes('property type'),
        ]);

        // Pair Payment N with nearest Pmt Date column (prefer date column immediately before payment amount)
        const installmentPairs = [];
        for (let i = 0; i < headers.length; i += 1) {
          const h = normalize(headers[i]);
          const payMatch = h.match(/^payment\s*(\d+)$/) || h.match(/^pmt\s*(\d+)$/);
          if (!payMatch) continue;
          const n = Number(payMatch[1]);
          // Look for date column: previous col often "Pmt Date", or "Pmt Date" after previous payment
          let dateCol = -1;
          if (i > 0 && normalize(headers[i - 1]).includes('date')) dateCol = i - 1;
          else if (i + 1 < headers.length && normalize(headers[i + 1]).includes('date')) dateCol = i + 1;
          installmentPairs.push({ n, amountCol: i, dateCol });
        }
        installmentPairs.sort((a, b) => a.n - b.n);

        if (installmentPairs.length === 0) {
          setError('No Payment 1 / Payment 2 … columns found. Use the standard Bulk Import for single-amount rows.');
          return;
        }

        const expanded = [];
        for (let r = headerIdx + 1; r < grid.length; r += 1) {
          const row = grid[r] || [];
          const name = String(row[nameCol] ?? '').trim();
          if (!name) continue;
          const receipt = receiptCol >= 0 ? String(row[receiptCol] ?? '').trim() : '';
          const fileNo = fileCol >= 0 ? String(row[fileCol] ?? '').trim() : '';

          installmentPairs.forEach(({ n, amountCol, dateCol }) => {
            const amt = parseAmount(row[amountCol]);
            if (amt === null || amt === 0) return;
            const dateRaw = dateCol >= 0 ? row[dateCol] : null;
            const datePaid = parseDate(dateRaw);
            const rowPropType = propTypeCol >= 0 ? String(row[propTypeCol] ?? '').trim() : '';
            expanded.push({
              subscriber_name: name,
              amount: amt,
              date_paid: datePaid,
              payment_type: 'property',
              property_type: rowPropType || null, // filled with default on import if empty
              payment_reference: receipt || null,
              remarks: [
                fileNo ? `File No: ${fileNo}` : null,
                `Installment ${n}`,
              ].filter(Boolean).join(' · '),
              _installment: n,
            });
          });
        }

        if (!expanded.length) {
          setError('No installment amounts found in the sheet.');
          return;
        }
        setRows(expanded);
        setSelected(expanded.map(() => true));
        setInfo(`${expanded.length} installment payment(s) from ${new Set(expanded.map((x) => x.subscriber_name)).size} subscriber(s). Review then import.`);
      } catch (err) {
        console.error(err);
        setError(err.message || 'Failed to read file');
      }
    };
    reader.readAsArrayBuffer(file);
  }

  const totalSelected = useMemo(() => {
    return rows.reduce((s, r, i) => s + (selected[i] ? Number(r.amount || 0) : 0), 0);
  }, [rows, selected]);

  async function handleImport() {
    if (!defaultPropertyType && !rows.some((r) => r.property_type)) {
      setError('Select a property type for this import (or include a Property Type column in the sheet).');
      return;
    }
    const payload = rows
      .filter((_, i) => selected[i])
      .map((r) => ({
        estate_id: estateId,
        subscriber_name: r.subscriber_name,
        amount: r.amount,
        date_paid: r.date_paid,
        payment_type: 'property',
        property_type: r.property_type || defaultPropertyType || null,
        payment_reference: r.payment_reference,
        remarks: r.remarks,
        created_by: profile.id,
      }));
    if (!payload.length) { setError('Nothing selected.'); return; }
    setSaving(true);
    // Insert in chunks of 200
    for (let i = 0; i < payload.length; i += 200) {
      const chunk = payload.slice(i, i + 200);
      const { error: err } = await supabase.from('payments').insert(chunk);
      if (err) {
        setSaving(false);
        setError(err.message);
        return;
      }
    }
    setSaving(false);
    alert(`Imported ${payload.length} installment payment(s).`);
    onImported?.();
    onClose?.();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 960, width: '95vw' }} onClick={(e) => e.stopPropagation()}>
        <h3>Import installment payments (wide Excel)</h3>
        <p className="muted">
          Use the finance sheet with columns like <b>Payment 1</b>, <b>Pmt Date</b>, <b>Payment 2</b>, <b>Pmt Date</b>…
          Each non-empty installment becomes its own payment line on the subscriber profile.
        </p>
        <div className="field">
          <label>Property type for this import *</label>
          <select
            value={defaultPropertyType}
            onChange={(e) => setDefaultPropertyType(e.target.value)}
            required
          >
            <option value="">— Select property type —</option>
            {propertyTypes.map((pt) => (
              <option key={pt} value={pt}>{pt}</option>
            ))}
          </select>
          <p className="muted" style={{ marginTop: 6 }}>
            Required so Analysis can calculate % paid. If the sheet has a Property Type column, row values override this default.
            Create types under the estate if the list is empty.
          </p>
        </div>
        <div className="field">
          <label>Excel / CSV file</label>
          <input type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} />
        </div>
        {info && <p className="muted">{info} · Selected total ₦{totalSelected.toLocaleString()}</p>}
        {error && <div className="error-text">{error}</div>}

        {rows.length > 0 && (
          <div className="table-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th></th>
                  <th>Subscriber</th>
                  <th>Installment</th>
                  <th className="right">Amount</th>
                  <th>Date</th>
                  <th>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.subscriber_name}-${r._installment}-${i}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selected[i]}
                        onChange={() => {
                          const next = [...selected];
                          next[i] = !next[i];
                          setSelected(next);
                        }}
                      />
                    </td>
                    <td>{r.subscriber_name}</td>
                    <td>#{r._installment}</td>
                    <td className="right">{Number(r.amount).toLocaleString()}</td>
                    <td>{r.date_paid || '—'}</td>
                    <td>{r.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-outline" onClick={onClose}>Cancel</button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={saving || !rows.some((_, i) => selected[i])}
            onClick={handleImport}
          >
            {saving ? 'Importing…' : 'Import selected installments'}
          </button>
        </div>
      </div>
    </div>
  );
}
