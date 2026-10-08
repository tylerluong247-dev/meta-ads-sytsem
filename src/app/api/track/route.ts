import { z } from "zod";
import { RateLimiter } from "@/lib/server/ratelimit";
import { clientIp, errorResponse, json, readJson } from "@/lib/server/api/http";
import { getServiceDeps } from "@/lib/server/context";

export const dynamic = "force-dynamic";
const limiter = new RateLimiter(60, 60_000);

const schema = z.object({ ws: z.string().min(1).max(80), experimentId: z.string().uuid(), arm: z.enum(["control", "variant"]), visitorId: z.string().min(8).max(64) });

/** Counts one landing-page view per visitor per experiment arm (used as the denominator for conversion rates). */
export async function POST(req: Request) {
  try {
    if (!limiter.allow(clientIp(req))) return json({ ok: false }, 429);
    const body = schema.parse(await readJson(req, 2048));
    const deps = await getServiceDeps();
    const ws = await deps.repo.getWorkspaceBySlug(body.ws);
    if (!ws) return json({ ok: true }); // don't reveal which workspaces exist
    const exp = await deps.repo.get("experiments", ws.id, body.experimentId);
    if (!exp || exp.status !== "running") return json({ ok: true });
    const [arm] = await deps.repo.list("experimentArms", ws.id, { where: { experimentId: exp.id, arm: body.arm }, limit: 1 });
    if (arm) await deps.repo.increment("experimentArms", ws.id, arm.id, "visitors", 1);
    else await deps.repo.insert("experimentArms", ws.id, { experimentId: exp.id, arm: body.arm, visitors: 1, spend: 0 });
    return json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
