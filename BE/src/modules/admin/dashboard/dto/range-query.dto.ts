import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Canonical hour bucket: YYYY-MM-DDTHH. See spec §4.1. */
export const HOUR_BUCKET_RE = /^\d{4}-\d{2}-\d{2}T\d{2}$/;

export class RangeQueryDto {
  @IsOptional()
  @Matches(HOUR_BUCKET_RE, { message: 'from must be an hour bucket, e.g. 2026-08-14T10' })
  from?: string;

  @IsOptional()
  @Matches(HOUR_BUCKET_RE, { message: 'to must be an hour bucket, e.g. 2026-08-14T10' })
  to?: string;

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
