import { useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { color, diagramSize, opacityOf, renderDiagram } from '../../../shared/render.ts';
import { parseDiagram, type GraphNode, type ParsedDiagram } from '../../../shared/dsl.ts';
import { toMermaid } from '../../../shared/mermaid.ts';
import { addEdge, DRAGGABLE_TYPES, moveNode, relayout, removeEdge, removeNode, reverseEdge, setNodeProps, updateEdge, VISUAL_TYPES, type PropValue } from '../../../shared/dslEdit.ts';
import { ICON_NAMES } from '../../../shared/icons.ts';
import { BORDER_STYLES, BORDER_WIDTHS, NODE_SHAPES, NODE_STYLE_PROPS, TEXT_ALIGNS, TEXT_VALIGNS } from '../../../shared/types.ts';
import type { CanvasElement, DiagramSelection, DiagramType } from '../../../shared/types.ts';
import { toast } from '../api.ts';
import { CodeBox, Icon } from './ui.tsx';
import { ColorSelect, Dropdown, Field, IconSelect, NumberField, OpacitySlider, Section, Segmented, Toggle, undoBoundary, undoStep, type SegOption } from './controls.tsx';

const COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'yellow', 'pink', 'teal', 'gray'];

const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** `oval` and `ellipse` draw the same shape, so the picker shows one swatch for both. */
const SHAPE_CHOICES = NODE_SHAPES.filter((s) => s !== 'ellipse');
export const BORDER_OPTIONS: SegOption<keyof typeof BORDER_WIDTHS>[] = (Object.keys(BORDER_WIDTHS) as (keyof typeof BORDER_WIDTHS)[]).map((k) => ({ value: k, label: cap(k) }));
const BORDER_STYLE_OPTIONS: SegOption<(typeof BORDER_STYLES)[number]>[] = BORDER_STYLES.map((s) => ({ value: s, label: cap(s) }));
export const ALIGN_OPTIONS: SegOption<(typeof TEXT_ALIGNS)[number]>[] = TEXT_ALIGNS.map((a) => ({ value: a, label: `Align ${a}`, icon: `align-${a}` }));
const VALIGN_OPTIONS: SegOption<(typeof TEXT_VALIGNS)[number]>[] = TEXT_VALIGNS.map((a) => ({ value: a, label: `Align ${a}`, icon: `valign-${a}` }));
const truthy = (v: string | undefined) => !!v && !/^(false|no|0|off)$/i.test(v);
const num = (v: string | undefined) => { const x = v === undefined || v.trim() === '' ? NaN : Number(v); return Number.isFinite(x) ? x : undefined; };
/** The border preset a node uses, or undefined for the default or a pixel width. */
export const borderPreset = (v: string | undefined) => (v && Object.hasOwn(BORDER_WIDTHS, v) ? v as keyof typeof BORDER_WIDTHS : undefined);

/** Saves a diagram change and refits its box, keeping any scale the user dragged to. */
export function applyDiagramChange(doc: Y.Doc, id: string, patch: Partial<CanvasElement>) {
  const yEls = doc.getMap<CanvasElement>('elements');
  const cur = yEls.get(id);
  if (!cur) return;
  const scale = cur.w / (diagramSize(cur).w || 1);
  const next = { ...cur, ...patch };
  const size = diagramSize(next);
  yEls.set(id, { ...next, w: size.w * scale, h: size.h * scale });
}

/** Saves an edit made in the visual editor, leaving the diagram's other parts where they are. */
export function applyVisualEdit(doc: Y.Doc, id: string, code: string, place?: { id: string; x: number; y: number }) {
  const yEls = doc.getMap<CanvasElement>('elements');
  const cur = yEls.get(id);
  if (cur) yEls.set(id, { ...cur, ...relayout(cur, code, place) });
}

interface Props {
  doc: Y.Doc;
  element: CanvasElement;
  canDelete: boolean;
  selection: DiagramSelection | null;
  onSelection: (s: DiagramSelection | null) => void;
}

export function DiagramPanel({ doc, element: el, canDelete, selection, onSelection }: Props) {
  const type: DiagramType = el.diagramType ?? 'architecture';
  const code = el.code ?? '';
  const visual = VISUAL_TYPES.includes(type);
  const [showCode, setShowCode] = useState(false);
  const d = useMemo(() => parseDiagram(type, code), [type, code]);
  const issues = useMemo(() => renderDiagram(type, code).issues, [type, code]);
  const hasErrors = issues.some((i) => i.severity === 'error');
  const editable = visual && !hasErrors;
  const codeOpen = showCode || !editable;

  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<'devart' | 'mermaid' | 'markdown'>('devart');
  const copyCode = async () => {
    try {
      const mermaid = () => toMermaid(type, code);
      const text = format === 'mermaid' ? mermaid() : format === 'markdown' ? `\`\`\`mermaid\n${mermaid()}\n\`\`\`` : code;
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast("Couldn't copy the code.", true);
    }
  };
  const edit = (next: string) => applyVisualEdit(doc, el.id, next);
  const sel = selection?.diagramId === el.id ? selection : null;
  const node = sel?.kind === 'node' ? d.nodes.find((n) => n.id === sel.id) : undefined;
  const edgeIndex = sel?.kind === 'edge' ? Number(sel.id) : -1;
  const edge = d.edges[edgeIndex];
  const nameOf = (id: string) => d.nodes.find((n) => n.id === id)?.props.label ?? id;
  const dashed = edge && (edge.props.style === 'dashed' || edge.op === '-->' || edge.op === '--');
  const heads = !edge ? 'one' : edge.op === '<>' ? 'both' : edge.op === '-' || edge.op === '--' ? 'none' : 'one';
  const setEdgeLook = (nextHeads: string, nextDashed: boolean) => {
    const { style: _style, ...props } = edge.props;
    edit(updateEdge(type, code, edgeIndex, {
      op: nextHeads === 'both' ? '<>' : nextHeads === 'none' ? '-' : '>',
      props: nextDashed ? { ...props, style: 'dashed' } : props,
    }));
  };

  return (
    <aside className="dpanel" aria-label="Properties" onKeyDown={(e) => e.stopPropagation()}>
      {canDelete && (
        <header>
          <input className="dpanel-title" aria-label="Diagram title" value={el.title ?? ''} onChange={(e) => applyDiagramChange(doc, el.id, { title: e.target.value })} />
          <button className="ghost" aria-label="Delete this diagram" title="Delete this diagram" onClick={() => { if (confirm(`Delete "${el.title ?? 'this diagram'}"?`)) { doc.getMap<CanvasElement>('elements').delete(el.id); onSelection(null); } }}><Icon name="trash" /></button>
        </header>
      )}

      {editable && (
        <div className="visual">
          {!node && !edge && (
            <p className="muted small">Select a component or connection to edit it.</p>
          )}

          {node && (
            <NodeForm key={node.id} doc={doc} el={el} type={type} code={code} d={d} node={node} edit={edit} onSelection={onSelection} />
          )}

          {edge && (
            <div className="visual-form" key={edgeIndex}>
              <p className="edge-ends">{nameOf(edge.from)} <Icon name="arrow-right" size={14} /> {nameOf(edge.to)}</p>
              <button onClick={() => edit(reverseEdge(type, code, edgeIndex))}><Icon name="swap" size={14} /> Reverse direction</button>
              <label>Label<input aria-label="Connection label" value={edge.label ?? ''} onChange={(e) => edit(updateEdge(type, code, edgeIndex, { label: e.target.value || undefined }))} /></label>
              <div className="row2">
                <label>Arrows
                  <select aria-label="Connection arrows" value={heads} onChange={(e) => setEdgeLook(e.target.value, !!dashed)}>
                    <option value="one">One way</option><option value="both">Both ways</option><option value="none">None</option>
                  </select>
                </label>
                <label>Line
                  <select aria-label="Connection line" value={dashed ? 'dashed' : 'solid'} onChange={(e) => setEdgeLook(heads, e.target.value === 'dashed')}>
                    <option value="solid">Solid</option><option value="dashed">Dashed</option>
                  </select>
                </label>
              </div>
              <button className="danger" onClick={() => { edit(removeEdge(type, code, edgeIndex)); onSelection(null); }}><Icon name="trash" size={14} /> Delete connection</button>
            </div>
          )}

          {!node && !edge && el.nodeOffsets && <button onClick={() => applyDiagramChange(doc, el.id, { nodeOffsets: undefined })}><Icon name="fit" size={14} /> Arrange automatically</button>}
        </div>
      )}

      <div className="dpanel-grow" />
      {editable && <button className="link code-toggle" aria-expanded={showCode} onClick={() => setShowCode(!showCode)}><Icon name="code" size={14} /> {showCode ? 'Hide code' : 'Edit as code'}</button>}
      <div className="copy-row">
        <select aria-label="Copy format" value={format} onChange={(e) => setFormat(e.target.value as typeof format)}>
          <option value="devart">DevArt code</option>
          <option value="mermaid">Mermaid</option>
          <option value="markdown">Markdown (Mermaid block)</option>
        </select>
        <button onClick={copyCode} disabled={!code || hasErrors && format !== 'devart'}><Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}</button>
      </div>
      {codeOpen && <CodeBox value={code} onChange={(next) => applyDiagramChange(doc, el.id, { code: next })} ariaLabel="Diagram code" />}
      {issues.length > 0 && (
        <ul className="issues" aria-live="polite">
          {issues.map((i, k) => <li key={k} className={i.severity}><b>Line {i.line}</b> {i.message}</li>)}
        </ul>
      )}
    </aside>
  );
}

interface NodeFormProps {
  doc: Y.Doc;
  el: CanvasElement;
  type: DiagramType;
  code: string;
  d: ParsedDiagram;
  node: GraphNode;
  edit: (next: string) => void;
  onSelection: (s: DiagramSelection | null) => void;
}

/** Content, style, text, layout and connections of one selected component or group. */
function NodeForm({ doc, el, type, code, d, node, edit, onSelection }: NodeFormProps) {
  const p = node.props;
  const set = (patch: Record<string, PropValue>) => edit(setNodeProps(type, code, node.id, patch));
  /** A style change, saved as one undo step of its own. */
  const style = (patch: Record<string, PropValue>) => undoStep(doc, () => set(patch));
  /**
   * A change that shows while a slider or colour picker is still being dragged. The whole drag is one undo step:
   * a boundary opens it on the first change, and `endLive` closes it when the control is released.
   */
  const dragging = useRef(false);
  const live = (patch: Record<string, PropValue>) => {
    if (!dragging.current) { dragging.current = true; undoBoundary(doc); }
    set(patch);
  };
  const endLive = () => { dragging.current = false; undoBoundary(doc); };
  const styled = NODE_STYLE_PROPS.some((k) => p[k] !== undefined);
  const groups = d.nodes.filter((n) => n.isGroup);
  const sizable = !node.isGroup && DRAGGABLE_TYPES.includes(type);
  const borderPx = p.border !== undefined && !borderPreset(p.border) ? num(p.border) : undefined;

  return (
    <div className="visual-form pform">
      <Section title="Content">
        <Field label="Name"><input aria-label="Component name" value={p.label ?? node.id} onChange={(e) => set({ label: e.target.value === node.id ? undefined : e.target.value })} /></Field>
        {!node.isGroup && <Field label="About"><textarea rows={2} aria-label="Component description" placeholder="Description" value={p.description ?? ''} onChange={(e) => set({ description: e.target.value || undefined })} /></Field>}
        <Field label="Icon">
          <Dropdown ariaLabel="Component icon" searchable value={p.icon ?? ''} onChange={(v) => style({ icon: v || undefined })}
            options={[{ value: '', label: 'None' }, ...(p.icon && !ICON_NAMES.includes(p.icon) ? [{ value: p.icon, label: p.icon }] : []), ...ICON_NAMES.map((i) => ({ value: i, label: i, icon: i }))]} />
        </Field>
        <Field label="Colour">
          <Dropdown ariaLabel="Component colour" value={p.color ?? ''} onChange={(v) => style({ color: v || undefined })}
            options={[{ value: '', label: 'Default' }, ...(p.color && !COLORS.includes(p.color) ? [{ value: p.color, label: p.color, swatch: color(p.color) }] : []), ...COLORS.map((c) => ({ value: c, label: cap(c), swatch: color(c) }))]} />
        </Field>
      </Section>

      <Section title="Style" actions={
        <button type="button" className="psec-action" disabled={!styled} title="Remove every style setting from this component" onClick={() => style(Object.fromEntries(NODE_STYLE_PROPS.map((k) => [k, undefined])))}>
          <Icon name="reset" size={12} /> Reset
        </button>
      }>
        {!node.isGroup && (
          <Field label="Shape">
            <IconSelect ariaLabel="Shape" icon={`shape-${p.shape === 'ellipse' ? 'oval' : p.shape ?? 'rect'}`} label={cap(p.shape === 'ellipse' ? 'oval' : p.shape ?? 'default')}>
              {(close) => (
                <div className="shape-grid" role="radiogroup" aria-label="Shape">
                  {SHAPE_CHOICES.map((s) => {
                    const on = p.shape === s || (s === 'oval' && p.shape === 'ellipse');
                    return (
                      <button key={s} type="button" role="radio" aria-checked={on} className={on ? 'on' : ''} title={on ? `${cap(s)} (click again for the default)` : cap(s)} aria-label={cap(s)}
                        onClick={() => { style({ shape: on ? undefined : s }); close(); }}>
                        <Icon name={`shape-${s}`} size={18} />
                      </button>
                    );
                  })}
                </div>
              )}
            </IconSelect>
          </Field>
        )}
        <Field label="Fill"><ColorSelect ariaLabel="Fill colour" allowNone value={p.fill} onChange={(v) => style({ fill: v })} onLive={(v) => live({ fill: v })} onEnd={endLive} /></Field>
        <Field label="Opacity"><OpacitySlider value={opacityOf(p.opacity)} onChange={(v) => style({ opacity: v })} onLive={(v) => live({ opacity: v })} onEnd={endLive} /></Field>
        <Field label="Border">
          <div className="prow">
            <Dropdown ariaLabel="Border width" value={borderPreset(p.border) ?? ''} onChange={(v) => style({ border: v || undefined })}
              options={[{ value: '', label: borderPx === undefined ? 'Default' : `${borderPx}px` }, ...BORDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))]} />
            <Dropdown ariaLabel="Border style" value={(BORDER_STYLES as readonly string[]).includes(p.borderStyle ?? '') ? p.borderStyle! : 'solid'} onChange={(v) => style({ borderStyle: v === 'solid' ? undefined : v })}
              options={BORDER_STYLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
          </div>
        </Field>
        <Field label="Outline"><ColorSelect ariaLabel="Border colour" value={p.borderColor} onChange={(v) => style({ borderColor: v })} onLive={(v) => live({ borderColor: v })} onEnd={endLive} /></Field>
        <Field label="Radius"><NumberField ariaLabel="Corner radius" min={0} max={320} placeholder={0} value={num(p.radius)} onChange={(v) => style({ radius: v })} /></Field>
      </Section>

      <Section title="Text">
        <Field label="Colour"><ColorSelect ariaLabel="Text colour" value={p.textColor} onChange={(v) => style({ textColor: v })} onLive={(v) => live({ textColor: v })} onEnd={endLive} /></Field>
        <Field label="Size">
          <div className="prow">
            <NumberField ariaLabel="Font size" min={6} max={72} placeholder={node.isGroup ? 12 : 13} value={num(p.fontSize)} onChange={(v) => style({ fontSize: v })} />
            <div className="ptoggles">
              <Toggle label="Bold" icon="bold" on={truthy(p.bold)} onChange={(on) => style({ bold: on })} />
              <Toggle label="Italic" icon="italic" on={truthy(p.italic)} onChange={(on) => style({ italic: on })} />
            </div>
          </div>
        </Field>
        {!node.isGroup && (
          <Field label="Align">
            <div className="prow">
              <Segmented ariaLabel="Horizontal text alignment" iconOnly options={ALIGN_OPTIONS} value={(TEXT_ALIGNS as readonly string[]).includes(p.align ?? '') ? p.align as (typeof TEXT_ALIGNS)[number] : 'center'}
                onChange={(v) => style({ align: v === 'center' ? undefined : v })} />
              <Segmented ariaLabel="Vertical text alignment" iconOnly options={VALIGN_OPTIONS} value={(TEXT_VALIGNS as readonly string[]).includes(p.valign ?? '') ? p.valign as (typeof TEXT_VALIGNS)[number] : 'middle'}
                onChange={(v) => style({ valign: v === 'middle' ? undefined : v })} />
            </div>
          </Field>
        )}
      </Section>

      {(sizable || (!node.isGroup && groups.length > 0)) && (
        <Section title="Layout" defaultOpen={false}>
          {!node.isGroup && groups.length > 0 && (
            <Field label="Group">
              <Dropdown ariaLabel="Component group" value={node.parent ?? ''} options={[{ value: '', label: 'None' }, ...groups.map((g) => ({ value: g.id, label: g.props.label ?? g.id, icon: g.props.icon }))]} onChange={(v) => {
                const next = moveNode(type, code, node.id, v || undefined);
                if (next === null) toast("Couldn't move this component to that group.", true);
                else undoStep(doc, () => edit(next));
              }} />
            </Field>
          )}
          {sizable && (
            <Field label="Size">
              <div className="prow">
                <NumberField ariaLabel="Width" stepper={false} min={48} max={640} step={4} placeholder={undefined} value={num(p.w)} onChange={(v) => style({ w: v })} />
                <NumberField ariaLabel="Height" stepper={false} min={48} max={640} step={4} placeholder={undefined} value={num(p.h)} onChange={(v) => style({ h: v })} />
              </div>
            </Field>
          )}
          {sizable && (p.w !== undefined || p.h !== undefined) && (
            <button type="button" className="psec-action" onClick={() => style({ w: undefined, h: undefined })}><Icon name="fit" size={12} /> Automatic size</button>
          )}
        </Section>
      )}

      <Section title="Connections" defaultOpen={false}>
        <Field label="Connect">
          <Dropdown ariaLabel="Connect to" searchable value="" placeholder="Choose…" options={d.nodes.filter((n) => n.id !== node.id).map((n) => ({ value: n.id, label: n.props.label ?? n.id, icon: n.props.icon }))}
            onChange={(to) => { if (to) undoStep(doc, () => edit(addEdge(code, node.id, to))); }} />
        </Field>
        <button className="danger" onClick={() => {
          undoStep(doc, () => {
            const next = relayout(el, removeNode(type, code, node.id));
            doc.getMap<CanvasElement>('elements').set(el.id, { ...el, ...next });
          });
          onSelection(null);
        }}><Icon name="trash" size={14} /> Delete {node.isGroup ? 'group and contents' : 'component'}</button>
      </Section>
    </div>
  );
}

