import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { iconPath } from '../../../shared/icons.ts';

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const d = EXTRA[name] ?? iconPath(name) ?? '';
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

const EXTRA: Record<string, string> = {
  back: 'M15 5l-7 7 7 7', sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.500 1.500M17.500 17.500L19 19M19 5l-1.500 1.500M6.500 17.500L5 19',
  moon: 'M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10z', trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14', download: 'M12 3v12M8 11l4 4 4-4M5 19h14', dots: 'M5 12h.01M12 12h.01M19 12h.01',
  cursor: 'M5 3l14 8-6 2-2 6z', move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3', copy: 'M8 8h12v12H8zM4 16V4h12', check: 'M4 12l5 5L20 6', pen: 'M4 20l1-5L16 4l4 4L9 19zM14 6l4 4', frame: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4',
  undo: 'M4 9l5-5M4 9l5 5M4 9h10a6 6 0 0 1 0 12h-3', redo: 'M20 9l-5-5M20 9l-5 5M20 9H10a6 6 0 0 0 0 12h3', fit: 'M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6',
  'arrow-right': 'M4 12h16M14 6l6 6-6 6', swap: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
};

export function Logo({ large }: { large?: boolean }) {
  const s = large ? 34 : 24;
  return (
    <span className="logo">
      <svg width={s} height={s} viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--accent)" /><path d="M9 8h6a8 8 0 0 1 0 16H9z" fill="none" stroke="#fff" strokeWidth="3" /><circle cx="23" cy="9" r="3" fill="#ffc857" /></svg>
      <b>DevArt</b>
    </span>
  );
}

export function Menu({ items, label = 'More', trigger }: { label?: string; trigger?: ReactNode; items: { label: string; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={trigger ? '' : 'ghost'} aria-label={label} aria-expanded={open} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}>{trigger ?? <Icon name="dots" />}</button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it) => <button key={it.label} role="menuitem" className={it.danger ? 'danger' : ''} onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); it.onClick(); }}>{it.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** A plain CodeMirror box for diagram code. External value changes replace the buffer only when they differ. */
export function CodeBox({ value, onChange, ariaLabel }: { value: string; onChange: (v: string) => void; ariaLabel?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(), history(), keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]), EditorView.lineWrapping,
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel ?? 'Code' }),
          EditorView.updateListener.of((u) => { if (u.docChanged && u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete') || t.isUserEvent('undo') || t.isUserEvent('redo') || t.isUserEvent('move'))) cb.current(u.state.doc.toString()); }),
        ],
      }),
    });
    view.current = v;
    return () => v.destroy();
  }, []);
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);
  return <div className="codebox" ref={host} onKeyDown={(e) => e.stopPropagation()} />;
}
