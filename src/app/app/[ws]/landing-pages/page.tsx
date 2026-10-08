import Link from "next/link";
import { PageTitle, Panel, th, td, Chip } from "@/components/ui/kit";
import { NICHES } from "@/lib/landing-content";
import { env } from "@/lib/server/env";
import { pageAccess } from "../../access";

export const metadata = { title: "Landing pages" };

export default async function LandingPages({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w, readDeps } = await pageAccess(ws);
  const [custom, experiments] = await Promise.all([readDeps.repo.list("landingPages", w.id), readDeps.repo.list("experiments", w.id, { where: { status: "running" } })]);
  const base = env.appUrl.replace(/\/$/, "");
  return (
    <>
      <PageTitle>Landing pages</PageTitle>
      <p className="mb-4 max-w-2xl text-sm text-ink-soft">Each niche page captures consent, asks qualifying questions and shows booking times right after the form. Ad links should carry UTM tags; <code>utm_campaign</code>, <code>utm_content</code> and the Meta IDs tie each lead to the ad that produced it.</p>
      <Panel title="Available pages">
        <div className="-m-4 overflow-x-auto"><table className="w-full"><thead><tr><th className={th}>Page</th><th className={th}>Link for ads</th><th className={th}>Notes</th></tr></thead>
          <tbody>{Object.values(NICHES).map((n) => {
            const override = custom.find((c) => c.slug === n.slug);
            const test = experiments.find((e) => e.config.landingSlug === n.slug);
            return <tr key={n.slug} className="border-t border-line"><td className="px-3 py-2 text-sm font-medium"><Link className="text-tide hover:underline" href={`/${n.slug}?ws=${w.slug}`} target="_blank">/{n.slug}</Link></td><td className={`${td} break-all`}>{base}/{n.slug}?ws={w.slug}&amp;utm_source=facebook&amp;utm_medium=paid&amp;utm_campaign=…&amp;utm_content=…</td><td className="px-3 py-2 text-sm">{override ? <Chip tone={override.published ? "good" : "warn"}>{override.published ? "customized" : "draft copy"}</Chip> : <Chip>default copy</Chip>} {test && <Chip tone="brand">test running</Chip>}</td></tr>;
          })}</tbody></table></div>
      </Panel>
      <p className="mt-3 text-xs text-ink-soft">Pages never show testimonials or case studies unless a real result is marked verified. Edit page copy through the API (landing-pages action) until a visual editor is added.</p>
    </>
  );
}
