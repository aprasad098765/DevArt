import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { diagramSize, elementBounds, graphLayout, insideFrame, renderElement, resolveArrowPoints } from '../../../shared/render.ts';
import { addEdge, addNode, DRAGGABLE_TYPES, moveNode, relayout, removeEdge, removeNode, setNodeProps, VISUAL_TYPES, withOffsets } from '../../../shared/dslEdit.ts';
import { parseDiagram } from '../../../shared/dsl.ts';
import type { CanvasElement, DiagramSelection, DiagramType, Point, Theme } from '../../../shared/types.ts';
import { applyVisualEdit } from './DiagramPanel.tsx';
import { toast } from '../api.ts';
import { Icon } from './ui.tsx';

type Tool = 'select' | 'connect';
interface View { x: number; y: number; k: number }

const COMPONENTS: { name: string; icon: string }[] = [
  { name: 'Client', icon: 'laptop' }, { name: 'User', icon: 'user' }, { name: 'Service', icon: 'server' }, { name: 'API Gateway', icon: 'gateway' },
  { name: 'Load Balancer', icon: 'load-balancer' }, { name: 'Function', icon: 'function' }, { name: 'Container', icon: 'container' }, { name: 'Database', icon: 'database' },
  { name: 'Vector DB', icon: 'cluster' }, { name: 'Cache', icon: 'cache' }, { name: 'Queue', icon: 'queue' }, { name: 'Storage', icon: 'bucket' },
  { name: 'LLM', icon: 'cpu' }, { name: 'Cloud', icon: 'cloud' },
];
const GROUP = 'Group';
const DRAG_TYPE = 'application/x-devart-component';
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = typeof HANDLES[number];
const SNAP = 8;
const snapV = (v: number) => Math.round(v / SNAP) * SNAP;
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const TEXT_TYPES = ['shape', 'sticky', 'text', 'frame', 'arrow', 'code'];

/** Removes elements. Arrows keep their position when the shape they were attached to goes away. */
export function removeElements(doc: Y.Doc, ids: Iterable<string>) {
  const yEls = doc.getMap<CanvasElement>('elements');
  doc.transact(() => {
    const set = new Set(ids);
    for (const id of set) yEls.delete(id);
    for (const e of yEls.values()) {
      if (e.type === 'arrow' && ((e.startBind && set.has(e.startBind)) || (e.endBind && set.has(e.endBind)))) {
        yEls.set(e.id, { ...e, startBind: e.startBind && set.has(e.startBind) ? undefined : e.startBind, endBind: e.endBind && set.has(e.endBind) ? undefined : e.endBind });
      }
    }
  });
}

interface Props {
  doc: Y.Doc;
  theme: Theme;
  synced: boolean;
  selected: string | null;
  onSelect: (id: string | null) => void;
  diagramSelection: DiagramSelection | null;
  onDiagramSelection: (s: DiagramSelection | null) => void;
}

export function Canvas(p: Props) {
  const yEls = useMemo(() => p.doc.getMap<CanvasElement>('elements'), [p.doc]);
  const undo = useMemo(() => new Y.UndoManager(yEls), [yEls]);
  useEffect(() => () => undo.destroy(), [undo]);
  const [els, setEls] = useState<CanvasElement[]>(() => [...yEls.values()]);
  useEffect(() => {
    const on = () => setEls([...yEls.values()]);
    on();
    yEls.observe(on);
    return () => yEls.unobserve(on);
  }, [yEls]);
  const byId = useMemo(() => new Map(els.map((e) => [e.id, e])), [els]);
  const sorted = useMemo(() => [...els].sort((a, b) => a.z - b.z), [els]);

  const host = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ x: 80, y: 60, k: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [partBox, setPartBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [connecting, setConnecting] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const spaceDown = useRef(false);
  const fitted = useRef(false);

  // With one diagram on the canvas, the diagram is the canvas: only its parts are picked and moved.
  const onlyDiagram = els.length === 1 && els[0].type === 'diagram';

  const select = useCallback((ids: Iterable<string>) => {
    const s = new Set(ids);
    setSelection(s);
    p.onSelect(s.size === 1 ? [...s][0] : null);
  }, [p.onSelect]);

  const toWorld = useCallback((cx: number, cy: number): Point => {
    const r = host.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
  }, []);

  const fit = useCallback(() => {
    const b = elementBounds([...yEls.values()]);
    const r = host.current?.getBoundingClientRect();
    if (!b || !r || !r.width) return setView({ x: 80, y: 60, k: 1 });
    const k = Math.min(1.5, Math.max(0.1, Math.min((r.width - 120) / b.w, (r.height - 120) / b.h)));
    setView({ x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k, k });
  }, [yEls]);
  // Fit once when the file's content arrives. Later edits must never move the view under the pointer.
  useEffect(() => {
    if (fitted.current || !p.synced) return;
    fitted.current = true;
    if (yEls.size) fit();
  }, [p.synced, fit, yEls]);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const r = host.current!.getBoundingClientRect();
    setView((v) => {
      const k = Math.min(4, Math.max(0.1, v.k * factor));
      const ox = (cx ?? r.left + r.width / 2) - r.left, oy = (cy ?? r.top + r.height / 2) - r.top;
      return { k, x: ox - ((ox - v.x) / v.k) * k, y: oy - ((oy - v.y) / v.k) * k };
    });
  }, []);

  useEffect(() => {
    const el = host.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [zoomAt]);

  // ---- mutation helpers ----
  const update = (id: string, patch: Partial<CanvasElement>) => {
    const cur = yEls.get(id);
    if (cur) yEls.set(id, { ...cur, ...patch });
  };

  /** Everything that travels with a selection: grouped siblings and a figure's contents. */
  const withDependents = (ids: Iterable<string>) => {
    const out = new Set(ids);
    const all = [...yEls.values()];
    for (const id of [...out]) {
      const e = yEls.get(id);
      if (e?.groupId) all.filter((x) => x.groupId === e.groupId).forEach((x) => out.add(x.id));
    }
    for (const id of [...out]) {
      const e = yEls.get(id);
      if (e?.type === 'frame') all.filter((x) => insideFrame(x, e) && !x.locked).forEach((x) => out.add(x.id));
    }
    return out;
  };

  const center = (): Point => {
    const r = host.current!.getBoundingClientRect();
    return toWorld(r.left + r.width / 2, r.top + r.height / 2);
  };

  // ---- positions inside a diagram ----
  const scaleOf = (el: CanvasElement) => el.w / (diagramSize(el).w || 1) || 1;
  /** A part's box in canvas coordinates. */
  const boxesOf = (el: CanvasElement) => {
    const type = el.diagramType ?? 'architecture';
    const L = graphLayout(type, el.code ?? '', el.nodeOffsets);
    const scale = scaleOf(el);
    return new Map([...L.boxes].map(([id, b]) => [id, { x: el.x + b.x * scale, y: el.y + (b.y + L.titleY) * scale, w: b.w * scale, h: b.h * scale }]));
  };
  /** The innermost group under a point. */
  const groupAt = (el: CanvasElement, pt: Point, exclude?: string) => {
    const d = parseDiagram(el.diagramType ?? 'architecture', el.code ?? '');
    const boxes = boxesOf(el);
    let best: string | undefined, bestArea = Infinity;
    for (const n of d.nodes) {
      const b = n.isGroup && n.id !== exclude ? boxes.get(n.id) : undefined;
      if (b && pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h && b.w * b.h < bestArea) { best = n.id; bestArea = b.w * b.h; }
    }
    return best;
  };

  // ---- adding components ----
  const targetDiagram = () => {
    const chosen = p.selected ? yEls.get(p.selected) : undefined;
    const canHold = (e?: CanvasElement) => e?.type === 'diagram' && DRAGGABLE_TYPES.includes(e.diagramType ?? 'architecture');
    return canHold(chosen) ? chosen! : [...yEls.values()].find((e) => canHold(e));
  };
  /** The clear spot in view closest to the middle, so repeated clicks don't stack components or land out of sight. */
  const freeSpot = (el: CanvasElement | undefined): Point => {
    const c = center();
    const home = { x: snapV(c.x - 56), y: snapV(c.y - 40) };
    const r = host.current!.getBoundingClientRect();
    const a = toWorld(r.left + 16, r.top + 56), z = toWorld(r.right - 128, r.bottom - 96);
    const taken = el ? [...boxesOf(el).values()] : [];
    const clear = (s: Point) => !taken.some((b) => s.x < b.x + b.w + 16 && s.x + 112 > b.x - 16 && s.y < b.y + b.h + 16 && s.y + 80 > b.y - 16);
    const spots: Point[] = [];
    for (let i = -12; i <= 12; i++) for (let j = -12; j <= 12; j++) spots.push({ x: home.x + i * 64, y: home.y + j * 48 });
    const open = spots.filter((s) => s.x >= a.x && s.x <= z.x && s.y >= a.y && s.y <= z.y && clear(s));
    open.sort((p, q) => Math.hypot(p.x - home.x, p.y - home.y) - Math.hypot(q.x - home.x, q.y - home.y));
    return open[0] ?? home;
  };
  const addComponent = (name: string, at?: Point) => {
    const spec = COMPONENTS.find((c) => c.name === name);
    undo.stopCapturing();
    let added = '', diagramId = '';
    p.doc.transact(() => {
      const existing = targetDiagram();
      const spot = at ? { x: snapV(at.x), y: snapV(at.y) } : freeSpot(existing);
      const el = existing ?? (() => {
        const size = diagramSize({ diagramType: 'architecture', code: '' });
        const fresh: CanvasElement = { id: uid(), type: 'diagram', diagramType: 'architecture', code: '', title: 'Architecture', x: spot.x - 28, y: spot.y - 28, z: 1, ...size };
        yEls.set(fresh.id, fresh);
        return fresh;
      })();
      const type = el.diagramType ?? 'architecture';
      const parent = at ? groupAt(el, spot) : p.diagramSelection?.kind === 'node' && parseDiagram(type, el.code ?? '').nodes.find((n) => n.id === p.diagramSelection!.id && n.isGroup)?.id;
      const r = name === GROUP
        ? addNode(type, el.code ?? '', 'Group', { group: true, parent: parent || undefined })
        : addNode(type, el.code ?? '', spec?.name ?? name, { parent: parent || undefined, props: spec ? { icon: spec.icon } : {} });
      applyVisualEdit(p.doc, el.id, r.code, { id: r.id, ...spot });
      added = r.id;
      diagramId = el.id;
    });
    undo.stopCapturing();
    select([diagramId]);
    p.onDiagramSelection({ diagramId, kind: 'node', id: added });
    host.current?.focus({ preventScroll: true });
  };

  // ---- pointer handling ----
  const beginDrag = (e: React.PointerEvent, move: (ev: PointerEvent) => void, end?: (ev: PointerEvent) => void) => {
    undo.stopCapturing();
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      end?.(ev);
      undo.stopCapturing();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    e.preventDefault();
  };

  const startPan = (e: React.PointerEvent) => {
    const s = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    beginDrag(e, (ev) => setView((v) => ({ ...v, x: s.vx + ev.clientX - s.x, y: s.vy + ev.clientY - s.y })));
  };

  const clearSelection = () => { select([]); p.onDiagramSelection(null); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) commitEditing();
    (document.activeElement as HTMLElement | null)?.blur?.();
    host.current?.focus({ preventScroll: true });
    if (e.button === 1 || spaceDown.current) return startPan(e);
    if (e.button !== 0) return;
    const pt = toWorld(e.clientX, e.clientY);
    const target = e.target as Element;
    const id = target.closest('[data-id]')?.getAttribute('data-id') ?? null;
    const el = id ? yEls.get(id) : undefined;
    const nodeId = target.closest('[data-node]')?.getAttribute('data-node');
    const edgeId = target.closest('[data-edge]')?.getAttribute('data-edge');
    const visual = el?.type === 'diagram' && VISUAL_TYPES.includes(el.diagramType ?? 'architecture');

    if (tool === 'connect') {
      if (visual && nodeId) startConnect(e, el!.id, nodeId);
      else startPan(e);
      return;
    }
    if (visual && nodeId) {
      select([el!.id]);
      p.onDiagramSelection({ diagramId: el!.id, kind: 'node', id: nodeId });
      if (DRAGGABLE_TYPES.includes(el!.diagramType ?? 'architecture')) startNodeDrag(e, el!.id, nodeId, pt);
      return;
    }
    if (visual && edgeId != null) {
      select([el!.id]);
      p.onDiagramSelection({ diagramId: el!.id, kind: 'edge', id: edgeId });
      return;
    }
    p.onDiagramSelection(null);
    if (!el || (onlyDiagram && el.type === 'diagram')) {
      select([]);
      return startPan(e);
    }
    startElementDrag(e, el, pt);
  };

  /** Drags a node. Dropping it on a group moves it in; dropping it clear of its group moves it out. */
  const startNodeDrag = (e: React.PointerEvent, id: string, nodeId: string, start: Point) => {
    const el0 = yEls.get(id)!;
    const type = el0.diagramType ?? 'architecture';
    const scale = scaleOf(el0);
    const base = el0.nodeOffsets?.[nodeId] ?? { x: 0, y: 0 };
    const d0 = parseDiagram(type, el0.code ?? '');
    const node0 = d0.nodes.find((n) => n.id === nodeId);
    const boxes0 = boxesOf(el0);
    const parentBox = node0?.parent ? boxes0.get(node0.parent) : undefined;
    let moved = false;
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const cur = yEls.get(id);
      if (!cur) return;
      if (!moved && Math.hypot(q.x - start.x, q.y - start.y) < 3) return;
      moved = true;
      const offsets = { ...cur.nodeOffsets, [nodeId]: { x: base.x + snapV(q.x - start.x) / scale, y: base.y + snapV(q.y - start.y) / scale } };
      yEls.set(id, { ...cur, ...withOffsets(cur, cur.code ?? '', offsets) });
    }, (ev) => {
      if (!moved || !node0 || node0.isGroup) return;
      const cur = yEls.get(id);
      if (!cur) return;
      const q = toWorld(ev.clientX, ev.clientY);
      const inParent = parentBox && q.x >= parentBox.x && q.x <= parentBox.x + parentBox.w && q.y >= parentBox.y && q.y <= parentBox.y + parentBox.h;
      const under = groupAt(cur, q);
      const nextParent = inParent ? node0.parent : under === node0.parent ? undefined : under;
      if (nextParent === node0.parent) return;
      const next = moveNode(type, cur.code ?? '', nodeId, nextParent);
      if (next === null) toast("Couldn't move this component to that group.", true);
      else applyVisualEdit(p.doc, id, next);
    });
  };

  /** Moves a whole element: a diagram on a canvas holding several things, or a shape from an older file. */
  const startElementDrag = (e: React.PointerEvent, el: CanvasElement, start: Point) => {
    let nextSel = selection;
    if (e.shiftKey) {
      nextSel = new Set(selection);
      if (nextSel.has(el.id)) nextSel.delete(el.id); else nextSel.add(el.id);
      select(nextSel);
    } else if (!selection.has(el.id)) {
      nextSel = withDependents([el.id]);
      select(el.type === 'frame' ? [el.id] : nextSel);
    }
    if (el.locked) return;
    const moving = [...withDependents(nextSel)].map((k) => yEls.get(k)!).filter((k) => k && !k.locked);
    const orig = new Map(moving.map((k) => [k.id, { x: k.x, y: k.y }]));
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const lead = orig.get(el.id);
      const dx = q.x - start.x, dy = q.y - start.y;
      const sdx = lead ? snapV(lead.x + dx) - lead.x : dx, sdy = lead ? snapV(lead.y + dy) - lead.y : dy;
      p.doc.transact(() => {
        for (const k of moving) {
          const o = orig.get(k.id)!;
          const cur = yEls.get(k.id);
          if (cur) yEls.set(k.id, { ...cur, x: o.x + sdx, y: o.y + sdy });
        }
      });
    });
  };

  const startResize = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation();
    const originals = [...selection].map((id) => yEls.get(id)!).filter(Boolean);
    const box = elementBounds(originals, byId)!;
    const start = toWorld(e.clientX, e.clientY);
    const ratio = box.w / (box.h || 1);
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const dx = q.x - start.x, dy = q.y - start.y;
      let { x, y, w, h } = box;
      if (handle.includes('e')) w = Math.max(16, box.w + dx);
      if (handle.includes('s')) h = Math.max(16, box.h + dy);
      if (handle.includes('w')) { w = Math.max(16, box.w - dx); x = box.x + box.w - w; }
      if (handle.includes('n')) { h = Math.max(16, box.h - dy); y = box.y + box.h - h; }
      // Diagrams keep their proportions; Shift locks anything else.
      const keep = ev.shiftKey || originals.some((o) => ['diagram', 'image', 'icon'].includes(o.type));
      if (keep && handle.length === 2) {
        if (w / h > ratio) { w = h * ratio; if (handle.includes('w')) x = box.x + box.w - w; }
        else { h = w / ratio; if (handle.includes('n')) y = box.y + box.h - h; }
      }
      const sx = w / (box.w || 1), sy = h / (box.h || 1);
      p.doc.transact(() => {
        for (const o of originals) {
          const patch: Partial<CanvasElement> = { x: x + (o.x - box.x) * sx, y: y + (o.y - box.y) * sy, w: Math.max(4, o.w * sx), h: Math.max(4, o.h * sy) };
          if (o.points) patch.points = o.points.map((pt) => ({ x: pt.x * sx, y: pt.y * sy }));
          if (o.type === 'arrow') { patch.w = 0; patch.h = 0; }
          update(o.id, patch);
        }
      });
    });
  };

  /** Resizes a component from the corner of its outline. */
  const startNodeResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (sel?.kind !== 'node') return;
    const { diagramId, id: nodeId } = sel;
    const el0 = yEls.get(diagramId)!;
    const scale = scaleOf(el0);
    const b = boxesOf(el0).get(nodeId)!;
    const start = toWorld(e.clientX, e.clientY);
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const cur = yEls.get(diagramId);
      if (!cur) return;
      const w = snapV(Math.max(48, b.w / scale + (q.x - start.x) / scale)), h = snapV(Math.max(48, b.h / scale + (q.y - start.y) / scale));
      applyVisualEdit(p.doc, diagramId, setNodeProps(cur.diagramType ?? 'architecture', cur.code ?? '', nodeId, { w: String(w), h: String(h) }));
    });
  };

  /** Drags one end of an arrow, rebinding it to whatever shape it lands on. */
  const startArrowEnd = (e: React.PointerEvent, el: CanvasElement, end: 'start' | 'end') => {
    e.stopPropagation();
    const hitElement = (pt: Point, exclude?: string) => {
      for (let i = sorted.length - 1; i >= 0; i--) {
        const k = sorted[i];
        if (k.id === exclude || ['arrow', 'pen', 'frame'].includes(k.type)) continue;
        if (pt.x >= k.x && pt.x <= k.x + k.w && pt.y >= k.y && pt.y <= k.y + k.h) return k;
      }
      return undefined;
    };
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const cur = yEls.get(el.id);
      if (!cur) return;
      const pts = resolveArrowPoints({ ...cur, routing: 'straight' }, new Map([...yEls.entries()])).map((k) => ({ x: k.x - cur.x, y: k.y - cur.y }));
      if (end === 'start') pts[0] = { x: q.x - cur.x, y: q.y - cur.y };
      else pts[pts.length - 1] = { x: q.x - cur.x, y: q.y - cur.y };
      yEls.set(cur.id, { ...cur, points: pts, ...(end === 'start' ? { startBind: undefined } : { endBind: undefined }) });
    }, (ev) => {
      const hit = hitElement(toWorld(ev.clientX, ev.clientY), end === 'start' ? el.endBind : el.startBind);
      if (hit) update(el.id, end === 'start' ? { startBind: hit.id } : { endBind: hit.id });
    });
  };

  // ---- inline text editing ----
  const editEl = editing ? byId.get(editing) : undefined;
  const editBuf = useRef('');
  const commitEditing = () => {
    if (!editing) return;
    const el = yEls.get(editing);
    if (el) {
      if (el.type === 'frame') update(el.id, { title: editBuf.current });
      else if (el.type === 'text' && !editBuf.current.trim()) yEls.delete(el.id);
      else update(el.id, { text: editBuf.current });
    }
    setEditing(null);
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
    const el = id ? yEls.get(id) : undefined;
    if (!el) return;
    if (el.type === 'diagram' && sel?.diagramId === id && sel?.kind === 'node') { setRenaming(true); return; }
    if (TEXT_TYPES.includes(el.type)) { select([el.id]); setEditing(el.id); }
  };

  // ---- keyboard ----
  const removeSelected = () => {
    // Deleting the only diagram by accident would empty the file, so it needs a part selected.
    const ids = [...selection].filter((id) => !(onlyDiagram && yEls.get(id)?.type === 'diagram'));
    if (!ids.length) return;
    removeElements(p.doc, ids);
    select([]);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, .cm-editor')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') { spaceDown.current = true; e.preventDefault(); return; }
    if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo.redo(); else undo.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) deleteSelectedPart(); else removeSelected(); return; }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (sel) p.onDiagramSelection(null); else select([]); return; }
    if (sel?.kind === 'node' && e.key === 'Enter') { e.preventDefault(); setRenaming(true); return; }
    if (e.key === 'Enter' && selection.size === 1) { const id = [...selection][0]; if (TEXT_TYPES.includes(yEls.get(id)?.type ?? '')) { e.preventDefault(); setEditing(id); } return; }
    if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    if (!mod && e.key.toLowerCase() === 'c') setTool('connect');
  };
  useEffect(() => {
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') spaceDown.current = false; };
    window.addEventListener('keyup', up);
    return () => window.removeEventListener('keyup', up);
  }, []);

  // ---- parts of a diagram ----
  const sel = p.diagramSelection;
  const partElement = useCallback((s: DiagramSelection) => {
    const root = host.current?.querySelector(`[data-id="${CSS.escape(s.diagramId)}"]`);
    const attr = s.kind === 'node' ? 'data-node' : 'data-edge';
    return [...(root?.querySelectorAll(`[${attr}]`) ?? [])].find((n) => n.getAttribute(attr) === s.id);
  }, []);
  useLayoutEffect(() => {
    const target = sel && partElement(sel);
    if (!target) {
      setPartBox(null);
      // The part can vanish through undo, a code edit, or another window.
      if (sel) p.onDiagramSelection(null);
      return;
    }
    const r = target.getBoundingClientRect(), h = host.current!.getBoundingClientRect();
    setPartBox({ left: r.left - h.left, top: r.top - h.top, width: r.width, height: r.height });
  }, [sel, els, view, partElement]);

  const changeDiagramCode = (id: string, change: (type: DiagramType, code: string) => string) => {
    const el = yEls.get(id);
    if (!el) return;
    // Each visual edit is its own undo step, however quickly they follow one another.
    undo.stopCapturing();
    applyVisualEdit(p.doc, id, change(el.diagramType ?? 'architecture', el.code ?? ''));
    undo.stopCapturing();
  };
  const deleteSelectedPart = () => {
    if (!sel) return;
    if (sel.kind === 'edge') changeDiagramCode(sel.diagramId, (t, c) => removeEdge(t, c, Number(sel.id)));
    else changeDiagramCode(sel.diagramId, (t, c) => removeNode(t, c, sel.id));
    p.onDiagramSelection(null);
  };
  const currentLabel = () => {
    const el = sel && yEls.get(sel.diagramId);
    if (!el || !sel) return '';
    const n = parseDiagram(el.diagramType ?? 'architecture', el.code ?? '').nodes.find((k) => k.id === sel.id);
    return n?.props.label ?? n?.id ?? '';
  };
  const commitRename = (value: string) => {
    setRenaming(false);
    const label = value.trim();
    if (sel && label && label !== currentLabel()) changeDiagramCode(sel.diagramId, (t, c) => setNodeProps(t, c, sel.id, { label: label === sel.id ? undefined : label }));
  };
  /** Drags a new connection from a node to another node in the same diagram. */
  const startConnect = (e: React.PointerEvent, diagramId: string, from: string) => {
    e.stopPropagation();
    const h = host.current!.getBoundingClientRect();
    const x0 = e.clientX - h.left, y0 = e.clientY - h.top;
    setConnecting({ x0, y0, x1: x0, y1: y0 });
    beginDrag(e, (ev) => setConnecting({ x0, y0, x1: ev.clientX - h.left, y1: ev.clientY - h.top }), (ev) => {
      setConnecting(null);
      const under = document.elementFromPoint(ev.clientX, ev.clientY);
      const target = under?.closest('[data-node]')?.getAttribute('data-node');
      const sameDiagram = under?.closest('[data-id]')?.getAttribute('data-id') === diagramId;
      if (target && sameDiagram && target !== from) changeDiagramCode(diagramId, (_t, c) => addEdge(c, from, target));
    });
  };

  // ---- render ----
  const markup = useRef(new WeakMap<CanvasElement, { theme: Theme; html: string }>());
  const opts = useMemo(() => ({ theme: p.theme }), [p.theme]);
  const htmlFor = (e: CanvasElement) => {
    // Bound arrows depend on other elements, so only unbound ones are cacheable.
    if (e.type === 'arrow' && (e.startBind || e.endBind)) return renderElement(e, byId, opts);
    const hit = markup.current.get(e);
    if (hit && hit.theme === p.theme) return hit.html;
    const html = renderElement(e, byId, opts);
    markup.current.set(e, { theme: p.theme, html });
    return html;
  };

  const selEls = [...selection].map((id) => byId.get(id)).filter(Boolean) as CanvasElement[];
  const framed = onlyDiagram ? [] : selEls;
  const selBox = framed.length ? elementBounds(framed, byId) : null;
  const single = framed.length === 1 ? framed[0] : null;
  const handleSize = 9 / view.k;
  const pos = (h: Handle, b: { x: number; y: number; w: number; h: number }) => ({
    x: b.x + (h.includes('w') ? 0 : h.includes('e') ? b.w : b.w / 2),
    y: b.y + (h.includes('n') ? 0 : h.includes('s') ? b.h : b.h / 2),
  });
  const empty = els.every((e) => e.type === 'diagram' && !parseDiagram(e.diagramType ?? 'architecture', e.code ?? '').nodes.length);
  const partEl = sel ? byId.get(sel.diagramId) : undefined;
  const partType = partEl?.diagramType ?? 'architecture';
  const partNode = sel?.kind === 'node' && partEl ? parseDiagram(partType, partEl.code ?? '').nodes.find((n) => n.id === sel.id) : undefined;

  return (
    <div className="canvas-shell">
      <aside className="palette" aria-label="Components">
        <div className="tools" role="toolbar" aria-label="Canvas tools">
          <button className={tool === 'select' ? 'active' : ''} aria-pressed={tool === 'select'} title="Select and move (V)" onClick={() => setTool('select')}><Icon name="cursor" /> Select</button>
          <button className={tool === 'connect' ? 'active' : ''} aria-pressed={tool === 'connect'} title="Connect components (C)" onClick={() => setTool('connect')}><Icon name="arrow-right" /> Connect</button>
        </div>
        <h2>Components</h2>
        <div className="palette-grid">
          {COMPONENTS.map((c) => (
            <button key={c.name} draggable title={`Drag ${c.name} onto the canvas, or click to add it`} onClick={() => addComponent(c.name)} onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, c.name); e.dataTransfer.effectAllowed = 'copy'; }}>
              <Icon name={c.icon} size={20} /><span>{c.name}</span>
            </button>
          ))}
        </div>
        <button className="palette-group" draggable title="Drag a group onto the canvas, or click to add one" onClick={() => addComponent(GROUP)} onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, GROUP); e.dataTransfer.effectAllowed = 'copy'; }}>
          <Icon name="frame" size={18} /> Group
        </button>
      </aside>
      <div
        className={`canvas ${tool === 'connect' ? 'connect-mode' : ''}`}
        ref={host}
        tabIndex={0}
        aria-label="Canvas"
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
        onDragOver={(e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDrop={(e) => {
          const name = e.dataTransfer.getData(DRAG_TYPE);
          if (!name) return;
          e.preventDefault();
          const pt = toWorld(e.clientX, e.clientY);
          // The pointer is held by the component's middle, not its corner.
          addComponent(name, { x: pt.x - 48, y: pt.y - 38 });
        }}
      >
        <svg className="canvas-svg" width="100%" height="100%" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {sorted.map((e) => <g key={e.id} data-id={e.id} dangerouslySetInnerHTML={{ __html: htmlFor(e) }} />)}
            {selBox && <rect className="no-hit" x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h} fill="none" stroke="var(--accent)" strokeWidth={1.4 / view.k} strokeDasharray={framed.length > 1 ? `${5 / view.k} ${4 / view.k}` : undefined} />}
            {selBox && single?.type !== 'arrow' && !framed.some((e) => e.locked) && !sel && HANDLES.map((h) => {
              const q = pos(h, selBox);
              return <rect key={h} data-handle={h} x={q.x - handleSize / 2} y={q.y - handleSize / 2} width={handleSize} height={handleSize} rx={2 / view.k} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.3 / view.k} style={{ cursor: `${h}-resize` }} onPointerDown={(e) => startResize(e, h)} />;
            })}
            {single?.type === 'arrow' && (() => {
              const pts = resolveArrowPoints(single, byId);
              return (['start', 'end'] as const).map((end) => {
                const q = end === 'start' ? pts[0] : pts.at(-1)!;
                return <circle key={end} cx={q.x} cy={q.y} r={6 / view.k} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5 / view.k} style={{ cursor: 'move' }} onPointerDown={(e) => startArrowEnd(e, single, end)} />;
              });
            })()}
          </g>
        </svg>

        {partBox && (
          <div className="part-outline" style={partBox}>
            {sel?.kind === 'node' && !renaming && tool === 'select' && <div className="part-connect" role="button" aria-label="Drag to connect to another component" title="Drag to another component to connect" onPointerDown={(e) => { if (sel) startConnect(e, sel.diagramId, sel.id); }} />}
            {partNode && !partNode.isGroup && !renaming && tool === 'select' && DRAGGABLE_TYPES.includes(partType) && <div className="part-resize" role="button" aria-label="Drag to resize this component" title="Drag to resize" onPointerDown={startNodeResize} />}
          </div>
        )}
        {connecting && (
          <svg className="connect-line" width="100%" height="100%"><line x1={connecting.x0} y1={connecting.y0} x2={connecting.x1} y2={connecting.y1} stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" /></svg>
        )}
        {renaming && partBox && (
          <input
            className="part-rename" style={{ left: partBox.left, top: partBox.top + partBox.height / 2 - 15, width: Math.max(140, partBox.width) }}
            autoFocus aria-label="Component name" defaultValue={currentLabel()} onFocus={(e) => e.currentTarget.select()}
            onBlur={(e) => commitRename(e.currentTarget.value)}
            onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { commitRename(e.currentTarget.value); host.current?.focus(); }
              if (e.key === 'Escape') { setRenaming(false); host.current?.focus(); }
            }}
          />
        )}

        {editEl && (() => {
          const b = editEl.type === 'arrow' ? elementBounds([editEl], byId)! : editEl;
          const isFrame = editEl.type === 'frame';
          const style: React.CSSProperties = {
            left: b.x * view.k + view.x, top: (isFrame ? b.y - 28 : b.y) * view.k + view.y,
            width: Math.max(120, b.w * view.k), height: isFrame ? 28 : Math.max(32, b.h * view.k),
            fontSize: (isFrame ? 12 : editEl.fontSize ?? 15) * view.k, textAlign: editEl.type === 'code' || editEl.type === 'text' ? 'left' : 'center',
            fontFamily: editEl.type === 'code' ? 'var(--mono)' : undefined,
          };
          return (
            <textarea
              key={editEl.id} className="canvas-edit" style={style} autoFocus aria-label="Edit text" defaultValue={isFrame ? editEl.title ?? '' : editEl.text ?? ''}
              ref={(n) => { if (n) editBuf.current = n.value; }}
              onFocus={(e) => e.currentTarget.select()}
              onChange={(e) => { editBuf.current = e.target.value; }}
              onBlur={commitEditing}
              onPointerDown={(e) => e.stopPropagation()}
              onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey || isFrame))) { e.preventDefault(); commitEditing(); host.current?.focus(); }
              }}
            />
          );
        })()}

        <div className="zoombar" onPointerDown={(e) => e.stopPropagation()}>
          <button aria-label="Undo" title="Undo (Ctrl+Z)" onClick={() => undo.undo()}><Icon name="undo" /></button>
          <button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={() => undo.redo()}><Icon name="redo" /></button>
          <span className="tool-sep" />
          <button aria-label="Zoom out" title="Zoom out" onClick={() => zoomAt(1 / 1.2)}>−</button>
          <button className="zoom-val" title="Reset zoom" onClick={() => setView((v) => ({ ...v, k: 1 }))}>{Math.round(view.k * 100)}%</button>
          <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
          <button aria-label="Fit to content" title="Fit (Ctrl+0)" onClick={fit}><Icon name="fit" /></button>
        </div>

        {tool === 'connect' && <div className="mode-hint" role="status">Drag from one component to another. Press <kbd>Esc</kbd> when you're done.</div>}
        {empty && (
          <div className="canvas-empty">
            <b>Drag a component here to start</b>
            <span className="muted">Then use Connect to draw arrows between components.</span>
          </div>
        )}
      </div>
    </div>
  );
}
