import { Link, useNavigate } from 'react-router-dom';
import { del, post, timeAgo, toast, toastError, toggleTheme, useLoad, useTheme } from '../api.ts';
import { Icon, Logo } from '../components/ui.tsx';
import { InstallButton } from '../pwa.tsx';
import { TemplatePicker } from '../components/TemplatePicker.tsx';

interface FileRow { id: string; title: string; updatedAt: number }

export function HomePage() {
  const theme = useTheme();
  const nav = useNavigate();
  const { data: files, reload } = useLoad<FileRow[]>('/files');

  const drawManually = () => post('/files', { title: 'Untitled architecture' }).then((f) => nav(`/f/${f.id}`)).catch(toastError);
  const remove = (f: FileRow) => {
    if (!confirm(`Delete "${f.title}"?`)) return;
    del(`/files/${f.id}`).then(() => { toast('Diagram deleted'); reload(); }).catch(toastError);
  };

  return (
    <div className="home">
      <header className="home-bar">
        <InstallButton />
        <button className="ghost" aria-label="Switch theme" onClick={toggleTheme}><Icon name={theme === 'dark' ? 'sun' : 'moon'} /></button>
      </header>
      <main className="home-main">
        <div className="home-hero">
          <Logo large />
          <p>Design and visualize system architectures effortlessly.</p>
        </div>
        <div className="choices">
          <button className="choice" onClick={drawManually}>
            <Icon name="pen" size={24} />
            <b>Draw Manually</b>
            <span>Build architecture diagrams using a visual editor.</span>
          </button>
        </div>
        {!!files?.length && (
          <section className="recent" aria-label="Your diagrams">
            <h2>Your diagrams</h2>
            <div className="file-grid">
              {files.map((f) => (
                <div key={f.id} className="file-card">
                  <Link to={`/f/${f.id}`} className="file-open">
                    <div className="thumb"><img loading="lazy" alt="" src={`/api/v1/files/${f.id}/export?format=svg&theme=${theme}&background=0&v=${f.updatedAt}`} onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} /></div>
                    <div className="file-meta"><b className="truncate">{f.title}</b><span className="muted small">{timeAgo(f.updatedAt)}</span></div>
                  </Link>
                  <button className="ghost file-delete" aria-label={`Delete ${f.title}`} onClick={() => remove(f)}><Icon name="trash" size={14} /></button>
                </div>
              ))}
            </div>
          </section>
        )}
        <TemplatePicker />
      </main>
    </div>
  );
}
