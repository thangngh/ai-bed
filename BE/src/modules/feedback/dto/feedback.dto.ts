import { IsString, IsOptional, IsInt, Min, Max, MinLength, MaxLength } from 'class-validator';

export class CreateFeedbackDto {
  @IsString()
  story_id!: string;

  @IsOptional()
  @IsString()
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

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
