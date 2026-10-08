"use client";

import { useMemo, useState } from "react";
import { Booking } from "./booking";

interface Props {
  workspaceSlug: string;
  jobNoun: string;
  experimentId?: string;
  visitorId: string;
  cta: string;
}

const REVENUE = [["under_10k", "Under $10k"], ["10k_30k", "$10k–$30k"], ["30k_100k", "$30k–$100k"], ["over_100k", "Over $100k"]] as const;
const BUDGET = [["under_1k", "Under $1k"], ["1k_3k", "$1k–$3k"], ["3k_10k", "$3k–$10k"], ["over_10k", "Over $10k"]] as const;
const TIMELINE = [["asap", "As soon as possible"], ["within_30_days", "Within 30 days"], ["within_90_days", "Within 90 days"], ["exploring", "Just exploring"]] as const;

const CONSENT_TEXT = "I agree that ScaleWaves Media may contact me by email and phone about my request. I can opt out at any time.";

export function LeadForm({ workspaceSlug, jobNoun, experimentId, visitorId, cta }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [consent, setConsent] = useState(false);
  const [sms, setSms] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; canBook: boolean } | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setValues((v) => ({ ...v, [k]: e.target.value }));

  // Only ask about investment once we know a little about the business: conditional, not aggressive.
  const showInvest = useMemo(() => Boolean(values.monthlyRevenue && values.budgetRange), [values.monthlyRevenue, values.budgetRange]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    setFormError("");
    const payload: Record<string, unknown> = {
      workspaceSlug, firstName: values.firstName ?? "", lastName: values.lastName, email: values.email ?? "", phone: values.phone, businessName: values.businessName, website: values.website,
      city: values.city, state: values.state, monthlyRevenue: values.monthlyRevenue || undefined, currentLeadGenMethod: values.currentLeadGenMethod, primaryProblem: values.primaryProblem,
      desiredOutcome: values.desiredOutcome, budgetRange: values.budgetRange || undefined, timeline: values.timeline || undefined,
      readyToInvest: showInvest && values.readyToInvest ? values.readyToInvest === "yes" : undefined,
      contactConsent: consent ? true : undefined, smsConsent: sms && Boolean(values.phone), company_website_url: values.company_website_url ?? "",
      landingUrl: window.location.href, visitorId, experimentId, consentText: CONSENT_TEXT,
    };
    try {
      const res = await fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setErrors(data.fields ?? {});
        setFormError(data.error ?? "Something went wrong. Please try again.");
      } else setResult({ token: data.token, canBook: data.canBook });
    } catch {
      setFormError("Network problem. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return result.canBook && result.token ? (
      <div>
        <h3 className="font-serif text-2xl font-semibold">Thanks. Pick a time for your call.</h3>
        <p className="mt-1 text-sm text-ink-soft">We&apos;ve emailed you the next step too.</p>
        <Booking workspaceSlug={workspaceSlug} token={result.token} />
      </div>
    ) : (
      <div role="status">
        <h3 className="font-serif text-2xl font-semibold">Thanks, we&apos;ve got your request.</h3>
        <p className="mt-2 text-ink-soft">Based on what you shared, we may not be the right fit for {jobNoun} right now. We&apos;ll email you if that changes.</p>
      </div>
    );
  }

  const field = "mt-1 w-full rounded-md border border-line bg-white px-3 py-2.5 text-base focus:border-accent";
  const err = (k: string) => errors[k] && <p role="alert" className="mt-1 text-sm text-bad">{errors[k]}</p>;
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="text-sm font-medium" htmlFor="firstName">First name</label><input id="firstName" autoComplete="given-name" required className={field} onChange={set("firstName")} />{err("firstName")}</div>
        <div><label className="text-sm font-medium" htmlFor="lastName">Last name</label><input id="lastName" autoComplete="family-name" className={field} onChange={set("lastName")} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="text-sm font-medium" htmlFor="email">Work email</label><input id="email" type="email" autoComplete="email" required className={field} onChange={set("email")} />{err("email")}</div>
        <div><label className="text-sm font-medium" htmlFor="phone">Phone</label><input id="phone" type="tel" autoComplete="tel" className={field} onChange={set("phone")} />{err("phone")}</div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="text-sm font-medium" htmlFor="businessName">Business name</label><input id="businessName" autoComplete="organization" className={field} onChange={set("businessName")} /></div>
        <div><label className="text-sm font-medium" htmlFor="city">City, state</label><input id="city" placeholder="Tampa, FL" className={field} onChange={(e) => { const [c, s] = e.target.value.split(",").map((x) => x.trim()); setValues((v) => ({ ...v, city: c ?? "", state: s ?? "" })); }} /></div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div><label className="text-sm font-medium" htmlFor="monthlyRevenue">Monthly revenue</label><select id="monthlyRevenue" className={field} onChange={set("monthlyRevenue")} defaultValue=""><option value="" disabled>Select</option>{REVENUE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label className="text-sm font-medium" htmlFor="budgetRange">Monthly marketing budget</label><select id="budgetRange" className={field} onChange={set("budgetRange")} defaultValue=""><option value="" disabled>Select</option>{BUDGET.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      </div>
      <div><label className="text-sm font-medium" htmlFor="primaryProblem">What&apos;s the biggest thing standing in the way of more {jobNoun}?</label><textarea id="primaryProblem" rows={3} maxLength={1000} className={field} onChange={set("primaryProblem")} /></div>
      <div><label className="text-sm font-medium" htmlFor="timeline">How soon would you like to start?</label><select id="timeline" className={field} onChange={set("timeline")} defaultValue=""><option value="" disabled>Select</option>{TIMELINE.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
      {showInvest && (
        <fieldset>
          <legend className="text-sm font-medium">If we determine that we can help, are you prepared to invest in a marketing system?</legend>
          <div className="mt-2 flex gap-5">
            {[["yes", "Yes"], ["no", "Not right now"]].map(([v, l]) => (
              <label key={v} className="flex items-center gap-2"><input type="radio" name="readyToInvest" value={v} onChange={set("readyToInvest")} />{l}</label>
            ))}
          </div>
        </fieldset>
      )}
      {/* Honeypot: hidden from people and assistive tech, bots fill it in. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave empty<input tabIndex={-1} autoComplete="off" onChange={set("company_website_url")} /></label></div>
      <div className="space-y-2 rounded-md bg-paper p-3 text-sm">
        <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} /><span>{CONSENT_TEXT}</span></label>
        {errors.contactConsent && <p role="alert" className="text-bad">{errors.contactConsent}</p>}
        <label className="flex items-start gap-2 text-ink-soft"><input type="checkbox" className="mt-1" checked={sms} onChange={(e) => setSms(e.target.checked)} /><span>Optional: you may also text me about my request. Message and data rates may apply. Reply STOP to opt out.</span></label>
      </div>
      {formError && <p role="alert" className="text-sm text-bad">{formError}</p>}
      <button disabled={busy} className="w-full rounded-md bg-accent px-5 py-3.5 text-base font-semibold text-white hover:brightness-110 disabled:opacity-60">{busy ? "Sending…" : cta}</button>
      <p className="text-xs text-ink-soft">We&apos;ll only use your details to reply to this request. No spam, one-click unsubscribe.</p>
    </form>
  );
}
