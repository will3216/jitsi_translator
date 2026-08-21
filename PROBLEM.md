# The problem

**[project]** is an open-source project built by a distributed group of volunteers working across at least three languages. They talk constantly — in text, through a Matrix channel, which works fine. They also self-host Jitsi for video calls, which they mostly avoid.

The project's lead is a native Spanish speaker who reads and writes English comfortably. Spoken English is the barrier, and *only* spoken English.

That distinction is the whole problem. Writing allows time, re-reading, and a translator open in another tab. A live call allows none of them. So the barrier doesn't fall evenly across the project — it falls entirely on the synchronous layer. The same person who reads and writes English without difficulty can't comfortably follow, or lead, a conversation in it.

## What it costs

A team that works together every day doesn't have meetings available to it. That isn't one person's discomfort — it's an entire communication channel, and everything that channel is good for: fast disagreement, design discussion, ambiguity resolved in minutes instead of threads.

The problem is also invisible to everyone who doesn't have it. Silence on a call is indistinguishable from agreement, and nobody opens an issue to say they couldn't follow a meeting.

## Why nothing existing solves it

Jitsi ships translated captions, but they require Jigasi and a Google Cloud speech contract — infrastructure a self-hosting volunteer project isn't going to stand up. Commercial platforms with captions built in cut against the reason they self-host at all. And every implementation of either translates to a *single* target language for the whole room: with three languages present, one caption track serves at most one person.

The gap is a room where each participant sets their own language and nobody's choice affects anyone else's.

## What this is

A proof of concept, not a product.

The solution the team actually wants is a self-hosted Jitsi instance with translation built in server-side, deployable through Nix alongside the rest of their infrastructure. That's the right end state, and it's weeks of work.

But the riskiest assumption here isn't infrastructure — it's interaction. Nobody knows whether translated captions arriving roughly a second and a half behind the speaker genuinely restore a conversation, or whether they only appear to while real turn-taking, interruption, and people talking over each other fall apart. That question is answerable in a browser in an afternoon, and it should be answered before anyone spends weeks packaging a server.

So this is the smallest thing that answers it: a browser room where each participant picks the language they speak and, independently, the language they read. Those being separate settings is what lets the same room serve someone who wants their own language coming in and someone who'd rather read the original — without either of them configuring anything for anyone else.

Success is deliberately narrow: two people who don't share a language hold a real conversation and both follow it, with the rhythm intact. If that holds, the server-side build is worth the weeks it takes. If it doesn't, that's worth knowing now rather than after.

## Constraints

- Nothing the project has to host, configure, or pay for
- No accounts, no admin action, nothing anyone has to be granted
- A browser and a laptop
- One participant's language choice affects nobody else's experience
- Ships as a Nix flake — the project is NixOS-based, and a thing that doesn't fit their build story doesn't exist to them

---

*Requirements gathered from a contributor on these calls, and from one call of my own with the project's lead.*
