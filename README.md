# DevArt

Design and visualize system architectures effortlessly. DevArt does one thing: it creates architecture diagrams. Drag components onto a canvas and connect them, or ask Claude Code to draw one through DevArt's [MCP server](#use-it-from-claude-code). Either way, you edit the result in the same editor.

## Run it

Requires Node.js 24 or newer. There is no separate database to install, because DevArt uses Node's built-in SQLite.

```bash
npm install
npm run build
npm start
```

Open <http://127.0.0.1:4000>. There is no login. Data is stored in `./data`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Server port |
| `HOST` | `127.0.0.1` | Bind address. See [Security](#security) before changing it. |
| `DEVART_DATA` | `./data` | Database directory |
| `DEVART_ALLOW_REMOTE` | unset | Set to `1` to allow non-local access. See [Security](#security). |

To work on the code, run `npm run dev:server` and `npm run dev:client` in two terminals, then open <http://localhost:5173>.

## The editor

| To | Do this |
| --- | --- |
| Add a component | Drag it from the left panel onto the canvas |
| Connect components | Choose **Connect** and drag from one to another, or drag the dot beside a selected component |
| Rename | Double-click, or use the right panel, which also sets the description, icon, and colour |
| Move or resize | Drag the component, or drag the square at its corner |
| Group | Drag a **Group** onto the canvas, then drag components in or out |
| Change a connection | Click it to set its label, line, and arrows, or reverse its direction |
| Delete | Select it and press Delete |
| Zoom and pan | Ctrl+scroll or the zoom buttons to zoom. Drag empty canvas or scroll to pan |
| Undo and redo | Ctrl+Z and Ctrl+Shift+Z, or the buttons at the top right |

**Arrange automatically** in the right panel resets positions to the automatic layout. **Edit as code** shows the diagram's code, which stays in step with visual edits. **Export** gives you PNG, SVG, or PDF at 1x, 2x, or 3x, with an option for a transparent background. Changes save as you work.

The home page also lists **templates** to start from. See [Templates](#templates).

## Start it with one click (Windows)

```bash
npm run shortcut
```

This adds a **DevArt** shortcut to your Desktop and Start Menu. Opening it starts the server with no terminal window if it isn't already running, then opens the app in its own window using Chrome or Edge.

- The server keeps running after you close the window, so Claude Code stays connected. Run `npm run stop` to stop it. That only stops a server the shortcut started; one started with `npm start` stops with Ctrl+C.
- The installed PWA's own icon can't start the server, because browsers don't let web apps launch programs. Use the DevArt shortcut, or the PWA opens in offline mode when the server isn't running.
- If it can't start, a message appears and details are in `data/server.log`.
- If you move the DevArt folder, run `npm run shortcut` again. To remove the shortcuts, run `npm run shortcut:remove`. Your diagrams aren't affected.

## Install as an app

DevArt is a Progressive Web App. With the server running, open it in Chrome or Edge and click **Install app** on the home page, or use the install icon in the address bar.

The installed app is a window onto your local server, tied to the address you installed it from. Use `127.0.0.1:4000` consistently, because `localhost:4000` counts as a different app with separate saved data.

When the server isn't running, the app and your diagram list still open, and diagrams you've opened before can be viewed and edited. Changes are saved in the browser and merge when the server is back. Creating diagrams, deleting, and export need the server.

New versions install in the background and show an **Update** button when ready. Any address other than localhost needs HTTPS for install and offline support to work.

## Use it from Claude Code

You can also draw from a Claude Code session. **Stdio (recommended)** starts DevArt's server by itself when it's needed:

```bash
claude mcp add --scope user devart -- node "/absolute/path/to/mcp/stdio.ts"
```

**HTTP** needs the server already running:

```bash
claude mcp add --transport http devart http://127.0.0.1:4000/mcp
```

Start a new Claude Code session, then ask it to draw your system in DevArt. Claude gives you a link to open the diagram, and changes appear live in any open editor.

| Area | Tools |
| --- | --- |
| Draw | `get_diagram_syntax`, `validate_diagram`, `render_diagram`, `draw_architecture`, `update_diagram` |
| Templates | `list_templates`, `draw_from_template` |
| Mermaid | `import_mermaid`, `export_mermaid` |
| Read | `list_files`, `list_diagrams`, `export_file` |

- `export_file` takes `format` (`svg`, `png`, or `pdf`), and optionally `elementId` for one diagram, `theme`, `scale` (1 to 3), and `transparent`.
- `draw_from_template` saves a copy of a template, given its `templateId` from `list_templates`, to a new file or to `fileId`. Claude can then adapt it with `update_diagram`.
- `import_mermaid` takes Mermaid text and saves it as a new diagram, returning the converted DevArt code and an image. A flowchart becomes an architecture diagram, which you can edit visually, unless you pass `as: "flowchart"`.
- `export_mermaid` takes a `fileId` and optional `diagramId`, and returns Mermaid text.

## Export

`GET /api/v1/files/:id/export` returns a whole file, or one diagram with `elementId`:

| Query option | Values |
| --- | --- |
| `format` | `svg`, `png`, `pdf`, or `mermaid`. Also `json` and `md`; see [Removed features](#removed-features). |
| `scale` | `1`, `2` (default), or `3`, for PNG and PDF. Values from 0.5 to 4 are accepted. |
| `transparent` | `1` for no background fill. `background=0` does the same. |
| `theme` | `light` (default) or `dark` |

`POST /api/v1/render` renders diagram code without saving it. It takes `type`, `code`, `format` (`json`, `svg`, `png`, or `pdf`), `theme`, `scale`, and `transparent` in a JSON body.

PDF pages keep the diagram's size, and `scale` sets the resolution of the image inside.

## Mermaid

DevArt converts to and from the common parts of [Mermaid](https://mermaid.js.org):

| DevArt | Mermaid |
| --- | --- |
| Architecture and flow chart | `flowchart` or `graph`: node shapes, `subgraph`, link labels in both forms, `&` and chained links, dotted and thick links, `style`, `classDef`, and `:::class` fills and colours |
| Sequence | `sequenceDiagram`: `participant` and `actor` with `as`, all arrow types, `+`/`-` activation, `activate`, `autonumber`, and `alt`/`else`, `opt`, `loop`, `par`/`and`, `break`, and `critical`/`option` blocks |
| ERD | `erDiagram`: entities with typed attributes and `PK`, `FK`, and `UK` keys, all cardinalities, and labels |

Export with `GET /api/v1/files/:id/export?format=mermaid&elementId=<diagram id>` or the `export_mermaid` MCP tool. Import with the `import_mermaid` MCP tool. In code, `toMermaid` is in `shared/mermaid.ts` and `fromMermaid` in `shared/fromMermaid.ts`.

Converting is lossy in both directions. DevArt icons, colours, descriptions, and positions have no Mermaid form. Mermaid notes, `click` links, `linkStyle`, `rect` highlights, and other diagram types such as `classDiagram` and `gantt` are skipped. A Mermaid node keeps its label as its DevArt name, unless two nodes share a label.

## Templates

DevArt includes six diagrams to start from:

| Id | Template | Type |
| --- | --- | --- |
| `microservices` | Microservices with API gateway | Architecture |
| `cicd-pipeline` | CI/CD pipeline | Architecture |
| `three-tier` | Three-tier web app | Architecture |
| `event-driven` | Event-driven with queue | Architecture |
| `oauth-flow` | OAuth 2.0 login flow | Sequence |
| `blog-erd` | Blog database | ERD |

Pick one under **Start from a template** on the home page, or use the `list_templates` and `draw_from_template` MCP tools. `GET /api/v1/templates` lists them with their code, and `GET /api/v1/templates/:id` returns one. They are defined in `shared/templates.ts`.

## Security

DevArt has no login, so anyone who can reach the server can read and change every diagram. To keep that safe:

- It listens only on this machine by default, and refuses to start on any other address.
- It rejects requests whose `Host` header doesn't name this machine, and writes and WebSocket connections from other websites, so a web page open in your browser can't reach your diagrams.
- Other programs and users on the same computer can still reach it, as with most local development servers.

To run it on a network, put your own authentication in front of it, such as a reverse proxy with SSO or a VPN, and set both `HOST` and `DEVART_ALLOW_REMOTE=1`. That turns off the `Host` check, and DevArt then relies entirely on your authentication.

## Removed features

DevArt was simplified to focus on architecture diagrams. These are gone from the app: Draw with AI, documents, freehand drawing and shape tools, sticky notes, images, device frames, code blocks, comments, version history, presentation mode, share links, embeds, the old templates gallery, style presets, custom icons, folders, the trash view, workspaces, API tokens, settings, audit logs, and importing from draw.io and Visio.

**Your existing work is safe.** Older files stay in the list and open in the editor:

- Flow charts and BPMN diagrams can still be edited visually, and ERDs and sequence diagrams through their code. New diagrams are always architecture diagrams.
- Older shapes, arrows, and text can be moved, resized, retyped, and deleted.
- Nothing was deleted from the database. Saved versions, comments, and other old records stay in `data/devart.db`, though the app no longer shows them.
- `GET /api/v1/files/:id/export?format=json` returns a file's elements along with any older document and map data, and `format=md` returns the document text.
- Deleting a diagram from the home page only marks it deleted. `POST /api/v1/files/:id/restore` brings it back.

## Known limitations

- Each diagram edit replaces that diagram's code as a whole. If two windows edit the same diagram at once, the last change wins.
- Once components have been moved by hand, the arrows touching them are drawn as straight lines rather than routed around other components.
- PDF exports contain a high-resolution image rather than vector graphics.
- Search through MCP uses simple substring matching.

Back up the `data` directory. It contains the database with all diagrams.

## Tests

```bash
npm test          # renderer, visual edits, Mermaid, templates, REST API, live sync, and MCP over HTTP and stdio
npm run e2e       # browser walkthrough; requires Chrome
npm run typecheck
```

## Project layout

```
shared/   diagram parser, SVG renderer, visual edits, icons, Mermaid conversion, templates (used by browser and server)
server/   REST API, SQLite storage, live sync, and export
mcp/      MCP tools with stdio and HTTP entry points
client/   React web app: home and the editor
test/     unit, API, and browser tests
```
