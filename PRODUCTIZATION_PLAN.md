# RoomPilot Productization Experiment

This branch keeps the Paris hackathon demo intact, but adds the missing product step:

`user goal -> transcript -> evidence -> action choice -> after-session queue`

## Opinionated Change

RoomPilot should not be a question generator. The live cue should stay light, but the product should decide what kind of next move is appropriate:

- Ask now
- Save the moment
- Compare with memory
- Draft later
- Find public context
- Create a reminder
- Do nothing when proof is weak

## Agent Shape

1. User Goal Agent
   - Internal job: understand what the user is trying to do in this room.
   - UI rule: this is set before listening. It is not presented as transcript-derived.

2. Speaker Intent Agent
   - Internal job: classify what the other person is expressing without using sales language.
   - UI rule: never show this as a floating claim. It must appear through evidence-backed cue copy, action reasons, or after-session actions.

3. Evidence Extractor
   - Internal job: only quote-backed facts enter memory.
   - UI wording: quotes stay visible beside suggestions.
   - Gate rule: do not extract every sentence. Small talk, acknowledgements, and weak context stay quiet.
   - Speed rule: key quotes use a local/Pioneer-style fast path before any slower planner call.

4. Opportunity Planner
   - Internal job: choose the next action type, not just the next question.
   - UI rule: "Possible next moves" appears only after the planner selects a recommended move from quote-backed evidence.

5. Action Orchestrator
   - Internal job: prepare email, public-profile lookup, reminder, or intro draft.
   - Product rule: external tools are after-session and user-confirmed.

## UX Rule

Live conversation should never open Gmail, social media, CRM, or calendar. Live mode can say what should be prepared later. The after-session queue is where integrations appear.

## What This Prototype Tests

- Whether the demo feels less like a sales coach.
- Whether "next action" feels broader than "ask a question."
- Whether email/social steps can appear without feeling intrusive.

## Live Planner

The productized worktree includes `/api/plan-actions`.

Input:

- user goal
- recent transcript lines
- seeded memory quotes

Output:

- whether RoomPilot should act now
- exact evidence quote
- one live cue
- what was not inferred
- selected action type
- visible action palette
- after-session action queue

UI rule:

If `should_act=false`, the product stays quiet. `Possible next moves` only appears after the planner selects a quote-backed move.
