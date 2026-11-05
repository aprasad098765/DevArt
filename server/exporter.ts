import { Resvg } from '@resvg/resvg-js';
import { PDFDocument } from 'pdf-lib';
import { renderCanvasSvg, renderDiagram } from '../shared/render.ts';
import type { CanvasElement, Theme } from '../shared/types.ts';

export type ExportFormat = 'svg' | 'png' | 'pdf';

export function svgToPng(svg: string, scale = 2): Buffer {
  const r = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: Math.min(4, Math.max(0.5, scale)) },
    font: { loadSystemFonts: true, defaultFontFamily: 'Arial' },
  });
  return Buffer.from(r.render().asPng());
}

/** Clamps a requested export scale (1x, 2x, 3x...) to what resvg handles comfortably. */
export const exportScale = (v: unknown, fallback = 2) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.min(4, Math.max(0.5, n)) : fallback;
};

/** The PDF page keeps the diagram's size in points; scale sets the resolution of the embedded image. */
export async function svgToPdf(svg: string, width: number, height: number, scale = 2): Promise<Buffer> {
  const png = svgToPng(svg, scale);
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(png);
  pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  return Buffer.from(await pdf.save());
}

export async function convert(svg: string, width: number, height: number, format: ExportFormat, scale?: number) {
  if (format === 'svg') return { body: Buffer.from(svg), mime: 'image/svg+xml' };
  if (format === 'png') return { body: svgToPng(svg, exportScale(scale)), mime: 'image/png' };
  return { body: await svgToPdf(svg, width, height, exportScale(scale)), mime: 'application/pdf' };
}

export const canvasSvg = (elements: CanvasElement[], opts: { only?: string; theme?: Theme; background?: boolean }) => renderCanvasSvg(elements, opts);

export const diagramSvg = (type: Parameters<typeof renderDiagram>[0], code: string, opts: { theme?: Theme; background?: boolean }) => renderDiagram(type, code, { ...opts, background: opts.background ?? true });
