import { NextResponse } from "next/server";
import { APIUserAbortError } from "@typesafe-ai/sdk";
import { evaluate, NoProviderError, providerStatus } from "@/lib/providers";
import { priceOf, type EvaluateResponse } from "@/lib/wire";

/* Node runtime: the SDK is a Node client, and the API key must never reach the
   browser (the SDK refuses browser use unless you opt in, which we do not). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Longer than any single document this editor is meant for. */
const MAX_CHARS = 20_000;

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Body must be JSON.", attempts: [], unconfigured: false },
      { status: 400 },
    );
  }

  const text = (body as { text?: unknown })?.text;
  if (typeof text !== "string") {
    return NextResponse.json(
      { ok: false, error: "Expected a `text` string.", attempts: [], unconfigured: false },
      { status: 400 },
    );
  }
  if (text.length > MAX_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `Text is ${text.length} characters; the limit is ${MAX_CHARS}.`,
        attempts: [],
        unconfigured: false,
      },
      { status: 413 },
    );
  }

  /* Jev needs something to read. Short-circuiting here keeps the editor from
     spending a request on the empty state every time someone clears it. */
  if (text.trim().length < 12) {
    return NextResponse.json(
      {
        ok: false,
        error: "Write at least a few words to score.",
        attempts: [],
        unconfigured: !providerStatus().configured,
      },
      { status: 422 },
    );
  }

  try {
    const result = await evaluate(text, request.signal);
    const payload: EvaluateResponse = {
      ok: true,
      answers: result.answers,
      provider: {
        id: result.provider.id,
        label: result.provider.label,
        model: result.provider.model,
        note: result.provider.note,
      },
      usage: result.usage,
      latencyMs: result.latencyMs,
      costUsd: priceOf(result.usage),
      attempts: result.attempts,
    };
    return NextResponse.json(payload, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    /* The client aborted because the user kept typing. There is nobody left to
       answer; returning 499 keeps it out of the error log. */
    if (error instanceof APIUserAbortError || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }

    if (error instanceof NoProviderError) {
      const unconfigured = error.attempts.length === 0;
      return NextResponse.json(
        { ok: false, error: error.message, attempts: error.attempts, unconfigured },
        { status: unconfigured ? 503 : 502 },
      );
    }

    console.error("[evaluate] unexpected failure", error);
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error.",
        attempts: [],
        unconfigured: false,
      },
      { status: 500 },
    );
  }
}

export async function GET(): Promise<Response> {
  return NextResponse.json(providerStatus(), {
    headers: { "cache-control": "no-store" },
  });
}
