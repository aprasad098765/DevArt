export type DiagramType = 'architecture' | 'flowchart' | 'erd' | 'sequence' | 'bpmn';
export const DIAGRAM_TYPES: DiagramType[] = ['architecture', 'flowchart', 'erd', 'sequence', 'bpmn'];

export type Theme = 'light' | 'dark';
export type Point = { x: number; y: number };

export type ElementType =
  | 'shape' | 'text' | 'sticky' | 'arrow' | 'pen' | 'image' | 'icon' | 'code' | 'device' | 'frame' | 'diagram';

export type ShapeKind =
  | 'rect' | 'rounded' | 'ellipse' | 'circle' | 'diamond' | 'cylinder' | 'hexagon' | 'parallelogram' | 'triangle' | 'document' | 'cloud';

// ---- node style properties written in diagram code, e.g. `API [shape: circle, border: thick]` ----

/** Shapes an architecture or flow chart node can take with `shape:`. `oval` and `ellipse` are the same shape. */
export const NODE_SHAPES = ['rect', 'rounded', 'circle', 'oval', 'ellipse', 'diamond', 'hexagon', 'cylinder', 'parallelogram', 'triangle', 'document', 'cloud'] as const;
export type NodeShape = (typeof NODE_SHAPES)[number];
/** Named border widths for `border:`; a plain number of pixels (0 to 20) also works. */
export const BORDER_WIDTHS = { none: 0, thin: 1, medium: 2, thick: 3.5 } as const;
export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const TEXT_ALIGNS = ['left', 'center', 'right'] as const;
export const TEXT_VALIGNS = ['top', 'middle', 'bottom'] as const;
/** Every style key a node accepts, in the order a properties panel would show them. */
export const NODE_STYLE_PROPS = [
  'shape', 'border', 'borderStyle', 'borderColor', 'radius', 'fill', 'opacity',
  'textColor', 'fontSize', 'bold', 'italic', 'align', 'valign',
] as const;
export type NodeStyleProp = (typeof NODE_STYLE_PROPS)[number];

/** One flat, JSON-serialisable record per canvas element; unused fields stay undefined. */
export interface CanvasElement {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  rot?: number;
  opacity?: number;
  stroke?: string;
  fill?: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  groupId?: string;
  locked?: boolean;
  link?: string;
  // text-bearing elements
  text?: string;
  fontSize?: number;
  font?: 'clean' | 'mono' | 'hand';
  align?: 'left' | 'center' | 'right';
  // shape
  shape?: ShapeKind;
  // arrow / pen; points are relative to x,y
  points?: Point[];
  startBind?: string;
  endBind?: string;
  startHead?: boolean;
  endHead?: boolean;
  routing?: 'straight' | 'elbow' | 'curve';
  // image / icon / device / code
  src?: string;
  icon?: string;
  device?: 'phone' | 'tablet' | 'laptop' | 'browser';
  lang?: string;
  // frame title
  title?: string;
  // diagram figure
  diagramType?: DiagramType;
  code?: string;
  presetId?: string;
  nodeOffsets?: Record<string, Point>;
}

/** A node or connection picked inside a diagram on the canvas. An edge's id is its index in the code. */
export interface DiagramSelection { diagramId: string; kind: 'node' | 'edge'; id: string }

export interface DiagramIssue {
  line: number;
  message: string;
  severity: 'error' | 'warning';
}

/** Visual defaults and naming rules a team can enforce on its diagrams. */
export interface PresetStyle {
  colors?: Record<string, string>;
  defaultNodeColor?: string;
  typeface?: 'clean' | 'mono' | 'hand';
  styleMode?: 'plain' | 'shadow';
  direction?: 'right' | 'down' | 'left' | 'up';
  nameRegex?: string;
  allowedColors?: string[];
  requireIcons?: boolean;
}

// Map content from before Map mode was removed. It stays in files, versions, and JSON exports.
export interface MapEntity {
  id: string;
  name: string;
  type?: string;
  parent?: string;
  tags?: string[];
  icon?: string;
  meta?: Record<string, string>;
}
export interface MapRelation { from: string; to: string; label?: string }
export interface MapView { id: string; name: string; tags?: string[]; types?: string[] }
export interface MapFlowStep { entities: string[]; note: string }
export interface MapFlow { id: string; name: string; steps: MapFlowStep[] }
export interface MapModel {
  entities: MapEntity[];
  relations: MapRelation[];
  views: MapView[];
  flows: MapFlow[];
}
