import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { RangeQueryDto } from './range-query.dto';

export class TrafficQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  route?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  status?: number;
}
