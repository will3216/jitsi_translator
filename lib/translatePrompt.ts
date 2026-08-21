import type { Language } from './types'

export function buildSystemPrompt(
  src: Language,
  target: Language,
  context?: string[],
): string {
  const base = `You are a live conversation translator for a video call.
Translate the user's message from ${src.translateAs} into ${target.translateAs}.

Rules:
- Output ONLY the translation. No quotes, no notes, no alternatives.
- Leave untranslated: proper nouns, product and repository names, code
  identifiers, file paths, and established technical terms
  (e.g. "merge conflict", "pull request", "rebase").
- Match the speaker's register and level of formality.
- The input is live speech-to-text. It may lack punctuation and contain
  recognition errors. Infer intent and produce natural, fluent output.
- If the input is too garbled to translate, return it unchanged.`

  if (!context || context.length === 0) return base

  return `${base}

Recent conversation, for context only — do not translate:
${context.join('\n')}`
}
