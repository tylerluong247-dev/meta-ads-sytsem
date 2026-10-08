/**
 * Default landing-page copy per niche. Everything here is a claim the agency can stand behind:
 * no guarantees, no invented numbers, no invented testimonials. Social proof only renders from
 * verified items saved in the dashboard (see landingPages.content.caseStudies).
 */
export interface Niche {
  slug: string;
  label: string; // "roofing"
  workspaceHint: string; // workspace slug or industry that receives leads from this page
  accent: string;
  headline: string;
  subheadline: string;
  problem: { title: string; points: string[] };
  benefits: Array<{ title: string; body: string }>;
  process: Array<{ title: string; body: string }>;
  offer: { title: string; body: string };
  faq: Array<{ q: string; a: string }>;
  cta: string;
  jobNoun: string; // "estimates"
}

const commonFaq = (jobNoun: string) => [
  { q: "Do you guarantee a number of " + jobNoun + "?", a: "No. Results depend on your market, your offer and how fast you follow up. On the call we look at your numbers and tell you what a realistic range looks like, or that we're not a fit." },
  { q: "How much does it cost?", a: "We'll go through pricing on the call once we know your service area and goals. There's no charge for the call itself." },
  { q: "Will I be locked into a long contract?", a: "We'll walk through the exact terms on the call so there are no surprises. Ask us anything about them before you decide." },
  { q: "What happens with the information I submit?", a: "We use it to prepare for your call and to contact you about your request. You can opt out of emails at any time with one click." },
];

export const NICHES: Record<string, Niche> = {
  roofing: {
    slug: "roofing", label: "roofing", workspaceHint: "roofing", accent: "#b25a1e", jobNoun: "estimates",
    headline: "Generate 10–15 qualified roofing opportunities per month without relying on door-to-door sales.",
    subheadline: "We run the ads, screen the inquiries and put the calls on your calendar. You show up and quote.",
    problem: { title: "Why the calendar feels random", points: ["Referrals dry up the week after a big storm season ends.", "Lead-list companies sell the same homeowner to five roofers.", "Inquiries sit for hours and the homeowner hires whoever called first."] },
    benefits: [
      { title: "Inquiries from homeowners who asked", body: "People who requested an estimate, not purchased lists or cold-called numbers." },
      { title: "Screened before they reach you", body: "We check area, project and timeline so your crew isn't driving to dead ends." },
      { title: "Every lead tracked to revenue", body: "You see what each ad cost and which jobs it produced, not just clicks." },
    ],
    process: [
      { title: "Short call", body: "We look at your area, capacity and numbers, and tell you honestly if it's a fit." },
      { title: "Launch", body: "We build the offer, ads and follow-up, and send everything for your approval first." },
      { title: "Review weekly", body: "You get the real numbers: spend, inquiries, booked estimates, closed jobs." },
    ],
    offer: { title: "Get a realistic plan for more roofing estimates", body: "A 20-minute call to review your market, your current lead sources and what a sensible monthly target looks like." },
    faq: commonFaq("estimates"), cta: "Book my strategy call",
  },
  hvac: {
    slug: "hvac", label: "HVAC", workspaceHint: "hvac-test", accent: "#1d6fa5", jobNoun: "service calls",
    headline: "Fill your HVAC schedule with homeowners who are ready to book, not shopping on price alone.",
    subheadline: "We handle the ads and the screening. Your team handles the installs and repairs.",
    problem: { title: "Where HVAC marketing leaks", points: ["Slow seasons swing revenue far more than they should.", "Price-shoppers call five companies and pick the cheapest.", "After-hours inquiries wait until morning and go elsewhere."] },
    benefits: [
      { title: "Seasonal offers that fit your capacity", body: "Tune-ups in spring, replacements in summer, planned so you aren't overbooked." },
      { title: "Fast follow-up built in", body: "Every inquiry gets an immediate reply and a link to book." },
      { title: "Cost per booked call, not cost per click", body: "We judge ads on booked calls and closed jobs." },
    ],
    process: [
      { title: "Short call", body: "We review your service area, capacity and average ticket." },
      { title: "Launch", body: "Offer, ads, booking page and follow-up, approved by you first." },
      { title: "Review weekly", body: "Spend, booked calls and jobs won, tracked end to end." },
    ],
    offer: { title: "See what a steady HVAC pipeline could look like", body: "A 20-minute call covering your market, capacity and a realistic monthly goal." },
    faq: commonFaq("service calls"), cta: "Book my strategy call",
  },
  "med-spa": {
    slug: "med-spa", label: "med spa", workspaceHint: "med-spa", accent: "#7a5c8a", jobNoun: "consultations",
    headline: "Fill your consultation calendar with people who actually want treatment.",
    subheadline: "Compliant ads, fast follow-up and a booking page that does the explaining for you.",
    problem: { title: "Why consultations go unfilled", points: ["Discount-driven leads rarely become repeat clients.", "No-shows eat the schedule you worked to fill.", "Ad rules for health and wellness are strict and easy to trip."] },
    benefits: [
      { title: "Ad copy checked against platform rules", body: "No before/after claims or personal-attribute targeting that gets accounts flagged." },
      { title: "Reminders that reduce no-shows", body: "Confirmation and reminders go out automatically." },
      { title: "Tracked to booked and attended", body: "See which ads produce attended consultations, not just inquiries." },
    ],
    process: [
      { title: "Short call", body: "We review your treatments, capacity and goals." },
      { title: "Launch", body: "Compliant offer, ads and follow-up for your approval." },
      { title: "Review weekly", body: "Booked and attended consultations by campaign." },
    ],
    offer: { title: "Plan a consultation pipeline you can measure", body: "A 20-minute call to look at your treatments, capacity and what to test first." },
    faq: commonFaq("consultations"), cta: "Book my strategy call",
  },
  law: {
    slug: "law", label: "law firm", workspaceHint: "law", accent: "#2f4a6b", jobNoun: "consultations",
    headline: "Qualified case inquiries for your firm, screened before they reach your intake team.",
    subheadline: "Ads that follow bar advertising rules, with fast response and clear tracking.",
    problem: { title: "What slows intake", points: ["Unqualified inquiries consume attorney time.", "Slow response sends clients to the next firm.", "Marketing spend is hard to tie to signed cases."] },
    benefits: [
      { title: "Practice-area and location screening", body: "Inquiries are checked against the matters you take." },
      { title: "Fast first response", body: "Immediate acknowledgement and a link to book an intake call." },
      { title: "Spend tied to signed cases", body: "Revenue attribution from ad to engagement." },
    ],
    process: [
      { title: "Short call", body: "We review practice areas, jurisdictions and intake capacity." },
      { title: "Launch", body: "Compliant ads and intake flow, reviewed by you before going live." },
      { title: "Review weekly", body: "Inquiries, consultations booked and cases signed." },
    ],
    offer: { title: "Review your intake funnel", body: "A 20-minute call. You should confirm all ad copy meets your jurisdiction's advertising rules; we'll flag likely issues." },
    faq: commonFaq("consultations"), cta: "Book my strategy call",
  },
  contractors: {
    slug: "contractors", label: "contracting", workspaceHint: "contractors", accent: "#3c6e47", jobNoun: "project inquiries",
    headline: "More qualified project inquiries for general contractors, without chasing every bid.",
    subheadline: "We pre-screen scope, budget and timeline so you spend time on jobs worth quoting.",
    problem: { title: "The quoting treadmill", points: ["Hours go into bids for homeowners who never intended to hire.", "Referral pipelines are hard to scale on demand.", "Online lead marketplaces charge for shared, low-intent leads."] },
    benefits: [
      { title: "Scope and budget screened up front", body: "Inquiries include project type, budget range and timeline." },
      { title: "Exclusive inquiries", body: "People who contacted you, not a shared lead." },
      { title: "Tracked to signed projects", body: "See which ads produce contracts." },
    ],
    process: [
      { title: "Short call", body: "We review your project types, minimum job size and service area." },
      { title: "Launch", body: "Offer, ads and follow-up for your approval." },
      { title: "Review weekly", body: "Inquiries, estimates booked and projects signed." },
    ],
    offer: { title: "Find out what a steady project pipeline takes", body: "A 20-minute call to review your market and a realistic target." },
    faq: commonFaq("project inquiries"), cta: "Book my strategy call",
  },
  remodeling: {
    slug: "remodeling", label: "remodeling", workspaceHint: "remodeling", accent: "#8a6a2f", jobNoun: "project inquiries",
    headline: "Book more in-home consultations for kitchen, bath and whole-home remodels.",
    subheadline: "We screen for budget and timeline so your designers meet homeowners ready to move.",
    problem: { title: "Where remodel leads fall apart", points: ["Browsers outnumber buyers online.", "Long sales cycles need steady follow-up.", "Budgets are discovered too late."] },
    benefits: [
      { title: "Budget range asked early, politely", body: "So consultations go to homeowners who can afford the project." },
      { title: "Automated follow-up that stops when they book", body: "Helpful, not spammy, and one-click opt-out." },
      { title: "Attribution to signed projects", body: "Even on long sales cycles." },
    ],
    process: [
      { title: "Short call", body: "We review your services, average project and capacity." },
      { title: "Launch", body: "Offer, ads and follow-up for your approval." },
      { title: "Review weekly", body: "Consultations booked, proposals out, projects signed." },
    ],
    offer: { title: "Plan your consultation pipeline", body: "A 20-minute call to review your market and sales cycle." },
    faq: commonFaq("project inquiries"), cta: "Book my strategy call",
  },
  epoxy: {
    slug: "epoxy", label: "epoxy flooring", workspaceHint: "epoxy", accent: "#4a5560", jobNoun: "quotes",
    headline: "Steady quote requests for epoxy and garage-floor installers.",
    subheadline: "Photo-friendly offers, fast follow-up and a calendar that fills with real quotes.",
    problem: { title: "Why quote requests are uneven", points: ["Demand spikes with the weather and drops off after.", "Homeowners compare on price before quality.", "Photos and sizes arrive late, so quotes stall."] },
    benefits: [
      { title: "Square footage and photos up front", body: "Inquiries arrive quote-ready." },
      { title: "Residential and commercial paths", body: "Different offers for garages and warehouses." },
      { title: "Tracked from ad to installed job", body: "See which ads produce booked installs." },
    ],
    process: [
      { title: "Short call", body: "We review your service area and job mix." },
      { title: "Launch", body: "Offer, ads and quote flow for your approval." },
      { title: "Review weekly", body: "Quotes sent, jobs booked and revenue by ad." },
    ],
    offer: { title: "See how a steady quote pipeline could work", body: "A 20-minute call to review your market and capacity." },
    faq: commonFaq("quotes"), cta: "Book my strategy call",
  },
};

export function nicheFor(slug: string): Niche | null {
  return NICHES[slug] ?? null;
}
