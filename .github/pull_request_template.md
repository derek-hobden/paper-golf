<!-- CI drops the explainer video link here once the Claude review passes. Leave this line and the --- below it alone. -->

---

## Summary

<!-- What changed, and why. One short paragraph. -->

## How to see it

<!--
A few plain steps that show the change working. CI films these for the
explainer video, so write them as things to do, one per line:
  - open /?play=0&players=1&hole=1
  - click Roll
  - take a shot
  - expect Strokes 1
Anything else becomes a pause the narration talks over, and a step CI cannot
follow never fails this pull request. This section is required: a ready pull
request without a step here fails the pr-video check. A change with no screen
still writes steps (open this pull request and read the blockers comment).
AGENTS.md "PR explainer videos".
The video is tied to the head commit: after it, only docs-only commits (*.md
anywhere, or under docs/; not AGENTS.md, CLAUDE.md, REVIEW.md, .github/ or
.claude/, which steer the agents) and clean merges of main keep it. Any other push
needs a new one, so mark the pull request ready again, or add the `ready`
label, once the code is done.
The video standard: a UI change keeps the screen recording of these steps; a
concept, logic, data or CI change with nothing to screen-record gets an
illustrated motion explainer (animated diagrams and flows: before and after,
data moving through the steps), narrated in the Kore voice.
Never a voice narrating over text, code or JSON.
-->

-

## Spec

<!--
The original request, in the requester's words, then the done-criteria.
The review leaves a BLOCKING comment for a bug, a security issue, failing
behaviour, or a broken repo rule (including a missing ## Spec section). A
finding outside this spec, and a description that is out of date, are notes.
This section is also the video's opening: once the review passes, the
narration starts with the intent read from here. Keep it plain.
-->

**Request**

**Done when**

-

## Checklist

- [ ] `npm run check` and `npm run smoke` pass on this branch
- [ ] `## Spec` and `## How to see it` are filled in
- [ ] Marked ready for review when it is finished (that runs the review; the video follows once a review passes)
- [ ] If the review asked for changes: fixed what its Problems found comment lists, and pushed (that starts the next round)
