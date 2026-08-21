# Live Translated Captions — Build Spec (Path A)

**Phase 1 (tonight):** end-to-end round trip, unstyled.
**Phase 2 (fresh):** UI, states, polish.

The line between them is deliberate. Phase 1 is judgment-light and safe to build tired. Phase 2 is entirely taste and should not be attempted at 1am.

---

## 0. What it is

A room you open in a browser. Each participant sets the language they speak and the language they want to read. Speech is transcribed locally, the source text is broadcast, and every client translates incoming text into its own target language.

**Non-goals — do not build these:** accounts, persistence, database, auto language detection, text-to-speech, video, mobile layouts, transcript export, recording.

---

## 1. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Host | Vercel |
| Transport | Ably (pub/sub + presence) |
| STT | Web Speech API (`webkitSpeechRecognition`) |
| Translation | Claude Haiku via `/api/translate` |
| State | `useReducer` |
| Styling | Tailwind (Phase 2 only) |
| Motion | Framer Motion (Phase 2 only) |

**Env — server-only, nothing `NEXT_PUBLIC_`:**
```
ABLY_API_KEY=
ANTHROPIC_API_KEY=
```
`.env.local` in `.gitignore` from commit 1. Not scrubbed later — a removed key still lives in history.

---

## 2. File layout

```
app/
  page.tsx                    // mints a room, redirects to /r/[room]
  r/[room]/page.tsx           // the room
  api/translate/route.ts
  api/realtime-token/route.ts
  layout.tsx
components/                   // Phase 2
  CaptionStream.tsx  CaptionRow.tsx
  LanguagePicker.tsx  Roster.tsx  MicIndicator.tsx
lib/
  languages.ts
  types.ts
  useSpeechRecognition.ts
  useTransport.ts
  roomReducer.ts
NOTES.md                      // dump questions here instead of solving them tired
```

---

## 3. Types — `lib/types.ts`

```ts
export type LangCode = 'en' | 'es' | 'fr' | 'cmn' | 'th'
export type Script = 'latin' | 'cjk' | 'thai'

export interface Language {
  code: LangCode
  sttLocale: string      // BCP-47, for SpeechRecognition.lang
  label: string          // English name, for the picker
  nativeLabel: string    // native name
  translateAs: string    // phrase injected into the model prompt
  script: Script         // drives the typography class in Phase 2
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

/** Local only. */
export interface RenderedUtterance extends Utterance {
  translation?: string
  translationState: 'none' | 'pending' | 'done' | 'failed'
}
```

`translationState: 'none'` means no translation was needed — source language equals my target. Render the source as the primary line.

---

## 4. Language table — `lib/languages.ts`

Adding a language is one row. This is the file to point at in the demo video.

```ts
export const LANGUAGES: Language[] = [
  { code: 'en',  sttLocale: 'en-US', label: 'English',  nativeLabel: 'English',
    translateAs: 'English', script: 'latin' },
  { code: 'es',  sttLocale: 'es-MX', label: 'Spanish',  nativeLabel: 'Español',
    translateAs: 'neutral Latin American Spanish (no vosotros, no peninsular vocabulary)',
    script: 'latin' },
  { code: 'fr',  sttLocale: 'fr-FR', label: 'French',   nativeLabel: 'Français',
    translateAs: 'French', script: 'latin' },
  { code: 'cmn', sttLocale: 'zh-CN', label: 'Mandarin', nativeLabel: '中文',
    translateAs: 'Simplified Mandarin Chinese', script: 'cjk' },
  { code: 'th',  sttLocale: 'th-TH', label: 'Thai',     nativeLabel: 'ไทย',
    translateAs: 'Thai', script: 'thai' },
]
```

Trim the list to whatever survives your STT quality tests.

---

## 5. `lib/useSpeechRecognition.ts`

**The tar pit. Build this first while you have attention.**

```ts
useSpeechRecognition({
  locale: string,
  enabled: boolean,
  onInterim: (id: string, text: string) => void,
  onFinal:   (id: string, text: string) => void,
}): { supported: boolean; listening: boolean; error: string | null }
```

Config: `continuous = true`, `interimResults = true`, `lang = locale`.

**Restart loop.** `onend` fires both when you stop it and when Chrome gives up on silence. Distinguish with an intent ref, or the loop won't know whether to re-arm.

```ts
const wantActive = useRef(false)   // user intent, not recognizer state
const backoff = useRef(0)

onresult = () => { backoff.current = 0 }

onerror = (e) => {
  if (e.error === 'not-allowed') { wantActive.current = false }        // stop trying
  else if (e.error === 'no-speech' || e.error === 'network') {
    backoff.current = Math.min(backoff.current * 2 + 250, 4000)        // avoid tight loop
  }
}

onend = () => {
  if (!wantActive.current) return
  setTimeout(() => { try { rec.start() } catch {} }, backoff.current)
}
```

Wrap every `.start()` in try/catch — calling it on an already-started recognizer throws `InvalidStateError`.

**Utterance IDs.** Hold `currentIdRef`. Mint a new id when it's null; clear it when a final result fires. Interim revisions reuse the id so receivers upsert instead of appending.

**Locale changes** require stop → restart. `lang` can't change mid-session.

**Support check:** `'webkitSpeechRecognition' in window || 'SpeechRecognition' in window`. Return `supported: false` rather than throwing — Phase 2 renders a real screen off this.

---

## 6. `app/api/translate/route.ts`

```
POST /api/translate
  body: { text: string, srcLang: LangCode, targetLang: LangCode, context?: string[] }
  200:  { translation: string }
  4xx:  { error: string }
```

Guards: reject `text.length > 500`; reject `srcLang === targetLang` (the client should never call it). Model: Claude Haiku, `max_tokens: 300`, `temperature: 0`.

**System prompt:**

```
You are a live conversation translator for a video call.
Translate the user's message from {srcTranslateAs} into {targetTranslateAs}.

Rules:
- Output ONLY the translation. No quotes, no notes, no alternatives.
- Leave untranslated: proper nouns, product and repository names, code
  identifiers, file paths, and established technical terms
  (e.g. "merge conflict", "pull request", "rebase").
- Match the speaker's register and level of formality.
- The input is live speech-to-text. It may lack punctuation and contain
  recognition errors. Infer intent and produce natural, fluent output.
- If the input is too garbled to translate, return it unchanged.

Recent conversation, for context only — do not translate:
{context}
```

`context` = the last 2–3 finalized utterances. Meaningful lift on pronouns and topic continuity, near-zero cost.

---

## 7. `app/api/realtime-token/route.ts`

Standard Ably token request. Client never sees `ABLY_API_KEY`.

```ts
const client = new Ably.Rest(process.env.ABLY_API_KEY!)
const token = await client.auth.createTokenRequest({ clientId })
return Response.json(token)
```

---

## 8. `lib/useTransport.ts`

**The one piece of architecture worth building deliberately.** Thirty lines behind an interface so the Jitsi data channel (Path B) or `lib-jitsi-meet` (v2) swaps in without a rewrite.

```ts
export interface Transport {
  publish(u: Utterance): void
  subscribe(cb: (u: Utterance) => void): () => void
  participants: Participant[]
  connected: boolean
}

export function useTransport(roomId: string, me: Participant): Transport
```

Ably implementation: channel `room:${roomId}`, event name `utterance`, presence enter with `{ name, srcLang }`, presence updated when the speaker changes language.

**Publish interim results, throttled to ~150ms.** Remote viewers get live source text, which is most of the perceived-latency win. Publishing interim is not the same as *translating* interim — see below.

---

## 9. `lib/roomReducer.ts` and wiring

State: `{ utterances: RenderedUtterance[], participants: Participant[] }`.

**On any received utterance:** upsert by `id`.

**On final only:**
- `srcLang === myTarget` → `translationState: 'none'`, render source as the primary line, no API call
- otherwise → set `'pending'`, POST `/api/translate`, patch in `translation` and `'done'`, or `'failed'` on error

**Never translate interim.** It burns calls on strings about to change and makes the caption flicker between unrelated sentences.

**Your own utterances render locally the moment they're recognized** — don't wait for the transport round trip.

**Guard against duplicate translation** of the same `id`; late-arriving interim revisions must not re-trigger a completed translation.

---

## Phase 1 — definition of done

Two tabs open. Tab A set to English, tab B set to Spanish. Speak into tab A. Plain, unstyled text appears in tab B in Spanish.

**No CSS. Not "minimal CSS" — none.** Half-styled is worse than unstyled, because tomorrow you'll anchor on the tired choices and spend the polish pass correcting rather than building.

Stop here. Do not add the roster, the audio meter, the second-window button, or the type-to-send input tonight.

---

## Phase 2 — UI

### Layout

One screen, no page scroll, no nav.

```
┌──────────────────────────────────────────────────────┐
│  polyglot                              ● room a7f3k9 │
│  I speak [ English ▾ ]      Show me [ English ▾ ]    │
│  ─────────────────────────────────────────────────── │
│  Wei 中文 · Marie Français · Will English            │  ← roster
│                                                      │
│    ● Wei · 中文                                1.4s  │
│      我觉得我们应该先合并那个 PR                        │  ← source, small/muted
│      I think we should merge that PR first.          │  ← target, large
│                                                      │
│    ● Will · English                            now   │
│      Sounds good — is it rebased?                    │
│                                                      │
│    ░ Marie is speaking…                              │  ← pinned interim
│  ─────────────────────────────────────────────────── │
│  [ 🎙 ] ▁▃▅▃▁          or type: [                 ]  │
└──────────────────────────────────────────────────────┘
```

Finalized utterances scroll up. One pinned interim row per currently-active speaker sits at the bottom — handles overlapping speech without lane management.

### Typography — per-utterance, not global

A three-language call puts Latin, CJK, and Thai on one screen simultaneously. Scope these with a class off `Language.script`:

| Script | Font stack | Line-height |
|---|---|---|
| `latin` | Geist / Inter via `next/font` | 1.45 |
| `cjk` | **system stack** — `PingFang SC, Hiragino Sans GB, Microsoft YaHei` | 1.7 |
| `thai` | `Noto Sans Thai` via `next/font` | 1.85 |

**Do not webfont CJK.** Noto Sans SC is multi-megabyte and subsetting it well is its own afternoon. Thai tone marks clip into the line above below ~1.8 — the most common Thai web-typography bug.

Fixed-height caption rows. Mandarin is roughly half the character count of the English equivalent; auto-sizing makes rows visibly jump between speakers.

### Hierarchy

- Target language: large, full contrast
- Source language: ~0.8× size, ~55% opacity, directly above
- Speaker name + language badge: small, with the speaker's color
- Timestamp / latency: smallest, low contrast, right-aligned

The inverted view on the other participant's screen is the product in one glance. Make sure it screenshots well side by side — it's the video's money shot.

### Motion

Framer Motion. Caption enters with a short slide-and-settle (~180ms, ease-out). Translation swaps in over the source with a crossfade, not a jump. Interim text updates in place with no animation — animating it reads as jitter.

### Controls

Labeled by effect: **"I speak"** and **"Show me"**. Not "source" / "target". Default them to the same value; changing "I speak" updates "Show me" unless the user has already touched it.

### Required affordances

- **"Open a second window as ___"** — new window, same room, other language, mic off. The single highest-leverage element in the build; without it most reviewers never see it work.
- **Type-to-send input** — a real inclusion feature (a contributor who'd rather type than speak) that doubles as the escape hatch for a reviewer who won't talk to their laptop.
- **Mic button** — never request the mic on page load. An unexplained permission prompt three seconds after clicking a stranger's link loses people.
- **Audio level meter** — Web Audio `AnalyserNode` off the same stream. ~20 lines, and it's what makes silence read as "working" rather than "broken".

### The five states that decide whether it "works"

| State | Behavior |
|---|---|
| Not Chrome / mobile | Explicit "needs desktop Chrome" screen. Not a broken layout. |
| Mic denied | Clear recovery instructions; type-to-send still fully functional. |
| Alone in room | "You're the only one here" + the second-window button. Never silence. |
| Translation fails | Render source text with a quiet "translation unavailable". Degrade to transcript, never drop the utterance. |
| Join / leave | Roster updates visibly. |

### Empty state

A ghosted example caption showing the source/target format — obviously a placeholder (low opacity, no timestamp), so it teaches the layout without being mistaken for content.

---

## Known limitations — state these in the README

Chrome only. No mobile. Refresh loses caption history (the room survives; the transcript doesn't). No persistence. Every participant must be running the app — the peer-side constraint means there's no way to transcribe someone who isn't.

Named limitations read as deliberate scoping. The same limitations discovered by a reviewer read as bugs.
