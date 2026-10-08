import type { Mail, Mailer } from "./services/common";

/** Resend transactional email API. Adds RFC 8058 one-click unsubscribe headers. */
export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly fetchFn: typeof fetch = fetch) {}
  async send(mail: Mail): Promise<{ id: string }> {
    const headers: Record<string, string> = {};
    if (mail.unsubscribeUrl) {
      headers["List-Unsubscribe"] = `<${mail.unsubscribeUrl}>`;
      headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
    }
    const res = await this.fetchFn("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: mail.from, to: [mail.to], subject: mail.subject, text: mail.text, html: mail.html, reply_to: mail.replyTo, headers }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const body = (await res.json()) as { id?: string };
    return { id: body.id ?? "unknown" };
  }
}

/** Demo/test mailer: records instead of sending. */
export class OutboxMailer implements Mailer {
  readonly sent: Mail[] = [];
  failNext = false;
  async send(mail: Mail): Promise<{ id: string }> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("Simulated provider failure");
    }
    this.sent.push(mail);
    return { id: `outbox-${this.sent.length}` };
  }
}
