// The editor's Export menu: PNG, SVG, or PDF, at 1x to 3x, with or without a background.
import { useEffect, useRef, useState } from 'react';
import { download } from '../api.ts';
import { Icon } from './ui.tsx';
import type { Theme } from '../../../shared/types.ts';

const SCALES = [1, 2, 3] as const;
const FORMATS = [
  { format: 'png', label: 'PNG image' },
  { format: 'svg', label: 'SVG vector' },
  { format: 'pdf', label: 'PDF' },
] as const;

/** Builds the REST export URL; the server accepts the same `scale` and `transparent` query options. */
export function exportUrl(fileId: string, format: string, opts: { theme: Theme; scale?: number; transparent?: boolean; elementId?: string }) {
  const q = new URLSearchParams({ format, theme: opts.theme });
  if (opts.scale && format !== 'svg') q.set('scale', String(opts.scale));
  if (opts.transparent) q.set('transparent', '1');
  if (opts.elementId) q.set('elementId', opts.elementId);
  return `/api/v1/files/${fileId}/export?${q}`;
}

export function ExportMenu({ fileId, title, theme }: { fileId: string; title: string; theme: Theme }) {
  const [open, setOpen] = useState(false);
  const [scale, setScale] = useState<number>(2);
  const [transparent, setTransparent] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const run = (format: string) => {
    setOpen(false);
    const suffix = format !== 'svg' && scale !== 1 ? `@${scale}x` : '';
    download(exportUrl(fileId, format, { theme, scale, transparent }), `${title || 'devart'}${suffix}.${format}`);
  };

  return (
    <div className="menu" ref={ref}>
      <button aria-label="Export" aria-expanded={open} onClick={(e) => { e.preventDefault(); setOpen(!open); }}><Icon name="download" /> Export</button>
      {open && (
        <div className="menu-pop" role="menu" style={{ minWidth: 200 }}>
          <div role="group" aria-label="Scale" style={{ display: 'flex', gap: 4, padding: '4px 6px', alignItems: 'center' }}>
            <span className="muted small" style={{ marginRight: 'auto' }}>Scale</span>
            {SCALES.map((s) => (
              <button key={s} role="menuitemradio" aria-checked={scale === s} className={scale === s ? '' : 'ghost'}
                style={{ width: 'auto', padding: '3px 8px', fontWeight: scale === s ? 600 : undefined, textAlign: 'center' }}
                onClick={() => setScale(s)}>{s}x</button>
            ))}
          </div>
          <label className="small" style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px' }}>
            <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} /> Transparent background
          </label>
          <div style={{ borderTop: '1px solid var(--line)', margin: '4px 0' }} />
          {FORMATS.map((f) => <button key={f.format} role="menuitem" onClick={() => run(f.format)}>{f.label}</button>)}
        </div>
      )}
    </div>
  );
}
