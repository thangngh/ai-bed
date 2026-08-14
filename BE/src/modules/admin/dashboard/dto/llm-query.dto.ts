import { IsDateString, IsInt, IsMin, IsOptional } from 'class-validator';

export class LlmQueryDto {
  @IsOptional() @IsDateString() from: string;
  @IsOptional() @IsDateString() to: string;
  @IsInt() @Min(0) limit: number = 50;
}
