import { choice, noul, score } from "@typesafe-ai/sdk";
import type { Question } from "@typesafe-ai/sdk";

/**
 * The rubric: 15 dimensions evaluated in parallel inside ONE Jev request.
 *
 * It deliberately spans all three System One question types, because each one
 * answers a different shape of question:
 *
 *   score  — an ordered rubric. Returns an expected value that can land BETWEEN
 *            levels (3.4 of 4), so a bar moves smoothly as prose improves.
 *   choice — named alternatives. Returns the winner plus a probability per label,
 *            so you can watch the model change its mind mid-sentence.
 *   noul   — a yes/no proposition. Returns the raw probability of "true",
 *            which is the honest thing to plot for a claim about a document.
 *
 * Every dimension is written to apply to ANY prose, so the same 15 bars stay
 * comparable across a pull request, a postmortem and a tweet.
 */

export type DimensionKind = "score" | "choice" | "noul";

export interface DimensionMeta {
  /** Stable key — also the key of the answer in the Jev response. */
  readonly key: string;
  readonly kind: DimensionKind;
  /** Short label shown on the card. */
  readonly label: string;
  /** One-line explanation, shown on hover. */
  readonly hint: string;
  /** For score: the top of the scale (levels are 0..max). */
  readonly max?: number;
  /** For choice: label order, so bars never reshuffle between renders. */
  readonly options?: readonly string[];
  /** For noul: true when a HIGH probability is a bad thing. */
  readonly inverted?: boolean;
}

/* ------------------------------------------------------------------ score - */
/* Ordered rubrics. Index 0 is always the worst level; the array order IS the
   scale, so these read top-to-bottom as "how good can this get". */

const scoreQuestions = {
  clarity: score(
    "How clear and easy to follow is this text on a first read?",
    [
      "Confusing. A careful reader cannot tell what is being said.",
      "Rough. The point is buried and has to be reconstructed.",
      "Serviceable. Understandable, with some re-reading.",
      "Clear. The point lands on the first read.",
      "Exceptionally clear. Every sentence earns its place.",
    ],
  ),
  specificity: score(
    "How concrete and specific is this text, versus vague and general?",
    [
      "Entirely generic. Could describe almost anything.",
      "Mostly abstract, with occasional detail.",
      "A mix of concrete details and hand-waving.",
      "Specific. Names real things, numbers, systems or people.",
      "Highly specific and verifiable throughout.",
    ],
  ),
  structure: score(
    "How well organised is this text for its length?",
    [
      "No structure. One undifferentiated block.",
      "Loose. Ideas appear in no particular order.",
      "Reasonable grouping, with some drift.",
      "Well structured. Sections and order carry the argument.",
    ],
  ),
  actionability: score(
    "After reading this, how clearly does the reader know what to do next?",
    [
      "Nothing actionable at all.",
      "Implies something should happen, but not what.",
      "Names actions, but vaguely or without an owner.",
      "Clear actions a reader could start on today.",
      "Clear actions with owners, order and a definition of done.",
    ],
  ),
  completeness: score(
    "How complete is this text for what it is trying to be?",
    [
      "Major gaps. Key information is simply missing.",
      "Partial. A reader would have to ask several questions.",
      "Mostly complete, with one or two gaps.",
      "Complete. Answers the questions it raises.",
    ],
  ),
  concision: score(
    "How efficiently does this use the reader's attention?",
    [
      "Heavily padded. Most of it could be cut.",
      "Wordy. Noticeable filler and repetition.",
      "Acceptable length for the content.",
      "Tight. Little to cut without losing meaning.",
      "Every sentence load-bearing.",
    ],
  ),
} satisfies Record<string, Question>;

/* ----------------------------------------------------------------- choice - */
/* Named alternatives. Descriptions matter far more than the label strings —
   Jev reads the criteria, not the key. */

const choiceQuestions = {
  docType: choice("What kind of document is this?", {
    pull_request: "A code change description: what changed and why.",
    incident_report: "A postmortem or incident write-up about a failure.",
    job_posting: "A role advertisement aimed at candidates.",
    support_ticket: "A bug report or customer support request.",
    email: "A message written from one person to another.",
    social_post: "A short public post, tweet or announcement.",
  }),
  tone: choice("What is the dominant tone?", {
    formal: "Professional and measured; institutional register.",
    neutral: "Plain and factual, without colour either way.",
    casual: "Conversational, contractions, informal asides.",
    urgent: "Pressing; conveys time pressure or alarm.",
    promotional: "Selling something; enthusiastic and persuasive.",
  }),
  audience: choice("Who is this written for?", {
    engineers: "People who will read the code or run the system.",
    leadership: "Managers and executives who need the outcome, not the mechanism.",
    customers: "External users of the product.",
    general_public: "Anyone, with no assumed context.",
  }),
  readiness: choice("How close is this to ready to send?", {
    ship_it: "Send as is. No meaningful edits needed.",
    minor_edits: "A polish pass on wording would finish it.",
    needs_work: "Substantive rewriting or missing content required.",
    start_over: "The approach itself is wrong; begin again.",
  }),
  riskLevel: choice("What reputational or operational risk does sending this carry?", {
    none: "Nothing here could cause a problem.",
    low: "Minor: could read as sloppy.",
    moderate: "Could confuse, mislead or annoy the reader.",
    high: "Could cause real damage: leaks, blame, or a public mistake.",
  }),
} satisfies Record<string, Question>;

/* ------------------------------------------------------------------- noul - */
/* Propositions. The answer is a probability of "true" — plot it raw. */

const noulQuestions = {
  hasNextSteps: noul("Does this text state concrete next steps?", {
    true: "Specific follow-up actions are named.",
    false: "No next steps, or only a vague intention.",
  }),
  hasOwner: noul("Does this text name who is responsible?", {
    true: "A named person or team owns the work.",
    false: "Responsibility is unassigned or passive.",
  }),
  jargonHeavy: noul("Is this overloaded with jargon or acronyms an outsider could not follow?", {
    true: "Dense with unexplained internal terms or acronyms.",
    false: "Terms are either plain or explained on use.",
  }),
  evidenceBacked: noul("Are the claims here backed by evidence, numbers or links?", {
    true: "Claims cite data, logs, links or measurements.",
    false: "Claims are asserted without support.",
  }),
} satisfies Record<string, Question>;

/** The full question set, sent to Jev as a single parallel request. */
export const RUBRIC_QUESTIONS = {
  ...scoreQuestions,
  ...choiceQuestions,
  ...noulQuestions,
} satisfies Record<string, Question>;

export type RubricQuestions = typeof RUBRIC_QUESTIONS;
export type DimensionKey = keyof RubricQuestions & string;

/* --------------------------------------------------------------- metadata - */
/* Presentation-side description of the same 15 dimensions. Kept beside the
   questions so the two can never drift apart — see the assertion below. */

export const DIMENSIONS: readonly DimensionMeta[] = [
  { key: "clarity", kind: "score", label: "Clarity", max: 4, hint: "Does the point land on a first read?" },
  { key: "specificity", kind: "score", label: "Specificity", max: 4, hint: "Concrete details versus hand-waving." },
  { key: "structure", kind: "score", label: "Structure", max: 3, hint: "Is it organised for its length?" },
  { key: "actionability", kind: "score", label: "Actionability", max: 4, hint: "Does the reader know what to do next?" },
  { key: "completeness", kind: "score", label: "Completeness", max: 3, hint: "Does it answer the questions it raises?" },
  { key: "concision", kind: "score", label: "Concision", max: 4, hint: "How much could be cut without loss?" },

  { key: "docType", kind: "choice", label: "Document type", hint: "What Jev thinks you are writing.", options: ["pull_request", "incident_report", "job_posting", "support_ticket", "email", "social_post"] },
  { key: "tone", kind: "choice", label: "Tone", hint: "The dominant register.", options: ["formal", "neutral", "casual", "urgent", "promotional"] },
  { key: "audience", kind: "choice", label: "Audience", hint: "Who this is pitched at.", options: ["engineers", "leadership", "customers", "general_public"] },
  { key: "readiness", kind: "choice", label: "Readiness", hint: "How close this is to sendable.", options: ["ship_it", "minor_edits", "needs_work", "start_over"] },
  { key: "riskLevel", kind: "choice", label: "Risk", hint: "What sending this could cost you.", options: ["none", "low", "moderate", "high"] },

  { key: "hasNextSteps", kind: "noul", label: "States next steps", hint: "Probability that concrete follow-ups are named." },
  { key: "hasOwner", kind: "noul", label: "Names an owner", hint: "Probability that someone is accountable." },
  { key: "jargonHeavy", kind: "noul", label: "Jargon-heavy", hint: "Probability an outsider would be lost.", inverted: true },
  { key: "evidenceBacked", kind: "noul", label: "Evidence-backed", hint: "Probability claims are supported." },
];

/** Human-readable names for choice labels, so the UI never shows snake_case. */
export const OPTION_LABELS: Record<string, string> = {
  pull_request: "Pull request",
  incident_report: "Incident report",
  job_posting: "Job posting",
  support_ticket: "Support ticket",
  email: "Email",
  social_post: "Social post",
  formal: "Formal",
  neutral: "Neutral",
  casual: "Casual",
  urgent: "Urgent",
  promotional: "Promotional",
  engineers: "Engineers",
  leadership: "Leadership",
  customers: "Customers",
  general_public: "General public",
  ship_it: "Ship it",
  minor_edits: "Minor edits",
  needs_work: "Needs work",
  start_over: "Start over",
  none: "None",
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

export const DIMENSIONS_BY_KIND = {
  score: DIMENSIONS.filter((d) => d.kind === "score"),
  choice: DIMENSIONS.filter((d) => d.kind === "choice"),
  noul: DIMENSIONS.filter((d) => d.kind === "noul"),
} as const;

/* A metadata entry that names no real question would render an empty card
   forever, and a question with no metadata would be paid for and never shown.
   Both are silent failures, so fail loudly at module load instead. */
{
  const questionKeys = new Set(Object.keys(RUBRIC_QUESTIONS));
  const metaKeys = new Set(DIMENSIONS.map((d) => d.key));
  const missing = [...questionKeys].filter((k) => !metaKeys.has(k));
  const extra = [...metaKeys].filter((k) => !questionKeys.has(k));
  if (missing.length || extra.length) {
    throw new Error(
      `rubric metadata is out of sync with the questions: ` +
        `${missing.length ? `no card for [${missing}] ` : ""}` +
        `${extra.length ? `no question for [${extra}]` : ""}`,
    );
  }
}
