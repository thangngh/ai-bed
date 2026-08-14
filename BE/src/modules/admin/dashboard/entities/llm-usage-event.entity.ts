import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

/** One LLM call as observed by the Engine gateway. */
@Entity('llm_usage_event')
@Index(['ts'])
export class LlmUsageEvent {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ type: 'varchar', length: 32 })
  provider: string;
  @Column({ type: 'varchar', length: 64 })
  model: string;
  @Column({ name: 'tenant_id', type: 'varchar', length: 64, nullable: true })
  tenantId: string | null;
  @Column({ name: 'prompt_tokens', type: 'integer', default: 0 })
  promptTokens: number;
  @Column({ name: 'completion_tokens', type: 'integer', default: 0 })
  completionTokens: number;
  @Column({ name: 'est_cost_usd', type: 'real', default: 0 })
  estCostUsd: number;
  @Column({ name: 'latency_ms', type: 'real', default: 0 })
  latencyMs: number;
  @Column({ name: 'is_fallback', type: 'boolean', default: false })
  isFallback: boolean;
  @Column({ type: 'varchar', length: 25 })
  ts: string;
}
