# Spot the Fake

A real-or-AI guessing game. Two photos, or two sentences: one is real, one was made by AI. Pick the fake before the timer runs out.

**Play:** https://tomdacatto.github.io/pollinations-spot-the-fake/ (no sign-in needed)

## How to play

- A game is 10 rounds: 6 photo rounds (15 s each) and 4 sentence rounds (20 s each), easy ones first, then hard.
- Tap the item you think is AI-generated (or press **A** / **B**). Every round then reveals which was which, **a likely giveaway**, and the credit for the real photo or sentence.
- Score: 100 (easy) or 150 (hard) for a hit, plus up to 50 for speed and up to 50 for your streak. A miss or a timeout scores nothing and resets the streak. Your best game is kept in your browser.

## Where the rounds come from

Everything is generated ahead of time, so the game is fully static and anyone can play without signing in. [`tools/build.mjs`](tools/build.mjs) builds [`data/rounds.json`](data/rounds.json) in cached, re-runnable stages:

1. **Real items.** 14 photos from Wikimedia Commons Featured pictures (spiders, frogs, fish, temples, monasteries, California and Bavaria; each keeps its author and licence, see [`data/CREDITS.md`](data/CREDITS.md)) and 8 lead sentences from Wikipedia (CC BY-SA 4.0).
2. **Fair fakes.** Commons descriptions are often just a species or place name, which gives a fake of something else entirely. So a vision model (`google/gemini-3.5-flash-lite`) first describes what is actually in each real photo (subject, pose, setting, framing, lighting, colours), and the fake is generated from that description. Real and fake show the same kind of scene.
3. **Two difficulty tiers.** *Easy* photos use `black-forest-labs/flux.1-schnell`; *hard* photos use the more photorealistic `tongyi-mai/z-image-turbo`. Easy sentences come from a plain "write a sentence about X" prompt; hard ones from a prompt to imitate a Wikipedia opening sentence of the same length (`openai/gpt-5.4-nano`).
4. **What gave it away.** The vision model is shown the real photo next to the fake and asked to name one specific visible difference (extra limbs, mismatched roofs, feet with no shadows). For sentences, a text model compares the two wordings. These are a model's observations, so the game calls them *a likely giveaway*.

Building the whole set cost about 0.1 Pollen. To rebuild it (for example with new photos), run `node tools/build.mjs select`, then `captions`, `fakes`, `tells` (each takes a Pollinations key file) and `assemble`.

## Files

- `game.js`, `game.test.js`: which rounds a game plays, scoring, streaks, grades (`node --test game.test.js`)
- `app.js`, `index.html`, `style.css`: the game
- `tools/build.mjs`: the round builder
- `data/`: `rounds.json`, the images, `picks.json` (the raw picks and captions) and `CREDITS.md`

Code is MIT licensed. The real photos and sentences keep their own licences (attribution and share-alike apply), listed in `data/CREDITS.md`.
