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
