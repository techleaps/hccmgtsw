import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { uploadDocument, listDocuments, getDownloadUrl, deleteDocument } from '../lib/documents';

/**
 * Reusable attachments block for any record (contract_awards, ownership_changes,
 * refunds, approvals_expenditures, subscriber, etc.)
 */
export default function DocumentAttachments({
  linkedTable,
  linkedRecordId,
  estateId,
  subscriberName,
  title = 'Attached documents',
}) {
  const { profile } = useAuth();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null); // { url, mime, name }

  useEffect(() => {
    if (linkedRecordId || (estateId && subscriberName)) load();
  }, [linkedTable, linkedRecordId, estateId, subscriberName]);

  async function load() {
    setLoading(true);
    const rows = await listDocuments({
      linkedTable: linkedTable || undefined,
      linkedRecordId: linkedRecordId || undefined,
      estateId: estateId || undefined,
      subscriberName: subscriberName || undefined,
    });
    setDocs(rows);
    setLoading(false);
  }

  async function handleUpload(e) {
    e.preventDefault();
    setError('');
    if (!file) { setError('Choose a file.'); return; }
    setSaving(true);
    const { error: err } = await uploadDocument({
      file,
      description: description || file.name,
      uploadedBy: profile.id,
      linkedTable: linkedTable || null,
      linkedRecordId: linkedRecordId || null,
      estateId: estateId || null,
      subscriberName: subscriberName || null,
    });
    setSaving(false);
    if (err) { setError(err.message); return; }
    setFile(null);
    setDescription('');
    load();
  }

  async function openPreview(doc) {
    const url = await getDownloadUrl(doc.storage_path);
    if (!url) { alert('Could not open document.'); return; }
    setPreview({ url, mime: doc.mime_type || '', name: doc.file_name });
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.file_name}"?`)) return;
    await deleteDocument(doc.id, doc.storage_path);
    load();
  }

  const isImage = (mime) => String(mime || '').startsWith('image/');
  const isPdf = (mime) => String(mime || '').includes('pdf');

  return (
    <div>
      <h4 style={{ margin: '12px 0 8px' }}>{title}</h4>
      <form onSubmit={handleUpload} className="flex wrap" style={{ gap: 10, alignItems: 'flex-end', marginBottom: 10 }}>
        <div className="field" style={{ minWidth: 160 }}>
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Signed contract" />
        </div>
        <div className="field" style={{ minWidth: 200 }}>
          <label>File</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button type="submit" className="btn btn-outline btn-sm" disabled={saving || !linkedRecordId && !subscriberName}>
          {saving ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {!linkedRecordId && !subscriberName && (
        <p className="muted">Save the record first, then attach documents.</p>
      )}
      {error && <div className="error-text">{error}</div>}
      {loading ? <p className="muted">Loading documents…</p> : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Description</th><th>File</th><th>Uploaded</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.description || '—'}</td>
                  <td>{d.file_name}</td>
                  <td>{d.created_at ? new Date(d.created_at).toLocaleString() : '—'}</td>
                  <td>
                    <div className="flex">
                      <button type="button" className="btn btn-outline btn-sm" onClick={() => openPreview(d)}>Preview</button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(d)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr><td colSpan={4} className="empty-state">No documents attached.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div
            className="modal"
            style={{ maxWidth: '90vw', width: 900, maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{preview.name}</h3>
              <div className="flex">
                <a className="btn btn-outline btn-sm" href={preview.url} target="_blank" rel="noreferrer">Open in new tab</a>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
            <div style={{ marginTop: 12, maxHeight: '75vh', overflow: 'auto', background: '#f8fafc', borderRadius: 8 }}>
              {isImage(preview.mime) ? (
                <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
              ) : isPdf(preview.mime) || preview.name.toLowerCase().endsWith('.pdf') ? (
                <iframe title={preview.name} src={preview.url} style={{ width: '100%', height: '70vh', border: 'none' }} />
              ) : (
                <p className="muted" style={{ padding: 16 }}>
                  Preview not available for this file type. Use <b>Open in new tab</b> to download/view.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
