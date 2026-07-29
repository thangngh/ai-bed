import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';

export class UpdateChildProfileDto {
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(6)
  age?: number;

  @IsOptional()
  @IsString()
  interests?: string;

  @IsOptional()
  @IsString()
  preferred_characters?: string;

  @IsOptional()
  @IsString()
  bedtime_goal?: string;

  @IsOptional()
  @IsString()
  gender?: string;
}