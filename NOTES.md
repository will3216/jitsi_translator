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
- [ ] Unplug or disable the microphone **mid-session**, after permission was
      granted and results were flowing. Expect a growing backoff, not a 0ms
      restart storm. (The existing "deny the mic" item takes the
      `not-allowed` branch and does not cover this.)
- [ ] Speak, stay silent long enough for Chrome to end and re-arm the
      session, then speak again. Confirm `listening` is `true` while results
      flow, not stuck `false`.
- [ ] Change the spoken language **mid-utterance** — while a partial caption
      is on screen, not during silence — and confirm the first caption in
      the new language does **not** replace the old partial.
- [ ] Start speaking, then **go silent mid-sentence** so Chrome ends the
      session before a final arrives, then speak something different.
      Confirm the new sentence appears as its **own** caption rather than
      overwriting the abandoned partial.

## Manual verification — useTransport (Task 7)

Run each and record the result.

- [ ] Close a browser **tab** (not a client-side navigation) and time how long
      the remaining window shows the departed participant. Should disappear
      promptly, not after ~2 minutes.
- [ ] Watch the console during unmount and during a room change for
      `Unhandled promise rejection` from `presence.leave` / `presence.enter`.
- [ ] Run with `ABLY_API_KEY` unset and confirm the failure is visible
      (`connected: false`) rather than a silent empty roster.
- [ ] In dev with Strict Mode, confirm the roster does not show a duplicated
      self entry on first mount.
- [ ] Change speaking language mid-session in one window; confirm the other
      window's roster label updates and no reconnect occurs.

## Open questions

- `crypto.randomUUID` requires a secure context, so opening the app over
  plain `http://` on a LAN IP (rather than `localhost`) will throw on the
  first result.
- `npx tsc --noEmit` fails on a clean checkout with `Cannot find name
  'LayoutProps'`. Next 16 generates route types into the gitignored
  `.next/types/`; run `npx next typegen` first (or any `next build`/`next
  dev`).
