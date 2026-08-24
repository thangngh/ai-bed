import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** Raw nginx access-log line, written by the ingestor and retained for drill-down. */
@Entity('traffic_event')
@Index(['ts'])
export class TrafficEvent {
  @PrimaryGeneratedColumn()
  id!: number;
  @Column({ type: 'varchar', length: 64 })
  ip!: string;
  @Column({ type: 'varchar', length: 64 })
  route!: string;
  @Column({ type: 'varchar', length: 64 })
  method!: string;
  @Column({ type: 'int' })
  status!: number;
  @Column({ type: 'integer', default: 0 })
  bytesIn!: number;
  @Column({ type: 'integer', default: 0 })
  bytesOut!: number;
  @Column({ name: 'lat_ms', type: 'real', default: 0 })
  latMs!: number;
  @Column({ type: 'varchar', length: 25 })
  ts!: string;
}
