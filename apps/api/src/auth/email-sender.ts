import type { Logger } from "@grokpulse/logging";

/**
 * Pluggable outbound-email seam for password reset (CLAUDE.md section 84:
 * "do not invent APIs" -- there is no real transactional-email provider
 * credential available in this sandbox, so this is kept as a narrow
 * interface a real provider integration swaps in later with zero changes
 * to the routes that call it).
 */
export interface EmailSender {
  send(to: string, subject: string, body: string): Promise<void>;
}

/**
 * PLACEHOLDER implementation: logs the email via `@grokpulse/logging`'s
 * structured logger instead of actually sending it. This sandbox has no
 * SendGrid/Postmark/SES (or similar) credentials to integrate against --
 * CLAUDE.md section 90 ("no fake production data") and section 39
 * (secrets must come from real environment configuration, never be
 * invented) both apply here: rather than fabricate a fake "sent" response
 * or silently no-op, this makes the placeholder nature obvious in every
 * log line, at `warn` level, so it is impossible to mistake for a real
 * delivery in production logs/alerts.
 *
 * Uses `@grokpulse/logging`'s structured logger (never a bare
 * `console.log`) so this participates in the same redaction/structured-
 * fields pipeline as every other log line in this app (CLAUDE.md section
 * 80) -- notably, `body` here is a reset LINK containing a single-use
 * token, not a password or API secret, so it is deliberately not one of
 * the logger's redacted paths; an operator standing up a real provider
 * should keep that in mind if they ever add response bodies containing
 * actual secrets to a log call elsewhere.
 *
 * TODO (production): replace with a real provider integration (SendGrid /
 * Postmark / SES, per CLAUDE.md section 8's observability/infra choices)
 * once real credentials exist. That integration should implement this same
 * `EmailSender` interface so `routes/auth.ts` needs no changes.
 */
export class ConsoleEmailSender implements EmailSender {
  constructor(private readonly logger: Logger) {}

  async send(to: string, subject: string, body: string): Promise<void> {
    this.logger.warn(
      { to, subject, body },
      "email:send -- PLACEHOLDER ConsoleEmailSender: no real email provider is configured, this email was only logged, not delivered",
    );
  }
}
