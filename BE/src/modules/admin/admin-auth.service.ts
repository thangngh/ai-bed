import { DataSource, Repository } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AdminUser } from './entities/admin-user.entity';
import { dummyPasswordHash, verifyPassword } from './auth/password';
import { signAdminToken } from './auth/jwt';
import { LoginThrottle } from './auth/login-throttle';

export interface LoginResult {
  token: string;
  expires_at: string;
  admin: { admin_id: string; username: string };
}

const INVALID_MSG = 'Sai tài khoản hoặc mật khẩu';
const THROTTLED_MSG = 'Sai quá nhiều lần. Vui lòng thử lại sau.';

@Injectable()
export class AdminAuthService {
  private readonly repo: Repository<AdminUser>;
  private readonly throttle = new LoginThrottle();
  private readonly logger = new Logger('AdminAuth');

  constructor(
    @InjectDataSource('core') dataSource: DataSource,
    private readonly config: ConfigService,
  ) {
    this.repo = dataSource.getRepository(AdminUser);
  }

  async login(username: string, password: string, requestId?: string): Promise<LoginResult> {
    const decision = this.throttle.check(username);
    if (!decision.allowed) {
      throw new HttpException(
        {
          error: {
            code: 'LOGIN_THROTTLED',
            message: THROTTLED_MSG,
            retry_after: decision.retryAfterSeconds,
          },
        },
        429,
      );
    }

    const admin = await this.repo.findOne({ where: { username } });

    // An unknown username still pays for one scrypt run, so response latency
    // cannot be used to tell which usernames exist.
    const storedHash = admin ? admin.passwordHash : await dummyPasswordHash();
    const passwordOk = await verifyPassword(password, storedHash);

    if (!admin || !passwordOk) {
      this.throttle.recordFailure(username);
      this.logger.warn(
        JSON.stringify({
          event: 'admin_login_failed',
          username,
          request_id: requestId ?? 'unknown',
        }),
      );
      throw new UnauthorizedException({
        error: { code: 'INVALID_CREDENTIALS', message: INVALID_MSG },
      });
    }

    this.throttle.recordSuccess(username);
    await this.repo.update({ adminId: admin.adminId }, { lastLoginAt: new Date().toISOString() });

    const secret = this.config.get<string>('admin.secret')!;
    const ttlSeconds = this.config.get<number>('admin.ttlSeconds')!;
    const token = signAdminToken({ sub: admin.adminId, username: admin.username }, secret, ttlSeconds);

    return {
      token,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
      admin: { admin_id: admin.adminId, username: admin.username },
    };
}
}
