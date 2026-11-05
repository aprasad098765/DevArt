import { Fragment } from 'react';
import type { AlignMode } from '../../../shared/align.ts';

const ICONS: Record<AlignMode | 'dist-x' | 'dist-y', string> = {
  left: 'M4 3v18M8 7h10v4H8zM8 13h6v4H8z',
  center: 'M12 3v18M6 7h12v4H6zM9 13h6v4H9z',
  right: 'M20 3v18M6 7h10v4H6zM10 13h6v4h-6z',
  top: 'M3 4h18M7 8h4v10H7zM13 8h4v6h-4z',
  middle: 'M3 12h18M7 6h4v12H7zM13 9h4v6h-4z',
  bottom: 'M3 20h18M7 6h4v10H7zM13 10h4v6h-4z',
  'dist-x': 'M4 4v16M20 4v16M10 8h4v8h-4z',
  'dist-y': 'M4 4h16M4 20h16M8 10h8v4H8z',
};
const ALIGN: [AlignMode, string][] = [['left', 'Align left'], ['center', 'Align center'], ['right', 'Align right'], ['top', 'Align top'], ['middle', 'Align middle'], ['bottom', 'Align bottom']];

const Glyph = ({ d }: { d: string }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

interface Props {
  /** Screen position of the selection's top centre, relative to the canvas. */
  left: number;
  top: number;
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: 'x' | 'y') => void;
}

/** Floating toolbar for lining up several selected components. */
export function AlignBar({ left, top, count, onAlign, onDistribute }: Props) {
  return (
    <div className="align-bar" role="toolbar" aria-label={`Arrange ${count} components`} style={{ left, top }} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {ALIGN.map(([mode, label], i) => (
        <Fragment key={mode}>
          {i === 3 && <span className="tool-sep" />}
          <button aria-label={label} title={label} onClick={() => onAlign(mode)}><Glyph d={ICONS[mode]} /></button>
        </Fragment>
      ))}
      <span className="tool-sep" />
      <button aria-label="Distribute horizontally" title={count < 3 ? 'Select 3 or more to distribute' : 'Distribute horizontally'} disabled={count < 3} onClick={() => onDistribute('x')}><Glyph d={ICONS['dist-x']} /></button>
      <button aria-label="Distribute vertically" title={count < 3 ? 'Select 3 or more to distribute' : 'Distribute vertically'} disabled={count < 3} onClick={() => onDistribute('y')}><Glyph d={ICONS['dist-y']} /></button>
    </div>
  );
}
