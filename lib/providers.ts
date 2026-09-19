import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  TypeSafeClient,
} from "@typesafe-ai/sdk";
import type { SystemOneResult } from "@typesafe-ai/sdk";
import { RUBRIC_QUESTIONS, type RubricQuestions } from "./rubric";

/**
 * Provider selection and failover.
 *
 * The brief is "use the free Jev in the Vercel environment; fall back to OpenJev
 * when the free period ends or the service stops responding". That is cheap to
 * implement well here because Codiv implements the SAME wire API as TypeSafe —
 * so failover is a base-URL swap, not a second integration. The whole rubric,
 * the response parsing and the types are shared.
 *
 * The parts that need actual care are (a) deciding which failures are worth
 * failing over for, and (b) not paying the dead provider's timeout on every
 * single keystroke pause. Both are handled below.
 */

export type ProviderId = "vercel" | "typesafe" | "codiv" | "mock";

export interface ProviderSpec {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  readonly note: string;
}

const PRIMARY_TIMEOUT_MS = 6_000;
const FALLBACK_TIMEOUT_MS = 9_000;

/** How long to stop trying a provider after it fails, by reason. */
const COOLDOWN_MS = {
  /** Out of credit / key rejected: the free period is over. Don't keep asking. */
  entitlement: 10 * 60_000,
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

/**
 * On Vercel the platform injects `VERCEL_OIDC_TOKEN` and AI Gateway accepts it
 * as a bearer token, so a deployment authenticates with no configuration at all.
 * An explicit `AI_GATEWAY_API_KEY` wins when present (and is what you use for a
 * local `next dev`).
 */
function resolveAll(): ResolvedProvider[] {
  const candidates: (ResolvedProvider | null)[] = [];

  const gatewayKey = env("AI_GATEWAY_API_KEY") ?? env("VERCEL_OIDC_TOKEN");
  candidates.push(
    gatewayKey
      ? {
          id: "vercel",
          label: "Jev · Vercel AI Gateway",
          model: env("LIVE_RUBRIC_VERCEL_MODEL") ?? "typesafe-ai/jev",
          note: "Free credit in the Vercel environment",
          baseURL: env("AI_GATEWAY_BASE_URL") ?? "https://ai-gateway.vercel.sh/typesafe",
          apiKey: gatewayKey,
        }
      : null,
  );

  const typesafeKey = env("TYPESAFE_API_KEY");
  candidates.push(
    typesafeKey
      ? {
          id: "typesafe",
          label: "Jev · TypeSafe direct",
          model: env("TYPESAFE_DEFAULT_MODEL") ?? "jev-latest",
          note: "Direct api.typesafe.ai key",
          baseURL: env("TYPESAFE_BASE_URL") ?? "https://api.typesafe.ai",
          apiKey: typesafeKey,
        }
      : null,
  );

  const codivKey = env("CODIV_API_KEY") ?? env("OPENJEV_API_KEY");
  candidates.push(
    codivKey
      ? {
          id: "codiv",
          label: "OpenJev · Codiv",
          model: env("LIVE_RUBRIC_CODIV_MODEL") ?? "openjev-latest",
          note: "Open-weights fallback",
          baseURL: env("CODIV_BASE_URL") ?? "https://api.codiv.ai",
          apiKey: codivKey,
        }
      : null,
  );

  const resolved = candidates.filter((c): c is ResolvedProvider => c !== null);

  // An explicit preference reorders the chain rather than replacing it, so the
  // fallback still exists when you pin a primary.
  const preferred = env("LIVE_RUBRIC_PRIMARY");
  if (preferred) {
    resolved.sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  }
  return resolved;
}

/* Clients are cached per base URL: a warm Vercel function reuses the connection
   pool instead of building a client per keystroke pause. */
const clients = new Map<string, TypeSafeClient>();

function clientFor(p: ResolvedProvider, timeout: number): TypeSafeClient {
  const cacheKey = `${p.baseURL}\u0000${timeout}`;
  let client = clients.get(cacheKey);
  if (!client) {
    client = new TypeSafeClient({
      apiKey: p.apiKey,
      baseURL: p.baseURL,
      defaultModel: p.model,
      timeout,
      // We fail over instead of retrying in place: a second attempt against a
      // provider that just timed out costs more wall-clock than the next
      // provider's first attempt, and this runs on a typing pause.
      retry: { maxRetries: 0 },
      logLevel: "warn",
    });
    clients.set(cacheKey, client);
  }
  return client;
}

/* ------------------------------------------------------------------------ */
/* Circuit breaker                                                           */
/* ------------------------------------------------------------------------ */

/* Module scope, so it survives between invocations on a warm function. It is
   per-instance rather than shared, which is the right trade here: the cost of a
   cold instance re-learning that a provider is down is one request. */
const openUntil = new Map<ProviderId, { until: number; kind: FailureKind }>();

function isTripped(id: ProviderId): boolean {
  const entry = openUntil.get(id);
  if (!entry) return false;
  if (Date.now() >= entry.until) {
    openUntil.delete(id); // half-open: let the next request probe it
    return false;
  }
  return true;
}

function trip(id: ProviderId, kind: FailureKind) {
  if (kind === "fatal") return; // our bug, not theirs — don't blame the provider
  openUntil.set(id, { until: Date.now() + COOLDOWN_MS[kind], kind });
}

/**
 * Decide whether another provider could plausibly do better.
 *
 * A 400/422 means we built a bad request: the fallback would reject it too, so
 * failing over just doubles the latency before showing the same error.
 */
function classify(error: unknown): FailureKind {
  if (error instanceof APIError) {
    if (error.status === 401 || error.status === 403 || error.status === 402) {
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
  /** Everything tried before this succeeded — surfaced in the UI. */
  readonly attempts: readonly Attempt[];
  readonly degraded: boolean;
}

export class NoProviderError extends Error {
  constructor(readonly attempts: readonly Attempt[]) {
    super(
      attempts.length === 0
        ? "No Jev provider is configured. Set AI_GATEWAY_API_KEY or CODIV_API_KEY."
        : `Every provider failed: ${attempts.map((a) => `${a.label} (${a.reason})`).join("; ")}`,
    );
    this.name = "NoProviderError";
  }
}

/**
 * Evaluate `text` against the full rubric, walking the provider chain until one
 * answers. One HTTP request per provider attempt; all 15 questions ride along
 * inside it and are answered in parallel.
 */
export async function evaluate(
  text: string,
  signal?: AbortSignal,
): Promise<Evaluation> {
  const chain = resolveAll();
  const attempts: Attempt[] = [];

  for (const [index, provider] of chain.entries()) {
    const isPrimary = index === 0;

    if (isTripped(provider.id)) {
      attempts.push({
        provider: provider.id,
        label: provider.label,
        ok: false,
        skipped: true,
        reason: `cooling down after ${openUntil.get(provider.id)?.kind}`,
      });
      continue;
    }

    const started = performance.now();
    try {
      const result = await clientFor(
        provider,
        isPrimary ? PRIMARY_TIMEOUT_MS : FALLBACK_TIMEOUT_MS,
      ).systemOne(
        { state: text, questions: RUBRIC_QUESTIONS, model: provider.model },
        { signal },
      );

      attempts.push({ provider: provider.id, label: provider.label, ok: true });
      return {
        answers: result.answers,
        provider: provider,
        usage: result.usage,
        latencyMs: Math.round(performance.now() - started),
        attempts,
        degraded: index > 0,
      };
    } catch (error) {
      // The user typed again and we aborted this request on purpose. Not a
      // provider failure — never trip the breaker for it.
      if (error instanceof APIUserAbortError || signal?.aborted) throw error;

      const kind = classify(error);
      const reason = describe(error);
      attempts.push({ provider: provider.id, label: provider.label, ok: false, reason });
      trip(provider.id, kind);

      if (kind === "fatal") break; // the next provider would reject it identically
    }
  }

  throw new NoProviderError(attempts);
}

/** Provider chain and breaker state, for the status readout. */
export function providerStatus() {
  return {
    chain: resolveAll().map((p) => ({
      id: p.id,
      label: p.label,
      model: p.model,
      note: p.note,
      available: !isTripped(p.id),
    })),
    configured: resolveAll().length > 0,
  };
}
