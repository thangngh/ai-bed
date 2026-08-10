import { IsString, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';
import { IsChildSafeText } from '../../../common/validation/child-text';

const ID_MAX = 64;
const NAME_MAX = 40;

export class CreateFeedbackDto {
  @IsString()
  @MaxLength(ID_MAX)
  story_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(NAME_MAX)
  @IsChildSafeText()
  child_name?: string;

  @IsOptional()
  @IsInt()
  listened_complete?: number;

  @IsOptional()
  @IsInt()
  wants_more?: number;

  @IsOptional()
  @IsInt()
  suitable?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  rating?: number;

  /**
   * Deliberately *not* given `IsChildSafeText`. A note is written by a parent
   * for a human to read in the admin console and never reaches a prompt
   * (`feedback.service.ts` stores it and nothing else does), so the content
   * blocklist would reject exactly the report worth reading -- "truyện có đoạn
   * hơi bạo lực" is the complaint, not the violation.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
