import React, { useState } from 'react';
import { formatUtc } from './parseUtc';
import type { Alert, AlertSeverity } from './dashboardTypes';

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  info: 'bg-slate-100 text-slate-700',
  warning: 'bg-amber-100 text-amber-800',
  critical: 'bg-red-100 text-red-800',
};

/**
 * `detailJson` is a string whose shape varies by alert type (ddos, rule_block,
 * provider...), and the BE promises no schema for it. Pretty-printing the raw
 * object is honest; mapping named fields per type would break silently the
 * first time the BE adds an alert type.
 */
function prettyDetail(detailJson: string): string {
  try {
    return JSON.stringify(JSON.parse(detailJson), null, 2);
  } catch {
    return detailJson;
  }
}

interface Props {
  alerts: Alert[];
  busy: boolean;
  onResolve: (alert: Alert) => void;
}

export default function AlertsTable({ alerts, busy, onResolve }: Props) {
  const [expanded, setExpanded] = useState<number | null>(null);

  if (alerts.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Không có alert nào khớp bộ lọc
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">Mức</th>
          <th className="p-2">Loại</th>
          <th className="p-2">IP</th>
          <th className="p-2">Provider</th>
          <th className="p-2">Tạo lúc</th>
          <th className="p-2">Trạng thái</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {alerts.map((row) => (
          <React.Fragment key={row.id}>
            <tr className="border-b border-slate-100">
              <td className="p-2">
                <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_CLASS[row.severity]}`}>
                  {row.severity}
                </span>
              </td>
              <td className="p-2">{row.type}</td>
              <td className="p-2 font-mono">{row.ip ?? '—'}</td>
              <td className="p-2">{row.provider ?? '—'}</td>
              <td className="p-2 whitespace-nowrap">{formatUtc(row.createdAt)}</td>
              <td className="p-2">{row.resolved ? `đã xử lý ${formatUtc(row.resolvedAt)}` : 'đang mở'}</td>
              <td className="p-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    aria-label={`Chi tiết alert ${row.id}`}
                    onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                    className="rounded border border-slate-300 px-2 py-0.5"
                  >
                    Chi tiết
                  </button>
                  {!row.resolved && (
                    <button
                      type="button"
                      aria-label={`Đã xử lý alert ${row.id}`}
                      disabled={busy}
                      onClick={() => onResolve(row)}
                      className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                    >
                      Đã xử lý
                    </button>
                  )}
                </div>
              </td>
            </tr>
            {expanded === row.id && (
              <tr className="border-b border-slate-100 bg-slate-50">
                <td colSpan={7} className="p-2">
                  <pre className="overflow-x-auto text-xs">{prettyDetail(row.detailJson)}</pre>
                </td>
              </tr>
            )}
          </React.Fragment>
        ))}
      </tbody>
    </table>
  );
}
