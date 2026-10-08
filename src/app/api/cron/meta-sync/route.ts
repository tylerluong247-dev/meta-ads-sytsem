import { errorResponse, json, requireCron } from "@/lib/server/api/http";
import { getSecretStore, getServiceDeps } from "@/lib/server/context";
import { env } from "@/lib/server/env";
import { syncMeta } from "@/lib/server/services/meta";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Hourly: re-pull the last 3 days (Meta restates recent numbers) for every workspace with Meta connected. */
export async function GET(req: Request) {
  try {
    requireCron(req);
    const deps = await getServiceDeps();
    const until = deps.now().toISOString().slice(0, 10);
    const since = new Date(deps.now().getTime() - 3 * 86400000).toISOString().slice(0, 10);
    const results = [];
    for (const ws of await deps.repo.listAllWorkspaces()) {
      const [integration] = await deps.repo.list("integrations", ws.id, { where: { provider: "meta" }, limit: 1 });
      if (!integration || integration.status === "disconnected") continue;
      const r = await syncMeta(deps, ws, { secrets: getSecretStore(), appSecret: env.metaAppSecret, version: env.metaVersion, since, until });
      results.push({ workspace: ws.slug, ok: r.ok, metricRows: r.metricRows, error: r.error });
    }
    return json({ ok: true, results });
  } catch (e) {
    return errorResponse(e);
  }
}
