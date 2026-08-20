import React, { useEffect, useState } from 'react';
import type { CreateRuleBody, IpRule, RuleAction, RuleType, UpdateRuleBody } from './dashboardTypes';

interface Props {
  /** null = create mode; a rule = edit mode. */
  editing: IpRule | null;
  busy: boolean;
  onCreate: (body: CreateRuleBody) => void;
  onUpdate: (id: number, patch: UpdateRuleBody) => void;
  onCancelEdit: () => void;
}

/**
 * Inline, not a modal: no other admin screen has one, and a modal would need
 * its own focus and dismissal handling for no gain here.
 *
 * `pattern` is checked only for emptiness. The BE deliberately does not
 * shape-check it (debt #9), and a stricter FE regex would make the two sides
 * disagree with the operator unable to tell which one to believe.
 */
export default function IpRuleForm({ editing, busy, onCreate, onUpdate, onCancelEdit }: Props) {
  const [type, setType] = useState<RuleType>('ip');
  const [pattern, setPattern] = useState('');
  const [action, setAction] = useState<RuleAction>('deny');
  const [tier, setTier] = useState('default');
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLocalError(null);
    if (!editing) {
      setType('ip'); setPattern(''); setAction('deny'); setTier('default'); setNote('');
      return;
    }
    setType(editing.type);
    setPattern(editing.pattern);
    setAction(editing.action);
    setTier(editing.tier);
    setNote(editing.note ?? '');
  }, [editing]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = pattern.trim();
    if (!trimmed) {
      setLocalError('Pattern không được để trống');
      return;
    }
    setLocalError(null);
    const noteValue = note.trim() ? note.trim() : null;

    if (editing) {
      // PATCH accepts action/enabled/tier/note only -- type and pattern are
      // immutable, which is why both inputs are read-only in edit mode.
      onUpdate(editing.id, { action, tier: tier.trim() || 'default', note: noteValue });
      return;
    }
    onCreate({ type, pattern: trimmed, action, tier: tier.trim() || 'default', note: noteValue });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{editing ? `Sửa rule #${editing.id}` : 'Thêm rule'}</h2>

      <div className="flex flex-wrap gap-3">
        <label className="text-sm">
          <span className="block text-slate-600">Loại</span>
          <select
            aria-label="Loại"
            value={type}
            disabled={!!editing || busy}
            onChange={(e) => setType(e.target.value as RuleType)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="ip">ip</option>
            <option value="cidr">cidr</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Pattern</span>
          <input
            aria-label="Pattern"
            value={pattern}
            readOnly={!!editing}
            disabled={busy}
            onChange={(e) => setPattern(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1 read-only:bg-slate-100"
          />
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Hành động</span>
          <select
            aria-label="Hành động"
            value={action}
            disabled={busy}
            onChange={(e) => setAction(e.target.value as RuleAction)}
            className="rounded border border-slate-300 px-2 py-1"
          >
            <option value="deny">deny</option>
            <option value="allow">allow</option>
          </select>
        </label>

        <label className="text-sm">
          <span className="block text-slate-600">Tier</span>
          <input
            aria-label="Tier"
            value={tier}
            disabled={busy}
            onChange={(e) => setTier(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="block text-slate-600">Ghi chú</span>
        <textarea
          aria-label="Ghi chú"
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          className="w-full rounded border border-slate-300 px-2 py-1"
          rows={2}
        />
      </label>

      {localError && <p role="alert" className="text-sm text-red-700">{localError}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-40"
        >
          {editing ? 'Lưu rule' : 'Tạo rule'}
        </button>
        {editing && (
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={busy}
            className="rounded border border-slate-300 px-3 py-1 text-sm"
          >
            Huỷ
          </button>
        )}
      </div>

      {!editing && (
        <p className="text-xs text-slate-500">
          Không đổi được loại và pattern sau khi tạo — muốn đổi thì xoá rồi tạo lại.
        </p>
      )}
    </form>
  );
}
