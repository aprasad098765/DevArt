import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { patch, toastError, toggleTheme, useLoad, useTheme } from '../api.ts';
import { Canvas, removeElements } from '../components/Canvas.tsx';
import { DiagramPanel } from '../components/DiagramPanel.tsx';
import { Icon } from '../components/ui.tsx';
import { ExportMenu } from '../components/ExportMenu.tsx';
import type { CanvasElement, DiagramSelection } from '../../../shared/types.ts';

function useCollab(fileId: string | undefined) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'gone'>('connecting');
  const [synced, setSynced] = useState(false);
  const session = useMemo(() => {
    if (!fileId) return null;
    const doc = new Y.Doc();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const provider = new WebsocketProvider(`${proto}://${location.host}/collab`, fileId, doc);
    // A saved copy lets the file open and be edited with no server.
    const persistence = new IndexeddbPersistence(`devart-file-${fileId}`, doc);
    return { doc, provider, persistence };
  }, [fileId]);
  useEffect(() => {
    if (!session) return;
    setSynced(false);
    const onStatus = (e: { status: 'connecting' | 'connected' | 'disconnected' }) => setStatus(e.status);
    const onSync = (s: boolean) => { if (s) setSynced(true); };
    const onClose = (e: CloseEvent | null) => { if (e && e.code >= 4400 && e.code < 4500) setStatus('gone'); };
    session.provider.on('status', onStatus);
    session.provider.on('sync', onSync);
    session.provider.on('connection-close', onClose);
    if (session.provider.synced) setSynced(true);
    // With a saved copy the file is ready at once. With none, give the server a moment before showing it empty.
    let wait: ReturnType<typeof setTimeout> | undefined;
    session.persistence.once('synced', () => {
      if (session.doc.getMap('elements').size > 0) setSynced(true);
      else wait = setTimeout(() => setSynced(true), 1500);
    });
    return () => {
      session.provider.off('status', onStatus);
      session.provider.off('sync', onSync);
      session.provider.off('connection-close', onClose);
      clearTimeout(wait);
      session.provider.destroy();
      session.persistence.destroy();
      session.doc.destroy();
    };
  }, [session]);
  return { ...session, status, synced };
}

export function EditorPage() {
  const { id } = useParams();
  return <Editor key={id} fileId={id!} />;
}

const STATUS_TEXT = {
  connected: 'All changes saved',
  connecting: 'Connecting… changes are saved here',
  disconnected: 'Offline: changes are saved here and sync when you reconnect',
  gone: 'This diagram was deleted. New changes will not be saved.',
};

function Editor({ fileId }: { fileId: string }) {
  const theme = useTheme();
  const { data: file, error, offline, reload } = useLoad<{ id: string; title: string }>(`/files/${fileId}`);
  const collab = useCollab(file ? fileId : undefined);
  const [selected, setSelected] = useState<string | null>(null);
  const [part, setPart] = useState<DiagramSelection | null>(null);
  const [title, setTitle] = useState('');
  const [elements, setElements] = useState<CanvasElement[]>([]);
  useEffect(() => { if (file) { setTitle(file.title); document.title = `${file.title} · DevArt`; } return () => { document.title = 'DevArt'; }; }, [file?.title]);

  useEffect(() => {
    if (!collab.doc) return;
    const yEls = collab.doc.getMap<CanvasElement>('elements');
    const on = () => setElements([...yEls.values()]);
    on();
    yEls.observe(on);
    return () => yEls.unobserve(on);
  }, [collab.doc]);

  // Hide UI (Mod+\): the palette, properties panel and zoom bar step aside. Mod+\ again or Esc brings them back.
  const [uiHidden, setUiHidden] = useState(false);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && e.code === 'Backslash') { e.preventDefault(); setUiHidden((h) => !h); return; }
      if (e.key === 'Escape' && uiHidden && !(e.target as HTMLElement | null)?.closest?.('input, textarea, select, .cm-editor')) setUiHidden(false);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [uiHidden]);

  const saveTitle = () => {
    if (!file || !title.trim() || title === file.title) return;
    patch(`/files/${fileId}`, { title }).then(reload).catch(toastError);
  };

  if (error && offline) return <div className="center"><div><h2>This diagram isn't available offline</h2><p className="muted">Diagrams you've opened before work without the server. This one will open once the server is back.</p><Link to="/">Back to home</Link></div></div>;
  if (error) return <div className="center"><div><h2>Diagram not found</h2><p className="muted">It may have been deleted.</p><Link to="/">Back to home</Link></div></div>;
  if (!file || !collab.doc) return <div className="center muted">Loading…</div>;

  // The panel follows the selection, and otherwise shows the file's first diagram.
  const selectedEl = selected ? elements.find((e) => e.id === selected) : undefined;
  const diagram = selectedEl?.type === 'diagram' ? selectedEl : selectedEl ? undefined : elements.find((e) => e.type === 'diagram');

  return (
    <div className="editor">
      <header className="topbar">
        <Link to="/" className="ghost-link" aria-label="Back to home"><Icon name="back" /></Link>
        <input className="title-input" aria-label="Diagram name" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <span className={`save-state ${collab.status === 'connected' ? 'muted' : 'warn'}`} role="status">{STATUS_TEXT[collab.status]}</span>
        <div className="grow" />
        <button className="ghost" aria-label="Switch theme" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
        <ExportMenu fileId={fileId!} title={title} theme={theme} />
      </header>
      <div className="editor-body">
        <Canvas
          doc={collab.doc} theme={theme} synced={collab.synced} selected={selected} onSelect={setSelected}
          diagramSelection={part} onDiagramSelection={setPart}
          uiHidden={uiHidden} onToggleUi={() => setUiHidden((h) => !h)}
        />
        {!uiHidden && diagram && <DiagramPanel doc={collab.doc} element={diagram} canDelete={elements.length > 1} selection={part} onSelection={setPart} />}
        {!uiHidden && selectedEl && selectedEl.type !== 'diagram' && (
          <aside className="dpanel" aria-label="Properties">
            <div className="visual">
              <p className="muted small">This shape was made with an earlier version of DevArt. You can move, resize, and retype it on the canvas.</p>
              <button className="danger" onClick={() => { removeElements(collab.doc!, [selectedEl.id]); setSelected(null); }}><Icon name="trash" size={14} /> Delete</button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
