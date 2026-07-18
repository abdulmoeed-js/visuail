// Hardcoded sample transcripts and their "extracted" typed models.
// This is the mock AI extraction — realistic sample data, no LLM call.

export type Confidence = number; // 0..1

export interface BaseItem {
  id: string;
  text: string;
  confidence: Confidence;
  snippet?: string;      // source quote, only for low-confidence items
  unresolved?: boolean;  // confidence < 0.7
  drift?: boolean;       // flipped by "simulate source change"
  userAdded?: boolean;   // added by the user in the workbench
  confirmedBySources?: string[]; // labels of sources that produced a matching item
  conflict?: boolean;    // multiple sources produced different text for the same item
  conflictNote?: string; // human-readable summary of the conflict
}

export interface Actor extends BaseItem {}
export interface Step extends BaseItem {
  actorId: string;
  systemId?: string;
  /** Visual variant. Undefined = default rectangle. */
  shape?: "step" | "terminator" | "document" | "io" | "subroutine" | "offpage" | "task" | "event" | "swimlane";
}
export interface Decision extends BaseItem {
  afterStepId: string;
  yes: string;
  no: string;
  shape?: "decision" | "gateway-exclusive" | "gateway-parallel";
}
export interface Exception extends BaseItem { relatedStepId?: string; }
export interface System extends BaseItem {}

export interface Connection {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  userAdded?: boolean;
}

export interface ProcessModel {
  kind: "process";
  title: string;
  actors: Actor[];
  steps: Step[];
  decisions: Decision[];
  exceptions: Exception[];
  systems: System[];
  connections?: Connection[];
}

export interface BMCBlock {
  id:
    | "segments" | "value" | "channels" | "relationships" | "revenue"
    | "resources" | "activities" | "partnerships" | "costs";
  title: string;
  items: BaseItem[];
  blockDrift?: boolean;
  driftNote?: string;
}

export interface BMCModel {
  kind: "bmc";
  title: string;
  blocks: BMCBlock[];
}

export type ArtifactModel = ProcessModel | BMCModel;

/* -------------------- Sample 1: Banking Onboarding (Process Map) -------------------- */

export const BANKING_TRANSCRIPT = `So when a business customer applies to open an account, the Relationship Manager receives the application through our online portal. First thing they do is check completeness in the CRM — if documents are missing they email the customer and just wait, which honestly can stall things for up to a week.

Once it's complete, Compliance runs KYC checks against the sanctions database. If the customer scores high risk, we hand it to a Compliance Officer for enhanced due diligence — otherwise it auto-approves. After approval, Operations opens the account in the core banking system.

Then someone sends a welcome pack — honestly I'm not totally sure who does that, could be Ops or the RM depending on the region. Finally the RM notifies the customer that the account is live.`;

export const bankingProcess: ProcessModel = {
  kind: "process",
  title: "Business account onboarding",
  actors: [
    { id: "AC1", text: "Relationship Manager", confidence: 0.96 },
    { id: "AC2", text: "Compliance Analyst",   confidence: 0.94 },
    { id: "AC3", text: "Compliance Officer",   confidence: 0.92 },
    { id: "AC4", text: "Operations",           confidence: 0.9  },
    { id: "AC5", text: "Customer",             confidence: 0.98 },
  ],
  systems: [
    { id: "SY1", text: "Online application portal", confidence: 0.95 },
    { id: "SY2", text: "CRM",                        confidence: 0.94 },
    { id: "SY3", text: "Sanctions database",         confidence: 0.9  },
    { id: "SY4", text: "Core banking system",        confidence: 0.93 },
  ],
  steps: [
    { id: "ST1", text: "Receive application via portal",           actorId: "AC1", systemId: "SY1", confidence: 0.95 },
    { id: "ST2", text: "Check application completeness in CRM",    actorId: "AC1", systemId: "SY2", confidence: 0.94 },
    { id: "ST3", text: "Run KYC against sanctions database",       actorId: "AC2", systemId: "SY3", confidence: 0.92 },
    { id: "ST4", text: "Enhanced due diligence (high-risk only)",  actorId: "AC3",                  confidence: 0.88 },
    { id: "ST5", text: "Open account in core banking system",      actorId: "AC4", systemId: "SY4", confidence: 0.93 },
    { id: "ST6", text: "Send welcome pack to customer",            actorId: "AC4",                  confidence: 0.52,
      snippet: "someone sends a welcome pack — honestly I'm not totally sure who does that",
      unresolved: true },
    { id: "ST7", text: "Notify customer account is live",          actorId: "AC1",                  confidence: 0.95 },
  ],
  decisions: [
    { id: "DC1", text: "Application complete?", afterStepId: "ST2", yes: "ST3", no: "EX1", confidence: 0.9 },
    { id: "DC2", text: "High-risk customer?",   afterStepId: "ST3", yes: "ST4", no: "ST5", confidence: 0.9 },
  ],
  exceptions: [
    { id: "EX1", text: "Email customer for missing docs; wait (can stall ~1 week)",
      relatedStepId: "ST2", confidence: 0.85 },
    { id: "EX2", text: "KYC hit blocks account opening", relatedStepId: "ST3", confidence: 0.7 },
  ],
};

/* -------------------- Sample 2: HaulPilot (BMC) -------------------- */

export const HAULPILOT_TRANSCRIPT = `Interviewer: Dana, walk me through HaulPilot in your own words.

Dana: Sure. HaulPilot is route-optimization SaaS for regional trucking fleets — think anyone running 50 to 500 trucks doing regional freight. That's the bullseye. We also get a lot of inbound from last-mile delivery companies, but honestly I don't think we're a great fit there and we haven't figured out if we should invest to make it work or politely decline.

Interviewer: What's the value prop you lead with?

Dana: Fuel savings, primarily. Our customers self-report 12–15% fuel reduction inside six months, though I'll be upfront that we haven't independently audited that number — it's what they tell us. Secondary is driver-hour compliance, which is more defensible.

Interviewer: How do you reach customers?

Dana: Direct sales is the main channel, we have three AEs. Telematics vendors — Samsara, Geotab — refer us in, that's probably a third of pipeline. Trade shows still work in this industry. We've talked about content marketing but haven't really invested seriously, so I couldn't tell you if it works.

Interviewer: How do you support them?

Dana: Anything above 200 trucks gets a dedicated CSM. Below that it's mostly self-serve with a shared inbox. We spun up a Slack community about a year ago — I honestly don't know if anyone's active in there anymore, I should check.

Interviewer: Revenue model?

Dana: Per-truck subscription, tiered. There's a one-time onboarding fee — usually 5k to 15k depending on integrations. We've been kicking around a fuel-card upsell for months but haven't decided if we're actually going to ship it.

Interviewer: Key resources and activities?

Dana: The routing algorithm team is the crown jewel — six engineers, two of them PhDs in operations research. Activities are model tuning, telematics integrations, and customer success. Partnerships — Samsara and Geotab formally, and we've got an informal reseller relationship with a Canadian fleet-services company. No contract, just a handshake, but it brings in leads.

Interviewer: Cost structure?

Dana: Payroll dominates. AWS is second and, candidly, growing faster than revenue — we haven't fully diagnosed why. Sales commissions, then a small marketing spend.`;

export const haulpilotBMC: BMCModel = {
  kind: "bmc",
  title: "HaulPilot — Business Model Canvas",
  blocks: [
    { id: "segments", title: "Customer Segments", items: [
      { id: "CS1", text: "Regional trucking fleets (50–500 trucks)", confidence: 0.94 },
      { id: "CS2", text: "Last-mile delivery companies",             confidence: 0.42,
        snippet: "we get a lot of inbound from last-mile … I don't think we're a great fit there", unresolved: true },
    ]},
    { id: "value", title: "Value Propositions", items: [
      { id: "VP1", text: "12–15% fuel reduction within 6 months",    confidence: 0.55,
        snippet: "customers self-report 12–15% … we haven't independently audited that", unresolved: true },
      { id: "VP2", text: "Driver-hour compliance",                    confidence: 0.9 },
      { id: "VP3", text: "Route optimization at fleet scale",         confidence: 0.92 },
    ]},
    { id: "channels", title: "Channels", items: [
      { id: "CH1", text: "Direct sales (3 AEs)",                       confidence: 0.94 },
      { id: "CH2", text: "Telematics-vendor referrals (Samsara, Geotab)", confidence: 0.9 },
      { id: "CH3", text: "Trade shows",                                confidence: 0.85 },
      { id: "CH4", text: "Content marketing",                          confidence: 0.4,
        snippet: "haven't really invested seriously, couldn't tell you if it works", unresolved: true },
    ]},
    { id: "relationships", title: "Customer Relationships", items: [
      { id: "CR1", text: "Dedicated CSM for accounts >200 trucks",     confidence: 0.92 },
      { id: "CR2", text: "Self-serve + shared inbox for smaller accounts", confidence: 0.88 },
      { id: "CR3", text: "Slack community",                            confidence: 0.4,
        snippet: "don't know if anyone's active in there anymore", unresolved: true },
    ]},
    { id: "revenue", title: "Revenue Streams", items: [
      { id: "RV1", text: "Per-truck subscription (tiered)",            confidence: 0.95 },
      { id: "RV2", text: "One-time onboarding fee ($5k–$15k)",         confidence: 0.9 },
      { id: "RV3", text: "Fuel-card upsell (undecided)",               confidence: 0.35,
        snippet: "kicking around a fuel-card upsell … haven't decided if we're going to ship it", unresolved: true },
    ]},
    { id: "resources", title: "Key Resources", items: [
      { id: "KR1", text: "Routing algorithm team (6 engineers, 2 OR PhDs)", confidence: 0.95 },
      { id: "KR2", text: "Telematics integrations",                    confidence: 0.9 },
      { id: "KR3", text: "Customer success org",                       confidence: 0.85 },
    ]},
    { id: "activities", title: "Key Activities", items: [
      { id: "KA1", text: "Routing model tuning",                       confidence: 0.92 },
      { id: "KA2", text: "Telematics integration development",         confidence: 0.9 },
      { id: "KA3", text: "Customer success & onboarding",              confidence: 0.88 },
    ]},
    { id: "partnerships", title: "Key Partnerships", items: [
      { id: "KP1", text: "Samsara (formal)",                           confidence: 0.92 },
      { id: "KP2", text: "Geotab (formal)",                            confidence: 0.92 },
      { id: "KP3", text: "Canadian fleet-services reseller (informal, no contract)", confidence: 0.5,
        snippet: "informal reseller relationship … no contract, just a handshake", unresolved: true },
    ]},
    { id: "costs", title: "Cost Structure", items: [
      { id: "CO1", text: "Payroll (dominant)",                          confidence: 0.94 },
      { id: "CO2", text: "AWS — growing faster than revenue, undiagnosed", confidence: 0.55,
        snippet: "AWS … growing faster than revenue — we haven't fully diagnosed why", unresolved: true },
      { id: "CO3", text: "Sales commissions",                           confidence: 0.9 },
      { id: "CO4", text: "Marketing (small)",                           confidence: 0.85 },
    ]},
  ],
};

/* -------------------- Sample 3: too-thin input (refuse-when-unsure) -------------------- */

export const THIN_TRANSCRIPT = `We help people do stuff. It's really good. Sign up.`;

export interface Sample {
  id: string;
  label: string;
  blurb: string;
  transcript: string;
  build: () => ArtifactModel | null;
}

export const SAMPLES: Sample[] = [
  {
    id: "banking",
    label: "Banking — business account onboarding",
    blurb: "Process map · 7 steps · 2 decisions",
    transcript: BANKING_TRANSCRIPT,
    build: () => structuredClone(bankingProcess),
  },
  {
    id: "haulpilot",
    label: "HaulPilot — founder discovery call",
    blurb: "Business Model Canvas · 9 blocks",
    transcript: HAULPILOT_TRANSCRIPT,
    build: () => structuredClone(haulpilotBMC),
  },
  {
    id: "thin",
    label: "Thin input — should refuse",
    blurb: "Demonstrates refuse-when-unsure",
    transcript: THIN_TRANSCRIPT,
    build: () => null,
  },
];

/* -------------------- Drift application -------------------- */

export function applyDrift(model: ArtifactModel): ArtifactModel {
  if (model.kind === "process") {
    return {
      ...model,
      steps: model.steps.map(s =>
        s.id === "ST4" || s.id === "ST5"
          ? { ...s, drift: true }
          : s,
      ),
      decisions: model.decisions.map(d =>
        d.id === "DC2" ? { ...d, drift: true } : d,
      ),
    };
  }
  return {
    ...model,
    blocks: model.blocks.map(b =>
      b.id === "revenue"
        ? {
            ...b,
            blockDrift: true,
            driftNote:
              "Follow-up call (Mar 14): fuel-card upsell was dropped. Team is piloting a data-licensing revenue stream with Samsara.",
            items: b.items.map(i =>
              i.id === "RV3" ? { ...i, drift: true } : i,
            ),
          }
        : b,
    ),
  };
}

export function driftSummary(model: ArtifactModel): { count: number; label: string } {
  if (model.kind === "process") {
    const n = model.steps.filter(s => s.drift).length +
              model.decisions.filter(d => d.drift).length;
    return { count: n, label: `${n} step${n === 1 ? "" : "s"} drifted` };
  }
  const n = model.blocks.filter(b => b.blockDrift).length;
  return { count: n, label: `${n} block${n === 1 ? "" : "s"} drifted` };
}

/* -------------------- Aggregate helpers -------------------- */

export function allItems(model: ArtifactModel): BaseItem[] {
  if (model.kind === "process") {
    return [
      ...model.actors, ...model.steps, ...model.decisions,
      ...model.exceptions, ...model.systems,
    ];
  }
  return model.blocks.flatMap(b => b.items);
}

export function stats(model: ArtifactModel) {
  const items = allItems(model);
  const avg = items.length ? items.reduce((a, b) => a + b.confidence, 0) / items.length : 0;
  const unresolved = items.filter(i => i.confidence < 0.7).length;
  return { count: items.length, avg, unresolved };
}
