import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { LeadForm } from "@/components/lead-form";
import { TrackView } from "@/components/track-view";
import { nicheFor, type Niche } from "@/lib/landing-content";
import { assignArm } from "@/lib/core/experiments";
import { getServiceDeps } from "@/lib/server/context";
import { publishableProof } from "@/lib/core/compliance";
import type { Workspace } from "@/lib/server/entities";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ niche: string }>; searchParams?: Promise<{ ws?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const n = nicheFor((await params).niche);
  return n ? { title: `${n.label[0]!.toUpperCase()}${n.label.slice(1)} lead generation`, description: n.subheadline } : {};
}

async function resolveWorkspace(niche: Niche, wsSlug?: string): Promise<Workspace | null> {
  const deps = await getServiceDeps();
  // ?ws=<slug> lets one agency run the same niche page for several clients; otherwise fall back to the niche default.
  if (wsSlug && /^[a-z0-9-]{2,60}$/.test(wsSlug)) return deps.repo.getWorkspaceBySlug(wsSlug);
  const all = await deps.repo.listAllWorkspaces();
  return all.find((w) => w.slug === niche.workspaceHint) ?? all.find((w) => w.industry.toLowerCase() === niche.slug) ?? null;
}

export default async function NichePage({ params, searchParams }: Props) {
  const slug = (await params).niche;
  const niche = nicheFor(slug);
  if (!niche) notFound();
  const ws = await resolveWorkspace(niche, (await searchParams)?.ws);
  if (!ws) notFound(); // no workspace receives this niche's leads: don't show a form that goes nowhere

  const deps = await getServiceDeps();
  const visitorId = (await cookies()).get("sw_vid")?.value ?? "anonymous-visitor";

  // Saved page content (e.g. verified case studies) and any running A/B test for this page.
  const [saved] = await deps.repo.list("landingPages", ws.id, { where: { slug: niche.slug, published: true }, limit: 1 });
  const experiments = (await deps.repo.list("experiments", ws.id, { where: { status: "running" } })).filter((e) => e.config.landingSlug === niche.slug);
  const exp = experiments[0];
  const arm = exp ? assignArm(exp.id, visitorId) : undefined;
  const overrides = exp && arm ? (exp.config[arm] ?? {}) : {};

  const content = { ...niche, ...(saved?.content as Partial<Niche> | undefined), ...(overrides as Partial<Niche>) };
  const headline = overrides.headline ?? content.headline;
  const cta = overrides.cta ?? content.cta;
  const { publishable } = publishableProof(((saved?.content as { caseStudies?: Array<{ title: string; body: string; verified: boolean }> } | undefined)?.caseStudies) ?? []);

  return (
    <div style={{ ["--accent" as string]: niche.accent }}>
      {exp && arm && <TrackView ws={ws.slug} experimentId={exp.id} arm={arm} visitorId={visitorId} />}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-semibold tracking-tight">ScaleWaves Media</span>
          <a href="#start" className="text-sm font-medium text-accent underline underline-offset-4">Book a call</a>
        </div>
      </header>

      <main>
        <section className="mx-auto grid max-w-5xl gap-10 px-4 py-12 lg:grid-cols-[1.05fr_1fr] lg:py-16">
          <div>
            <h1 className="font-serif text-4xl font-semibold leading-[1.1] sm:text-5xl">{headline}</h1>
            <p className="mt-5 max-w-prose text-lg leading-relaxed text-ink-soft">{content.subheadline}</p>
            <ul className="mt-6 space-y-2 text-ink">
              {["Inquiries from people who asked, not purchased lists", "Screened before they reach your phone", "No promises about numbers we can't control"].map((t) => (
                <li key={t} className="flex gap-2"><span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{t}</li>
              ))}
            </ul>
          </div>
          <div id="start" className="scroll-mt-6 rounded-lg border border-line bg-white p-5 shadow-sm sm:p-6">
            <h2 className="font-serif text-2xl font-semibold">{content.offer.title}</h2>
            <p className="mb-5 mt-1 text-sm text-ink-soft">{content.offer.body}</p>
            <LeadForm workspaceSlug={ws.slug} jobNoun={niche.jobNoun} experimentId={exp?.id} visitorId={visitorId} cta={cta} />
          </div>
        </section>

        <section className="border-y border-line bg-white">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <h2 className="font-serif text-3xl font-semibold">{content.problem.title}</h2>
            <ul className="mt-5 grid gap-4 md:grid-cols-3">
              {content.problem.points.map((p) => <li key={p} className="border-l-2 border-accent pl-4 leading-relaxed">{p}</li>)}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="font-serif text-3xl font-semibold">What you get</h2>
          <div className="mt-6 grid gap-8 md:grid-cols-3">
            {content.benefits.map((b) => (
              <div key={b.title}><h3 className="text-lg font-semibold">{b.title}</h3><p className="mt-2 leading-relaxed text-ink-soft">{b.body}</p></div>
            ))}
          </div>
        </section>

        {publishable.length > 0 && (
          <section className="border-y border-line bg-white">
            <div className="mx-auto max-w-5xl px-4 py-12">
              <h2 className="font-serif text-3xl font-semibold">Client results</h2>
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {publishable.map((c) => <figure key={c.title} className="rounded-md border border-line p-5"><figcaption className="font-semibold">{c.title}</figcaption><p className="mt-2 leading-relaxed text-ink-soft">{c.body}</p></figure>)}
              </div>
            </div>
          </section>
        )}

        <section className="mx-auto max-w-5xl px-4 py-12">
          <h2 className="font-serif text-3xl font-semibold">How it works</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {content.process.map((s, i) => (
              <li key={s.title} className="rounded-md border border-line bg-white p-5"><p className="text-sm font-semibold text-accent">Step {i + 1}</p><h3 className="mt-1 text-lg font-semibold">{s.title}</h3><p className="mt-2 text-ink-soft">{s.body}</p></li>
            ))}
          </ol>
        </section>

        <section className="border-t border-line bg-white">
          <div className="mx-auto max-w-3xl px-4 py-12">
            <h2 className="font-serif text-3xl font-semibold">Questions</h2>
            <div className="mt-4 divide-y divide-line">
              {content.faq.map((f) => (
                <details key={f.q} className="group py-4"><summary className="cursor-pointer list-none font-medium marker:hidden">{f.q}</summary><p className="mt-2 leading-relaxed text-ink-soft">{f.a}</p></details>
              ))}
            </div>
            <a href="#start" className="mt-8 inline-block rounded-md bg-accent px-5 py-3 font-semibold text-white hover:brightness-110">{cta}</a>
          </div>
        </section>
      </main>
      <footer className="border-t border-line px-4 py-8 text-center text-xs text-ink-soft">
        <p>ScaleWaves Media · {ws.postalAddress}</p>
        <p className="mt-1">Results vary by market, offer and follow-up. We don&apos;t guarantee specific outcomes.</p>
      </footer>
    </div>
  );
}
