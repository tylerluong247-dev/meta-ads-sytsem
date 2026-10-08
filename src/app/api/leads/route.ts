import { RateLimiter } from "@/lib/server/ratelimit";
import { clientIp, errorResponse, json, readJson } from "@/lib/server/api/http";
import { getServiceDeps } from "@/lib/server/context";
import { createLead } from "@/lib/server/services/leads";
import { ValidationError } from "@/lib/server/services/common";

export const dynamic = "force-dynamic";

// 10 submissions per IP per 10 minutes on this instance. See ratelimit.ts for production notes.
const limiter = new RateLimiter(10, 10 * 60_000);

/** Public lead capture. The browser never talks to Supabase or Meta: everything is validated and written here. */
export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    if (!limiter.allow(ip)) return json({ ok: false, error: "Too many requests. Please try again in a few minutes." }, 429);
    const body = await readJson<Record<string, unknown>>(req);
    if (typeof body !== "object" || body === null) throw new ValidationError("Invalid request");
    const { landingUrl, visitorId, experimentId, consentText, ...input } = body as Record<string, unknown>;
    const deps = await getServiceDeps();
    const res = await createLead(deps, input, {
      ip,
      landingUrl: typeof landingUrl === "string" ? landingUrl.slice(0, 2000) : undefined,
      referrer: req.headers.get("referer") ?? undefined,
      consentText: typeof consentText === "string" ? consentText.slice(0, 500) : undefined,
      visitorId: typeof visitorId === "string" ? visitorId.slice(0, 64) : undefined,
      experimentId: typeof experimentId === "string" ? experimentId.slice(0, 64) : undefined,
    });
    // Never echo scoring details to the public: only what the booking step needs.
    return json({ ok: true, token: res.token, duplicate: res.duplicate, canBook: res.tier !== "DISQUALIFIED" });
  } catch (e) {
    return errorResponse(e);
  }
}
