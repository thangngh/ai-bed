import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsIn, IsUUID, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { IsChildSafeText } from '../../../common/validation/child-text';

/**
 * Every field below is interpolated into the Engine's prompt, so an unbounded
 * one is both a cost lever (the whole body is billed as input tokens) and the
 * room a prompt-injection payload needs. The Engine re-applies the same caps in
 * `core/prompts/sanitize.py` -- these are the cheap rejection, not the defence.
 *
 * `@IsChildSafeText` is the other half: a cap bounds how much text arrives, not
 * what is in it. It rejects fullwidth lookalikes, scripts outside Vietnamese
 * and English, hidden control characters, and -- on the three fields that
 * decide what the story is *about* -- subject matter that has no business in a
 * story for a 3-6 year old. Mirrored in Engine/core/input_guard.py.
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
  /**
   * The profile this story belongs to, when the caller already has one.
   *
   * Optional on purpose: without it the service falls back to matching by
   * name, which is what older clients and the integration suite do.
   * `child_name` and `age` therefore stay required -- the fallback needs them.
   */
  @IsOptional()
  @IsUUID()
  child_id?: string;

  // Structural checks only. The content blocklist contains `dao`, and a child
  // can be called Dao.
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  @IsChildSafeText()
  child_name!: string;

  /**
   * The audience, and the only range this product has reviewed behaviour for:
   * the Engine picks its developer prompt by this number and the safety rules
   * are written against it. Re-checked in the Engine's own request schema,
   * because `/generate` is reachable from anything on the compose network.
   */
  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(THEME_MAX)
  @IsChildSafeText({ content: true })
  theme!: string;

  @IsOptional()
  @IsString()
  @MaxLength(GOAL_MAX)
  @IsChildSafeText({ content: true })
  goal?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(ALLOWED_MOODS)
  mood?: string;

  /**
   * Vietnamese only. English story output is out of scope until MVP 2.1.
   *
   * This is narrower than the *input* lock in `IsChildSafeText`, which admits
   * Latin letters generally -- and has to, because Vietnamese is written with
   * the same A-Z. The two answer different questions: what a parent may type,
   * and what language the story comes back in. Only the second one can
   * meaningfully exclude English, and the Engine enforces it again in its own
   * schema plus a purity check on the generated prose.
   */
  @IsOptional()
  @IsIn(['vi'])
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(GENDER_MAX)
  @IsChildSafeText()
  gender?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHARACTER_MAX)
  @IsChildSafeText({ content: true })
  favorite_character?: string;
}
