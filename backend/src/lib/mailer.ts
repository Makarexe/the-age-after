import nodemailer from 'nodemailer';
import type { FastifyBaseLogger } from 'fastify';
import type { SmtpConfig } from '../config.js';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** false → mails only go to the log and email verification is skipped. */
  readonly configured: boolean;
  send(mail: Mail): Promise<void>;
}

export function createSmtpMailer(smtp: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return {
    configured: true,
    async send(mail) {
      await transport.sendMail({ from: smtp.from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

export function createLogMailer(getLog: () => Pick<FastifyBaseLogger, 'info'>): Mailer {
  return {
    configured: false,
    async send(mail) {
      getLog().info({ mail }, 'SMTP не настроен, письмо не отправлено');
    },
  };
}
