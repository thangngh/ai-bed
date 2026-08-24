import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('llm_usage_hourly')
export class LlmUsageHourly {
  @PrimaryColumn({ type: 'varchar', length: 32 })
  provider!: string;
  @PrimaryColumn({ type: 'varchar', length: 64 })
  model!: string;
  @PrimaryColumn({ name: 'hour_bucket', type: 'varchar', length: 19 })
  hourBucket!: string;
  @Column({ name: 'prompt_tokens', type: 'integer', default: 0 })
  promptTokens!: number;
  @Column({ name: 'completion_tokens', type: 'integer', default: 0 })
  completionTokens!: number;
  @Column({ type: 'integer', default: 0 })
  requests!: number;
  @Column({ name: 'est_cost_usd', type: 'real', default: 0 })
  estCostUsd!: number;
  @Column({ name: 'lat_avg_ms', type: 'real', default: 0 })
  latAvgMs!: number;
}
