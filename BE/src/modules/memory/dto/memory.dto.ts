import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Memory values are replayed into the prompt of every later story for the same
 * child, so this endpoint is the one place where a single accepted request has
 * a permanent effect on what the model is told. It used to take an inline
 * `{ child_id: string; memories: any[] }`, which is not a class -- so the
 * global ValidationPipe had nothing to validate against and the whole body
 * went to the database unchecked.
 *
 * Caps match Engine/core/prompts/sanitize.py.
 */
export const MEMORY_KEY_MAX = 40;
export const MEMORY_VALUE_MAX = 120;
export const MEMORIES_PER_REQUEST_MAX = 20;
export const ID_MAX = 64;

/** The types build_memory_context() actually reads; anything else is dead weight. */
export const ALLOWED_MEMORY_TYPES = [
  'interest',
  'preference',
  'recent_theme',
  'behavior',
  'character',
  'theme',
  'feedback',
];

export class MemoryItemDto {
  @IsIn(ALLOWED_MEMORY_TYPES)
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MEMORY_KEY_MAX)
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MEMORY_VALUE_MAX)
  value!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  confidence?: number;
}

export class ExtractMemoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX)
  child_id!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX)
  story_id!: string;

  @IsArray()
  @ArrayMaxSize(MEMORIES_PER_REQUEST_MAX)
  @ValidateNested({ each: true })
  @Type(() => MemoryItemDto)
  memories!: MemoryItemDto[];
}

export class ReinforceMemoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(ID_MAX)
  child_id!: string;

  @IsIn(ALLOWED_MEMORY_TYPES)
  type!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MEMORY_KEY_MAX)
  key!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MEMORY_VALUE_MAX)
  value!: string;

  @IsIn(['boost', 'reduce'])
  action!: 'boost' | 'reduce';
}
