import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { ApiError, get, OFFLINE_STATUS, setUser, useToasts, useUser } from './api.ts';
import { HomePage } from './pages/Home.tsx';
import { EditorPage } from './pages/Editor.tsx';
import { PwaStatus, registerPwa } from './pwa.tsx';
import './styles.css';

registerPwa();

function Toasts() {
  const toasts = useToasts();
  return <div className="toasts" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>{t.text}</div>)}</div>;
}

const isLocal = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);

/** Explains why /me failed, so a deployment problem isn't reported as "start the server". */
function ServerProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const status = error instanceof ApiError ? error.status : -1;
  const detail = error instanceof Error ? error.message : String(error);
  let title: string;
  let body: ReactNode;
  if (status === OFFLINE_STATUS) {
    title = "Can't reach the DevArt server";
    body = isLocal
      ? <>Start it with <code>npm start</code>, then reload this page. Once you've opened DevArt with the server running, it also works offline.</>
      : <>No response from the server at <code>{location.host}</code>. Check that it is running and that your proxy forwards <code>/api</code> to it.</>;
  } else if (status === 403) {
    title = 'The DevArt server refused this address';
    body = <>The server is running, but it only accepts requests addressed to its own machine. To serve it at <code>{location.host}</code>, put your own login in front of it and start it with <code>DEVART_ALLOW_REMOTE=1</code> (see Security in the README).<br /><small>Server said: {detail}</small></>;
  } else if (status === 404 || status === -1) {
    title = "The DevArt API isn't available here";
    body = <>This page was loaded, but <code>/api/v1</code> didn't answer as DevArt. The app may be deployed without its Node server (<code>npm start</code>), or a proxy isn't forwarding <code>/api</code>, <code>/mcp</code> and <code>/collab</code> to it.<br /><small>{detail}</small></>;
  } else {
    title = 'The DevArt server ran into a problem';
    body = <>It answered with an error ({status}). Check the server's log.<br /><small>{detail}</small></>;
  }
  return (
    <div className="center"><div className="server-problem">
      <h2>{title}</h2>
      <p className="muted">{body}</p>
      <button onClick={onRetry}>Try again</button>
    </div></div>
  );
}

function App() {
  const user = useUser();
  const [error, setError] = useState<unknown>(null);
  const load = () => {
    setError(null);
    setUser(undefined);
    get('/me')
      .then((u) => {
        // A static host's catch-all can answer with index.html and a 200.
        if (!u || typeof u !== 'object' || !('id' in u)) throw new Error('Expected the current user as JSON, but got something else.');
        setUser(u);
      })
      .catch((e) => { setError(e); setUser(null); });
  };
  useEffect(load, []);
  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <ServerProblem error={error} onRetry={load} />;
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/f/:id" element={<EditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <PwaStatus />
      <Toasts />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
