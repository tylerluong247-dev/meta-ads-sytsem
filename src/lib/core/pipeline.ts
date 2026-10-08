import type { AppointmentStatus, PipelineStage } from "./types";

const ALLOWED: Record<PipelineStage, PipelineStage[]> = {
  NEW_LEAD: ["QUALIFIED", "BOOKED", "LOST"],
  QUALIFIED: ["BOOKED", "LOST"],
  BOOKED: ["CONFIRMED", "SHOWED", "QUALIFIED", "LOST"], // QUALIFIED = no-show / cancelled / rescheduling
  CONFIRMED: ["SHOWED", "QUALIFIED", "LOST"],
  SHOWED: ["PROPOSAL", "WON", "LOST"],
  PROPOSAL: ["WON", "LOST", "SHOWED"],
  WON: [],
  LOST: ["QUALIFIED"], // reopen
};

export function canTransition(from: PipelineStage, to: PipelineStage): boolean {
  return ALLOWED[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PipelineStage,
    public readonly to: PipelineStage,
  ) {
    super(`Cannot move a lead from ${from} to ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export function assertTransition(from: PipelineStage, to: PipelineStage): void {
  if (from === to) return;
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export type CallOutcome = "SHOWED" | "NO_SHOW" | "RESCHEDULED" | "CLOSED" | "LOST";

/** What happens to the appointment and the pipeline card when you mark a call outcome. */
export function applyCallOutcome(
  current: PipelineStage,
  outcome: CallOutcome,
): { stage: PipelineStage; appointmentStatus: AppointmentStatus; countsAsShow: boolean } {
  switch (outcome) {
    case "SHOWED":
      assertTransition(current, "SHOWED");
      return { stage: "SHOWED", appointmentStatus: "SHOWED", countsAsShow: true };
    case "NO_SHOW":
      assertTransition(current, "QUALIFIED");
      return { stage: "QUALIFIED", appointmentStatus: "NO_SHOW", countsAsShow: false };
    case "RESCHEDULED":
      assertTransition(current, "QUALIFIED");
      return { stage: "QUALIFIED", appointmentStatus: "RESCHEDULED", countsAsShow: false };
    case "CLOSED":
      assertTransition(current, "WON");
      return { stage: "WON", appointmentStatus: "SHOWED", countsAsShow: true };
    case "LOST":
      assertTransition(current, "LOST");
      return { stage: "LOST", appointmentStatus: current === "BOOKED" || current === "CONFIRMED" ? "CANCELLED" : "SHOWED", countsAsShow: current !== "BOOKED" && current !== "CONFIRMED" };
  }
}

/** Furthest funnel stage a lead has reached, for counting stage totals from lead_events history. */
export const STAGE_RANK: Record<PipelineStage, number> = {
  NEW_LEAD: 0,
  QUALIFIED: 1,
  BOOKED: 2,
  CONFIRMED: 3,
  SHOWED: 4,
  PROPOSAL: 5,
  WON: 6,
  LOST: -1,
};

export function nextAction(stage: PipelineStage, hasAppointment: boolean): string {
  switch (stage) {
    case "NEW_LEAD":
      return "Respond and qualify";
    case "QUALIFIED":
      return hasAppointment ? "Reschedule call" : "Send booking link";
    case "BOOKED":
      return "Confirm attendance";
    case "CONFIRMED":
      return "Run the sales call";
    case "SHOWED":
      return "Send proposal";
    case "PROPOSAL":
      return "Follow up on proposal";
    case "WON":
      return "Kick off onboarding";
    case "LOST":
      return "Add a loss reason";
  }
}
