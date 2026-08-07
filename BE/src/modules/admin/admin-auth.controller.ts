import { Body, Controller, Post, Req } from '@nestjs/common';
import { AdminAuthService, LoginResult } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('admin')
export class AdminAuthController {
  constructor(private readonly authService: AdminAuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: any): Promise<LoginResult> {
    return this.authService.login(dto.username, dto.password, (req as any).requestId);
  }
}
