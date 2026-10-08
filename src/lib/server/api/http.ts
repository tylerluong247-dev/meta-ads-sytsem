import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { InvalidTransitionError } from "@/lib/core/pipeline";
import { UniqueViolation } from "../repo";
import { MetaApiError } from "../services/meta";
import { NotFoundError, PermissionError, ValidationError } from "../services/common";
import { env } from "../env";

export function json(data: unknown, init?: number | ResponseInit) {
  return NextResponse.json(data, typeof init === "number" ? { status: init } : init);
}

/** Maps domain errors to HTTP. Unknown errors are logged server-side and returned without internals. */
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ValidationError) return json({ ok: false, error: e.message, fields: e.fields }, 400);
  if (e instanceof ZodError) return json({ ok: false, error: "Invalid input", fields: Object.fromEntries(e.issues.map((i) => [i.path.join("."), i.message])) }, 400);
  if (e instanceof PermissionError) return json({ ok: false, error: e.message }, e.message.startsWith("Sign in") ? 401 : 403);
  if (e instanceof NotFoundError) return json({ ok: false, error: e.message || "Not found" }, 404);
  if (e instanceof InvalidTransitionError || e instanceof UniqueViolation) return json({ ok: false, error: e.message }, 409);
  if (e instanceof MetaApiError) return json({ ok: false, error: `Meta: ${e.message}`, kind: e.kind }, e.kind === "auth" ? 401 : 502);
  console.error("Unhandled API error", e);
  return json({ ok: false, error: "Something went wrong. Please try again." }, 500);
}

/** CSRF defence for cookie-authenticated mutations: same-origin only, JSON only. */
export function assertSameOrigin(req: Request): void {
  const origin = req.headers.get("origin");
  if (origin) {
    const allowed = new URL(env.appUrl).origin;
    const host = req.headers.get("host");
    const o = new URL(origin);
    if (o.origin !== allowed && o.host !== host) throw new PermissionError("Cross-origin request blocked");
  } else if (!env.isDemo && req.headers.get("sec-fetch-site") === "cross-site") {
    throw new PermissionError("Cross-origin request blocked");
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new ValidationError("Content-Type must be application/json");
}

const MAX_BODY = 64 * 1024;
export async function readJson<T = unknown>(req: Request, maxBytes = MAX_BODY): Promise<T> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ValidationError("Request too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

/** Like readJson but an empty body is {}. For action endpoints that take no input. */
export async function readJsonOrEmpty<T = unknown>(req: Request, maxBytes = MAX_BODY): Promise<T> {
  const text = await req.text();
  if (!text.trim()) return {} as T;
  if (text.length > maxBytes) throw new ValidationError("Request too large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("Request body must be valid JSON");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

export function requireCron(req: Request): void {
  const secret = env.cronSecret;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) throw new PermissionError("Sign in required");
}
