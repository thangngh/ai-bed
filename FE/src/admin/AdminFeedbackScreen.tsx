import React from 'react';
import { useSearchParams } from 'react-router-dom';
import FeedbackFilters from './FeedbackFilters';
import FeedbackTable from './FeedbackTable';
import { fetchAdminFeedbacks } from './adminClient';
import { useAdminResource } from './useAdminResource';
import type { FeedbackFilterState } from './types';

const PAGE_SIZE = 20;

/** This screen's copy for codes the shared table does not cover. */
const MESSAGES: Record<string, string> = {
  TIMEOUT: 'Không kết nối được máy chủ',
  NETWORK_ERROR: 'Không kết nối được máy chủ',
  VALIDATION_ERROR: 'Bộ lọc không hợp lệ',
};

/** The URL is the single source of truth, so reload and Back both work. */
function filtersFromParams(params: URLSearchParams): FeedbackFilterState {
  return {
    rating: params.get('rating') ?? '',
    hasNote: params.get('has_note') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
  };
}

/** Shared by requestParams/urlParams: empty means "no filter" -- sending
 * `rating=` would fail the BE's validation, so blanks are left out entirely. */
function withFilterParams(params: URLSearchParams, filters: FeedbackFilterState): URLSearchParams {
  if (filters.rating) params.set('rating', filters.rating);
  if (filters.hasNote) params.set('has_note', filters.hasNote);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params;
}

function requestParams(filters: FeedbackFilterState, offset: number): URLSearchParams {
  const params = withFilterParams(new URLSearchParams(), filters);
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));
  return params;
}

/** Keeps the URL terse: default offset 0 is left off rather than written as `offset=0`. */
function urlParams(filters: FeedbackFilterState, offset: number): URLSearchParams {
  const params = withFilterParams(new URLSearchParams(), filters);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}

export default function AdminFeedbackScreen() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = filtersFromParams(searchParams);
  const offset = Number(searchParams.get('offset') ?? 0) || 0;

  // Stands in for searchParams: a new URLSearchParams instance with the same
  // contents must not trigger a refetch.
  const key = searchParams.toString();

  const { data: page, loading, error, reload } = useAdminResource(
    key,
    () => fetchAdminFeedbacks(requestParams(filters, offset)),
    { fallbackMessage: 'Không tải được danh sách feedback', messages: MESSAGES },
  );

  function applyFilters(next: FeedbackFilterState) {
    // Always back to the first page: page 3 of a narrower result set is blank.
    setSearchParams(urlParams(next, 0), { replace: true });
  }

  function goTo(nextOffset: number) {
    setSearchParams(urlParams(filters, Math.max(0, nextOffset)));
  }

  const total = page?.total ?? 0;
  const first = total === 0 ? 0 : offset + 1;
  const last = Math.min(offset + (page?.items.length ?? 0), total);

  return (
    <>
      <FeedbackFilters value={filters} onChange={applyFilters} />

      {loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

      {!loading && error && (
        <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{error}</p>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-red-300 px-3 py-1 text-sm"
          >
            Thử lại
          </button>
        </div>
      )}

      {!loading && !error && page && page.items.length === 0 && (
        <p className="rounded border border-slate-200 bg-white p-6 text-center text-slate-600">
          Chưa có feedback nào khớp bộ lọc
        </p>
      )}

      {!loading && !error && page && page.items.length > 0 && (
        <>
          <FeedbackTable items={page.items} />
          <div className="flex items-center justify-between text-sm">
            <span>{`${first}–${last} / ${total}`}</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={offset === 0}
                onClick={() => goTo(offset - PAGE_SIZE)}
                className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
              >
                Trước
              </button>
              <button
                type="button"
                disabled={last >= total}
                onClick={() => goTo(offset + PAGE_SIZE)}
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
