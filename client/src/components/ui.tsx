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
  'arrow-right': 'M4 12h16M14 6l6 6-6 6', 'draw-line': 'M5 19L19 5', 'draw-arrow': 'M5 19L19 5M10 5h9v9', swap: 'M4 8h15M15 4l4 4-4 4M20 16H5M9 12l-4 4 4 4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  // Outline icons for the Shapes palette.
  'shape-rect': 'M4 6h16v12H4z', 'shape-rounded': 'M8 6h8a4 4 0 0 1 4 4v4a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-4a4 4 0 0 1 4-4z',
  'shape-circle': 'M12 4a8 8 0 1 0 0 16 8 8 0 1 0 0-16z', 'shape-diamond': 'M12 3l9 9-9 9-9-9z', 'shape-hexagon': 'M7 5h10l5 7-5 7H7l-5-7z',
  'shape-cylinder': 'M5 6c0-1.700 3.100-3 7-3s7 1.300 7 3-3.100 3-7 3-7-1.300-7-3zM5 6v12c0 1.700 3.100 3 7 3s7-1.300 7-3V6',
  'shape-parallelogram': 'M8 6h13l-5 12H3z', 'shape-triangle': 'M12 4l9 16H3z', 'shape-document': 'M4 4h16v13c-4-2-4 3-8 2s-4-4-8-2z',
  'shape-cloud': 'M7 18a4 4 0 0 1-.500-8A6 6 0 0 1 18 9a4.500 4.500 0 0 1-.500 9z',
  // Properties panel and style toolbar.
  'shape-oval': 'M12 6c5 0 9 2.700 9 6s-4 6-9 6-9-2.700-9-6 4-6 9-6z',
  'chevron-down': 'M6 9l6 6 6-6', minus: 'M5 12h14', close: 'M6 6l12 12M18 6L6 18', plus: 'M12 5v14M5 12h14',
  bold: 'M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z', italic: 'M10 4h8M6 20h8M14 4l-4 16',
  'align-left': 'M4 6h16M4 10h10M4 14h16M4 18h10', 'align-center': 'M4 6h16M7 10h10M4 14h16M7 18h10', 'align-right': 'M4 6h16M10 10h10M4 14h16M10 18h10',
  'valign-top': 'M4 4h16M9 8h6v12H9z', 'valign-middle': 'M4 12h5M15 12h5M9 6h6v12H9z', 'valign-bottom': 'M4 20h16M9 4h6v12H9z',
  reset: 'M4 12a8 8 0 1 0 2.300-5.700M4 4v4h4', droplet: 'M12 3s6 6.500 6 11a6 6 0 0 1-12 0c0-4.500 6-11 6-11z',
  'border-width': 'M4 6h16M4 11.500h16M4 11.500h16M4 17h16M4 18h16', 'font-size': 'M4 19l5-14 5 14M6 14h6M16 19l2.500-7 2.500 7M16.800 17h3.400',
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
