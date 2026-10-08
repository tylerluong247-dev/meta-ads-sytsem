import { errorResponse, json } from "@/lib/server/api/http";
import { getServiceDeps } from "@/lib/server/context";
import { verifyCalSignature } from "@/lib/server/crypto";
import { env } from "@/lib/server/env";
import { handleCalendarWebhook, type CalWebhookPayload } from "@/lib/server/services/webhooks";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ ws: string }> }) {
  try {
    const { ws } = await params;
    const raw = await req.text();
    if (!verifyCalSignature(raw, req.headers.get("x-cal-signature-256"), env.calSecret)) return json({ ok: false, error: "Invalid signature" }, 401);
    const deps = await getServiceDeps();
    const res = await handleCalendarWebhook(deps, ws, JSON.parse(raw) as CalWebhookPayload);
    return json({ ok: true, ...res });
  } catch (e) {
    return errorResponse(e);
  }
}
