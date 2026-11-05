import { useRef } from 'react';
import { unionBox, type Box } from '../../../shared/align.ts';

interface Props {
  /** Everything on the canvas, in canvas coordinates. `kind: 'part'` draws lighter, for parts inside a diagram. */
  rects: (Box & { kind?: 'element' | 'part' })[];
  view: { x: number; y: number; k: number };
  /** The canvas viewport size in screen pixels. */
  size: { w: number; h: number };
  /** Centres the view on a canvas point. */
  onPan: (x: number, y: number) => void;
}

const W = 200, H = 132, PAD = 8;

/** A small overview of the whole canvas with the visible area outlined. Click or drag in it to pan. */
export function Minimap({ rects, view, size, onPan }: Props) {
  const frozen = useRef<{ x: number; y: number; s: number } | null>(null);
  const viewport: Box = { x: -view.x / view.k, y: -view.y / view.k, w: size.w / view.k, h: size.h / view.k };
  const world = unionBox([...rects, viewport]) ?? viewport;
  const s0 = Math.min((W - PAD * 2) / (world.w || 1), (H - PAD * 2) / (world.h || 1));
  // Centre the content in the map.
  const live = { s: s0, x: world.x - ((W - world.w * s0) / 2) / s0, y: world.y - ((H - world.h * s0) / 2) / s0 };
  // While dragging, the mapping stays fixed, or the map would rescale under the pointer as the view moves.
  const m = frozen.current ?? live;
  const toMap = (b: Box) => ({ x: (b.x - m.x) * m.s, y: (b.y - m.y) * m.s, width: Math.max(1, b.w * m.s), height: Math.max(1, b.h * m.s) });
  const panTo = (e: React.PointerEvent, svg: SVGSVGElement) => {
    const r = svg.getBoundingClientRect();
    const f = frozen.current ?? live;
    onPan(f.x + (e.clientX - r.left) / f.s, f.y + (e.clientY - r.top) / f.s);
  };

  return (
    <div className="minimap" onPointerDown={(e) => e.stopPropagation()} aria-label="Minimap" role="group">
      <svg
        width={W} height={H} viewBox={`0 0 ${W} ${H}`}
        onPointerDown={(e) => {
          e.preventDefault();
          frozen.current = live;
          e.currentTarget.setPointerCapture(e.pointerId);
          panTo(e, e.currentTarget);
        }}
        onPointerMove={(e) => { if (frozen.current) panTo(e, e.currentTarget); }}
        onPointerUp={(e) => { frozen.current = null; e.currentTarget.releasePointerCapture(e.pointerId); }}
        onPointerCancel={() => { frozen.current = null; }}
      >
        {rects.map((b, i) => <rect key={i} className={b.kind === 'part' ? 'mm-part' : 'mm-el'} rx={1.5} {...toMap(b)} />)}
        <rect className="mm-view" {...toMap(viewport)} />
      </svg>
    </div>
  );
}
