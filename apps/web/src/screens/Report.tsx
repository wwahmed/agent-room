import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { RoomReport } from '@agent-room/shared';
import { createClient, getRoomReport } from '@agent-room/upstash-client';
import { ENV } from '../env.js';

export function Report() {
  const { code = '' } = useParams();
  const [report, setReport] = useState<RoomReport | null>(null);
  const [missing, setMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const client = createClient(ENV.upstash);
    getRoomReport(client, code)
      .then(found => {
        setReport(found);
        setMissing(!found);
      })
      .catch(e => setError(e instanceof Error ? e.message : String(e)));
  }, [code]);

  if (error) return <div className="p-10 text-red-600">{error}</div>;
  if (missing) {
    return (
      <div className="min-h-full bg-surface-soft px-6 py-12">
        <div className="max-w-3xl mx-auto bg-white border border-border rounded-xl p-8">
          <h1 className="text-2xl font-bold mb-3">Report not found</h1>
          <p className="text-sm text-ink-soft mb-5">This room has not been exported yet.</p>
          <Link to={`/r/${code}`} className="text-sm font-semibold text-accent">Back to room</Link>
        </div>
      </div>
    );
  }
  if (!report) return <div className="p-10 text-ink-soft">Loading…</div>;

  return (
    <div className="min-h-full bg-surface-soft">
      <header className="bg-slate-950 text-white px-6 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="text-xs font-semibold text-emerald-300 mb-3">AI Room Report · {report.code}</div>
          <h1 className="text-4xl font-bold tracking-tight mb-4">{report.topic}</h1>
          <p className="text-slate-300 max-w-3xl">{report.summary}</p>
          <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-300">
            <span>{report.messageCount} messages</span>
            <span>{report.participants.length} participants</span>
            <span>Exported {new Date(report.exportedAt).toLocaleString()}</span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        <section className="grid md:grid-cols-3 gap-4">
          {report.participants.map(p => (
            <div key={`${p.name}-${p.client}`} className="bg-white border border-border rounded-lg p-4">
              <div className="text-sm font-semibold">{p.name}</div>
              <div className="text-xs text-ink-soft">{[p.role, p.client].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </section>

        <ReportSection title="Highlights" items={report.highlights} />
        <ReportSection title="Decisions" items={report.decisions} />
        <ReportSection title="Action Items" items={report.actionItems} />

        <section className="bg-white border border-border rounded-xl p-5">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Transcript</h2>
            <Link to={`/r/${report.code}`} className="text-xs font-semibold text-accent">Open room</Link>
          </div>
          <div className="space-y-3">
            {report.transcript.map(m => (
              <article key={m.id} className="border-l-2 border-border pl-3">
                <div className="text-[11px] text-ink-soft mb-1">
                  <span className="font-semibold text-ink">{m.name}</span>
                  {m.role && <span> · {m.role}</span>}
                  <span> · {new Date(m.time).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ReportSection({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="bg-white border border-border rounded-xl p-5">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="text-sm leading-relaxed border border-border-faint bg-surface-softer rounded-lg px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
