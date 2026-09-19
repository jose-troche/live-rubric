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
/** Dwell on the finished document before moving to the next sample. */
const PAUSE_COMPLETE_MS = 4_200;

interface Options {
  readonly texts: readonly string[];
  readonly enabled: boolean;
  /** Called when a document finishes typing and the next one is about to start. */
  readonly onAdvance?: (nextIndex: number) => void;
  readonly startIndex?: number;
}

/**
 * Types the given documents out one after another, looping.
 *
 * Deliberately pauses at sentence and paragraph ends so there is something for
 * the debounced scorer to fire on; without those the text would stream in with
 * no quiet period and the bars would only move on the max-wait ceiling.
 */
export function useTypewriter({ texts, enabled, onAdvance, startIndex = 0 }: Options) {
  const [visible, setVisible] = useState("");
  const [index, setIndex] = useState(startIndex);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advanceRef = useRef(onAdvance);
  advanceRef.current = onAdvance;

  useEffect(() => {
    if (!enabled) return;

    const full = texts[index] ?? "";
    let cursor = 0;
    let cancelled = false;

    const schedule = (delay: number) => {
      timer.current = setTimeout(step, delay);
    };

    const step = () => {
      if (cancelled) return;

      if (cursor >= full.length) {
        schedule2();
        return;
      }

      cursor = Math.min(full.length, cursor + CHARS_PER_TICK);
      setVisible(full.slice(0, cursor));

      // Look at the character we just landed on to decide whether to breathe.
      const justTyped = full.slice(Math.max(0, cursor - CHARS_PER_TICK), cursor);
      if (/\n\s*\n/.test(justTyped)) return schedule(PAUSE_PARAGRAPH_MS);
      if (/[.!?]["')\]]?\s/.test(justTyped)) return schedule(PAUSE_SENTENCE_MS);
      if (/\n/.test(justTyped)) return schedule(PAUSE_SENTENCE_MS);
      schedule(TICK_MS);
    };

    // Finished this document: hold it on screen, then move to the next.
    const schedule2 = () => {
      timer.current = setTimeout(() => {
        if (cancelled) return;
        const next = (index + 1) % texts.length;
        advanceRef.current?.(next);
        setIndex(next);
      }, PAUSE_COMPLETE_MS);
    };

    setVisible("");
    schedule(420); // a beat before the first character

    return () => {
      cancelled = true;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
  }, [enabled, index, texts]);

  /** Jump straight to a document, used when someone clicks a sample tab. */
  const goTo = (next: number) => {
    if (timer.current) clearTimeout(timer.current);
    setIndex(next);
    setVisible("");
  };

  return { visible, index, goTo, typing: enabled };
}
