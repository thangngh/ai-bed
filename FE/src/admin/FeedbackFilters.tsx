import React from 'react';
import type { FeedbackFilterState } from './types';

export const EMPTY_FILTERS: FeedbackFilterState = { rating: '', hasNote: '', from: '', to: '' };

interface Props {
  value: FeedbackFilterState;
  onChange: (next: FeedbackFilterState) => void;
}

export default function FeedbackFilters({ value, onChange }: Props) {
  const set = (patch: Partial<FeedbackFilterState>) => onChange({ ...value, ...patch });

  return (
    <div className="flex flex-wrap items-end gap-3 rounded border border-slate-200 bg-white p-3">
      <div className="space-y-1">
        <label htmlFor="filter-rating" className="block text-xs text-slate-600">Đánh giá</label>
        <select
          id="filter-rating"
          value={value.rating}
          onChange={(e) => set({ rating: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Tất cả</option>
          {['1', '2', '3', '4', '5'].map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-note" className="block text-xs text-slate-600">Ghi chú</label>
        <select
          id="filter-note"
          value={value.hasNote}
          onChange={(e) => set({ hasNote: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        >
          <option value="">Tất cả</option>
          <option value="1">Có ghi chú</option>
          <option value="0">Không ghi chú</option>
        </select>
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-from" className="block text-xs text-slate-600">Từ ngày</label>
        <input
          id="filter-from"
          type="date"
          value={value.from}
          onChange={(e) => set({ from: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      <div className="space-y-1">
        <label htmlFor="filter-to" className="block text-xs text-slate-600">Đến ngày</label>
        <input
          id="filter-to"
          type="date"
          value={value.to}
          onChange={(e) => set({ to: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1"
        />
      </div>

      {/* created_at is stored in UTC; without this label a Vietnamese user
          would read the range as local time and be off by seven hours. */}
      <p className="text-xs text-slate-500">Khoảng ngày tính theo UTC</p>

      <button
        type="button"
        onClick={() => onChange(EMPTY_FILTERS)}
        className="ml-auto rounded border border-slate-300 px-3 py-1 text-sm"
      >
        Xoá bộ lọc
      </button>
    </div>
  );
}
