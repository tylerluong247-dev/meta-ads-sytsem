import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, getServiceDeps, listMyWorkspaces } from "@/lib/server/context";
import { Chip, Empty, PageTitle, Panel, profitLabel, profitTone } from "@/components/ui/kit";
import { buildRollup } from "@/lib/server/services/rollup";
import { resolveRange } from "@/lib/core/dates";
import { computeMetrics, formatMoney, formatX, profitStatus } from "@/lib/core/metrics";
import { workspaceSettingsSchema } from "@/lib/core/validation";

export const metadata = { title: "Workspaces" };

async function createWorkspaceAction(formData: FormData) {
  "use server";
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const parsed = workspaceSettingsSchema.pick({ name: true, slug: true, industry: true }).safeParse({
    name: formData.get("name"),
    slug: formData.get("slug"),
    industry: formData.get("industry"),
  });
  if (!parsed.success) redirect(`/app?error=${encodeURIComponent(parsed.error.issues[0]?.message ?? "Invalid input")}`);
  const deps = await getServiceDeps();
  if (await deps.repo.getWorkspaceBySlug(parsed.data.slug)) redirect("/app?error=" + encodeURIComponent("That workspace address is taken"));
  const ws = await deps.repo.createWorkspace(parsed.data, user.id);
  redirect(`/app/${ws.slug}/settings`);
}

export default async function Workspaces({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const mine = await listMyWorkspaces();
  const deps = await getServiceDeps();
  const rows = await Promise.all(
    mine.map(async ({ workspace, role }) => {
      const roll = await buildRollup(deps.repo, workspace.id, { range: resolveRange("last_30_days", deps.now()), mode: "cohort" });
      return { workspace, role, m: computeMetrics(roll.total), status: profitStatus(roll.total, workspace.grossMargin) };
    }),
  );
  const field = "mt-1 block w-full rounded-md border border-line bg-white px-2.5 py-2 text-sm";
  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <PageTitle>Client workspaces</PageTitle>
      {error && <p role="alert" className="mb-4 rounded-md bg-bad-bg px-3 py-2 text-sm text-bad">{error}</p>}
      {rows.length === 0 ? (
        <Empty title="No workspaces yet">Create one for your first client below.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full">
            <thead className="border-b border-line"><tr>{["Client", "Last 30 days", "Spend", "Revenue", "ROAS", "CAC", ""].map((h) => <th key={h} className="px-3 py-2 text-left text-xs font-medium text-ink-soft">{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(({ workspace: w, m, status }) => (
                <tr key={w.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5"><Link href={`/app/${w.slug}`} className="font-medium text-tide hover:underline">{w.name}</Link><p className="text-xs text-ink-soft">{w.industry}</p></td>
                  <td className="px-3 py-2.5"><Chip tone={profitTone(status)}>{profitLabel[status]}</Chip></td>
                  <td className="num px-3 py-2.5 text-sm">{formatMoney(m.spend)}</td>
                  <td className="num px-3 py-2.5 text-sm">{formatMoney(m.revenue)}</td>
                  <td className="num px-3 py-2.5 text-sm">{formatX(m.roas)}</td>
                  <td className="num px-3 py-2.5 text-sm">{formatMoney(m.cac)}</td>
                  <td className="px-3 py-2.5 text-right"><Link href={`/app/${w.slug}/leads`} className="text-sm text-tide hover:underline">Open pipeline</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Panel title="New client workspace" className="mt-6 max-w-xl">
        <form action={createWorkspaceAction} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm sm:col-span-3">Business name<input name="name" required maxLength={120} className={field} /></label>
          <label className="text-sm">Address slug<input name="slug" required pattern="[a-z0-9\-]{2,60}" placeholder="acme-roofing" className={field} /></label>
          <label className="text-sm">Industry<input name="industry" required maxLength={80} placeholder="roofing" className={field} /></label>
          <button className="self-end rounded-md bg-tide px-3 py-2 text-sm font-medium text-white hover:bg-tide-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Create workspace</button>
        </form>
      </Panel>
    </main>
  );
}
