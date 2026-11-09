import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { diagramSize, elementBounds, graphLayout, insideFrame, renderElement, resolveArrowPoints } from '../../../shared/render.ts';
import { addEdge, addNode, DRAGGABLE_TYPES, moveNode, relayout, removeEdge, removeNode, setNodeProps, VISUAL_TYPES, withOffsets } from '../../../shared/dslEdit.ts';
import { parseDiagram } from '../../../shared/dsl.ts';
import type { CanvasElement, DiagramSelection, DiagramType, Point, Theme } from '../../../shared/types.ts';
import { applyVisualEdit } from './DiagramPanel.tsx';
import { toast } from '../api.ts';
import { Icon } from './ui.tsx';
import { ZoomMenu } from './ZoomMenu.tsx';
import { Minimap } from './Minimap.tsx';
import { AlignBar } from './AlignBar.tsx';
import { alignDeltas, distributeDeltas, guidesFor, snapToGuides, unionBox, type AlignMode, type Box, type Guide } from '../../../shared/align.ts';
import { ShortcutsHelp } from './ShortcutsHelp.tsx';
import { StyleBar } from './StyleBar.tsx';
import { registerUndo } from './controls.tsx';

/** 'shape' means a shape is armed: the next click on the canvas places it. */
type Tool = 'select' | 'move' | 'connect' | 'shape' | 'line' | 'arrow';
interface View { x: number; y: number; k: number }

const COMPONENTS: { name: string; icon: string }[] = [
  { name: 'Client', icon: 'laptop' }, { name: 'User', icon: 'user' }, { name: 'Service', icon: 'server' }, { name: 'API Gateway', icon: 'gateway' },
  { name: 'Load Balancer', icon: 'load-balancer' }, { name: 'Function', icon: 'function' }, { name: 'Container', icon: 'container' }, { name: 'Database', icon: 'database' },
  { name: 'Vector DB', icon: 'cluster' }, { name: 'Cache', icon: 'cache' }, { name: 'Queue', icon: 'queue' }, { name: 'Storage', icon: 'bucket' },
  { name: 'LLM', icon: 'cpu' }, { name: 'Cloud', icon: 'cloud' },
];
const GROUP = 'Group';
const CATEGORIES: [string, string[]][] = [
  ['Clients', ['Client', 'User']],
  ['Compute', ['Service', 'API Gateway', 'Load Balancer', 'Function', 'Container', 'LLM']],
  ['Data', ['Database', 'Vector DB', 'Cache', 'Storage']],
  ['Messaging & network', ['Queue', 'Cloud']],
];
type ShapeName = 'rect' | 'rounded' | 'circle' | 'diamond' | 'hexagon' | 'cylinder' | 'parallelogram' | 'triangle' | 'document' | 'cloud';
interface ShapeSpec { shape: ShapeName; label: string; key?: string }
const SHAPES: ShapeSpec[] = [
  { shape: 'rect', label: 'Rectangle', key: 'R' }, { shape: 'rounded', label: 'Rounded' }, { shape: 'circle', label: 'Circle', key: 'O' },
  { shape: 'diamond', label: 'Diamond', key: 'D' }, { shape: 'hexagon', label: 'Hexagon', key: 'H' }, { shape: 'cylinder', label: 'Cylinder', key: 'Y' },
  { shape: 'parallelogram', label: 'Parallelogram' }, { shape: 'triangle', label: 'Triangle' }, { shape: 'document', label: 'Document' }, { shape: 'cloud', label: 'Cloud' },
];
/** Shapes travel through drag-and-drop and addComponent as `shape:<name>`, next to component names. */
const SHAPE_PREFIX = 'shape:';
/** Free-standing lines and arrows are drawn by dragging, or dropped from the Insert menu as `line:<kind>`. */
type LineKind = 'line' | 'arrow';
const LINES: { kind: LineKind; label: string; key: string }[] = [{ kind: 'line', label: 'Line', key: 'L' }, { kind: 'arrow', label: 'Arrow', key: 'A' }];
const LINE_PREFIX = 'line:';
const shapeOf = (name: string) => (name.startsWith(SHAPE_PREFIX) ? SHAPES.find((s) => s.shape === name.slice(SHAPE_PREFIX.length)) : undefined);
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
  /** Hide UI: the tool rail, library, zoom bar and minimap step aside for a clean view. */
  uiHidden?: boolean;
  onToggleUi?: () => void;
}

export function Canvas(p: Props) {
  const yEls = useMemo(() => p.doc.getMap<CanvasElement>('elements'), [p.doc]);
  const undo = useMemo(() => new Y.UndoManager(yEls), [yEls]);
  useEffect(() => () => undo.destroy(), [undo]);
  // Lets the properties panel make each style edit its own undo step.
  useEffect(() => registerUndo(p.doc, undo), [p.doc, undo]);
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
  const [spaceHeld, setSpaceHeld] = useState(false);
  // Holding Space switches to the Move tool until it is released.
  const activeTool: Tool = spaceHeld ? 'move' : tool;
  const [armed, setArmed] = useState<ShapeName | null>(null);
  const armedShape = activeTool === 'shape' ? SHAPES.find((s) => s.shape === armed) : undefined;
  // The Insert popover opens over the canvas, and closes again after an item is picked or dragged out.
  const [insertOpen, setInsertOpen] = useState(false);
  const [insertView, setInsertView] = useState<'root' | 'components' | 'shapes'>('root');
  const [insertQuery, setInsertQuery] = useState('');
  const [insertDrag, setInsertDrag] = useState(false);
  const closeInsert = () => { setInsertOpen(false); setInsertView('root'); setInsertQuery(''); setInsertDrag(false); };
  const toggleInsert = () => { if (insertOpen) closeInsert(); else setInsertOpen(true); };
  useEffect(() => {
    if (!insertOpen) return;
    const away = (e: PointerEvent) => { if (!(e.target as Element).closest('.insert-pop, .insert-toggle')) closeInsert(); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [insertOpen]);
  const q = insertQuery.trim().toLowerCase();
  const insertComponents = COMPONENTS.filter((c) => !q || c.name.toLowerCase().includes(q));
  const insertShapes = SHAPES.filter((x) => !q || x.label.toLowerCase().includes(q));
  const insertGroup = !q || 'group'.includes(q);
  const armShape = (s: ShapeName) => { setArmed(s); setTool('shape'); };
  const lineTool = activeTool === 'line' || activeTool === 'arrow' ? LINES.find((l) => l.kind === activeTool) : undefined;
  /** Adds a free-standing line or arrow from `from` to `to`, in front of everything else. */
  const makeLine = (kind: LineKind, from: Point, to: Point) => {
    const z = Math.max(0, ...[...yEls.values()].map((e) => e.z)) + 1;
    const el: CanvasElement = { id: uid(), type: 'arrow', x: from.x, y: from.y, w: 0, h: 0, z, points: [{ x: 0, y: 0 }, { x: to.x - from.x, y: to.y - from.y }], routing: 'straight', startHead: false, endHead: kind === 'arrow', strokeWidth: 2 };
    yEls.set(el.id, el);
    return el;
  };
  const [helpOpen, setHelpOpen] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [partBox, setPartBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [panning, setPanning] = useState(false);
  const [connecting, setConnecting] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const spaceDown = useRef(false);
  const fitted = useRef(false);
  // ---- view and arrangement extras: minimap, smart guides, several selected nodes ----
  const [minimap, setMinimap] = useState(false);
  const [guides, setGuides] = useState<Guide[]>([]);
  /** Nodes selected alongside the primary diagram selection, with Shift+click. Always includes the primary node. */
  const [multi, setMulti] = useState<{ diagramId: string; ids: string[] } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
  /** Zooms around the middle of the view to an exact scale. */
  const zoomTo = useCallback((k: number) => zoomAt(k / viewRef.current.k), [zoomAt]);
  /** Fits a canvas box in the view, with a margin, never zooming in past 200%. */
  const zoomToBox = useCallback((b: Box) => {
    const r = host.current?.getBoundingClientRect();
    if (!r || !r.width) return;
    const k = Math.min(2, Math.max(0.1, Math.min((r.width - 160) / (b.w || 1), (r.height - 160) / (b.h || 1))));
    setView({ x: (r.width - b.w * k) / 2 - b.x * k, y: (r.height - b.h * k) / 2 - b.y * k, k });
  }, []);
  /** Puts a canvas point in the middle of the view. */
  const centerOn = useCallback((x: number, y: number) => {
    const r = host.current?.getBoundingClientRect();
    if (r) setView((v) => ({ ...v, x: r.width / 2 - x * v.k, y: r.height / 2 - y * v.k }));
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
  /** The given nodes minus any inside another given group, which would otherwise move twice. */
  const topLevelNodes = (d: ReturnType<typeof parseDiagram>, ids: string[]) => {
    const set = new Set(ids.filter((id) => d.nodes.some((n) => n.id === id)));
    const inSet = (id: string) => {
      for (let a = d.nodes.find((n) => n.id === id)?.parent; a; a = d.nodes.find((n) => n.id === a)?.parent) if (set.has(a)) return true;
      return false;
    };
    return [...set].filter((id) => !inSet(id));
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
  /** `name` is a component name, GROUP, or `shape:<name>` for a plain shape. */
  const addComponent = (name: string, at?: Point) => {
    const spec = COMPONENTS.find((c) => c.name === name);
    const shape = shapeOf(name);
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
        : shape
          ? addNode(type, el.code ?? '', shape.label, { parent: parent || undefined, props: { shape: shape.shape } })
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
    setPanning(true);
    beginDrag(e, (ev) => setView((v) => ({ ...v, x: s.vx + ev.clientX - s.x, y: s.vy + ev.clientY - s.y })), () => setPanning(false));
  };

  const clearSelection = () => { select([]); p.onDiagramSelection(null); };

  const onPointerDown = (e: React.PointerEvent) => {
    if (editing) commitEditing();
    (document.activeElement as HTMLElement | null)?.blur?.();
    host.current?.focus({ preventScroll: true });
    if (e.button === 1 || spaceDown.current) return startPan(e);
    if (e.button !== 0) return;
    // The move tool only drags the view: it never selects or edits anything.
    if (activeTool === 'move') return startPan(e);
    const pt = toWorld(e.clientX, e.clientY);
    // The line and arrow tools draw by dragging; a plain click draws nothing. Shift keeps the angle to 45 degrees.
    if (lineTool) {
      e.preventDefault();
      const from = { x: snapV(pt.x), y: snapV(pt.y) };
      let el: CanvasElement | undefined;
      beginDrag(e, (ev) => {
        const q = toWorld(ev.clientX, ev.clientY);
        let to = { x: snapV(q.x), y: snapV(q.y) };
        if (ev.shiftKey) {
          const dx = to.x - from.x, dy = to.y - from.y;
          const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          to = { x: snapV(from.x + Math.cos(a) * Math.hypot(dx, dy)), y: snapV(from.y + Math.sin(a) * Math.hypot(dx, dy)) };
        }
        if (!el) { if (Math.hypot(q.x - from.x, q.y - from.y) < 6) return; el = makeLine(lineTool.kind, from, to); return; }
        const cur = yEls.get(el.id);
        if (cur) yEls.set(el.id, { ...cur, points: [{ x: 0, y: 0 }, { x: to.x - from.x, y: to.y - from.y }] });
      }, () => {
        // A press that drew nothing keeps the tool armed; drawing something returns to Select.
        if (!el) return;
        select([el.id]);
        setTool('select');
      });
      return;
    }
    // An armed shape is placed with its middle under the pointer, like a drop, then the tool goes back to Select.
    if (activeTool === 'shape') {
      e.preventDefault();
      if (armedShape) addComponent(SHAPE_PREFIX + armedShape.shape, { x: pt.x - 48, y: pt.y - 38 });
      setTool('select');
      return;
    }
    const target = e.target as Element;
    const id = target.closest('[data-id]')?.getAttribute('data-id') ?? null;
    const el = id ? yEls.get(id) : undefined;
    const nodeId = target.closest('[data-node]')?.getAttribute('data-node');
    const edgeId = target.closest('[data-edge]')?.getAttribute('data-edge');
    const visual = el?.type === 'diagram' && VISUAL_TYPES.includes(el.diagramType ?? 'architecture');

    if (activeTool === 'connect') {
      if (visual && nodeId) startConnect(e, el!.id, nodeId);
      else startPan(e);
      return;
    }
    if (visual && nodeId) {
      const diagramId = el!.id;
      const draggable = DRAGGABLE_TYPES.includes(el!.diagramType ?? 'architecture');
      const current = sel?.kind === 'node' && sel.diagramId === diagramId ? selNodes : [];
      // Shift+click adds a node to, or takes it out of, the nodes selected in this diagram.
      if (e.shiftKey && draggable && current.length) {
        const set = new Set(current);
        if (set.has(nodeId)) set.delete(nodeId); else set.add(nodeId);
        const ids = [...set];
        if (!ids.length) { setMulti(null); p.onDiagramSelection(null); return; }
        setMulti({ diagramId, ids });
        p.onDiagramSelection({ diagramId, kind: 'node', id: set.has(nodeId) ? nodeId : ids[ids.length - 1] });
        if (set.has(nodeId)) startNodeDrag(e, diagramId, nodeId, pt, ids);
        return;
      }
      // Pressing on one of several selected nodes drags them all; a click without a drag selects just that one.
      const keep = draggable && current.length > 1 && current.includes(nodeId);
      select([diagramId]);
      setMulti(keep ? { diagramId, ids: current } : null);
      p.onDiagramSelection({ diagramId, kind: 'node', id: nodeId });
      if (draggable) startNodeDrag(e, diagramId, nodeId, pt, keep ? current : [nodeId], keep ? () => setMulti(null) : undefined);
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

  /**
   * Drags a node, or several selected nodes together (`group`). Dropping a single node on a group moves it in;
   * dropping it clear of its group moves it out. The dragged node snaps to other nodes' edges and centres
   * (hold Alt to skip), and `onClick` runs when the pointer is released without dragging.
   */
  const startNodeDrag = (e: React.PointerEvent, id: string, nodeId: string, start: Point, group: string[] = [nodeId], onClick?: () => void) => {
    const el0 = yEls.get(id)!;
    const type = el0.diagramType ?? 'architecture';
    const scale = scaleOf(el0);
    const d0 = parseDiagram(type, el0.code ?? '');
    const node0 = d0.nodes.find((n) => n.id === nodeId);
    const boxes0 = boxesOf(el0);
    const parentBox = node0?.parent ? boxes0.get(node0.parent) : undefined;
    const movers = topLevelNodes(d0, group);
    const bases = new Map(movers.map((n) => [n, el0.nodeOffsets?.[n] ?? { x: 0, y: 0 }]));
    // Snap targets: nodes that stay put. Groups around the moving nodes re-fit as they move, so they're left out.
    const parentOf = (n: string) => d0.nodes.find((k) => k.id === n)?.parent;
    const skip = new Set<string>();
    for (const m of movers) {
      for (let a = parentOf(m); a; a = parentOf(a)) skip.add(a);
      for (const k of d0.nodes) for (let a: string | undefined = k.id; a; a = parentOf(a)) if (a === m) { skip.add(k.id); break; }
    }
    const others = [...boxes0].filter(([k]) => !skip.has(k)).map(([, b]) => b);
    const lead = boxes0.get(nodeId);
    let moved = false;
    beginDrag(e, (ev) => {
      const q = toWorld(ev.clientX, ev.clientY);
      const cur = yEls.get(id);
      if (!cur) return;
      if (!moved && Math.hypot(q.x - start.x, q.y - start.y) < 3) return;
      moved = true;
      const rx = q.x - start.x, ry = q.y - start.y;
      let dx = snapV(rx), dy = snapV(ry);
      if (lead && !ev.altKey) {
        const s = snapToGuides({ ...lead, x: lead.x + rx, y: lead.y + ry }, others, 6 / viewRef.current.k);
        if (s.dx !== undefined) dx = rx + s.dx;
        if (s.dy !== undefined) dy = ry + s.dy;
        setGuides(guidesFor({ ...lead, x: lead.x + dx, y: lead.y + dy }, others));
      }
      const offsets = { ...cur.nodeOffsets };
      for (const [n, b] of bases) offsets[n] = { x: b.x + dx / scale, y: b.y + dy / scale };
      yEls.set(id, { ...cur, ...withOffsets(cur, cur.code ?? '', offsets) });
    }, (ev) => {
      setGuides([]);
      if (!moved) onClick?.();
      if (!moved || !node0 || node0.isGroup || movers.length > 1) return;
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
    if (activeTool !== 'select') return;
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
  /** View and arrangement shortcuts. Returns true when it handled the key. Mod+\ (Hide UI) lives in the editor page. */
  const viewKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    // e.code, because Shift and Alt change e.key (Shift+1 is "!", and Alt+0 is "º" on a Mac).
    if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') { fit(); return true; }
    if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') { zoomToSelection(); return true; }
    if (mod && e.altKey && !e.shiftKey && e.code === 'Digit0') { zoomTo(1); return true; }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') { duplicateNodes(); return true; }
    const dir = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[e.key];
    if (dir && !mod && !e.altKey) {
      const step = e.shiftKey ? 32 : SNAP;
      return nudge(dir[0] * step, dir[1] * step);
    }
    return false;
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, .cm-editor')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'Space') return; // handled on window, so it works without canvas focus
    if (viewKey(e)) { e.preventDefault(); return; }
    if (mod && e.key === '0') { e.preventDefault(); fit(); return; }
    if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomAt(1.2); return; }
    if (mod && e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) undo.redo(); else undo.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); undo.redo(); return; }
    if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) deleteSelectedPart(); else removeSelected(); return; }
    if (e.key === 'Escape' && insertOpen) { closeInsert(); return; }
    if (e.key === '/' && !mod && !e.altKey) { e.preventDefault(); toggleInsert(); return; }
    if (e.key === 'Escape') { if (tool !== 'select') setTool('select'); else if (sel) p.onDiagramSelection(null); else select([]); return; }
    if (sel?.kind === 'node' && e.key === 'Enter') { e.preventDefault(); setRenaming(true); return; }
    if (e.key === 'Enter' && selection.size === 1) { const id = [...selection][0]; if (TEXT_TYPES.includes(yEls.get(id)?.type ?? '')) { e.preventDefault(); setEditing(id); } return; }
    if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    if (!mod && e.key.toLowerCase() === 'm') setTool('move');
    if (!mod && e.key.toLowerCase() === 'c') setTool('connect');
    if (!mod && !e.altKey && e.key === '?') { e.preventDefault(); setHelpOpen(true); return; }
    if (!mod && !e.altKey && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomAt(1.2); return; }
    if (!mod && !e.altKey && e.key === '-') { e.preventDefault(); zoomAt(1 / 1.2); return; }
    if (!mod && !e.altKey && !e.shiftKey) {
      const s = SHAPES.find((k) => k.key?.toLowerCase() === e.key.toLowerCase());
      if (s) { e.preventDefault(); armShape(s.shape); }
      const l = LINES.find((k) => k.key.toLowerCase() === e.key.toLowerCase());
      if (l) { e.preventDefault(); closeInsert(); setTool(l.kind); }
    }
  };
  useEffect(() => {
    const release = () => { spaceDown.current = false; setSpaceHeld(false); };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') release(); };
    // On window rather than the canvas: right after load nothing has focus yet, and a focused button would otherwise swallow Space.
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-editor, [contenteditable="true"]')) return;
      e.preventDefault();
      spaceDown.current = true;
      setSpaceHeld(true);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', release); };
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
    else changeDiagramCode(sel.diagramId, (t, c) => selNodes.reduce((code, n) => removeNode(t, code, n), c));
    p.onDiagramSelection(null);
  };

  // ---- several selected nodes: align, distribute, nudge, duplicate ----
  /** Nodes selected in the current diagram: the primary selection plus any added with Shift+click. */
  const selNodes = useMemo(() => {
    if (sel?.kind !== 'node') return [];
    const extra = multi?.diagramId === sel.diagramId ? multi.ids : [];
    return [...new Set([...extra, sel.id])];
  }, [sel, multi]);
  // Selecting anything else from outside (the panel, Esc, undo) drops the extra nodes.
  useEffect(() => {
    if (multi && (sel?.kind !== 'node' || sel.diagramId !== multi.diagramId || !multi.ids.includes(sel.id))) setMulti(null);
  }, [sel, multi]);
  const multiEl = selNodes.length > 1 && sel ? byId.get(sel.diagramId) : undefined;
  const multiBoxes = useMemo(() => {
    if (!multiEl) return null;
    const all = boxesOf(multiEl);
    const d = parseDiagram(multiEl.diagramType ?? 'architecture', multiEl.code ?? '');
    return new Map(topLevelNodes(d, selNodes).flatMap((n) => (all.has(n) ? [[n, all.get(n)!] as const] : [])));
  }, [multiEl, selNodes]);

  /** Moves nodes by canvas distances, as one undo step. */
  const shiftNodes = (diagramId: string, deltas: Map<string, Point>) => {
    const cur = yEls.get(diagramId);
    if (!cur || !DRAGGABLE_TYPES.includes(cur.diagramType ?? 'architecture')) return false;
    const scale = scaleOf(cur);
    const offsets = { ...cur.nodeOffsets };
    const r = (v: number) => Math.round(v * 100) / 100;
    for (const [n, d] of deltas) {
      const o = offsets[n] ?? { x: 0, y: 0 };
      offsets[n] = { x: r(o.x + d.x / scale), y: r(o.y + d.y / scale) };
    }
    undo.stopCapturing();
    yEls.set(diagramId, { ...cur, ...withOffsets(cur, cur.code ?? '', offsets) });
    undo.stopCapturing();
    return true;
  };
  const alignNodes = (mode: AlignMode) => { if (sel && multiBoxes) shiftNodes(sel.diagramId, alignDeltas(multiBoxes, mode)); };
  const distributeNodes = (axis: 'x' | 'y') => { if (sel && multiBoxes) shiftNodes(sel.diagramId, distributeDeltas(multiBoxes, axis)); };

  /** Arrow keys: moves the selected nodes, or the selected elements when no node is selected. */
  const nudge = (dx: number, dy: number) => {
    if (sel?.kind === 'node') {
      const el = yEls.get(sel.diagramId);
      if (!el) return false;
      const d = parseDiagram(el.diagramType ?? 'architecture', el.code ?? '');
      return shiftNodes(sel.diagramId, new Map(topLevelNodes(d, selNodes).map((n) => [n, { x: dx, y: dy }])));
    }
    const ids = [...withDependents(selection)].filter((id) => { const k = yEls.get(id); return k && !k.locked && !(onlyDiagram && k.type === 'diagram'); });
    if (!ids.length || sel) return false;
    undo.stopCapturing();
    p.doc.transact(() => { for (const id of ids) { const k = yEls.get(id)!; update(id, { x: k.x + dx, y: k.y + dy }); } });
    undo.stopCapturing();
    return true;
  };

  /** Mod+D: copies the selected components (not groups) next to the originals and selects the copies. */
  const duplicateNodes = () => {
    if (sel?.kind !== 'node') return;
    const el0 = yEls.get(sel.diagramId);
    if (!el0 || !DRAGGABLE_TYPES.includes(el0.diagramType ?? 'architecture')) return;
    const type = el0.diagramType ?? 'architecture';
    const nodes = parseDiagram(type, el0.code ?? '').nodes.filter((n) => selNodes.includes(n.id) && !n.isGroup);
    if (!nodes.length) { toast('Groups can’t be duplicated yet. Select a component inside one instead.', true); return; }
    const boxes = boxesOf(el0);
    const added: string[] = [];
    undo.stopCapturing();
    p.doc.transact(() => {
      for (const n of nodes) {
        const cur = yEls.get(sel.diagramId)!;
        const b = boxes.get(n.id);
        // The copy keeps the original's look and name; its id gets a number so it stays distinct.
        const r = addNode(type, cur.code ?? '', n.id, { parent: n.parent, props: { ...n.props, label: n.props.label ?? n.id } });
        applyVisualEdit(p.doc, sel.diagramId, r.code, b ? { id: r.id, x: b.x + 24, y: b.y + 24 } : undefined);
        added.push(r.id);
      }
    });
    undo.stopCapturing();
    setMulti(added.length > 1 ? { diagramId: sel.diagramId, ids: added } : null);
    p.onDiagramSelection({ diagramId: sel.diagramId, kind: 'node', id: added[added.length - 1] });
  };

  /** Shift+2: frames the selected part(s), or the selected elements. */
  const selectionBox = (): Box | null => {
    if (sel) {
      const el = yEls.get(sel.diagramId);
      if (sel.kind === 'node' && el && DRAGGABLE_TYPES.includes(el.diagramType ?? 'architecture')) {
        const all = boxesOf(el);
        const u = unionBox(selNodes.flatMap((n) => (all.has(n) ? [all.get(n)!] : [])));
        if (u) return u;
      }
      // Anything else (a connection, or a part of another diagram type): its outline on screen.
      if (partBox) {
        const v = viewRef.current;
        return { x: (partBox.left - v.x) / v.k, y: (partBox.top - v.y) / v.k, w: partBox.width / v.k, h: partBox.height / v.k };
      }
    }
    const chosen = [...selection].map((id) => yEls.get(id)).filter(Boolean) as CanvasElement[];
    return chosen.length ? elementBounds(chosen, byId) : null;
  };
  const canZoomSelection = !!sel || selection.size > 0;
  const zoomToSelection = () => { const b = selectionBox(); if (b) zoomToBox(b); };

  /** What the minimap draws: every element, and the parts inside diagrams. Only worked out while it's open. */
  const minimapRects = useMemo(() => {
    if (!minimap) return [];
    const out: (Box & { kind: 'element' | 'part' })[] = [];
    for (const e of els) {
      const b = elementBounds([e], byId);
      if (b) out.push({ ...b, kind: 'element' });
      if (e.type === 'diagram' && DRAGGABLE_TYPES.includes(e.diagramType ?? 'architecture')) for (const pb of boxesOf(e).values()) out.push({ ...pb, kind: 'part' });
    }
    return out;
  }, [minimap, els, byId]);
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
    <div className={`canvas-shell ${p.uiHidden ? 'ui-hidden' : ''}`}>
      <nav className="rail" aria-label="Tools">
        <div className="rail-card">
          <button className={`rail-btn insert-toggle ${insertOpen ? 'active' : ''}`} aria-expanded={insertOpen} aria-keyshortcuts="/" aria-label={insertOpen ? 'Close insert menu' : 'Insert'} title="Insert components, shapes and groups (/)" onClick={toggleInsert}>
            <Icon name={insertOpen ? 'close' : 'plus'} size={18} /><kbd>/</kbd>
          </button>
        </div>
        <div className="rail-card" role="toolbar" aria-label="Canvas tools">
          {([
            ['select', 'Select', 'cursor', 'V', 'Select and edit components'],
            ['move', 'Move', 'move', 'M', 'Drag to look around the canvas (or hold Space)'],
            ['connect', 'Connect', 'arrow-right', 'C', 'Drag from one component to another'],
          ] as const).map(([id, label, icon, key, hint]) => (
            <button key={id} className={`rail-btn ${activeTool === id ? 'active' : ''}`} aria-pressed={activeTool === id} aria-keyshortcuts={key} aria-label={label} title={`${label}: ${hint} (${key})`} onClick={() => setTool(id)}>
              <Icon name={icon} size={18} /><kbd>{key}</kbd>
            </button>
          ))}
        </div>
        <div className="rail-card" role="toolbar" aria-label="Shapes">
          {SHAPES.filter((x) => x.key).map((x) => (
            <button key={x.shape} className={`rail-btn ${armedShape?.shape === x.shape ? 'active' : ''}`} aria-pressed={armedShape?.shape === x.shape} aria-keyshortcuts={x.key} aria-label={x.label} title={`${x.label} (${x.key}): then click the canvas to place one`} onClick={() => { closeInsert(); armShape(x.shape); }}>
              <Icon name={`shape-${x.shape}`} size={18} /><kbd>{x.key}</kbd>
            </button>
          ))}
          {LINES.map((l) => (
            <button key={l.kind} className={`rail-btn ${activeTool === l.kind ? 'active' : ''}`} aria-pressed={activeTool === l.kind} aria-keyshortcuts={l.key} aria-label={l.label} title={`${l.label} (${l.key}): drag on the canvas to draw one`} onClick={() => { closeInsert(); setTool(l.kind); }}>
              <Icon name={`draw-${l.kind}`} size={18} /><kbd>{l.key}</kbd>
            </button>
          ))}
        </div>
        <div className="rail-card">
          <button className="rail-btn" aria-keyshortcuts="?" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setHelpOpen(true)}><Icon name="keyboard" size={18} /><kbd>?</kbd></button>
        </div>
      </nav>
      {insertOpen && (
        <div className={`insert-pop ${insertDrag ? 'ghost' : ''}`} role="dialog" aria-label="Insert" onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); closeInsert(); host.current?.focus({ preventScroll: true }); }
          if (e.key === 'Backspace' && !insertQuery && insertView !== 'root' && (e.target as HTMLElement).tagName === 'INPUT') setInsertView('root');
        }}>
          <div className="insert-search">
            {insertView !== 'root' && !q ? <button className="ghost" aria-label="Back" title="Back" onClick={() => setInsertView('root')}><Icon name="back" size={16} /></button> : <Icon name="search" size={16} />}
            <input autoFocus type="search" placeholder={insertView === 'root' || q ? 'Insert item' : `Search ${insertView}`} aria-label="Search items to insert" value={insertQuery} onChange={(e) => setInsertQuery(e.target.value)} />
          </div>
          <div className="insert-list">
            {!q && insertView === 'root' && (
              <>
                <h3>All categories</h3>
                <button className="insert-row" onClick={() => setInsertView('components')}><span className="lib-icon"><Icon name="server" size={18} /></span><span className="insert-text"><b>Components</b><small>Services, databases, queues, clients and more</small></span><Icon name="arrow-right" size={14} /></button>
                <button className="insert-row" onClick={() => setInsertView('shapes')}><span className="lib-icon"><Icon name="shape-hexagon" size={18} /></span><span className="insert-text"><b>Shapes</b><small>Rectangles, diamonds, hexagons and more</small></span><Icon name="arrow-right" size={14} /></button>
                <div className="insert-tiles">
                  <button className="insert-tile" title="Drag a group onto the canvas" draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, GROUP); e.dataTransfer.effectAllowed = 'copy'; setInsertDrag(true); }} onDragEnd={closeInsert}><Icon name="frame" size={20} /><span>Group</span></button>
                </div>
              </>
            )}
            {(q || insertView === 'components') && !!insertComponents.length && (
              <section>
                {q && <h3>Components</h3>}
                {(q ? [['', insertComponents.map((c) => c.name)] as [string, string[]]] : CATEGORIES.map(([cat, names]) => [cat, names.filter((nm) => insertComponents.some((c) => c.name === nm))] as [string, string[]]).filter(([, names]) => names.length)).map(([cat, names]) => (
                  <div key={cat || 'all'}>
                    {cat && <h3>{cat}</h3>}
                    {names.map((nm) => { const c = COMPONENTS.find((k) => k.name === nm)!; return (
                      <button key={c.name} className="insert-row" title={`Drag ${c.name} onto the canvas`} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, c.name); e.dataTransfer.effectAllowed = 'copy'; setInsertDrag(true); }} onDragEnd={closeInsert}>
                        <span className="lib-icon"><Icon name={c.icon} size={18} /></span><span className="insert-text"><b>{c.name}</b></span>
                      </button>
                    ); })}
                  </div>
                ))}
              </section>
            )}
            {(q || insertView === 'shapes') && (!!insertShapes.length || (!!q && LINES.some((l) => l.label.toLowerCase().includes(q)))) && (
              <section>
                {q && <h3>Shapes</h3>}
                {insertShapes.map((x) => (
                  <button key={x.shape} className="insert-row" title={`Drag ${x.label} onto the canvas`} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, SHAPE_PREFIX + x.shape); e.dataTransfer.effectAllowed = 'copy'; setInsertDrag(true); }} onDragEnd={closeInsert}>
                    <span className="lib-icon"><Icon name={`shape-${x.shape}`} size={18} /></span><span className="insert-text"><b>{x.label}</b></span>{x.key && <kbd>{x.key}</kbd>}
                  </button>
                ))}
                {(!q || 'line'.includes(q) || 'arrow'.includes(q)) && LINES.filter((l) => !q || l.label.toLowerCase().includes(q)).map((l) => (
                  <button key={l.kind} className="insert-row" title={`Drag ${l.label.toLowerCase()} onto the canvas`} draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, LINE_PREFIX + l.kind); e.dataTransfer.effectAllowed = 'copy'; setInsertDrag(true); }} onDragEnd={closeInsert}>
                    <span className="lib-icon"><Icon name={`draw-${l.kind}`} size={18} /></span><span className="insert-text"><b>{l.label}</b></span><kbd>{l.key}</kbd>
                  </button>
                ))}
              </section>
            )}
            {q && insertGroup && (
              <section>
                <h3>Group</h3>
                <button className="insert-row" title="Drag a group onto the canvas" draggable onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, GROUP); e.dataTransfer.effectAllowed = 'copy'; setInsertDrag(true); }} onDragEnd={closeInsert}><span className="lib-icon"><Icon name="frame" size={18} /></span><span className="insert-text"><b>Group</b></span></button>
              </section>
            )}
            {q && !insertComponents.length && !insertShapes.length && !insertGroup && <p className="muted small insert-empty">Nothing matches "{insertQuery}".</p>}
          </div>
          <div className="insert-foot muted small"><span>Drag an item onto the canvas</span><span><kbd>Esc</kbd> to close</span></div>
        </div>
      )}
      {helpOpen && <ShortcutsHelp shapes={SHAPES.filter((s) => s.key).map((s) => ({ key: s.key!, label: s.label }))} onClose={() => { setHelpOpen(false); host.current?.focus({ preventScroll: true }); }} />}
      <div
        className={`canvas ${activeTool === 'connect' ? 'connect-mode' : ''} ${activeTool === 'move' ? 'move-mode' : ''} ${activeTool === 'shape' || lineTool ? 'shape-mode' : ''} ${panning ? 'panning' : ''}`}
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
          if (name.startsWith(LINE_PREFIX)) {
            // A dropped line or arrow is 120 px long and horizontal, centred on the pointer.
            undo.stopCapturing();
            const el = makeLine(name.slice(LINE_PREFIX.length) as LineKind, { x: snapV(pt.x - 60), y: snapV(pt.y) }, { x: snapV(pt.x + 60), y: snapV(pt.y) });
            undo.stopCapturing();
            select([el.id]);
            return;
          }
          // The pointer is held by the component's middle, not its corner.
          addComponent(name, { x: pt.x - 48, y: pt.y - 38 });
        }}
      >
        <svg className="canvas-svg" width="100%" height="100%" style={{ backgroundPosition: `${view.x}px ${view.y}px`, backgroundSize: `${24 * view.k}px ${24 * view.k}px` }}>
          <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
            {sorted.map((e) => <g key={e.id} data-id={e.id} dangerouslySetInnerHTML={{ __html: htmlFor(e) }} />)}
            {selBox && <rect className="no-hit" x={selBox.x} y={selBox.y} width={selBox.w} height={selBox.h} fill="none" stroke="var(--accent)" strokeWidth={1.4 / view.k} strokeDasharray={framed.length > 1 ? `${5 / view.k} ${4 / view.k}` : undefined} />}
            {selBox && single?.type !== 'arrow' && !framed.some((e) => e.locked) && !sel && activeTool === 'select' && HANDLES.map((h) => {
              const q = pos(h, selBox);
              return <rect key={h} data-handle={h} x={q.x - handleSize / 2} y={q.y - handleSize / 2} width={handleSize} height={handleSize} rx={2 / view.k} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.3 / view.k} style={{ cursor: `${h}-resize` }} onPointerDown={(e) => startResize(e, h)} />;
            })}
            {single?.type === 'arrow' && activeTool === 'select' && (() => {
              const pts = resolveArrowPoints(single, byId);
              return (['start', 'end'] as const).map((end) => {
                const q = end === 'start' ? pts[0] : pts.at(-1)!;
                return <circle key={end} cx={q.x} cy={q.y} r={6 / view.k} fill="var(--bg)" stroke="var(--accent)" strokeWidth={1.5 / view.k} style={{ cursor: 'move' }} onPointerDown={(e) => startArrowEnd(e, single, end)} />;
              });
            })()}
            {multiBoxes && [...multiBoxes].filter(([n]) => n !== sel?.id).map(([n, b]) => (
              <rect key={n} className="no-hit" x={b.x - 3 / view.k} y={b.y - 3 / view.k} width={b.w + 6 / view.k} height={b.h + 6 / view.k} rx={5 / view.k} fill="none" stroke="var(--accent)" strokeWidth={2 / view.k} />
            ))}
            {guides.map((g, i) => (g.axis === 'x'
              ? <line key={i} className="no-hit smart-guide" x1={g.at} x2={g.at} y1={g.from} y2={g.to} strokeWidth={1 / view.k} />
              : <line key={i} className="no-hit smart-guide" y1={g.at} y2={g.at} x1={g.from} x2={g.to} strokeWidth={1 / view.k} />))}
          </g>
        </svg>

        {partBox && (
          <div className="part-outline" style={partBox}>
            {sel?.kind === 'node' && !renaming && activeTool === 'select' && <div className="part-connect" role="button" aria-label="Drag to connect to another component" title="Drag to another component to connect" onPointerDown={(e) => { if (sel) startConnect(e, sel.diagramId, sel.id); }} />}
            {partNode && !partNode.isGroup && !renaming && activeTool === 'select' && DRAGGABLE_TYPES.includes(partType) && <div className="part-resize" role="button" aria-label="Drag to resize this component" title="Drag to resize" onPointerDown={startNodeResize} />}
          </div>
        )}
        {partBox && sel && partNode && !renaming && !connecting && activeTool === 'select' && !p.uiHidden && selNodes.length < 2 && VISUAL_TYPES.includes(partType) && (
          <StyleBar box={partBox} props={partNode.props} isGroup={partNode.isGroup} onChange={(patch) => changeDiagramCode(sel.diagramId, (t, c) => setNodeProps(t, c, sel.id, patch))} />
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
          <ZoomMenu
            zoom={view.k} onZoomIn={() => zoomAt(1.2)} onZoomOut={() => zoomAt(1 / 1.2)}
            onHand={() => setTool('move')} handActive={activeTool === 'move'}
            onFit={fit} onZoomSelection={zoomToSelection} canZoomSelection={canZoomSelection} onZoom100={() => zoomTo(1)}
            minimap={minimap} onToggleMinimap={() => setMinimap((m) => !m)} onHideUi={p.onToggleUi}
          />
          <button aria-label="Zoom in" title="Zoom in" onClick={() => zoomAt(1.2)}>+</button>
          <button aria-label="Fit to content" title="Fit (Ctrl+0, Shift+1)" onClick={fit}><Icon name="fit" /></button>
        </div>
        {minimap && !p.uiHidden && size.w > 0 && <Minimap rects={minimapRects} view={view} size={size} onPan={centerOn} />}
        {multiBoxes && multiBoxes.size > 1 && !p.uiHidden && !guides.length && activeTool === 'select' && (() => {
          const u = unionBox(multiBoxes.values())!;
          return (
            <AlignBar
              left={(u.x + u.w / 2) * view.k + view.x} top={Math.max(8, u.y * view.k + view.y - 48)} count={multiBoxes.size}
              onAlign={alignNodes} onDistribute={distributeNodes}
            />
          );
        })()}
        {p.uiHidden && p.onToggleUi && (
          <button className="show-ui" onPointerDown={(e) => e.stopPropagation()} onClick={p.onToggleUi} title="Show the toolbars and panels again">
            Show UI <kbd>Esc</kbd>
          </button>
        )}

        {activeTool === 'connect' && <div className="mode-hint" role="status">Drag from one component to another. Press <kbd>Esc</kbd> when you're done.</div>}
        {lineTool && <div className="mode-hint" role="status">Drag on the canvas to draw {lineTool.kind === 'arrow' ? 'an arrow' : 'a line'}. Hold <kbd>Shift</kbd> for 45° angles, <kbd>Esc</kbd> to cancel.</div>}
        {armedShape && <div className="mode-hint" role="status">Click on the canvas to place a {armedShape.label.toLowerCase()}. Press <kbd>Esc</kbd> to cancel.</div>}
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
