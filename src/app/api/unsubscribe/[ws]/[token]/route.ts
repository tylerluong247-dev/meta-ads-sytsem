import { getServiceDeps } from "@/lib/server/context";
import { unsubscribeByToken } from "@/lib/server/services/followup";
import { escapeHtml } from "@/lib/core/compliance";

export const dynamic = "force-dynamic";

const page = (title: string, body: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><meta name="robots" content="noindex"><style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:4rem auto;padding:0 1rem;color:#111}button{background:#111;color:#fff;border:0;border-radius:.5rem;padding:.7rem 1.2rem;font-size:1rem;cursor:pointer}</style></head><body><h1>${escapeHtml(title)}</h1>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );

type Ctx = { params: Promise<{ ws: string; token: string }> };

// GET only shows a confirmation button, so email security scanners that prefetch links can't unsubscribe people by accident.
export async function GET(_req: Request, { params }: Ctx) {
  const { ws, token } = await params;
  return page("Unsubscribe", `<p>Click below to stop receiving emails from us.</p><form method="post" action="/api/unsubscribe/${encodeURIComponent(ws)}/${encodeURIComponent(token)}"><button type="submit">Unsubscribe</button></form>`);
}

// POST handles both the button and RFC 8058 one-click unsubscribe from mail clients.
export async function POST(_req: Request, { params }: Ctx) {
  const { ws, token } = await params;
  try {
    const deps = await getServiceDeps();
    await unsubscribeByToken(deps, ws, token);
  } catch {
    /* Same response either way: don't reveal whether a token exists. */
  }
  return page("You're unsubscribed", "<p>You won't receive any more emails from us. If this was a mistake, just reply to any earlier email.</p>");
}
