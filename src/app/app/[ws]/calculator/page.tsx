import { Calculator } from "@/components/calculator";
import { PageTitle } from "@/components/ui/kit";
import { pageAccess } from "../../access";

export const metadata = { title: "Calculator" };

export default async function CalculatorPage({ params }: { params: Promise<{ ws: string }> }) {
  const { ws } = await params;
  const { ws: w } = await pageAccess(ws);
  return (
    <>
      <PageTitle>Pre-launch calculator</PageTitle>
      <p className="mb-4 max-w-2xl text-sm text-ink-soft">Check that the economics work before you spend. Starts from this client&apos;s saved targets; change anything to test a scenario (nothing here is saved).</p>
      <Calculator initial={{ clientValue: w.avgClientValue, grossMargin: w.grossMargin, desiredProfitMargin: w.desiredProfitMargin, leadToQualified: w.qualifiedRate, qualifiedToBooked: w.bookedRate, bookedToShow: w.showRate, showToClose: w.closeRate, expectedCpl: w.targetCpl, expectedAdSpend: w.monthlyAdBudget, monthlyTargetClients: w.avgClientValue > 0 ? Math.ceil(w.monthlyRevenueTarget / w.avgClientValue) : 0 }} />
    </>
  );
}
