import { z } from "zod";
import { RateLimiter } from "@/lib/server/ratelimit";
import { clientIp, errorResponse, json, readJson } from "@/lib/server/api/http";
import { getServiceDeps } from "@/lib/server/context";
import { bookAppointment, cancelAppointment, confirmAppointment } from "@/lib/server/services/booking";

export const dynamic = "force-dynamic";
const limiter = new RateLimiter(20, 10 * 60_000);

const schema = z.object({
  action: z.enum(["book", "cancel", "confirm"]).default("book"),
  ws: z.string().min(1).max(80),
  token: z.string().uuid(),
  startUtc: z.string().datetime().optional(),
  timeZone: z.string().max(64).default("UTC"),
});

export async function POST(req: Request) {
  try {
    if (!limiter.allow(clientIp(req))) return json({ ok: false, error: "Too many requests." }, 429);
    const body = schema.parse(await readJson(req));
    // Reject unknown timezones early: Intl throws RangeError on invalid ones.
    try { new Intl.DateTimeFormat("en-US", { timeZone: body.timeZone }); } catch { return json({ ok: false, error: "Unknown timezone" }, 400); }
    const deps = await getServiceDeps();
    if (body.action === "cancel") await cancelAppointment(deps, body.ws, body.token);
    else if (body.action === "confirm") await confirmAppointment(deps, body.ws, body.token);
    else {
      if (!body.startUtc) return json({ ok: false, error: "Pick a time" }, 400);
      const appt = await bookAppointment(deps, body.ws, body.token, body.startUtc, body.timeZone);
      return json({ ok: true, startAt: appt.startAt, endAt: appt.endAt });
    }
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
