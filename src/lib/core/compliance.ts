export interface ComplianceIssue {
  rule: string;
  match: string;
  suggestion: string;
}

const RULES: Array<{ rule: string; pattern: RegExp; suggestion: string }> = [
  { rule: "Guaranteed results", pattern: /\b(guarantee[ds]?|guaranteed results?|risk[- ]free|can'?t fail|never fail)\b/i, suggestion: "Remove guarantees. Say what you do and how you measure it." },
  { rule: "Unrealistic speed", pattern: /\b(overnight|instantly|in (?:just )?\d+ (?:hours?|days?)|effortless|zero effort)\b/i, suggestion: "Avoid implying instant results; state a realistic window." },
  { rule: "Get-rich claims", pattern: /\b(get rich|make \$?\d[\d,]*k? (?:a|per) (?:day|week)|passive income)\b/i, suggestion: "Remove income claims." },
  { rule: "Fake scarcity", pattern: /\b(only \d+ (?:spots?|slots?) left|last chance|act now|expires (?:today|tonight))\b/i, suggestion: "Only use scarcity if it is true and verifiable." },
  { rule: "Personal attributes (Meta policy)", pattern: /\b(are you (?:struggling|suffering|broke|failing)|your (?:debt|bankruptcy|divorce|disease|diagnosis))\b/i, suggestion: "Meta prohibits ads implying knowledge of personal attributes. Address the business, not the person." },
  { rule: "Unverifiable superlatives", pattern: /\b(#1|number one|best in (?:the )?(?:world|country|usa|america)|world[- ]class)\b/i, suggestion: "Drop unverifiable superlatives or cite a source." },
  { rule: "Fabricated social proof", pattern: /\b(thousands of (?:happy )?clients|hundreds of (?:5-star )?reviews)\b/i, suggestion: "Only cite numbers you can document." },
];

export function checkAdCopy(text: string): ComplianceIssue[] {
  const issues: ComplianceIssue[] = [];
  for (const r of RULES) {
    const m = text.match(r.pattern);
    if (m) issues.push({ rule: r.rule, match: m[0], suggestion: r.suggestion });
  }
  return issues;
}

/** Social-proof sections must be backed by real, documented items. Placeholder content cannot be published. */
export interface ProofItem {
  title: string;
  body: string;
  verified: boolean; // you confirmed this is a real client result you may publish
}

export function publishableProof(items: ProofItem[]): { publishable: ProofItem[]; blocked: ProofItem[] } {
  return {
    publishable: items.filter((i) => i.verified),
    blocked: items.filter((i) => !i.verified),
  };
}

/** Commercial email footer: CAN-SPAM requires a postal address and a working unsubscribe mechanism. */
export function emailFooter(opts: { businessName: string; postalAddress: string; unsubscribeUrl: string }): { text: string; html: string } {
  const { businessName, postalAddress, unsubscribeUrl } = opts;
  if (!postalAddress.trim()) throw new Error("A physical postal address is required in commercial email footers");
  return {
    text: `\n\n--\n${businessName}\n${postalAddress}\nUnsubscribe: ${unsubscribeUrl}`,
    html: `<hr/><p style="font-size:12px;color:#666">${escapeHtml(businessName)}<br/>${escapeHtml(postalAddress)}<br/><a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a></p>`,
  };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
