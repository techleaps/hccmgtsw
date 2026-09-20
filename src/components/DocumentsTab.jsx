import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from '../lib/AuthContext';
import { uploadDocument, listDocuments, getDownloadUrl, deleteDocument } from '../lib/documents';

export default function DocumentsTab() {
  const { profile, isSupervisorPlus } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const preselectedUser = searchParams.get('user') || '';
  const linkedTable = searchParams.get('linkedTable') || '';
  const linkedRecordId = searchParams.get('linkedRecordId') || '';
  const recordScoped = !!(linkedTable && linkedRecordId);

  const [users, setUsers] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [userFilter, setUserFilter] = useState(preselectedUser);

  const [showModal, setShowModal] = useState(false);
  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [linkUser, setLinkUser] = useState(preselectedUser);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    supabase.from('profiles').select('id, full_name, username').order('full_name').then(({ data }) => setUsers(data || []));
  }, []);

  useEffect(() => { load(); }, [userFilter, linkedTable, linkedRecordId]);

  async function load() {
    setLoading(true);
    setDocs(await listDocuments({
      linkedUserId: recordScoped ? undefined : (userFilter || undefined),
      linkedTable: linkedTable || undefined,
      linkedRecordId: linkedRecordId || undefined,
    }));
    setLoading(false);
  }

  async function handleUpload(e) {
    e.preventDefault();
    setError('');
    if (!file) { setError('Choose a file to upload.'); return; }
    setSaving(true);
    const { error } = await uploadDocument({
      file, description, linkedUserId: linkUser || null, uploadedBy: profile.id,
      linkedTable: linkedTable || null, linkedRecordId: linkedRecordId || null,
    });
    setSaving(false);
    if (error) { setError(error.message); return; }
    setShowModal(false);
    setFile(null); setDescription(''); setLinkUser('');
    load();
  }

  async function handleDownload(doc) {
    const url = await getDownloadUrl(doc.storage_path);
    if (url) window.open(url, '_blank');
    else alert('Could not generate a download link.');
  }

  async function handlePreview(doc) {
    const url = await getDownloadUrl(doc.storage_path);
    if (!url) { alert('Could not generate a preview link.'); return; }
    setPreview({ url, mime: doc.mime_type || '', name: doc.file_name });
  }

  async function handleDelete(doc) {
    if (!confirm(`Delete "${doc.file_name}"? This cannot be undone.`)) return;
    await deleteDocument(doc.id, doc.storage_path);
    load();
  }

  return (
    <div>
      <div className="page-title">
        <h2>Documents{recordScoped ? ' — Linked to Record' : ''}</h2>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>+ Upload Document</button>
      </div>

      {!recordScoped && (
        <div className="card">
          <label>Filter by User</label>
          <select
            value={userFilter}
            onChange={(e) => { setUserFilter(e.target.value); setSearchParams(e.target.value ? { user: e.target.value } : {}); }}
          >
            <option value="">All Documents</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}{u.username ? ` (${u.username})` : ''}</option>)}
          </select>
        </div>
      )}

      <div className="table-wrap">
        {loading ? <p className="muted" style={{ padding: 16 }}>Loading…</p> : (
          <table>
            <thead>
              <tr><th>File</th><th>Description</th><th>Linked User</th><th>Uploaded By</th><th>Date</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td>{d.file_name}</td>
                  <td>{d.description}</td>
                  <td>{d.linked_user?.full_name || '—'}</td>
                  <td>{d.uploader?.full_name || '—'}</td>
                  <td>{new Date(d.created_at).toLocaleDateString()}</td>
                  <td>
                    <div className="flex">
                      <button className="btn btn-outline btn-sm" onClick={() => handlePreview(d)}>Preview</button>
                      <button className="btn btn-outline btn-sm" onClick={() => handleDownload(d)}>Download</button>
                      {isSupervisorPlus && <button className="btn btn-danger btn-sm" onClick={() => handleDelete(d)}>Delete</button>}
                    </div>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && <tr><td colSpan={6} className="empty-state">No documents found.</td></tr>}
            </tbody>
          </table>
        )}
      </div>


      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Upload Document</h3>
            <form onSubmit={handleUpload}>
              <div className="field">
                <label>File</label>
                <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} required />
              </div>
              <div className="field">
                <label>Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Signed offer letter" />
              </div>
              {!recordScoped && (
                <div className="field">
                  <label>Link to User (optional)</label>
                  <select value={linkUser} onChange={(e) => setLinkUser(e.target.value)}>
                    <option value="">— None —</option>
                    {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              )}
              {recordScoped && <p className="muted">This file will be linked to the record you came from.</p>}
              {error && <div className="error-text">{error}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-outline" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal" style={{ maxWidth: '90vw', width: 900 }} onClick={(e) => e.stopPropagation()}>
            <div className="flex" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{preview.name}</h3>
              <div className="flex">
                <a className="btn btn-outline btn-sm" href={preview.url} target="_blank" rel="noreferrer">Open in new tab</a>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setPreview(null)}>Close</button>
              </div>
            </div>
            <div style={{ marginTop: 12, maxHeight: '75vh', overflow: 'auto', background: '#f8fafc', borderRadius: 8 }}>
              {String(preview.mime || '').startsWith('image/') ? (
                <img src={preview.url} alt={preview.name} style={{ maxWidth: '100%', display: 'block', margin: '0 auto' }} />
              ) : (String(preview.mime || '').includes('pdf') || String(preview.name || '').toLowerCase().endsWith('.pdf')) ? (
                <iframe title={preview.name} src={preview.url} style={{ width: '100%', height: '70vh', border: 'none' }} />
              ) : (
                <p className="muted" style={{ padding: 16 }}>Preview not available for this file type. Use Open in new tab.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
