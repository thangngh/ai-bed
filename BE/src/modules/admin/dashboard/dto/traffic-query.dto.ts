import { IsInt, IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from './range-query.dto';

export class TrafficQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsInt()
  @IsString()
  logPath?: string;
}
