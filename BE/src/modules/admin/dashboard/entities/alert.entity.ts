import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';
import { NOW_UTC_TEXT_EXPR } from '../../../../database/now-default-expr';

export type AlertSeverity = 'info' | 'warning' | 'critical';

@Entity('alerts')
@Index(['resolved', 'createdAt'])
export class Alert {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ type: 'varchar', length: 64 })
  type!: string;
  @Column({ type: 'varchar', length: 16 })
  severity!: AlertSeverity;
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;
  @Column({ type: 'varchar', length: 32, nullable: true })
  provider!: string | null;
  @Column({ name: 'detail_json', type: 'text' })
  detailJson!: string;
  @Column({ type: 'boolean', default: false })
  resolved!: boolean;
  @Column({ name: 'created_at', type: 'varchar', length: 25, default: () => NOW_UTC_TEXT_EXPR })
  createdAt!: string;
  @Column({ name: 'resolved_at', type: 'varchar', length: 25, nullable: true })
  resolvedAt!: string | null;
}
