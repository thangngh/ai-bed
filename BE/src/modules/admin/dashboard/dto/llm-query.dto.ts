import { IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from './range-query.dto';

export class LlmQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;
}
