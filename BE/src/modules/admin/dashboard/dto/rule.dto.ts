import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RuleAction, RuleType } from '../entities/ip-rule.entity';

/**
 * Every field here must carry a decorator. The global ValidationPipe runs
 * validate(..., { whitelist: true }), which deletes undecorated properties --
 * so an undecorated field is not "unvalidated", it is gone by the time
 * createIpRule reads it.
 *
 * `pattern` is deliberately not shape-checked: one regex covering IPv4, IPv6
 * and CIDR is easy to get subtly wrong, and erring strict would reject
 * patterns an operator legitimately needs. Logged as accepted debt #9.
 */
export class RuleDto {
  @IsOptional() @IsInt() id?: number;

  @IsIn(['ip', 'cidr'])
  type!: RuleType;

  // 64 matches the ip_rules.pattern column width.
  @IsString() @IsNotEmpty() @MaxLength(64)
  pattern!: string;

  @IsIn(['allow', 'deny'])
  action!: RuleAction;

  @IsOptional() @IsString()
  tier: string = 'default';

  @IsOptional() @IsString()
  note?: string | null;
}
