import { Entity, PrimaryColumn, Column } from 'typeorm';

/** Key/value store for tunable operational thresholds. `value` is JSON text. */
@Entity('admin_settings')
export class AdminSetting {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  key: string;
  @Column({ type: 'text' })
  value: string;
  @Column({ name: 'updated_at', type: 'varchar', length: 25, default: () => "datetime('now')" })
  updatedAt: string;
}
