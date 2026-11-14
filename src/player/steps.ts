// Stepping through a play order in the interactive HTML player (pure, so it can be tested without a browser).
// "Next" plays one step and pauses just before the following step starts (its caption and highlight still showing,
// the camera already moved on); "Previous" jumps back to the pause before the step that just played.
import type { FlowDocument } from '../model/types';
import { playSchedule } from '../engine/render';

/** A little before a step starts, so the pause shows the step that just played, not the next one fading in. */
const EPS = 0.02;

/** Step start times (seconds) on this page, in order. Empty when nothing plays in order. */
export function stepStarts(doc: FlowDocument): number[] {
  const L = doc.animation.duration;
  return playSchedule(doc).steps.map((s) => s.start * L);
}

/** Where playback pauses after step k has played (k = -1: the very start). */
export function stopAfter(doc: FlowDocument, k: number): number {
  const starts = stepStarts(doc), L = doc.animation.duration;
  if (k < 0) return 0;
  return k + 1 < starts.length ? Math.max(0, starts[k + 1] - EPS) : Math.max(0, L - EPS);
}

/** The step playing (or last played) at time t: -1 before the first one starts. */
export function stepAt(doc: FlowDocument, t: number): number {
  const starts = stepStarts(doc);
  let k = -1;
  for (let i = 0; i < starts.length; i++) if (starts[i] <= t + 1e-6) k = i;
  return k;
}

/**
 * Next: where to start and where to pause. Mid-step, the current step finishes; at a pause, the following step
 * plays; after the last one, it starts again from the beginning and plays the first step.
 */
export function nextSegment(doc: FlowDocument, t: number): { from: number; to: number } | null {
  const n = stepStarts(doc).length;
  if (!n) return null;
  const k = stepAt(doc, t);
  if (k >= 0 && t < stopAfter(doc, k) - 0.05) return { from: t, to: stopAfter(doc, k) };
  if (k + 1 < n) return { from: t, to: stopAfter(doc, k + 1) };
  return { from: 0, to: stopAfter(doc, 0) };
}

/** Previous: back to the pause before the step at time t (mid-step or just after it), or to the very start. */
export function prevStop(doc: FlowDocument, t: number): number {
  return stopAfter(doc, stepAt(doc, t) - 1);
}
