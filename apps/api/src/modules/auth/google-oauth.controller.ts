import { Controller, Get, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { GoogleOAuthService } from './google-oauth.service';
import { AuthTokenDto } from '@nanommo/shared';

@Controller('auth/google')
export class GoogleOAuthController {
  constructor(private readonly google: GoogleOAuthService) {}

  @Get()
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async begin(@Res() res: Response): Promise<void> {
    res.redirect(await this.google.begin());
  }

  @Get('callback')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async callback(@Query('code') code: string, @Query('state') state: string, @Res() res: Response): Promise<void> {
    try {
      const handoff = await this.google.callback(code, state);
      res.redirect(this.google.frontendUrl(handoff));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google authentication failed';
      const frontend = process.env.GOOGLE_OAUTH_FRONTEND_CALLBACK_URL || '/auth/google/callback';
      const url = new URL(frontend, process.env.GOOGLE_OAUTH_FRONTEND_ORIGIN || 'http://localhost:4200');
      url.searchParams.set('error', message);
      res.redirect(url.toString());
    }
  }

  @Post('redeem')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async redeem(@Query('code') code: string): Promise<AuthTokenDto> {
    return this.google.redeem(code);
  }
}
