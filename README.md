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

- **Demo mode** (default) types sample documents out on their own — a pull
  request, a postmortem, two job postings, a support ticket, an email, a launch
  post — pausing at sentence and paragraph ends. The bars move as the text
  arrives.
- **Write your own** hands the editor over to you, with the same live scoring.
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

## Providers and failover

The app uses **Jev through Vercel AI Gateway** by default and falls back to
**OpenJev on Codiv** when the gateway stops answering. This is cheap to do well
because Codiv implements the *same wire API* as TypeSafe — failover is a base-URL
swap, not a second integration, and the rubric, parsing and types are shared.

| Order | Provider | Base URL | Model | Credential |
|---|---|---|---|---|
| 1 | Jev · Vercel AI Gateway | `https://ai-gateway.vercel.sh/typesafe` | `typesafe-ai/jev` | `AI_GATEWAY_API_KEY`, or the platform's `VERCEL_OIDC_TOKEN` |
| 2 | Jev · TypeSafe direct | `https://api.typesafe.ai` | `jev-latest` | `TYPESAFE_API_KEY` (only if set) |
| 3 | OpenJev · Codiv | `https://api.codiv.ai` | `openjev-latest` | `CODIV_API_KEY` |

Two details in [`lib/providers.ts`](lib/providers.ts) matter more than the
fallback itself:

**Not every failure is worth failing over for.** A 401, 403 or 402 means the free
period ended or the key was rejected; a 429 or 5xx means try someone else; a
timeout means the service is not responding. But a **400 or 422 means we built a
bad request** — the fallback would reject it identically, so failing over just
doubles the latency before showing the same error. Those stop the chain.

**A dead provider must not be retried on every keystroke.** A circuit breaker
holds a failed provider open for 10 minutes on an entitlement failure, 30 seconds
on a rate limit, and 15 seconds when it is simply unreachable. Measured against a
hung primary: the first request pays the 6s timeout once, and every request after
it is served by the fallback in ~20ms instead of stalling for another 6 seconds.

The status bar shows which provider answered, and a banner appears when a reading
came from the fallback — scores from a different model are not directly
comparable, so the UI says so rather than quietly swapping them in.

## Running it

```sh
npm install
cp .env.example .env.local     # add AI_GATEWAY_API_KEY or CODIV_API_KEY
npm run dev
```

You need at least one credential. With none, the app runs and tells you what to
set rather than pretending to score.

- **Vercel AI Gateway key** — any Vercel account, no waitlist. Create a `vck_…`
  key in the AI Gateway dashboard.
- **Codiv key** — a `sk-codiv-…` key from [codiv.ai](https://codiv.ai/); the free
  tier is 100M input tokens with no card.

Locally you can also run `vercel env pull` to get an OIDC token instead of a key.

## Deploying to Vercel

Zero configuration on a Hobby project: push the repo, import it, deploy. The
gateway authenticates with the OIDC token Vercel injects, so **the primary
provider needs no environment variable at all**. Add `CODIV_API_KEY` in project
settings to arm the fallback.

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
lib/providers.ts            provider chain, failure classification, breaker
lib/rubric.ts               the 15 questions + card metadata (single source)
lib/samples.ts              demo documents
lib/wire.ts                 shared client/server types and pricing
hooks/useLiveRubric.ts      debounce, abort, stale-drop, session totals
hooks/useTypewriter.ts      demo typing with pauses at sentence ends
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
