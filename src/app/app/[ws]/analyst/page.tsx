import { AnalystChat } from "@/components/analyst-chat";
import { PageTitle } from "@/components/ui/kit";
import { pageAccess } from "../../access";

export const metadata = { title: "Analyst" };

export default async function AnalystPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w } = await pageAccess(ws);
  return (
    <>
      <PageTitle>Campaign analyst</PageTitle>
      <p className="mb-4 max-w-2xl text-sm text-ink-soft">Answers use only this client&apos;s numbers and say so when the sample is too small to trust. It never recommends more budget without profit evidence across several closed clients.</p>
      <AnalystChat slug={w.slug} />
    </>
  );
}
