import { errorResponse, json } from "@/lib/server/api/http";
import { getServiceDeps } from "@/lib/server/context";
import { findLeadByToken, getAvailability, bookingConfigFor } from "@/lib/server/services/booking";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const ws = url.searchParams.get("ws") ?? "";
    const token = url.searchParams.get("token") ?? "";
    const deps = await getServiceDeps();
    const found = await findLeadByToken(deps, ws, token); // token is the capability: no token, no availability
    const slots = await getAvailability(deps, found.ws, 14);
    return json({ ok: true, slots, hostTimeZone: found.ws.timezone, durationMinutes: bookingConfigFor(found.ws).durationMinutes });
  } catch (e) {
    return errorResponse(e);
  }
}
