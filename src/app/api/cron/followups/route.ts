import { errorResponse, json, requireCron } from "@/lib/server/api/http";
import { getSecretStore, getServiceDeps } from "@/lib/server/context";
import { env } from "@/lib/server/env";
import { sendDueReminders } from "@/lib/server/services/booking";
import { runDueAutomations } from "@/lib/server/services/followup";
import { retryFailedMetaLeads } from "@/lib/server/services/webhooks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Every 5 minutes: due follow-ups, appointment reminders, retry failed lead-ad deliveries. */
export async function GET(req: Request) {
  try {
    requireCron(req);
    const deps = await getServiceDeps();
    const results = [];
    for (const ws of await deps.repo.listAllWorkspaces()) {
      try {
        const automations = await runDueAutomations(deps, ws);
        const reminders = await sendDueReminders(deps, ws);
        const retried = await retryFailedMetaLeads(deps, ws, { secrets: getSecretStore(), appSecret: env.metaAppSecret, version: env.metaVersion });
        results.push({ workspace: ws.slug, automations, reminders, retried });
      } catch (e) {
        // One tenant's failure must not stop the others.
        results.push({ workspace: ws.slug, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return json({ ok: true, results });
  } catch (e) {
    return errorResponse(e);
  }
}
