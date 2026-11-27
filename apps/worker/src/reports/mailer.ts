import nodemailer, { type Transporter } from 'nodemailer';

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html: string;
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

export type SendMail = (m: MailMessage) => Promise<void>;

let cached: Transporter | null | undefined;

/**
 * SMTP from SMTP_URL (e.g. smtp://user:pass@smtp.example.com:587, or smtp://localhost:1025 for
 * Mailpit in development). Returns null when email isn't configured.
 */
export function createMailer(): SendMail | null {
  if (cached === undefined)
    cached = process.env.SMTP_URL ? nodemailer.createTransport(process.env.SMTP_URL) : null;
  const t = cached;
  if (!t) return null;
  const from = process.env.MAIL_FROM ?? 'QAForge <reports@qaforge.local>';
  return async (m) => {
    await t.sendMail({
      from,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
      attachments: m.attachments,
    });
  };
}
