import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, MaxLength } from 'class-validator';
import { IsChildSafeText } from '../../../common/validation/child-text';

/**
 * A stored profile is not a passive record: `StoryService.create` reads
 * `preferredCharacters` and `bedtimeGoal` back out of it and sends them to the
 * Engine whenever the form leaves those fields empty. So every free-text field
 * here reaches a prompt, and every one of them needs the caps and the content
 * lock that `CreateStoryDto` already had -- this DTO had neither, which left a
 * way to plant unbounded text in a profile and have it replayed into later
 * stories without going through the story endpoint at all.
 *
 * Caps match create-story.dto.ts and Engine/core/prompts/sanitize.py.
 */
const NAME_MAX = 40;
const INTERESTS_MAX = 200;
const CHARACTER_MAX = 60;
const GOAL_MAX = 200;
const GENDER_MAX = 20;

export class CreateChildProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX)
  @IsChildSafeText()
  child_name!: string;

  /** The audience. Same bound as CreateStoryDto and the Engine's schema. */
  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

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
