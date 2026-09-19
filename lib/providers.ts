import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import type { SystemOneResult } from "@typesafe-ai/sdk";
import { RUBRIC_QUESTIONS, type RubricQuestions } from "./rubric";

/**
 * Provider configuration.
 *
 * OpenJev on Codiv is the only provider. Vercel AI Gateway used to sit in front
 * of it as the primary, but the gateway will not service a request until the
 * team has a credit card on file — it answers `GET /v1/models` happily and then
 * returns 403 `customer_verification_required` on every actual evaluation, so
 * "free credit" is not free to reach. Codiv's free tier needs no card.
 *
 * There is therefore nothing to fail over TO, and the code says so rather than
 * keeping a chain of one. What remains worth doing is not hammering a provider
 * that just rejected us on every single keystroke pause: that is the breaker.
 */

export type ProviderId = "codiv";

export interface ProviderSpec {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly note: string;
}

/* No fallback means no reason to cut the attempt short to leave time for one. */
const REQUEST_TIMEOUT_MS = 9_000;

/** How long to stop trying the provider after it fails, by reason. */
const COOLDOWN_MS = {
  /** Key rejected or out of credit. Real, but cheap to re-probe once it is fixed. */
  entitlement: 60_000,
  /** Rate limited: transient but real; back off for a bit. */
  rateLimit: 30_000,
  /** Down, slow, or unreachable: retry soon, it may come back. */
  unavailable: 15_000,
} as const;

type FailureKind = keyof typeof COOLDOWN_MS | "fatal";

/* ------------------------------------------------------------------------ */
/* Configuration                                                             */
/* ------------------------------------------------------------------------ */

interface ResolvedProvider extends ProviderSpec {
  readonly baseURL: string;
  readonly apiKey: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
}

/** The configured provider, or null when there is no key to use. */
function resolve(): ResolvedProvider | null {
  const apiKey = env("CODIV_API_KEY") ?? env("OPENJEV_API_KEY");
  if (!apiKey) return null;
  return {
    id: "codiv",
    label: "OpenJev · Codiv",
    model: env("LIVE_RUBRIC_CODIV_MODEL") ?? "openjev-latest",
    note: "Free tier — no card required",
    baseURL: env("CODIV_BASE_URL") ?? "https://api.codiv.ai",
    apiKey,
  };
}

/* The client is cached: a warm Vercel function reuses the connection pool
   instead of building a client per keystroke pause. */
let cached: { key: string; client: TypeSafeClient } | null = null;

function clientFor(p: ResolvedProvider): TypeSafeClient {
  const key = `${p.baseURL}\u0000${p.apiKey}\u0000${p.model}`;
  if (cached?.key !== key) {
    cached = {
      key,
      client: new TypeSafeClient({
        apiKey: p.apiKey,
        baseURL: p.baseURL,
        defaultModel: p.model,
        timeout: REQUEST_TIMEOUT_MS,
        // One attempt. A retry against a provider that just timed out costs
        // more wall-clock than it is worth when this runs on a typing pause.
        retry: { maxRetries: 0 },
        logLevel: "warn",
      }),
    };
  }
  return cached.client;
}

/* ------------------------------------------------------------------------ */
/* Circuit breaker                                                           */
/* ------------------------------------------------------------------------ */

interface OpenBreaker {
  readonly until: number;
  readonly kind: FailureKind;
  /* The failure that opened the breaker. Kept because a skipped attempt is
     otherwise unexplainable: "cooling down after entitlement" names the
     category but not the cause, and the cause is the part you can act on. */
  readonly reason: string;
}

/* Module scope, so it survives between invocations on a warm function. It is
   per-instance rather than shared, which is the right trade here: the cost of a
   cold instance re-learning that the provider is down is one request. */
let breaker: OpenBreaker | null = null;

/** The open breaker, or null when it is closed or has expired. */
function openBreaker(): OpenBreaker | null {
  if (!breaker) return null;
  if (Date.now() >= breaker.until) {
    breaker = null; // half-open: let the next request probe it
    return null;
  }
  return breaker;
}

function trip(kind: FailureKind, reason: string) {
  if (kind === "fatal") return; // our bug, not theirs — don't blame the provider
  breaker = { until: Date.now() + COOLDOWN_MS[kind], kind, reason };
}

/**
 * Classify a failure, which decides how long to stay away.
 *
 * A 400/422 means we built a bad request: waiting will not fix it, and the
 * provider is not the thing that is broken.
 */
function classify(error: unknown): FailureKind {
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 402 || error.status === 403) {
      return "entitlement";
    }
    if (error.status === 429) return "rateLimit";
    if (error.status >= 500) return "unavailable";
    return "fatal"; // 400, 404, 422 …
  }
  // Timeouts and connection failures are the "service does not respond" case.
  if (error instanceof APIConnectionError) return "unavailable";
  return "unavailable";
}

function describe(error: unknown): string {
  if (error instanceof APIError) {
    const body = error.body as { message?: string } | undefined;
    return `HTTP ${error.status}: ${body?.message ?? error.message}`;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

/* ------------------------------------------------------------------------ */
/* Evaluation                                                                */
/* ------------------------------------------------------------------------ */

export interface Attempt {
  readonly provider: ProviderId;
  readonly label: string;
  readonly ok: boolean;
  readonly reason?: string;
  /** True when the provider was skipped because its breaker was open. */
  readonly skipped?: boolean;
}

export interface Evaluation {
  readonly answers: SystemOneResult<RubricQuestions>["answers"];
  readonly provider: ProviderSpec;
  readonly usage: { input_tokens: number; output_tokens: number };
  readonly latencyMs: number;
  /** What happened on the way here — surfaced in the UI. */
  readonly attempts: readonly Attempt[];
}

export class NoProviderError extends Error {
  constructor(readonly attempts: readonly Attempt[]) {
    super(
      attempts.length === 0
        ? "No Jev provider is configured. Set CODIV_API_KEY."
        : `Evaluation failed: ${attempts.map((a) => `${a.label} (${a.reason})`).join("; ")}`,
    );
    this.name = "NoProviderError";
  }
}

/**
 * Evaluate `text` against the full rubric. One HTTP request; all 15 questions
 * ride along inside it and are answered in parallel.
 */
export async function evaluate(
  text: string,
  signal?: AbortSignal,
): Promise<Evaluation> {
  const provider = resolve();
  if (!provider) throw new NoProviderError([]);

  const open = openBreaker();
  if (open) {
    const secondsLeft = Math.ceil((open.until - Date.now()) / 1000);
    throw new NoProviderError([
      {
        provider: provider.id,
        label: provider.label,
        ok: false,
        skipped: true,
        reason: `${open.reason} (cooling down after ${open.kind}, ${secondsLeft}s left)`,
      },
    ]);
  }

  const started = performance.now();
  try {
    const result = await clientFor(provider).systemOne(
      { state: text, questions: RUBRIC_QUESTIONS, model: provider.model },
      { signal },
    );

    return {
      answers: result.answers,
      provider,
      usage: result.usage,
      latencyMs: Math.round(performance.now() - started),
      attempts: [{ provider: provider.id, label: provider.label, ok: true }],
    };
  } catch (error) {
    // The user typed again and we aborted this request on purpose. Not a
    // provider failure — never trip the breaker for it.
    if (error instanceof APIUserAbortError || signal?.aborted) throw error;

    const reason = describe(error);
    trip(classify(error), reason);
    throw new NoProviderError([
      { provider: provider.id, label: provider.label, ok: false, reason },
    ]);
  }
}

/** Provider and breaker state, for the status readout. */
export function providerStatus() {
  const provider = resolve();
  return {
    chain: provider
      ? [
          {
            id: provider.id,
            label: provider.label,
            model: provider.model,
            note: provider.note,
            available: openBreaker() === null,
          },
        ]
      : [],
    configured: provider !== null,
  };
}
