import React, { useState } from 'react';
import IpRuleForm from './IpRuleForm';
import IpRulesTable from './IpRulesTable';
import { applyIpRules, createIpRule, deleteIpRule, fetchIpRules, updateIpRule } from './dashboardClient';
import { useAdminAction, useAdminResource } from './useAdminResource';
import type { ApplyResult, CreateRuleBody, IpRule, UpdateRuleBody } from './dashboardTypes';

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
      () => rules.reload(),
    );
  }

  return (
    <>
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
    </>
  );
}
