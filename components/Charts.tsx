"use client";

import type { CSSProperties } from "react";
import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { OPTION_LABELS, type DimensionMeta } from "@/lib/rubric";

/* One hue per question type, set as a local custom property so the card body
   is written against a role rather than a colour. */
const HUE: Record<DimensionMeta["kind"], string> = {
  score: "var(--series-score)",
  choice: "var(--series-choice)",
  noul: "var(--series-noul)",
};

function hueStyle(kind: DimensionMeta["kind"]): CSSProperties {
  return { ["--hue" as string]: HUE[kind] };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const label = (key: string) => OPTION_LABELS[key] ?? key;

/* ------------------------------------------------------------------ score - */

/**
 * An ordered rubric as a meter: fill is the expected score, hairlines mark the
 * integer levels. Jev returns a value that can land between levels, which is
 * why this is a continuous bar and not a set of filled pips.
 */
export function ScoreCard({
  meta,
  answer,
}: {
  meta: DimensionMeta;
  answer: ScoreResponse | undefined;
}) {
  const max = meta.max ?? 4;
  const value = answer?.score ?? 0;
  const ratio = Math.max(0, Math.min(1, value / max));

  /* The legend Jev sends back describes each level. Show the one the score has
     actually reached, so the number has words attached to it. */
  const legendText = answer
    ? String(answer.legend[Math.round(value) as keyof typeof answer.legend] ?? "")
    : "";

  return (
    <div style={hueStyle("score")}>
      <div className="card-head">
        <span className="card-label" title={meta.hint}>
          {meta.label}
        </span>
        <span className="card-value">
          {answer ? value.toFixed(1) : "–"}
          <span className="card-sub"> / {max}</span>
        </span>
      </div>
      <div
        className="meter"
        role="meter"
        aria-valuenow={answer ? Number(value.toFixed(2)) : undefined}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={`${meta.label}: ${answer ? value.toFixed(1) : "not scored"} out of ${max}`}
        title={legendText || meta.hint}
      >
        <div className="meter-fill" style={{ width: pct(ratio) }} />
        {Array.from({ length: max - 1 }, (_, i) => (
          <div key={i} className="meter-tick" style={{ left: `${((i + 1) / max) * 100}%` }} />
        ))}
      </div>
      {legendText ? <div className="legend-line">{legendText}</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- choice - */

const TOP_N = 3;

/**
 * A choice question's probability distribution. Single hue, magnitude by bar
 * width, winner at full strength. Only the top few are drawn — the rest are in
 * the tooltip — because a five-row bar chart per card would not fit the page.
 */
export function ChoiceCard({
  meta,
  answer,
}: {
  meta: DimensionMeta;
  answer: ChoiceResponse | undefined;
}) {
  const probabilities = answer?.probabilities ?? {};

  /* Rank by probability, but tie-break on the declared option order so bars do
     not swap places on an insignificant wobble between two equal values. */
  const order = meta.options ?? Object.keys(probabilities);
  const ranked = [...order]
    .map((key) => ({ key, p: Number(probabilities[key] ?? 0) }))
    .sort((a, b) => b.p - a.p || order.indexOf(a.key) - order.indexOf(b.key));

  const shown = ranked.slice(0, TOP_N);
  const rest = ranked.slice(TOP_N);
  const restTitle = rest.length
    ? `Also considered — ${rest.map((r) => `${label(r.key)} ${pct(r.p)}`).join(", ")}`
    : meta.hint;

  return (
    <div style={hueStyle("choice")}>
      <div className="card-head">
        <span className="card-label" title={meta.hint}>
          {meta.label}
        </span>
        <span className="card-value">
          {answer ? label(answer.choice) : "–"}
          {answer ? <span className="card-sub"> · {pct(answer.confidence)} conf.</span> : null}
        </span>
      </div>
      <div title={restTitle}>
        {shown.map(({ key, p }) => (
          <div className="opt-row" key={key} data-winner={answer?.choice === key}>
            <span className="opt-name" title={label(key)}>
              {label(key)}
            </span>
            <span className="opt-track">
              <span className="opt-fill" style={{ width: pct(p) }} />
            </span>
            <span className="opt-pct">{answer ? pct(p) : "–"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- noul - */

/**
 * A yes/no proposition, plotted as the raw probability of "true" with the even
 * line marked. Some propositions are bad news when true (jargon), so those are
 * flagged in text rather than recoloured — a status colour here would collide
 * with the series palette and imply a severity the model never reported.
 */
export function NoulCard({
  meta,
  answer,
}: {
  meta: DimensionMeta;
  answer: NoulResponse | undefined;
}) {
  const p = answer?.noul ?? 0;

  return (
    <div style={hueStyle("noul")}>
      <div className="card-head">
        <span className="card-label" title={meta.hint}>
          {meta.label}
          {meta.inverted ? <span className="inverted-flag"> · lower is better</span> : null}
        </span>
        <span className="card-value">{answer ? pct(p) : "–"}</span>
      </div>
      <div
        className="noul-track"
        role="meter"
        aria-valuenow={answer ? Math.round(p * 100) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${meta.label}: ${answer ? pct(p) : "not scored"} probability`}
        title={`${meta.hint}${meta.inverted ? " A lower probability is better here." : ""}`}
      >
        <div className="noul-fill" style={{ width: pct(p) }} />
        <div className="noul-mid" />
      </div>
    </div>
  );
}
