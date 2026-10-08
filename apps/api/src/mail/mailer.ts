import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ENV, type Env } from '../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  template: string;
}

/** Pluggable transport. Add an SMTP / Resend / SES implementation by implementing this. */
export interface MailTransport {
  send(message: MailMessage): Promise<void>;
}

export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/** Stores mail in the database ("dev outbox"), viewable in the admin console. */
@Injectable()
export class OutboxTransport implements MailTransport {
  constructor(private readonly prisma: PrismaService) {}

  async send(message: MailMessage): Promise<void> {
    await this.prisma.outboxEmail.create({ data: message });
  }
}

/** Logs that a message was sent (without its body, which contains one-time links). */
export class ConsoleTransport implements MailTransport {
  private readonly logger = new Logger('Mail');

  send(message: MailMessage): Promise<void> {
    this.logger.log({ to: message.to, template: message.template }, `Mail: ${message.subject}`);
    return Promise.resolve();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(title: string, body: string, cta: { label: string; url: string }): string {
  return `<!doctype html><html><body style="margin:0;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 0"><tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px;border:1px solid #e4e4e7">
<tr><td style="font-weight:700;font-size:18px;color:#18181b">&#128737; Gatekeeper</td></tr>
<tr><td style="padding-top:20px;font-size:20px;font-weight:600;color:#18181b">${escapeHtml(title)}</td></tr>
<tr><td style="padding-top:12px;font-size:14px;line-height:22px;color:#52525b">${body}</td></tr>
<tr><td style="padding-top:24px"><a href="${escapeHtml(cta.url)}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">${escapeHtml(cta.label)}</a></td></tr>
<tr><td style="padding-top:24px;font-size:12px;color:#a1a1aa">If you did not request this, you can safely ignore this email.</td></tr>
</table></td></tr></table></body></html>`;
}

@Injectable()
export class MailService {
  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: MailTransport,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async sendEmailVerification(to: string, name: string, token: string): Promise<void> {
    const url = `${this.env.WEB_URL}/verify-email?token=${encodeURIComponent(token)}`;
    await this.transport.send({
      to,
      template: 'verify-email',
      subject: 'Verify your email address',
      text: `Hi ${name},\n\nConfirm your email address for Gatekeeper by opening this link (valid for 24 hours):\n${url}\n`,
      html: layout(
        'Verify your email address',
        `Hi ${escapeHtml(name)}, confirm your email address to finish setting up your Gatekeeper account. This link is valid for 24 hours.`,
        { label: 'Verify email', url },
      ),
    });
  }

  async sendPasswordReset(to: string, name: string, token: string): Promise<void> {
    const url = `${this.env.WEB_URL}/reset-password?token=${encodeURIComponent(token)}`;
    await this.transport.send({
      to,
      template: 'reset-password',
      subject: 'Reset your password',
      text: `Hi ${name},\n\nSomeone requested a password reset for your Gatekeeper account. Open this link within 30 minutes to choose a new password:\n${url}\n`,
      html: layout(
        'Reset your password',
        `Hi ${escapeHtml(name)}, someone requested a password reset for your account. The link expires in 30 minutes and can be used once.`,
        { label: 'Choose a new password', url },
      ),
    });
  }
}
