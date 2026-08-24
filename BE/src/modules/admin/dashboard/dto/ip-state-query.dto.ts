import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { IpStatus } from '../entities/ip-state.entity';

const IP_STATUSES: IpStatus[] = ['ok', 'throttled', 'temp_blocked', 'perm_blocked'];

export class IpStateQueryDto {
  @IsOptional()
  @IsIn(IP_STATUSES)
  status?: IpStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
