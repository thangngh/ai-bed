/**
 * These shapes are camelCase because the dashboard list endpoints return
 * TypeORM entities verbatim (`blockedUntil`, `detailJson`, `createdAt`).
 * `types.ts` in this folder is snake_case because the feedback endpoint builds
 * its rows by hand, and the traffic/LLM endpoints are snake_case too.
 *
 * Both conventions therefore live side by side here. That is deliberate: a
 * normalizing layer would hide the fact that the BE is inconsistent and make
 * these types impossible to diff against a real response.
 */

export type RuleType = 'ip' | 'cidr';
export type RuleAction = 'allow' | 'deny';

// 'temp_blocked' is reserved on the BE: validated and ranked, but no code path
// assigns it yet. Keep it so a future BE change does not render a blank cell.
export type IpStatus = 'ok' | 'throttled' | 'temp_blocked' | 'perm_blocked';

export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface IpRule {
  id: number;
  type: RuleType;
  pattern: string;
  action: RuleAction;
  tier: string;
  note: string | null;
  createdBy: string;
  createdAt: string;
  enabled: boolean;
}

export interface IpState {
  ip: string;
  status: IpStatus;
  tier: string;
  score: number;
  blockedUntil: string | null;
  autoBlocked: boolean;
  reason: string | null;
  updatedAt: string;
}

export interface Alert {
  id: number;
  type: string;
  severity: AlertSeverity;
  ip: string | null;
  provider: string | null;
  /** A string containing JSON, not an object. Shape varies by `type`. */
  detailJson: string;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/** Mirrors RuleDto. `id` is server-assigned and never sent. */
export interface CreateRuleBody {
  type: RuleType;
  pattern: string;
  action: RuleAction;
  tier?: string;
  note?: string | null;
}

/** Mirrors UpdateRuleDto: type and pattern are immutable after creation. */
export interface UpdateRuleBody {
  action?: RuleAction;
  enabled?: boolean;
  tier?: string;
  note?: string | null;
}

export interface IngestResult {
  ingested: number;
  skipped: number;
  alerts_created: number;
}

export interface ApplyResult {
  matched: number;
  alerts_created: number;
}

export interface DeletedResult {
  deleted: true;
}

export interface UnblockedResult {
  unblocked: true;
}
