import { IsString, IsNotEmpty, IsInt, Min, Max, IsOptional, IsEnum } from 'class-validator';

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
  @IsEnum(['vui vẻ', 'dịu dàng', 'phiêu lưu', 'hài hước', 'neutral'])
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
