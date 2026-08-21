# NOTES

Park open questions here rather than solving them mid-task.

## Manual verification — useSpeechRecognition (Task 6)

Chrome desktop only. Run each and record the result.

- [ ] **NOT RUN (Task 8).** Deny the microphone permission. Expect: `error` set, no restart loop,
      no repeated permission prompts.
- [ ] **NOT RUN (Task 8).** Grant the mic, then sit silent for two minutes. Expect: recognition keeps
      re-arming, backoff grows to at most 4s, no tight loop in the console.
- [ ] **NOT RUN (Task 8).** Kill the network mid-session, then restore it. Expect: recovery without
      a page reload.
- [ ] **NOT RUN (Task 8).** Change the spoken language mid-session. Expect: recognizer stops and
      restarts in the new locale; no `InvalidStateError` in the console.
- [ ] **NOT RUN (Task 8).** Unplug or disable the microphone **mid-session**, after permission was
      granted and results were flowing. Expect a growing backoff, not a 0ms
      restart storm. (The existing "deny the mic" item takes the
      `not-allowed` branch and does not cover this.)
- [ ] **NOT RUN (Task 8).** Speak, stay silent long enough for Chrome to end and re-arm the
      session, then speak again. Confirm `listening` is `true` while results
      flow, not stuck `false`.
- [ ] **NOT RUN (Task 8).** Change the spoken language **mid-utterance** — while a partial caption
      is on screen, not during silence — and confirm the first caption in
      the new language does **not** replace the old partial.
- [ ] **NOT RUN (Task 8).** Start speaking, then **go silent mid-sentence** so Chrome ends the
      session before a final arrives, then speak something different.
      Confirm the new sentence appears as its **own** caption rather than
      overwriting the abandoned partial.

**Task 8 note:** this session has no Chrome/browser tool available (the
claude-in-chrome extension is not connected in this environment), so none of
the above could be exercised. Marked NOT RUN rather than guessed at. These
require a human (or a session with browser tooling) to actually work through
in Chrome desktop with a real microphone.

## Manual verification — useTransport (Task 7)

Run each and record the result.

- [ ] **NOT RUN (Task 8).** Close a browser **tab** (not a client-side navigation) and time how long
      the remaining window shows the departed participant. Should disappear
      promptly, not after ~2 minutes.
- [ ] **NOT RUN (Task 8).** Watch the console during unmount and during a room change for
      `Unhandled promise rejection` from `presence.leave` / `presence.enter`.
- [ ] **NOT RUN (Task 8).** Run with `ABLY_API_KEY` unset and confirm the failure is visible
      (`connected: false`) rather than a silent empty roster.
- [ ] **NOT RUN (Task 8).** In dev with Strict Mode, confirm the roster does not show a duplicated
      self entry on first mount.
- [ ] **NOT RUN (Task 8).** Change speaking language mid-session in one window; confirm the other
      window's roster label updates and no reconnect occurs.
- [ ] **NOT RUN (Task 8).** Change room (navigate to a different `/r/<id>`) and watch the
      connection badge — it must not flicker back to connected as the old
      client's queued state change arrives.
- [ ] **NOT RUN (Task 8).** Navigate away from the room and press Back. Confirm the room either
      reconnects on its own or clearly shows itself disconnected — it must
      never look connected while sending and receiving nothing.

**Task 8 note:** same as above — no browser tool available in this session,
so these could not be exercised either. Also NOT RUN.

## Task 8 — Phase 1 definition of done (two-tab live check)

**NOT RUN.** This session has no Chrome browser tool available
(claude-in-chrome is not connected/installed here), and speech
recognition + two-tab interaction cannot be simulated with curl. What
*was* verified programmatically instead:

- `npm run dev` starts cleanly; `GET /` returns a 307 redirect to
  `/r/<random-id>` as expected.
- `GET /r/<room>` server-renders the expected unstyled markup: room id,
  connection/speech status lines, the two language `<select>`s, the mic
  button, and empty participant/utterance lists.
- `POST /api/translate` with `{"text":"Hello, how are you?","srcLang":"en","targetLang":"es"}`
  against the real Anthropic key in `.env.local` returned
  `{"translation":"Hola, ¿cómo estás?"}`, confirming the translation
  round trip the Room component depends on actually works end to end.

The live two-tab, real-microphone check described in the task brief
(Step 6) was **not performed** and must be run by a human, or by an
agent with a working Chrome browser tool, before this is considered
fully verified against the Phase 1 definition of done.

## Open questions

- `crypto.randomUUID` requires a secure context, so opening the app over
  plain `http://` on a LAN IP (rather than `localhost`) will throw on the
  first result.
- `npx tsc --noEmit` fails on a clean checkout with `Cannot find name
  'LayoutProps'`. Next 16 generates route types into the gitignored
  `.next/types/`; run `npx next typegen` first (or any `next build`/`next
  dev`).
