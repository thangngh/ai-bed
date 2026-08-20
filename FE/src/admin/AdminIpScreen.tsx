import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import IngestPanel from './IngestPanel';
import IpRuleForm from './IpRuleForm';
import IpRulesTable from './IpRulesTable';
import IpStatesTable from './IpStatesTable';
import {
  applyIpRules, createIpRule, deleteIpRule, fetchIpRules, fetchIpStates,
  ingestTraffic, unblockIp, updateIpRule,
} from './dashboardClient';
import { useAdminAction, useAdminResource } from './useAdminResource';
import type {
  ApplyResult, CreateRuleBody, IngestResult, IpRule, IpState, UpdateRuleBody,
} from './dashboardTypes';

const STATES_PAGE_SIZE = 50;

/** Only what the BE can actually filter on goes in the URL. `fetchIpRules`
 *  takes no parameters at all, so rules have no URL state and no filter. */
function statesRequestParams(status: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  params.set('limit', String(STATES_PAGE_SIZE));
  params.set('offset', String(offset));
  return params;
}

function statesUrlParams(status: string, offset: number): URLSearchParams {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (offset > 0) params.set('offset', String(offset));
  return params;
}

/**
 * Ingest, rules and states share one route because the operator's actual loop
 * is edit a rule -> apply -> watch the states change. Splitting them would
 * make that loop a navigation.
 */
export default function AdminIpScreen() {
  const rules = useAdminResource('ip-rules', fetchIpRules, {
    fallbackMessage: 'Không tải được danh sách rule',
  });
  const action = useAdminAction();

  const [editing, setEditing] = useState<IpRule | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const status = searchParams.get('status') ?? '';
  const statesOffset = Number(searchParams.get('offset') ?? 0) || 0;
  const statesKey = `${status}|${statesOffset}`;

  const states = useAdminResource(
    statesKey,
    () => fetchIpStates(statesRequestParams(status, statesOffset)),
    { fallbackMessage: 'Không tải được danh sách IP' },
  );

  const [ingestResult, setIngestResult] = useState<IngestResult | null>(null);

  const ruleList = rules.data ?? [];
  const enabledCount = ruleList.filter((rule) => rule.enabled).length;

  function create(body: CreateRuleBody) {
    void action.run(() => createIpRule(body), () => rules.reload());
  }

  function update(id: number, patch: UpdateRuleBody) {
    void action.run(() => updateIpRule(id, patch), () => {
      setEditing(null);
      rules.reload();
    });
  }

  function toggle(rule: IpRule) {
    void action.run(() => updateIpRule(rule.id, { enabled: !rule.enabled }), () => rules.reload());
  }

  function remove(rule: IpRule) {
    if (!window.confirm(`Xoá rule ${rule.pattern}?`)) return;
    void action.run(() => deleteIpRule(rule.id), () => {
      if (editing?.id === rule.id) setEditing(null);
      rules.reload();
    });
  }

  function apply() {
    // One click here can block a lot of addresses at once, so the prompt says
    // how many enabled rules are about to run.
    if (!window.confirm(`Áp dụng ${enabledCount} rule đang bật lên toàn bộ IP đã biết?`)) return;
    setApplyResult(null);
    void action.run(
      async () => {
        const result = await applyIpRules();
        setApplyResult(result);
      },
      () => {
        rules.reload();
        states.reload();
      },
    );
  }

  function unblock(row: IpState) {
    if (!window.confirm(`Bỏ block ${row.ip}? Các alert block đang mở của IP này cũng sẽ được đóng.`)) return;
    void action.run(() => unblockIp(row.ip), () => states.reload());
  }

  function ingest(logPath: string) {
    setIngestResult(null);
    void action.run(
      async () => {
        const result = await ingestTraffic(logPath);
        setIngestResult(result);
      },
      // Ingest re-evaluates every IP it saw, so the states list is stale.
      () => states.reload(),
    );
  }

  return (
    <>
      <IngestPanel busy={action.busy} result={ingestResult} onIngest={ingest} />

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">IP rules</h2>
          <button
            type="button"
            onClick={apply}
            disabled={action.busy}
            className="rounded border border-slate-300 bg-white px-3 py-1 text-sm disabled:opacity-40"
          >
            Áp dụng rule
          </button>
        </div>

        {action.actionError && (
          <p role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {action.actionError}
          </p>
        )}

        {applyResult && (
          <p className="rounded border border-slate-200 bg-white p-3 text-sm">
            {`matched: ${applyResult.matched} · alerts_created: ${applyResult.alerts_created}`}
          </p>
        )}

        <IpRuleForm
          editing={editing}
          busy={action.busy}
          onCreate={create}
          onUpdate={update}
          onCancelEdit={() => setEditing(null)}
        />

        {rules.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

        {!rules.loading && rules.error && (
          <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{rules.error}</p>
            <button
              type="button"
              onClick={rules.reload}
              className="rounded border border-red-300 px-3 py-1 text-sm"
            >
              Thử lại
            </button>
          </div>
        )}

        {!rules.loading && !rules.error && (
          <IpRulesTable
            rules={ruleList}
            busy={action.busy}
            onToggle={toggle}
            onEdit={setEditing}
            onDelete={remove}
          />
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Trạng thái IP</h2>
          <label className="text-sm">
            <span className="mr-2 text-slate-600">Trạng thái</span>
            <select
              aria-label="Lọc trạng thái"
              value={status}
              onChange={(event) =>
                // Always back to the first page: page 3 of a narrower result is blank.
                setSearchParams(statesUrlParams(event.target.value, 0), { replace: true })
              }
              className="rounded border border-slate-300 px-2 py-1"
            >
              <option value="">tất cả</option>
              <option value="ok">ok</option>
              <option value="throttled">throttled</option>
              <option value="temp_blocked">temp_blocked</option>
              <option value="perm_blocked">perm_blocked</option>
            </select>
          </label>
        </div>

        {states.loading && <p className="p-6 text-center text-slate-600">Đang tải…</p>}

        {!states.loading && states.error && (
          <div role="alert" className="space-y-3 rounded border border-red-200 bg-red-50 p-4">
            <p className="text-sm text-red-800">{states.error}</p>
            <button
              type="button"
              onClick={states.reload}
              className="rounded border border-red-300 px-3 py-1 text-sm"
            >
              Thử lại
            </button>
          </div>
        )}

        {!states.loading && !states.error && states.data && (
          <>
            <IpStatesTable states={states.data.items} busy={action.busy} onUnblock={unblock} />
            <div className="flex items-center justify-between text-sm">
              <span>{`${states.data.items.length} / ${states.data.total}`}</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={statesOffset === 0}
                  onClick={() => setSearchParams(statesUrlParams(status, Math.max(0, statesOffset - STATES_PAGE_SIZE)))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={statesOffset + states.data.items.length >= states.data.total}
                  onClick={() => setSearchParams(statesUrlParams(status, statesOffset + STATES_PAGE_SIZE))}
                  className="rounded border border-slate-300 px-3 py-1 disabled:opacity-40"
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}
