import React from 'react';
import { formatUtc } from './parseUtc';
import type { IpRule } from './dashboardTypes';

interface Props {
  rules: IpRule[];
  busy: boolean;
  onToggle: (rule: IpRule) => void;
  onEdit: (rule: IpRule) => void;
  onDelete: (rule: IpRule) => void;
}

/**
 * Presentational: it emits intents and never calls the API. The confirm
 * prompts and the refetch fan-out belong to the screen, which is the only
 * place that knows which other blocks a write invalidates.
 */
export default function IpRulesTable({ rules, busy, onToggle, onEdit, onDelete }: Props) {
  if (rules.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
        Chưa có rule nào
      </p>
    );
  }

  return (
    <table className="w-full border-collapse bg-white text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-left text-slate-600">
          <th className="p-2">Bật</th>
          <th className="p-2">Loại</th>
          <th className="p-2">Pattern</th>
          <th className="p-2">Hành động</th>
          <th className="p-2">Tier</th>
          <th className="p-2">Ghi chú</th>
          <th className="p-2">Tạo lúc</th>
          <th className="p-2" />
        </tr>
      </thead>
      <tbody>
        {rules.map((rule) => (
          <tr key={rule.id} className="border-b border-slate-100">
            <td className="p-2">
              <input
                type="checkbox"
                aria-label={`Bật rule ${rule.pattern}`}
                checked={rule.enabled}
                disabled={busy}
                onChange={() => onToggle(rule)}
              />
            </td>
            <td className="p-2">{rule.type}</td>
            <td className="p-2 font-mono">{rule.pattern}</td>
            <td className="p-2">{rule.action}</td>
            <td className="p-2">{rule.tier}</td>
            <td className="p-2">{rule.note ?? '—'}</td>
            <td className="p-2 whitespace-nowrap">{formatUtc(rule.createdAt)}</td>
            <td className="p-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  aria-label={`Sửa rule ${rule.pattern}`}
                  disabled={busy}
                  onClick={() => onEdit(rule)}
                  className="rounded border border-slate-300 px-2 py-0.5 disabled:opacity-40"
                >
                  Sửa
                </button>
                <button
                  type="button"
                  aria-label={`Xoá rule ${rule.pattern}`}
                  disabled={busy}
                  onClick={() => onDelete(rule)}
                  className="rounded border border-red-300 px-2 py-0.5 text-red-700 disabled:opacity-40"
                >
                  Xoá
                </button>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
