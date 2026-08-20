import React, { useState } from 'react';
import type { IngestResult } from './dashboardTypes';

interface Props {
  busy: boolean;
  result: IngestResult | null;
  onIngest: (logPath: string) => void;
}

/**
 * The BE confines logPath to DASHBOARD_NGINX_LOG_DIR, so the most common
 * failure here is a rejected path. Its message is shown as the BE wrote it:
 * replacing it with generic copy would leave the operator with no way to tell
 * "outside the directory" from "file not found".
 */
export default function IngestPanel({ busy, result, onIngest }: Props) {
  const [logPath, setLogPath] = useState('');

  return (
    <section className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-base font-semibold">Ingest log nginx</h2>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = logPath.trim();
          if (trimmed) onIngest(trimmed);
        }}
      >
        <label className="text-sm">
          <span className="block text-slate-600">Đường dẫn log</span>
          <input
            aria-label="Đường dẫn log"
            value={logPath}
            disabled={busy}
            onChange={(event) => setLogPath(event.target.value)}
            placeholder="/var/log/nginx/access.log"
            className="w-80 rounded border border-slate-300 px-2 py-1 font-mono"
          />
        </label>
        <button
          type="submit"
          disabled={busy || !logPath.trim()}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          Ingest
        </button>
      </form>

      {result && (
        <p className="text-sm">
          {`ingested: ${result.ingested} · skipped: ${result.skipped} · alerts_created: ${result.alerts_created}`}
        </p>
      )}
    </section>
  );
}
