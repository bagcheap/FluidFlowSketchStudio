// Icons panel, docked on the left: search the built-in icon sets, then drag an icon onto the canvas or click to add it.
import { useEffect, useMemo, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { IconAsset } from '../model/types';
import { useUI } from '../store/uiStore';
import { insertIcon } from '../store/commands';
import { ICON_SETS, iconTitle, loadIconSet, searchNames, type IconSet } from '../icons/sets';

/** dataTransfer type for an icon dragged from the panel; the value is "<set>:<name>". */
export const ICON_DRAG_TYPE = 'application/x-flowsketch-icon';
const PAGE = 300;

/** Draws a converted icon as plain SVG elements (never raw markup). */
export function IconGlyph({ icon, size = 26 }: { icon: IconAsset; size?: number }) {
  return (
    <svg width={size} height={size} viewBox={`0 0 ${icon.w} ${icon.h}`} aria-hidden focusable="false">
      {icon.parts.map((p, i) => (
        <path key={i} d={p.d} transform={p.m ? `matrix(${p.m.join(' ')})` : undefined}
          fill={p.fill ?? 'none'} stroke={p.stroke ?? 'none'} strokeWidth={p.strokeWidth} strokeLinecap={p.linecap} strokeLinejoin={p.linejoin}
          fillRule={p.evenodd ? 'evenodd' : 'nonzero'} opacity={p.opacity < 1 ? p.opacity : undefined} />
      ))}
    </svg>
  );
}

function IconCell({ set, name }: { set: IconSet; name: string }) {
  const icon = set.icon(name);
  if (!icon) return null;
  const key = `${set.info.id}:${name}`;
  const title = iconTitle(name);
  return (
    <button
      className="icon-cell"
      draggable
      data-icon={key}
      aria-label={title}
      title={`${title}\n${set.info.name} · drag onto the canvas, or click to add`}
      onDragStart={(e) => { e.dataTransfer.setData(ICON_DRAG_TYPE, key); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => void insertIcon(set.info.id, name)}
    >
      <IconGlyph icon={icon} />
    </button>
  );
}

export function IconsPanel() {
  const recent = useUI((s) => s.prefs.recentIcons);
  const [setId] = useState(ICON_SETS[0].id); // one built-in set for now
  const [set, setSet] = useState<IconSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setError(null);
    loadIconSet(setId).then((s) => { if (alive) setSet(s); }).catch((e: Error) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [setId, attempt]);

  const results = useMemo(() => (set ? searchNames(set.names, query, query.trim() ? PAGE : shown) : []), [set, query, shown]);
  const recentHere = set ? recent.filter((k) => k.startsWith(set.info.id + ':')).map((k) => k.slice(set.info.id.length + 1)) : [];
  const close = () => useUI.getState().updatePrefs({ showIconPanel: false });

  return (
    <aside className="icons-panel no-canvas" aria-label="Icons">
      <div className="ip-head">
        <div>
          <div className="insp-title">Icons</div>
          <div className="insp-sub">{set ? `${set.info.name} · ${set.names.length.toLocaleString()} icons · ${set.info.license}` : 'Drag onto the canvas, or click to add'}</div>
        </div>
        <button className="icon-btn sm" aria-label="Close icons" title="Close (Shift+I)" onClick={close}><X size={15} /></button>
      </div>
      <label className="search ip-search">
        <Search size={15} />
        <input
          aria-label="Search icons"
          placeholder="Search icons (e.g. database, user, cloud)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && set && results[0]) void insertIcon(set.info.id, results[0]); }}
        />
      </label>
      <div className="ip-scroll">
        {error && (
          <div className="ip-msg" role="alert">
            {error} <button className="link" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        )}
        {!set && !error && <div className="ip-msg">Loading icons…</div>}
        {set && !query.trim() && recentHere.length > 0 && (
          <section className="ip-sec" aria-label="Recently used icons">
            <h3>Recent</h3>
            <div className="ip-grid">{recentHere.map((n) => <IconCell key={n} set={set} name={n} />)}</div>
          </section>
        )}
        {set && (
          <section className="ip-sec" aria-label={query.trim() ? 'Search results' : set.info.name}>
            <h3>{query.trim() ? `${results.length === PAGE ? `${PAGE}+` : results.length} result${results.length === 1 ? '' : 's'}` : set.info.name}</h3>
            {results.length > 0
              ? <div className="ip-grid">{results.map((n) => <IconCell key={n} set={set} name={n} />)}</div>
              : <p className="ip-msg">No icons match “{query}”. Try a shorter or different word.</p>}
            {!query.trim() && shown < set.names.length && (
              <button className="btn small ip-more" onClick={() => setShown((n) => n + PAGE)}>Show more ({(set.names.length - shown).toLocaleString()} left)</button>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
