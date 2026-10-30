// Icons panel, docked on the left: search the built-in icon sets and your own libraries, then drag an icon
// onto the canvas or click to add it.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Plus, Search, Settings2, X } from 'lucide-react';
import type { IconAsset, IconGradient, IconPaint } from '../model/types';
import { useUI } from '../store/uiStore';
import { insertIcon } from '../store/commands';
import { ICON_SETS, iconTitle, loadedSets, loadIconSet, loadNamesIndex, searchNames, type IconSet, type IconSetInfo } from '../icons/sets';
import { libSetId, useLibraries } from '../icons/libraries';

/** dataTransfer type for an icon dragged from the panel; the value is "<set>:<name>". */
export const ICON_DRAG_TYPE = 'application/x-flowsketch-icon';
const PAGE = 300; // icons per page when browsing one set
const PREVIEW = 18; // icons per set in the "All" overview
const PER_SET_RESULTS = 24; // search results per set in "All"

/** A gradient as an SVG element (built from validated data, never raw markup). */
function GradientDef({ id, g }: { id: string; g: IconGradient }) {
  const common = { id, gradientUnits: g.bbox ? 'objectBoundingBox' : 'userSpaceOnUse', gradientTransform: g.m ? `matrix(${g.m.join(' ')})` : undefined };
  const stops = g.stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />);
  return g.type === 'linear'
    ? <linearGradient {...common} x1={g.x1} y1={g.y1} x2={g.x2} y2={g.y2}>{stops}</linearGradient>
    : <radialGradient {...common} cx={g.cx} cy={g.cy} r={g.r} fx={g.fx} fy={g.fy}>{stops}</radialGradient>;
}

/** Draws a converted icon as plain SVG elements (never raw markup). */
export function IconGlyph({ icon, size = 26 }: { icon: IconAsset; size?: number }) {
  const uid = useId().replace(/:/g, '');
  const defs: ReactNode[] = [];
  const paint = (c: IconPaint, key: string) => {
    if (!c) return 'none';
    if (typeof c === 'string') return c;
    defs.push(<GradientDef key={key} id={`${uid}${key}`} g={c} />);
    return `url(#${uid}${key})`;
  };
  return (
    <svg width={size} height={size} viewBox={`0 0 ${icon.w} ${icon.h}`} aria-hidden focusable="false">
      {icon.parts.map((p, i) => (
        <path key={i} d={p.d} transform={p.m ? `matrix(${p.m.join(' ')})` : undefined}
          fill={paint(p.fill, `f${i}`)} stroke={paint(p.stroke, `s${i}`)} strokeWidth={p.strokeWidth} strokeLinecap={p.linecap} strokeLinejoin={p.linejoin}
          fillRule={p.evenodd ? 'evenodd' : 'nonzero'} opacity={p.opacity < 1 ? p.opacity : undefined} />
      ))}
      {defs.length > 0 && <defs>{defs}</defs>}
    </svg>
  );
}

/** Loads a set (or library) when first shown. */
function useIconSet(id: string): { set: IconSet | null; error: string | null; retry: () => void } {
  const [state, setState] = useState<{ set: IconSet | null; error: string | null }>({ set: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const libs = useLibraries((s) => s.libs); // a library's contents change when icons are added to it
  useEffect(() => {
    let alive = true;
    setState((s) => ({ set: s.set?.info.id === id ? s.set : null, error: null }));
    loadIconSet(id).then((set) => { if (alive) setState({ set, error: null }); }).catch((e: Error) => { if (alive) setState({ set: null, error: e.message }); });
    return () => { alive = false; };
  }, [id, attempt, libs]);
  return { ...state, retry: () => setAttempt((n) => n + 1) };
}

function IconCell({ set, name }: { set: IconSet; name: string }) {
  const picture = set.picture?.(name);
  const icon = picture ? null : set.icon(name);
  if (!icon && !picture) return null;
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
      {icon ? <IconGlyph icon={icon} /> : <img src={picture!.dataUrl} alt="" width={26} height={26} draggable={false} />}
    </button>
  );
}

const BRAND_NOTE = 'Logos are trademarks of their owners. Use them to show which products a system uses, not to suggest endorsement.';

/** One set's icons: a heading, an optional brand note, and a grid. */
function SetSection({ info, names, total, onShowAll, more, brandNote = true }: { info: IconSetInfo; names: string[]; total: number; onShowAll?: () => void; more?: ReactNode; brandNote?: boolean }) {
  const { set, error, retry } = useIconSet(info.id);
  return (
    <section className="ip-sec" aria-label={info.name}>
      <h3>
        <span>{info.group === info.name ? info.name : `${info.group} · ${info.name}`}</span>
        {onShowAll && total > names.length && <button className="link" onClick={onShowAll}>Show all {total.toLocaleString()}</button>}
      </h3>
      {info.brands && brandNote && <p className="ip-note">{BRAND_NOTE}</p>}
      {error && <p className="ip-msg" role="alert">{error} <button className="link" onClick={retry}>Try again</button></p>}
      {!set && !error && <p className="ip-msg">Loading {info.name}…</p>}
      {set && <div className="ip-grid">{names.map((n) => <IconCell key={n} set={set} name={n} />)}</div>}
      {more}
    </section>
  );
}

/** Recently used icons, from any set. */
function RecentSection({ keys, sets }: { keys: string[]; sets: IconSetInfo[] }) {
  const bySet = new Map<string, string[]>();
  for (const k of keys) {
    const i = k.indexOf(':');
    const id = k.slice(0, i);
    if (sets.some((s) => s.id === id)) bySet.set(id, [...(bySet.get(id) ?? []), k.slice(i + 1)]);
  }
  if (!bySet.size) return null;
  return (
    <section className="ip-sec" aria-label="Recently used icons">
      <h3><span>Recent</span></h3>
      <div className="ip-grid">{[...bySet].map(([id, names]) => <RecentCells key={id} id={id} names={names} />)}</div>
    </section>
  );
}
function RecentCells({ id, names }: { id: string; names: string[] }) {
  const { set } = useIconSet(id);
  return set ? <>{names.map((n) => <IconCell key={n} set={set} name={n} />)}</> : null;
}

export function IconsPanel() {
  const recent = useUI((s) => s.prefs.recentIcons);
  const hidden = useUI((s) => s.prefs.hiddenIconSets);
  const libs = useLibraries((s) => s.libs);
  const libsLoaded = useLibraries((s) => s.loaded);
  const [index, setIndex] = useState<Record<string, string[]> | null>(null);
  const [chip, setChip] = useState('all');
  const [query, setQuery] = useState('');
  const [shown, setShown] = useState(PAGE);

  useEffect(() => { void loadNamesIndex().then(setIndex); if (!libsLoaded) void useLibraries.getState().load(); }, [libsLoaded]);

  const sets: IconSetInfo[] = useMemo(() => [
    ...ICON_SETS.filter((s) => !hidden.includes(s.id)),
    ...libs.map((l) => ({ id: libSetId(l.id), name: l.name, group: l.name, license: '' })),
  ], [hidden, libs]);
  const namesOf = (info: IconSetInfo) => (info.url ? index?.[info.id] ?? [] : libs.find((l) => libSetId(l.id) === info.id)?.items.map((it) => it.name).sort() ?? []);
  const active = sets.find((s) => s.id === chip);
  const q = query.trim();
  const pick = (id: string) => { setChip(id); setShown(PAGE); };
  const total = sets.reduce((n, s) => n + namesOf(s).length, 0);

  let body: ReactNode;
  if (!index) body = <p className="ip-msg">Loading icons…</p>;
  else if (active) {
    const all = namesOf(active);
    const names = q ? searchNames(all, q, PAGE) : all.slice(0, shown);
    body = names.length || !q
      ? <SetSection info={active} names={names} total={all.length} more={!q && shown < all.length && <button className="btn small ip-more" onClick={() => setShown((n) => n + PAGE)}>Show more ({(all.length - shown).toLocaleString()} left)</button>} />
      : <p className="ip-msg">No icons in {active.name} match “{q}”. Try a shorter or different word, or search All.</p>;
  } else {
    const groups = sets.map((info) => { const all = namesOf(info); const hits = q ? searchNames(all, q, 10000) : all; return { info, hits }; }).filter((g) => g.hits.length);
    body = (
      <>
        {!q && <RecentSection keys={recent} sets={sets} />}
        {q && groups.some((g) => g.info.brands) && <p className="ip-note">{BRAND_NOTE}</p>}
        {groups.map(({ info, hits }) => (
          // without a search, sets not downloaded yet appear as one line, so opening the panel doesn't download them all
          q || !info.url || info.id === ICON_SETS[0].id || loadedSets.has(info.id)
            ? <SetSection key={info.id} info={info} names={hits.slice(0, q ? PER_SET_RESULTS : PREVIEW)} total={hits.length} onShowAll={() => pick(info.id)} brandNote={!q} />
            : (
              <section key={info.id} className="ip-sec ip-teaser" aria-label={info.name}>
                <h3><span>{info.group} · {info.name}</span><button className="link" onClick={() => pick(info.id)}>Show {hits.length.toLocaleString()}</button></h3>
              </section>
            )
        ))}
        {q && !groups.length && <p className="ip-msg">No icons match “{q}”. Try a shorter or different word.</p>}
      </>
    );
  }

  const ui = useUI.getState();
  return (
    <aside className="icons-panel no-canvas" aria-label="Icons">
      <div className="ip-head">
        <div>
          <div className="insp-title">Icons</div>
          <div className="insp-sub">{index ? `${total.toLocaleString()} icons · drag or click to add` : 'Drag or click to add'}</div>
        </div>
        <button className="icon-btn sm" aria-label="Close icons" title="Close (Shift+I)" onClick={() => ui.updatePrefs({ showIconPanel: false })}><X size={15} /></button>
      </div>
      <label className="search ip-search">
        <Search size={15} />
        <input
          aria-label="Search icons"
          placeholder={active ? `Search ${active.name}` : 'Search all icons (e.g. database, aws)'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="ip-chips" role="group" aria-label="Icon sets">
        {[{ id: 'all', group: 'All' }, ...sets].map((s) => (
          <button key={s.id} className={`chip ${chip === s.id ? 'on' : ''}`} aria-pressed={chip === s.id} onClick={() => pick(s.id)}>{s.group}</button>
        ))}
      </div>
      <div className="ip-scroll">{body}</div>
      <div className="ip-foot">
        <button className="btn small ghost" onClick={() => ui.openDialog('iconlibs')}><Plus size={14} /> Add icons</button>
        <button className="btn small ghost" onClick={() => ui.openDialog('iconlibs')}><Settings2 size={14} /> Manage</button>
      </div>
    </aside>
  );
}
