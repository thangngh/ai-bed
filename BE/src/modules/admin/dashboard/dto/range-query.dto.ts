import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class RangeQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;
  @IsOptional()
  @IsDateString()
  to?: string;
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;
  @IsOptional()
  @IsInt()
  @Min(0)
  offset?: number;
}
