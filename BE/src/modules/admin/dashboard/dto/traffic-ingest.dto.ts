import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class TrafficIngestDto {
  @IsString()
  @IsNotEmpty()
  logPath!: string;

  @IsOptional()
  @IsString()
  since?: string;
}
