// Manage icon libraries: switch built-in sets on or off, and add, rename, export or delete your own libraries.
import { useEffect, useState } from 'react';
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react';
import { useUI } from '../../store/uiStore';
import { Modal } from './Modal';
import { Toggle } from '../controls';
import { ICON_SETS, loadNamesIndex } from '../../icons/sets';
import { importFiles, serializeLibrary, useLibraries } from '../../icons/libraries';
import { VENDORS } from '../../icons/zipImport';
import { downloadBlob, pickFiles, safeFileName } from '../../persistence/files';

const ACCEPT = '.svg,.png,.jpg,.jpeg,.gif,.webp,.json,.flowsketchlib,.zip,image/svg+xml,image/png,image/jpeg,image/gif,image/webp,application/json,application/zip';

export function IconLibrariesDialog() {
  const libs = useLibraries((s) => s.libs);
  const loaded = useLibraries((s) => s.loaded);
  const hidden = useUI((s) => s.prefs.hiddenIconSets);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [target, setTarget] = useState('new'); // a library id, or 'new'
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok?: string; error?: string; skipped: string[] } | null>(null);
  const [progress, setProgress] = useState<[number, number] | null>(null);

  useEffect(() => {
    if (!loaded) void useLibraries.getState().load();
    void loadNamesIndex().then((ix) => setCounts(Object.fromEntries(Object.entries(ix).map(([k, v]) => [k, v.length]))));
  }, [loaded]);

  /** `into`: a library id, or 'new' (the "Add to" choice by default; cloud packages always start a new library). */
  async function add(files: File[], into = target) {
    if (!files.length || busy) return;
    setBusy(true); setStatus(null); setProgress(null);
    try {
      const r = await importFiles(files, (done, total) => setProgress([done, total]));
      if (!r.items.length) { setStatus({ error: 'No icons found in those files.', skipped: r.skipped }); return; }
      if (into === 'new' && r.vendor) {
        // a newer download of the same provider's package replaces the old library, if you want
        const old = useLibraries.getState().libs.find((l) => l.vendor === r.vendor);
        if (old && await useUI.getState().ask(`Replace your existing “${old.name}” library with this package? Icons you already placed in diagrams stay as they are.`, 'Replace')) await useLibraries.getState().remove(old.id);
      }
      const folder = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : undefined;
      const lib = await useLibraries.getState().add(r.items, into === 'new' ? { name: newName.trim() || r.libraryName || folder || 'My icons', vendor: r.vendor } : { libId: into });
      setTarget(lib.id); setNewName('');
      setStatus({ ok: `Added ${r.items.length.toLocaleString()} icon${r.items.length === 1 ? '' : 's'} to “${lib.name}”. They are in the Icons panel.${r.vendor && VENDORS[r.vendor].note ? ' ' + VENDORS[r.vendor].note : ''}`, skipped: r.skipped });
    } catch (e) {
      setStatus({ error: `Could not add those files: ${(e as Error).message}`, skipped: [] });
    } finally { setBusy(false); setProgress(null); }
  }

  const toggleSet = (id: string, on: boolean) => useUI.getState().updatePrefs({ hiddenIconSets: on ? hidden.filter((h) => h !== id) : [...hidden, id] });
  const remove = async (id: string, name: string) => {
    if (await useUI.getState().ask(`Delete the library “${name}”? Icons you already placed in diagrams stay where they are.`, 'Delete')) {
      await useLibraries.getState().remove(id);
      if (target === id) setTarget('new');
    }
  };

  return (
    <Modal title="Icon libraries" wide>
      <div className="iconlibs" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void add([...e.dataTransfer.files]); }}>
        <section>
          <h3>Built-in sets</h3>
          <ul className="lib-list">
            {ICON_SETS.map((s) => (
              <li key={s.id}>
                <div><b>{s.name}</b><span className="dim small">{s.group} · {counts[s.id]?.toLocaleString() ?? '…'} icons · {s.license}{s.brands ? ' · brands remain their owners’ marks' : ''}</span></div>
                <Toggle label="Shown" ariaLabel={`Show ${s.name} in the Icons panel`} checked={!hidden.includes(s.id)} onChange={(v) => toggleSet(s.id, v)} />
              </li>
            ))}
          </ul>
          <h3>Cloud provider icons</h3>
          <p className="dim small">Download the official icon package (a ZIP) from the provider, where you accept their terms, then choose it here. FlowSketch converts the icons and keeps them only in this browser; they are not included with FlowSketch.</p>
          <ul className="lib-list">
            {(Object.keys(VENDORS) as (keyof typeof VENDORS)[]).map((v) => (
              <li key={v}>
                <div><b>{VENDORS[v].library}</b><a className="small" href={VENDORS[v].url} target="_blank" rel="noopener noreferrer">Get the official icons from {VENDORS[v].name} ↗</a></div>
                <button className="btn small" disabled={busy} onClick={() => void pickFiles('.zip,application/zip').then((f) => add(f, 'new'))}>Choose ZIP…</button>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h3>Your libraries</h3>
          {libs.length === 0
            ? <p className="note">No libraries yet. Add SVG or PNG files below and they appear in the Icons panel.</p>
            : (
              <ul className="lib-list">
                {libs.map((l) => (
                  <li key={l.id}>
                    <div>
                      <input className="lib-name" aria-label={`Name of ${l.name}`} defaultValue={l.name} onBlur={(e) => void useLibraries.getState().rename(l.id, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                      <span className="dim small">{l.items.length.toLocaleString()} icon{l.items.length === 1 ? '' : 's'} · stored in this browser</span>
                    </div>
                    <div className="btn-row">
                      <button className="icon-btn sm" title="Export as a .flowsketchlib file to share" aria-label={`Export ${l.name}`} onClick={() => downloadBlob(new Blob([serializeLibrary(l)], { type: 'application/json' }), safeFileName(l.name, 'flowsketchlib'))}><Download size={14} /></button>
                      <button className="icon-btn sm" title="Delete this library" aria-label={`Delete ${l.name}`} onClick={() => void remove(l.id, l.name)}><Trash2 size={14} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          <div className="lib-add">
            <h3>Add icons</h3>
            <label className="field"><span>Add to</span>
              <select className="select" aria-label="Add to library" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="new">A new library</option>
                {libs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            {target === 'new' && <label className="field"><span>New library name</span><input aria-label="New library name" placeholder="Named after the folder or file if empty" value={newName} onChange={(e) => setNewName(e.target.value)} /></label>}
            <div className="btn-row">
              <button className="btn" disabled={busy} onClick={() => void pickFiles(ACCEPT).then(add)}><Upload size={14} /> Choose files…</button>
              <button className="btn" disabled={busy} onClick={() => void pickFiles(ACCEPT, true).then(add)}><FolderOpen size={14} /> Choose a folder…</button>
            </div>
            <p className="dim small">Or drop files here. SVG, PNG, JPEG, GIF and WebP files, ZIPs of SVG icons, Iconify JSON icon sets, and shared .flowsketchlib libraries. SVGs are converted to plain shapes, so nothing in them can run.</p>
            {busy && <p className="note" role="status">{progress ? `Converting icons… ${progress[0].toLocaleString()} of ${progress[1].toLocaleString()}` : 'Adding icons…'}</p>}
            {status?.ok && <p className="note ok" role="status">{status.ok}</p>}
            {status?.error && <p className="note error" role="alert">{status.error}</p>}
            {status && status.skipped.length > 0 && (
              <details className="adv"><summary>{status.skipped.length} file{status.skipped.length === 1 ? '' : 's'} skipped</summary><ul className="skipped">{status.skipped.slice(0, 50).map((s) => <li key={s}>{s}</li>)}</ul></details>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}
