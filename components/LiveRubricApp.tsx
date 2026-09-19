"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SAMPLES } from "@/lib/samples";
import { useLiveRubric } from "@/hooks/useLiveRubric";
import { useTypewriter } from "@/hooks/useTypewriter";
import { RubricPanel } from "./RubricPanel";
import { StatusBar } from "./StatusBar";

type Mode = "demo" | "manual";

export function LiveRubricApp() {
  const [mode, setMode] = useState<Mode>("demo");
  const [manualText, setManualText] = useState("");
  const [sampleIndex, setSampleIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const sampleTexts = useMemo(() => SAMPLES.map((s) => s.text), []);

  const { visible, index, goTo } = useTypewriter({
    texts: sampleTexts,
    enabled: mode === "demo",
    startIndex: sampleIndex,
    onAdvance: setSampleIndex,
  });

  const text = mode === "demo" ? visible : manualText;
  const { state, reset, gptClassCostUsd } = useLiveRubric(text);

  /* Switching to manual hands over whatever is on screen, so the rubric does
     not blank out and you can start editing the sample you were watching. */
  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      if (next === "manual") setManualText(visible);
      setMode(next);
    },
    [mode, visible],
  );

  useEffect(() => {
    if (mode === "manual") textareaRef.current?.focus();
  }, [mode]);

  const pickSample = (i: number) => {
    setSampleIndex(i);
    if (mode === "demo") {
      goTo(i);
    } else {
      setManualText(SAMPLES[i].text);
    }
  };

  const active = SAMPLES[mode === "demo" ? index : sampleIndex];
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="shell">
      <header className="masthead">
        <h1>Live Rubric</h1>
        <span className="tagline">
          15 dimensions, re-scored on every typing pause — one Jev request each time.
        </span>
      </header>

      <div className="workspace">
        <section className="pane pane--editor" aria-label="Editor">
          <div className="toolbar">
            <div className="mode-switch" role="group" aria-label="Editor mode">
              <button
                type="button"
                aria-pressed={mode === "demo"}
                onClick={() => switchMode("demo")}
              >
                Demo
              </button>
              <button
                type="button"
                aria-pressed={mode === "manual"}
                onClick={() => switchMode("manual")}
              >
                Write your own
              </button>
            </div>
            <span className="card-sub">
              {mode === "demo"
                ? `Typing “${active.name}” — ${active.blurb}`
                : "Type anything. The rubric follows."}
            </span>
          </div>

          <div className="samples" role="group" aria-label="Sample documents">
            {SAMPLES.map((sample, i) => (
              <button
                key={sample.id}
                type="button"
                className="sample-chip"
                aria-pressed={i === (mode === "demo" ? index : sampleIndex)}
                onClick={() => pickSample(i)}
                title={sample.blurb}
              >
                {sample.name}
              </button>
            ))}
          </div>

          <div className="editor-surface">
            {mode === "demo" ? (
              /* Read-only in demo mode: a textarea whose value is being
                 rewritten 45 times a second would fight anyone who clicked
                 into it. The caret is drawn rather than real. */
              <div className="readout" aria-live="off">
                {visible}
                <span className="caret" aria-hidden />
              </div>
            ) : (
              <textarea
                ref={textareaRef}
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                placeholder="Paste a pull request, a postmortem, a job posting — or just start writing."
                spellCheck
                aria-label="Document text"
              />
            )}
          </div>

          <div className="editor-foot">
            <span>{words} words</span>
            <span>{text.length} characters</span>
            {state.pending ? <span>scoring…</span> : null}
            {mode === "manual" && state.totalRequests > 0 ? (
              <button
                type="button"
                className="sample-chip"
                onClick={reset}
                style={{ marginLeft: "auto" }}
              >
                Reset counters
              </button>
            ) : null}
          </div>
        </section>

        <section className="pane pane--rubric" aria-label="Rubric">
          {state.unconfigured ? (
            <div className="notice">
              <strong>No Jev provider configured.</strong> Set{" "}
              <code>AI_GATEWAY_API_KEY</code> for Jev on Vercel AI Gateway, or{" "}
              <code>CODIV_API_KEY</code> for the OpenJev fallback, then reload. On a
              Vercel deployment the gateway authenticates with the platform OIDC
              token and needs no key at all.
            </div>
          ) : null}

          {state.error && !state.unconfigured ? (
            <div className="notice">
              <strong>Last evaluation failed.</strong> {state.error}
              {state.answers ? " Showing the previous reading." : ""}
            </div>
          ) : null}

          {state.degraded ? (
            <div className="notice">
              <strong>Running on the fallback.</strong> The primary provider did not
              answer, so these scores come from {state.provider?.label}. Numbers from a
              different model are not directly comparable with the primary's.
            </div>
          ) : null}

          <RubricPanel answers={state.answers} pending={state.pending} />
        </section>
      </div>

      <StatusBar state={state} gptClassCostUsd={gptClassCostUsd} />
    </div>
  );
}
