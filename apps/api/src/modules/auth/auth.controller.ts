import { Controller, Post, Get, Delete, Body, Query, UseGuards, Request, BadRequestException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto, LoginDto, AuthTokenDto, ForgotPasswordDto, ResetPasswordDto } from '@nanommo/shared';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(@Body() dto: RegisterDto): Promise<AuthTokenDto> {
    return this.authService.register(dto);
  }

  @Post('login')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body() dto: LoginDto): Promise<AuthTokenDto> {
    return this.authService.login(dto);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  async refresh(@Body() body: { refreshToken: string }): Promise<AuthTokenDto> {
    return this.authService.refresh(body.refreshToken);
  }

  @Get('verify-email')
  async verifyEmail(@Query('token') token: string): Promise<{ success: boolean; message: string }> {
    if (!token) {
      return { success: false, message: 'Token is required' };
    }
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification')
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resendVerification(@Request() req: any): Promise<{ success: boolean; message: string }> {
    const user = await this.authService['userRepository'].findOne({
      where: { id: req.user.userId },
    });
    if (!user) {
      return { success: false, message: 'User not found' };
    }
    return this.authService.resendVerificationEmail(user.email);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ success: boolean; message: string }> {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<{ success: boolean; message: string }> {
    return this.authService.resetPassword(dto);
  }
  @Delete('account')
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@Request() req: any, @Body() body: { confirmation?: string }) {
    if (body.confirmation !== 'DELETE') throw new BadRequestException('Type DELETE to confirm account deletion');
    await this.authService.deleteAccount(req.user.userId);
    return { success: true };
  }

}
