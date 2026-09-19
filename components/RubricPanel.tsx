"use client";

import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import { DIMENSIONS_BY_KIND } from "@/lib/rubric";
import type { RubricAnswers } from "@/lib/wire";
import { ChoiceCard, NoulCard, ScoreCard } from "./Charts";

interface Props {
  readonly answers: RubricAnswers | null;
  readonly pending: boolean;
}

/**
 * Pull one answer out of the response by key.
 *
 * The response is precisely typed per question, but this component walks the
 * dimensions generically, so the compile-time link is lost here and the runtime
 * `type` discriminator is what we actually trust.
 */
function answerFor<T extends { type: string }>(
  answers: RubricAnswers | null,
  key: string,
  type: T["type"],
): T | undefined {
  const value = answers?.[key as keyof RubricAnswers] as { type?: string } | undefined;
  return value?.type === type ? (value as T) : undefined;
}

const GROUPS = [
  {
    kind: "score" as const,
    title: "Score",
    note: "ordered rubric · value between levels",
    hue: "var(--series-score)",
    dimensions: DIMENSIONS_BY_KIND.score,
  },
  {
    kind: "choice" as const,
    title: "Choice",
    note: "named alternatives · probability per label",
    hue: "var(--series-choice)",
    dimensions: DIMENSIONS_BY_KIND.choice,
  },
  {
    kind: "noul" as const,
    title: "Noul",
    note: "yes/no · probability the statement is true",
    hue: "var(--series-noul)",
    dimensions: DIMENSIONS_BY_KIND.noul,
  },
];

export function RubricPanel({ answers, pending }: Props) {
  return (
    <div className="rubric">
      {GROUPS.map((group) => (
        <section className={`group group--${group.kind}`} key={group.kind} aria-busy={pending}>
          <div className="group-head">
            {/* The hue key doubles as the legend: colour means question type,
                and the type is spelled out beside it in text. */}
            <span className="group-key" style={{ background: group.hue }} aria-hidden />
            <h2>{group.title}</h2>
            <span className="group-note">{group.note}</span>
          </div>

          <div className="cards">
            {group.dimensions.map((meta) => {
              if (meta.kind === "score") {
                return (
                  <ScoreCard
                    key={meta.key}
                    meta={meta}
                    answer={answerFor<ScoreResponse>(answers, meta.key, "score")}
                  />
                );
              }
              if (meta.kind === "choice") {
                return (
                  <ChoiceCard
                    key={meta.key}
                    meta={meta}
                    answer={answerFor<ChoiceResponse>(answers, meta.key, "choice")}
                  />
                );
              }
              return (
                <NoulCard
                  key={meta.key}
                  meta={meta}
                  answer={answerFor<NoulResponse>(answers, meta.key, "noul")}
                />
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
