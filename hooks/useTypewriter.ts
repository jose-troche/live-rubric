"use client";

import { useEffect, useRef, useState } from "react";

/* Typing cadence. Characters arrive in small bursts rather than one at a time,
   which reads as typing rather than as a progress bar. */
const CHARS_PER_TICK = 4;
const TICK_MS = 22;

/* Pauses at natural boundaries. These are the whole point: the rubric scores on
   a typing pause, so the writing has to actually pause somewhere. */
const PAUSE_SENTENCE_MS = 520;
const PAUSE_PARAGRAPH_MS = 900;

interface Options {
  readonly text: string;
  readonly enabled: boolean;
  /** Bump to replay the current text from the top. */
  readonly runId: number;
}

/**
 * Types `text` out once, then stops.
 *
 * Deliberately pauses at sentence and paragraph ends so there is something for
 * the debounced scorer to fire on; without those the text would stream in with
 * no quiet period and the bars would only move on the max-wait ceiling.
 *
 * It does NOT move on to another document by itself. The run ends on the last
 * character and `done` goes true, which leaves the final scores on screen long
 * enough to actually read — choosing what runs next is the reader's call, not a
 * carousel's.
 */
export function useTypewriter({ text, enabled, runId }: Options) {
  const [visible, setVisible] = useState("");
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cursor = 0;
    let cancelled = false;

    const schedule = (delay: number) => {
      timer.current = setTimeout(step, delay);
    };

    const step = () => {
      if (cancelled) return;

      if (cursor >= text.length) {
        setDone(true); // end of the run — nothing reschedules
        return;
      }

      cursor = Math.min(text.length, cursor + CHARS_PER_TICK);
      setVisible(text.slice(0, cursor));

      // Look at the characters we just landed on to decide whether to breathe.
      const justTyped = text.slice(Math.max(0, cursor - CHARS_PER_TICK), cursor);
      if (/\n\s*\n/.test(justTyped)) return schedule(PAUSE_PARAGRAPH_MS);
      if (/[.!?]["')\]]?\s/.test(justTyped)) return schedule(PAUSE_SENTENCE_MS);
      if (/\n/.test(justTyped)) return schedule(PAUSE_SENTENCE_MS);
      schedule(TICK_MS);
    };

    setVisible("");
    setDone(false);
    schedule(420); // a beat before the first character

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled, text, runId]);

  return { visible, done };
}
