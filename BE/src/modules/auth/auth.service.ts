import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { Tenant } from '../tenant/entities/tenant.entity';
import { TenantSession } from './entities/tenant-session.entity';
import { GoogleOAuthStrategy } from './google-oauth.strategy';
import { signTenantToken } from './tenant-jwt';
import type { ParentAuthConfig, ParentAuthEnabled } from './auth.config';

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  tenantId: string;
}

/** How long a login may sit unfinished between the redirect out and back. */
const STATE_TTL_SECONDS = 600;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * HttpExceptionFilter only preserves a machine-readable code when the thrown
 * body already has the `{ error: { code, message } }` shape -- a bare
 * `new UnauthorizedException('SESSION_INVALID')` reaches the client as
 * `code: 'HTTP_ERROR'` and the SPA cannot tell the cases apart.
 */
function unauthorized(code: string, message: string): UnauthorizedException {
  return new UnauthorizedException({ error: { code, message } });
}

const BAD_STATE_MSG = 'Yêu cầu đăng nhập không hợp lệ hoặc đã hết hạn';

function badState(): UnauthorizedException {
  return unauthorized('INVALID_OAUTH_STATE', BAD_STATE_MSG);
}

function utcText(date: Date): string {
  // Matches the 'YYYY-MM-DD HH:MM:SS' text shape the rest of the schema uses.
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

@Injectable()
export class AuthService {
  private readonly tenants: Repository<Tenant>;
  private readonly sessions: Repository<TenantSession>;
  private readonly logger = new Logger('ParentAuth');

  constructor(
    @InjectDataSource('core') dataSource: DataSource,
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(GoogleOAuthStrategy) private readonly google: GoogleOAuthStrategy,
  ) {
    this.tenants = dataSource.getRepository(Tenant);
    this.sessions = dataSource.getRepository(TenantSession);
  }

  private settings(): ParentAuthEnabled {
    const parentAuth = this.config.get<ParentAuthConfig>('parentAuth');
    if (!parentAuth || !parentAuth.enabled) {
      throw new Error('Google sign-in is not configured');
    }
    return parentAuth;
  }

  isEnabled(): boolean {
    return this.config.get<ParentAuthConfig>('parentAuth')?.enabled === true;
  }

  // --- OAuth state -------------------------------------------------------
  // Signed rather than stored: the BE keeps no session before login, so there
  // is nowhere to park a nonce. The signature is what makes the callback
  // reject a `state` the BE did not issue, which is the CSRF check.

  createState(claimTenantId: string | null): string {
    const body = Buffer.from(
      JSON.stringify({
        n: randomBytes(16).toString('base64url'),
        ct: claimTenantId && UUID_REGEX.test(claimTenantId) ? claimTenantId : null,
        exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
      }),
    ).toString('base64url');
    const mac = createHmac('sha256', this.settings().secret).update(body).digest('base64url');
    return `${body}.${mac}`;
  }

  /** @returns the tenant id to claim, or null. Throws when `state` is not ours. */
  verifyState(state: string | undefined): string | null {
    if (!state) throw badState();
    const parts = state.split('.');
    if (parts.length !== 2) throw badState();
    const [body, mac] = parts;

    const expected = createHmac('sha256', this.settings().secret).update(body).digest();
    const actual = Buffer.from(mac, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw badState();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      throw badState();
    }
    if (typeof parsed?.exp !== 'number' || parsed.exp <= Math.floor(Date.now() / 1000)) {
      throw badState();
    }
    return typeof parsed.ct === 'string' ? parsed.ct : null;
  }

  // --- Login -------------------------------------------------------------

  getAuthorizationUrl(claimTenantId: string | null): string {
    return this.google.getAuthorizationUrl(this.createState(claimTenantId));
  }

  async handleGoogleCallback(
    code: string,
    state: string | undefined,
    ip: string | null,
  ): Promise<SessionTokens> {
    const claimTenantId = this.verifyState(state);
    const profile = await this.google.exchangeCodeForProfile(code);

    const existing = await this.tenants.findOne({
      where: { authType: 'google', authKey: profile.subject },
    });

    const tenant = existing ?? (await this.linkOrCreateTenant(profile.subject, claimTenantId, profile));

    if (existing) {
      // Keep the display fields fresh without ever re-keying the identity.
      await this.tenants.update(
        { tenantId: tenant.tenantId },
        { email: profile.email, name: profile.displayName ?? tenant.name, updatedAt: utcText(new Date()) },
      );
    }

    return this.issueSession(tenant.tenantId, ip);
  }

  /**
   * A parent who used the app anonymously already has children and stories
   * hanging off a local tenant. Signing in adopts that tenant instead of
   * stranding the data behind a fresh empty one.
   *
   * Only an untouched anonymous tenant qualifies: one that is still
   * `local` with no auth_key. A tenant already bound to a Google account can
   * never be re-bound, so a leaked tenant id cannot be used to graft someone
   * else's family onto an attacker's Google account.
   */
  private async linkOrCreateTenant(
    subject: string,
    claimTenantId: string | null,
    profile: { email: string | null; displayName: string | null },
  ): Promise<Tenant> {
    const now = utcText(new Date());

    if (claimTenantId) {
      const claimed = await this.tenants.findOne({ where: { tenantId: claimTenantId } });
      if (claimed && claimed.authType === 'local' && !claimed.authKey) {
        await this.tenants.update(
          { tenantId: claimed.tenantId },
          {
            authType: 'google',
            authKey: subject,
            email: profile.email,
            name: profile.displayName ?? claimed.name,
            updatedAt: now,
          },
        );
        return (await this.tenants.findOneOrFail({ where: { tenantId: claimed.tenantId } }));
      }
    }

    const tenant = this.tenants.create({
      tenantId: randomUUID(),
      authType: 'google',
      authKey: subject,
      email: profile.email,
      name: profile.displayName ?? 'anonymous',
      createdAt: now,
      updatedAt: now,
    });
    return this.tenants.save(tenant);
  }

  // --- Sessions ----------------------------------------------------------

  private async issueSession(tenantId: string, ip: string | null): Promise<SessionTokens> {
    const { secret, accessTtlSeconds, refreshTtlDays } = this.settings();
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);

    await this.sessions.save(
      this.sessions.create({
        sessionId: randomUUID(),
        tenantId,
        tokenHash: sha256(refreshToken),
        expiresAt: utcText(expiresAt),
        createdIp: ip,
        createdAt: utcText(new Date()),
      }),
    );

    return {
      accessToken: signTenantToken(tenantId, secret, accessTtlSeconds),
      accessTokenExpiresAt: new Date(Date.now() + accessTtlSeconds * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      tenantId,
    };
  }

  async refreshSession(rawRefreshToken: string, ip: string | null): Promise<SessionTokens> {
    const { secret, accessTtlSeconds, refreshTtlDays } = this.settings();
    const session = await this.sessions.findOne({ where: { tokenHash: sha256(rawRefreshToken) } });

    if (!session) throw unauthorized('SESSION_INVALID', 'Phiên không hợp lệ hoặc đã hết hạn');

    if (session.revokedAt) {
      // The token was already rotated away, so this is either a replay or a
      // stolen copy. There is no way to tell which, so the whole family of
      // sessions for this tenant goes.
      this.logger.warn(
        JSON.stringify({ event: 'refresh_token_reuse', tenant_id: session.tenantId }),
      );
      await this.sessions.update(
        // IsNull() and not `revokedAt: null` -- the latter compiles to
        // `revoked_at = NULL`, which matches no row, and the revocation would
        // silently do nothing.
        { tenantId: session.tenantId, revokedAt: IsNull() },
        { revokedAt: utcText(new Date()) },
      );
      throw unauthorized('SESSION_INVALID', 'Phiên không hợp lệ hoặc đã hết hạn');
    }

    if (new Date(`${session.expiresAt.replace(' ', 'T')}Z`).getTime() <= Date.now()) {
      throw unauthorized('SESSION_EXPIRED', 'Phiên đã hết hạn, vui lòng đăng nhập lại');
    }

    // Rotate in place: the row keeps its identity so the reuse check above
    // still has something to find when the old token comes back.
    const nextToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + refreshTtlDays * 86_400_000);
    await this.sessions.update(
      { sessionId: session.sessionId },
      { tokenHash: sha256(nextToken), expiresAt: utcText(expiresAt) },
    );

    return {
      accessToken: signTenantToken(session.tenantId, secret, accessTtlSeconds),
      accessTokenExpiresAt: new Date(Date.now() + accessTtlSeconds * 1000).toISOString(),
      refreshToken: nextToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
      tenantId: session.tenantId,
    };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.sessions.update(
      { tokenHash: sha256(rawRefreshToken) },
      { revokedAt: utcText(new Date()) },
    );
  }
}
