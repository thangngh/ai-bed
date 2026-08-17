import { DataSource } from 'typeorm';
import { DashboardService } from '../services/dashboard.service';
import { TrafficEvent } from '../entities/traffic-event.entity';
import { TrafficHourly } from '../entities/traffic-hourly.entity';
import { LlmUsageEvent } from '../entities/llm-usage-event.entity';
import { LlmUsageHourly } from '../entities/llm-usage-hourly.entity';
import { IpRule } from '../entities/ip-rule.entity';
import { IpState } from '../entities/ip-state.entity';
import { Alert } from '../entities/alert.entity';
import { AdminSetting } from '../entities/admin-setting.entity';
import { ConfigService } from '@nestjs/config';
import { makeDataSource } from '../../../../common/__tests__/test-db';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const ALL_ENTITIES = [
  TrafficEvent, TrafficHourly, LlmUsageEvent, LlmUsageHourly,
  IpRule, IpState, Alert, AdminSetting,
];

function mockConfigService(): ConfigService {
  return {
    get: jest.fn((key: string, def?: any) => {
      if (key === 'DASHBOARD_NGINX_LOG_FORMAT') return 'auto';
      if (key === 'DASHBOARD_DDOS_WINDOW_MS') return 60000;
      if (key === 'engine.provider') return 'openai';
      if (key === 'engine.model') return 'gpt-4o-mini';
      return def;
    }),
  } as unknown as ConfigService;
}

describe('DashboardService', () => {
  let ds: DataSource;
  let service: DashboardService;

  beforeEach(async () => {
    ds = makeDataSource(ALL_ENTITIES);
    await ds.initialize();
    service = new DashboardService(
      ds.getRepository(TrafficEvent),
      ds.getRepository(TrafficHourly),
      ds.getRepository(LlmUsageEvent),
      ds.getRepository(LlmUsageHourly),
      ds.getRepository(IpRule),
      ds.getRepository(IpState),
      ds.getRepository(Alert),
      ds.getRepository(AdminSetting),
      mockConfigService(),
    );
  });

  afterEach(async () => { await ds.destroy(); });

  describe('trafficOverview', () => {
    beforeEach(async () => {
      await ds.getRepository(TrafficHourly).save([
        Object.assign(new TrafficHourly(), {
          ip: '10.0.0.1', hourBucket: '2026-08-14T10', route: '/api/story/create',
          statusClass: '2xx', reqCount: 100, bytesIn: 50000, bytesOut: 120000, latAvgMs: 800, latP95Ms: 1500,
        }),
        Object.assign(new TrafficHourly(), {
          ip: '10.0.0.2', hourBucket: '2026-08-14T10', route: '/api/story/create',
          statusClass: '5xx', reqCount: 2, bytesIn: 1000, bytesOut: 500, latAvgMs: 5000, latP95Ms: 5000,
        }),
        Object.assign(new TrafficHourly(), {
          ip: '10.0.0.3', hourBucket: '2026-08-14T11', route: '/api/child-profile',
          statusClass: '2xx', reqCount: 50, bytesIn: 10000, bytesOut: 20000, latAvgMs: 300, latP95Ms: 600,
        }),
      ]);
      await ds.getRepository(TrafficEvent).save([
        Object.assign(new TrafficEvent(), { ip: '10.0.0.1', route: '/api/story/create', method: 'POST', status: 200, bytesIn: 500, bytesOut: 1200, latMs: 0.8, ts: '2026-08-14T10:00:00' }),
        Object.assign(new TrafficEvent(), { ip: '10.0.0.2', route: '/api/story/create', method: 'POST', status: 200, bytesIn: 500, bytesOut: 1200, latMs: 0.8, ts: '2026-08-14T10:00:00' }),
        Object.assign(new TrafficEvent(), { ip: '10.0.0.3', route: '/api/child-profile', method: 'GET', status: 200, bytesIn: 100, bytesOut: 200, latMs: 0.3, ts: '2026-08-14T11:00:00' }),
      ]);
    });

    it('aggregates total requests, bytes, and unique IPs', async () => {
      const result = await service.trafficOverview({} as any);
      expect(result.requests).toBe(152);
      expect(result.bytes_in).toBe(61000);
      expect(result.bytes_out).toBe(140500);
      expect(result.unique_ips).toBe(3);
    });

    it('counts 5xx and 4xx errors separately', async () => {
      const result = await service.trafficOverview({} as any);
      expect(result.error_5xx).toBe(2);
      expect(result.error_4xx).toBe(0);
    });

    it('returns hourly trend sorted by hour', async () => {
      const result = await service.trafficOverview({} as any);
      expect(result.hourly).toHaveLength(2);
      expect(result.hourly[0].hour).toBe('2026-08-14T10');
      expect(result.hourly[1].hour).toBe('2026-08-14T11');
    });

    it('returns status distribution grouped by class', async () => {
      const result = await service.trafficOverview({} as any);
      const dist = result.status_dist;
      expect(dist).toContainEqual({ status_class: '2xx', requests: 150 });
      expect(dist).toContainEqual({ status_class: '5xx', requests: 2 });
    });

    it('returns top routes by request count', async () => {
      const result = await service.trafficOverview({} as any);
      expect(result.top_routes).toHaveLength(2);
      expect(result.top_routes[0].route).toBe('/api/story/create');
      expect(result.top_routes[0].requests).toBe(102);
    });

    it('filters by date range', async () => {
      const result = await service.trafficOverview({ from: '2026-08-14T11', to: '2026-08-14T11' } as any);
      expect(result.requests).toBe(50);
      expect(result.hourly).toHaveLength(1);
    });
  });

  describe('trafficEvents', () => {
    beforeEach(async () => {
      await ds.getRepository(TrafficEvent).save([
        Object.assign(new TrafficEvent(), { ip: '10.0.0.1', route: '/api/x', method: 'GET', status: 200, bytesIn: 0, bytesOut: 100, latMs: 10, ts: '2026-08-14T10:00:00' }),
        Object.assign(new TrafficEvent(), { ip: '10.0.0.2', route: '/api/y', method: 'POST', status: 500, bytesIn: 0, bytesOut: 200, latMs: 20, ts: '2026-08-14T10:00:00' }),
        Object.assign(new TrafficEvent(), { ip: '10.0.0.1', route: '/api/x', method: 'GET', status: 404, bytesIn: 0, bytesOut: 50, latMs: 5, ts: '2026-08-14T11:00:00' }),
      ]);
    });

    it('returns paginated raw events sorted by ts desc', async () => {
      const page = await service.trafficEvents({ limit: 50, offset: 0 } as any);
      expect(page.total).toBe(3);
      expect(page.items[0].ts).toBe('2026-08-14T11:00:00');
    });

    it('filters by IP', async () => {
      const page = await service.trafficEvents({ limit: 50, ip: '10.0.0.1' } as any);
      expect(page.total).toBe(2);
    });

    it('filters by status code', async () => {
      const page = await service.trafficEvents({ limit: 50, status: 500 } as any);
      expect(page.total).toBe(1);
      expect(page.items[0].ip).toBe('10.0.0.2');
    });
  });

  describe('ingestTraffic', () => {
    let logFile: string;

    beforeEach(async () => {
      logFile = join(tmpdir(), `test_nginx_${Date.now()}.log`);
      const lines = [
        '192.168.1.50 - - [14/Aug/2026:10:30:00 +0000] "GET /api/story/create HTTP/1.1" 200 1234 567 89',
        '192.168.1.50 - - [14/Aug/2026:10:30:01 +0000] "POST /api/story/create HTTP/1.1" 200 2345 678 120',
        '10.0.0.99 - - [14/Aug/2026:10:30:02 +0000] "GET /api/child-profile HTTP/1.1" 404 100 20 5',
      ];
      writeFileSync(logFile, lines.join('\n') + '\n');
    });

    afterEach(() => { import('fs').then((m) => { try { m.unlinkSync(logFile); } catch {} }); });

    it('parses nginx log lines into traffic_event rows', async () => {
      const result = await service.ingestTraffic({ logPath: logFile });
      expect(result.ingested).toBe(3);
      expect(result.skipped).toBe(0);
      const events = await ds.getRepository(TrafficEvent).find();
      expect(events).toHaveLength(3);
      expect(events[0].ip).toBe('192.168.1.50');
      expect(events[0].route).toBe('/api/story/create');
      expect(events[0].status).toBe(200);
      expect(events[0].bytesOut).toBe(1234);
      expect(events[0].bytesIn).toBe(567);
      expect(events[0].latMs).toBe(89);
    });

    it('rolls up hourly traffic', async () => {
      await service.ingestTraffic({ logPath: logFile });
      const hourly = await ds.getRepository(TrafficHourly).find();
      expect(hourly.length).toBeGreaterThan(0);
      const row = hourly.find((h) => h.ip === '192.168.1.50');
      expect(row).toBeDefined();
      expect(row!.reqCount).toBe(2);
      expect(row!.bytesOut).toBe(3579);
      expect(row!.bytesIn).toBe(1245);
      expect(row!.latP95Ms).toBe(120);
    });

    it('updates ip_state scores during ingest', async () => {
      await ds.getRepository(AdminSetting).save([
        Object.assign(new AdminSetting(), { key: 'ddos.throttle_threshold', value: '50' }),
        Object.assign(new AdminSetting(), { key: 'ddos.perm_threshold', value: '500' }),
      ]);
      await service.ingestTraffic({ logPath: logFile });
      const state = await ds.getRepository(IpState).findOne({ where: { ip: '192.168.1.50' } });
      expect(state).toBeDefined();
      expect(state!.score).toBe(2);
      expect(state!.status).toBe('ok');
    });

    it('rejects a missing log file', async () => {
      await expect(service.ingestTraffic({ logPath: '/nonexistent/path.log' })).rejects.toThrow();
    });

    it('skips malformed lines', async () => {
      const badFile = join(tmpdir(), `bad_${Date.now()}.log`);
      writeFileSync(badFile, 'this is not a log line\n192.168.1.1 - - [14/Aug/2026:10:30:00 +0000] "GET /api/test HTTP/1.1" 200 100 50 10\n');
      const result = await service.ingestTraffic({ logPath: badFile });
      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(1);
    });
  });

  describe('IP rules', () => {
    it('creates and lists IP rules', async () => {
      await service.createIpRule({ type: 'cidr', pattern: '10.0.0.0/8', action: 'deny', tier: 'default', note: 'block internal' } as any);
      const rules = await service.listIpRules();
      expect(rules).toHaveLength(1);
      expect(rules[0].action).toBe('deny');
      expect(rules[0].pattern).toBe('10.0.0.0/8');
      expect(rules[0].enabled).toBe(true);
    });

    it('updates a rule by id', async () => {
      const rule = await service.createIpRule({ type: 'ip', pattern: '10.0.0.5', action: 'allow', tier: 'admin' } as any);
      const updated = await service.updateIpRule(rule.id, { enabled: false, note: 'disabled' });
      expect(updated!.enabled).toBe(false);
      expect(updated!.note).toBe('disabled');
    });

    it('returns null when updating a non-existent rule', async () => {
      const result = await service.updateIpRule(999, { enabled: false });
      expect(result).toBeNull();
    });

    it('deletes a rule by id', async () => {
      const rule = await service.createIpRule({ type: 'ip', pattern: '10.0.0.5', action: 'allow', tier: 'admin' } as any);
      const ok = await service.deleteIpRule(rule.id);
      expect(ok).toBe(true);
      const rules = await service.listIpRules();
      expect(rules).toHaveLength(0);
    });

    it('matches exact IP for type=ip', async () => {
      const rule = await service.createIpRule({ type: 'ip', pattern: '10.0.0.5', action: 'deny' } as any);
      await ds.getRepository(IpState).save(Object.assign(new IpState(), { ip: '10.0.0.5', status: 'ok', score: 0, tier: 'default', autoBlocked: false }));
      const result = await service.applyIpRules();
      expect(result.matched).toBe(1);
    });
  });

  describe('IP states', () => {
    beforeEach(async () => {
      await ds.getRepository(AdminSetting).save([
        Object.assign(new AdminSetting(), { key: 'ddos.throttle_threshold', value: '50' }),
        Object.assign(new AdminSetting(), { key: 'ddos.perm_threshold', value: '500' }),
      ]);
    });

    it('lists ip states with pagination', async () => {
      await ds.getRepository(IpState).save([
        Object.assign(new IpState(), { ip: '10.0.0.1', status: 'ok', score: 5, tier: 'default', autoBlocked: false }),
        Object.assign(new IpState(), { ip: '10.0.0.2', status: 'throttled', score: 55, tier: 'default', autoBlocked: true, blockedUntil: '2026-08-14T11:00:00' }),
      ]);
      const page = await service.listIpStates({ limit: 50, offset: 0 });
      expect(page.total).toBe(2);
      expect(page.items[0].ip).toBe('10.0.0.2');
      expect(page.items[1].ip).toBe('10.0.0.1');
    });

    it('resolves ip state by IP', async () => {
      await ds.getRepository(IpState).save(Object.assign(new IpState(), { ip: '10.0.0.1', status: 'ok', score: 5, tier: 'default', autoBlocked: false }));
      const state = await service.getIpState('10.0.0.1');
      expect(state).not.toBeNull();
      expect(state!.status).toBe('ok');
    });

    it('returns null for unknown IP', async () => {
      const state = await service.getIpState('10.0.0.999');
      expect(state).toBeNull();
    });

    it('unblocks an IP and resolves related alerts', async () => {
      await ds.getRepository(IpState).save(Object.assign(new IpState(), { ip: '10.0.0.1', status: 'perm_blocked', score: 100, tier: 'default', autoBlocked: true, blockedUntil: null, reason: 'ddos' }));
      await ds.getRepository(Alert).save(Object.assign(new Alert(), { type: 'ddos_permanent', severity: 'critical', ip: '10.0.0.1', provider: null, detailJson: '{}', resolved: false }));
      await service.unblockIp('10.0.0.1');
      const state = await service.getIpState('10.0.0.1');
      expect(state!.status).toBe('ok');
      expect(state!.score).toBe(0);
      expect(state!.reason).toBeNull();
      const alerts = await ds.getRepository(Alert).find({ where: { ip: '10.0.0.1', resolved: false } });
      expect(alerts).toHaveLength(0);
    });
  });

  describe('DDoS detection during ingest', () => {
    let logFile: string;

    beforeEach(async () => {
      await ds.getRepository(AdminSetting).save([
        Object.assign(new AdminSetting(), { key: 'ddos.throttle_threshold', value: '3' }),
        Object.assign(new AdminSetting(), { key: 'ddos.perm_threshold', value: '100' }),
      ]);
      logFile = join(tmpdir(), `ddos_${Date.now()}.log`);
      const lines = [];
      for (let i = 0; i < 10; i++) {
        lines.push('10.0.0.99 - - [14/Aug/2026:10:30:0' + (i % 10) + ' +0000] "GET /api/story/create HTTP/1.1" 200 100 50 10');
      }
      writeFileSync(logFile, lines.join('\n') + '\n');
    });

    afterEach(() => { import('fs').then((m) => { try { m.unlinkSync(logFile); } catch {} }); });

    it('creates a throttled alert when IP exceeds threshold', async () => {
      const result = await service.ingestTraffic({ logPath: logFile });
      expect(result.alerts_created).toBeGreaterThan(0);
      const alerts = await ds.getRepository(Alert).find({ where: { ip: '10.0.0.99', resolved: false } });
      expect(alerts.length).toBeGreaterThan(0);
      expect(alerts[0].severity).toBe('warning');
      expect(alerts[0].type).toBe('ddos_throttled');
    });
  });

  describe('LLM usage', () => {
    it('records an LLM usage event', async () => {
      await service.recordLlmUsage({
        provider: 'openai', model: 'gpt-4o-mini', tenantId: 't1',
        promptTokens: 100, completionTokens: 500, latencyMs: 12000, isFallback: false,
      });
      const events = await ds.getRepository(LlmUsageEvent).find();
      expect(events).toHaveLength(1);
      expect(events[0].provider).toBe('openai');
      expect(events[0].model).toBe('gpt-4o-mini');
      expect(events[0].promptTokens).toBe(100);
      expect(events[0].completionTokens).toBe(500);
      expect(events[0].estCostUsd).toBeCloseTo(0.36, 1);
    });

    it('updates hourly rollup on subsequent calls', async () => {
      for (let i = 0; i < 3; i++) {
        await service.recordLlmUsage({
          provider: 'openai', model: 'gpt-4o-mini', tenantId: 't1',
          promptTokens: 100, completionTokens: 500, latencyMs: 10000, isFallback: i === 2,
        });
      }
      const hourly = await ds.getRepository(LlmUsageHourly).find();
      expect(hourly).toHaveLength(1);
      expect(hourly[0].requests).toBe(3);
      expect(hourly[0].promptTokens).toBe(300);
      expect(hourly[0].completionTokens).toBe(1500);
    });
  });

  describe('LLM overview', () => {
    beforeEach(async () => {
      await ds.getRepository(LlmUsageEvent).save([
        Object.assign(new LlmUsageEvent(), { provider: 'openai', model: 'gpt-4o-mini', tenantId: 't1', promptTokens: 100, completionTokens: 500, estCostUsd: 0.36, latencyMs: 12000, isFallback: false, ts: '2026-08-14T10:00:00' }),
        Object.assign(new LlmUsageEvent(), { provider: 'openai', model: 'gpt-4o-mini', tenantId: 't2', promptTokens: 80, completionTokens: 450, estCostUsd: 0.29, latencyMs: 10000, isFallback: false, ts: '2026-08-14T10:01:00' }),
        Object.assign(new LlmUsageEvent(), { provider: 'openai', model: 'gpt-4o-mini', tenantId: 't3', promptTokens: 50, completionTokens: 300, estCostUsd: 0.20, latencyMs: 8000, isFallback: true, ts: '2026-08-14T10:02:00' }),
        Object.assign(new LlmUsageEvent(), { provider: 'gemini', model: 'gemini-2.0-flash', tenantId: 't1', promptTokens: 90, completionTokens: 400, estCostUsd: 0.021, latencyMs: 5000, isFallback: false, ts: '2026-08-14T11:00:00' }),
      ]);
    });

    it('aggregates total calls, tokens, cost, and latency', async () => {
      const result = await service.llmOverview({} as any);
      expect(result.calls).toBe(4);
      expect(result.prompt_tokens).toBe(320);
      expect(result.completion_tokens).toBe(1650);
      expect(result.est_cost_usd).toBeCloseTo(0.871, 2);
      expect(result.avg_latency_ms).toBe(12500);
    });

    it('calculates fallback rate', async () => {
      const result = await service.llmOverview({} as any);
      expect(result.fallback_rate).toBe(0.25);
    });

    it('groups by provider', async () => {
      const result = await service.llmOverview({} as any);
      expect(result.providers).toHaveLength(2);
      const openai = result.providers.find((p) => p.provider === 'openai')!;
      expect(openai.calls).toBe(3);
      const gemini = result.providers.find((p) => p.provider === 'gemini')!;
      expect(gemini.calls).toBe(1);
    });

    it('groups by provider+model', async () => {
      const result = await service.llmOverview({} as any);
      expect(result.by_model).toHaveLength(2);
    });

    it('filters by date range', async () => {
      const result = await service.llmOverview({ from: '2026-08-14T11' } as any);
      expect(result.calls).toBe(1);
    });
  });

  describe('Alerts', () => {
    beforeEach(async () => {
      await ds.getRepository(Alert).save([
        Object.assign(new Alert(), { type: 'ddos_throttled', severity: 'warning', ip: '10.0.0.1', provider: null, detailJson: '{}', resolved: false, createdAt: '2026-08-14T10:00:00' }),
        Object.assign(new Alert(), { type: 'ddos_permanent', severity: 'critical', ip: '10.0.0.2', provider: null, detailJson: '{}', resolved: false, createdAt: '2026-08-14T10:00:00' }),
        Object.assign(new Alert(), { type: 'rule_applied', severity: 'info', ip: null, provider: null, detailJson: '{}', resolved: true, createdAt: '2026-08-14T09:00:00', resolvedAt: '2026-08-14T10:00:00' }),
      ]);
    });

    it('lists unresolved alerts sorted by created_at desc', async () => {
      const page = await service.listAlerts({ resolved: false, limit: 50, offset: 0 });
      expect(page.total).toBe(2);
      expect(page.items[0].severity).toBe('critical');
    });

    it('filters resolved alerts', async () => {
      const page = await service.listAlerts({ resolved: true, limit: 50, offset: 0 });
      expect(page.total).toBe(1);
      expect(page.items[0].type).toBe('rule_applied');
    });

    it('resolves an alert by id', async () => {
      const resolved = await service.resolveAlert(1);
      expect(resolved).not.toBeNull();
      expect(resolved!.resolved).toBe(true);
      expect(resolved!.resolvedAt).toBeDefined();
    });

    it('returns null for non-existent alert', async () => {
      const result = await service.resolveAlert(999);
      expect(result).toBeNull();
    });
  });

  describe('Settings', () => {
    it('returns empty object when no settings exist', async () => {
      const settings = await service.getSettings();
      expect(settings).toEqual({});
    });

    it('sets and gets a setting', async () => {
      await service.setSetting('ddos.throttle_threshold', '50');
      const settings = await service.getSettings();
      expect(settings['ddos.throttle_threshold']).toBe('50');
    });

    it('updates an existing setting value', async () => {
      await service.setSetting('ddos.throttle_threshold', '50');
      await service.setSetting('ddos.throttle_threshold', '100');
      const settings = await service.getSettings();
      expect(settings['ddos.throttle_threshold']).toBe('100');
    });
  });
});
