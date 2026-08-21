# Live Translated Captions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a browser room where each participant independently sets the language they speak and the language they read, so two people without a shared language can hold a real conversation over live translated captions.

**Architecture:** Next.js App Router app. Speech is transcribed in-browser by the Web Speech API; only *source* text is broadcast over Ably. Each receiving client compares the utterance's source language to its own target and requests its own translation from `/api/translate`, so no participant's language setting affects any other participant's experience. All state is client-side; there is no database.

**Tech Stack:** Next.js (App Router) + TypeScript, Vitest, Ably, `@anthropic-ai/sdk` (Claude Haiku 4.5), Tailwind + Framer Motion (Phase 2 only), Nix flake for the dev shell.

**Spec:** `docs/superpowers/specs/2026-08-21-live-translated-captions-design.md`

## Global Constraints

- **Languages: English and Spanish only.** `LangCode` is exactly `'en' | 'es'`. Do not add rows.
- **Model id is exactly `claude-haiku-4-5`.** Never append a date suffix — a suffixed id is rejected. `temperature: 0` is valid on this model *because it predates 4.6*; sampling parameters were removed on 4.6+ models, so changing the model id also means removing `temperature`.
- **No `NEXT_PUBLIC_` environment variables.** `ANTHROPIC_API_KEY` may only be read inside `app/api/translate/route.ts`. `ABLY_API_KEY` may only be read inside `app/api/realtime-token/route.ts`.
- **`.env.local` must be in `.gitignore` before any key is written to disk.** Already committed; do not remove.
- **Never translate an interim result.** Translation is requested only when `isFinal === true`.
- **Never drop an utterance.** Every failure path renders the source text; nothing disappears.
- **`Utterance` (the wire type) must never gain a translation field.** If it does, receiver-side isolation has been lost.
- **Phase 1 has no CSS at all.** Not minimal CSS — none. Do not add a `className` anywhere before Task 10.
- **Chrome desktop is the only supported browser.** Do not add polyfills or fallbacks for others; render an explicit unsupported screen instead (Task 17).
- Steps show the code that changes, not the import lines above it. When a step introduces a component, hook, or helper, add its import to the file yourself — `npx tsc --noEmit` will name anything you miss.
- End every commit message body with:
  ```
  Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
  ```

---

# PHASE 1 — End-to-end round trip

**Phase 1 definition of done:** two tabs open, tab A set to English, tab B set to Spanish. Speak into tab A. Plain, unstyled text appears in tab B in Spanish.

---

### Task 1: Project scaffold, test runner, types, and the language table

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx` (via scaffold)
- Create: `vitest.config.ts`
- Create: `lib/types.ts`
- Create: `lib/languages.ts`
- Create: `NOTES.md`
- Test: `lib/languages.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `LangCode`, `Script`, `Language`, `Participant`, `Utterance`, `RenderedUtterance` from `lib/types.ts`; `LANGUAGES: Language[]` and `languageByCode(code: string): Language | undefined` from `lib/languages.ts`.

- [ ] **Step 1: Scaffold the Next.js app**

Run in the repository root (it already contains `.git`, `README.md`, `PROBLEM.md`, `docs/`):

```bash
npx create-next-app@latest . --typescript --app --no-tailwind --eslint --src-dir=false --import-alias="@/*" --no-turbopack --use-npm
```

Tailwind is deliberately declined here — it arrives in Task 10. When prompted about existing files, keep them.

- [ ] **Step 2: Install runtime and test dependencies**

```bash
npm install @anthropic-ai/sdk ably
npm install --save-dev vitest
```

- [ ] **Step 3: Add the Vitest config**

Create `vitest.config.ts`. The environment is `node` — everything under test in this plan is pure logic or a route handler; nothing needs a DOM.

```typescript
import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'app/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
})
```

- [ ] **Step 4: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the failing test for the language table**

Create `lib/languages.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { LANGUAGES, languageByCode } from './languages'

describe('LANGUAGES', () => {
  it('contains exactly English and Spanish', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual(['en', 'es'])
  })

  it('gives every language a non-empty BCP-47 STT locale', () => {
    for (const lang of LANGUAGES) {
      expect(lang.sttLocale).toMatch(/^[a-z]{2}-[A-Z]{2}$/)
    }
  })

  it('gives every language a translateAs phrase for the prompt', () => {
    for (const lang of LANGUAGES) {
      expect(lang.translateAs.length).toBeGreaterThan(0)
    }
  })

  it('pins Spanish to neutral Latin American Spanish', () => {
    const es = languageByCode('es')
    expect(es?.translateAs).toContain('Latin American')
  })
})

describe('languageByCode', () => {
  it('finds a known language', () => {
    expect(languageByCode('en')?.label).toBe('English')
  })

  it('returns undefined for an unknown code', () => {
    expect(languageByCode('de')).toBeUndefined()
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- lib/languages.test.ts`
Expected: FAIL — cannot resolve `./languages`.

- [ ] **Step 7: Write `lib/types.ts`**

```typescript
export type LangCode = 'en' | 'es'
export type Script = 'latin'

export interface Language {
  code: LangCode
  sttLocale: string      // BCP-47, for SpeechRecognition.lang
  label: string          // English name, for the picker
  nativeLabel: string    // native name
  translateAs: string    // phrase injected into the model prompt
  script: Script         // drives the typography class
}

export interface Participant {
  id: string
  name: string
  srcLang: LangCode
}

/** Broadcast over the wire. Contains no translation — each client makes its own. */
export interface Utterance {
  id: string             // stable across interim revisions
  speakerId: string
  speakerName: string
  srcLang: LangCode
  text: string
  isFinal: boolean
  ts: number             // client epoch ms at first emit
}

/** Local only. Never published. */
export interface RenderedUtterance extends Utterance {
  translation?: string
  translationState: 'none' | 'pending' | 'done' | 'failed'
}
```

- [ ] **Step 8: Write `lib/languages.ts`**

```typescript
import type { Language } from './types'

export const LANGUAGES: Language[] = [
  {
    code: 'en',
    sttLocale: 'en-US',
    label: 'English',
    nativeLabel: 'English',
    translateAs: 'English',
    script: 'latin',
  },
  {
    code: 'es',
    sttLocale: 'es-MX',
    label: 'Spanish',
    nativeLabel: 'Español',
    translateAs:
      'neutral Latin American Spanish (no vosotros, no peninsular vocabulary)',
    script: 'latin',
  },
]

export function languageByCode(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code)
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `npm test -- lib/languages.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 10: Create `NOTES.md` with the manual verification checklist**

This file exists so questions get parked instead of solved mid-task. Seed it with the `useSpeechRecognition` checklist, which Task 6 depends on:

```markdown
# NOTES

Park open questions here rather than solving them mid-task.

## Manual verification — useSpeechRecognition (Task 6)

Chrome desktop only. Run each and record the result.

- [ ] Deny the microphone permission. Expect: `error` set, no restart loop,
      no repeated permission prompts.
- [ ] Grant the mic, then sit silent for two minutes. Expect: recognition keeps
      re-arming, backoff grows to at most 4s, no tight loop in the console.
- [ ] Kill the network mid-session, then restore it. Expect: recovery without
      a page reload.
- [ ] Change the spoken language mid-session. Expect: recognizer stops and
      restarts in the new locale; no `InvalidStateError` in the console.

## Open questions
```

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat: scaffold app with types and the language table

Two languages only, English and Spanish. Vitest runs in a node
environment because everything under test is pure logic or a route
handler.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Room reducer — utterance upsert and presence

**Files:**
- Create: `lib/roomReducer.ts`
- Test: `lib/roomReducer.test.ts`

**Interfaces:**
- Consumes: `LangCode`, `Utterance`, `RenderedUtterance`, `Participant` from `lib/types.ts`.
- Produces: `RoomState`, `RoomAction`, `initialRoomState`, and `roomReducer(state: RoomState, action: RoomAction): RoomState`.

This task covers insert, interim revision, ordering, stale-interim rejection, and presence. Task 3 adds the translation state machine to the same reducer.

- [ ] **Step 1: Write the failing tests**

Create `lib/roomReducer.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { roomReducer, initialRoomState, type RoomState } from './roomReducer'
import type { Utterance } from './types'

function utterance(over: Partial<Utterance> = {}): Utterance {
  return {
    id: 'u1',
    speakerId: 'p1',
    speakerName: 'Ana',
    srcLang: 'es',
    text: 'hola',
    isFinal: false,
    ts: 1000,
    ...over,
  }
}

function receive(state: RoomState, u: Utterance, myTarget: 'en' | 'es' = 'en') {
  return roomReducer(state, { type: 'utterance/received', utterance: u, myTarget })
}

describe('roomReducer — utterance upsert', () => {
  it('inserts a new interim utterance', () => {
    const state = receive(initialRoomState, utterance())
    expect(state.utterances).toHaveLength(1)
    expect(state.utterances[0].text).toBe('hola')
  })

  it('replaces text on an interim revision instead of appending', () => {
    let state = receive(initialRoomState, utterance({ text: 'hola' }))
    state = receive(state, utterance({ text: 'hola que tal' }))
    expect(state.utterances).toHaveLength(1)
    expect(state.utterances[0].text).toBe('hola que tal')
  })

  it('keeps the first-emit timestamp across revisions', () => {
    let state = receive(initialRoomState, utterance({ ts: 1000 }))
    state = receive(state, utterance({ ts: 9999, text: 'hola que tal' }))
    expect(state.utterances[0].ts).toBe(1000)
  })

  it('keeps utterances ordered by first-emit timestamp', () => {
    let state = receive(initialRoomState, utterance({ id: 'b', ts: 2000 }))
    state = receive(state, utterance({ id: 'a', ts: 1000 }))
    expect(state.utterances.map((u) => u.id)).toEqual(['a', 'b'])
  })

  it('promotes an utterance to final', () => {
    let state = receive(initialRoomState, utterance())
    state = receive(state, utterance({ text: 'hola que tal', isFinal: true }))
    expect(state.utterances[0].isFinal).toBe(true)
    expect(state.utterances[0].text).toBe('hola que tal')
  })

  it('ignores an interim revision that arrives after the final', () => {
    let state = receive(initialRoomState, utterance({ text: 'final text', isFinal: true }))
    state = receive(state, utterance({ text: 'stale interim', isFinal: false }))
    expect(state.utterances[0].text).toBe('final text')
    expect(state.utterances[0].isFinal).toBe(true)
  })
})

describe('roomReducer — presence', () => {
  it('replaces the participant list', () => {
    const state = roomReducer(initialRoomState, {
      type: 'participants/synced',
      participants: [{ id: 'p1', name: 'Ana', srcLang: 'es' }],
    })
    expect(state.participants).toHaveLength(1)
    expect(state.participants[0].name).toBe('Ana')
  })

  it('does not disturb utterances when presence changes', () => {
    let state = receive(initialRoomState, utterance())
    state = roomReducer(state, { type: 'participants/synced', participants: [] })
    expect(state.utterances).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/roomReducer.test.ts`
Expected: FAIL — cannot resolve `./roomReducer`.

- [ ] **Step 3: Write the minimal reducer**

Create `lib/roomReducer.ts`. `translationState` is set to `'none'` for now; Task 3 replaces `stateForUtterance` with the real decision.

```typescript
import type { LangCode, Participant, RenderedUtterance, Utterance } from './types'

export interface RoomState {
  utterances: RenderedUtterance[]
  participants: Participant[]
}

export type RoomAction =
  | { type: 'utterance/received'; utterance: Utterance; myTarget: LangCode }
  | { type: 'participants/synced'; participants: Participant[] }

export const initialRoomState: RoomState = {
  utterances: [],
  participants: [],
}

function stateForUtterance(
  _u: Utterance,
  _myTarget: LangCode,
): RenderedUtterance['translationState'] {
  return 'none'
}

function byTimestamp(a: RenderedUtterance, b: RenderedUtterance): number {
  return a.ts - b.ts
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'utterance/received': {
      const incoming = action.utterance
      const existing = state.utterances.find((u) => u.id === incoming.id)

      if (!existing) {
        const next: RenderedUtterance = {
          ...incoming,
          translationState: stateForUtterance(incoming, action.myTarget),
        }
        return { ...state, utterances: [...state.utterances, next].sort(byTimestamp) }
      }

      // A stale interim must never undo a final result.
      if (existing.isFinal && !incoming.isFinal) return state

      const merged: RenderedUtterance = {
        ...existing,
        text: incoming.text,
        isFinal: incoming.isFinal,
        ts: existing.ts, // first emit wins
      }

      return {
        ...state,
        utterances: state.utterances
          .map((u) => (u.id === merged.id ? merged : u))
          .sort(byTimestamp),
      }
    }

    case 'participants/synced':
      return { ...state, participants: action.participants }

    default:
      return state
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/roomReducer.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/roomReducer.ts lib/roomReducer.test.ts
git commit -m "feat: add room reducer with utterance upsert and presence

Upsert by id so interim revisions replace rather than append, and a
stale interim can never undo a final result.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Room reducer — translation state machine

**Files:**
- Modify: `lib/roomReducer.ts`
- Modify: `lib/roomReducer.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `RoomAction`, `roomReducer` from Task 2.
- Produces: two additional `RoomAction` variants — `{ type: 'translation/succeeded'; id: string; translation: string }` and `{ type: 'translation/failed'; id: string }`.

The reducer stays pure: it decides *what state an utterance is in* and never performs a fetch. Entering `'pending'` is the signal the room component watches for.

- [ ] **Step 1: Write the failing tests**

Append to `lib/roomReducer.test.ts`:

```typescript
describe('roomReducer — translation state machine', () => {
  it('marks a foreign-language final utterance pending', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    expect(state.utterances[0].translationState).toBe('pending')
  })

  it('never marks an interim utterance pending', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: false }), 'en')
    expect(state.utterances[0].translationState).toBe('none')
  })

  it('needs no translation when the source is already my target', () => {
    const state = receive(initialRoomState, utterance({ srcLang: 'en', isFinal: true }), 'en')
    expect(state.utterances[0].translationState).toBe('none')
  })

  it('patches in a completed translation', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, {
      type: 'translation/succeeded',
      id: 'u1',
      translation: 'hello',
    })
    expect(state.utterances[0].translationState).toBe('done')
    expect(state.utterances[0].translation).toBe('hello')
  })

  it('marks a failed translation without dropping the utterance', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/failed', id: 'u1' })
    expect(state.utterances[0].translationState).toBe('failed')
    expect(state.utterances[0].text).toBe('hola')
  })

  it('ignores a translation result for an utterance that is not pending', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'en', isFinal: true }), 'en')
    state = roomReducer(state, {
      type: 'translation/succeeded',
      id: 'u1',
      translation: 'should not appear',
    })
    expect(state.utterances[0].translationState).toBe('none')
    expect(state.utterances[0].translation).toBeUndefined()
  })

  it('lets an id leave pending exactly once', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'clobbered' })
    expect(state.utterances[0].translation).toBe('hello')
  })

  it('does not re-trigger translation when a stale interim lands after done', () => {
    let state = receive(initialRoomState, utterance({ srcLang: 'es', isFinal: true }), 'en')
    state = roomReducer(state, { type: 'translation/succeeded', id: 'u1', translation: 'hello' })
    state = receive(state, utterance({ srcLang: 'es', isFinal: false, text: 'stale' }), 'en')
    expect(state.utterances[0].translationState).toBe('done')
    expect(state.utterances[0].translation).toBe('hello')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/roomReducer.test.ts`
Expected: FAIL — the pending test fails (`'none'` received), and TypeScript rejects the two unknown action types.

- [ ] **Step 3: Implement the state machine**

In `lib/roomReducer.ts`, replace `stateForUtterance` with the real decision:

```typescript
function stateForUtterance(
  u: Utterance,
  myTarget: LangCode,
): RenderedUtterance['translationState'] {
  // Interim text is never translated — it is about to change.
  if (!u.isFinal) return 'none'
  // Source already matches my target: render the source as the primary line.
  if (u.srcLang === myTarget) return 'none'
  return 'pending'
}
```

Extend `RoomAction`:

```typescript
export type RoomAction =
  | { type: 'utterance/received'; utterance: Utterance; myTarget: LangCode }
  | { type: 'participants/synced'; participants: Participant[] }
  | { type: 'translation/succeeded'; id: string; translation: string }
  | { type: 'translation/failed'; id: string }
```

In the `'utterance/received'` merge branch, recompute the state only on the interim→final transition, so a completed translation is never reset:

```typescript
      const merged: RenderedUtterance = {
        ...existing,
        text: incoming.text,
        isFinal: incoming.isFinal,
        ts: existing.ts, // first emit wins
        translationState:
          incoming.isFinal && !existing.isFinal
            ? stateForUtterance(incoming, action.myTarget)
            : existing.translationState,
      }
```

Add the two result cases before `default`. Both guard on `'pending'`, which is what makes an id leave pending exactly once:

```typescript
    case 'translation/succeeded':
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.id && u.translationState === 'pending'
            ? { ...u, translation: action.translation, translationState: 'done' as const }
            : u,
        ),
      }

    case 'translation/failed':
      return {
        ...state,
        utterances: state.utterances.map((u) =>
          u.id === action.id && u.translationState === 'pending'
            ? { ...u, translationState: 'failed' as const }
            : u,
        ),
      }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/roomReducer.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/roomReducer.ts lib/roomReducer.test.ts
git commit -m "feat: add translation state machine to the room reducer

Only final utterances in a foreign language enter pending, and both
result actions guard on pending so an id leaves it exactly once.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Translation endpoint

**Files:**
- Create: `lib/translatePrompt.ts`
- Create: `app/api/translate/route.ts`
- Test: `lib/translatePrompt.test.ts`
- Test: `app/api/translate/route.test.ts`

**Interfaces:**
- Consumes: `LANGUAGES`, `languageByCode` from `lib/languages.ts`; `Language`, `LangCode` from `lib/types.ts`.
- Produces: `buildSystemPrompt(src: Language, target: Language, context?: string[]): string`; `POST(req: Request): Promise<Response>` at `POST /api/translate` accepting `{ text: string, srcLang: LangCode, targetLang: LangCode, context?: string[] }` and returning `{ translation: string }` on 200 or `{ error: string }` on 4xx/5xx.

- [ ] **Step 1: Write the failing prompt test**

Create `lib/translatePrompt.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildSystemPrompt } from './translatePrompt'
import { languageByCode } from './languages'

const en = languageByCode('en')!
const es = languageByCode('es')!

describe('buildSystemPrompt', () => {
  it('names both languages using their translateAs phrasing', () => {
    const prompt = buildSystemPrompt(es, en)
    expect(prompt).toContain('neutral Latin American Spanish')
    expect(prompt).toContain('into English')
  })

  it('instructs the model to emit only the translation', () => {
    expect(buildSystemPrompt(es, en)).toContain('Output ONLY the translation')
  })

  it('warns that the input is speech-to-text', () => {
    expect(buildSystemPrompt(es, en)).toContain('live speech-to-text')
  })

  it('includes recent context when given', () => {
    const prompt = buildSystemPrompt(es, en, ['we should rebase', 'agreed'])
    expect(prompt).toContain('we should rebase')
    expect(prompt).toContain('agreed')
  })

  it('omits the context block entirely when there is none', () => {
    expect(buildSystemPrompt(es, en)).not.toContain('Recent conversation')
    expect(buildSystemPrompt(es, en, [])).not.toContain('Recent conversation')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/translatePrompt.test.ts`
Expected: FAIL — cannot resolve `./translatePrompt`.

- [ ] **Step 3: Write `lib/translatePrompt.ts`**

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/translatePrompt.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing route test**

Create `app/api/translate/route.test.ts`. The Anthropic SDK is mocked, so no API key and no network are needed.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const create = vi.fn()

vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    messages = { create }
  }
  return { default: MockAnthropic }
})

import { POST } from './route'

function post(body: unknown): Request {
  return new Request('http://localhost/api/translate', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  create.mockReset()
  create.mockResolvedValue({ content: [{ type: 'text', text: 'hello there' }] })
})

describe('POST /api/translate — guards', () => {
  it('rejects text longer than 500 characters', async () => {
    const res = await POST(post({ text: 'a'.repeat(501), srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('accepts text of exactly 500 characters', async () => {
    const res = await POST(post({ text: 'a'.repeat(500), srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(200)
  })

  it('rejects a request whose source and target match', async () => {
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'es' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects an unknown language code', async () => {
    const res = await POST(post({ text: 'hallo', srcLang: 'de', targetLang: 'en' }))
    expect(res.status).toBe(400)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects empty text', async () => {
    const res = await POST(post({ text: '', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/translate — happy path', () => {
  it('returns the translation', async () => {
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ translation: 'hello there' })
  })

  it('calls the model with the pinned id and deterministic settings', async () => {
    await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        temperature: 0,
      }),
    )
  })

  it('passes the speech text as the user message', async () => {
    await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'hola' }] }),
    )
  })

  it('ignores non-text content blocks', async () => {
    create.mockResolvedValue({
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'hello' }],
    })
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(await res.json()).toEqual({ translation: 'hello' })
  })
})

describe('POST /api/translate — failures', () => {
  it('returns 502 when the model call throws', async () => {
    create.mockRejectedValue(new Error('boom'))
    const res = await POST(post({ text: 'hola', srcLang: 'es', targetLang: 'en' }))
    expect(res.status).toBe(502)
    expect(await res.json()).toHaveProperty('error')
  })

  it('returns 400 on a malformed body', async () => {
    const res = await POST(
      new Request('http://localhost/api/translate', { method: 'POST', body: 'not json' }),
    )
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test -- app/api/translate/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 7: Write the route**

Create `app/api/translate/route.ts`. The model id `claude-haiku-4-5` carries no date suffix, and `temperature` is valid only because Haiku 4.5 predates the 4.6 family — see Global Constraints.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { languageByCode } from '@/lib/languages'
import { buildSystemPrompt } from '@/lib/translatePrompt'

export const runtime = 'nodejs'

const MAX_TEXT_LENGTH = 500
const MODEL = 'claude-haiku-4-5'

function bad(error: string): Response {
  return Response.json({ error }, { status: 400 })
}

export async function POST(req: Request): Promise<Response> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return bad('malformed JSON body')
  }

  const { text, srcLang, targetLang, context } = (body ?? {}) as {
    text?: unknown
    srcLang?: unknown
    targetLang?: unknown
    context?: unknown
  }

  if (typeof text !== 'string' || text.length === 0) return bad('text is required')
  if (text.length > MAX_TEXT_LENGTH) return bad(`text exceeds ${MAX_TEXT_LENGTH} characters`)
  if (typeof srcLang !== 'string' || typeof targetLang !== 'string') {
    return bad('srcLang and targetLang are required')
  }
  // The client should never ask for this; if it does, that is a reducer bug
  // and it should surface loudly rather than silently cost money.
  if (srcLang === targetLang) return bad('srcLang and targetLang must differ')

  const src = languageByCode(srcLang)
  const target = languageByCode(targetLang)
  if (!src || !target) return bad('unknown language code')

  const recent = Array.isArray(context)
    ? context.filter((c): c is string => typeof c === 'string')
    : undefined

  const client = new Anthropic()

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 300,
      temperature: 0,
      system: buildSystemPrompt(src, target, recent),
      messages: [{ role: 'user', content: text }],
    })

    // response.content is a discriminated union — narrow before reading .text.
    const translation = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim()

    return Response.json({ translation })
  } catch (err) {
    // Most specific first. APIConnectionError extends APIError in this SDK,
    // so it must be checked before APIError.
    if (err instanceof Anthropic.RateLimitError) {
      return Response.json({ error: 'rate limited' }, { status: 503 })
    }
    if (err instanceof Anthropic.APIConnectionError) {
      return Response.json({ error: 'upstream unreachable' }, { status: 503 })
    }
    if (err instanceof Anthropic.APIError) {
      return Response.json({ error: 'translation upstream error' }, { status: 502 })
    }
    return Response.json({ error: 'translation failed' }, { status: 502 })
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test -- app/api/translate/route.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: PASS, 38 tests.

- [ ] **Step 10: Commit**

```bash
git add lib/translatePrompt.ts lib/translatePrompt.test.ts app/api/translate
git commit -m "feat: add translation endpoint

Guards on length and on srcLang === targetLang so a reducer bug surfaces
as a 4xx rather than silently costing money. Model id is pinned without a
date suffix; temperature is valid because Haiku 4.5 predates 4.6.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Ably token endpoint

**Files:**
- Create: `app/api/realtime-token/route.ts`
- Test: `app/api/realtime-token/route.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `GET(req: Request): Promise<Response>` at `GET /api/realtime-token?clientId=<id>`, returning an Ably `TokenRequest` JSON object.

- [ ] **Step 1: Write the failing test**

Create `app/api/realtime-token/route.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createTokenRequest = vi.fn()

vi.mock('ably', () => {
  class MockRest {
    auth = { createTokenRequest }
  }
  return { default: { Rest: MockRest }, Rest: MockRest }
})

import { GET } from './route'

function get(url: string): Request {
  return new Request(url)
}

beforeEach(() => {
  createTokenRequest.mockReset()
  createTokenRequest.mockResolvedValue({ keyName: 'k', nonce: 'n', mac: 'm' })
  process.env.ABLY_API_KEY = 'test-key'
})

describe('GET /api/realtime-token', () => {
  it('requires a clientId', async () => {
    const res = await GET(get('http://localhost/api/realtime-token'))
    expect(res.status).toBe(400)
    expect(createTokenRequest).not.toHaveBeenCalled()
  })

  it('mints a token request scoped to the clientId', async () => {
    const res = await GET(get('http://localhost/api/realtime-token?clientId=abc'))
    expect(res.status).toBe(200)
    expect(createTokenRequest).toHaveBeenCalledWith({ clientId: 'abc' })
    expect(await res.json()).toEqual({ keyName: 'k', nonce: 'n', mac: 'm' })
  })

  it('fails cleanly when the server key is missing', async () => {
    delete process.env.ABLY_API_KEY
    const res = await GET(get('http://localhost/api/realtime-token?clientId=abc'))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/realtime-token/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `app/api/realtime-token/route.ts`:

```typescript
import Ably from 'ably'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request): Promise<Response> {
  const clientId = new URL(req.url).searchParams.get('clientId')
  if (!clientId) {
    return Response.json({ error: 'clientId is required' }, { status: 400 })
  }

  const key = process.env.ABLY_API_KEY
  if (!key) {
    return Response.json({ error: 'transport not configured' }, { status: 500 })
  }

  try {
    const rest = new Ably.Rest(key)
    const tokenRequest = await rest.auth.createTokenRequest({ clientId })
    return Response.json(tokenRequest)
  } catch {
    return Response.json({ error: 'could not mint a token' }, { status: 502 })
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/realtime-token/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Create `.env.local` with real credentials**

`.gitignore` already covers this file. Confirm with `git status` that it is untracked before continuing.

```bash
cat > .env.local <<'EOF'
ABLY_API_KEY=
ANTHROPIC_API_KEY=
EOF
git status --porcelain .env.local
```

Expected output: nothing at all. If `.env.local` appears, stop and fix `.gitignore` before proceeding. Then fill in both values.

- [ ] **Step 6: Commit**

```bash
git add app/api/realtime-token
git commit -m "feat: add Ably token endpoint

The browser never sees ABLY_API_KEY; it receives a short-lived token
request scoped to its own clientId.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Speech recognition hook

**Files:**
- Create: `lib/useSpeechRecognition.ts`
- Modify: `NOTES.md` (record manual verification results)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useSpeechRecognition(opts: { locale: string; enabled: boolean; onInterim: (id: string, text: string) => void; onFinal: (id: string, text: string) => void }): { supported: boolean; listening: boolean; error: string | null }`.

**This hook is verified by hand, not by unit test.** Faking Chrome's recognizer well enough to exercise the restart loop means reimplementing its event ordering, and a test passing against our own fake proves nothing about Chrome. The checklist in `NOTES.md` is the verification.

- [ ] **Step 1: Write the hook**

Create `lib/useSpeechRecognition.ts`:

```typescript
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface SpeechRecognitionAlternative {
  transcript: string
}
interface SpeechRecognitionResult {
  isFinal: boolean
  0: SpeechRecognitionAlternative
}
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: { length: number; [i: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionErrorEvent extends Event {
  error: string
}
interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  start(): void
  abort(): void
  onstart: (() => void) | null
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
}

type RecognitionCtor = new () => SpeechRecognitionLike

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const MAX_BACKOFF_MS = 4000

export interface UseSpeechRecognitionOptions {
  locale: string
  enabled: boolean
  onInterim: (id: string, text: string) => void
  onFinal: (id: string, text: string) => void
}

export function useSpeechRecognition({
  locale,
  enabled,
  onInterim,
  onFinal,
}: UseSpeechRecognitionOptions) {
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // User intent, not recognizer state. onend fires both when we stopped it
  // and when Chrome gave up on silence; without this the handler cannot tell
  // which happened, so it cannot know whether to re-arm.
  const wantActive = useRef(false)
  const backoff = useRef(0)
  const currentId = useRef<string | null>(null)
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Keep callbacks in refs so changing them never tears down the recognizer.
  const interimCb = useRef(onInterim)
  const finalCb = useRef(onFinal)
  useEffect(() => {
    interimCb.current = onInterim
    finalCb.current = onFinal
  }, [onInterim, onFinal])

  const mintId = useCallback(() => {
    if (currentId.current === null) {
      currentId.current = crypto.randomUUID()
    }
    return currentId.current
  }, [])

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null)
  }, [])

  useEffect(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || !enabled) return

    const rec = new Ctor()
    rec.lang = locale
    rec.continuous = true
    rec.interimResults = true

    // Wrapped because calling start() on an already-started recognizer
    // throws InvalidStateError.
    const safeStart = () => {
      try {
        rec.start()
      } catch {
        /* already started */
      }
    }

    rec.onstart = () => {
      setListening(true)
    }

    rec.onresult = (event) => {
      backoff.current = 0
      setError(null)
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript.trim()

        if (result.isFinal) {
          if (text.length > 0) finalCb.current(mintId(), text)
          currentId.current = null // always clear on final, even when empty
        } else if (text.length > 0) {
          interimCb.current(mintId(), text)
        }
      }
    }

    rec.onerror = (event) => {
      setError(event.error)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
        wantActive.current = false // stop trying; the user must intervene
      } else {
        backoff.current = Math.min(backoff.current * 2 + 250, MAX_BACKOFF_MS)
      }
    }

    rec.onend = () => {
      setListening(false)
      if (!wantActive.current) return
      restartTimer.current = setTimeout(safeStart, backoff.current)
    }

    wantActive.current = true
    backoff.current = 0
    setListening(true)
    safeStart()

    return () => {
      wantActive.current = false
      if (restartTimer.current) {
        clearTimeout(restartTimer.current)
        restartTimer.current = null
      }
      rec.onstart = null
      rec.onresult = null
      rec.onerror = null
      rec.onend = null
      try {
        rec.abort()
      } catch {
        /* already stopped */
      }
      currentId.current = null
      setListening(false)
    }
    // `locale` is a dependency because SpeechRecognition.lang cannot change
    // mid-session — a locale change must tear down and rebuild the recognizer.
  }, [locale, enabled, mintId])

  return { supported, listening, error }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run the full test suite to confirm nothing regressed**

Run: `npm test`
Expected: PASS, 41 tests.

- [ ] **Step 4: Commit**

```bash
git add lib/useSpeechRecognition.ts
git commit -m "feat: add speech recognition hook

Holds the intent ref that lets onend distinguish a user stop from Chrome
giving up on silence, plus capped backoff, InvalidStateError guards, and
utterance-id minting.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

The manual checklist in `NOTES.md` runs at the end of Task 8, once there is a page to run it in.

---

### Task 7: Transport

**Files:**
- Create: `lib/useTransport.ts`

**Interfaces:**
- Consumes: `Utterance`, `Participant` from `lib/types.ts`; `GET /api/realtime-token` from Task 5.
- Produces: `Transport` interface (`publish(u: Utterance): void`, `subscribe(cb: (u: Utterance) => void): () => void`, `participants: Participant[]`, `connected: boolean`) and `useTransport(roomId: string, me: Participant): Transport`.

The interface is written to what a data channel can do, not to what Ably offers — this is the seam that makes the Jitsi data channel a later swap rather than a rewrite. Do not widen it with Ably-specific concepts.

- [ ] **Step 1: Write the transport hook**

Create `lib/useTransport.ts`:

```typescript
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Ably from 'ably'
import type { Participant, Utterance } from './types'

export interface Transport {
  publish(u: Utterance): void
  subscribe(cb: (u: Utterance) => void): () => void
  participants: Participant[]
  connected: boolean
}

const EVENT = 'utterance'
const INTERIM_THROTTLE_MS = 150

export function useTransport(roomId: string, me: Participant): Transport {
  const [participants, setParticipants] = useState<Participant[]>([])
  const [connected, setConnected] = useState(false)

  const channel = useRef<Ably.RealtimeChannel | null>(null)
  const subscribers = useRef(new Set<(u: Utterance) => void>())
  const lastInterimAt = useRef(0)

  // Presence payload changes when the speaker changes language; keep it in a
  // ref so that does not tear down the connection.
  const meRef = useRef(me)
  useEffect(() => {
    meRef.current = me
    channel.current?.presence.update({ name: me.name, srcLang: me.srcLang })
  }, [me])

  useEffect(() => {
    const client = new Ably.Realtime({
      authUrl: '/api/realtime-token',
      authParams: { clientId: meRef.current.id },
      clientId: meRef.current.id,
    })

    const ch = client.channels.get(`room:${roomId}`)
    channel.current = ch

    client.connection.on('connected', () => setConnected(true))
    client.connection.on('disconnected', () => setConnected(false))
    client.connection.on('failed', () => setConnected(false))

    ch.subscribe(EVENT, (message) => {
      const u = message.data as Utterance
      // Our own utterances already rendered locally on recognition.
      if (u.speakerId === meRef.current.id) return
      for (const cb of subscribers.current) cb(u)
    })

    const syncPresence = async () => {
      const members = await ch.presence.get()
      setParticipants(
        members.map((m) => ({
          id: m.clientId,
          name: (m.data as { name?: string })?.name ?? m.clientId,
          srcLang: (m.data as { srcLang?: Participant['srcLang'] })?.srcLang ?? 'en',
        })),
      )
    }

    ch.presence.subscribe(['enter', 'leave', 'update'], () => void syncPresence())
    void ch.presence
      .enter({ name: meRef.current.name, srcLang: meRef.current.srcLang })
      .then(syncPresence)

    return () => {
      ch.presence.unsubscribe()
      ch.unsubscribe()
      void ch.presence.leave()
      client.close()
      channel.current = null
      setConnected(false)
    }
  }, [roomId])

  const publish = useCallback((u: Utterance) => {
    const ch = channel.current
    if (!ch) return

    // Interim results are throttled; finals always go immediately.
    if (!u.isFinal) {
      const now = Date.now()
      if (now - lastInterimAt.current < INTERIM_THROTTLE_MS) return
      lastInterimAt.current = now
    } else {
      lastInterimAt.current = 0
    }

    void ch.publish(EVENT, u)
  }, [])

  const subscribe = useCallback((cb: (u: Utterance) => void) => {
    subscribers.current.add(cb)
    return () => {
      subscribers.current.delete(cb)
    }
  }, [])

  return { publish, subscribe, participants, connected }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/useTransport.ts
git commit -m "feat: add Ably transport behind a Transport interface

The interface is written to what a data channel can do so the Jitsi data
channel can replace Ably without touching the reducer.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire the room — Phase 1 definition of done

**Files:**
- Modify: `app/page.tsx`
- Create: `app/r/[room]/page.tsx`
- Create: `app/r/[room]/Room.tsx`
- Modify: `NOTES.md`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces: a working room at `/r/[room]`.

**No CSS.** Not one `className`, not one `style` prop. Half-styled is worse than unstyled — the polish pass would begin by correcting tired choices instead of making fresh ones.

- [ ] **Step 1: Make the landing page mint a room**

Replace `app/page.tsx` entirely:

```typescript
import { redirect } from 'next/navigation'

export default function Home() {
  const room = Math.random().toString(36).slice(2, 8)
  redirect(`/r/${room}`)
}
```

- [ ] **Step 2: Add the room route**

Create `app/r/[room]/page.tsx`:

```typescript
import Room from './Room'

export default async function RoomPage({
  params,
}: {
  params: Promise<{ room: string }>
}) {
  const { room } = await params
  return <Room roomId={room} />
}
```

- [ ] **Step 3: Write the room component**

Create `app/r/[room]/Room.tsx`. The `pending` effect is where translation is requested — the reducer only decides state, it never fetches.

```typescript
'use client'

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { LANGUAGES, languageByCode } from '@/lib/languages'
import { initialRoomState, roomReducer } from '@/lib/roomReducer'
import type { LangCode, Participant, Utterance } from '@/lib/types'
import { useSpeechRecognition } from '@/lib/useSpeechRecognition'
import { useTransport } from '@/lib/useTransport'

const CONTEXT_SIZE = 3

export default function Room({ roomId }: { roomId: string }) {
  const [state, dispatch] = useReducer(roomReducer, initialRoomState)
  const [speakLang, setSpeakLang] = useState<LangCode>('en')
  const [showLang, setShowLang] = useState<LangCode>('en')
  const [micOn, setMicOn] = useState(false)

  const [myId] = useState(() => crypto.randomUUID())
  const [myName] = useState(() => `guest-${Math.random().toString(36).slice(2, 5)}`)

  const me: Participant = useMemo(
    () => ({ id: myId, name: myName, srcLang: speakLang }),
    [myId, myName, speakLang],
  )

  const transport = useTransport(roomId, me)
  const showLangRef = useRef(showLang)
  showLangRef.current = showLang

  // Receive remote utterances.
  useEffect(() => {
    return transport.subscribe((u) => {
      dispatch({ type: 'utterance/received', utterance: u, myTarget: showLangRef.current })
    })
  }, [transport])

  useEffect(() => {
    dispatch({ type: 'participants/synced', participants: transport.participants })
  }, [transport.participants])

  // Emit locally first, then publish — do not wait for the round trip.
  const emit = useCallback(
    (id: string, text: string, isFinal: boolean) => {
      const u: Utterance = {
        id,
        speakerId: me.id,
        speakerName: me.name,
        srcLang: me.srcLang,
        text,
        isFinal,
        ts: Date.now(),
      }
      dispatch({ type: 'utterance/received', utterance: u, myTarget: showLangRef.current })
      transport.publish(u)
    },
    [me, transport],
  )

  const onInterim = useCallback(
    (id: string, text: string) => emit(id, text, false),
    [emit],
  )
  const onFinal = useCallback((id: string, text: string) => emit(id, text, true), [emit])

  const locale = languageByCode(speakLang)?.sttLocale ?? 'en-US'
  const speech = useSpeechRecognition({ locale, enabled: micOn, onInterim, onFinal })

  // Anything the reducer put into 'pending' needs a translation. The set of
  // ids already requested is what stops a re-render from firing a second call.
  const requested = useRef(new Set<string>())

  useEffect(() => {
    const pending = state.utterances.filter(
      (u) => u.translationState === 'pending' && !requested.current.has(u.id),
    )

    for (const u of pending) {
      requested.current.add(u.id)

      const context = state.utterances
        .filter((c) => c.isFinal && c.id !== u.id)
        .slice(-CONTEXT_SIZE)
        .map((c) => c.text)

      fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: u.text,
          srcLang: u.srcLang,
          targetLang: showLangRef.current,
          context,
        }),
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`translate failed: ${res.status}`)
          return (await res.json()) as { translation: string }
        })
        .then(({ translation }) =>
          dispatch({ type: 'translation/succeeded', id: u.id, translation }),
        )
        .catch(() => dispatch({ type: 'translation/failed', id: u.id }))
    }
  }, [state.utterances])

  return (
    <main>
      <p>room {roomId}</p>
      <p>connected: {String(transport.connected)}</p>
      <p>speech supported: {String(speech.supported)}</p>
      <p>speech error: {speech.error ?? 'none'}</p>

      <label>
        I speak{' '}
        <select value={speakLang} onChange={(e) => setSpeakLang(e.target.value as LangCode)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <label>
        Show me{' '}
        <select value={showLang} onChange={(e) => setShowLang(e.target.value as LangCode)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <button onClick={() => setMicOn((on) => !on)}>
        {micOn ? 'stop mic' : 'start mic'}
      </button>

      <ul>
        {state.participants.map((p) => (
          <li key={p.id}>
            {p.name} ({p.srcLang})
          </li>
        ))}
      </ul>

      <ol>
        {state.utterances.map((u) => (
          <li key={u.id}>
            <b>{u.speakerName}</b> [{u.srcLang}] {u.text}
            {u.translationState === 'pending' && <> — translating…</>}
            {u.translationState === 'done' && <> — {u.translation}</>}
            {u.translationState === 'failed' && <> — translation unavailable</>}
          </li>
        ))}
      </ol>
    </main>
  )
}
```

One known rough edge, called out so it is not mistaken for a bug: if the user
changes "Show me" between the reducer marking an utterance `'pending'` and the
fetch firing, `targetLang` can arrive equal to `srcLang` and the endpoint
returns 400. The utterance degrades to `'failed'` and renders its source text —
which in that case is already in the language the user just asked for, so the
only wrong thing on screen is the "translation unavailable" note. Leave it;
fixing it properly means re-deriving pending state on target change, which is
Phase 2 work at the earliest.

- [ ] **Step 4: Strip the scaffold's styling**

`create-next-app` writes `app/globals.css` and imports it from `app/layout.tsx`. Remove the import and delete the file — Phase 1 has no CSS.

```bash
rm -f app/globals.css app/page.module.css
```

Then remove the `import './globals.css'` line from `app/layout.tsx`.

- [ ] **Step 5: Type-check and test**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; PASS, 41 tests.

- [ ] **Step 6: Verify the Phase 1 definition of done**

Run: `npm run dev`

In Chrome desktop:
1. Open `http://localhost:3000` — it should redirect to `/r/<something>`.
2. Copy that URL into a second tab.
3. Tab A: set "I speak" to English, "Show me" to English. Click "start mic" and grant the permission.
4. Tab B: set "Show me" to Spanish.
5. Speak an English sentence into tab A.

Expected: unstyled Spanish text appears in tab B beneath the English source. Both tabs list two participants.

- [ ] **Step 7: Run the `useSpeechRecognition` manual checklist**

Work through the four items in `NOTES.md` from Task 1, Step 10, and record the result of each inline in that file. If any fails, fix it in `lib/useSpeechRecognition.ts` before continuing.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: wire the room end to end

Phase 1 definition of done: two tabs, English in, Spanish out, no CSS.
The reducer marks utterances pending; the component performs the fetch.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**STOP HERE if working tired.** Everything past this point is taste, and Phase 2 should not be attempted at 1am.

---

### Task 9: Nix flake

**Files:**
- Create: `flake.nix`
- Modify: `.gitignore` (already covers `result` and `.direnv` — verify)

**Interfaces:**
- Consumes: `package.json` from Task 1.
- Produces: `nix develop` shell and `nix run` for local development.

The project is NixOS-based, and a thing that does not fit their build story does not exist to them. This makes the repo legible to them without committing to a self-hosted deployment the proof of concept does not need.

- [ ] **Step 1: Write the flake**

Create `flake.nix`:

```nix
{
  description = "Live translated captions — a proof of concept";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = [ pkgs.nodejs_22 ];
          shellHook = ''
            echo "node $(node --version)"
            echo "run: npm install && npm run dev"
            echo "needs .env.local with ABLY_API_KEY and ANTHROPIC_API_KEY"
          '';
        };

        apps.default = {
          type = "app";
          program = toString (pkgs.writeShellScript "dev" ''
            export PATH="${pkgs.nodejs_22}/bin:$PATH"
            npm install
            exec npm run dev
          '');
        };
      });
}
```

- [ ] **Step 2: Verify the dev shell builds**

Run: `nix develop --command node --version`
Expected: prints a v22 version string.

If Nix is not installed on this machine, skip the verification and note in `NOTES.md` that the flake is unverified — do not silently claim it works.

- [ ] **Step 3: Commit**

```bash
git add flake.nix flake.lock
git commit -m "build: add Nix flake with a dev shell

The project is NixOS-based; a repo that does not fit their build story
does not exist to them.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

# PHASE 2 — Interface

Phase 2 is entirely taste. Start it fresh.

---

### Task 10: Styling foundation and layout shell

**Files:**
- Create: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/r/[room]/Room.tsx`
- Create: `postcss.config.mjs`, `tailwind.config.ts` (per Tailwind's installer)

**Interfaces:**
- Consumes: the working room from Task 8.
- Produces: a styled single-screen shell — header, roster strip, caption stream, control bar — with the same behavior.

- [ ] **Step 1: Install Tailwind**

```bash
npm install --save-dev tailwindcss @tailwindcss/postcss postcss
```

- [ ] **Step 2: Configure PostCSS**

Create `postcss.config.mjs`:

```javascript
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

- [ ] **Step 3: Add the stylesheet**

Create `app/globals.css`:

```css
@import 'tailwindcss';

:root {
  --bg: #0b0b0d;
  --fg: #f4f4f5;
  --muted: #a1a1aa;
}

html,
body {
  height: 100%;
  background: var(--bg);
  color: var(--fg);
}
```

- [ ] **Step 4: Load the font and the stylesheet**

Replace `app/layout.tsx`:

```typescript
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'polyglot',
  description: 'Live translated captions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans antialiased leading-[1.45]">{children}</body>
    </html>
  )
}
```

- [ ] **Step 5: Lay out the room as one non-scrolling screen**

In `app/r/[room]/Room.tsx`, replace the outer `<main>` with a three-row grid. Only the caption stream scrolls; the page itself never does.

```typescript
  return (
    <main className="grid h-screen grid-rows-[auto_1fr_auto] overflow-hidden">
      <header className="border-b border-white/10 px-6 py-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium tracking-tight">polyglot</span>
          <span className="text-xs text-[var(--muted)]">
            {transport.connected ? '●' : '○'} room {roomId}
          </span>
        </div>
        {/* pickers land here in Task 11, roster in Task 13 */}
      </header>

      <section className="overflow-y-auto px-6 py-4">
        {/* caption stream lands here in Task 12 */}
      </section>

      <footer className="border-t border-white/10 px-6 py-3">
        {/* mic, meter, and type-to-send land here in Tasks 14 and 15 */}
      </footer>
    </main>
  )
```

Move the existing pickers, mic button, roster list, and utterance list into the corresponding regions unchanged for now — later tasks replace them with real components.

- [ ] **Step 6: Verify**

Run: `npm run dev`
Expected: dark single screen, no page scrollbar, captions still appear when speaking.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add styling foundation and layout shell

One screen, no page scroll. Only the caption stream scrolls.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Language pickers and the follow rule

**Files:**
- Create: `lib/languageSelection.ts`
- Create: `components/LanguagePicker.tsx`
- Modify: `app/r/[room]/Room.tsx`
- Test: `lib/languageSelection.test.ts`

**Interfaces:**
- Consumes: `LangCode` from `lib/types.ts`; `LANGUAGES` from `lib/languages.ts`.
- Produces: `LanguageSelection` (`{ speak: LangCode; show: LangCode; showTouched: boolean }`), `initialLanguageSelection`, `nextLanguageSelection(current: LanguageSelection, change: { field: 'speak' | 'show'; value: LangCode }): LanguageSelection`, and `<LanguagePicker label={string} value={LangCode} onChange={(v: LangCode) => void} />`.

The follow rule is what makes the split setting discoverable without explaining it: "Show me" tracks "I speak" until the user touches it directly, and then stops forever.

- [ ] **Step 1: Write the failing tests**

Create `lib/languageSelection.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { initialLanguageSelection, nextLanguageSelection } from './languageSelection'

describe('nextLanguageSelection', () => {
  it('defaults both fields to the same language', () => {
    expect(initialLanguageSelection.speak).toBe(initialLanguageSelection.show)
  })

  it('carries "Show me" along when "I speak" changes', () => {
    const next = nextLanguageSelection(initialLanguageSelection, {
      field: 'speak',
      value: 'es',
    })
    expect(next.speak).toBe('es')
    expect(next.show).toBe('es')
  })

  it('marks "Show me" as touched when set directly', () => {
    const next = nextLanguageSelection(initialLanguageSelection, {
      field: 'show',
      value: 'es',
    })
    expect(next.show).toBe('es')
    expect(next.speak).toBe('en')
    expect(next.showTouched).toBe(true)
  })

  it('stops following once "Show me" has been touched', () => {
    let s = nextLanguageSelection(initialLanguageSelection, { field: 'show', value: 'es' })
    s = nextLanguageSelection(s, { field: 'speak', value: 'en' })
    expect(s.speak).toBe('en')
    expect(s.show).toBe('es')
  })

  it('keeps "Show me" touched after further speak changes', () => {
    let s = nextLanguageSelection(initialLanguageSelection, { field: 'show', value: 'es' })
    s = nextLanguageSelection(s, { field: 'speak', value: 'es' })
    expect(s.showTouched).toBe(true)
    expect(s.show).toBe('es')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- lib/languageSelection.test.ts`
Expected: FAIL — cannot resolve `./languageSelection`.

- [ ] **Step 3: Implement the rule**

Create `lib/languageSelection.ts`:

```typescript
import type { LangCode } from './types'

export interface LanguageSelection {
  speak: LangCode
  show: LangCode
  showTouched: boolean
}

export const initialLanguageSelection: LanguageSelection = {
  speak: 'en',
  show: 'en',
  showTouched: false,
}

export function nextLanguageSelection(
  current: LanguageSelection,
  change: { field: 'speak' | 'show'; value: LangCode },
): LanguageSelection {
  if (change.field === 'show') {
    return { ...current, show: change.value, showTouched: true }
  }
  return {
    ...current,
    speak: change.value,
    // "Show me" follows "I speak" until the user touches it directly.
    show: current.showTouched ? current.show : change.value,
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- lib/languageSelection.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the picker component**

Create `components/LanguagePicker.tsx`. Labelled by effect — "I speak" and "Show me", never "source" and "target".

```typescript
'use client'

import { LANGUAGES } from '@/lib/languages'
import type { LangCode } from '@/lib/types'

export function LanguagePicker({
  label,
  value,
  onChange,
}: {
  label: string
  value: LangCode
  onChange: (value: LangCode) => void
}) {
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
      {label}
      <select
        className="rounded border border-white/15 bg-transparent px-2 py-1 text-[var(--fg)]"
        value={value}
        onChange={(e) => onChange(e.target.value as LangCode)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code} className="bg-[var(--bg)]">
            {l.nativeLabel}
          </option>
        ))}
      </select>
    </label>
  )
}
```

- [ ] **Step 6: Use it in the room**

In `app/r/[room]/Room.tsx`, replace the two `useState` language hooks with the selection state and render the pickers in the header:

```typescript
  const [languages, setLanguages] = useState(initialLanguageSelection)
  const speakLang = languages.speak
  const showLang = languages.show
```

```typescript
        <div className="mt-2 flex gap-6">
          <LanguagePicker
            label="I speak"
            value={languages.speak}
            onChange={(value) =>
              setLanguages((s) => nextLanguageSelection(s, { field: 'speak', value }))
            }
          />
          <LanguagePicker
            label="Show me"
            value={languages.show}
            onChange={(value) =>
              setLanguages((s) => nextLanguageSelection(s, { field: 'show', value }))
            }
          />
        </div>
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit && npm test && npm run dev`
Expected: no type errors; PASS, 46 tests. In the browser, changing "I speak" moves "Show me" with it — until you set "Show me" yourself, after which it stays put.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add language pickers with the follow rule

Show me tracks I speak until touched directly, which teaches the split
setting without explaining it.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Caption row and caption stream

**Files:**
- Create: `components/CaptionRow.tsx`
- Create: `components/CaptionStream.tsx`
- Modify: `app/r/[room]/Room.tsx`

**Interfaces:**
- Consumes: `RenderedUtterance` from `lib/types.ts`; `languageByCode` from `lib/languages.ts`.
- Produces: `<CaptionRow utterance={RenderedUtterance} now={number} />` and `<CaptionStream utterances={RenderedUtterance[]} />`. `CaptionStream` owns the clock and passes `now` down, so rows stay pure and only one timer runs.

Hierarchy is where the idea becomes legible: the language you read is the large line, the source sits above it small and dimmed.

- [ ] **Step 1: Write the caption row**

Create `components/CaptionRow.tsx`:

```typescript
import { languageByCode } from '@/lib/languages'
import type { RenderedUtterance } from '@/lib/types'

function speakerColor(speakerId: string): string {
  const hues = [200, 320, 40, 150, 270]
  let hash = 0
  for (let i = 0; i < speakerId.length; i++) hash = (hash * 31 + speakerId.charCodeAt(i)) | 0
  return `hsl(${hues[Math.abs(hash) % hues.length]} 70% 65%)`
}

function relativeTime(ts: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000))
  if (seconds < 2) return 'now'
  if (seconds < 60) return `${seconds}s`
  return `${Math.round(seconds / 60)}m`
}

export function CaptionRow({
  utterance,
  now,
}: {
  utterance: RenderedUtterance
  now: number
}) {
  const source = languageByCode(utterance.srcLang)
  const showsTranslation = utterance.translationState === 'done' && utterance.translation

  return (
    <article className="min-h-[5.5rem] py-3">
      <div className="flex items-baseline justify-between text-xs">
        <span style={{ color: speakerColor(utterance.speakerId) }}>
          ● {utterance.speakerName} · {source?.nativeLabel}
        </span>
        <span className="text-[var(--muted)] opacity-60">
          {relativeTime(utterance.ts, now)}
        </span>
      </div>

      {/* Source sits above the target, smaller and dimmed, whenever a
          translation is being shown. When none is needed, the source IS the
          primary line and is rendered large below instead. */}
      {showsTranslation && (
        <p className="text-[0.8em] opacity-55">{utterance.text}</p>
      )}

      <p className="text-xl">
        {showsTranslation ? utterance.translation : utterance.text}
      </p>

      {utterance.translationState === 'failed' && (
        <p className="text-xs text-[var(--muted)] opacity-70">translation unavailable</p>
      )}
    </article>
  )
}
```

- [ ] **Step 2: Write the caption stream**

Create `components/CaptionStream.tsx`. Finalized captions scroll up; one pinned interim row per active speaker sits at the bottom, which handles overlapping speech without lane management.

```typescript
'use client'

import { useEffect, useRef, useState } from 'react'
import type { RenderedUtterance } from '@/lib/types'
import { CaptionRow } from './CaptionRow'

export function CaptionStream({ utterances }: { utterances: RenderedUtterance[] }) {
  const bottom = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const finalized = utterances.filter((u) => u.isFinal)
  const interim = utterances.filter((u) => !u.isFinal)

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' })
  }, [finalized.length, interim.length])

  return (
    <div className="flex flex-col">
      {finalized.map((u) => (
        <CaptionRow key={u.id} utterance={u} now={now} />
      ))}

      {interim.map((u) => (
        <p key={u.id} className="py-2 text-[var(--muted)] opacity-70">
          ░ {u.speakerName} is speaking… {u.text}
        </p>
      ))}

      <div ref={bottom} />
    </div>
  )
}
```

- [ ] **Step 3: Use it in the room**

In `app/r/[room]/Room.tsx`, replace the `<ol>` of utterances inside the `<section>` with:

```typescript
        <CaptionStream utterances={state.utterances} />
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run dev`
Expected: speaking in one tab produces a dimmed source line above a large translated line in the other, with a pinned "is speaking…" row while mid-sentence.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add caption row and stream

Target language large, source above it small and dimmed. One pinned
interim row per speaker handles overlapping speech.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Roster

**Files:**
- Create: `components/Roster.tsx`
- Modify: `app/r/[room]/Room.tsx`

**Interfaces:**
- Consumes: `Participant` from `lib/types.ts`; `languageByCode` from `lib/languages.ts`.
- Produces: `<Roster participants={Participant[]} meId={string} />`.

- [ ] **Step 1: Write the component**

Create `components/Roster.tsx`:

```typescript
import { languageByCode } from '@/lib/languages'
import type { Participant } from '@/lib/types'

export function Roster({
  participants,
  meId,
}: {
  participants: Participant[]
  meId: string
}) {
  if (participants.length === 0) return null

  return (
    <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
      {participants.map((p) => (
        <li key={p.id}>
          {p.name}
          {p.id === meId && ' (you)'} · {languageByCode(p.srcLang)?.nativeLabel}
        </li>
      ))}
    </ul>
  )
}
```

- [ ] **Step 2: Use it in the room header**

In `app/r/[room]/Room.tsx`, replace the `<ul>` of participants with:

```typescript
        <Roster participants={state.participants} meId={me.id} />
```

- [ ] **Step 3: Verify**

Run: `npm run dev`
Expected: opening and closing a second tab makes the roster grow and shrink visibly.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add roster

Join and leave must be visible; an invisible room reads as broken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: Mic button and audio level meter

**Files:**
- Create: `lib/useAudioLevel.ts`
- Create: `components/MicIndicator.tsx`
- Modify: `app/r/[room]/Room.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `useAudioLevel(active: boolean): number` returning 0–1, and `<MicIndicator active={boolean} level={number} onToggle={() => void} />`.

The meter is about twenty lines and it is what makes silence read as "working" rather than "broken". **The mic is never requested on page load** — only when the button is clicked.

- [ ] **Step 1: Write the audio level hook**

Create `lib/useAudioLevel.ts`:

```typescript
'use client'

import { useEffect, useState } from 'react'

export function useAudioLevel(active: boolean): number {
  const [level, setLevel] = useState(0)

  useEffect(() => {
    if (!active) {
      setLevel(0)
      return
    }

    let stream: MediaStream | null = null
    let context: AudioContext | null = null
    let frame = 0
    let cancelled = false

    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((granted) => {
        if (cancelled) {
          granted.getTracks().forEach((t) => t.stop())
          return
        }
        stream = granted
        context = new AudioContext()
        const analyser = context.createAnalyser()
        analyser.fftSize = 512
        context.createMediaStreamSource(granted).connect(analyser)

        const samples = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          analyser.getByteTimeDomainData(samples)
          let peak = 0
          for (const sample of samples) {
            peak = Math.max(peak, Math.abs(sample - 128) / 128)
          }
          setLevel(peak)
          frame = requestAnimationFrame(tick)
        }
        tick()
      })
      .catch(() => setLevel(0))

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      stream?.getTracks().forEach((t) => t.stop())
      void context?.close()
      setLevel(0)
    }
  }, [active])

  return level
}
```

- [ ] **Step 2: Write the indicator**

Create `components/MicIndicator.tsx`:

```typescript
'use client'

const BARS = [0.15, 0.4, 0.7, 0.4, 0.15]

export function MicIndicator({
  active,
  level,
  onToggle,
}: {
  active: boolean
  level: number
  onToggle: () => void
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onToggle}
        aria-pressed={active}
        className="rounded-full border border-white/20 px-4 py-2 text-sm"
      >
        {active ? '🎙 on' : '🎙 off'}
      </button>

      <div className="flex h-6 items-end gap-1" aria-hidden>
        {BARS.map((weight, i) => (
          <span
            key={i}
            className="w-1 rounded-full bg-[var(--fg)]"
            style={{
              height: `${Math.max(2, level * weight * 100)}%`,
              opacity: active ? 0.8 : 0.2,
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Use it in the room footer**

In `app/r/[room]/Room.tsx`, replace the plain mic button:

```typescript
  const level = useAudioLevel(micOn)
```

```typescript
        <MicIndicator active={micOn} level={level} onToggle={() => setMicOn((on) => !on)} />
```

- [ ] **Step 4: Verify**

Run: `npm run dev`
Expected: no permission prompt until the button is clicked. Once on, the bars move while you speak and settle flat in silence.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add mic button and audio level meter

The mic is never requested on page load. The meter is what makes silence
read as working rather than broken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Type-to-send

**Files:**
- Create: `components/TypeToSend.tsx`
- Modify: `app/r/[room]/Room.tsx`

**Interfaces:**
- Consumes: the `emit(id, text, isFinal)` callback in `Room.tsx` from Task 8.
- Produces: `<TypeToSend onSend={(text: string) => void} />`.

A real inclusion feature for a contributor who would rather type, which doubles as the escape hatch for a reviewer who will not talk to their laptop.

- [ ] **Step 1: Write the component**

Create `components/TypeToSend.tsx`:

```typescript
'use client'

import { useState } from 'react'

export function TypeToSend({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState('')

  return (
    <form
      className="flex flex-1 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        const trimmed = text.trim()
        if (trimmed.length === 0) return
        onSend(trimmed)
        setText('')
      }}
    >
      <label className="text-sm text-[var(--muted)]" htmlFor="type-to-send">
        or type:
      </label>
      <input
        id="type-to-send"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={500}
        className="flex-1 rounded border border-white/15 bg-transparent px-3 py-2 text-sm"
      />
    </form>
  )
}
```

- [ ] **Step 2: Wire it up**

In `app/r/[room]/Room.tsx`, add a handler that emits a final utterance directly — typed text has no interim stage:

```typescript
  const sendTyped = useCallback(
    (text: string) => emit(crypto.randomUUID(), text, true),
    [emit],
  )
```

Render it in the footer beside the mic indicator:

```typescript
        <TypeToSend onSend={sendTyped} />
```

- [ ] **Step 3: Verify**

Run: `npm run dev`
Expected: typing a Spanish sentence in one tab and pressing Enter produces an English caption in the other, with the mic never enabled.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: add type-to-send

Typed text emits as a final utterance directly; there is no interim
stage for something that was never spoken.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: Second-window button

**Files:**
- Create: `components/SecondWindowButton.tsx`
- Modify: `app/r/[room]/Room.tsx`

**Interfaces:**
- Consumes: `LANGUAGES`, `languageByCode` from `lib/languages.ts`; `LangCode` from `lib/types.ts`.
- Produces: `<SecondWindowButton roomId={string} otherLang={LangCode} />`, which opens the same room in a new window preset to the other language with the mic off.

**The single highest-leverage element in the build** — without it, most reviewers never see the thing work.

- [ ] **Step 1: Support language presets in the room URL**

In `app/r/[room]/Room.tsx`, seed the language selection from the query string. Reading `window.location` inside the initializer keeps this client-only and avoids a hydration mismatch:

```typescript
  const [languages, setLanguages] = useState(() => {
    if (typeof window === 'undefined') return initialLanguageSelection
    const params = new URLSearchParams(window.location.search)
    const show = params.get('show')
    const speak = params.get('speak')
    if (!show && !speak) return initialLanguageSelection
    return {
      speak: (languageByCode(speak ?? '')?.code ?? 'en') as LangCode,
      show: (languageByCode(show ?? '')?.code ?? 'en') as LangCode,
      showTouched: Boolean(show),
    }
  })
```

- [ ] **Step 2: Write the button**

Create `components/SecondWindowButton.tsx`:

```typescript
'use client'

import { languageByCode } from '@/lib/languages'
import type { LangCode } from '@/lib/types'

export function SecondWindowButton({
  roomId,
  otherLang,
}: {
  roomId: string
  otherLang: LangCode
}) {
  const label = languageByCode(otherLang)?.nativeLabel ?? otherLang

  return (
    <button
      className="rounded border border-white/20 px-3 py-2 text-sm"
      onClick={() =>
        window.open(
          `/r/${roomId}?speak=${otherLang}&show=${otherLang}`,
          '_blank',
          'width=900,height=760',
        )
      }
    >
      Open a second window as {label}
    </button>
  )
}
```

- [ ] **Step 3: Show it when the room is empty**

In `app/r/[room]/Room.tsx`, render it inside the caption section whenever nobody else is present:

```typescript
  const alone = state.participants.filter((p) => p.id !== me.id).length === 0
  const otherLang: LangCode = languages.show === 'en' ? 'es' : 'en'
```

```typescript
        {alone ? (
          <div className="flex h-full flex-col items-start justify-center gap-4">
            <p className="text-[var(--muted)]">You&apos;re the only one here.</p>
            <SecondWindowButton roomId={roomId} otherLang={otherLang} />
          </div>
        ) : (
          <CaptionStream utterances={state.utterances} />
        )}
```

- [ ] **Step 4: Verify**

Run: `npm run dev`
Expected: a fresh room shows "You're the only one here" and the button. Clicking it opens a second window already set to the other language, mic off, and both rooms switch to the caption stream.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add second-window button and the alone state

Without a one-click way to see both sides, most reviewers never see the
thing work at all.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: The remaining states and the empty state

**Files:**
- Create: `components/UnsupportedScreen.tsx`
- Modify: `app/r/[room]/Room.tsx`
- Modify: `components/CaptionStream.tsx`

**Interfaces:**
- Consumes: `supported` and `error` from `useSpeechRecognition`.
- Produces: `<UnsupportedScreen />`; a mic-denied recovery notice; a ghosted empty-state caption.

- [ ] **Step 1: Write the unsupported screen**

Create `components/UnsupportedScreen.tsx`. An explicit screen, never a broken layout.

```typescript
export function UnsupportedScreen() {
  return (
    <main className="flex h-screen flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl">Needs desktop Chrome</h1>
      <p className="max-w-md text-[var(--muted)]">
        Live captions use the browser&apos;s built-in speech recognition, which only
        desktop Chrome provides. Open this link in Chrome on a laptop.
      </p>
    </main>
  )
}
```

- [ ] **Step 2: Render it when speech is unsupported**

In `app/r/[room]/Room.tsx`, after the hooks (never before — hook order must stay stable):

```typescript
  if (speech.supported === false && micOn) return <UnsupportedScreen />
```

Detecting support requires the effect in `useSpeechRecognition` to have run, so gate on an explicit `false` rather than a falsy value.

- [ ] **Step 3: Add mic-denied recovery**

In the footer of `app/r/[room]/Room.tsx`, beneath the controls. Type-to-send stays fully functional, which is the point.

```typescript
        {speech.error === 'not-allowed' && (
          <p className="mt-2 text-xs text-[var(--muted)]">
            Microphone blocked. Click the camera icon in Chrome&apos;s address bar,
            allow the microphone, then reload. You can still type below.
          </p>
        )}
```

- [ ] **Step 4: Add the ghosted empty state**

In `components/CaptionStream.tsx`, when there is nothing to show. Low opacity and no timestamp, so it teaches the layout without being mistaken for content:

```typescript
  if (finalized.length === 0 && interim.length === 0) {
    return (
      <div className="pointer-events-none select-none py-3 opacity-25">
        <p className="text-xs">● Ana · Español</p>
        <p className="text-[0.8em] opacity-55">Creo que deberíamos fusionar ese PR primero</p>
        <p className="text-xl">I think we should merge that PR first.</p>
      </div>
    )
  }
```

- [ ] **Step 5: Verify all five states**

Run: `npm run dev`, then check each:

| State | How to trigger | Expected |
|---|---|---|
| Not Chrome | Open in Safari, click the mic | The "needs desktop Chrome" screen |
| Mic denied | Block the mic in site settings, click the mic | Recovery text; type-to-send still works |
| Alone in room | Open a fresh room | "You're the only one here" + button |
| Translation fails | Set an invalid `ANTHROPIC_API_KEY`, speak | Source text + "translation unavailable" |
| Join / leave | Open and close a second window | Roster grows and shrinks |

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add unsupported, mic-denied, and empty states

Every failure path still renders the source text; nothing is ever
dropped, because silence reads as agreement.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Motion

**Files:**
- Modify: `components/CaptionRow.tsx`
- Modify: `components/CaptionStream.tsx`

**Interfaces:**
- Consumes: `CaptionRow`, `CaptionStream` from Task 12.
- Produces: no interface change.

Captions enter with a short slide-and-settle. The translation crossfades in over the source. **Interim text animates not at all** — animating text that revises several times a second reads as jitter, not liveliness.

- [ ] **Step 1: Install Framer Motion**

```bash
npm install framer-motion
```

- [ ] **Step 2: Animate caption entry**

In `components/CaptionRow.tsx`, add `'use client'` at the top, import `motion`, and replace the `<article>` opening tag:

```typescript
import { motion } from 'framer-motion'
```

```typescript
    <motion.article
      className="min-h-[5.5rem] py-3"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
    >
```

Close it with `</motion.article>`.

- [ ] **Step 3: Crossfade the translation over the source**

Still in `components/CaptionRow.tsx`, replace the large line with a keyed crossfade so the swap is not a jump:

```typescript
import { AnimatePresence, motion } from 'framer-motion'
```

```typescript
      <AnimatePresence mode="wait" initial={false}>
        <motion.p
          key={showsTranslation ? 'translation' : 'source'}
          className="text-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {showsTranslation ? utterance.translation : utterance.text}
        </motion.p>
      </AnimatePresence>
```

- [ ] **Step 4: Leave interim rows unanimated**

Confirm the interim `<p>` in `components/CaptionStream.tsx` is still a plain `<p>` with no `motion` wrapper and no transition. This is deliberate — do not "fix" it for consistency.

- [ ] **Step 5: Verify**

Run: `npm run dev`
Expected: finalized captions slide in briefly; the translation fades in over the source rather than jumping; the pinned interim row updates with no animation at all.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add caption motion

Entry slides and settles, translation crossfades. Interim text is
deliberately unanimated -- animating it reads as jitter.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: the finished application.
- Produces: no code interface.

Named limitations read as deliberate scoping. The same limitations discovered by a reviewer read as bugs.

- [ ] **Step 1: Write the README**

Replace `README.md`:

```markdown
# polyglot

Live translated captions for a call. Each participant sets the language they
speak and, independently, the language they read. Nobody's choice affects
anyone else's screen.

This is a proof of concept, not a product. It exists to answer one question:
do translated captions arriving roughly a second and a half behind the speaker
genuinely restore a conversation, or do they only appear to while turn-taking
and interruption fall apart?

## Running it

Needs desktop Chrome.

```bash
nix develop          # or use your own Node 22
npm install
cp .env.example .env.local   # then fill in both keys
npm run dev
```

Environment:

```
ABLY_API_KEY=          # https://ably.com — free tier is ample
ANTHROPIC_API_KEY=     # https://console.anthropic.com
```

Neither key ever reaches the browser.

Open the printed URL, click "Open a second window as Español", and speak.

## How it works

Speech is transcribed in your browser by the Web Speech API. Only the *source*
text is broadcast. Each receiving client compares the source language to its
own target and asks `/api/translate` for its own translation — which is why one
room can serve people reading different languages at once, and why changing
your language touches nothing but your own screen.

Interim results are broadcast but never translated: translating text that is
about to change burns calls and makes captions flicker.

Adding a language is one row in `lib/languages.ts`.

## Known limitations

- **Chrome only, desktop only.** Speech recognition is the browser's, and only
  Chrome ships it.
- **A refresh loses the transcript.** The room survives; caption history does
  not. There is no persistence of any kind.
- **Everyone must be running this app.** There is no way to transcribe someone
  who is not — that is inherent to transcribing in the browser, and it is the
  central thing a server-side build would fix.
- **English and Spanish only.**
- **Translation quality is unmeasured.** This tests conversational rhythm, not
  accuracy.

## Tests

```bash
npm test
```

The room reducer carries the real test weight — ordering, stale interim
revisions, and the translation state machine are where the bugs live. The
speech recognition hook is verified by hand against the checklist in
`NOTES.md`, because a test passing against our own fake recognizer would prove
nothing about Chrome.
```

- [ ] **Step 2: Add `.env.example`**

```bash
cat > .env.example <<'EOF'
ABLY_API_KEY=
ANTHROPIC_API_KEY=
EOF
```

- [ ] **Step 3: Final verification**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors; PASS, 46 tests; a successful production build.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README with named limitations

Named limitations read as deliberate scoping; the same limitations
discovered by a reviewer read as bugs.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Deployment

Not a task — do this once, after Task 19.

1. Push the repository to GitHub.
2. Import it in Vercel.
3. Set `ABLY_API_KEY` and `ANTHROPIC_API_KEY` as Vercel environment variables. Neither is `NEXT_PUBLIC_`.
4. Deploy, open the URL, and run the two-window check once against production.

The proof of concept is hosted on your account with your keys, so the project it is built for hosts, configures, and pays for nothing.
