// "Start from a template" on the home page: each card creates a file holding a copy of that template.
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { post, toastError, useLoad } from '../api.ts';
import type { DiagramType } from '../../../shared/types.ts';

interface Template { id: string; name: string; description: string; type: DiagramType; code: string }

// Matches the home page's .choice cards, which the page keeps to its one main action.
const CARD = {
  display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 6, padding: 16, textAlign: 'left', whiteSpace: 'normal',
  border: '1px solid var(--line)', borderRadius: 12, background: 'var(--bg)', color: 'var(--fg)', cursor: 'pointer', height: '100%',
} as const;

const TYPE_LABEL: Partial<Record<DiagramType, string>> = { architecture: 'Architecture', sequence: 'Sequence', erd: 'ERD', flowchart: 'Flow chart' };

export function TemplatePicker() {
  const nav = useNavigate();
  const { data: templates } = useLoad<Template[]>('/templates');
  const [busy, setBusy] = useState<string | null>(null);
  if (!templates?.length) return null;

  const start = async (t: Template) => {
    setBusy(t.id);
    try {
      const f = await post('/files', { title: t.name });
      await post(`/files/${f.id}/diagrams`, { type: t.type, code: t.code, title: t.name });
      nav(`/f/${f.id}`);
    } catch (e) {
      toastError(e);
      setBusy(null);
    }
  };

  return (
    <section className="templates" aria-label="Start from a template">
      <h2>Start from a template</h2>
      <div className="file-grid">
        {templates.map((t) => (
          <button key={t.id} className="template-card" style={CARD} disabled={busy !== null} onClick={() => start(t)}>
            <b>{t.name}</b>
            <span className="small">{t.description}</span>
            <span className="muted small">{TYPE_LABEL[t.type] ?? t.type}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
