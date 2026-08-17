import { IsOptional, IsString } from 'class-validator';
import { RangeQueryDto } from './range-query.dto';

export class TrafficQueryDto extends RangeQueryDto {
  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  route?: string;
}
