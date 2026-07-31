---
name: landing-page
description: Build or rewrite an evidence-led landing page by inspecting the product first, qualifying the page's job and arrival intent, inventorying the founder's real assets and proof, agreeing on one audience, page argument and primary action, then writing, designing, implementing and checking the page. Use when a founder asks to create, ship, redesign or clarify a SaaS homepage or landing page and expects positioning, copy and frontend work as one coherent job.
---

# Landing Page

## Keep the page truthful and focused

Treat the landing page as one product explanation for one intended visitor and
one primary action. Copywriting, information architecture, visual design and
implementation are parts of that job, not separate handoffs.

Choose the visual direction only after the page job, argument and available
evidence are clear. Preserve an established brand when it exists. Use the
sober baseline in the reference as a fallback when the product and founder do
not justify a stronger direction, not as a universal aesthetic. Do not mistake
restraint for an absence of product demonstration, decorate a weak
proposition or manufacture missing credibility.

Never invent customer logos, testimonials, metrics, awards, integrations,
pricing, security claims, product screens or legal assurances. A plausible
claim is still unverified. Omit it, label it as a draft outside the published
page, or ask the founder for evidence.

Read [`references/evidence-and-elements.md`](references/evidence-and-elements.md)
before planning the page.

## Record the catalog outcome

Create one opaque run id when this workflow begins and reuse it through the
same run. After inspection confirms that the request is a landing-page job,
run:

```text
volato skills track landing-page started --run-id <run-id>
```

After the approved page is implemented and the verification step succeeds,
run:

```text
volato skills track landing-page outcome --run-id <same-run-id>
```

Do not emit outcome for a brief, wireframe, rejected build or unverified
implementation. If the installed CLI lacks `skills track` or delivery reports
`tracked: false`, continue the founder's task and report the measurement gap.
Do not call an undocumented route or invent another event.

## Follow the founder-first workflow

Use this sequence:

1. inspect the repository, current page and live product evidence;
2. qualify the page job, arrival intent and post-click path, then prepare a
   page snapshot and an evidence ledger;
3. discuss only unresolved, decision-critical points with the founder;
4. obtain approval for the audience, situation, desired progress, current
   alternative, product mechanism, credible promise, offer, primary action
   and usable proof;
5. choose the evidence medium and visual direction that best explain and
   support the approved argument;
6. offer a chat-native ASCII preview of the page hierarchy and revise it with
   the founder when requested;
7. write a one-page brief and propose the page hierarchy;
8. write the copy before polishing the visual composition;
9. implement inside the existing stack and design system;
10. verify truth, comprehension, trust, usability, accessibility, performance
    and every route;
11. return what shipped, what remains unsupported and what should be tested.

Do not skip founder alignment because a generic SaaS template looks
reasonable. If the founder explicitly asks for an asynchronous draft, proceed
with repo-supported facts, expose assumptions in the handoff and leave
unsupported sections out of the page.

## Inspect before asking

Read the smallest relevant set of:

- product vision, positioning, release boundary and current offer;
- the page's role, likely traffic sources, visitor awareness and distribution
  model;
- existing homepage, app routes and the actual signup, trial, demo or contact
  path, including what happens after the first click;
- brand tokens, logo files, fonts and reusable components;
- current product interactions, outputs, screenshots, recordings, docs and
  examples;
- customer proof, case studies, quotes and metrics, including their source;
- pricing, security, privacy, terms and contact pages;
- existing analytics conventions and page tests;
- framework, rendering mode and deployment constraints.

Open the current page at mobile and desktop widths when a runnable build is
available. Distinguish what the product currently does from roadmap language.
Do not silently turn future functionality into present-tense copy.

Summarize the inspection as:

- page type, arrival intent, intended visitor and job;
- desired progress, current alternative and product mechanism;
- current promise and offer;
- current primary and secondary actions;
- post-click path and material commitment;
- strongest product evidence and the medium that explains it best;
- strongest verified trust evidence;
- principal friction, mismatch or ambiguity;
- technical and brand constraints.

## Build the evidence ledger

Classify every candidate element as:

- `ready`: current, relevant, publishable and verified;
- `verify`: found, but freshness, accuracy or permission needs founder review;
- `missing`: useful to the argument, but absent;
- `not_needed`: does not answer a real visitor question on this page.

Inventory at least:

- logo and brand tokens;
- product screenshots, demo, video and sample output;
- customer logos and permission to use them;
- testimonials with speaker, role, source and permission;
- quantitative claims with definition, period and source;
- offer, pricing, trial terms and CTA destination;
- common objections and real support questions;
- contact, privacy, terms and security links.

An empty evidence category is not an instruction to synthesize it.

## Hold one focused founder discussion

Show the inspection summary and evidence ledger first. Ask only what the
repository cannot establish. Resolve these decisions:

1. What job must this page perform, for which arrival context?
2. Who should recognize themselves immediately, in what situation, and what
   progress are they seeking?
3. What alternative do they use now, and by what mechanism does the product
   create a different result?
4. What valuable outcome can the current product credibly promise?
5. What single action should that visitor take now?
6. What exactly happens after that action, including effort, access, price or
   commitment?
7. Which proof and product assets are current and approved for publication,
   and which medium explains the mechanism or result most clearly?
8. What principal friction or remaining objection makes the action difficult?
9. Which brand, legal, technical or release constraints are non-negotiable?

Batch related questions. Do not make the founder complete a long marketing
questionnaire when the answer is already in the repository.

Before editing the page, present a compact approval block:

```text
Page type and arrival intent:
Audience:
Job and situation:
Desired progress:
Current alternative:
Product mechanism:
Credible promise:
Offer:
Primary action and destination:
Post-click path and commitment:
Approved proof:
Principal friction:
Elements intentionally omitted:
```

Wait for explicit approval when changing any of those product decisions. Small
copy and implementation details do not require repeated approval.

When more than one page argument remains plausible, present at most three
candidate angles. For each, name the lead idea, supporting mechanism, strongest
evidence and main tradeoff. Ask the founder to choose or revise one. Do not
write the hero or let the product's implementation surface choose the
positioning before the page argument is approved.

After the approval block, ask whether the founder wants an ASCII preview in
the chat before copywriting or implementation. When accepted, draw a compact
wireframe that exposes section order, information hierarchy, primary and
secondary actions, product evidence and the footer. Use real draft copy where
it helps evaluate the proposition, distinguish unavailable proof from planned
content, and revise the structure in conversation. Treat the ASCII preview as
an alignment artifact, not a pixel-level UI specification.

## Write the page brief

The brief must name:

- the page type, arrival intent and job;
- one primary audience and situation;
- the painful or costly current situation;
- the current alternative and why it remains insufficient;
- the product's mechanism in plain language;
- the credible outcome, without unsupported superlatives;
- one primary conversion and its destination;
- the post-click path and material commitment;
- the minimum proof required to believe the promise;
- the evidence medium that removes the most important uncertainty;
- the principal friction and remaining objections to resolve;
- known constraints and non-goals.

If the page must serve materially different audiences or actions, say so.
Recommend separate paths or pages instead of forcing incompatible messages
into one hero.

## Derive the hierarchy from visitor questions

Do not use a fixed eleven-section template. Use the smallest sequence that
answers these questions in an order derived from the visitor's arrival intent:

1. Is this situation for me and what progress does the page offer?
2. What is the product and by what mechanism does it create that progress?
3. How is it meaningfully different from what I do now?
4. Why should I believe it?
5. What should I do next and what happens after I act?
6. Will it fit my situation, what are the terms and what friction remains?

Do not impose one hero formula. Depending on the approved argument and arrival
intent, the first viewport may lead with an outcome, situation, mechanism,
proof or product experience. It must still make the audience, promised
progress and next action understandable without relying on cleverness.

A common page may contain:

- a clear header and identity;
- a hero expression of the approved argument, supporting explanation and
  primary CTA;
- real product visual, sample output or short demonstration;
- outcome-led benefits supported by concrete capabilities;
- verified proof near the claim it supports;
- pricing, process or fit information when it changes the decision;
- FAQ only for recurring, conversion-relevant objections;
- repeated CTA after a long argument when useful;
- footer with real contact, company and existing legal links.

Omit video, logo walls, testimonials, metrics, FAQ or a final CTA when the
ledger does not justify them. Prefer one strong proof item to a wall of weak
signals.

Choose product media by the uncertainty it removes, not by format or fashion.
Use a real interface, interaction, output, workflow, comparison or diagram
when it makes the mechanism, result or trust case clearer than copy alone. If
the product cannot be understood credibly without such evidence, place it in
the first viewport or immediately after it. If no honest asset exists, report
the comprehension risk instead of fabricating a screen or adding decorative
media.

## Write plain, specific copy

Write from the approved page argument. Make the visitor's desired progress and
the product mechanism concrete early, even when the first viewport leads with
a situation, proof or product experience. The headline should help the
intended visitor self-select; it is not a container for keyword stuffing. Use
the audience's language when research or product evidence supports it.

Use:

- concrete nouns and active verbs;
- short sentences and scannable, descriptive headings;
- outcomes first, with features as supporting evidence;
- one term for each important concept;
- CTA labels that describe the actual next action;
- nearby terms that remove material uncertainty, such as trial length,
  required card, setup time or sales contact.

Avoid:

- generic claims such as “revolutionize”, “seamless” or “next-generation”;
- claims that could fit any SaaS;
- feature inventories without a user consequence;
- clever headings that hide the section's meaning;
- false urgency, fake scarcity or ambiguous CTA labels;
- long paragraphs written to sound comprehensive.

Keep title, description, H1 and URL descriptive. Use a search phrase in the URL
only when it naturally describes a dedicated search landing page; do not
change a stable homepage URL to satisfy a checklist.

## Choose a deliberate visual direction

Preserve a coherent existing brand system when it exists. Otherwise derive a
direction from the subject, audience, approved argument and strongest product
evidence. State the intended visual character and one memorable compositional
idea before implementation. If the founder does not want visual exploration
or the evidence does not support a stronger direction, use the sober baseline
from the reference.

Whatever direction is selected, use:

- one clear typographic hierarchy and at most two type families;
- a coherent palette with sufficient contrast;
- intentional density, whitespace and content width;
- recognizable interaction and navigation patterns;
- borders, radii and shadows only when they communicate grouping or state;
- one dominant visual idea per viewport;
- real UI, output or workflow evidence over abstract decoration.

Do not default to gradient text, glowing blobs, floating glass cards, repeated
rounded containers, parallax, auto-advancing carousels or animated entrances
for every section. Motion must explain change or provide feedback, remain
subtle and honor reduced-motion preferences.

The page may be distinctive through typography, composition, language and
product evidence without becoming visually loud. A sober page may still be
rich in explanatory media; a visually ambitious page must still make the
argument and evidence easier to understand.

## Implement within the product

Reuse the repository's framework, components, tokens and conventions. Do not
replace a working stack or introduce a second design system for one page.

Ensure:

- semantic landmarks and a logical heading hierarchy;
- one visible H1;
- responsive behavior from narrow mobile to wide desktop;
- keyboard access and visible focus;
- sufficient color contrast and practical pointer targets;
- meaningful alternative text for informative images;
- explicit image dimensions and responsive, optimized media;
- no autoplay audio and controllable non-essential moving content;
- the primary CTA works and reaches the approved destination;
- forms expose labels, errors, success states and submission behavior;
- metadata is accurate and social preview assets exist when required;
- existing legal, consent and analytics behavior is preserved.

Treat performance as part of the design. Avoid shipping a heavy video,
animation library or third-party script without a decision-critical reason.

If the repository already has an approved analytics convention, preserve it
and instrument the approved primary conversion consistently. Otherwise report
the measurement gap; do not install a vendor or design a PMF event map as part
of this skill.

## Verify before handoff

Check:

- every visible claim against the evidence ledger;
- every CTA, navigation item and footer link;
- the rendered first viewport passes a five-second comprehension review: the
  intended visitor, offered progress and next action are legible;
- the principal friction and material post-click commitment are answered
  before the visitor must accept them;
- the chosen product evidence loads correctly and clarifies the mechanism,
  result or trust case it was selected to support;
- loading, empty, validation, success and failure states where applicable;
- mobile and desktop layout with real content;
- keyboard navigation, focus visibility, contrast and reduced motion;
- overflow, clipping, unreadable line lengths and layout shift;
- current product screenshots and release-accurate copy;
- page title, description, canonical URL and indexability intent;
- build, lint and relevant tests;
- no regression to application routes or existing instrumentation.

When tools are available, capture a screenshot at representative mobile and
desktop sizes and inspect the rendered result rather than trusting source code
alone.

## Keep adjacent jobs separate

This skill can name a primary conversion and preserve existing tracking, but
it does not:

- diagnose behavioral PMF or define product event maps;
- run a Sean Ellis survey or customer-validation program;
- create an A/B testing roadmap;
- perform a full technical SEO audit;
- draft legal policies or certify regulatory compliance;
- invent a brand strategy for a company that has not chosen one.

Route those jobs to focused skills when the founder asks for them.

## Return

Provide:

1. the approved page job, audience, argument, offer and primary action;
2. the evidence ledger, including omitted and still-unverified elements;
3. the final page hierarchy, evidence medium and visual direction, with the
   reasoning behind conditional sections;
4. files changed and verification performed;
5. the primary conversion named for future measurement;
6. remaining content, proof, legal, analytics or product gaps;
7. the smallest next learning step, without starting dogfooding or an
   experiment unless requested.
