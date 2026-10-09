import type { Mail } from '../lib/mailer.js';

interface Ctx {
  serverName: string;
  publicUrl: string;
}

const footer = (c: Ctx) => `\n\n— ${c.serverName}\nЕсли вы не делали этот запрос, просто проигнорируйте письмо.`;

export function verifyEmailMail(c: Ctx, to: string, username: string, token: string): Mail {
  return {
    to,
    subject: `${c.serverName}: подтвердите почту`,
    text:
      `Привет, ${username}!\n\nЧтобы подтвердить почту, откройте ссылку:\n${c.publicUrl}/verify?token=${token}\n\n` +
      `Ссылка действует 24 часа. После подтверждения заявку рассмотрит администратор.` +
      footer(c),
  };
}

export function resetPasswordMail(c: Ctx, to: string, username: string, token: string): Mail {
  return {
    to,
    subject: `${c.serverName}: сброс пароля`,
    text:
      `Привет, ${username}!\n\nЧтобы задать новый пароль, откройте ссылку:\n${c.publicUrl}/reset?token=${token}\n\n` +
      `Ссылка действует 1 час.` +
      footer(c),
  };
}

export function adminNewApplicationMail(c: Ctx, to: string, username: string, email: string): Mail {
  return {
    to,
    subject: `${c.serverName}: новая заявка от ${username}`,
    text: `Новая заявка на регистрацию.\n\nНик: ${username}\nПочта: ${email}\n\nОдобрить или отклонить: ${c.publicUrl}/admin`,
  };
}

export function approvedMail(c: Ctx, to: string, username: string): Mail {
  return {
    to,
    subject: `${c.serverName}: аккаунт одобрен`,
    text: `Привет, ${username}!\n\nАдминистратор одобрил ваш аккаунт. Теперь можно войти в лаунчер и играть.\n\n— ${c.serverName}`,
  };
}
