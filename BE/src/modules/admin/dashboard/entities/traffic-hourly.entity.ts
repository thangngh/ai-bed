import { Entity, PrimaryColumn, Column } from 'typeorm';

/** Hourly rollup of traffic. PK is ip+route+status_class+hour so it is re-writable: the ingestor overwrites the slice for the hour it replays. */
@Entity('traffic_hourly')
export class TrafficHourly {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  ip!: string;
  @PrimaryColumn({ name: 'hour_bucket', type: 'varchar', length: 19 })
  hourBucket!: string;
  @PrimaryColumn({ type: 'varchar', length: 128 })
  route!: string;
  @PrimaryColumn({ name: 'status_class', type: 'varchar', length: 8 })
  statusClass!: string;
  @Column({ name: 'req_count', type: 'integer', default: 0 })
  reqCount!: number;
  @Column({ name: 'bytes_in', type: 'integer', default: 0 })
  bytesIn!: number;
  @Column({ name: 'bytes_out', type: 'integer', default: 0 })
  bytesOut!: number;
  @Column({ name: 'lat_avg_ms', type: 'real', default: 0 })
  latAvgMs!: number;
  @Column({ name: 'lat_p95_ms', type: 'real', default: 0 })
  latP95Ms!: number;
}
