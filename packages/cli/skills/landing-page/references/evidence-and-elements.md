# Evidence and element guide

Use this guide to decide what belongs on a SaaS landing page. It turns common
landing-page checklists into an evidence inventory rather than a fixed
wireframe.

## Evidence hierarchy

Prefer evidence in this order:

1. the current product and a working path through it;
2. real product output, screenshot or short demonstration;
3. verified customer behavior or result with a defined source and period;
4. attributable customer testimony with permission;
5. documented capability, policy or operational commitment;
6. founder assertion that is accurate but not independently demonstrated.

Do not present roadmap intent, generated UI, anonymous praise or an undefined
number as stronger evidence than it is.

## Choose evidence by uncertainty

Select the medium that removes the visitor's most important uncertainty with
the least explanation:

- use a real interface or interaction when the product is hard to picture;
- use a real output or before-and-after comparison when result quality is the
  question;
- use a short demonstration or sequence when order and mechanism matter;
- use a diagram when the mechanism is otherwise invisible;
- use source, policy or architecture evidence when trust is the obstacle;
- use plain copy when media would only decorate an already clear claim.

Do not treat a screenshot, terminal, video, animation or diagram as inherently
persuasive. Its value comes from the specific uncertainty it resolves. When a
real product interaction, output or workflow is necessary to understand the
offer, place that evidence in the first viewport or immediately after it.

## Challenge the common anatomy

| Common element | Default decision | Include when | Reject when |
|---|---|---|---|
| Descriptive URL | Conditional | A dedicated page serves a stable search or campaign intent | It requires changing a stable homepage URL or stuffing a keyword |
| Company logo | Usually keep | It establishes identity and links home predictably | It dominates the value proposition |
| Headline and subheadline | Required | They identify the visitor, outcome and mechanism clearly | They optimize for a phrase at the expense of meaning |
| Primary CTA | Required | One realistic next step is available now | Several equally loud actions compete |
| Social proof | Conditional | The proof is real, relevant, current and publishable | Logos, counts or badges are unverified or decorative |
| Image, video or product demonstration | Conditional | Real product evidence reduces uncertainty faster than copy; place it early when the offer is otherwise difficult to understand | It is stock decoration, fake UI, autoplay media or a performance burden |
| Benefits and features | Usually keep | Benefits describe outcomes and features substantiate them | They become an undifferentiated grid or exhaustive catalog |
| Testimonials | Conditional | The speaker, wording, context and permission are verified | The quote is synthetic, anonymous without reason, stale or atypical without context |
| FAQ | Conditional | Real recurring objections remain after the main narrative | It is generic SEO filler or repeats the page |
| Final CTA | Conditional | A longer argument benefits from a clear next step | It repeats a CTA immediately or adds a new competing conversion |
| Contact and legal links | Preserve when real | Existing company, privacy, terms, security or contact destinations apply | The page invents policies, addresses or assurances |

## What common diagrams omit

Always establish:

- the page type and job;
- the page's traffic and arrival intent;
- the primary audience and job;
- the progress sought, current alternative and product mechanism;
- the current offer and commitment after the CTA;
- the CTA destination and whether it works;
- the principal friction before the visitor acts;
- the evidence medium that best explains the mechanism, result or trust case;
- product and proof freshness;
- permission and provenance for public claims;
- pricing or fit constraints that materially affect the decision;
- mobile use, accessibility and page performance;
- release accuracy and the difference between live and planned features;
- the primary conversion that future measurement should use.

## Evidence ledger template

| Element | Status | Repository source | Founder decision needed | Planned use |
|---|---|---|---|---|
| Logo and brand tokens |  |  |  |  |
| Current product visual |  |  |  |  |
| Product interaction, sample output or demo |  |  |  |  |
| Product mechanism |  |  |  |  |
| Customer logos |  |  |  |  |
| Testimonials |  |  |  |  |
| Quantitative claims |  |  |  |  |
| Offer and pricing terms |  |  |  |  |
| Primary CTA destination |  |  |  |  |
| Post-click path and commitment |  |  |  |  |
| Principal friction |  |  |  |  |
| Recurring objections |  |  |  |  |
| Contact and legal links |  |  |  |  |

Allowed statuses are `ready`, `verify`, `missing` and `not_needed`.

For a customer quote, record its original source, exact approved wording,
speaker identity and role, date, permission and the claim it supports. For a
metric, record its definition, population, period, owner and last verification
date.

## Sober design fallback

Use this fallback when the product has no established visual direction, the
founder explicitly wants restraint or the available evidence does not justify
a more expressive treatment. It is not the mandatory aesthetic for every
landing page.

“Sober” means quiet enough that the proposition and proof carry the page:

- low visual complexity;
- recognizable page patterns;
- high information hierarchy;
- restrained palette and motion;
- few simultaneous focal points;
- real product evidence;
- consistent spacing and typography;
- no ornamental component repeated by default.

Sober does not mean unfinished, generic or monochrome. Create character through
typography, proportion, pacing, precise language and the product itself. It
also does not mean text-only: real product media should remain prominent when
it materially improves comprehension or trust.

## Research basis

- Google recommends descriptive URLs, page titles and metadata, semantic HTML,
  accessibility, speed and multi-device compatibility. It does not make a
  primary keyword in every URL a universal landing-page requirement:
  [developer SEO guide](https://developers.google.com/search/docs/fundamentals/get-started-developers)
  and [URL guidance](https://developers.google.com/search/docs/crawling-indexing/url-structure).
- GOV.UK content guidance starts from a user task, uses plain language and
  action-led labels. Its design system recommends one main action rather than
  several competing primary buttons:
  [identify user needs](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/plan-manage-content/identify-user-needs/),
  [plain-language guidance](https://www.gov.uk/government/publications/govuk-content-principles-conventions-and-research-background/govuk-content-principles-conventions-and-research-background)
  and [button guidance](https://design-system.service.gov.uk/components/button/).
- Nielsen Norman Group's web-writing research supports concise, scannable copy
  and meaningful headings:
  [writing for the web](https://www.nngroup.com/articles/be-succinct-writing-for-the-web/)
  and [scanning patterns](https://www.nngroup.com/articles/f-shaped-pattern-reading-web-content/).
- Experimental research found lower visual complexity and familiar category
  patterns produce more positive first impressions:
  [Google Research publication](https://research.google/pubs/the-role-of-visual-complexity-and-prototypicality-regarding-first-impression-of-websites-working-towards-understanding-aesthetic-judgments/).
- WCAG 2.2 requires adequate text contrast, visible keyboard focus and minimum
  pointer target size, and recommends avoiding or disabling unnecessary
  interaction-triggered motion:
  [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum),
  [focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible),
  [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
  and [motion](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions).
- Core Web Vitals define good field performance at the 75th percentile as LCP
  at most 2.5 seconds, INP at most 200 milliseconds and CLS at most 0.1:
  [threshold rationale](https://web.dev/articles/defining-core-web-vitals-thresholds).
- The FTC requires testimonials and endorsements to be truthful and not
  misleading, and treats featured reviews as promotional testimonials:
  [endorsement guidance](https://www.ftc.gov/news-events/topics/truth-advertising/advertisement-endorsements)
  and [reviews and testimonials rule](https://www.ftc.gov/business-guidance/resources/consumer-reviews-testimonials-rule-questions-answers).

Unbounce's benchmark data can provide a comparison point, not a target. Its
2024 dataset reports a 3.8% median SaaS landing-page conversion and strong
variation by source, device and subcategory. A page should therefore name its
own conversion and traffic intent instead of optimizing toward one universal
rate: [SaaS benchmark](https://unbounce.com/conversion-benchmark-report/saas-conversion-rate/).
