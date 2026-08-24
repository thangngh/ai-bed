import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Query strings arrive as literal text, so `resolved=false` must not become
 * `true` the way plain `Boolean('false')` would. Only 'true'/'false' map to
 * a boolean; anything else is left as-is so @IsBoolean rejects it.
 */
function toBoolean({ value }: { value: unknown }): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}

export class AlertQueryDto {
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  resolved?: boolean;

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
