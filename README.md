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
