import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService implements OnModuleInit {
  private readonly logger = new Logger(MailerService.name);
  private transporter: nodemailer.Transporter | null = null;
  private frontendUrl: string;
  private fromEmail: string;

  constructor(private readonly configService: ConfigService) {
    this.frontendUrl = this.normalizeFrontendUrl();
    this.fromEmail = this.configService.get<string>('SMTP_FROM') || 'noreply@nanommo.local';
  }

  private normalizeFrontendUrl(): string {
    const nodeEnv = this.configService.get<string>('NODE_ENV') || 'development';
    let frontendUrl = this.configService.get<string>('FRONTEND_URL');

    // In production, FRONTEND_URL is mandatory and cannot contain 'localhost'
    if (nodeEnv === 'production') {
      if (!frontendUrl) {
        throw new Error(
          'FRONTEND_URL is required in production. Please set FRONTEND_URL environment variable.',
        );
      }
      if (frontendUrl.includes('localhost')) {
        throw new Error(
          'FRONTEND_URL cannot contain "localhost" in production. Please set a valid domain.',
        );
      }
    }

    // Use default in development if not provided
    if (!frontendUrl) {
      frontendUrl = 'http://localhost:4200';
    }

    // Normalize trailing slash: remove it to ensure consistent URL building
    return frontendUrl.replace(/\/$/, '');
  }

  onModuleInit() {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASSWORD');

    if (!host || !port || !user || !pass) {
      this.logger.warn('SMTP configuration incomplete — email sending will be disabled');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host,
      port,
      secure: false,
      auth: {
        user,
        pass,
      },
    });

    this.logger.log(`MailerService initialized with SMTP: ${host}:${port}`);
  }

  private isReady(): boolean {
    return this.transporter !== null;
  }

  private async sendMail(to: string, subject: string, html: string): Promise<boolean> {
    if (!this.isReady()) {
      this.logger.error('Cannot send email: transporter not initialized (check SMTP config)');
      return false;
    }

    try {
      const info = await this.transporter!.sendMail({
        from: this.fromEmail,
        to,
        subject,
        html,
        text: this.stripHtml(html), // Add plain text alternative
      });

      this.logger.log(
        `Email sent to ${to} — subject: ${subject} | messageId: ${info.messageId} | accepted: ${info.accepted?.join(',') || 'none'} | rejected: ${info.rejected?.length || 0} | response: ${info.response || 'ok'}`,
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${to}: ${(error as Error).message}`);
      return false;
    }
  }

  private stripHtml(html: string): string {
    return html
      .replace(/<[^>]*>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ') // Collapse whitespace
      .trim();
  }

  async sendVerificationEmail(email: string, token: string): Promise<boolean> {
    const verificationLink = `${this.frontendUrl}/verify-email?token=${token}`;
    const subject = 'Confirme seu email - NanoMMO';
    const html = this.renderVerificationTemplate(verificationLink);

    return this.sendMail(email, subject, html);
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
    const resetLink = `${this.frontendUrl}/reset-password?token=${token}`;
    const subject = 'Redefina sua senha - NanoMMO';
    const html = this.renderPasswordResetTemplate(resetLink);

    return this.sendMail(email, subject, html);
  }

  private renderVerificationTemplate(verificationLink: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Confirme seu e-mail</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <tr>
      <td style="background-color: #1a1a2e; padding: 32px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">NanoMMO</h1>
        <p style="margin: 8px 0 0; color: #a0a0b0; font-size: 14px;">Idle MMORPG no navegador</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 40px 32px;">
        <h2 style="margin: 0 0 16px; color: #1a1a2e; font-size: 24px;">Confirme seu endereço de e-mail</h2>
        <p style="margin: 0 0 24px; color: #444; font-size: 16px; line-height: 1.6;">
          Obrigado por criar sua conta no NanoMMO! Para começar a jogar, precisamos confirmar seu endereço de e-mail.
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
          <tr>
            <td style="background-color: #1a1a2e; border-radius: 6px;">
              <a href="${verificationLink}" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                Confirmar e-mail
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; color: #888; font-size: 13px; line-height: 1.5;">
          Se o botão acima não funcionar, copie e cole este link no seu navegador:<br>
          <a href="${verificationLink}" style="color: #1a1a2e; word-break: break-all;">${verificationLink}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
        <p style="margin: 0; color: #888; font-size: 12px;">
          Este link expira em 24 horas. Se você não criou esta conta, pode ignorar este e-mail.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #f8f8f8; padding: 24px 32px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; color: #888; font-size: 12px;">
          © 2026 NanoMMO. Todos os direitos reservados.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }

  private renderPasswordResetTemplate(resetLink: string): string {
    return `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Redefina sua senha</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <tr>
      <td style="background-color: #1a1a2e; padding: 32px; text-align: center;">
        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">NanoMMO</h1>
        <p style="margin: 8px 0 0; color: #a0a0b0; font-size: 14px;">Idle MMORPG no navegador</p>
      </td>
    </tr>
    <tr>
      <td style="padding: 40px 32px;">
        <h2 style="margin: 0 0 16px; color: #1a1a2e; font-size: 24px;">Redefina sua senha</h2>
        <p style="margin: 0 0 24px; color: #444; font-size: 16px; line-height: 1.6;">
          Recebemos uma solicitação para redefinir a senha da sua conta NanoMMO. Se foi você, clique no botão abaixo para criar uma nova senha.
        </p>
        <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 32px 0;">
          <tr>
            <td style="background-color: #c0392b; border-radius: 6px;">
              <a href="${resetLink}" style="display: inline-block; padding: 14px 32px; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600; border-radius: 6px;">
                Redefinir senha
              </a>
            </td>
          </tr>
        </table>
        <p style="margin: 24px 0 0; color: #888; font-size: 13px; line-height: 1.5;">
          Se o botão acima não funcionar, copie e cole este link no seu navegador:<br>
          <a href="${resetLink}" style="color: #c0392b; word-break: break-all;">${resetLink}</a>
        </p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
        <p style="margin: 0; color: #888; font-size: 12px;">
          Este link expira em 1 hora. Se você não solicitou a redefinição de senha, pode ignorar este e-mail — sua senha atual permanecerá inalterada.
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color: #f8f8f8; padding: 24px 32px; text-align: center; border-top: 1px solid #eee;">
        <p style="margin: 0; color: #888; font-size: 12px;">
          © 2026 NanoMMO. Todos os direitos reservados.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>
    `.trim();
  }
}