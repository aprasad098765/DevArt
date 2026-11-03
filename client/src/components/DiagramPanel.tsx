import { useMemo, useState } from 'react';
import * as Y from 'yjs';
import { diagramSize, renderDiagram } from '../../../shared/render.ts';
import { parseDiagram } from '../../../shared/dsl.ts';
import { addEdge, moveNode, relayout, removeEdge, removeNode, reverseEdge, setNodeProps, updateEdge, VISUAL_TYPES } from '../../../shared/dslEdit.ts';
import { ICON_NAMES } from '../../../shared/icons.ts';
import type { CanvasElement, DiagramSelection, DiagramType } from '../../../shared/types.ts';
import { toast } from '../api.ts';
import { CodeBox, Icon } from './ui.tsx';

const COLORS = ['blue', 'green', 'red', 'orange', 'purple', 'yellow', 'pink', 'teal', 'gray'];

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
            <div className="visual-form" key={node.id}>
              <label>Name<input aria-label="Component name" value={node.props.label ?? node.id} onChange={(e) => edit(setNodeProps(type, code, node.id, { label: e.target.value === node.id ? undefined : e.target.value }))} /></label>
              {!node.isGroup && <label>Description<textarea rows={2} aria-label="Component description" value={node.props.description ?? ''} onChange={(e) => edit(setNodeProps(type, code, node.id, { description: e.target.value || undefined }))} /></label>}
              <div className="row2">
                <label>Icon
                  <select aria-label="Component icon" value={node.props.icon ?? ''} onChange={(e) => edit(setNodeProps(type, code, node.id, { icon: e.target.value || undefined }))}>
                    <option value="">None</option>
                    {node.props.icon && !ICON_NAMES.includes(node.props.icon) && <option value={node.props.icon}>{node.props.icon}</option>}
                    {ICON_NAMES.map((i) => <option key={i} value={i}>{i}</option>)}
                  </select>
                </label>
                <label>Colour
                  <select aria-label="Component colour" value={node.props.color ?? ''} onChange={(e) => edit(setNodeProps(type, code, node.id, { color: e.target.value || undefined }))}>
                    <option value="">Default</option>
                    {node.props.color && !COLORS.includes(node.props.color) && <option value={node.props.color}>{node.props.color}</option>}
                    {COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
              {!node.isGroup && d.nodes.some((n) => n.isGroup) && (
                <label>Group
                  <select aria-label="Component group" value={node.parent ?? ''} onChange={(e) => {
                    const next = moveNode(type, code, node.id, e.target.value || undefined);
                    if (next === null) toast("Couldn't move this component to that group.", true);
                    else edit(next);
                  }}>
                    <option value="">None</option>
                    {d.nodes.filter((n) => n.isGroup).map((g) => <option key={g.id} value={g.id}>{g.props.label ?? g.id}</option>)}
                  </select>
                </label>
              )}
              <label>Connect to
                <select aria-label="Connect to" value="" onChange={(e) => { if (e.target.value) edit(addEdge(code, node.id, e.target.value)); }}>
                  <option value="">Choose…</option>
                  {d.nodes.filter((n) => n.id !== node.id).map((n) => <option key={n.id} value={n.id}>{n.props.label ?? n.id}</option>)}
                </select>
              </label>
              <button className="danger" onClick={() => {
                const next = relayout(el, removeNode(type, code, node.id));
                doc.getMap<CanvasElement>('elements').set(el.id, { ...el, ...next });
                onSelection(null);
              }}><Icon name="trash" size={14} /> Delete {node.isGroup ? 'group and contents' : 'component'}</button>
            </div>
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
      {codeOpen && <CodeBox value={code} onChange={(next) => applyDiagramChange(doc, el.id, { code: next })} ariaLabel="Diagram code" />}
      {issues.length > 0 && (
        <ul className="issues" aria-live="polite">
          {issues.map((i, k) => <li key={k} className={i.severity}><b>Line {i.line}</b> {i.message}</li>)}
        </ul>
      )}
    </aside>
  );
}
