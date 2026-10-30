// Small, accessible form controls used by the inspector and dialogs.
import { useId, useState, type ReactNode } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { useUI } from '../store/uiStore';
import { colorLabel } from './colorNames';

export function Section({ title, children, defaultOpen = true, right }: { title: string; children: ReactNode; defaultOpen?: boolean; right?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`insp-section ${open ? 'open' : ''}`}>
      <div className="insp-section-head">
        <button className="insp-section-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <ChevronDown size={14} className="chev" /> {title}
        </button>
        {right}
      </div>
      {open && <div id={id} className="insp-section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="row" title={hint}>
      <span className="row-label">{label}</span>
      <div className="row-ctl">{children}</div>
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, onChange, onReset, unit = '', overridden, hint }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onReset?: () => void; unit?: string; overridden?: boolean; hint?: string;
}) {
  const id = useId();
  const dec = step < 1 ? (step < 0.1 ? 2 : 1) : 0;
  return (
    <div className={`slider ${overridden ? 'overridden' : ''}`} title={hint}>
      <label htmlFor={id} className="slider-label">{label}{overridden && <span className="ov-dot" title="Overrides document default" />}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <input
        aria-label={`${label} value`}
        className="num"
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(value.toFixed(dec))}
        onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max * 10, Math.max(min, v))); }}
      />
      {unit && <span className="unit">{unit}</span>}
      {onReset && <button className="mini-btn" aria-label={`Reset ${label}`} title="Reset to default" onClick={onReset}><RotateCcw size={12} /></button>}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T | undefined; options: { v: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.v)} role="radio" aria-checked={value === o.v} title={o.title ?? (typeof o.label === 'string' ? o.label : undefined)} className={value === o.v ? 'on' : ''} onClick={() => onChange(o.v)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Toggle({ label, checked, onChange, hint, ariaLabel }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; ariaLabel?: string }) {
  return (
    <label className="toggle" title={hint}>
      <input type="checkbox" checked={checked} aria-label={ariaLabel} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function ColorPicker({ value, onChange, palette, label, allowTransparent }: { value: string; onChange: (c: string) => void; palette: string[]; label: string; allowTransparent?: boolean }) {
  const recent = useUI((s) => s.prefs.recentColors);
  const push = useUI((s) => s.pushRecentColor);
  const [hex, setHex] = useState(value);
  const [focus, setFocus] = useState(false);
  const shown = focus ? hex : value;
  const pick = (c: string) => { onChange(c); if (c !== 'transparent') push(c); setHex(c); };
  const swatches = palette.filter((c) => allowTransparent || c !== 'transparent');
  return (
    <div className="color-picker" aria-label={label}>
      <div className="swatches">
        {swatches.map((c) => (
          <button key={c} className={`sw ${c === 'transparent' ? 'transparent' : ''} ${value.toLowerCase() === c.toLowerCase() ? 'on' : ''}`} style={{ background: c === 'transparent' ? undefined : c }} aria-label={`${label} ${c}`} title={colorLabel(c)} onClick={() => pick(c)} />
        ))}
      </div>
      {recent.length > 0 && (
        <div className="swatches recent" aria-label="Recent colours">
          {recent.slice(0, 8).map((c) => <button key={c} className={`sw small ${value === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Recent ${c}`} title={`Recent: ${colorLabel(c)}`} onClick={() => pick(c)} />)}
        </div>
      )}
      <div className="hex-row">
        <span className="hash-sw" style={{ background: value === 'transparent' ? undefined : value }} />
        <input
          aria-label={`${label} hex`}
          className="hex"
          value={shown}
          onFocus={() => { setFocus(true); setHex(value); }}
          onBlur={() => { setFocus(false); }}
          onChange={(e) => { let v = e.target.value.trim(); if (!v.startsWith('#') && /^[0-9a-f]+$/i.test(v)) v = '#' + v; setHex(v); if (HEX.test(v)) onChange(v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (HEX.test(hex)) pick(hex); (e.target as HTMLInputElement).blur(); } }}
        />
        <input aria-label={`${label} custom colour`} type="color" className="native-color" value={HEX.test(value) && value.length === 7 ? value : '#000000'} onChange={(e) => onChange(e.target.value)} onBlur={(e) => push(e.target.value)} />
      </div>
    </div>
  );
}

export function Select<T extends string>({ value, options, onChange, label }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <select aria-label={label} className="select" value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  );
}

export function NumberField({ label, value, onChange, step = 1, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="numfield">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={draft ?? String(Math.round(value * 100) / 100)}
        onFocus={() => setDraft(String(Math.round(value * 100) / 100))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft !== null && draft !== '' && Number.isFinite(Number(draft))) onChange(Number(draft)); setDraft(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
    </label>
  );
}
