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
nix develop          # or use your own Node 22 — the repo pins 22.22.3 in .tool-versions
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

## Verifying it

**Without a mic:** open the room in Chrome, click "Open a second window as
Español", then type in either window's *or type:* box and press Enter. This
exercises transport, presence, translation, and rendering end to end without
needing microphone access. Type-to-send isn't only a test hook — it's a
genuine inclusion feature for contributors who'd rather type than speak.

**With a mic:** click the mic control, grant permission, and speak. This is
the only way to answer the question this project exists for. What to watch
for is **rhythm** — whether you can interrupt, and whether a reply lands while
it's still relevant — not accuracy.

`NOTES.md` has the manual verification checklist that still needs a human to
run through by hand.

## Console test hooks

Two objects are installed on `window` while a room is open, for driving and
measuring latency-test scripts from the browser console. They serve
different purposes and are not related: `polyglot` **sends** utterances and
observes their arrival; `polyglotLatency` **measures** how long they took.
Neither is part of the UI — both are for scripts you write yourself.

### `window.polyglot` — driving a room

Installed on mount, removed on unmount (along with everything it holds), so
it only exists while a `Room` is actually mounted.

**`polyglot.send(text)`**

Sends `text` exactly as if it had been typed into the *or type:* box and
Enter pressed — same trim-and-length check, same emit path, so it enters the
translation pipeline identically to a human typist. Returns the minted
utterance id (a string), or **`null`** if the text was rejected: trimmed
down to nothing (empty or whitespace-only), or over 500 characters after
trimming. The 500-character limit is enforced here independently of the
input's `maxLength` attribute — a console call bypasses the DOM entirely, so
without this check an over-length send would sail past the UI's limit and
get a 400 back from `/api/translate`, which shows up as a `'failed'`
caption. That looks like a translation bug. It is not — check the length
first.

```js
const id = window.polyglot.send('can you hear me now')
// id === null means the text was rejected before it ever reached the network.
```

**`polyglot.onUtterance(cb)`**

Calls `cb({ id, speakerId, speakerName, srcLang, text, ts })` for every
**remote, final** utterance this tab receives. Remote only — your own sends
never fire this, because you already know what you sent. Final only —
interim (in-progress) revisions arrive several times a second and would
fire a driving script on half a word. Returns an unsubscribe function.

This fires **on arrival**, not on translation completing. Those are
different moments a few hundred milliseconds to a couple of seconds apart —
`onUtterance`/`nextUtterance` tell you a message showed up; `polyglotLatency`
(below) tells you how long the translation and render after that took.

**`polyglot.nextUtterance(timeoutMs = 30000)`**

Returns a Promise for the next arrival. **This is cursor-based, not a bare
listener** — that is the entire point of the design, and the reason a
sequential two-sided script (below) is safe to write at all. Arrivals are
kept in a FIFO queue: if an utterance already arrived before you called
`nextUtterance()`, the call resolves with it **immediately**, instead of
waiting for a *new* arrival that may never come. A naive listener-based
implementation would race here — tab A sends, tab B is momentarily busy,
A's message arrives and is missed, and B's later `nextUtterance()` call
waits forever for something that already happened. That looks exactly like
a hang, not like a bug in the script.

If nothing arrives within `timeoutMs`, the Promise resolves to **`null`** —
it never rejects and never hangs forever.

The queue is capped at 100 unread arrivals; past that, the oldest is
dropped so a script that forgets to drain it doesn't leak memory for the
life of the tab.

### `window.polyglotLatency` — measuring what already happened

Installed the first time any utterance is recorded (via `lib/latency.ts`)
and persists independently of `polyglot`. See that file's module doc for
the full model; the summary needed to use it from a script:

- **`polyglotLatency.stats()`** — aggregate percentiles (`min`/`median`/
  `p95`/`max`) over four segments — `stt`, `transport`, `translation`,
  `render` — plus `total`, each computed only from the samples that have
  every segment `total` needs. Also reports:
  - **`skewSuspected`** (boolean) — true if any sample showed a *negative*
    transport duration, which is only possible if the sending and
    receiving machines' clocks disagree. **Check this first on any
    cross-machine run.** Transport is the one segment computed from two
    different machines' clocks, so it is the only segment clock skew can
    corrupt — a `true` here means don't trust the `transport` numbers, and
    don't trust `total` either, since it's built from transport.
  - **`sttUnmeasured`** — how many samples have no `sttMs`, because they
    were sent via `polyglot.send()` / typed rather than spoken. Not a
    defect: a typed utterance never goes through speech recognition, so it
    has nothing to time there, but every other segment for it is real.
  - **`renderUnmeasured`** — how many samples have no `renderMs`, typically
    because the receiving tab was backgrounded (browsers don't run paint
    callbacks in hidden tabs — the normal case here, since this app is
    meant to run behind a live call). Also not a defect.
  - A sample missing `sttMs` and/or `renderMs` is still counted in `count`
    and in every segment it does have a value for, but is excluded from
    `total` — a partial sum is never averaged in under the same label as a
    complete one.
- **`polyglotLatency.reset()`** — discards every recorded and in-flight
  sample. Call this between test runs, or your next run's numbers include
  leftovers from the last one (and, on a translation API that can cold
  start, an earlier serverless cold start can sit in your p95 long after
  it stopped being representative).
- **`polyglotLatency.raw()`** — the array of completed `LatencySample`
  objects (`{ id, sttMs?, transportMs, translationMs, renderMs? }`) behind
  `stats()`, in completion order — useful for correlating a specific
  `polyglot.send()` id with its measured latency.

### Worked example: a two-sided sequential script

Two tabs, both on the same room, one set to send and reply, the other to
wait and reply. Paste the sender half in tab A's console, the responder
half in tab B's:

```js
// Tab A — sender
const id = window.polyglot.send('what time works for you tomorrow')
const reply = await window.polyglot.nextUtterance() // waits for B's reply
console.log('B said:', reply?.text)

// Tab B — responder (run this first, or any time — the cursor means the
// order these two run in relative to each other doesn't matter)
const heard = await window.polyglot.nextUtterance()
console.log('A said:', heard?.text)
window.polyglot.send('does 3pm work?')
```

Because `nextUtterance()` is cursor-based, it does not matter whether B's
`await` starts before or after A's `send()` lands — an arrival that already
happened is queued, not missed. After a run, check
`window.polyglotLatency.stats()` (checking `skewSuspected` first if the two
tabs are on different machines), then `window.polyglotLatency.reset()`
before the next one.

## Known limitations

- **Chrome only, desktop only.** Speech recognition is the browser's, and only
  Chrome ships it.
- **A refresh loses the transcript.** The room survives; caption history does
  not. There is no persistence of any kind.
- **Everyone must be running this app.** There is no way to transcribe someone
  who is not — that is inherent to transcribing in the browser, and it is the
  central thing a server-side build would fix.
- **English and Spanish only.**
- **Translation quality is unmeasured, and `temperature: 0` is not a
  determinism guarantee.** Across roughly ten live calls, one mistranslation
  inverted grammatical person — "can you push the branch" came back as "may I
  push the branch" — and it did not reproduce across four targeted retries.
  Rare errors of that shape are inherent to LLM translation. This build tests
  conversational rhythm, not accuracy.
- **`npx tsc --noEmit` alone is not the full typecheck.** It passes today, but
  Next 16 generates route types into the gitignored `.next/types/`, so on a
  fresh clone run `npx next typegen` first (or any `next build` / `next dev`)
  before typechecking.
- **The audio meter opens a second microphone stream.** The Web Speech API
  never exposes the `MediaStream` it uses internally, so the meter calls
  `getUserMedia` independently, leaving two streams open on the same device
  while the mic is live. On some Bluetooth headsets a second acquisition can
  force a profile renegotiation and briefly glitch both; some mobile WebViews
  only permit one open audio input stream at all.
- **`crypto.randomUUID` requires a secure context** — HTTPS or `localhost`.
  Opening the app over plain `http://` on a LAN IP will fail, and the Web
  Speech API needs a secure context too, so the microphone wouldn't start
  either.
- **A newly joined participant sees no earlier captions.** History is local
  and is never replayed to someone who joins later; they see the ghosted
  example placeholder until someone speaks.
- **When you're alone in a room you can't see your own captions.** The
  "You're the only one here" state replaces the caption stream entirely. Use
  the second-window button to see them.
- **In development you'll see a red "2 Issues" badge** from Next's dev
  overlay. It's React Strict Mode double-mounting, which closes the Ably
  connection while presence is still being entered. The rejections are
  caught; it does not occur in a production build.

## Tests

```bash
npm test
```

The room reducer carries the real test weight — ordering, stale interim
revisions, and the translation state machine are where the bugs live. The
speech recognition hook is verified by hand against the checklist in
`NOTES.md`, because a test passing against our own fake recognizer would prove
nothing about Chrome.
