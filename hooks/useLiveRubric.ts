"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EvaluateResponse, RubricAnswers } from "@/lib/wire";
import { GPT_CLASS_USD_PER_INPUT_TOKEN } from "@/lib/wire";

/** Quiet period after the last edit before we score. */
const DEBOUNCE_MS = 400;
/**
 * …but never wait longer than this while someone is still typing. Without a
 * ceiling, continuous typing means the bars never move, which is the one thing
 * this demo has to do.
 */
const MAX_WAIT_MS = 1_400;

export interface RubricState {
  readonly answers: RubricAnswers | null;
  readonly provider: { id: string; label: string; model: string; note: string } | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly costUsd: number | null;
  readonly degraded: boolean;
  readonly pending: boolean;
  readonly error: string | null;
  readonly unconfigured: boolean;
  /** Cumulative across the session — the headline the demo is making. */
  readonly totalCostUsd: number;
  readonly totalRequests: number;
  readonly totalInputTokens: number;
}

const INITIAL: RubricState = {
  answers: null,
  provider: null,
  latencyMs: null,
  inputTokens: null,
  costUsd: null,
  degraded: false,
  pending: false,
  error: null,
  unconfigured: false,
  totalCostUsd: 0,
  totalRequests: 0,
  totalInputTokens: 0,
};

export function useLiveRubric(text: string) {
  const [state, setState] = useState<RubricState>(INITIAL);

  const inFlight = useRef<AbortController | null>(null);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxWaitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* Monotonic request id. A response whose id is not the latest is discarded:
     aborts are best-effort and an in-flight response can still land late. */
  const seq = useRef(0);
  const latest = useRef(0);
  const lastScored = useRef<string | null>(null);
  /* Timers must read the newest text when they fire, not the text that existed
     when they were scheduled — the ceiling timer in particular outlives many
     keystrokes and would otherwise score a stale draft. */
  const textRef = useRef(text);
  textRef.current = text;

  const clearTimers = () => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    if (maxWaitTimer.current) clearTimeout(maxWaitTimer.current);
    debounceTimer.current = null;
    maxWaitTimer.current = null;
  };

  const run = useCallback(async (value: string) => {
    clearTimers();

    // Re-scoring identical text would spend money to redraw the same bars.
    if (value === lastScored.current) return;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    const id = ++seq.current;
    latest.current = id;
    lastScored.current = value;

    setState((s) => ({ ...s, pending: true }));

    try {
      const response = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: value }),
        signal: controller.signal,
      });

      if (id !== latest.current) return; // superseded while in flight

      if (response.status === 499) return; // we aborted it ourselves

      const data = (await response.json()) as EvaluateResponse;
      if (id !== latest.current) return;

      if (!data.ok) {
        // Let the previous answers stay on screen rather than blanking the
        // whole rubric — a stale reading beats an empty page mid-demo.
        setState((s) => ({
          ...s,
          pending: false,
          error: data.error,
          unconfigured: data.unconfigured,
        }));
        return;
      }

      setState((s) => ({
        answers: data.answers,
        provider: data.provider,
        latencyMs: data.latencyMs,
        inputTokens: data.usage.input_tokens,
        costUsd: data.costUsd,
        degraded: data.degraded,
        pending: false,
        error: null,
        unconfigured: false,
        totalCostUsd: s.totalCostUsd + data.costUsd,
        totalRequests: s.totalRequests + 1,
        totalInputTokens: s.totalInputTokens + data.usage.input_tokens,
      }));
    } catch (error) {
      if (controller.signal.aborted || id !== latest.current) return;
      setState((s) => ({
        ...s,
        pending: false,
        error: error instanceof Error ? error.message : "Request failed.",
      }));
    }
  }, []);

  useEffect(() => {
    if (text.trim().length < 12) {
      clearTimers();
      inFlight.current?.abort();
      latest.current = ++seq.current;
      lastScored.current = null;
      setState((s) => ({ ...s, answers: null, pending: false, error: null }));
      return;
    }

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void run(textRef.current), DEBOUNCE_MS);

    // Start the ceiling only if one is not already running, so it measures time
    // since the first unscored edit rather than since the most recent one.
    if (!maxWaitTimer.current) {
      maxWaitTimer.current = setTimeout(() => void run(textRef.current), MAX_WAIT_MS);
    }

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    };
  }, [text, run]);

  useEffect(
    () => () => {
      clearTimers();
      inFlight.current?.abort();
    },
    [],
  );

  const reset = useCallback(() => {
    clearTimers();
    inFlight.current?.abort();
    latest.current = ++seq.current;
    lastScored.current = null;
    setState(INITIAL);
  }, []);

  /**
   * What the same traffic would have cost against a frontier chat model.
   * A lower bound: it charges the identical input tokens at frontier input
   * rates and nothing for the JSON the chat model would have to generate.
   */
  const gptClassCostUsd = state.totalInputTokens * GPT_CLASS_USD_PER_INPUT_TOKEN;

  return { state, reset, gptClassCostUsd };
}
