import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { get, setUser, useToasts, useUser } from './api.ts';
import { HomePage } from './pages/Home.tsx';
import { EditorPage } from './pages/Editor.tsx';
import { PwaStatus, registerPwa } from './pwa.tsx';
import './styles.css';

registerPwa();

function Toasts() {
  const toasts = useToasts();
  return <div className="toasts" role="status">{toasts.map((t) => <div key={t.id} className={`toast ${t.error ? 'err' : ''}`}>{t.text}</div>)}</div>;
}

function App() {
  const user = useUser();
  useEffect(() => { get('/me').then(setUser).catch(() => setUser(null)); }, []);
  if (user === undefined) return <div className="center muted">Loading…</div>;
  if (!user) return <div className="center"><div><h2>Can't reach the DevArt server</h2><p className="muted">Start it with <code>npm start</code>, then reload this page. Once you've opened DevArt with the server running, it also works offline.</p></div></div>;
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
