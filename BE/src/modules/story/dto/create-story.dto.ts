import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Moods the SPA's form offers (`MOOD_SUGGESTIONS`), plus the ones the server
 * design doc defined. Kept as a whitelist rather than free text because the
 * value is interpolated straight into the Engine's prompt.
 *
 * Matching is case-insensitive: the SPA sends the display label ("Vui vẻ"),
 * which an exact-match enum rejected -- so every story created from the form
 * came back 422 VALIDATION_ERROR.
 */
export const ALLOWED_MOODS = [
  'vui vẻ',
  'dịu dàng',
  'phiêu lưu',
  'hài hước',
  'neutral',
  'hiếu động',
  'mệt mỏi',
  'nũng nịu',
  'trầm lắng',
];

export class CreateStoryDto {
  @IsString()
  @IsNotEmpty()
  child_name!: string;

  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

  @IsString()
  @IsNotEmpty()
  theme!: string;

  @IsOptional()
  @IsString()
  goal?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ALLOWED_MOODS)
  mood?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsString()
  favorite_character?: string;
}
