import { contractValue } from "@/lib/core/attribution";
import type { Deal, Lead } from "../entities";
import { UniqueViolation } from "../repo";
import { audit, logEvent, NotFoundError, ValidationError, type Actor, type Deps } from "./common";
import { moveLead } from "./pipeline";

export interface CloseDealInput {
  initialPayment: number;
  recurringPayment?: number;
  recurringMonths?: number;
  oneTimeFees?: number;
  /** Headline "client value" for reporting. Defaults to the contract value. */
  clientValue?: number;
  closeDate?: string; // YYYY-MM-DD
  salesperson?: string;
}

function money(n: unknown, label: string): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new ValidationError(`${label} must be zero or greater`);
  return Math.round(n * 100) / 100;
}

/** Won deal: records money, creates the customer, freezes attribution onto the deal, moves the lead to WON. */
export async function closeDeal(deps: Deps, workspaceId: string, leadId: string, input: CloseDealInput, actor: Actor): Promise<{ deal: Deal; lead: Lead }> {
  const lead = await deps.repo.get("leads", workspaceId, leadId);
  if (!lead) throw new NotFoundError("Lead not found");

  const initial = money(input.initialPayment, "Initial payment");
  const recurring = money(input.recurringPayment ?? 0, "Recurring payment");
  const months = Math.round(money(input.recurringMonths ?? 0, "Recurring months"));
  const fees = money(input.oneTimeFees ?? 0, "One-time fees");
  const total = contractValue({ initialPayment: initial, recurringPayment: recurring, recurringMonths: months, oneTimeFees: fees });
  if (total <= 0) throw new ValidationError("A won deal needs a contract value above zero");

  const closeDate = input.closeDate ?? deps.now().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) throw new ValidationError("Close date must be YYYY-MM-DD");

  // Move first: this enforces the pipeline rules (only SHOWED/PROPOSAL leads can close) before any money is written.
  const moved = await moveLead(deps, workspaceId, leadId, "WON", actor, { allowWon: true, note: "Deal closed" });

  const customer = await deps.repo.insert("customers", workspaceId, {
    leadId,
    name: `${lead.firstName} ${lead.lastName ?? ""}`.trim(),
    company: lead.businessName,
    email: lead.email,
    startedOn: closeDate,
  });

  let deal: Deal;
  try {
    deal = await deps.repo.insert("deals", workspaceId, {
      leadId,
      customerId: customer.id,
      status: "won",
      clientValue: input.clientValue ?? total,
      initialPayment: initial,
      recurringPayment: recurring,
      recurringMonths: months,
      oneTimeFees: fees,
      contractValue: total,
      closeDate,
      salesperson: input.salesperson,
      // Attribution is frozen onto the deal at close so later edits to the lead can't move revenue between campaigns.
      campaignId: lead.campaignId,
      adId: lead.adId,
      creativeId: lead.creativeId,
      createdAt: deps.now().toISOString(),
    });
  } catch (e) {
    if (e instanceof UniqueViolation) throw new ValidationError("This lead already has a won deal");
    throw e;
  }

  // Cash actually due on day one; recurring months are recorded as they're collected.
  if (initial > 0) await deps.repo.insert("revenue", workspaceId, { dealId: deal.id, customerId: customer.id, kind: "initial", amount: initial, receivedOn: closeDate, createdAt: deps.now().toISOString() });
  if (fees > 0) await deps.repo.insert("revenue", workspaceId, { dealId: deal.id, customerId: customer.id, kind: "one_time", amount: fees, receivedOn: closeDate, createdAt: deps.now().toISOString() });

  await logEvent(deps, workspaceId, leadId, "deal_won", { dealId: deal.id, contractValue: total }, actor.id);
  await audit(deps, workspaceId, actor, { action: "deal_won", entityType: "deals", entityId: deal.id, campaignId: lead.campaignId, after: { contractValue: total, salesperson: input.salesperson, creativeId: lead.creativeId } });
  return { deal, lead: moved };
}
