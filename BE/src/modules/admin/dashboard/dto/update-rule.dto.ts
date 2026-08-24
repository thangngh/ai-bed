import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { RuleAction } from '../entities/ip-rule.entity';

/**
 * `updateIpRule` in dashboard.service.ts only ever reads action/enabled/
 * tier/note (see the `patch` param there) -- id/type/pattern are immutable
 * after creation. This mirrors exactly that shape, not RuleDto's shape,
 * so every field this DTO declares is one the service actually consumes;
 * whitelist: true would otherwise silently strip a field the service reads.
 */
export class UpdateRuleDto {
  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: RuleAction;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // 32 matches the ip_rules.tier column width; must stay in sync with RuleDto.
  @IsOptional()
  @IsString()
  @MaxLength(32)
  tier?: string;

  @IsOptional()
  @IsString()
  note?: string | null;
}
