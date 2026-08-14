import { IsDateString, IsInt, IsMin, IsOptional, Max } from 'class-validator';

export class RangeQueryDto {
  @IsOptional() @IsDateString() from: string;
  @IsOptional() @IsDateString() to: string;
  @IsOptional() @IsInt() @Min(1) @Max(1000) limit?: number;
}
