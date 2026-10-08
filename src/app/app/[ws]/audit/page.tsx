import { Empty, PageTitle, th, td } from "@/components/ui/kit";
import { formatInZone } from "@/lib/core/booking";
import { pageAccess } from "../../access";

export const metadata = { title: "Audit log" };

export default async function Audit({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, readDeps } = await pageAccess(ws, "admin");
  const logs = await readDeps.repo.list("auditLogs", w.id, { orderBy: { field: "createdAt", desc: true }, limit: 200 });
  return (
    <>
      <PageTitle>Audit log</PageTitle>
      {logs.length === 0 ? <Empty title="Nothing logged yet" /> : (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel"><table className="w-full"><thead><tr><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Item</th><th className={th}>Change</th></tr></thead>
          <tbody>{logs.map((l) => <tr key={l.id} className="border-t border-line align-top"><td className={td}>{formatInZone(l.createdAt, w.timezone)}</td><td className="px-3 py-2 text-sm">{l.actorType}{l.actorId ? ` ${l.actorId.slice(0, 8)}` : ""}</td><td className="px-3 py-2 text-sm font-medium">{l.action.replace(/_/g, " ")}</td><td className="px-3 py-2 text-sm text-ink-soft">{l.entityType}</td><td className="max-w-md break-words px-3 py-2 font-mono text-xs text-ink-soft">{l.before ? JSON.stringify(l.before) + " → " : ""}{l.after ? JSON.stringify(l.after) : ""}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
