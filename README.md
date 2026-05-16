# RoomPilot

RoomPilot is a hackathon demo for live opportunity conversations: it turns speech into transcript, keeps evidence visible, and suggests the next useful move only when a quote supports it.

Built for `{Tech: Europe} Paris AI Hackathon`, May 16, 2026.

## What It Shows

- A replay-safe live demo path for noisy venue demos.
- OpenAI Realtime for browser microphone transcription.
- OpenAI planner for quote-backed next actions.
- Pioneer / GLiNER2 as a fast quote-action gate, so not every sentence becomes a card.
- A visible proof layer: exact quote, confidence, and what the system is not claiming.
- Speaker labels that can update after self-introductions.

## Run Locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Env

Create `.env.local` from `.env.example`:

```bash
OPENAI_API_KEY=sk-...
PIONEER_API_KEY=pio_sk_...
```

OpenAI is needed for live mic and planner calls. Pioneer is optional for the proof smoke test.

## Useful Commands

```bash
node scripts/pioneer-proof.mjs
```

Runs the Pioneer quote gate against the current stage quote.

## Demo Notes

Audio is not persisted by the app. The stable stage path can run from timed transcript fixtures, while the live path uses microphone input when browser permission and venue audio cooperate.
