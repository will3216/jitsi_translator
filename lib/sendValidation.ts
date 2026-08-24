/**
 * Shared input validation for anything that sends an utterance as if a human
 * typed it: the `TypeToSend` form and `window.polyglot.send`. Both must
 * reject the same input the same way — a console send that skipped this
 * check would sail past the DOM `maxLength` attribute (which only protects
 * a human typist) and get a 400 back from `/api/translate`, surfacing as a
 * failed caption that reads as a translation bug rather than as bad input.
 */

export const MAX_SEND_LENGTH = 500

export interface SendValidationResult {
  ok: boolean
  /** The trimmed text, present only when `ok` is true. */
  text?: string
}

/**
 * Trims `text`, then rejects it if empty (or whitespace-only) or over
 * `MAX_SEND_LENGTH` characters after trimming.
 */
export function validateSendText(text: string): SendValidationResult {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: false }
  if (trimmed.length > MAX_SEND_LENGTH) return { ok: false }
  return { ok: true, text: trimmed }
}
