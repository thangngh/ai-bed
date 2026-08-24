import React from 'react';
import { formatUtc } from './parseUtc';
import type { IpState, IpStatus } from './dashboardTypes';

/**
 * 'temp_blocked' has no colour on the BE side yet -- nothing assigns it. It is
 * mapped anyway so that if the BE starts using it the cell is not blank.
 */
const STATUS_CLASS: Record<IpStatus, string> = {
  ok: 'bg-slate-100 text-slate-700',
  throttled: 'bg-amber-100 text-amber-800',
  temp_blocked: 'bg-orange-100 text-orange-800',
  perm_blocked: 'bg-red-100 text-red-800',
};

interface Props {
  states: IpState[];
  busy: boolean;
  onUnblock: (state: IpState) => void;
}

export default function IpStatesTable({ states, busy, onUnblock }: Props) {
  if (states.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Chưa có IP nào khớp bộ lọc
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">IP</th>
          <th className="p-2">Trạng thái</th>
          <th className="p-2">Tier</th>
          <th className="p-2">Điểm</th>
          <th className="p-2">Block đến</th>
          <th className="p-2">Tự động</th>
          <th className="p-2">Lý do</th>
          <th className="p-2">Cập nhật</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {states.map((row) => (
          <tr key={row.ip} className="border-b border-slate-100">
            <td className="p-2 font-mono">{row.ip}</td>
            <td className="p-2">
              <span className={`rounded px-2 py-0.5 text-xs ${STATUS_CLASS[row.status]}`}>
                {row.status}
              </span>
            </td>
            <td className="p-2">{row.tier}</td>
            <td className="p-2">{row.score}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(row.blockedUntil)}</td>
            <td className="p-2">{row.autoBlocked ? 'có' : 'không'}</td>
            <td className="p-2">{row.reason ?? '—'}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(row.updatedAt)}</td>
            <td className="p-2">
              {row.status !== 'ok' && (
                <button
                  type="button"
                  aria-label={`Bỏ block ${row.ip}`}
                  disabled={busy}
                  onClick={() => onUnblock(row)}
                  className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                >
                  Bỏ block
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
