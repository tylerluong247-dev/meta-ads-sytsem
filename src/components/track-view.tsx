"use client";

import { useEffect } from "react";

/** Counts one view per visitor per experiment (sessionStorage guard) so conversion rates have a real denominator. */
export function TrackView({ ws, experimentId, arm, visitorId }: { ws: string; experimentId: string; arm: "control" | "variant"; visitorId: string }) {
  useEffect(() => {
    const key = `sw_seen_${experimentId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      /* storage blocked: count anyway, the server rate-limits */
    }
    fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ws, experimentId, arm, visitorId }), keepalive: true }).catch(() => {});
  }, [ws, experimentId, arm, visitorId]);
  return null;
}
