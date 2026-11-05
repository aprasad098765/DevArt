// DevArt's MCP tools. Each one calls the REST API, so open editors see changes live.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SYNTAX_REFERENCE } from '../shared/dsl.ts';
import { fromMermaid } from '../shared/fromMermaid.ts';

const theme = z.enum(['light', 'dark']).optional();

type Result = { content: any[]; isError?: boolean };
const text = (v: unknown): Result => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

export function buildMcpServer(apiBase: string) {
  const appUrl = apiBase.replace(/\/api\/v1$/, '');
  const openUrl = (fileId: string) => `${appUrl}/f/${fileId}`;
  const call = async (method: string, path: string, body?: unknown) => {
    let res: Response;
    try {
      res = await fetch(apiBase + path, {
        method,
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error(`Can't reach the DevArt server at ${appUrl}. Open DevArt with its shortcut or run "npm start" in its folder, then try again.`);
    }
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok) {
      const msg = type.includes('json') ? ((await res.json()) as any).error : await res.text();
      throw new Error(`DevArt API ${res.status}: ${msg}`);
    }
    if (type.includes('json')) return res.json();
    if (type.startsWith('image/png') || type.includes('pdf')) return { binary: Buffer.from(await res.arrayBuffer()).toString('base64'), mime: type.split(';')[0] };
    return res.text();
  };

  const server = new McpServer(
    { name: 'devart', version: '0.2.0' },
    { instructions: 'DevArt draws software architecture diagrams. Call get_diagram_syntax the first time, then draw_architecture. Check the returned image, and fix the layout by calling update_diagram if needed. Give the user the returned url: they can edit the diagram by hand there.' },
  );

  const tool = (name: string, description: string, schema: Record<string, z.ZodTypeAny>, fn: (a: any) => Promise<unknown>, readOnly = false) => {
    server.registerTool(name, { description, inputSchema: schema, annotations: { readOnlyHint: readOnly } }, async (args: any) => {
      try {
        const out = await fn(args);
        return (out && typeof out === 'object' && 'content' in out ? out : text(out)) as Result;
      } catch (e) {
        return { ...text((e as Error).message), isError: true };
      }
    });
  };
  /** Validates diagram code, then saves it to a new file or to fileId, and returns its ids, url, and a PNG of it. */
  const save = async (type: string, title: string, code: string, fileId?: string, extra: Record<string, unknown> = {}): Promise<Result> => {
    const check = (await call('POST', '/render', { type, code, format: 'json' })) as any;
    const errors = check.issues.filter((i: any) => i.severity === 'error');
    if (errors.length) return { ...text({ saved: false, errors, ...extra }), isError: true };
    const id = fileId ?? ((await call('POST', '/files', { title })) as any).id;
    const diagram = (await call('POST', `/files/${id}/diagrams`, { type, code, title })) as any;
    const image = (await call('GET', `/files/${id}/export?format=png&elementId=${encodeURIComponent(diagram.id)}`)) as any;
    return {
      content: [
        ...text({ saved: true, fileId: id, diagramId: diagram.id, type, url: openUrl(id), warnings: diagram.issues, ...extra }).content,
        { type: 'image', data: image.binary, mimeType: 'image/png' },
      ],
    };
  };
  const ro = (name: string, description: string, schema: Record<string, z.ZodTypeAny>, fn: (a: any) => Promise<unknown>) => tool(name, description, schema, fn, true);
  const asMedia = (out: any, fallbackName: string): Result => {
    if (typeof out === 'string') return text(out);
    if (out?.binary && out.mime === 'image/png') return { content: [{ type: 'image', data: out.binary, mimeType: 'image/png' }] };
    if (out?.binary) return { content: [{ type: 'resource', resource: { uri: `devart://export/${fallbackName}`, mimeType: out.mime, blob: out.binary } }] };
    return text(out);
  };

  ro('get_diagram_syntax', 'Get the architecture diagram syntax, with an example, and the available icons.', {}, async () => {
    const all = (await call('GET', '/syntax')) as any;
    return { reference: SYNTAX_REFERENCE.architecture, icons: all.icons, iconAliases: all.iconAliases };
  });
  ro('validate_diagram', 'Check architecture diagram code without saving it. Returns any errors and warnings with line numbers.', { code: z.string() }, async ({ code }) => {
    const r = (await call('POST', '/render', { type: 'architecture', code, format: 'json' })) as any;
    return { valid: !r.issues.some((i: any) => i.severity === 'error'), issues: r.issues, width: r.width, height: r.height };
  });
  ro('render_diagram', 'Render architecture diagram code to an image without saving it. PNG comes back as an image so you can inspect the layout; SVG as text.', {
    code: z.string(), format: z.enum(['png', 'svg']).default('png'), theme,
  }, async (a) => asMedia(await call('POST', '/render', { ...a, type: 'architecture' }), 'diagram.png'));

  tool('draw_architecture', 'Draw an architecture diagram from diagram code and save it. Creates a new file, or adds to fileId if given. Code with errors is not saved; the errors are returned with line numbers. Returns the diagram as an image, plus its ids and a url to open it.', {
    title: z.string().describe('Name for the diagram, and for the file if one is created'),
    code: z.string().describe('Architecture diagram code. See get_diagram_syntax.'),
    fileId: z.string().optional().describe('Existing file to add to'),
  }, ({ title, code, fileId }) => save('architecture', title, code, fileId));
  tool('update_diagram', 'Change a diagram\'s code or title. Hand edits are stored in the code too, so read it first with list_diagrams.', {
    fileId: z.string(), diagramId: z.string(), code: z.string().optional(), title: z.string().optional(),
  }, ({ fileId, diagramId, ...rest }) => call('PATCH', `/files/${fileId}/elements/${diagramId}`, rest));
  ro('list_diagrams', 'List the diagrams in a file, with their code and any issues.', { fileId: z.string() }, async ({ fileId }) => call('GET', `/files/${fileId}/diagrams`));

  ro('list_files', 'List saved files, newest first, optionally matching a search on titles and diagram contents.', { query: z.string().optional() }, async ({ query }) => call('GET', `/files${query ? `?q=${encodeURIComponent(query)}` : ''}`));
  ro('export_file', 'Export a file as svg, png, or pdf, or one diagram with elementId. scale (1 to 3) sets PNG and PDF resolution; transparent drops the background.', {
    fileId: z.string(), format: z.enum(['svg', 'png', 'pdf']), elementId: z.string().optional(), theme,
    scale: z.number().min(1).max(3).optional().describe('1, 2 (default), or 3 for PNG and PDF'),
    transparent: z.boolean().optional().describe('Export without a background fill'),
  }, async ({ fileId, transparent, ...q }) => {
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
    if (transparent) params.set('transparent', '1');
    return asMedia(await call('GET', `/files/${fileId}/export?${params}`), `${fileId}.${q.format}`);
  });

  ro('export_mermaid', 'Convert a saved diagram to Mermaid text (flowchart, sequenceDiagram, or erDiagram). Layout, icons, and colours are dropped. Without diagramId, every diagram in the file is converted.', {
    fileId: z.string(), diagramId: z.string().optional().describe('Diagram to convert; see list_diagrams'),
  }, async ({ fileId, diagramId }) => call('GET', `/files/${fileId}/export?format=mermaid${diagramId ? `&elementId=${encodeURIComponent(diagramId)}` : ''}`));
  tool('import_mermaid', 'Create a DevArt diagram from Mermaid text. Supports flowchart/graph (shapes, subgraphs, link labels, styles), sequenceDiagram, and erDiagram. Creates a new file, or adds to fileId if given. Returns the converted DevArt code, the diagram as an image, and a url.', {
    mermaid: z.string().describe('Mermaid source, starting with flowchart, graph, sequenceDiagram, or erDiagram'),
    title: z.string().optional().describe('Name for the diagram, and for the file if one is created'),
    fileId: z.string().optional().describe('Existing file to add to'),
    as: z.enum(['architecture', 'flowchart']).optional().describe('DevArt type for a Mermaid flowchart. Default architecture, which can be edited visually'),
  }, async ({ mermaid, title, fileId, as }) => {
    const converted = fromMermaid(mermaid, { graphAs: as ?? 'architecture' });
    if (!converted) return { ...text('Not a supported Mermaid diagram. Use flowchart (or graph), sequenceDiagram, or erDiagram.'), isError: true };
    const name = title ?? (/^title\s+(.+)$/m.exec(converted.code)?.[1] ?? 'Imported from Mermaid');
    return save(converted.type, name, converted.code, fileId, { code: converted.code });
  });

  ro('list_templates', 'List ready-made diagrams to start from, such as microservices, CI/CD, three-tier, event-driven, OAuth flow, and a blog ERD.', {}, async () =>
    ((await call('GET', '/templates')) as any[]).map(({ id, name, description, type }) => ({ id, name, description, type })));
  tool('draw_from_template', 'Save a copy of a template as a new diagram, then adapt it with update_diagram. Creates a new file, or adds to fileId if given.', {
    templateId: z.string().describe('Template id from list_templates'),
    title: z.string().optional().describe('Name for the diagram; defaults to the template name'),
    fileId: z.string().optional().describe('Existing file to add to'),
  }, async ({ templateId, title, fileId }) => {
    const t = (await call('GET', `/templates/${encodeURIComponent(templateId)}`)) as any;
    return save(t.type, title ?? t.name, t.code, fileId, { code: t.code });
  });

  return server;
}
