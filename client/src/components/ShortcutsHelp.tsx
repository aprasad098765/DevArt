import { useEffect, useRef } from 'react';
import { Icon } from './ui.tsx';

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';

/** The keyboard shortcuts cheat sheet, opened with `?` on the canvas. */
export function ShortcutsHelp({ shapes, onClose }: { shapes: { key: string; label: string }[]; onClose: () => void }) {
  const closeBtn = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeBtn.current?.focus(); }, []);
  const groups: [string, [string[], string][]][] = [
    ['Tools', [[['V'], 'Select'], [['M'], 'Move the view'], [['Space'], 'Hold to move the view'], [['C'], 'Connect components']]],
    ['Shapes', shapes.map((s) => [[s.key], `${s.label}, then click to place it`] as [string[], string])],
    ['Canvas', [
      [[MOD, 'Z'], 'Undo'], [[MOD, 'Shift', 'Z'], 'Redo'], [[MOD, '0'], 'Fit to content'], [['+'], 'Zoom in (also with ' + MOD + ')'], [['−'], 'Zoom out (also with ' + MOD + ')'],
    ]],
    ['Selection', [[['Delete'], 'Delete the selection'], [['Enter'], 'Rename or edit text'], [['Esc'], 'Cancel the tool, or clear the selection'], [['?'], 'Show this list']]],
  ];
  return (
    <div className="modal-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="modal shortcuts-help" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title"
        onKeyDown={(e) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); e.stopPropagation(); onClose(); } }}
      >
        <header>
          <h2 id="shortcuts-title"><Icon name="keyboard" /> Keyboard shortcuts</h2>
          <button ref={closeBtn} className="ghost" aria-label="Close" onClick={onClose}>✕</button>
        </header>
        <div className="shortcuts-grid">
          {groups.map(([title, rows]) => (
            <section key={title}>
              <h3>{title}</h3>
              <dl>
                {rows.map(([keys, what]) => (
                  <div key={what}>
                    <dt>{keys.map((k, i) => <span key={k}>{i > 0 && '+'}<kbd>{k}</kbd></span>)}</dt>
                    <dd>{what}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
