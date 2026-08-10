import { IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';
import { IsChildSafeText } from '../../../common/validation/child-text';

/**
 * Same caps and same content lock as CreateChildProfileDto -- an update is the
 * other way into the same row, and a field that is checked on create but not on
 * update is not checked. See that file for why a stored profile reaches a
 * prompt at all.
 */
const INTERESTS_MAX = 200;
const CHARACTER_MAX = 60;
const GOAL_MAX = 200;
const GENDER_MAX = 20;

export class UpdateChildProfileDto {
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(6)
  age?: number;

  @IsOptional()
  @IsString()
  @MaxLength(INTERESTS_MAX)
  @IsChildSafeText({ content: true })
  interests?: string;

  @IsOptional()
  @IsString()
  @MaxLength(CHARACTER_MAX)
  @IsChildSafeText({ content: true })
  preferred_characters?: string;

  @IsOptional()
  @IsString()
  @MaxLength(GOAL_MAX)
  @IsChildSafeText({ content: true })
  bedtime_goal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(GENDER_MAX)
  @IsChildSafeText()
  gender?: string;
}
