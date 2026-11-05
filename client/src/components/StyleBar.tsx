import { useEffect, useRef, useState } from 'react';
import type { Props } from '../../../shared/dsl.ts';
import type { PropValue } from '../../../shared/dslEdit.ts';
import { color } from '../../../shared/render.ts';
import { BORDER_WIDTHS, TEXT_ALIGNS } from '../../../shared/types.ts';
import { ColorField, NumberField, Toggle } from './controls.tsx';
import { Icon } from './ui.tsx';

const truthy = (v: string | undefined) => !!v && !/^(false|no|0|off)$/i.test(v);
const BAR_H = 38;

interface StyleBarProps {
  /** The selected component's outline, in pixels within the canvas. */
  box: { left: number; top: number; width: number; height: number };
  props: Props;
  isGroup?: boolean;
  /** Called once per edit; each call should be one undo step. */
  onChange: (patch: Record<string, PropValue>) => void;
}

/** Quick style controls floating just above a selected diagram component. */
export function StyleBar({ box, props: p, isGroup, onChange }: StyleBarProps) {
  const [open, setOpen] = useState<'fill' | 'border' | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  const below = box.top < BAR_H + 14;
  const style = { left: box.left + box.width / 2, top: below ? box.top + box.height + 10 : box.top - BAR_H - 10 };
  const fill = p.fill?.toLowerCase();
  const noFill = !!fill && /^(none|transparent)$/.test(fill);
  const align = (TEXT_ALIGNS as readonly string[]).includes(p.align ?? '') ? p.align : 'center';
  const fontSize = Number(p.fontSize);

  return (
    <div ref={ref} className={`style-bar ${below ? 'below' : ''}`} style={style} role="toolbar" aria-label="Component style"
      onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') setOpen(null); }}>
      <div className="sb-pop-wrap">
        <button type="button" className={open === 'fill' ? 'on' : ''} aria-label="Fill colour" title="Fill colour" aria-expanded={open === 'fill'} onClick={() => setOpen(open === 'fill' ? null : 'fill')}>
          <span className={`sb-swatch ${noFill ? 'none' : ''} ${!fill ? 'default' : ''}`} style={!noFill && fill ? { background: color(fill) } : undefined} />
        </button>
        {open === 'fill' && <div className="sb-pop"><ColorField compact allowNone ariaLabel="Fill colour" value={p.fill} onChange={(v) => onChange({ fill: v })} /></div>}
      </div>
      {!isGroup && (
        <div className="sb-pop-wrap">
          <button type="button" className={open === 'border' ? 'on' : ''} aria-label="Border width" title="Border width" aria-expanded={open === 'border'} onClick={() => setOpen(open === 'border' ? null : 'border')}>
            <Icon name="border-width" size={15} />
          </button>
          {open === 'border' && (
            <div className="sb-pop sb-menu" role="menu">
              {(Object.keys(BORDER_WIDTHS) as (keyof typeof BORDER_WIDTHS)[]).map((k) => (
                <button key={k} type="button" role="menuitemradio" aria-checked={p.border === k} className={p.border === k ? 'on' : ''} onClick={() => { onChange({ border: p.border === k ? undefined : k }); setOpen(null); }}>
                  <span className="sb-line" style={{ borderTopWidth: Math.max(BORDER_WIDTHS[k], 0), borderTopStyle: k === 'none' ? 'dotted' : 'solid', opacity: k === 'none' ? 0.4 : 1 }} />
                  {k[0].toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <span className="sb-sep" />
      <NumberField ariaLabel="Font size" min={6} max={72} placeholder={isGroup ? 12 : 13} value={Number.isFinite(fontSize) && p.fontSize ? fontSize : undefined} onChange={(v) => onChange({ fontSize: v })} />
      <span className="sb-sep" />
      {!isGroup && TEXT_ALIGNS.map((a) => (
        <button key={a} type="button" className={align === a ? 'on' : ''} aria-pressed={align === a} aria-label={`Align ${a}`} title={`Align ${a}`} onClick={() => onChange({ align: a === 'center' ? undefined : a })}>
          <Icon name={`align-${a}`} size={15} />
        </button>
      ))}
      <Toggle label="Bold" icon="bold" on={truthy(p.bold)} onChange={(on) => onChange({ bold: on })} />
    </div>
  );
}
