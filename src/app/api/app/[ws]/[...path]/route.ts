import { matchAction } from "@/lib/server/api/app-actions";
import { assertSameOrigin, errorResponse, json, readJsonOrEmpty } from "@/lib/server/api/http";
import { authorize } from "@/lib/server/context";
import { PermissionError } from "@/lib/server/services/common";
import { ROLE_RANK } from "@/lib/server/entities";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ ws: string; path: string[] }> };

/** One authenticated entry point for every dashboard mutation: same-origin check → session → role → action. */
export async function POST(req: Request, { params }: Ctx) {
  try {
    const { ws, path } = await params;
    assertSameOrigin(req);
    const matched = matchAction("POST", path);
    if (!matched) return json({ ok: false, error: "Not found" }, 404);
    const access = await authorize(ws, matched.action.minRole);
    if (ROLE_RANK[access.role] < ROLE_RANK[matched.action.minRole]) throw new PermissionError();
    const body = await readJsonOrEmpty(req);
    const result = await matched.action.run({ access, body, params: matched.params });
    return json({ ok: true, ...(typeof result === "object" && result !== null ? result : { result }) });
  } catch (e) {
    return errorResponse(e);
  }
}
