import { IsDateString, IsInt, IsMin, IsOptional } from 'class-validator';

export class TrafficQueryDto {
  @IsOptional() @IsDateString() from: string;
  @IsOptional() @IsDateString() to: string;
  @IsInt() @Min(0) limit: number = 50;
}
