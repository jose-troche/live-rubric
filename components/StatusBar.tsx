"use client";

import type { RubricState } from "@/hooks/useLiveRubric";

/** Sub-cent money needs more places than a currency formatter will give. */
function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;
  return `$${value.toFixed(4)}`;
}

function Stat({
  label,
  children,
  hero = false,
  title,
}: {
  label: string;
  children: React.ReactNode;
  hero?: boolean;
  title?: string;
}) {
  return (
    <div className="stat" title={title}>
      <span className="stat-label">{label}</span>
      <span className={hero ? "stat-value hero-cost" : "stat-value"}>{children}</span>
    </div>
  );
}

export function StatusBar({
  state,
  gptClassCostUsd,
}: {
  state: RubricState;
  gptClassCostUsd: number;
}) {
  const dotClass = state.pending
    ? "dot dot--pending"
    : state.error
      ? "dot dot--down"
      : state.provider
        ? "dot dot--live"
        : "dot";

  const providerText = state.provider
    ? state.provider.label
    : state.pending
      ? "Connecting…"
      : "No provider yet";

  const multiple =
    state.totalCostUsd > 0 ? Math.round(gptClassCostUsd / state.totalCostUsd) : 0;

  return (
    <div className="statbar">
      {/* The hero figure: one per view, and this is the claim the demo makes. */}
      <Stat
        label="Spent this session"
        hero
        title="Total billed across every evaluation since the page loaded."
      >
        {formatUsd(state.totalCostUsd)}
      </Stat>

      <Stat label="Evaluations" title="One request each; 15 questions answered in parallel inside it.">
        {state.totalRequests}
        <span className="unit"> × 15 q</span>
      </Stat>

      <Stat label="Last round trip" title="Server-measured time to the model.">
        {state.latencyMs ?? "–"}
        <span className="unit"> ms</span>
      </Stat>

      <Stat label="Last request" title="Input tokens billed; Jev charges nothing for output.">
        {state.inputTokens ?? "–"}
        <span className="unit"> tok</span>
      </Stat>

      <Stat
        label="Same traffic, GPT-class"
        title="The identical input tokens at $2.50/1M — and that ignores the JSON a chat model would have to generate, and that it cannot answer 15 questions in one pass."
      >
        {formatUsd(gptClassCostUsd)}
        {multiple > 1 ? <span className="unit"> · {multiple}×</span> : null}
      </Stat>

      <span className="spacer" style={{ flex: 1 }} />

      <span className="pill" title={state.provider?.model ?? "No model selected yet"}>
        <span className={dotClass} />
        {providerText}
      </span>
    </div>
  );
}
