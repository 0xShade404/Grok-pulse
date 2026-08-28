import type { EmailSender } from "../auth/email-sender.js";

export interface SentEmail {
  to: string;
  subject: string;
  body: string;
}

/** In-memory `EmailSender` fake -- records every "sent" email for
 * assertions instead of actually sending or logging anything. */
export class FakeEmailSender implements EmailSender {
  readonly sent: SentEmail[] = [];

  async send(to: string, subject: string, body: string): Promise<void> {
    this.sent.push({ to, subject, body });
  }
}
