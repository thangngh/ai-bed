import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual, LessThanOrEqual } from 'typeorm';
import { ConfigService } from '@nestjs/config';
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

/** Cost per 1K tokens, USD. Rough OpenRouter free-tier pricing. */
const MODEL_COSTS: Record<string, { prompt: number; completion: number }> = {
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o': { prompt: 2.5, completion: 10.0 },
  'gemini-2.0-flash': { prompt: 0.035, completion: 0.35 },
  'google/gemma-4-26b-a4b-it:free': { prompt: 0, completion: 0 },
};

/** Running totals accumulated over traffic_hourly rows inside trafficOverview. */
interface TrafficAgg {
  requests: number;
  bytes_in: number;
  bytes_out: number;
  error_5xx: number;
  error_4xx: number;
  p95_latency_ms: number;
}

export interface TrafficOverview {
  requests: number;
  bytes_in: number;
  bytes_out: number;
  unique_ips: number;
  p95_latency_ms: number;
  error_5xx: number;
  error_4xx: number;
  hourly: { hour: string; requests: number; bytes_out: number; lat_p95_ms: number }[];
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
    @InjectRepository(TrafficEvent) private readonly trafficEventRepo: Repository<TrafficEvent>,
    @InjectRepository(TrafficHourly) private readonly trafficHourlyRepo: Repository<TrafficHourly>,
    @InjectRepository(LlmUsageEvent) private readonly llmEventRepo: Repository<LlmUsageEvent>,
    @InjectRepository(LlmUsageHourly) private readonly llmHourlyRepo: Repository<LlmUsageHourly>,
    @InjectRepository(IpRule) private readonly ipRuleRepo: Repository<IpRule>,
    @InjectRepository(IpState) private readonly ipStateRepo: Repository<IpState>,
    @InjectRepository(Alert) private readonly alertRepo: Repository<Alert>,
    @InjectRepository(AdminSetting) private readonly settingRepo: Repository<AdminSetting>,
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
      { requests: 0, bytes_in: 0, bytes_out: 0, error_5xx: 0, error_4xx: 0, p95_latency_ms: 0 },
    );

    const totalReqs = agg.requests;
    agg.p95_latency_ms =
      totalReqs > 0 ? Math.round(rows.reduce((s, r) => s + r.latP95Ms * r.reqCount, 0) / totalReqs) : 0;

    const ipWhere: any = {};
    if (from) ipWhere.ts = MoreThanOrEqual(from);
    if (to) ipWhere.ts = { ...ipWhere.ts, ...LessThanOrEqual(to) };
    const uniqueIps = await this.trafficEventRepo.count({ where: ipWhere });

    const statusDist = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select(['h.statusClass', 'SUM(h.reqCount) as requests'])
      .where(where)
      .groupBy('h.statusClass')
      .getRawMany();

    const topRoutes = await this.trafficHourlyRepo.createQueryBuilder('h')
      .select(['h.route', 'SUM(h.reqCount) as requests', 'SUM(h.bytesOut) as bytes_out'])
      .where(where)
      .groupBy('h.route')
      .orderBy('requests', 'DESC')
      .limit(10)
      .getRawMany();

    return {
      ...agg,
      unique_ips: uniqueIps,
      hourly: rows.map((r) => ({ hour: r.hourBucket, requests: r.reqCount, bytes_out: r.bytesOut, lat_p95_ms: Math.round(r.latP95Ms) })),
      status_dist: statusDist.map((r) => ({ status_class: r.statusClass, requests: Number(r.requests) })),
      top_routes: topRoutes.map((r) => ({ route: r.route, requests: Number(r.requests), bytes_out: Number(r.bytes_out) })),
    };
  }

  async trafficEvents(query: TrafficQueryDto & { ip?: string; route?: string; status?: number; limit?: number; offset?: number }): Promise<{ items: TrafficEvent[]; total: number; limit: number; offset: number }> {
    const { from, to } = this.parseRange(query);
    const where: any = {};
    if (from) where.ts = from;
    if (to) where.ts = { ...where.ts, ...LessThanOrEqual(to) };
    if (query.ip) where.ip = query.ip;
    if (query.route) where.route = query.route;
    if (query.status) where.status = query.status;
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    const [items, total] = await this.trafficEventRepo.findAndCount({ where, order: { ts: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  async ingestTraffic(dto: TrafficIngestDto): Promise<{ ingested: number; skipped: number; alerts_created: number }> {
    const fs = await import('node:fs');
    if (!fs.existsSync(dto.logPath)) {
      throw new BadRequestException(`Log file not found: ${dto.logPath}`);
    }

    const raw = fs.readFileSync(dto.logPath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    const logFormat = this.config.get<string>('DASHBOARD_NGINX_LOG_FORMAT', 'auto');
    const throttleThreshold = await this.getSetting('ddos.throttle_threshold', '50');
    const permThreshold = await this.getSetting('ddos.perm_threshold', '500');

    let ingested = 0;
    let skipped = 0;
    const ipCounts = new Map<string, number>();

    for (const line of lines) {
      const parsed = this.parseLogLine(line, logFormat);
      if (!parsed) {
        skipped++;
        continue;
      }

      const exists = await this.trafficEventRepo.findOne({
        where: { ip: parsed.ip!, ts: parsed.ts!, route: parsed.route!, method: parsed.method!, status: parsed.status! },
      });
      if (exists) {
        skipped++;
        continue;
      }

      await this.trafficEventRepo.save(Object.assign(new TrafficEvent(), parsed));
      ingested++;

      const hourBucket = parsed.ts!.slice(0, 13);
      await this.upsertHourly(parsed as TrafficEvent, hourBucket);

      const count = ipCounts.get(parsed.ip!) || 0;
      ipCounts.set(parsed.ip!, count + 1);
    }

    // DDoS detection: update ip_state scores and raise alerts.
    let alertsCreated = 0;
    const throttleNum = parseInt(throttleThreshold, 10);
    const permNum = parseInt(permThreshold, 10);

    for (const [ip, count] of ipCounts) {
      const score = await this.updateIpScore(ip, count);
      if (score >= permNum && score > 0) {
        const existing = await this.alertRepo.findOne({ where: { ip, type: 'ddos_permanent', resolved: false } });
        if (!existing) {
          await this.alertRepo.save(this.makeAlert('ddos_permanent', 'critical', ip, { req_count: count, threshold: permNum }));
          await this.ipStateRepo.update(ip, { status: 'perm_blocked' as IpStatus, blockedUntil: null });
          alertsCreated++;
        }
      } else if (score >= throttleNum) {
        const existing = await this.alertRepo.findOne({ where: { ip, type: 'ddos_throttled', resolved: false } });
        if (!existing) {
          await this.alertRepo.save(this.makeAlert('ddos_throttled', 'warning', ip, { req_count: count, threshold: throttleNum }));
          await this.ipStateRepo.update(ip, { status: 'throttled' as IpStatus, blockedUntil: null });
          alertsCreated++;
        }
      }
    }

    return { ingested, skipped, alerts_created: alertsCreated };
  }

  private async upsertHourly(event: TrafficEvent, hourBucket: string): Promise<void> {
    const statusClass = this.statusClass(event.status);
    const existing = await this.trafficHourlyRepo.findOne({
      where: { ip: event.ip, hourBucket, route: event.route, statusClass },
    });

    const lat = event.latMs || 0;
    if (existing) {
      await this.trafficHourlyRepo
        .createQueryBuilder()
        .update(TrafficHourly)
        .set({
          reqCount: () => `req_count + 1`,
          bytesIn: () => `bytes_in + ${event.bytesIn || 0}`,
          bytesOut: () => `bytes_out + ${event.bytesOut || 0}`,
          latAvgMs: existing.reqCount > 0 ? (existing.latAvgMs * existing.reqCount + lat) / (existing.reqCount + 1) : lat,
          latP95Ms: Math.max(existing.latP95Ms, lat),
        })
        .where({ ip: event.ip, hourBucket, route: event.route, statusClass })
        .execute();
    } else {
      await this.trafficHourlyRepo.save(Object.assign(new TrafficHourly(), {
        ip: event.ip,
        hourBucket,
        route: event.route,
        statusClass,
        reqCount: 1,
        bytesIn: event.bytesIn || 0,
        bytesOut: event.bytesOut || 0,
        latAvgMs: lat,
        latP95Ms: lat,
      }));
    }
  }

  private parseLogLine(line: string, format: string): Partial<TrafficEvent> | null {
    if (format === 'auto' || !format) {
      const re = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S+) [^"]*" (\d{3}) (\d+) (\d+)(?: (\d+))?/;
      const m = line.match(re);
      if (!m) return null;

      const [, ip, timeLocal, method, route, status, bytesOut, bytesIn, latMs] = m;
      const ts = this.parseNginxTime(timeLocal);

      return {
        ip,
        route,
        method,
        status: parseInt(status, 10),
        bytesIn: parseInt(bytesIn || '0', 10),
        bytesOut: parseInt(bytesOut, 10),
        latMs: parseFloat(latMs || '0'),
        ts,
      };
    }
    return null;
  }

  private parseNginxTime(timeLocal: string): string {
    const d = new Date(timeLocal.replace(/:/, ' '));
    if (isNaN(d.getTime())) {
      return new Date().toISOString().replace('T', ' ').slice(0, 19);
    }
    return d.toISOString().replace('T', ' ').slice(0, 19);
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

    let matched = 0;
    let alertsCreated = 0;

    for (const state of states) {
      const denyRule = enabledRules.find((rule) => rule.action === 'deny' && this.ipMatchesRule(state.ip, rule.type, rule.pattern));

      if (denyRule && state.status !== 'perm_blocked') {
        await this.ipStateRepo.update(state.ip, { status: 'perm_blocked' as IpStatus, blockedUntil: null });
        matched++;
        const existing = await this.alertRepo.findOne({ where: { ip: state.ip, type: 'rule_block', resolved: false } });
        if (!existing) {
          await this.alertRepo.save(this.makeAlert('rule_block', 'critical', state.ip, { rule_id: denyRule.id }));
          alertsCreated++;
        }
      }

      if (!denyRule && state.status === 'perm_blocked' && !state.autoBlocked) {
        await this.ipStateRepo.update(state.ip, { status: 'ok' as IpStatus, score: 0, blockedUntil: null });
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
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
    await this.ipStateRepo.update(ip, { status: 'ok', score: 0, blockedUntil: null, reason: null });
    await this.alertRepo.update({ ip, resolved: false }, { resolved: true, resolvedAt: now });
  }
  private async updateIpScore(ip: string, increment: number): Promise<number> {
    let state = await this.ipStateRepo.findOne({ where: { ip } });
    if (!state) {
      state = Object.assign(new IpState(), { ip, status: 'ok', tier: 'default', score: 0, autoBlocked: false });
    }
    state.score = (state.score || 0) + increment;
    if (!state.status || state.status === 'ok') {
      const permThresh = parseInt(await this.getSetting('ddos.perm_threshold', '500'), 10);
      const throttleThresh = parseInt(await this.getSetting('ddos.throttle_threshold', '50'), 10);
      state.status = state.score >= permThresh ? 'perm_blocked' :
                     state.score >= throttleThresh ? 'throttled' : 'ok';
    }
    await this.ipStateRepo.save(state);
    return state.score;
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
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);

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
          promptTokens: () => `prompt_tokens + ${params.promptTokens}`,
          completionTokens: () => `completion_tokens + ${params.completionTokens}`,
          requests: () => `requests + 1`,
          estCostUsd: () => `est_cost_usd + ${estCostUsd}`,
          latAvgMs: (existing.requests * existing.latAvgMs + params.latencyMs) / (existing.requests + 1),
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
    const key = model.toLowerCase();
    const rates = MODEL_COSTS[key] || MODEL_COSTS[provider.toLowerCase()] || { prompt: 0, completion: 0 };
    return (promptTokens / 1000) * rates.prompt + (completionTokens / 1000) * rates.completion;
  }

  async llmOverview(query: LlmQueryDto): Promise<LlmOverview> {
    const { from, to } = this.parseRange(query);
    const where: any = {};
    if (from) where.ts = MoreThanOrEqual(from);
    if (to) where.ts = { ...where.ts, ...LessThanOrEqual(to) };

    const [agg] = await this.llmEventRepo
      .createQueryBuilder('e')
      .select([
        'COUNT(*) as calls',
        'SUM(e.promptTokens) as prompt_tokens',
        'SUM(e.completionTokens) as completion_tokens',
        'SUM(e.estCostUsd) as est_cost_usd',
        'AVG(e.latencyMs) as avg_latency_ms',
        'SUM(CASE WHEN e.isFallback = 1 THEN 1 ELSE 0 END) as fallback_calls',
      ])
      .where(where)
      .getRawMany();

    const byProvider = await this.llmEventRepo
      .createQueryBuilder('e')
      .select(['e.provider', 'COUNT(*) as calls', 'SUM(e.estCostUsd) as est_cost_usd'])
      .where(where)
      .groupBy('e.provider')
      .getRawMany();

    const byModel = await this.llmEventRepo
      .createQueryBuilder('e')
      .select([
        'e.provider', 'e.model', 'COUNT(*) as calls',
        'SUM(e.promptTokens) as prompt_tokens',
        'SUM(e.completionTokens) as completion_tokens',
        'SUM(e.estCostUsd) as est_cost_usd',
      ])
      .where(where)
      .groupBy('e.provider')
      .addGroupBy('e.model')
      .getRawMany();

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
    const where: any = {};
    if (from) where.ts = MoreThanOrEqual(from);
    if (to) where.ts = { ...where.ts, ...LessThanOrEqual(to) };
    if (query.provider) where.provider = query.provider;
    if (query.model) where.model = query.model;
    const limit = Math.min(query.limit ?? 50, 200);
    const offset = query.offset ?? 0;
    const [items, total] = await this.llmEventRepo.findAndCount({ where, order: { ts: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  // ── Alerts ───────────────────────────────────────────────────

  async listAlerts(opts: { resolved?: boolean; limit?: number; offset?: number }): Promise<{ items: Alert[]; total: number; limit: number; offset: number }> {
    const where: any = {};
    if (opts.resolved !== undefined) where.resolved = opts.resolved;
    const limit = Math.min(opts.limit ?? 50, 200);
    const offset = opts.offset ?? 0;
    const [items, total] = await this.alertRepo.findAndCount({ where, order: { createdAt: 'DESC' }, take: limit, skip: offset });
    return { items, total, limit, offset };
  }

  async resolveAlert(id: number): Promise<Alert | null> {
    const alert = await this.alertRepo.findOne({ where: { id } });
    if (!alert) return null;
    alert.resolved = true;
    alert.resolvedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
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
      existing.updatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19);
      return this.settingRepo.save(existing);
    }
    return this.settingRepo.save(Object.assign(new AdminSetting(), { key, value }));
  }

  private async getSetting(key: string, defaultValue: string): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { key } });
    return row?.value ?? defaultValue;
  }

  private parseRange(query: { from?: string; to?: string }): { from?: string; to?: string } {
    return { from: query.from, to: query.to };
  }

  private hourlyWhere(from?: string, to?: string): any {
    if (!from && !to) return undefined;
    if (from && to) return { hourBucket: Between(from, to) };
    if (from) return { hourBucket: MoreThanOrEqual(from) };
    return { hourBucket: LessThanOrEqual(to!) };
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



