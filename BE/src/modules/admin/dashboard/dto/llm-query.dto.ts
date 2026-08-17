import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';

export class LlmQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;
  @IsOptional()
  @IsDateString()
  to?: string;
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  limit?: number;
}
