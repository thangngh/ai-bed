import React from 'react';
import type { AdminFeedbackItem } from './types';
import { formatVietnamTime } from '../utils/vietnamTime';

/** A missing story or child is a valid state, not an error. Never print "null". */
const DASH = '—';

function text(value: string | number | null | undefined): React.ReactNode {
  if (value === null || value === undefined || value === '') return DASH;
  return value;
}

function bool(value: number | null): React.ReactNode {
  if (value === null || value === undefined) return DASH;
  if (value === 1) return 'Có';
  if (value === 0) return 'Không';
  return DASH; // wants_more uses -1 for "không rõ"
}

const HEADERS = ['Thời gian (VN)', 'Đánh giá', 'Bé', 'Truyện', 'Nghe hết', 'Muốn thêm', 'Ghi chú'];

export default function FeedbackTable({ items }: { items: AdminFeedbackItem[] }) {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-slate-50 text-left">
          <tr>
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.feedback_id} className="border-t border-slate-100 align-top">
              <td className="px-3 py-2 whitespace-nowrap">{text(formatVietnamTime(item.created_at))}</td>
              <td className="px-3 py-2">{text(item.rating)}</td>
              <td className="px-3 py-2">{text(item.child_name)}</td>
              <td className="px-3 py-2">{text(item.story_title)}</td>
              <td className="px-3 py-2">{bool(item.listened_complete)}</td>
              <td className="px-3 py-2">{bool(item.wants_more)}</td>
              <td className="px-3 py-2 max-w-xs">{text(item.note)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
