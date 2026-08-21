# Live Translated Captions — Design

**Date:** 2026-08-21
**Status:** Approved, pending implementation plan
**Supersedes:** `initial_pass_spec.md` (retained as source material)

---

## 1. Purpose

A distributed volunteer project self-hosts Jitsi for video calls and avoids
using it. The project's lead is a native Spanish speaker who reads and writes
English comfortably; spoken English is the barrier, and only spoken English.
Writing allows time, re-reading, and a translator in another tab. A live call
allows none of them, so the barrier falls entirely on the synchronous layer.
The team loses everything that layer is good for: fast disagreement, design
discussion, ambiguity resolved in minutes instead of threads.

Existing options do not close the gap. Jitsi's translated captions require
Jigasi and a Google Cloud speech contract. Commercial platforms cut against the
reason the project self-hosts. Both translate the room into a *single* target
language, which serves at most one person in a room with three.

**This design answers one question and is scoped to nothing else:** do
translated captions arriving roughly a second and a half behind the speaker
genuinely restore a conversation, or do they only appear to while turn-taking,
interruption, and overlapping speech fall apart?

**Success:** two people who do not share a language hold a real conversation
and both follow it, with the rhythm intact.

This is a proof of concept. The end state the project wants is translation
built into their Jitsi server, deployable through Nix. That is weeks of work,
and it should not begin until the interaction question above is answered.

## 2. Decisions

Recorded with their reasoning, because each was contested during design.

| Decision | Choice | Why |
|---|---|---|
| Jitsi integration | **None.** Standalone browser room. | The riskiest assumption is interaction, not infrastructure. Jitsi integration answers no part of the question and costs days. The `Transport` seam keeps the Jitsi data channel a later swap. |
| Hosting | **Vercel**, author's keys. | The project must not have to host, configure, or pay for anything. A link they click costs them nothing. |
| Nix | **Flake providing a dev shell + `nix run`.** | The project is NixOS-based and a thing that does not fit their build story does not exist to them. A dev shell earns that credibility without committing to a self-hosted deployment the PoC does not need. |
| STT | **Web Speech API** (`webkitSpeechRecognition`). | Free, no keys, no infrastructure, no latency of our own. Chrome-only is already an accepted limitation. If its latency defeats the concept, that is a finding worth having in an afternoon rather than after a streaming-STT integration. |
| Translation topology | **Receiver-side.** | See §4. |
| Languages | **English and Spanish only.** | The two that matter to the real user. Dropping the other three removes the entire multi-script typography problem, which was the largest chunk of UI work and served demo polish rather than the question being asked. |

**Non-goals — do not build these:** accounts, persistence, a database,
automatic language detection, text-to-speech, video, mobile layouts, transcript
export, recording, server-side translation caching.

## 3. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| Host | Vercel |
| Transport | Ably (pub/sub + presence) |
| STT | Web Speech API |
| Translation | Claude Haiku via `/api/translate` |
| State | `useReducer` |
| Styling | Tailwind (Phase 2 only) |
| Motion | Framer Motion (Phase 2 only) |
| Packaging | Nix flake — dev shell and `nix run` |

**Environment — server-only. Nothing `NEXT_PUBLIC_`:**

```
ABLY_API_KEY=
ANTHROPIC_API_KEY=
```

`.env.local` enters `.gitignore` in commit 1, not later. A removed key still
lives in history.

## 4. Architecture

### 4.1 Translation topology — receiver-side

Only source text crosses the wire. Each client compares an incoming
utterance's `srcLang` against its own target language and decides for itself
whether to request a translation.

This is the property the project cannot get anywhere else: one participant's
language choice affects nobody else's experience. Changing your language
re-renders your own screen and touches nothing else — no renegotiation, no
signal to other clients, no effect on what anyone else reads.

Two alternatives were considered and rejected:

- **Sender-side fan-out** (speaker translates once per target language present,
  broadcasts all variants) uses fewer API calls, but couples the speaker's
  client to everyone else's settings — precisely the coupling being escaped —
  and leaves a late joiner or a mid-call language change with nothing until the
  next utterance.
- **Server-side translation with a shared cache** keyed by
  `(utteranceId, targetLang)` preserves the isolation property and reduces
  duplicate calls. It is the right eventual move and is deliberately deferred:
  it is a change *inside* `/api/translate` alone — an in-memory `Map` with a
  TTL — requiring no client changes. Buying it now is speculative.

At two to four participants the duplicate-call cost of receiver-side
translation is negligible.

### 4.2 The path a sentence takes

1. A participant opens `/`, which mints a random room id and redirects to
   `/r/[room]`. The id is the room. No creation step, no accounts, nothing to
   be granted; anyone with the link is in.
2. They click the mic (never requested on page load) and speak.
3. `webkitSpeechRecognition` emits interim results. The speaker's client
   renders them locally at once and publishes them to Ably throttled to ~150ms,
   under a stable utterance `id`.
4. Receivers upsert by `id`, so revisions replace rather than append. Interim
   text appears as a pinned row at the bottom of the stream, updating in place.
5. On a final result the speaker publishes once more with `isFinal: true`, then
   mints a fresh id for the next utterance.
6. Each receiving client, **on final only**, compares `srcLang` to its own
   target:
   - equal → `translationState: 'none'`; the source becomes the primary line;
     no network call.
   - different → `'pending'`; `POST /api/translate` with the text and the last
     two or three finalized utterances as context; patch in `'done'` or
     `'failed'`.

**Interim results are broadcast but never translated.** Translating text that
is about to change burns calls and makes captions flicker between unrelated
sentences.

**A speaker's own utterances render locally the moment they are recognized**,
without waiting for the transport round trip.

### 4.3 Latency budget

The success criterion is perceptual, so the budget is stated explicitly:

- STT final result: ~0.5–1.5s after speech stops. Dominant term, and the one
  least under our control.
- Ably delivery: tens of milliseconds.
- Haiku on a short sentence at `temperature: 0`: a few hundred milliseconds.

The interim broadcast is what makes this feel live: remote viewers watch source
text form in real time, and only the translated line waits. This is a
deliberate perceptual choice and accounts for most of the perceived-latency
win.

### 4.4 Credentials

`ANTHROPIC_API_KEY` never leaves `/api/translate`. `ABLY_API_KEY` never leaves
`/api/realtime-token`, which mints a short-lived token request per client.

## 5. File layout

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
flake.nix
NOTES.md                      // open questions land here instead of being solved tired
```

The dependency graph is a line, not a web: components → reducer → types. The
two hooks talk to the outside world and report through callbacks. Nothing in
`lib/` imports a component.

## 6. Modules

### 6.1 `lib/types.ts`

```ts
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

/** Local only. */
export interface RenderedUtterance extends Utterance {
  translation?: string
  translationState: 'none' | 'pending' | 'done' | 'failed'
}
```

`translationState: 'none'` means no translation was needed — the source
language equals my target. Render the source as the primary line.

The split between `Utterance` and `RenderedUtterance` is the architecture
expressed as two interfaces. If a translation ever appears in the published
type, receiver-side isolation has been lost.

### 6.2 `lib/languages.ts`

The table, and nothing else. Pure data, no imports. Adding a language is one
row; this is the file to point at when demonstrating that claim.

```ts
export const LANGUAGES: Language[] = [
  { code: 'en', sttLocale: 'en-US', label: 'English', nativeLabel: 'English',
    translateAs: 'English', script: 'latin' },
  { code: 'es', sttLocale: 'es-MX', label: 'Spanish', nativeLabel: 'Español',
    translateAs: 'neutral Latin American Spanish (no vosotros, no peninsular vocabulary)',
    script: 'latin' },
]
```

`script` is retained with a single value so the row shape is correct for a
future language. The branch it feeds has one arm; no per-script font machinery
is built.

### 6.3 `lib/useSpeechRecognition.ts`

**Build this first, while attention is fresh.** Every ugly thing about the
Web Speech API lives here, and nothing outside this file knows the recognizer
exists.

```ts
useSpeechRecognition({
  locale: string,
  enabled: boolean,
  onInterim: (id: string, text: string) => void,
  onFinal:   (id: string, text: string) => void,
}): { supported: boolean; listening: boolean; error: string | null }
```

Configuration: `continuous = true`, `interimResults = true`, `lang = locale`.

**The restart loop.** `onend` fires both when you stop the recognizer and when
Chrome gives up on silence. Without an explicit record of user intent the
handler cannot tell which happened, so it cannot know whether to re-arm.

```ts
const wantActive = useRef(false)   // user intent, not recognizer state
const backoff = useRef(0)

onresult = () => { backoff.current = 0 }

onerror = (e) => {
  if (e.error === 'not-allowed') { wantActive.current = false }        // stop trying
  else if (e.error === 'no-speech' || e.error === 'network') {
    backoff.current = Math.min(backoff.current * 2 + 250, 4000)        // avoid a tight loop
  }
}

onend = () => {
  if (!wantActive.current) return
  setTimeout(() => { try { rec.start() } catch {} }, backoff.current)
}
```

Every `.start()` is wrapped in try/catch — calling it on an already-started
recognizer throws `InvalidStateError`.

**Utterance ids** are minted here. Hold `currentIdRef`; mint when it is null,
clear it when a final result fires. Interim revisions reuse the id so that
receivers upsert instead of appending.

**Locale changes** require stop-then-restart. `lang` cannot change mid-session.

**Support check:** `'webkitSpeechRecognition' in window || 'SpeechRecognition'
in window`. Return `supported: false` rather than throwing — Phase 2 renders a
real screen off this.

### 6.4 `lib/useTransport.ts`

Roughly thirty lines behind an interface, written to what a data channel can
do rather than to what Ably offers. This is the seam that makes the Jitsi data
channel a later swap instead of a rewrite.

```ts
export interface Transport {
  publish(u: Utterance): void
  subscribe(cb: (u: Utterance) => void): () => void
  participants: Participant[]
  connected: boolean
}

export function useTransport(roomId: string, me: Participant): Transport
```

Ably implementation: channel `room:${roomId}`, event name `utterance`,
presence entered with `{ name, srcLang }` and updated when the speaker changes
language. Interim publishes are throttled to ~150ms.

### 6.5 `lib/roomReducer.ts`

Pure: `(state, action) => state` over
`{ utterances: RenderedUtterance[], participants: Participant[] }`. No fetches,
no side effects. Purity is what makes the ordering rules testable without a
browser, an API key, or a microphone — and the ordering rules are where the
bugs are.

The reducer never performs a fetch. It decides *what state an utterance is
in*; the room component observes utterances that have entered `'pending'` and
performs the request, dispatching the result back in. The client's own target
language is passed to the reducer as part of the action rather than read from
outside, which keeps it a pure function of its inputs.

Rules:

- **On any received utterance:** upsert by `id`.
- **On final only:** `srcLang === myTarget` → `'none'`, and the source becomes
  the primary line — no request is ever made. Otherwise → `'pending'`, which is
  the component's signal to call `/api/translate`; the response dispatches back
  as `'done'` with a `translation`, or `'failed'`.
- **Guard against duplicate translation** of the same `id`. A late-arriving
  interim revision must never re-trigger a request for, or clobber, a
  completed translation. An `id` leaves `'pending'` exactly once.

### 6.6 `app/api/translate/route.ts`

```
POST /api/translate
  body: { text: string, srcLang: LangCode, targetLang: LangCode, context?: string[] }
  200:  { translation: string }
  4xx:  { error: string }
```

Guards: reject `text.length > 500`; reject `srcLang === targetLang`. The client
should never send the latter — if it does, that is a reducer bug, and it should
surface as a 4xx rather than silently cost money.

Model: Claude Haiku, `max_tokens: 300`, `temperature: 0`.

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

`context` is the last two or three finalized utterances. Meaningful lift on
pronouns and topic continuity at near-zero cost.

### 6.7 `app/api/realtime-token/route.ts`

A standard Ably token request. The client never sees `ABLY_API_KEY`.

```ts
const client = new Ably.Rest(process.env.ABLY_API_KEY!)
const token = await client.auth.createTokenRequest({ clientId })
return Response.json(token)
```

## 7. Failure handling

**Rule: never drop an utterance.** Every failure path degrades to showing the
source text with a quiet note. A transcript in a language you cannot read still
tells you that someone spoke and who it was. Silence tells you nothing — and
silence on a call is indistinguishable from agreement, which is the mechanism
that keeps this whole problem invisible.

| State | Behavior |
|---|---|
| Not Chrome / mobile | Explicit "needs desktop Chrome" screen, rendered off `supported: false`. Not a broken layout. |
| Mic denied | Clear recovery instructions; type-to-send remains fully functional. |
| Alone in room | "You're the only one here" plus the second-window button. Never blank. |
| Translation fails | Source text with a quiet "translation unavailable". No automatic retry; the utterance does not vanish. |
| Join / leave | The roster updates visibly. |

## 8. Testing

Weighted where the risk actually is.

**`roomReducer` — real unit tests, and the ones that matter.** Interim-then-final
ordering; out-of-order arrival; a stale interim landing after a translation has
completed; duplicate-translation guarding; presence add and remove. This is
most of the genuine bug surface and none of it needs a browser.

**`/api/translate`** — tests for both guards and a happy path against a mocked
client. The prompt's *quality* is not unit-testable; it is judged by ear during
the two-tab run, which is the correct instrument for it.

**`useSpeechRecognition` — verified by hand, not by test.** Faking Chrome's
recognizer well enough to exercise the restart loop means reimplementing its
event ordering, and a test passing against our own fake proves nothing about
Chrome. The manual checklist lives in `NOTES.md`: deny the mic; sit silent for
two minutes; kill the network mid-session; change language mid-session.

## 9. Phases

### Phase 1 — end-to-end round trip

**Definition of done:** two tabs open, tab A set to English, tab B set to
Spanish. Speak into tab A. Plain, unstyled text appears in tab B in Spanish.

**No CSS. Not "minimal CSS" — none.** Half-styled is worse than unstyled,
because the polish pass then begins by correcting tired choices instead of
making fresh ones.

Phase 1 excludes the roster, the audio meter, the second-window button, and the
type-to-send input.

### Phase 2 — interface

One screen, no page scroll, no nav.

```
┌──────────────────────────────────────────────────────┐
│  polyglot                              ● room a7f3k9 │
│  I speak [ English ▾ ]      Show me [ English ▾ ]    │
│  ─────────────────────────────────────────────────── │
│  Ana Español · Will English                          │  ← roster
│                                                      │
│    ● Ana · Español                             1.4s  │
│      Creo que deberíamos fusionar ese PR primero      │  ← source, small/muted
│      I think we should merge that PR first.          │  ← target, large
│                                                      │
│    ● Will · English                            now   │
│      Sounds good — is it rebased?                    │
│                                                      │
│    ░ Ana is speaking…                                │  ← pinned interim
│  ─────────────────────────────────────────────────── │
│  [ 🎙 ] ▁▃▅▃▁          or type: [                 ]  │
└──────────────────────────────────────────────────────┘
```

Finalized utterances scroll up. One pinned interim row per currently-active
speaker sits at the bottom, which handles overlapping speech without lane
management.

**Typography.** One script: Geist or Inter via `next/font`, line-height 1.45.
Caption rows are fixed-height — Spanish runs meaningfully longer than English,
and auto-sizing makes rows jump as speakers alternate.

**Hierarchy.** Target language large and at full contrast; source directly
above at ~0.8× size and ~55% opacity; speaker name and language badge small, in
the speaker's colour; timestamp and latency smallest, lowest contrast,
right-aligned. Two screens side by side, each showing the other's language as
its large line, is the concept in one glance — it needs to screenshot well.

**Motion.** Framer Motion. Captions enter with a short slide-and-settle (~180ms,
ease-out). The translation crossfades in over the source rather than jumping.
Interim text updates in place with no animation at all — animating text that
revises several times a second reads as jitter, not liveliness.

**Controls, labelled by effect: "I speak" and "Show me."** Not "source" and
"target". Both default to the same value. Changing "I speak" carries "Show me"
along with it until the user touches "Show me" directly, after which it stops
following. That single rule makes the split setting discoverable without
explaining it.

**Load-bearing affordances:**

- **"Open a second window as Español"** — a new window, same room, other
  language, mic off. Without it most reviewers never see the thing work, which
  makes it the highest-leverage element in the build.
- **Type-to-send** — a genuine inclusion feature for a contributor who would
  rather type, which doubles as the escape hatch for a reviewer who will not
  talk to their laptop.
- **Audio level meter** — a Web Audio `AnalyserNode` off the same stream, about
  twenty lines. It is what makes silence read as "working" rather than
  "broken".

**The mic is never requested on page load.** An unexplained permission prompt
three seconds after clicking a stranger's link loses people.

**Empty state:** a ghosted example caption in the source-over-target format,
low opacity and no timestamp — obviously a placeholder, so it teaches the
layout without being mistaken for content.

## 10. Known limitations

To be stated plainly in the README. Named limitations read as deliberate
scoping; the same limitations discovered by a reviewer read as bugs.

- Chrome only. No mobile.
- A refresh loses caption history. The room survives; the transcript does not.
- No persistence of any kind.
- Every participant must be running the app. There is no way to transcribe
  someone who is not — this is inherent to peer-side transcription and is the
  central thing a future server-side build would fix.
- English and Spanish only.
- Translation quality is unmeasured. This design tests conversational rhythm,
  not accuracy.

## 11. What a positive result unlocks

If two people who do not share a language hold a conversation and both follow
it, the server-side Jitsi build is worth the weeks it takes. The migration path
is already shaped for it: `Transport` swaps to the Jitsi data channel or
`lib-jitsi-meet` without touching the reducer, and translation moves behind
`/api/translate` into a cached server-side service without touching the
clients.

If it does not hold, that is worth knowing now rather than after.
