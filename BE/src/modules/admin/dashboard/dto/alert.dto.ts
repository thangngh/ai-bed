import { IsInt, IsOptional, Min } from 'class-validator';
import { AlertSeverity } from '../entities/alert.entity';

export class AlertDto {
  id!: number;
  type!: string;
  severity!: AlertSeverity;
  ip?: string | null;
  provider?: string | null;
  detailJson!: string;
  resolved!: boolean;
  createdAt!: string;
  resolvedAt?: string | null;
}
