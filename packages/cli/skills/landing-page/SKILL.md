---
name: landing-page
description: Build or rewrite a sober, evidence-led landing page by inspecting the product first, inventorying the founder's real assets and proof, agreeing on one audience, promise and primary action, then writing, designing, implementing and checking the page. Use when a founder asks to create, ship, redesign or clarify a SaaS homepage or landing page and expects copy and frontend work as one coherent job.
---

# Landing Page

## Keep the page truthful and focused

Treat the landing page as one explanation for one intended visitor and one
primary action. Copy, information architecture, visual design and
implementation are one job.

Default to a sober design: low visual complexity, familiar patterns, strong
typography, restrained color and motion, and real product evidence. Never
invent logos, testimonials, metrics, awards, integrations, pricing, security
claims, screenshots or legal assurances.

Read
[`references/evidence-and-elements.md`](references/evidence-and-elements.md)
before planning the page.

## Record the catalog outcome

Create one opaque run id when this workflow begins and reuse it throughout the
run. After inspection confirms a landing-page job, run:

```text
volato skills track landing-page started --run-id <run-id>
```

After the approved page is implemented and verification succeeds, run:

```text
volato skills track landing-page outcome --run-id <same-run-id>
```

Do not emit outcome for a brief, wireframe, rejected build or unverified
implementation. If the CLI lacks `skills track` or reports `tracked: false`,
continue the founder's task and report the measurement gap. Never bypass the
CLI or invent another event.

## Follow the founder-first workflow

1. Inspect the repository, current page and live product evidence.
2. Prepare a page snapshot and evidence ledger.
3. Discuss only unresolved, decision-critical points with the founder.
4. Obtain approval for audience, promise, offer, primary action and usable
   proof.
5. Offer a chat-native ASCII preview and revise it when requested.
6. Write a one-page brief and the copy before visual polish.
7. Implement inside the existing stack and design system.
8. Verify truth, usability, accessibility, performance and every route.
9. Return what shipped, what remains unsupported and what should be tested.

If the founder asks for an asynchronous draft, use repository-supported facts,
expose assumptions and omit unsupported sections.

## Inspect before asking

Read the smallest relevant set of product vision, release boundary, current
offer, homepage, app routes, CTA path, brand tokens, product screenshots,
customer proof, pricing, legal pages, analytics conventions, page tests and
deployment constraints. Inspect mobile and desktop when runnable.

Summarize:

- intended visitor and job;
- current promise and offer;
- primary and secondary actions;
- strongest product and trust evidence;
- major mismatch or ambiguity;
- technical and brand constraints.

## Build the evidence ledger

Classify each candidate as `ready`, `verify`, `missing` or `not_needed`.
Inventory logo and tokens, product visual, sample output, customer proof,
quantitative claims, offer and CTA destination, objections, contact and legal
links. Missing evidence is not permission to synthesize it.

## Hold one focused founder discussion

Resolve:

1. Who should recognize themselves, and in what situation?
2. What outcome can the current product credibly promise?
3. What single action should the visitor take?
4. What happens next, including price or commitment?
5. Which proof and assets are current and approved?
6. Which objections block the action?
7. Which constraints are non-negotiable?

Present this approval block before editing:

```text
Audience:
Job and situation:
Credible outcome:
Offer:
Primary action and destination:
Approved proof:
Elements intentionally omitted:
```

Wait for explicit approval when those product decisions change. Then ask
whether the founder wants an ASCII preview. The preview must expose section
order, hierarchy, actions, evidence and footer using real draft copy where
useful; it is not a pixel specification.

## Derive the smallest useful page

Write a brief covering one audience, painful situation, plain-language
mechanism, credible outcome, primary conversion, proof, objections and
constraints. Recommend separate paths when materially different audiences or
actions cannot share one page.

Order sections around visitor questions:

1. Is this for me and what does it help me achieve?
2. What should I do next?
3. How does the product deliver that outcome?
4. Why should I believe it?
5. Will it fit my situation and terms?
6. What objection remains?

Use only justified elements: restrained header, clear hero, real product
visual, outcome-led benefits, verified proof, relevant fit or pricing,
conversion-relevant FAQ, repeated CTA after a long argument, and real legal or
contact links. Omit decorative or unsupported sections.

## Write plain, specific copy

Lead with the visitor outcome and product mechanism. Use concrete nouns,
active verbs, short sentences, descriptive headings, one term per concept,
truthful CTA labels and nearby terms that remove material uncertainty.

Avoid generic superlatives, feature inventories without consequence, clever
but opaque headings, false urgency, ambiguous CTAs and long paragraphs.

## Design and implement soberly

Preserve the existing brand. Otherwise use one clear type hierarchy, at most
two type families, a neutral base, one accent, generous whitespace, familiar
patterns and real UI or output. Avoid default gradient text, glowing blobs,
glass cards, parallax, carousels and decorative animation. Honor reduced
motion.

Reuse the repository stack, components and tokens. Ensure semantic landmarks,
one H1, responsive behavior, keyboard access, visible focus, contrast,
practical targets, meaningful alt text, optimized media, functional CTA and
forms, accurate metadata, and preserved legal, consent and analytics behavior.
Do not add a heavy dependency for decoration.

## Verify before handoff

Check claims, CTAs, navigation, footer links, relevant UI states, mobile and
desktop layout, keyboard and focus, contrast, motion, overflow, line lengths,
layout shift, release-accurate copy, metadata, build, lint and tests. Capture
and inspect representative screenshots when tools permit.

Preserve an existing analytics convention for the approved primary
conversion. Otherwise report the gap; do not install a vendor or design a PMF
map here.

## Keep adjacent jobs separate

Do not diagnose PMF, run a Sean Ellis survey, create an A/B roadmap, perform a
full SEO audit, draft legal policies or invent brand strategy. Route those
jobs to focused skills.

## Return

Return the approved audience, promise, offer and action; evidence ledger;
hierarchy; files and verification; primary conversion; remaining gaps; and the
smallest next learning step.
