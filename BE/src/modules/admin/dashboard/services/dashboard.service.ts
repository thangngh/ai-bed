import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual, EntityManager, In } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as path from 'node:path';
import { TrafficEvent } from '../entities/traffic-event.entity';
import { TrafficHourly } from '../entities/traffic-hourly.entity';
import { LlmUsageEvent } from '../entities/llm-usage-event.entity';
import { LlmUsageHourly } from '../entities/llm-usage-hourly.entity';
import { IpRule, RuleType, RuleAction } from '../entities/ip-rule.entity';
import { IpState, IpStatus } from '../entities/ip-state.entity';
import { Alert, AlertSeverity } from '../entities/alert.entity';
import { AdminSetting } from '../entities/admin-setting.entity';
import { TrafficIngestDto } from '../dto/traffic-ingest.dto';
import { TrafficQueryDto } from '../dto/traffic-query.dto';
import { LlmQueryDto } from '../dto/llm-query.dto';
import { RangeQueryDto } from '../dto/range-query.dto';
import { RuleDto } from '../dto/rule.dto';
import { IpStateDto } from '../dto/ip-state.dto';

/** USD per 1,000,000 tokens. Published list prices; free tiers are zero. */
const MODEL_COSTS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o': { prompt: 2.5, completion: 10.0 },
  'gemini-2.0-flash': { prompt: 0.035, completion: 0.35 },
  'google/gemma-4-26b-a4b-it:free': { prompt: 0, completion: 0 },
};

const TOKENS_PER_COST_UNIT = 1_000_000;

/** Running totals accumulated over traffic_hourly rows inside trafficOverview. */
interface TrafficAgg {
  requests: number;
  bytes_in: number;
  bytes_out: number;
  error_5xx: number;
  error_4xx: number;
  p95_latency_max_ms: number;
}

export interface TrafficOverview {
  requests: number;
  bytes_in: number;
  bytes_out: number;
  unique_ips: number;
  p95_latency_max_ms: number;
  error_5xx: number;
  error_4xx: number;
  hourly: { hour: string; requests: number; bytes_out: number; lat_p95_max_ms: number }[];
  status_dist: { status_class: string; requests: number }[];
  top_routes: { route: string; requests: number; bytes_out: number }[];
}

export interface LlmOverview {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  est_cost_usd: number;
  avg_latency_ms: number;
  fallback_rate: number;
  providers: { provider: string; calls: number; est_cost_usd: number }[];
  by_model: { provider: string; model: string; calls: number; prompt_tokens: number; completion_tokens: number; est_cost_usd: number }[];
}

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    @InjectRepository(TrafficEvent, 'core') private readonly trafficEventRepo: Repository<TrafficEvent>,
    @InjectRepository(TrafficHourly, 'core') private readonly trafficHourlyRepo: Repository<TrafficHourly>,
    @InjectRepository(LlmUsageEvent, 'core') private readonly llmEventRepo: Repository<LlmUsageEvent>,
    @InjectRepository(LlmUsageHourly, 'core') private readonly llmHourlyRepo: Repository<LlmUsageHourly>,
    @InjectRepository(IpRule, 'core') private readonly ipRuleRepo: Repository<IpRule>,
    @InjectRepository(IpState, 'core') private readonly ipStateRepo: Repository<IpState>,
    @InjectRepository(Alert, 'core') private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AdminSetting, 'core') private readonly settingRepo: Repository<AdminSetting>,
    private readonly config: ConfigService,
  ) {}

  async trafficOverview(query: RangeQueryDto): Promise<TrafficOverview> {
    const { from, to } = this.parseRange(query);
    const where = this.hourlyWhere(from, to);
    const rows = await this.trafficHourlyRepo.find({ where, order: { hourBucket: 'ASC' } });

    const agg = rows.reduce<TrafficAgg>(
      (acc, r) => ({
        ...acc,
        requests: acc.requests + r.reqCount,
        bytes_in: acc.bytes_in + r.bytesIn,
        bytes_out: acc.bytes_out + r.bytesOut,
        error_5xx: acc.error_5xx + (r.statusClass.startsWith('5') ? r.reqCount : 0),
        error_4xx: acc.error_4xx + (r.statusClass.startsWith('4') ? r.reqCount : 0),
      }),
      { requests: 0, bytes_in: 0, bytes_out: 0, error_5xx: 0, error_4xx: 0, p95_latency_max_ms: 0 },
    );

    const totalReqs = agg.requests;
    agg.p95_latency_max_ms =
      totalReqs > 0 ? Math.round(rows.reduce((s, r) => s + r.latP95MaxMs * r.reqCount, 0) / totalReqs) : 0;

    const uniqueRow = await this.trafficEventRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.ip)', 'unique_ips')
      .where(this.eventWhere(from, to))
      .getRawOne<{ unique_ips: number }>();
    const uniqueIps = Number(uniqueRow?.unique_ips ?? 0);

    const statusDist = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select('h.statusClass', 'status_class')
      .addSelect('SUM(h.reqCount)', 'requests')
      .where(where)
      .groupBy('h.statusClass')
      .getRawMany<{ status_class: string; requests: string }>();

    const topRoutes = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select('h.route', 'route')
      .addSelect('SUM(h.reqCount)', 'requests')
      .addSelect('SUM(h.bytesOut)', 'bytes_out')
      .where(where)
      .groupBy('h.route')
      .orderBy('requests', 'DESC')
      .limit(10)
      .getRawMany<{ route: string; requests: string; bytes_out: string }>();

    return {
      ...agg,
      unique_ips: uniqueIps,
      hourly: this.rollupHourly(rows),
      status_dist: statusDist.map((r) => ({ status_class: r.status_class, requests: Number(r.requests) })),
      top_routes: topRoutes.map((r) => ({ route: r.route, requests: Number(r.requests), bytes_out: Number(r.bytes_out) })),
    };
  }

  /**
   * traffic_hourly is keyed by ip+route+status_class+hour, so a single hour has
   * many rows. The trend chart wants one point per hour.
   */
  private rollupHourly(rows: TrafficHourly[]): TrafficOverview['hourly'] {
    const byHour = new Map<string, { hour: string; requests: number; bytes_out: number; lat_p95_max_ms: number }>();
    for (const r of rows) {
      const cur = byHour.get(r.hourBucket) ?? { hour: r.hourBucket, requests: 0, bytes_out: 0, lat_p95_max_ms: 0 };
      cur.requests += r.reqCount;
      cur.bytes_out += r.bytesOut;
      cur.lat_p95_max_ms = Math.max(cur.lat_p95_max_ms, Math.round(r.latP95MaxMs));
      byHour.set(r.hourBucket, cur);
    }
    return [...byHour.values()].sort((a, b) => a.hour.localeCompare(b.hour));
  }

  async trafficEvents(query: TrafficQueryDto & { ip?: string; route?: string; status?: number; limit?: number; offset?: number }): Promise<{ items: TrafficEvent[]; total: number; limit: number; offset: number }> {
    const { from, to } = this.parseRange(query);
    const where: Record<string, unknown> = { ...this.eventWhere(from, to) };
    if (query.ip) where.ip = query.ip;
    if (query.route) where.route = query.route;
    if (query.status) where.status = query.status;
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    // `ts` is only second-granularity text; break ties on `id` so paging is
    // stable even when several rows share a timestamp second (see listAlerts).
    const [items, total] = await this.trafficEventRepo.findAndCount({ where, order: { ts: 'DESC', id: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  async ingestTraffic(dto: TrafficIngestDto): Promise<{ ingested: number; skipped: number; alerts_created: number }> {
    const fs = await import('node:fs');

    // Confine ingest to a configured directory. Without this, `logPath` is an
    // admin-controlled arbitrary-file-read: any file the process can read
    // (including .env) would be reachable via this endpoint.
    const logDir = path.resolve(this.config.get<string>('DASHBOARD_NGINX_LOG_DIR', '/var/log/nginx'));
    const resolvedPath = path.resolve(dto.logPath);
    if (!this.isWithinDir(logDir, resolvedPath)) {
      // Deliberately generic: echoing the rejected path back would turn this
      // error into an existence oracle for arbitrary paths.
      throw new BadRequestException('Log path is outside the configured log directory');
    }
    if (!fs.existsSync(resolvedPath)) {
      throw new BadRequestException('Log file not found');
    }
    // Reject a symlink whose real target escapes the configured directory.
    const realPath = fs.realpathSync(resolvedPath);
    if (!this.isWithinDir(logDir, realPath)) {
      throw new BadRequestException('Log path is outside the configured log directory');
    }

    const raw = fs.readFileSync(resolvedPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    const logFormat = this.config.get<string>('DASHBOARD_NGINX_LOG_FORMAT', 'auto');
    const thresholds = {
      throttle: parseInt(await this.getSetting('ddos.throttle_threshold', '50'), 10),
      perm: parseInt(await this.getSetting('ddos.perm_threshold', '500'), 10),
    };

    let ingested = 0;
    let skipped = 0;
    const ipCounts = new Map<string, number>();

    // One transaction: a mid-file failure must not leave a half-written rollup.
    // Both writes below go through `manager` (not `this.trafficEventRepo` /
    // `this.trafficHourlyRepo`), which run on the default query runner and
    // would otherwise silently execute outside this transaction.
    await this.trafficEventRepo.manager.transaction(async (manager) => {
      for (const line of lines) {
        const parsed = this.parseLogLine(line, logFormat);
        if (!parsed) {
          skipped++;
          continue;
        }

        // No tuple de-duplication here. A flood is many identical requests in
        // the same second; dropping them as "duplicates" would hide exactly the
        // signal this feature exists to detect. Replay safety is the caller's
        // job (the cron ingestor tails the log and never re-reads a slice).
        await manager.save(Object.assign(new TrafficEvent(), parsed));
        ingested++;

        await this.upsertHourly(manager, parsed as TrafficEvent, parsed.ts!.slice(0, 13));
        ipCounts.set(parsed.ip!, (ipCounts.get(parsed.ip!) ?? 0) + 1);
      }
    });

    let alertsCreated = 0;
    for (const [ip, count] of ipCounts) {
      const { status, changed } = await this.evaluateIp(ip, count, thresholds);
      if (!changed || status === 'ok') continue;

      const type = status === 'perm_blocked' ? 'ddos_permanent' : 'ddos_throttled';
      const severity: AlertSeverity = status === 'perm_blocked' ? 'critical' : 'warning';
      const threshold = status === 'perm_blocked' ? thresholds.perm : thresholds.throttle;
      const existing = await this.alertRepo.findOne({ where: { ip, type, resolved: false } });
      if (existing) continue;

      await this.alertRepo.save(this.makeAlert(type, severity, ip, { req_count: count, threshold }));
      alertsCreated++;
    }

    return { ingested, skipped, alerts_created: alertsCreated };
  }

  /**
   * `manager` is required, not optional: ingestTraffic must run this inside
   * its transaction's query runner. An optional param that silently fell
   * back to `this.trafficHourlyRepo` would re-introduce the bug where hourly
   * writes escape the transaction.
   */
  private async upsertHourly(manager: EntityManager, event: TrafficEvent, hourBucket: string): Promise<void> {
    const statusClass = this.statusClass(event.status);
    const existing = await manager.findOne(TrafficHourly, {
      where: { ip: event.ip, hourBucket, route: event.route, statusClass },
    });

    const lat = event.latMs || 0;
    if (existing) {
      await manager
        .createQueryBuilder()
        .update(TrafficHourly)
        .set({
          reqCount: () => 'req_count + 1',
          bytesIn: () => `bytes_in + :addIn`,
          bytesOut: () => `bytes_out + :addOut`,
          latAvgMs: existing.reqCount > 0 ? (existing.latAvgMs * existing.reqCount + lat) / (existing.reqCount + 1) : lat,
          latP95MaxMs: Math.max(existing.latP95MaxMs, lat),
        })
        .setParameters({ addIn: event.bytesIn || 0, addOut: event.bytesOut || 0 })
        .where({ ip: event.ip, hourBucket, route: event.route, statusClass })
        .execute();
    } else {
      await manager.save(Object.assign(new TrafficHourly(), {
        ip: event.ip,
        hourBucket,
        route: event.route,
        statusClass,
        reqCount: 1,
        bytesIn: event.bytesIn || 0,
        bytesOut: event.bytesOut || 0,
        latAvgMs: lat,
        latP95MaxMs: lat,
      }));
    }
  }

  private parseLogLine(line: string, format: string): Partial<TrafficEvent> | null {
    if (format === 'auto' || !format) {
      // Last group is nginx's $request_time, a float in SECONDS (e.g. "0.123"),
      // not an integer. Accept an optional decimal part so it actually matches.
      const re = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\d+) (\d+)(?: (\d+(?:\.\d+)?))?/;
      const m = line.match(re);
      if (!m) return null;

      const [, ip, timeLocal, method, route, status, bytesOut, bytesIn, requestTimeSec] = m;
      const ts = this.parseNginxTime(timeLocal);

      // Unit contract: nginx $request_time is seconds; traffic_event.latMs is
      // milliseconds. Convert here so every downstream consumer sees milliseconds.
      const latMs = requestTimeSec ? Math.round(parseFloat(requestTimeSec) * 1000) : 0;

      return {
        ip,
        route,
        method,
        status: parseInt(status, 10),
        bytesIn: parseInt(bytesIn || '0', 10),
        bytesOut: parseInt(bytesOut, 10),
        latMs,
        ts,
      };
    }
    return null;
  }

  private parseNginxTime(timeLocal: string): string {
    // nginx writes "14/Aug/2026:10:30:00 +0000"; swapping the first colon for a
    // space is what makes it parseable by Date.
    const d = new Date(timeLocal.replace(/:/, ' '));
    if (isNaN(d.getTime())) return this.nowIso();
    return d.toISOString().slice(0, 19);
  }

  /**
   * True when `target` is `baseDir` itself or strictly nested inside it.
   * A plain string-prefix compare would let a sibling like
   * `/var/log/nginx-evil` pass a check against base `/var/log/nginx`;
   * `path.relative` operates on path segments, so that case yields `..`.
   */
  private isWithinDir(baseDir: string, target: string): boolean {
    const rel = path.relative(baseDir, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  }

  private statusClass(status: number): string {
    if (status >= 500) return '5xx';
    if (status >= 400) return '4xx';
    if (status >= 300) return '3xx';
    return '2xx';
  }

  // ── IP rules & states ─────────────────────────────────────────

  async listIpRules(): Promise<IpRule[]> {
    return this.ipRuleRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createIpRule(dto: RuleDto): Promise<IpRule> {
    const rule = Object.assign(new IpRule(), {
      type: dto.type,
      pattern: dto.pattern,
      action: dto.action,
      tier: dto.tier,
      note: dto.note,
      enabled: true,
      createdBy: 'admin',
    });
    return this.ipRuleRepo.save(rule);
  }

  async updateIpRule(id: number, patch: Partial<{ action: RuleAction; enabled: boolean; tier: string; note: string | null }>): Promise<IpRule | null> {
    const rule = await this.ipRuleRepo.findOne({ where: { id } });
    if (!rule) return null;
    Object.assign(rule, patch);
    return this.ipRuleRepo.save(rule);
  }

  async deleteIpRule(id: number): Promise<boolean> {
    const res = await this.ipRuleRepo.delete(id);
    return (res.affected ?? 0) > 0;
  }

  async applyIpRules(): Promise<{ matched: number; alerts_created: number }> {
    const enabledRules = await this.ipRuleRepo.find({ where: { enabled: true }, order: { createdAt: 'ASC' } });
    const states = await this.ipStateRepo.find({ order: { updatedAt: 'DESC' } });

    // A deny rule naming a literal IP must take effect even if that IP has
    // never been seen in traffic yet, so seed a state for it.
    const known = new Set(states.map((s) => s.ip));
    const seeded: IpState[] = [];
    for (const rule of enabledRules) {
      if (rule.action !== 'deny' || rule.type !== 'ip' || known.has(rule.pattern)) continue;
      seeded.push(Object.assign(new IpState(), {
        ip: rule.pattern, status: 'ok' as IpStatus, tier: rule.tier, score: 0, autoBlocked: false,
      }));
      known.add(rule.pattern);
    }
    if (seeded.length) await this.ipStateRepo.save(seeded);

    let matched = 0;
    let alertsCreated = 0;

    for (const state of [...states, ...seeded]) {
      const denyRule = enabledRules.find(
        (rule) => rule.action === 'deny' && this.ipMatchesRule(state.ip, rule.type, rule.pattern),
      );

      if (denyRule && state.status !== 'perm_blocked') {
        await this.ipStateRepo.update(state.ip, {
          status: 'perm_blocked' as IpStatus, blockedUntil: null, updatedAt: this.nowIso(),
        });
        matched++;
        const existing = await this.alertRepo.findOne({ where: { ip: state.ip, type: 'rule_block', resolved: false } });
        if (!existing) {
          await this.alertRepo.save(this.makeAlert('rule_block', 'critical', state.ip, { rule_id: denyRule.id }));
          alertsCreated++;
        }
      }

      // Only rule-driven blocks are lifted here; an auto (DDoS) block stands
      // until an admin unblocks it explicitly.
      if (!denyRule && state.status === 'perm_blocked' && !state.autoBlocked) {
        await this.ipStateRepo.update(state.ip, {
          status: 'ok' as IpStatus, score: 0, blockedUntil: null, updatedAt: this.nowIso(),
        });
      }
    }

    return { matched, alerts_created: alertsCreated };
  }

  private ipMatchesRule(ip: string, type: RuleType, pattern: string): boolean {
    if (type === 'ip') return ip === pattern;
    return this.cidrMatch(ip, pattern);
  }

  private cidrMatch(ip: string, cidr: string): boolean {
    const [network, prefixStr] = cidr.split('/');
    const prefix = parseInt(prefixStr, 10);
    if (!network || isNaN(prefix)) return false;

    const ipParts = ip.split('.').map(Number);
    const netParts = network.split('.').map(Number);
    if (ipParts.length !== 4 || netParts.length !== 4) return false;

    const ipNum = (ipParts[0] << 24) | (ipParts[1] << 16) | (ipParts[2] << 8) | ipParts[3];
    const netNum = (netParts[0] << 24) | (netParts[1] << 16) | (netParts[2] << 8) | netParts[3];
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipNum >>> 0 & mask) === (netNum >>> 0 & mask);
  }
  async listIpStates(opts: { status?: string; limit?: number; offset?: number }): Promise<{ items: IpState[]; total: number; limit: number; offset: number }> {
    const where: any = {};
    if (opts.status) where.status = opts.status;
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;
    const [items, total] = await this.ipStateRepo.findAndCount({ where, order: { score: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  async getIpState(ip: string): Promise<IpState | null> {
    return this.ipStateRepo.findOne({ where: { ip } });
  }

  async unblockIp(ip: string): Promise<void> {
    const now = this.nowIso();
    await this.ipStateRepo.update(ip, {
      status: 'ok', score: 0, blockedUntil: null, reason: null, autoBlocked: false, updatedAt: now,
    });
    // Only the block-related alerts; unrelated open alerts for this IP stand.
    await this.alertRepo.update(
      { ip, resolved: false, type: In(['ddos_throttled', 'ddos_permanent', 'rule_block']) },
      { resolved: true, resolvedAt: now },
    );
  }
  /**
   * The single place that decides an IP's status during ingest. Escalation is
   * monotonic: ok -> throttled -> perm_blocked. It never de-escalates; only
   * unblockIp() and applyIpRules() may do that.
   */
  private async evaluateIp(
    ip: string,
    batchCount: number,
    thresholds: { throttle: number; perm: number },
  ): Promise<{ score: number; status: IpStatus; changed: boolean }> {
    const state =
      (await this.ipStateRepo.findOne({ where: { ip } })) ??
      Object.assign(new IpState(), { ip, status: 'ok' as IpStatus, tier: 'default', score: 0, autoBlocked: false });

    const previous = state.status;
    state.score = (state.score || 0) + batchCount;

    const target: IpStatus =
      state.score >= thresholds.perm ? 'perm_blocked' :
      state.score >= thresholds.throttle ? 'throttled' : 'ok';

    if (this.severityRank(target) > this.severityRank(previous)) {
      state.status = target;
      state.autoBlocked = true;
      state.blockedUntil = null;
      state.reason = `ddos: ${state.score} requests`;
    }
    state.updatedAt = this.nowIso();
    await this.ipStateRepo.save(state);

    return { score: state.score, status: state.status, changed: state.status !== previous };
  }

  private severityRank(status: IpStatus): number {
    return { ok: 0, throttled: 1, temp_blocked: 2, perm_blocked: 3 }[status] ?? 0;
  }

  // ── LLM usage ─────────────────────────────────────────────────

  async recordLlmUsage(params: {
    provider: string;
    model: string;
    tenantId: string | null;
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    isFallback: boolean;
  }): Promise<void> {
    const estCostUsd = this.estimateCost(params.provider, params.model, params.promptTokens, params.completionTokens);
    const ts = this.nowIso();

    await this.llmEventRepo.save(Object.assign(new LlmUsageEvent(), {
      provider: params.provider,
      model: params.model,
      tenantId: params.tenantId,
      promptTokens: params.promptTokens,
      completionTokens: params.completionTokens,
      estCostUsd,
      latencyMs: params.latencyMs,
      isFallback: params.isFallback,
      ts,
    }));

    const hourBucket = ts.slice(0, 13);
    const existing = await this.llmHourlyRepo.findOne({ where: { provider: params.provider, model: params.model, hourBucket } });
    if (existing) {
      await this.llmHourlyRepo
        .createQueryBuilder()
        .update(LlmUsageHourly)
        .set({
          promptTokens: () => `prompt_tokens + :addPrompt`,
          completionTokens: () => `completion_tokens + :addCompletion`,
          requests: () => 'requests + 1',
          estCostUsd: () => `est_cost_usd + :addCost`,
          latAvgMs: (existing.requests * existing.latAvgMs + params.latencyMs) / (existing.requests + 1),
        })
        .setParameters({
          addPrompt: params.promptTokens,
          addCompletion: params.completionTokens,
          addCost: estCostUsd,
        })
        .where({ provider: params.provider, model: params.model, hourBucket })
        .execute();
    } else {
      await this.llmHourlyRepo.save(Object.assign(new LlmUsageHourly(), {
        provider: params.provider,
        model: params.model,
        hourBucket,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        requests: 1,
        estCostUsd,
        latAvgMs: params.latencyMs,
      }));
    }
  }

  private estimateCost(provider: string, model: string, promptTokens: number, completionTokens: number): number {
    const rates = MODEL_COSTS[model.toLowerCase()] ?? MODEL_COSTS[provider.toLowerCase()] ?? { prompt: 0, completion: 0 };
    return (promptTokens * rates.prompt + completionTokens * rates.completion) / TOKENS_PER_COST_UNIT;
  }

  async llmOverview(query: LlmQueryDto): Promise<LlmOverview> {
    const { from, to } = this.parseRange(query);
    const where = this.eventWhere(from, to);

    const [agg] = await this.llmEventRepo
      .createQueryBuilder('e')
      .select([
        'COUNT(*) as calls',
        'SUM(e.promptTokens) as prompt_tokens',
        'SUM(e.completionTokens) as completion_tokens',
        'SUM(e.estCostUsd) as est_cost_usd',
        'AVG(e.latencyMs) as avg_latency_ms',
        'SUM(CASE WHEN e.isFallback THEN 1 ELSE 0 END) as fallback_calls',
      ])
      .where(where)
      .getRawMany();

    const byProvider = await this.llmEventRepo
      .createQueryBuilder('e')
      .select('e.provider', 'provider')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(e.estCostUsd)', 'est_cost_usd')
      .where(where)
      .groupBy('e.provider')
      .getRawMany<{ provider: string; calls: string; est_cost_usd: string }>();

    const byModel = await this.llmEventRepo
      .createQueryBuilder('e')
      .select('e.provider', 'provider')
      .addSelect('e.model', 'model')
      .addSelect('COUNT(*)', 'calls')
      .addSelect('SUM(e.promptTokens)', 'prompt_tokens')
      .addSelect('SUM(e.completionTokens)', 'completion_tokens')
      .addSelect('SUM(e.estCostUsd)', 'est_cost_usd')
      .where(where)
      .groupBy('e.provider')
      .addGroupBy('e.model')
      .getRawMany<{ provider: string; model: string; calls: string; prompt_tokens: string; completion_tokens: string; est_cost_usd: string }>();

    const calls = Number(agg?.calls || 0);
    const fallbackCalls = Number(agg?.fallback_calls || 0);

    return {
      calls,
      prompt_tokens: Number(agg?.prompt_tokens || 0),
      completion_tokens: Number(agg?.completion_tokens || 0),
      est_cost_usd: Number(agg?.est_cost_usd || 0),
      avg_latency_ms: calls > 0 ? Math.round(Number(agg?.avg_latency_ms || 0)) : 0,
      fallback_rate: calls > 0 ? fallbackCalls / calls : 0,
      providers: byProvider.map((r) => ({ provider: r.provider, calls: Number(r.calls), est_cost_usd: Number(r.est_cost_usd) })),
      by_model: byModel.map((r) => ({
        provider: r.provider, model: r.model, calls: Number(r.calls),
        prompt_tokens: Number(r.prompt_tokens), completion_tokens: Number(r.completion_tokens),
        est_cost_usd: Number(r.est_cost_usd),
      })),
    };
  }
  async llmEvents(query: LlmQueryDto & { provider?: string; model?: string; limit?: number; offset?: number }): Promise<{ items: LlmUsageEvent[]; total: number; limit: number; offset: number }> {
    const { from, to } = this.parseRange(query);
    const where: Record<string, unknown> = { ...this.eventWhere(from, to) };
    if (query.provider) where.provider = query.provider;
    if (query.model) where.model = query.model;
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    const [items, total] = await this.llmEventRepo.findAndCount({ where, order: { ts: 'DESC', id: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  // ── Alerts ───────────────────────────────────────────────────

  async listAlerts(opts: { resolved?: boolean; limit?: number; offset?: number }): Promise<{ items: Alert[]; total: number; limit: number; offset: number }> {
    const where: any = {};
    if (opts.resolved !== undefined) where.resolved = opts.resolved;
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const [items, total] = await this.alertRepo.findAndCount({
      where, order: { createdAt: 'DESC', id: 'DESC' }, take: limit, skip: offset,
    });
    return { items, total, limit, offset };
  }

  async resolveAlert(id: number): Promise<Alert | null> {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) return null;
    alert.resolved = true;
    alert.resolvedAt = this.nowIso();
    return this.alertRepo.save(alert);
  }

  // ── Settings ─────────────────────────────────────────────────

  async getSettings(): Promise<Record<string, string>> {
    const rows = await this.settingRepo.find();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setSetting(key: string, value: string): Promise<AdminSetting> {
    const existing = await this.settingRepo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      existing.updatedAt = this.nowIso();
      return this.settingRepo.save(existing);
    }
    return this.settingRepo.save(Object.assign(new AdminSetting(), { key, value }));
  }

  private async getSetting(key: string, defaultValue: string): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { key } });
    return row?.value ?? defaultValue;
  }

  /** Canonical dashboard timestamp: YYYY-MM-DDTHH:mm:ss, UTC, no zone suffix. */
  private nowIso(): string {
    return new Date().toISOString().slice(0, 19);
  }

  private parseRange(query: { from?: string; to?: string }): { from?: string; to?: string } {
    return { from: query.from, to: query.to };
  }

  private hourlyWhere(from?: string, to?: string): Record<string, unknown> {
    if (from && to) return { hourBucket: Between(from, to) };
    if (from) return { hourBucket: MoreThanOrEqual(from) };
    if (to) return { hourBucket: LessThanOrEqual(to) };
    return {};
  }

  /**
   * Range filter for the raw event tables. `from`/`to` arrive as hour buckets
   * ("2026-08-14T10"); event timestamps are full seconds ("2026-08-14T10:30:00").
   * Widening `to` to the end of its hour keeps the two granularities aligned.
   */
  private eventWhere(from?: string, to?: string): Record<string, unknown> {
    const lo = from;
    const hi = to ? `${to.slice(0, 13)}:59:59` : undefined;
    if (lo && hi) return { ts: Between(lo, hi) };
    if (lo) return { ts: MoreThanOrEqual(lo) };
    if (hi) return { ts: LessThanOrEqual(hi) };
    return {};
  }

  private makeAlert(type: string, severity: AlertSeverity, ip: string | null, detail: Record<string, unknown>): Alert {
    return Object.assign(new Alert(), {
      type,
      severity,
      ip,
      provider: null,
      detailJson: JSON.stringify(detail),
      resolved: false,
    });
  }

  estimatePromptTokens(dto: { childName: string; theme: string; goal?: string; mood?: string; memories?: Array<{ value: string }> }): number {
    const text = [dto.childName, dto.theme, dto.goal || '', dto.mood || '', ...(dto.memories?.map((m) => m.value || '') || [])].join(' ');
    return Math.max(1, Math.round(text.length / 4));
  }
}



