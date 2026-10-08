import { errorResponse, json } from "@/lib/server/api/http";
import { getSecretStore, getServiceDeps } from "@/lib/server/context";
import { verifyMetaSignature } from "@/lib/server/crypto";
import { env } from "@/lib/server/env";
import { handleMetaLeadgen, type MetaWebhookPayload } from "@/lib/server/services/webhooks";

export const dynamic = "force-dynamic";

/** Meta subscription handshake. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ok = url.searchParams.get("hub.mode") === "subscribe" && env.metaVerifyToken && url.searchParams.get("hub.verify_token") === env.metaVerifyToken;
  return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
}

export async function POST(req: Request) {
  try {
    const raw = await req.text();
    // Signature is checked against the RAW body before anything is parsed or stored.
    if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), env.metaAppSecret)) return json({ ok: false, error: "Invalid signature" }, 401);
    const payload = JSON.parse(raw) as MetaWebhookPayload;
    const deps = await getServiceDeps();
    const outcome = await handleMetaLeadgen(deps, payload, { secrets: getSecretStore(), appSecret: env.metaAppSecret, version: env.metaVersion });
    // 200 even if individual leads failed: they're stored as failed events and retried by cron, so Meta needn't redeliver.
    return json({ ok: true, ...outcome });
  } catch (e) {
    return errorResponse(e);
  }
}
