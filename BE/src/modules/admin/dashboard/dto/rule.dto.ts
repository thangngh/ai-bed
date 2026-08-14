import { IsInt, IsOptional } from 'class-validator';
import { RuleAction, RuleType } from '../entities/ip-rule.entity';

export class RuleDto {
  @IsOptional() @IsInt() id?: number;
  type: RuleType;
  pattern: string;
  action: RuleAction;
  tier: string = 'default';
  note?: string | null;
}
