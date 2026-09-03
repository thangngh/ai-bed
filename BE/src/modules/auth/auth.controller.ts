import {
  Controller,
  Get,
  Inject,
  Logger,
  NotFoundException,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService, type SessionTokens } from './auth.service';
import type { ParentAuthConfig } from './auth.config';

export const REFRESH_COOKIE_NAME = 'parent_refresh_token';

type FailureReason = 'oauth_denied' | 'oauth_failed';

function refreshCookieOptions(expiresAt: string, path: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    // `lax` and not `strict`: the parent arrives back on the callback via a
    // cross-site redirect from Google, and `strict` would withhold the cookie
    // on exactly that navigation.
    sameSite: 'lax' as const,
    expires: new Date(expiresAt),
    path,
  };
}

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger('ParentAuth');

  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  /** 404 rather than 500 when the deployment simply did not opt in. */
  private assertEnabled(): void {
    if (!this.authService.isEnabled()) {
      throw new NotFoundException({
        error: { code: 'GOOGLE_SIGNIN_DISABLED', message: 'Đăng nhập Google chưa được bật' },
      });
    }
  }

  private frontendUrl(reason?: FailureReason): string {
    const parentAuth = this.config.get<ParentAuthConfig>('parentAuth');
    const base = parentAuth?.enabled ? parentAuth.frontendCallbackUrl : '/';
    const url = new URL(base);
    if (reason) url.searchParams.set('error', reason);
    return url.toString();
  }

  private cookiePath(): string {
    const parentAuth = this.config.get<ParentAuthConfig>('parentAuth');
    return parentAuth?.enabled ? parentAuth.refreshCookiePath : '/';
  }

  @Get('google')
  startGoogleLogin(@Query('claim_tenant') claimTenant: string | undefined, @Res() res: Response): void {
    this.assertEnabled();
    res.redirect(this.authService.getAuthorizationUrl(claimTenant ?? null));
  }

  @Get('google/callback')
  async handleGoogleCallback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertEnabled();

    // Google reports a cancelled consent screen as ?error=access_denied with
    // no code at all.
    if (providerError || !code) {
      res.redirect(this.frontendUrl(providerError === 'access_denied' ? 'oauth_denied' : 'oauth_failed'));
      return;
    }

    let tokens: SessionTokens;
    try {
      tokens = await this.authService.handleGoogleCallback(code, state, req.ip ?? null);
    } catch (error) {
      // The browser is mid-redirect: a JSON error page would strand the parent
      // outside the SPA. Log the cause and send them back to the app.
      this.logger.error('Google callback failed', error as Error);
      res.redirect(this.frontendUrl('oauth_failed'));
      return;
    }

    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      refreshCookieOptions(tokens.refreshTokenExpiresAt, this.cookiePath()),
    );

    const redirect = new URL(this.frontendUrl());
    // Fragment, not query string: the access token then never reaches the web
    // server's access log or a Referer header.
    redirect.hash = `access_token=${encodeURIComponent(tokens.accessToken)}&tenant_id=${encodeURIComponent(tokens.tenantId)}`;
    res.redirect(redirect.toString());
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ access_token: string; expires_at: string; tenant_id: string }> {
    this.assertEnabled();
    const raw = (req as any).cookies?.[REFRESH_COOKIE_NAME];
    if (!raw) {
      throw new UnauthorizedException({
        error: { code: 'SESSION_INVALID', message: 'Phiên không hợp lệ hoặc đã hết hạn' },
      });
    }

    const tokens = await this.authService.refreshSession(raw, req.ip ?? null);
    res.cookie(
      REFRESH_COOKIE_NAME,
      tokens.refreshToken,
      refreshCookieOptions(tokens.refreshTokenExpiresAt, this.cookiePath()),
    );
    return {
      access_token: tokens.accessToken,
      expires_at: tokens.accessTokenExpiresAt,
      tenant_id: tokens.tenantId,
    };
  }

  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const raw = (req as any).cookies?.[REFRESH_COOKIE_NAME];
    if (raw) await this.authService.logout(raw);
    res.clearCookie(REFRESH_COOKIE_NAME, { path: this.cookiePath() });
  }
}
