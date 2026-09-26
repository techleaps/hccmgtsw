import React, { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { submitOrApplyUpdate, submitOrApplyDelete } from '../lib/recordActions';
import { fetchCustomFields } from '../lib/customFields';
import { blankToNull } from '../lib/sanitize';
import DocumentAttachments from './DocumentAttachments';
import ManageColumnsModal from './ManageColumnsModal';
import BulkImportModal from './BulkImportModal';
import { CustomFieldInputs, CustomFieldHeaders, CustomFieldCells } from './CustomFieldWidgets';
import {
  classifyExpenseGroup,
  groupExpensesByType,
  knownExpenseGroups,
} from '../lib/expenseGrouping';

const CATEGORIES = [
  { key: 'RCA', label: 'RCA (guards / estate security)' },
  { key: 'DTA', label: 'DTA / LT&T / Flight / Contingency (travel)' },
  { key: 'Site Allowance', label: 'Site Allowance (staff stipend — seconded staff)' },
  { key: 'Salary', label: 'Salary (permanent staff only)' },
  { key: 'Award of Contract', label: 'Award of Contract (approved contract payments)' },
  { key: 'Others', label: 'Others (fuel, PMS, AGO, recharge, etc.)' },
];

const BLANK = {
  title: '',
  purpose: '',
  category: 'RCA',
  estate_id: '',
  month_label: '',
  site: '',
  request_ref: '',
  application_by: '',
  paid_to: '',
  amount_applied: '',
  amount_approved: '',
  date_applied: '',
  date_of_approval: '',
  comments: '',
  remarks: '',
  expense_group: '',
};

/** Shared + category-specific Excel column synonyms */
export function expenseFieldDefs(category) {
  const common = [
    {
      key: 'title',
      label: 'Description',
      type: 'text',
      required: true,
      synonyms: [
        'description', 'title', 'particulars', 'item', 'details',
        'work description', 'contract description',
      ],
    },
    {
      key: 'purpose',
      label: 'Contractor',
      type: 'text',
      synonyms: [
        'contractor', 'contractor name', 'beneficiary', 'applicant',
        'applicant/beneficiary', 'payee', 'name of contractor',
      ],
    },
    {
      key: 'portfolio',
      label: 'Portfolio / House units',
      type: 'text',
      synonyms: [
        'portfolio', 'portforlio', 'house numbers', 'house no', 'units',
        'plots', 'property',
      ],
    },
    {
      key: 'payment_note',
      label: 'Payment made (text / milestone note)',
      type: 'text',
      synonyms: [
        'payment made', 'milestone', 'milestones', 'payment note',
        'reason', 'payment status',
      ],
    },
    {
      key: 'expense_group',
      label: 'Category / Expense type (from Excel)',
      type: 'text',
      synonyms: [
        'category', 'expense category', 'expense type', 'expense group',
        'type of expense', 'classification', 'group', 'sub category', 'subcategory',
        'heading', 'class',
      ],
    },
    {
      key: 'category',
      label: 'Main category (RCA / DTA / Salary / Site Allowance / Others)',
      type: 'text',
      synonyms: [
        'main category', 'primary category', 'budget category',
      ],
    },
    {
      key: 'amount_applied',
      label: 'Amount / Amount Applied',
      type: 'number',
      synonyms: [
        'amount', 'amount applied', 'amount requested', 'sum', 'amount applied for',
      ],
    },
    {
      key: 'amount_approved',
      label: 'Amount Approved',
      type: 'number',
      required: true,
      synonyms: [
        'amount approved', 'amountapproved', 'approved amount', 'approved',
      ],
    },
    {
      key: 'date_of_approval',
      label: 'Date of Approval',
      type: 'date',
      synonyms: [
        'date of approval', 'date approved', 'approval date', 'date of approved',
      ],
    },
    {
      key: 'date_applied',
      label: 'Date Applied',
      type: 'date',
      synonyms: ['date applied', 'application date', 'date', 'period date'],
    },
    {
      key: 'month_label',
      label: 'Month',
      type: 'text',
      synonyms: ['month', 'period', 'for month'],
    },
    {
      key: 'site',
      label: 'Site',
      type: 'text',
      synonyms: ['site', 'location', 'station', 'place'],
    },
    {
      key: 'request_ref',
      label: 'Request vide / Reference',
      type: 'text',
      synonyms: [
        'request vide', 'request vide/dated', 'request vide dated', 'request',
        'reference', 'ref', 'letter ref', 'vide',
      ],
    },
    {
      key: 'comments',
      label: 'Comment',
      type: 'text',
      synonyms: ['comment', 'comments'],
    },
    {
      key: 'remarks',
      label: 'Remarks',
      type: 'text',
      synonyms: ['remarks', 'remark', 'notes', 'note'],
    },
  ];
  return common;
}

/** Match Excel Site / location text to an estate id when possible */
function matchEstateFromSite(siteText, estates) {
  const raw = String(siteText || '').trim();
  if (!raw || !estates?.length) return null;
  const s = raw.toLowerCase().replace(/\s+/g, ' ');
  // Direct / contains match on estate name
  for (const e of estates) {
    const n = String(e.name || '').toLowerCase();
    if (!n) continue;
    if (n === s || n.includes(s) || s.includes(n)) return e.id;
  }
  // Common short place names → keywords in estate names
  const tokens = s.split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const aliases = {
    ph: ['port', 'pharcourt', 'portharcourt', 'treasure'],
    portharcourt: ['port', 'treasure'],
    'port harcourt': ['port', 'treasure'],
    enugu: ['enugu', 'valley', 'transekulu'],
    abuja: ['abuja', 'iad', 'id u', 'idu', 'kuje', 'bwari', 'asokoro', 'guzape', 'falcon'],
    idu: ['idu', 'ville'],
    kuje: ['kuje', 'unity'],
    bwari: ['bwari', 'bungalow', 'eagle'],
    awka: ['awka', 'anambra', 'green'],
    anambra: ['anambra', 'awka', 'green'],
    asokoro: ['asokoro', 'sunny'],
    guzape: ['guzape', 'dubai'],
    falcon: ['falcon'],
    iad: ['iad', 'aviation'],
  };
  for (const [key, words] of Object.entries(aliases)) {
    if (s === key || s.includes(key) || tokens.includes(key)) {
      for (const e of estates) {
        const n = String(e.name || '').toLowerCase();
        if (words.some((w) => n.includes(w))) return e.id;
      }
    }
  }
  // Single-token overlap with estate name
  for (const e of estates) {
    const n = String(e.name || '').toLowerCase();
    if (tokens.some((t) => t.length >= 3 && n.includes(t))) return e.id;
  }
  return null;
}

function normalizeMainCategory(raw, fallback) {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return fallback;
  if (s.includes('site all') || s === 'stipend' || s.includes('staff all')) return 'Site Allowance';
  if (s === 'rca' || s.includes('guard') || s.includes('security')) return 'RCA';
  if (s === 'dta' || s.includes('flight') || s.includes('travel') || s.includes('lt&t')) return 'DTA';
  if (s.includes('salary') || s.includes('payroll') || s.includes('unestablished')) return 'Salary';
  if (s.includes('award') || s.includes('contract') || s.includes('milestone') || s.includes('variation') || s.includes('roofing') || s.includes('infrastructure')) return 'Award of Contract';
  if (s.includes('other')) return 'Others';
  // If Excel "category" is a sub-type (recharge, pms), keep main as fallback (usually Others)
  return fallback;
}

function transformExpenseRecord(r, category, estates, forcedEstateId) {
  const amountApproved = Number(r.amount_approved) || 0;
  const amountApplied = Number(r.amount_applied) || amountApproved;
  const title = String(r.title || '').trim() || 'Untitled';
  // File-level category (dialog) is default; Excel main category column can override when it matches
  const cat = normalizeMainCategory(r.category, category || 'Others');
  // Excel "Category" column is primarily the sub-type (recharge, PMS, etc.) → expense_group
  const fromExcelGroup = String(r.expense_group || '').trim()
    || (r.category && !['rca', 'dta', 'salary', 'others', 'site allowance'].includes(String(r.category).trim().toLowerCase())
      ? String(r.category).trim()
      : '');
  const expense_group = classifyExpenseGroup(title, cat, fromExcelGroup || null);
  const site = (r.site || '').trim() || null;
  // Forced estate only if user chose one; else try Site column; else leave null (company-wide)
  let estate_id = forcedEstateId || r.estate_id || null;
  if (!estate_id && site) {
    estate_id = matchEstateFromSite(site, estates);
  }
  const contractor = String(r.purpose || '').trim() || null;
  const portfolio = String(r.portfolio || '').trim() || null;
  const paymentNote = String(r.payment_note || '').trim() || null;
  const extraBits = [];
  if (portfolio) extraBits.push(`Portfolio: ${portfolio}`);
  if (paymentNote) extraBits.push(paymentNote);
  const remarks = [r.remarks, ...extraBits].filter(Boolean).join(' · ') || null;

  // Drop non-DB keys (portfolio, payment_note) — folded into purpose/remarks
  return {
    title,
    purpose: contractor, // Contractor name
    category: cat,
    expense_group,
    month_label: (r.month_label || '').trim() || null,
    site: site || portfolio || null, // portfolio as site if no site
    request_ref: (r.request_ref || '').trim() || null,
    amount_applied: amountApplied,
    amount_approved: amountApproved,
    date_applied: r.date_applied || null,
    date_of_approval: r.date_of_approval || null,
    comments: r.comments || null,
    remarks,
    estate_id: estate_id || null,
  };
}

export default function ApprovalsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [rows, setRows] = useState([]);
  const [estates, setEstates] = useState([]);
  const [customFields, setCustomFields] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [estateFilter, setEstateFilter] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [siteFilter, setSiteFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importCategory, setImportCategory] = useState('RCA');
  const [importEstateId, setImportEstateId] = useState('');
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [customData, setCustomData] = useState({});
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data: estatesData } = await supabase.from('estates').select('*').eq('is_deleted', false).order('name');
    setEstates(estatesData || []);
    setCustomFields(await fetchCustomFields('approvals_expenditures'));
    const { data } = await supabase
      .from('approvals_expenditures')
      .select('*, estates(name)')
      .eq('is_deleted', false)
      .order('date_of_approval', { ascending: false });
    setRows(data || []);
    setSelected(new Set());
    setLoading(false);
  }

  const months = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.month_label) set.add(r.month_label); });
    return [...set].sort();
  }, [rows]);

  const sites = useMemo(() => {
    const set = new Set();
    rows.forEach((r) => { if (r.site) set.add(r.site); });
    return [...set].sort();
  }, [rows]);

  const rowsWithGroup = useMemo(() => rows.map((r) => ({
    ...r,
    _group: r.expense_group || classifyExpenseGroup(r.title, r.category, null),
  })), [rows]);

  const filtered = useMemo(() => rowsWithGroup.filter((r) => {
    if (categoryFilter && (r.category || '') !== categoryFilter) return false;
    if (estateFilter && r.estate_id !== estateFilter) return false;
    if (monthFilter && (r.month_label || '') !== monthFilter) return false;
    if (siteFilter && (r.site || '') !== siteFilter) return false;
    if (groupFilter && (r._group || '') !== groupFilter) return false;
    const hay = `${r.title || ''} ${r.purpose || ''} ${r.request_ref || ''} ${r.site || ''} ${r.remarks || ''} ${r._group || ''}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  }), [rowsWithGroup, categoryFilter, estateFilter, monthFilter, siteFilter, groupFilter, search]);

  const byExpenseGroup = useMemo(() => groupExpensesByType(filtered), [filtered]);

  /** Same description + same approved amount more than once (possible re-upload) */
  const expenseDupes = useMemo(() => {
    const map = new Map();
    rows.forEach((r) => {
      const title = String(r.title || '').trim().toLowerCase();
      if (!title) return;
      const amt = Number(r.amount_approved || 0);
      if (!(amt > 0)) return;
      const key = `${title}|${amt.toFixed(2)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    return [...map.entries()]
      .map(([, list]) => ({
        title: list[0].title,
        amount: Number(list[0].amount_approved || 0),
        list,
        categories: [...new Set(list.map((x) => x.category || '—'))],
        months: [...new Set(list.map((x) => x.month_label || '—').filter(Boolean))],
      }))
      .filter((g) => g.list.length > 1)
      .sort((a, b) => b.list.length - a.list.length || b.amount - a.amount);
  }, [rows]);

  const allGroups = useMemo(() => {
    const set = new Set(knownExpenseGroups());
    rowsWithGroup.forEach((r) => { if (r._group) set.add(r._group); });
    return [...set].sort();
  }, [rowsWithGroup]);

  const totals = useMemo(() => {
    let applied = 0;
    let approved = 0;
    filtered.forEach((r) => {
      applied += Number(r.amount_applied || 0);
      approved += Number(r.amount_approved || 0);
    });
    return { count: filtered.length, applied, approved };
  }, [filtered]);

  const byCategory = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.category || 'Uncategorized';
      if (!map.has(k)) map.set(k, { name: k, count: 0, approved: 0 });
      const rec = map.get(k);
      rec.count += 1;
      rec.approved += Number(r.amount_approved || 0);
    });
    return [...map.values()].sort((a, b) => b.approved - a.approved);
  }, [filtered]);

  const byMonth = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.month_label || 'No month';
      if (!map.has(k)) map.set(k, { name: k, count: 0, approved: 0 });
      const rec = map.get(k);
      rec.count += 1;
      rec.approved += Number(r.amount_approved || 0);
    });
    return [...map.values()];
  }, [filtered]);

  const bySite = useMemo(() => {
    const map = new Map();
    filtered.forEach((r) => {
      const k = r.site || 'No site';
      if (!map.has(k)) map.set(k, { name: k, count: 0, approved: 0 });
      const rec = map.get(k);
      rec.count += 1;
      rec.approved += Number(r.amount_approved || 0);
    });
    return [...map.values()].sort((a, b) => b.approved - a.approved);
  }, [filtered]);

  function openNew() {
    setEditingRow(null);
    setForm({ ...BLANK, category: categoryFilter || 'RCA' });
    setCustomData({});
    setError('');
    setShowModal(true);
  }

  function openEdit(row) {
    setEditingRow(row);
    setForm({
      title: row.title || '',
      purpose: row.purpose || '',
      category: row.category || 'Others',
      estate_id: row.estate_id || '',
      month_label: row.month_label || '',
      site: row.site || '',
      request_ref: row.request_ref || '',
      application_by: row.application_by || '',
      paid_to: row.paid_to || '',
      amount_applied: row.amount_applied ?? '',
      amount_approved: row.amount_approved ?? '',
      date_applied: row.date_applied ? String(row.date_applied).slice(0, 10) : '',
      date_of_approval: row.date_of_approval ? String(row.date_of_approval).slice(0, 10) : '',
      comments: row.comments || '',
      remarks: row.remarks || '',
      expense_group: row.expense_group || classifyExpenseGroup(row.title, row.category, null),
    });
    setCustomData(row.custom_data || {});
    setError('');
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    if (!form.title.trim()) { setError('Description is required.'); return; }
    setSaving(true);
    const autoGroup = form.expense_group?.trim()
      || classifyExpenseGroup(form.title, form.category, null);
    const payload = blankToNull({
      ...form,
      expense_group: autoGroup,
      estate_id: form.estate_id || null,
      amount_applied: Number(form.amount_applied) || 0,
      amount_approved: Number(form.amount_approved) || 0,
      custom_data: customData,
    }, ['date_of_approval', 'date_applied']);

    if (editingRow) {
      const { error: err, requiresApproval } = await submitOrApplyUpdate({
        profile, tableName: 'approvals_expenditures', recordId: editingRow.id, changes: payload,
      });
      setSaving(false);
      if (err) { setError(err.message); return; }
      setShowModal(false);
      alert(requiresApproval ? 'Edit submitted for approval.' : 'Updated.');
      load();
      return;
    }
    const { error: err } = await supabase.from('approvals_expenditures').insert({ ...payload, created_by: profile.id });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setShowModal(false);
    load();
  }

  async function handleDelete(row) {
    const reason = prompt('Reason for deleting this record (required):');
    if (!reason) return;
    const { error: err, requiresApproval } = await submitOrApplyDelete({
      profile, tableName: 'approvals_expenditures', recordId: row.id, reason,
    });
    if (err) { alert(err.message); return; }
    alert(requiresApproval ? 'Delete request submitted for approval.' : 'Deleted.');
    load();
  }

  function toggleSelect(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (filtered.length && filtered.every((r) => selected.has(r.id))) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.id)));
  }

  async function handleDeleteAllFiltered() {
    if (!filtered.length) { alert('No rows match the current filters.'); return; }
    if (!confirm(`Soft-delete ALL ${filtered.length} expenditure row(s) currently shown?`)) return;
    const typed = prompt(`Type DELETE ${filtered.length} to confirm:`);
    if (typed !== `DELETE ${filtered.length}`) { alert('Cancelled.'); return; }
    setBulkBusy(true);
    const ids = filtered.map((r) => r.id);
    let done = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error: err } = await supabase
        .from('approvals_expenditures')
        .update({ is_deleted: true })
        .in('id', chunk)
        .select('id');
      if (err) { alert(err.message); break; }
      done += (data || []).length;
    }
    setBulkBusy(false);
    alert(`Deleted ${done} record(s).`);
    load();
  }

  async function handleDeleteSelected() {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`Soft-delete ${ids.length} selected record(s)?`)) return;
    setBulkBusy(true);
    let done = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const { data, error: err } = await supabase
        .from('approvals_expenditures')
        .update({ is_deleted: true })
        .in('id', chunk)
        .select('id');
      if (err) { alert(err.message); break; }
      done += (data || []).length;
    }
    setBulkBusy(false);
    alert(`Deleted ${done} record(s).`);
    load();
  }

  async function handleReclassifyAll() {
    if (!confirm(
      'Re-run smart grouping on all expenditure rows? Descriptions are scanned (recharge, PMS, AGO, etc.) and expense_group is updated. Manual groups are overwritten.'
    )) return;
    setBulkBusy(true);
    let done = 0;
    for (const r of rows) {
      const g = classifyExpenseGroup(r.title, r.category, null);
      if (g === (r.expense_group || '')) continue;
      const { error: err } = await supabase
        .from('approvals_expenditures')
        .update({ expense_group: g })
        .eq('id', r.id);
      if (!err) done += 1;
    }
    setBulkBusy(false);
    alert(`Updated group on ${done} record(s).`);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <div>
          <h2>Approvals / Expenditure</h2>
          <p className="muted" style={{ margin: 0 }}>
            RCA, DTA, Site Allowance, Salary, <b>Award of Contract</b> (approved payments), Others — import by category.
            Contractor register (who was awarded what) is under the main menu <b>Award of Contract</b>; money approvals go here.
          </p>
        </div>
        <div className="flex wrap">
          <button type="button" className="btn btn-outline" onClick={() => setShowColumns(true)}>Manage Columns</button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => {
              setImportCategory(categoryFilter || 'RCA');
              setImportEstateId(estateFilter || '');
              setShowImport(true);
            }}
          >
            Bulk Import Excel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={bulkBusy || selected.size === 0}
            onClick={handleDeleteSelected}
          >
            Delete selected ({selected.size})
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={bulkBusy || filtered.length === 0}
            onClick={handleDeleteAllFiltered}
            title="Deletes every row matching current filters"
          >
            Delete all filtered ({filtered.length})
          </button>
          <button type="button" className="btn btn-outline" onClick={handleReclassifyAll} disabled={bulkBusy || !rows.length}>
            Re-classify groups
          </button>
          <button type="button" className="btn btn-primary" onClick={openNew}>+ New Entry</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat-card">
          <div className="value">{totals.count}</div>
          <div className="label">Entries (filtered)</div>
        </div>
        <div className="stat-card">
          <div className="value">₦{totals.applied.toLocaleString()}</div>
          <div className="label">Total Applied</div>
        </div>
        <div className="stat-card gold">
          <div className="value">₦{totals.approved.toLocaleString()}</div>
          <div className="label">Total Approved</div>
        </div>
      </div>


      {expenseDupes.length > 0 && (
        <div className="card" style={{ borderLeft: '4px solid #dc2626', background: '#fef2f2', marginBottom: 16 }}>
          <h3 style={{ marginTop: 0, color: '#991b1b' }}>Possible duplicate expenditure</h3>
          <p className="muted">
            Same description and same approved amount appear more than once (often from re-importing a file).
            Review and use checkboxes + <b>Delete selected</b> to clean up.
          </p>
          <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="right">Amount (₦)</th>
                  <th>Times</th>
                  <th>Categories</th>
                  <th>Months</th>
                </tr>
              </thead>
              <tbody>
                {expenseDupes.slice(0, 40).map((g, i) => (
                  <tr key={i}>
                    <td>{g.title}</td>
                    <td className="right">{g.amount.toLocaleString()}</td>
                    <td><span className="tag rejected">{g.list.length}×</span></td>
                    <td>{g.categories.join(', ')}</td>
                    <td>{g.months.join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginTop: 0 }}>Spend by type (smart groups)</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Recurring items (recharge cards, PMS, AGO, etc.) are grouped from the description so you can filter
          e.g. “how much on recharge over several months”. Use <b>Re-classify groups</b> after import if needed.
        </p>
        <div className="table-wrap" style={{ maxHeight: 280, overflow: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Expense type</th>
                <th className="right">Entries</th>
                <th className="right">Months</th>
                <th className="right">Approved (₦)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {byExpenseGroup.map((g) => (
                <tr key={g.name}>
                  <td><b>{g.name}</b></td>
                  <td className="right">{g.count}</td>
                  <td className="right">{g.monthCount || g.months?.length || 0}</td>
                  <td className="right">{g.approved.toLocaleString()}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => setGroupFilter(g.name)}
                    >
                      Filter
                    </button>
                  </td>
                </tr>
              ))}
              {byExpenseGroup.length === 0 && (
                <tr><td colSpan={5} className="empty-state">No data in current filters</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="card">
          <h3>By category</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Category</th><th className="right">N</th><th className="right">Approved</th></tr></thead>
              <tbody>
                {byCategory.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="right">{c.count}</td>
                    <td className="right">{c.approved.toLocaleString()}</td>
                  </tr>
                ))}
                {byCategory.length === 0 && <tr><td colSpan={3} className="empty-state">No data</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>By month</h3>
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Month</th><th className="right">N</th><th className="right">Approved</th></tr></thead>
              <tbody>
                {byMonth.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="right">{c.count}</td>
                    <td className="right">{c.approved.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h3>By site</h3>
          <div className="table-wrap" style={{ maxHeight: 220, overflow: 'auto' }}>
            <table>
              <thead><tr><th>Site</th><th className="right">N</th><th className="right">Approved</th></tr></thead>
              <tbody>
                {bySite.map((c) => (
                  <tr key={c.name}>
                    <td>{c.name}</td>
                    <td className="right">{c.count}</td>
                    <td className="right">{c.approved.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="flex wrap">
          <div style={{ minWidth: 160 }}>
            <label>Category</label>
            <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="">All</option>
              {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 160 }}>
            <label>Estate (optional link)</label>
            <select value={estateFilter} onChange={(e) => setEstateFilter(e.target.value)}>
              <option value="">All</option>
              {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label>Month</label>
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All</option>
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 120 }}>
            <label>Site</label>
            <select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)}>
              <option value="">All</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200 }}>
            <label>Expense type (group)</label>
            <select value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}>
              <option value="">All types</option>
              {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div style={{ minWidth: 200, flex: 1 }}>
            <label>Search</label>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Description, ref, site…" />
          </div>
        </div>
      </div>

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={filtered.length > 0 && filtered.every((r) => selected.has(r.id))}
                    onChange={toggleSelectAllFiltered}
                  />
                </th>
                <th>S/N</th>
                <th>Category</th>
                <th>Type / group</th>
                <th>Description</th>
                <th>Month</th>
                <th>Site</th>
                <th>Request / Ref</th>
                <th className="right">Applied</th>
                <th className="right">Approved</th>
                <th>Date approved</th>
                <th>Estate</th>
                <CustomFieldHeaders fields={customFields} />
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => (
                <tr key={r.id}>
                  <td>
                    <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)} />
                  </td>
                  <td>{r.serial_no ?? i + 1}</td>
                  <td><span className="tag PO">{r.category || '—'}</span></td>
                  <td style={{ fontSize: 12 }}>{r._group || '—'}</td>
                  <td>{r.title}</td>
                  <td>{r.month_label || '—'}</td>
                  <td>{r.site || '—'}</td>
                  <td style={{ maxWidth: 180, fontSize: 12 }}>{r.request_ref || r.purpose || '—'}</td>
                  <td className="right">{Number(r.amount_applied || 0).toLocaleString()}</td>
                  <td className="right"><b>{Number(r.amount_approved || 0).toLocaleString()}</b></td>
                  <td>{r.date_of_approval || '—'}</td>
                  <td>{r.estates?.name || '—'}</td>
                  <CustomFieldCells fields={customFields} values={r.custom_data} />
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openEdit(r)}>Edit</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(r)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={12 + customFields.length} className="empty-state">
                    No expenditure records. Use <b>Bulk Import Excel</b> (pick category RCA / DTA / Salary / Others).
                  </td>
                </tr>
              )}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr style={{ fontWeight: 700, background: '#f1f5f9' }}>
                  <td colSpan={7}>TOTAL ({totals.count})</td>
                  <td className="right">{totals.applied.toLocaleString()}</td>
                  <td className="right">{totals.approved.toLocaleString()}</td>
                  <td colSpan={3 + customFields.length} />
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
      {!isSupervisorPlus && (
        <p className="muted" style={{ marginTop: 8 }}>Edits/deletes may require supervisor or admin approval.</p>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>{editingRow ? 'Edit expenditure' : 'New expenditure'}</h3>
            <form onSubmit={handleSave}>
              <div className="grid cols-2">
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>Description *</label>
                  <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required />
                </div>
                <div className="field">
                  <label>Category</label>
                  <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                    {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Expense type / group</label>
                  <input
                    list="expense-group-list"
                    value={form.expense_group}
                    onChange={(e) => setForm({ ...form, expense_group: e.target.value })}
                    placeholder="Auto from description, or type e.g. Recharge cards"
                  />
                  <datalist id="expense-group-list">
                    {knownExpenseGroups().map((g) => <option key={g} value={g} />)}
                  </datalist>
                </div>
                <div className="field">
                  <label>Link to estate (optional)</label>
                  <select value={form.estate_id} onChange={(e) => setForm({ ...form, estate_id: e.target.value })}>
                    <option value="">— None —</option>
                    {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label>Month (e.g. Jan-26)</label>
                  <input value={form.month_label} onChange={(e) => setForm({ ...form, month_label: e.target.value })} />
                </div>
                <div className="field">
                  <label>Site</label>
                  <input value={form.site} onChange={(e) => setForm({ ...form, site: e.target.value })} placeholder="Abuja, Enugu, PH…" />
                </div>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <label>Request vide / Reference</label>
                  <input value={form.request_ref} onChange={(e) => setForm({ ...form, request_ref: e.target.value })} />
                </div>
                <div className="field">
                  <label>Amount applied</label>
                  <input type="number" value={form.amount_applied} onChange={(e) => setForm({ ...form, amount_applied: e.target.value })} />
                </div>
                <div className="field">
                  <label>Amount approved</label>
                  <input type="number" value={form.amount_approved} onChange={(e) => setForm({ ...form, amount_approved: e.target.value })} />
                </div>
                <div className="field">
                  <label>Date applied</label>
                  <input type="date" value={form.date_applied} onChange={(e) => setForm({ ...form, date_applied: e.target.value })} />
                </div>
                <div className="field">
                  <label>Date of approval</label>
                  <input type="date" value={form.date_of_approval} onChange={(e) => setForm({ ...form, date_of_approval: e.target.value })} />
                </div>
                <div className="field">
                  <label>Comments</label>
                  <input value={form.comments} onChange={(e) => setForm({ ...form, comments: e.target.value })} />
                </div>
                <div className="field">
                  <label>Remarks</label>
                  <input value={form.remarks} onChange={(e) => setForm({ ...form, remarks: e.target.value })} />
                </div>
              </div>
              <CustomFieldInputs fields={customFields} values={customData} onChange={setCustomData} />
              {editingRow && (
                <DocumentAttachments
                  linkedTable="approvals_expenditures"
                  linkedRecordId={editingRow.id}
                  estateId={editingRow.estate_id}
                  title="Supporting documents"
                />
              )}
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <div>
                  {editingRow && (
                    <button type="button" className="btn btn-danger" onClick={() => { setShowModal(false); handleDelete(editingRow); }}>
                      Delete this record
                    </button>
                  )}
                </div>
                <div className="flex">
                  <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImport && (
        <div className="modal-overlay" onClick={() => setShowImport(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <h3>Bulk import expenditure</h3>
            <p className="muted">
              Choose the category for this file — including <b>Award of Contract</b> for approved contract payments
              (milestones, roofing, variation, infrastructure, deeds, commissions).
              <b>Estate is optional</b> — leave blank for company-wide items
              (site allowance, salary, travel). For RCA/guards, if the Excel has a <b>Site</b> column
              (Abuja, Enugu, Idu…), the system will try to link each row to the matching estate automatically.
            </p>
            <div className="field">
              <label>Category for this file *</label>
              <select value={importCategory} onChange={(e) => setImportCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Optional: force all rows onto one estate</label>
              <select value={importEstateId} onChange={(e) => setImportEstateId(e.target.value)}>
                <option value="">— None (recommended) — use Site column or leave unlinked —</option>
                {estates.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
              <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                Site allowance / salary / DTA: keep <b>None</b>. RCA with Site in Excel: keep <b>None</b> so each row links from Site. Only force an estate if the whole file is truly for one estate and Site is empty.
              </p>
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setShowImport(false)}>Cancel</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  // keep showImport true but switch to file modal by nested state
                  setShowImport('file');
                }}
              >
                Continue to file…
              </button>
            </div>
          </div>
        </div>
      )}

      {showImport === 'file' && (
        <BulkImportModal
          title={`Import ${importCategory} expenditure`}
          tableName="approvals_expenditures"
          fieldDefs={expenseFieldDefs(importCategory)}
          estates={estates}
          presetEstateId={importEstateId || undefined}
          profile={profile}
          onClose={() => setShowImport(false)}
          onImported={() => { setShowImport(false); load(); }}
          transformRecord={(r) => ({
            ...transformExpenseRecord(r, importCategory, estates, importEstateId || null),
            created_by: profile?.id,
          })}
        />
      )}

      {showColumns && (
        <ManageColumnsModal tableName="approvals_expenditures" onClose={() => setShowColumns(false)} onChanged={load} />
      )}
    </div>
  );
}
