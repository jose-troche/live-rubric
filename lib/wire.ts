import type { SystemOneResult } from "@typesafe-ai/sdk";
import type { RubricQuestions } from "./rubric";
import type { Attempt, ProviderId } from "./providers";

/** Answers, keyed by dimension, exactly as Jev returns them. */
export type RubricAnswers = SystemOneResult<RubricQuestions>["answers"];

/** A single answer, narrowed by the `type` discriminator the API sends back. */
export type AnyAnswer = RubricAnswers[keyof RubricAnswers];

export interface EvaluateSuccess {
  readonly ok: true;
  readonly answers: RubricAnswers;
  readonly provider: { id: ProviderId; label: string; model: string; note: string };
  readonly usage: { input_tokens: number; output_tokens: number };
  /** Server-measured round trip to the model, excluding our own overhead. */
  readonly latencyMs: number;
  /** USD for this single request. Input-priced; Jev bills no output tokens. */
  readonly costUsd: number;
  readonly attempts: readonly Attempt[];
}

export interface EvaluateFailure {
  readonly ok: false;
  readonly error: string;
  readonly attempts: readonly Attempt[];
  /** True when nothing is configured at all, which needs a different message. */
  readonly unconfigured: boolean;
}

export type EvaluateResponse = EvaluateSuccess | EvaluateFailure;

export interface EvaluateRequest {
  readonly text: string;
}

/**
 * $0.042 per 1M input tokens; output tokens are free.
 * Codiv's free tier bills nothing, but we price both the same way so the
 * running total answers the question the demo is actually making ("what would
 * this have cost?") rather than showing zero.
 */
export const USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export function priceOf(usage: { input_tokens: number }): number {
  return usage.input_tokens * USD_PER_INPUT_TOKEN;
}

/** The same fifteen questions asked of a frontier chat model, for comparison. */
export const GPT_CLASS_USD_PER_INPUT_TOKEN = 2.5 / 1_000_000;
