import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ArgumentMetadata, Type } from '@nestjs/common';
import { ValidationPipe } from '../../../../common/pipes/validation.pipe';
import { RangeQueryDto } from '../dto/range-query.dto';
import { TrafficQueryDto } from '../dto/traffic-query.dto';
import { LlmQueryDto } from '../dto/llm-query.dto';
import { IpStateQueryDto } from '../dto/ip-state-query.dto';
import { AlertQueryDto } from '../dto/alert-query.dto';
import { UpdateRuleDto } from '../dto/update-rule.dto';
import { RuleDto } from '../dto/rule.dto';

describe('RangeQueryDto', () => {
  it('accepts an hour bucket', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10', to: '2026-08-14T11' });
    expect(validateSync(dto)).toHaveLength(0);
  });

  it('rejects a full timestamp', () => {
    const dto = plainToInstance(RangeQueryDto, { from: '2026-08-14T10:30:00' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('rejects garbage', () => {
    const dto = plainToInstance(RangeQueryDto, { from: 'yesterday' });
    expect(validateSync(dto)).not.toHaveLength(0);
  });

  it('accepts an empty query', () => {
    const dto = plainToInstance(RangeQueryDto, {});
    expect(validateSync(dto)).toHaveLength(0);
  });
});

/**
 * Fix round 1: `trafficEvents`, `llmEvents`, `ipStates`, and `alerts` used to
 * take `@Query()` params typed as an intersection (`Dto & {...}`) or an
 * inline object literal. TypeScript can't express either shape in
 * `design:paramtypes` metadata, so Nest saw `Object` there, and
 * `ValidationPipe.toValidate()` treats `Object` as "nothing to validate" --
 * the pipe returned the raw query untouched. These tests exercise the pipe
 * directly (the same class the global pipe in main.ts uses) against the
 * DTOs those four handlers now declare, so a regression back to an
 * intersection/inline type would show up as a pipe that stops throwing.
 */
describe('ValidationPipe on the query DTOs used by previously-unvalidated handlers', () => {
  const pipe = new ValidationPipe();
  const queryMeta = (metatype: Type<any>): ArgumentMetadata => ({ type: 'query', metatype, data: undefined });

  describe('TrafficQueryDto (traffic/events)', () => {
    it('rejects a non-numeric status', async () => {
      await expect(
        pipe.transform({ status: 'not-a-number' }, queryMeta(TrafficQueryDto)),
      ).rejects.toThrow();
    });

    it('passes through valid fields without stripping them', async () => {
      const result = await pipe.transform(
        { ip: '10.0.0.1', route: '/api/x', status: '500', limit: '25', offset: '5' },
        queryMeta(TrafficQueryDto),
      );
      expect(result).toMatchObject({ ip: '10.0.0.1', route: '/api/x', status: 500, limit: 25, offset: 5 });
    });
  });

  describe('LlmQueryDto (llm/events)', () => {
    it('rejects a non-hour-bucket "from"', async () => {
      await expect(
        pipe.transform({ from: '2026-08-14T10:30:00' }, queryMeta(LlmQueryDto)),
      ).rejects.toThrow();
    });

    it('passes through valid fields without stripping them', async () => {
      const result = await pipe.transform(
        { provider: 'openai', model: 'gpt-4', limit: '10', offset: '0' },
        queryMeta(LlmQueryDto),
      );
      expect(result).toMatchObject({ provider: 'openai', model: 'gpt-4', limit: 10, offset: 0 });
    });
  });

  describe('IpStateQueryDto (ip/states)', () => {
    it('rejects a status outside the known IpStatus values', async () => {
      await expect(
        pipe.transform({ status: 'not-a-real-status' }, queryMeta(IpStateQueryDto)),
      ).rejects.toThrow();
    });

    it('passes through a valid status without stripping it', async () => {
      const result = await pipe.transform({ status: 'throttled', limit: '10' }, queryMeta(IpStateQueryDto));
      expect(result).toMatchObject({ status: 'throttled', limit: 10 });
    });
  });

  describe('AlertQueryDto (alerts)', () => {
    it('rejects a non-boolean "resolved"', async () => {
      await expect(
        pipe.transform({ resolved: 'not-a-boolean' }, queryMeta(AlertQueryDto)),
      ).rejects.toThrow();
    });

    it('treats resolved=false as false, not as truthy string coercion', async () => {
      const result = await pipe.transform({ resolved: 'false' }, queryMeta(AlertQueryDto));
      expect(result).toMatchObject({ resolved: false });
    });

    it('passes through resolved=true without stripping it', async () => {
      const result = await pipe.transform({ resolved: 'true', limit: '5' }, queryMeta(AlertQueryDto));
      expect(result).toMatchObject({ resolved: true, limit: 5 });
    });
  });
});

/**
 * Fix round 2: `updateIpRule` took `@Body() dto: Partial<RuleDto>`.
 * `Partial<T>` is a mapped type, which TypeScript also can't express in
 * `design:paramtypes` -- Nest saw `Object` there too, so this PATCH body
 * (which controls IP blocking) was never validated. Fixed by declaring a
 * real `UpdateRuleDto` class matching the fields dashboard.service.ts's
 * `updateIpRule` actually reads (action/enabled/tier/note).
 */
describe('ValidationPipe on UpdateRuleDto (PATCH ip/rules/:id)', () => {
  const pipe = new ValidationPipe();
  const bodyMeta: ArgumentMetadata = { type: 'body', metatype: UpdateRuleDto, data: undefined };

  it('rejects an action outside allow/deny', async () => {
    await expect(
      pipe.transform({ action: 'quarantine' }, bodyMeta),
    ).rejects.toThrow();
  });

  it('rejects a non-boolean enabled', async () => {
    await expect(
      pipe.transform({ enabled: 'yes' }, bodyMeta),
    ).rejects.toThrow();
  });

  it('passes through valid fields without stripping them', async () => {
    const result = await pipe.transform(
      { action: 'deny', enabled: false, tier: 'strict', note: 'manual block' },
      bodyMeta,
    );
    expect(result).toMatchObject({ action: 'deny', enabled: false, tier: 'strict', note: 'manual block' });
  });

  // Same column (ip_rules.tier, varchar(32)) as RuleDto's create path -- the
  // two DTOs must not disagree on the limit.
  it('rejects a tier longer than the ip_rules.tier column width (32)', async () => {
    await expect(
      pipe.transform({ tier: 'a'.repeat(33) }, bodyMeta),
    ).rejects.toThrow();
  });

  it('accepts a tier at exactly the column width (32)', async () => {
    const result: any = await pipe.transform({ tier: 'a'.repeat(32) }, bodyMeta);
    expect(result.tier).toBe('a'.repeat(32));
  });
});

/**
 * `createIpRule` reads type/pattern/action/tier/note from the POST body,
 * but RuleDto only decorated `id`. `whitelist: true` deletes every
 * undecorated property before the handler runs, so a fully valid body
 * arrived at createIpRule as `{}`.
 */
describe('ValidationPipe on RuleDto (POST ip/rules)', () => {
  const pipe = new ValidationPipe();
  const bodyMeta: ArgumentMetadata = { type: 'body', metatype: RuleDto, data: undefined };

  const valid = { type: 'ip', pattern: '10.0.0.9', action: 'deny', tier: 'default', note: 'probe' };

  it('keeps every field the service reads', async () => {
    const out: any = await pipe.transform({ ...valid }, bodyMeta);
    expect(out.type).toBe('ip');
    expect(out.pattern).toBe('10.0.0.9');
    expect(out.action).toBe('deny');
    expect(out.tier).toBe('default');
    expect(out.note).toBe('probe');
  });

  it('rejects a body with no type', async () => {
    await expect(pipe.transform({ pattern: '10.0.0.9', action: 'deny' }, bodyMeta)).rejects.toThrow();
  });

  it('rejects an unknown action', async () => {
    await expect(pipe.transform({ ...valid, action: 'drop' }, bodyMeta)).rejects.toThrow();
  });

  it('rejects an empty pattern', async () => {
    await expect(pipe.transform({ ...valid, pattern: '' }, bodyMeta)).rejects.toThrow();
  });

  it('defaults tier when the caller omits it', async () => {
    const out: any = await pipe.transform({ type: 'cidr', pattern: '10.0.0.0/24', action: 'deny' }, bodyMeta);
    expect(out.tier).toBe('default');
  });

  // ip_rules.tier is varchar(32) (see ip-rule.entity.ts); a longer value
  // would be silently truncated by the DB instead of rejected at the edge.
  it('rejects a tier longer than the ip_rules.tier column width (32)', async () => {
    await expect(
      pipe.transform({ ...valid, tier: 'a'.repeat(33) }, bodyMeta),
    ).rejects.toThrow();
  });

  it('accepts a tier at exactly the column width (32)', async () => {
    const out: any = await pipe.transform({ ...valid, tier: 'a'.repeat(32) }, bodyMeta);
    expect(out.tier).toBe('a'.repeat(32));
  });
});
