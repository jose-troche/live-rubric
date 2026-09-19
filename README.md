# Live Rubric

An editor that re-scores **15 rubric dimensions on every typing pause**, using
[TypeSafe's Jev](https://docs.typesafe.ai/) System One model. One HTTP request
per pause, all fifteen questions answered in parallel inside it, for roughly
**$0.000004 each**.

That price is the entire point. Calling a GPT-class chat model on every
keystroke-pause for fifteen dimensions would be absurd — about 60× the cost, with
latency that makes "live" impossible and no guarantee the JSON parses. Jev
returns typed values, so an invalid answer is not something the app has to
handle.

## What it does

- **Demo mode** (default) opens on a **random** sample document — a pull request,
  a postmortem, two job postings, a support ticket, an email, a launch post — and
  types it out, pausing at sentence and paragraph ends. The bars move as the text
  arrives.
- **The run stops when the document is finished**, and the demo stays there so
  the final scores can actually be read. It does not rotate on to the next sample
  by itself. Clicking any sample starts a fresh run of that document — including
  the one already on screen, which replays it.
- **Write your own** hands the editor over to you with a **blank** page and the
  same live scoring. Clicking a sample in this mode loads its text to edit.
- Every dimension is drawn as a compact chart, and all fifteen fit on one screen.

## The three question types

The rubric is built to exercise everything Jev supports, because each type
answers a different shape of question:

| Type | Dimensions | Returns | Drawn as |
|---|---|---|---|
| **score** | Clarity, Specificity, Structure, Actionability, Completeness, Concision | an expected value that can land *between* rubric levels, plus the level legend | a meter with hairline level ticks |
| **choice** | Document type, Tone, Audience, Readiness, Risk | the winning label, a confidence, and a probability per label | ranked option bars, winner at full strength |
| **noul** | States next steps, Names an owner, Jargon-heavy, Evidence-backed | the raw probability the statement is true | a probability bar with the 50% line marked |

All fifteen live in [`lib/rubric.ts`](lib/rubric.ts) as one object, sent as one
`systemOne` call. A module-load assertion fails the build if the question set and
the card metadata ever drift apart.

## Provider

The app runs on **OpenJev via Codiv**, which implements the same wire API as
TypeSafe, so the rubric, the parsing and the types are all shared with Jev
proper.

| Provider | Base URL | Model | Credential |
|---|---|---|---|
| OpenJev · Codiv | `https://api.codiv.ai` | `openjev-latest` | `CODIV_API_KEY` |

Vercel AI Gateway used to sit in front of this as the primary. It was removed
because the gateway will not service a request without a credit card on file: it
answers `GET /v1/models` normally and then returns `403
customer_verification_required` on every actual evaluation, so its "free credit"
cannot be reached without a card. Codiv's free tier is 100M input tokens and
needs none.

Two details in [`lib/providers.ts`](lib/providers.ts) survive that removal:

**Failures are classified, not merely counted.** A 401, 402 or 403 means the key
was rejected or the credit ran out; a 429 or 5xx means try again shortly; a
timeout means the service is not responding. A **400 or 422 means we built a bad
request** — waiting will not fix it and the provider is not what is broken, so it
does not count against the provider at all.

**A dead provider must not be retried on every keystroke.** A circuit breaker
holds it open for 60 seconds after a rejected key, 30 seconds on a rate limit and
15 seconds when it is simply unreachable, so a typing pause costs ~1ms instead of
a 9s timeout while the provider is down. The breaker records *why* it opened, and
the error surfaced in the UI repeats that original cause along with the time
left — "cooling down after entitlement" names a category, but the 403 body
underneath it is the part you can act on.

## Running it

```sh
npm install
cp .env.example .env.local     # add CODIV_API_KEY
npm run dev
```

You need a `sk-codiv-…` key from [codiv.ai](https://codiv.ai/) — the free tier is
100M input tokens and takes no card. Without it the app still runs and tells you
what to set rather than pretending to score.

## Deploying to Vercel

Push the repo, import it, deploy, and set `CODIV_API_KEY` in project settings.
That is the only variable the app needs.

The API route runs on the Node runtime (`app/api/evaluate/route.ts`) because the
key must never reach the browser — the TypeSafe SDK refuses browser use unless
you explicitly opt in, and this app does not.

## Request scheduling

Firing on "every typing pause" naively means firing on every keystroke. The
client ([`hooks/useLiveRubric.ts`](hooks/useLiveRubric.ts)) instead:

- debounces 400ms after the last edit, but never waits more than 1.4s while
  someone is still typing, so the bars keep moving during continuous prose;
- aborts the in-flight request when new text supersedes it, and drops any
  response whose sequence number is stale, since aborts are best-effort;
- skips text identical to what was last scored, and anything under 12 characters;
- keeps the previous reading on screen when a request fails, rather than blanking
  the rubric mid-demo.

## Charts

Colour encodes **question type** — blue for score, orange for choice, aqua for
noul — using three slots of a validated categorical palette. Within a card there
is only ever one series, so magnitude is a single hue against a lighter step of
itself; nothing is rainbow-coded, and no value is ever carried by colour alone.
The palette passes the colourblind-separation, lightness, chroma and contrast
checks in both light and dark mode at `--pairs all`. Light-mode aqua sits just
under 3:1 against the surface, so every card carries a visible numeric label.

## Layout of the code

```
app/api/evaluate/route.ts   HTTP boundary: validation, pricing, error mapping
lib/providers.ts            provider config, failure classification, breaker
lib/rubric.ts               the 15 questions + card metadata (single source)
lib/samples.ts              demo documents
lib/wire.ts                 shared client/server types and pricing
hooks/useLiveRubric.ts      debounce, abort, stale-drop, session totals
hooks/useTypewriter.ts      demo typing with pauses at sentence ends, stops at the end
components/Charts.tsx       the three chart forms
```

## Costs

Jev bills `$0.042` per 1M input tokens and nothing for output. A ~600-character
document is about 150 input tokens, so one full 15-dimension evaluation costs
around **$0.000006**. A demo session that scores 15 times spends under a
hundredth of a cent. The status bar prices the same token traffic at GPT-class
input rates alongside it — a lower bound, since it charges nothing for the JSON a
chat model would have to generate, and ignores that a chat model cannot answer
fifteen questions in one pass at all.
