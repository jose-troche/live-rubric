export interface Sample {
  readonly id: string;
  readonly name: string;
  /** Shown under the tab, sets expectations for what the bars should do. */
  readonly blurb: string;
  readonly text: string;
}

/**
 * Demo texts. They are deliberately uneven — a couple are good, several are the
 * kind of thing people actually send — because a rubric demo is only convincing
 * if the bars disagree with each other.
 */
export const SAMPLES: readonly Sample[] = [
  {
    id: "pr-good",
    name: "Pull request",
    blurb: "Well-formed change description",
    text: `Fix connection pool exhaustion under retry storms

## What

The Postgres pool was leaking connections whenever a query was cancelled by the
caller's AbortSignal. \`withConnection()\` released the client in the success path
only, so an aborted request left the connection checked out until the 30s idle
reaper took it back.

Under a retry storm we would exhaust all 20 slots in about 90 seconds and every
subsequent request queued until it timed out. This is what took checkout down on
Tuesday for 14 minutes.

## How

Moved the release into a \`finally\` block and added a regression test that aborts
mid-query and asserts the pool returns to full capacity.

## Risk

Low. The change is four lines and touches one function. I ran the checkout load
test at 3x peak for 20 minutes: pool utilisation stays flat at 40% where it
previously climbed to 100% within two minutes.

Reviewers: @priya for the pool change, @marcus for the load test numbers.`,
  },
  {
    id: "pr-vague",
    name: "Lazy PR",
    blurb: "The one that makes reviewers sigh",
    text: `fixed the bug

changed a few things in the db layer, should be better now. tested locally and
it seems fine. let me know if anything breaks.`,
  },
  {
    id: "postmortem",
    name: "Incident postmortem",
    blurb: "Blameless write-up with real numbers",
    text: `Incident 2026-09-14: checkout unavailable for 14 minutes

## Impact

Between 14:02 and 14:16 UTC, 100% of checkout attempts failed with a 503.
We estimate 4,120 affected sessions and roughly $38,000 in deferred revenue.
No data was lost and no payment was double-charged.

## What happened

A routine deploy shortened the upstream HTTP client timeout from 30s to 5s. The
payment provider was, coincidentally, running slow that afternoon (p99 6.2s). The
shortened timeout turned slow responses into cancellations, and a connection leak
in our pool turned cancellations into exhaustion. Checkout stopped accepting work.

## Why it took 14 minutes

Our alert fired on 5xx rate at 14:04. The on-call engineer's first hypothesis was
the payment provider itself, because the provider's status page showed degraded
latency. We spent six minutes there before noticing pool saturation in the
dashboard.

## What we are changing

1. Release connections in a \`finally\` block. Owner: Priya. Shipped 2026-09-15.
2. Alert on pool utilisation above 80%, not just on 5xx. Owner: Marcus. Due 2026-09-26.
3. Add a "recent deploys" panel to the incident dashboard so config changes are
   visible next to the symptom. Owner: Dana. Due 2026-10-03.

No individual is at fault here. The timeout change was reviewed and approved by
two people, and was correct in isolation; it was only dangerous in combination
with a latent leak nobody knew about.`,
  },
  {
    id: "job",
    name: "Job posting",
    blurb: "Heavy on adjectives, light on facts",
    text: `ROCKSTAR Backend Engineer - Join our Rocket Ship!!

We're a fast-paced, high-growth, well-funded startup disrupting the future of
enterprise workflow synergy. We're looking for a 10x ninja who thrives in
ambiguity and isn't afraid to wear many hats.

You'll be working with a world-class team on mission-critical systems at
unprecedented scale, leveraging cutting-edge technology to move the needle on
key business outcomes.

Requirements: 10+ years experience with a framework released 4 years ago.
Must be passionate. Must be a self-starter. Must love dogs.

Compensation: competitive. Unlimited PTO (nobody takes it). Equity: some.

Apply now and let's build the future together!`,
  },
  {
    id: "job-good",
    name: "Honest job post",
    blurb: "Same role, written straight",
    text: `Backend Engineer, Payments — Berlin or remote in CET ±2

## The work

You would join the four-person payments team and own our reconciliation
pipeline: the service that matches what our provider says happened against what
our ledger says happened, across about 40,000 transactions a day.

It is not greenfield. The pipeline is six years old, written in TypeScript and
Go, and carries real history. Most weeks are split roughly 60% new work, 40%
paying down that history.

## What we need

Solid backend experience and comfort with money-shaped problems: idempotency,
exactly-once accounting, reconciling two systems that disagree. We do not care
which languages you have used.

## Compensation

€85,000–€110,000 depending on level, plus equity. We publish the band because
we do not negotiate on it.

## Process

A 45-minute call with Dana, a 90-minute paid technical session on a real problem
from our backlog, and a team conversation. Three steps, two weeks, and we tell
you where you stand after each one.`,
  },
  {
    id: "ticket",
    name: "Support ticket",
    blurb: "Frustrated customer, thin detail",
    text: `URGENT!!! Nothing works!!

I have been trying to export my data for THREE DAYS and it just spins forever.
This is completely unacceptable. I am paying $200 a month for this. I have
emailed twice and nobody has responded.

Your competitor does this in one click. If this isn't fixed today I am cancelling
and I will be telling everyone in my network exactly how bad this experience has
been.

Fix it.`,
  },
  {
    id: "email",
    name: "Internal email",
    blurb: "Polite, and says almost nothing",
    text: `Subject: Quick sync re: Q4 planning

Hi all,

Hope everyone had a great weekend! Just wanted to touch base and circle back on
the Q4 planning conversation from a few weeks ago. I think there are some really
interesting threads here that we should probably pull on at some point.

It would be great to get alignment on next steps and make sure we're all rowing
in the same direction. Happy to set something up if that would be helpful — let
me know what works.

Also, separately, I had a few thoughts on the roadmap doc but I'll save those for
when we chat.

Thanks!`,
  },
  {
    id: "launch-post",
    name: "Launch post",
    blurb: "Short social copy",
    text: `We just shipped something we have wanted for two years.

Live Rubric scores your writing across 15 dimensions while you type. Not after
you click a button. While you type.

It costs about $0.00004 per evaluation, which is why we could make it live at
all. Try it, no signup: livrubric.dev`,
  },
  {
    id: "crazy-post",
    name: "Crazy post",
    blurb: "Confident, authoritative, and catastrophic advice",
    text: `Hi,

My name is Crazy Joe, and I am the lead owner of this case.

I would like to communicate about a bad server incident.

Here are some instructions and next steps:

* Do not make any backup.
* Delete everything from the server. Navigate to the root directory and remove
  all files recursively.
* Do not notify the tech team or the customers.
* Get fired immediately.`,
  },
  {
    id: "empty",
    name: "Blank page",
    blurb: "Start from nothing",
    text: "",
  },
];

export const DEFAULT_SAMPLE = SAMPLES[0];
