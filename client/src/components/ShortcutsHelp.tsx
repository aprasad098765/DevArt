import { useEffect, useRef, useState } from 'react';
import { Icon } from './ui.tsx';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = MAC ? '⌘' : 'Ctrl';
const ALT = MAC ? '⌥' : 'Alt';
const SHIFT = MAC ? '⇧' : 'Shift';

type Row = [keys: string[], what: string];

/** The keyboard shortcuts cheat sheet, opened with `?` on the canvas. Type to filter it. */
export function ShortcutsHelp({ shapes, onClose }: { shapes: { key: string; label: string }[]; onClose: () => void }) {
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  useEffect(() => { search.current?.focus(); }, []);
  const groups: [string, string, Row[]][] = [
    ['Tools', 'cursor', [[['V'], 'Select'], [['M'], 'Move the view'], [['Space'], 'Hold to move the view'], [['C'], 'Connect components'], [['/'], 'Open the Insert menu']]],
    ['Shapes', 'shape-hexagon', [...shapes.map((s) => [[s.key], `${s.label}, then click to place`] as Row), [['L'], 'Line, then drag to draw'] as Row, [['A'], 'Arrow, then drag to draw'] as Row]],
    ['View', 'fit', [
      [['+'], 'Zoom in'], [['−'], 'Zoom out'], [[SHIFT, '1'], 'Zoom to fit'], [[SHIFT, '2'], 'Zoom to selection'],
      [[MOD, ALT, '0'], 'Zoom to 100%'], [[MOD, '\\'], 'Hide or show the interface'],
    ]],
    ['Edit', 'pen', [
      [[MOD, 'Z'], 'Undo'], [[MOD, SHIFT, 'Z'], 'Redo'], [[MOD, 'D'], 'Duplicate'], [['Enter'], 'Rename or edit text'], [['Delete'], 'Delete the selection'],
    ]],
    ['Selection', 'frame', [
      [[SHIFT, 'Click'], 'Add or remove from the selection'], [['↑', '↓', '←', '→'], 'Nudge the selection'], [[SHIFT, '↑↓←→'], 'Nudge further'],
      [[ALT, 'Drag'], 'Move without snapping'], [['Esc'], 'Cancel the tool, or clear the selection'],
    ]],
  ];
  const q = query.trim().toLowerCase();
  const shown = groups
    .map(([title, icon, rows]) => [title, icon, rows.filter(([keys, what]) => !q || what.toLowerCase().includes(q) || keys.join(' ').toLowerCase().includes(q) || title.toLowerCase().includes(q))] as const)
    .filter(([, , rows]) => rows.length);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal shortcuts-help" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"
        onKeyDown={(e) => { if (e.key === 'Escape' || (e.key === '?' && (e.target as HTMLElement).tagName !== 'INPUT')) { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      >
        <header>
          <h2 id="shortcuts-title"><Icon name="keyboard" /> Keyboard shortcuts</h2>
          <button className="ghost" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
        </header>
        <div className="sc-search">
          <Icon name="search" size={15} />
          <input ref={search} type="search" placeholder="Search shortcuts" aria-label="Search shortcuts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="sc-body">
          {shown.map(([title, icon, rows]) => (
            <section key={title} className="sc-card">
              <h3><Icon name={icon} size={14} />{title}</h3>
              <dl>
                {rows.map(([keys, what]) => (
                  <div key={what}>
                    <dd>{what}</dd>
                    <dt>{keys.map((k, i) => <kbd key={i}>{k}</kbd>)}</dt>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          {!shown.length && <p className="muted sc-empty">No shortcuts match "{query}".</p>}
        </div>
        <footer className="sc-foot muted small"><span>Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span></footer>
      </div>
    </div>
  );
}
