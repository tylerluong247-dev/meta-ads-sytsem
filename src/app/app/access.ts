import { notFound, redirect } from "next/navigation";
import { authorize, type Access } from "@/lib/server/context";
import { PermissionError } from "@/lib/server/services/common";
import type { Role } from "@/lib/server/entities";

/** Page-level door: signed-out users go to login; non-members and unknown slugs both get a 404. */
export async function pageAccess(slug: string, min: Role = "viewer"): Promise<Access> {
  try {
    return await authorize(slug, min);
  } catch (e) {
    if (e instanceof PermissionError) {
      if (e.message === "Sign in required") redirect("/login");
      notFound();
    }
    throw e;
  }
}
