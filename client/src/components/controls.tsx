import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type * as Y from 'yjs';
import { color } from '../../../shared/render.ts';
import { Icon } from './ui.tsx';

/** Named colours the diagram language understands, in palette order. */
export const NAMED_COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'yellow', 'pink', 'teal', 'gray', 'black', 'white'] as const;

// ---- undo grouping ----

/** The canvas registers its undo manager here so panels can make each edit its own undo step. */
const undoManagers = new WeakMap<Y.Doc, Y.UndoManager>();
export function registerUndo(doc: Y.Doc, undo: Y.UndoManager) {
  undoManagers.set(doc, undo);
  return () => { if (undoManagers.get(doc) === undo) undoManagers.delete(doc); };
}
/** Runs a change as one undo step of its own, however quickly it follows the last one. */
export function undoStep(doc: Y.Doc, fn: () => void) {
  const undo = undoManagers.get(doc);
  undo?.stopCapturing();
  fn();
  undo?.stopCapturing();
}

/** Closes the current undo step, so the next edit starts a new one. Used around live (drag-time) edits. */
export function undoBoundary(doc: Y.Doc) {
  undoManagers.get(doc)?.stopCapturing();
}

/** Calls `fn` on the native `change` event, which fires once a value is committed (picker closed, slider released, Enter). */
function useNativeChange<T extends HTMLInputElement>(fn: (value: string) => void) {
  const ref = useRef<T>(null);
  const cb = useRef(fn);
  cb.current = fn;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => cb.current(el.value);
    el.addEventListener('change', on);
    return () => el.removeEventListener('change', on);
  }, []);
  return ref;
}

/** A colour value as the 6-digit hex a native colour input needs. */
export function toHex(c: string | undefined, fallback = '#3b82f6') {
  const v = color(c) ?? fallback;
  if (/^#[0-9a-f]{3}$/i.test(v)) return '#' + [...v.slice(1)].map((x) => x + x).join('');
  return v.slice(0, 7);
}

// ---- collapsible section ----

const SECTION_KEY = 'devart.panel.sections';
function readOpen(): Record<string, boolean> {
  try { return JSON.parse(localStorage.getItem(SECTION_KEY) ?? '{}') ?? {}; } catch { return {}; }
}

/** A titled, collapsible part of the properties panel. Open or closed is remembered per title. */
export function Section({ title, defaultOpen = true, children, actions }: { title: string; defaultOpen?: boolean; children: ReactNode; actions?: ReactNode }) {
  const [open, setOpen] = useState(() => readOpen()[title] ?? defaultOpen);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(SECTION_KEY, JSON.stringify({ ...readOpen(), [title]: next })); } catch { /* storage off */ }
  };
  return (
    <section className={`psec ${open ? 'open' : ''}`}>
      <div className="psec-head">
        <button type="button" className="psec-toggle" aria-expanded={open} onClick={toggle}>
          <span className="psec-caret"><Icon name="chevron-down" size={13} /></span>{title}
        </button>
        {actions}
      </div>
      {open && <div className="psec-body">{children}</div>}
    </section>
  );
}

/** A label and its control on one row. */
export function Field({ label, children, stack }: { label: string; children: ReactNode; stack?: boolean }) {
  return <div className={`pfield ${stack ? 'stack' : ''}`}><span className="pfield-label">{label}</span><div className="pfield-ctl">{children}</div></div>;
}

// ---- segmented control ----

export interface SegOption<T extends string> { value: T; label: string; icon?: string }

/** A row of mutually exclusive buttons. Clicking the active one again clears it when `clearable`. */
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, iconOnly, clearable }: {
  value: T | undefined; options: SegOption<T>[]; onChange: (v: T | undefined) => void; ariaLabel: string; iconOnly?: boolean; clearable?: boolean;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} title={o.label} aria-label={o.label}
            onClick={() => onChange(on && clearable ? undefined : o.value)}>
            {o.icon && <Icon name={o.icon} size={14} />}{!iconOnly && <span>{o.label}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** An on/off button, such as bold or italic. */
export function Toggle({ on, onChange, label, icon }: { on: boolean; onChange: (on: boolean) => void; label: string; icon: string }) {
  return (
    <button type="button" className={`ptoggle ${on ? 'on' : ''}`} aria-pressed={on} aria-label={label} title={label} onClick={() => onChange(!on)}>
      <Icon name={icon} size={14} />
    </button>
  );
}

// ---- colour field ----

/**
 * Swatches for the named colours, a "Default" swatch that clears the value, an optional "None" swatch,
 * and a native picker for any hex colour. The picker commits once when it closes, so dragging in it
 * doesn't flood undo history.
 */
export function ColorField({ value, onChange, ariaLabel, allowNone, compact, onLive, onEnd }: {
  value: string | undefined; onChange: (v: string | undefined) => void; ariaLabel: string; allowNone?: boolean; compact?: boolean;
  /** Called while the picker is being dragged, so the change can show at once. With it, `onEnd` replaces `onChange` when the picker closes. */
  onLive?: (v: string) => void; onEnd?: () => void;
}) {
  const v = value?.toLowerCase();
  const isNone = !!v && /^(none|transparent)$/.test(v);
  const named = NAMED_COLORS.includes(v as never);
  const custom = !!v && !isNone && !named;
  const picker = useNativeChange<HTMLInputElement>((hex) => (onLive ? onEnd?.() : onChange(hex)));
  useEffect(() => { if (picker.current) picker.current.value = toHex(value); }, [value]);
  return (
    <div className={`cfield ${compact ? 'compact' : ''}`} role="group" aria-label={ariaLabel}>
      <button type="button" className={`sw sw-default ${!v ? 'on' : ''}`} title="Default" aria-label="Default" aria-pressed={!v} onClick={() => onChange(undefined)} />
      {allowNone && <button type="button" className={`sw sw-none ${isNone ? 'on' : ''}`} title="None" aria-label="None" aria-pressed={isNone} onClick={() => onChange('none')} />}
      {NAMED_COLORS.map((c) => (
        <button key={c} type="button" className={`sw ${v === c ? 'on' : ''}`} style={{ background: color(c) }} title={c} aria-label={c} aria-pressed={v === c} onClick={() => onChange(c)} />
      ))}
      <label className={`sw sw-custom ${custom ? 'on' : ''}`} title={custom ? `Custom ${value}` : 'Custom colour'} style={custom ? { background: toHex(value) } : undefined}>
        <input ref={picker} type="color" aria-label={`${ariaLabel}: custom`} defaultValue={toHex(value)} onInput={onLive ? (e) => onLive(e.currentTarget.value) : undefined} />
      </label>
    </div>
  );
}

// ---- numbers ----

/**
 * A number box with − and + buttons. Typing commits on Enter or blur, the buttons commit at once,
 * so a value typed digit by digit is one edit. An empty box clears the value.
 */
export function NumberField({ value, placeholder, min, max, step = 1, onChange, ariaLabel, stepper = true }: {
  value: number | undefined; placeholder?: number; min: number; max: number; step?: number; onChange: (v: number | undefined) => void; ariaLabel: string; stepper?: boolean;
}) {
  const [draft, setDraft] = useState(value === undefined ? '' : String(value));
  useEffect(() => setDraft(value === undefined ? '' : String(value)), [value]);
  const clamp = (x: number) => Math.min(max, Math.max(min, x));
  const commit = (text: string) => {
    if (text.trim() === '') { if (value !== undefined) onChange(undefined); return; }
    const x = Number(text);
    if (!Number.isFinite(x)) { setDraft(value === undefined ? '' : String(value)); return; }
    const next = clamp(x);
    setDraft(String(next));
    if (next !== value) onChange(next);
  };
  const bump = (dir: 1 | -1) => commit(String(clamp((value ?? placeholder ?? min) + dir * step)));
  return (
    <div className={`nfield ${stepper ? 'stepper' : ''}`}>
      {stepper && <button type="button" aria-label={`Decrease ${ariaLabel}`} title="Decrease" onClick={() => bump(-1)} disabled={(value ?? placeholder ?? min) <= min}><Icon name="minus" size={13} /></button>}
      <input type="number" inputMode="decimal" aria-label={ariaLabel} min={min} max={max} step={step} placeholder={placeholder === undefined ? '' : String(placeholder)} value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(e.currentTarget.value); if (e.key === 'Escape') setDraft(value === undefined ? '' : String(value)); }} />
      {stepper && <button type="button" aria-label={`Increase ${ariaLabel}`} title="Increase" onClick={() => bump(1)} disabled={(value ?? placeholder ?? min) >= max}><Icon name="plus" size={13} /></button>}
    </div>
  );
}

/** A 0 to 100% slider that shows its value while dragging and commits once on release. */
export function OpacitySlider({ value, onChange, onLive, onEnd }: { value: number | undefined; onChange: (v: number | undefined) => void; onLive?: (v: number | undefined) => void; onEnd?: () => void }) {
  const pct = Math.round((value ?? 1) * 100);
  const [live, setLive] = useState(pct);
  useEffect(() => setLive(pct), [pct]);
  const ref = useNativeChange<HTMLInputElement>((s) => { if (onLive) { onEnd?.(); return; } const x = Number(s) / 100; onChange(x >= 1 ? undefined : x); });
  return (
    <div className="oslider">
      <input ref={ref} type="range" min={0} max={100} step={5} aria-label="Opacity" value={live} onChange={(e) => { const n = Number(e.target.value); setLive(n); onLive?.(n >= 100 ? undefined : n / 100); }} />
      <span className="oslider-val">{live}%</span>
    </div>
  );
}


/** A colour field that shows only the current colour. Opening it reveals the swatches underneath, and picking one closes it again. */
export function ColorSelect({ value, onChange, ariaLabel, allowNone, onLive, onEnd }: {
  value: string | undefined; onChange: (v: string | undefined) => void; ariaLabel: string; allowNone?: boolean; onLive?: (v: string) => void; onEnd?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const v = value?.toLowerCase();
  const isNone = !!v && /^(none|transparent)$/.test(v);
  const name = !v ? 'Default' : isNone ? 'None' : v;
  const bg = !v || isNone ? undefined : color(v) ?? toHex(v);
  return (
    <div className="csel">
      <button type="button" className="csel-trigger" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(!open)}>
        <span className={`sw sw-static ${!v ? 'sw-default' : isNone ? 'sw-none' : ''}`} style={bg ? { background: bg } : undefined} />
        <span className="csel-name">{name}</span>
        <span className="csel-caret"><Icon name="chevron-down" size={12} /></span>
      </button>
      {open && <ColorField compact allowNone={allowNone} ariaLabel={`${ariaLabel} swatches`} value={value} onChange={(x) => { onChange(x); setOpen(false); }} onLive={onLive} onEnd={onLive ? () => { onEnd?.(); setOpen(false); } : undefined} />}
    </div>
  );
}

/** A button showing the current choice that opens a grid of icon choices underneath. */
export function IconSelect({ label, icon, children, ariaLabel }: { label: string; icon?: string; children: (close: () => void) => ReactNode; ariaLabel: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="csel">
      <button type="button" className="csel-trigger" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(!open)}>
        {icon && <Icon name={icon} size={16} />}
        <span className="csel-name">{label}</span>
        <span className="csel-caret"><Icon name="chevron-down" size={12} /></span>
      </button>
      {open && children(() => setOpen(false))}
    </div>
  );
}


// ---- dropdown ----

export interface DropOption { value: string; label: string; icon?: string; swatch?: string }

/**
 * A dropdown that shows each option's icon (or colour dot) and name. The list opens as a flyout panel to the left
 * of the properties panel, with an arrow pointing at the field. On a narrow screen, where there is no room beside
 * the panel, it opens above the field instead. It closes after a pick, Esc, or a click elsewhere.
 */
export function Dropdown({ value, options, onChange, ariaLabel, searchable, placeholder = 'Choose…' }: {
  value: string; options: DropOption[]; onChange: (v: string) => void; ariaLabel: string; searchable?: boolean; placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [place, setPlace] = useState<{ side: 'left' | 'above'; right?: number; top?: number; bottom?: number; arrow?: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fly = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);
  const close = () => { setOpen(false); setQuery(''); setPlace(null); };

  /** Works out where the flyout goes from the field's position, and keeps it there if the panel scrolls. */
  const position = () => {
    const t = trigger.current?.getBoundingClientRect();
    if (!t) return;
    const panel = trigger.current?.closest('.dpanel')?.getBoundingClientRect();
    const room = panel ? panel.left : t.left;
    if (room < 300) { setPlace({ side: 'above', bottom: innerHeight - t.top + 8 }); return; }
    const h = fly.current?.offsetHeight ?? 320;
    const mid = t.top + t.height / 2;
    const top = Math.min(Math.max(mid - h / 2, 12), Math.max(12, innerHeight - h - 12));
    setPlace({ side: 'left', right: innerWidth - (panel?.left ?? t.left) + 12, top, arrow: Math.min(Math.max(mid - top, 18), h - 18) });
  };
  useLayoutEffect(() => { if (open) position(); }, [open, query]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { const n = e.target as Node; if (!trigger.current?.contains(n) && !fly.current?.contains(n)) close(); };
    const move = () => position();
    window.addEventListener('pointerdown', away);
    window.addEventListener('resize', move);
    window.addEventListener('scroll', move, true);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('resize', move); window.removeEventListener('scroll', move, true); };
  }, [open]);
  useEffect(() => { if (open) fly.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [open, place?.side]);

  const q = query.trim().toLowerCase();
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q));
  const lead = (o?: DropOption) => o?.icon ? <Icon name={o.icon} size={16} /> : o?.swatch ? <span className="sw sw-static" style={{ background: o.swatch }} /> : null;
  const style: React.CSSProperties | undefined = !place ? { visibility: 'hidden', right: 0, top: 0 }
    : place.side === 'left' ? { right: place.right, top: place.top }
    : { left: 12, right: 12, bottom: place.bottom, width: 'auto' };
  return (
    <div className="csel dd">
      <button ref={trigger} type="button" className="csel-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => (open ? close() : setOpen(true))}>
        {lead(current)}
        <span className="csel-name dd-name">{current?.label ?? placeholder}</span>
        <span className="csel-caret"><Icon name="chevron-down" size={12} /></span>
      </button>
      {open && createPortal(
        <div ref={fly} className={`dd-fly ${place?.side ?? 'left'}`} style={style} role="dialog" aria-label={ariaLabel}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); trigger.current?.focus(); } }}>
          <div className="dd-title">{ariaLabel.replace(/^Component /, '')}</div>
          {searchable && <input autoFocus type="search" className="dd-search" placeholder="Search…" aria-label={`Search ${ariaLabel.toLowerCase()}`} value={query} onChange={(e) => setQuery(e.target.value)} />}
          <div className="dd-list" role="listbox" aria-label={ariaLabel}>
            {shown.map((o) => (
              <button key={o.value} type="button" role="option" aria-selected={o.value === value} className={`dd-row ${o.value === value ? 'on' : ''}`} onClick={() => { onChange(o.value); close(); }}>
                <span className="dd-lead">{lead(o)}</span>
                <span className="dd-label">{o.label}</span>
                {o.value === value && <Icon name="check" size={13} />}
              </button>
            ))}
            {!shown.length && <p className="muted small dd-empty">Nothing matches "{query}".</p>}
          </div>
          {place?.side === 'left' && <span className="dd-arrow" style={{ top: (place.arrow ?? 24) - 6 }} />}
        </div>,
        document.body,
      )}
    </div>
  );
}
