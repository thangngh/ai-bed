import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional } from 'class-validator';

export class CreateChildProfileDto {
  @IsString()
  @IsNotEmpty()
  child_name!: string;

  @IsInt()
  @Min(3)
  @Max(6)
  age!: number;

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
