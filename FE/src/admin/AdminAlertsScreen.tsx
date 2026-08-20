import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import AlertsTable from './AlertsTable';
import { fetchAlerts, resolveAlert } from './dashboardClient';
import { useAdminAction, useAdminResource } from './useAdminResource';
import type { Alert } from './dashboardTypes';

const PAGE_SIZE = 50;
const POLL_MS = 30_000;

/**
 * `resolved` reaches the BE as the literal string 'true' or 'false': its DTO
 * transforms exactly those two and rejects anything else. An absent key means
 * "all", so an empty filter must omit it rather than send `resolved=`.
 */
function requestParams(resolved: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (resolved) params.set('resolved', resolved);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return params;
}

function urlParams(resolved: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('resolved', resolved);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}

export default function AdminAlertsScreen() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Opening this screen means "show me what is still open". The default lives
  // in the read, and an effect writes it into the URL so a copied link shows
  // the reader exactly what the sender saw. Keying off the effective value
  // rather than the raw query string keeps that normalisation from costing a
  // second request.
  const resolved = searchParams.get('resolved') ?? 'false';
  const offset = Number(searchParams.get('offset') ?? 0) || 0;
  const key = `${resolved}|${offset}`;

  const hasResolvedParam = searchParams.has('resolved');
  useEffect(() => {
    if (!hasResolvedParam) setSearchParams(urlParams('false', 0), { replace: true });
  }, [hasResolvedParam, setSearchParams]);

  const [autoRefresh, setAutoRefresh] = useState(true);

  const alerts = useAdminResource(
    key,
    () => fetchAlerts(requestParams(resolved, offset)),
    {
      pollMs: autoRefresh ? POLL_MS : undefined,
      fallbackMessage: 'Không tải được danh sách alert',
    },
  );
  const action = useAdminAction();

  function resolve(row: Alert) {
    void action.run(() => resolveAlert(row.id), () => alerts.reload());
  }

  const page = alerts.data;
  const total = page?.total ?? 0;
  const shown = page?.items.length ?? 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Alerts</h2>
        <div className="flex items-center gap-4 text-sm">
          <label>
            <span className="mr-2 text-slate-600">Trạng thái</span>
            <select
              aria-label="Lọc trạng thái"
              value={resolved}
              onChange={(event) => setSearchParams(urlParams(event.target.value, 0), { replace: true })}
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="false">đang mở</option>
              <option value="true">đã xử lý</option>
              <option value="">tất cả</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              aria-label="Tự động làm mới"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            {/* Off is a real need: the table must not move under someone who is
                reading an expanded detail row. */}
            <span>Tự động làm mới</span>
          </label>
        </div>
      </div>

      {action.actionError && (
        <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {action.actionError}
        </p>
      )}

      {/* A failed poll keeps the rows and only warns; only a failed first load
          replaces the screen. */}
      {alerts.error && page && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Không cập nhật được, đang thử lại
        </p>
      )}

      {alerts.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

      {!alerts.loading && alerts.error && !page && (
        <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{alerts.error}</p>
          <button
            type="button"
            onClick={alerts.reload}
            className="rounded border border-red-300 px-3 py-1 text-sm"
          >
            Thử lại
          </button>
        </div>
      )}

      {page && (
        <>
          <AlertsTable alerts={page.items} busy={action.busy} onResolve={resolve} />
          <div className="flex items-center justify-between text-sm">
            <span>{`${shown} / ${total}`}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => setSearchParams(urlParams(resolved, Math.max(0, offset - PAGE_SIZE)))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={offset + shown >= total}
                onClick={() => setSearchParams(urlParams(resolved, offset + PAGE_SIZE))}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Sau
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
