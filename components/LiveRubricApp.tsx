"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
  /* Bumped on every sample click so that re-picking the sample already on
     screen replays it instead of doing nothing. */
  const [runId, setRunId] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /* The opening sample is random, so the demo does not always lead with the
     same document. It has to be picked after mount rather than during render:
     a random value in the initial state would differ between the server and
     client renders and trip hydration. */
  useEffect(() => {
    setSampleIndex(Math.floor(Math.random() * SAMPLES.length));
  }, []);

  const active = SAMPLES[sampleIndex];

  const { visible, done } = useTypewriter({
    text: active.text,
    enabled: mode === "demo",
    runId,
  });

  const text = mode === "demo" ? visible : manualText;
  const { state, reset, gptClassCostUsd } = useLiveRubric(text);

  /* "Write your own" starts from a blank page. Handing over the sample that
     happened to be on screen meant the first thing you did was select-all and
     delete it. */
  const switchMode = useCallback(
    (next: Mode) => {
      if (next === mode) return;
      if (next === "manual") setManualText("");
      setMode(next);
    },
    [mode],
  );

  useEffect(() => {
    if (mode === "manual") textareaRef.current?.focus();
  }, [mode]);

  /* Clicking a sample is the only thing that starts a run. In manual mode it
     loads the text to edit instead. */
  const pickSample = (i: number) => {
    setSampleIndex(i);
    setRunId((n) => n + 1);
    if (mode === "manual") setManualText(SAMPLES[i].text);
  };

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  const status =
    mode === "manual"
      ? "Type anything. The rubric follows."
      : done
        ? `Finished “${active.name}” — these are the final scores.`
        : `Typing “${active.name}” — ${active.blurb}`;

  const instructions =
    mode === "manual"
      ? "Pick a sample below to load it into the editor, or just start writing."
      : done
        ? "Paused so you can read the scores. Pick any sample below to run it again."
        : "The demo types one sample, then pauses on the final scores. Pick any sample below to switch to it.";

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
            <span className="card-sub">{status}</span>
          </div>

          <p className="demo-hint">{instructions}</p>

          <div className="samples" role="group" aria-label="Sample documents">
            {SAMPLES.map((sample, i) => (
              <button
                key={sample.id}
                type="button"
                className="sample-chip"
                aria-pressed={i === sampleIndex}
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
                 into it. The caret is drawn rather than real, and it goes away
                 when the run ends — a blinking caret on a stopped demo reads
                 as "still going". */
              <div className="readout" aria-live="off">
                {visible}
                {done ? null : <span className="caret" aria-hidden />}
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
            {mode === "demo" && done ? <span>run complete</span> : null}
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
              <strong>No Jev provider configured.</strong> Set <code>CODIV_API_KEY</code>{" "}
              to a key from <code>codiv.ai</code> and reload. The free tier needs no
              card.
            </div>
          ) : null}

          {state.error && !state.unconfigured ? (
            <div className="notice">
              <strong>Last evaluation failed.</strong> {state.error}
              {state.answers ? " Showing the previous reading." : ""}
            </div>
          ) : null}

          <RubricPanel answers={state.answers} pending={state.pending} />
        </section>
      </div>

      <StatusBar state={state} gptClassCostUsd={gptClassCostUsd} />
    </div>
  );
}
