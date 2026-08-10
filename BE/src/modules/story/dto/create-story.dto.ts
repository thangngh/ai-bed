import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsIn, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Every field below is interpolated into the Engine's prompt, so an unbounded
 * one is both a cost lever (the whole body is billed as input tokens) and the
 * room a prompt-injection payload needs. The Engine re-applies the same caps in
 * `core/prompts/sanitize.py` -- these are the cheap rejection, not the defence.
 */
const NAME_MAX = 40;
const THEME_MAX = 60;
const GOAL_MAX = 200;
const GENDER_MAX = 20;
const CHARACTER_MAX = 60;

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
  @MaxLength(NAME_MAX)
  child_name!: string;

  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(THEME_MAX)
  theme!: string;

  @IsOptional()
  @IsString()
  @MaxLength(GOAL_MAX)
  goal?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ALLOWED_MOODS)
  mood?: string;

  // Vietnamese is the only language the prompts, the blocklist and the
  // Vietnamese-purity check are written for, so anything else is not a
  // language choice, it is unreviewed output.
  @IsOptional()
  @IsIn(['vi'])
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(GENDER_MAX)
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHARACTER_MAX)
  favorite_character?: string;
}
