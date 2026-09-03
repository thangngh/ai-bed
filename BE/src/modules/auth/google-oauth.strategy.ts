import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { ParentAuthConfig, ParentAuthEnabled } from './auth.config';

export interface GoogleProfile {
  /** Google's stable subject id. The only field identity is matched on. */
  subject: string;
  email: string | null;
  displayName: string | null;
}

const SCOPES = ['openid', 'email', 'profile'];

@Injectable()
export class GoogleOAuthStrategy {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  private settings(): ParentAuthEnabled {
    const parentAuth = this.config.get<ParentAuthConfig>('parentAuth');
    if (!parentAuth || !parentAuth.enabled) {
      throw new Error('Google sign-in is not configured');
    }
    return parentAuth;
  }

  private client(): OAuth2Client {
    const { googleClientId, googleClientSecret, googleCallbackUrl } = this.settings();
    return new OAuth2Client(googleClientId, googleClientSecret, googleCallbackUrl);
  }

  getAuthorizationUrl(state: string): string {
    return this.client().generateAuthUrl({
      access_type: 'online',
      scope: SCOPES,
      state,
      // The app has no use for offline access to Google, so it never asks for
      // a Google refresh token and never has to store one.
      include_granted_scopes: true,
    });
  }

  async exchangeCodeForProfile(code: string): Promise<GoogleProfile> {
    const client = this.client();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      throw new Error('Google did not return an id_token');
    }

    // verifyIdToken re-checks the signature, issuer, audience and expiry
    // against Google's published keys. The token arriving over the token
    // endpoint is not enough on its own to be trusted as an identity.
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.settings().googleClientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) {
      throw new Error('Google id_token has no subject');
    }

    return {
      subject: payload.sub,
      // An unverified email is not shown as the account's email: Google only
      // guarantees the `sub`.
      email: payload.email_verified ? (payload.email ?? null) : null,
      displayName: payload.name ?? null,
    };
  }
}
