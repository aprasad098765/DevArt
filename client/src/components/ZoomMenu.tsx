import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Shortcut text for this platform: `Mod` becomes ⌘ or Ctrl, `Alt` becomes ⌥ on a Mac. */
export const keyLabel = (s: string) => (MAC
  ? s.replace(/Mod\+/g, '⌘').replace(/Alt\+/g, '⌥').replace(/Shift\+/g, '⇧')
  : s.replace(/Mod\+/g, 'Ctrl+'));

interface Props {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onHand: () => void;
  handActive: boolean;
  onFit: () => void;
  onZoomSelection: () => void;
  canZoomSelection: boolean;
  onZoom100: () => void;
  minimap: boolean;
  onToggleMinimap: () => void;
  onHideUi?: () => void;
}

/** The zoom percentage in the zoom bar, which opens a menu of view controls. */
export function ZoomMenu(p: Props) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    // Capture phase: the zoom bar stops pointerdown from bubbling to the canvas.
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); trigger.current?.focus(); } };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true); };
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    setUp(r.top > window.innerHeight / 2);
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]')?.focus({ preventScroll: true });
  }, [open]);

  // Focus goes back to the canvas, so its shortcuts keep working after a pick.
  const run = (fn: () => void) => () => { setOpen(false); fn(); trigger.current?.closest<HTMLElement>('.canvas')?.focus({ preventScroll: true }); };
  const item = (label: string, keys: string, onClick: () => void, opts: { disabled?: boolean; checked?: boolean } = {}) => (
    <button
      role={opts.checked === undefined ? 'menuitem' : 'menuitemcheckbox'} aria-checked={opts.checked} disabled={opts.disabled}
      className={opts.checked ? 'checked' : ''} onClick={run(onClick)}
    >
      <span className="zm-check" aria-hidden="true">{opts.checked ? '✓' : ''}</span>
      <span className="zm-label">{label}</span>
      {keys && <kbd>{keyLabel(keys)}</kbd>}
    </button>
  );
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const list = [...(ref.current?.querySelectorAll<HTMLButtonElement>('.zoom-menu button:not([disabled])') ?? [])];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus();
  };

  return (
    <div className="zoom-menu-wrap" ref={ref}>
      <button ref={trigger} className="zoom-val" aria-haspopup="menu" aria-expanded={open} title="Zoom and view options" onClick={() => setOpen(!open)}>
        {Math.round(p.zoom * 100)}% <span aria-hidden="true" className="zm-caret">▾</span>
      </button>
      {open && (
        // Keys pressed in the menu must not reach the canvas shortcuts.
        <div className={`zoom-menu ${up ? 'up' : ''}`} role="menu" aria-label="Zoom" onKeyDown={(e) => { onMenuKey(e); e.stopPropagation(); }}>
          <div className="zm-stepper">
            <button aria-label="Zoom out" title={`Zoom out (${keyLabel('Mod+-')})`} onClick={p.onZoomOut}>−</button>
            <span>{Math.round(p.zoom * 100)}%</span>
            <button aria-label="Zoom in" title={`Zoom in (${keyLabel('Mod+=')})`} onClick={p.onZoomIn}>+</button>
          </div>
          <hr />
          {item('Hand tool', 'Space', p.onHand, { checked: p.handActive })}
          <hr />
          {item('Zoom to fit', 'Shift+1', p.onFit)}
          {item('Zoom to selection', 'Shift+2', p.onZoomSelection, { disabled: !p.canZoomSelection })}
          {item('Zoom to 100%', 'Mod+Alt+0', p.onZoom100)}
          <hr />
          {item('Minimap', '', p.onToggleMinimap, { checked: p.minimap })}
          {p.onHideUi && item('Hide UI', 'Mod+\\', p.onHideUi)}
        </div>
      )}
    </div>
  );
}
