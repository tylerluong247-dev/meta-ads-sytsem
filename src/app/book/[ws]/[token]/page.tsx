import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Booking } from "@/components/booking";
import { getServiceDeps } from "@/lib/server/context";
import { findLeadByToken } from "@/lib/server/services/booking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Book your call", robots: { index: false, follow: false } };

export default async function BookPage({ params }: { params: Promise<{ ws: string; token: string }> }) {
  const { ws, token } = await params;
  let name: string;
  let first: string;
  try {
    const found = await findLeadByToken(await getServiceDeps(), ws, token);
    name = found.ws.name;
    first = found.lead.firstName;
  } catch {
    notFound();
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <h1 className="font-serif text-3xl font-semibold">Hi {first}, pick a time</h1>
      <p className="mt-2 text-ink-soft">A short call with {name}. Choose any open time; you can change it later from the same link.</p>
      <Booking workspaceSlug={ws} token={token} />
    </main>
  );
}
