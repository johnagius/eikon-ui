# Sync: narrated word → on-screen change

Every scripted action, measured on the captured frames (Chrome screencast at device scale 4/3, 2560×1440, each frame time-stamped). **Word** = start of the narrated word (faster-whisper small.en word timestamps on the mastered narration; a word after a pause starts at the voice onset). **Press** = when the click/keystroke was sent. **Change** = first captured frame whose target area differs from the frame before the action (> 18 grey levels on ≥ 0.15 % of the area; cursor and click ripple masked out). **Offset** = change − word. Pass: |offset| ≤ 150 ms.

Result: **45/45 within ±150 ms**; worst 122 ms; median 20 ms (absolute).

| Action | Word | Word (s) | Press (s) | Change (s) | Offset (ms) | Capture (ms) | |
|---|---|---|---|---|---|---|---|
| Today: what is left | today (02) | 6.317 | 6.220 | 6.376 | 59 | 59 | ✓ |
| just what needs someone | needs (02) | 7.697 | 7.518 | 7.717 | 20 | 115 | ✓ |
| the fridge: type the lowest, 3.2 | fridge (03) | 9.457 | 9.428 | 9.413 | -44 | -43 | ✓ |
| type the highest, 6.4 | readings (03) | 10.357 | 10.415 | 10.377 | 20 | -72 | ✓ |
| Log (logged) | logged (03) | 11.737 | 11.662 | 11.753 | 16 | 16 | ✓ |
| Registers (side bar) | register (04) | 13.461 | 13.379 | 13.450 | -11 | -11 | ✓ |
| kept | kept (04) | 15.971 | 15.812 | 15.991 | 20 | 87 | ✓ |
| Inspection check | whole (04) | 17.381 | 17.275 | 17.348 | -33 | -129 | ✓ |
| Print inspection pack (one tap) | one (04) | 19.261 | 19.205 | 19.309 | 48 | 48 | ✓ |
| given in parts | parts (05) | 24.612 | 24.515 | 24.656 | 44 | 44 | ✓ |
| Open controlled drugs supplied | remembers (05) | 25.812 | 25.849 | 25.830 | 18 | -123 | ✓ |
| what is left | left (05) | 26.752 | 26.608 | 26.743 | -9 | -40 | ✓ |
| Give the rest | rest (05) | 28.372 | 28.274 | 28.378 | 6 | 6 | ✓ |
| Today (side bar) | closing (06) | 30.824 | 30.550 | 30.844 | 20 | 311 | ✓ |
| Close the day | one (06) | 32.144 | 31.738 | 32.029 | -115 | 34 | ✓ |
| the till counted | counted (06) | 35.084 | 34.980 | 35.076 | -8 | -8 | ✓ |
| the difference in words | words (06) | 36.764 | 36.452 | 36.784 | 20 | 136 | ✓ |
| Save and lock | day (06) | 37.824 | 37.584 | 37.702 | -122 | -116 | ✓ |
| locked (sure) | locked (06) | 38.204 | 38.068 | 38.224 | 20 | 64 | ✓ |
| a second dose, due today | second (07) | 40.991 | 40.779 | 41.011 | 20 | 143 | ✓ |
| Open (Claire) | today (07) | 42.551 | 42.309 | 42.577 | 26 | 26 | ✓ |
| batch | batch (07) | 43.651 | 43.495 | 43.671 | 20 | 89 | ✓ |
| expiry | expiry (07) | 44.291 | 44.015 | 44.241 | -50 | -49 | ✓ |
| all filled in | filled (07) | 45.351 | 45.252 | 45.396 | 45 | 45 | ✓ |
| Save vaccination | saved (07) | 46.576 | 46.415 | 46.596 | 20 | 109 | ✓ |
| Plan shifts | roster (08) | 48.850 | 48.791 | 48.870 | 20 | 76 | ✓ |
| A usual week or rotation | week (08) | 50.890 | 50.735 | 50.910 | 20 | 96 | ✓ |
| Save usual week (once) | once (08) | 51.825 | 51.756 | 51.858 | 33 | 33 | ✓ |
| a whole year | year (08) | 53.490 | 53.342 | 53.485 | -5 | -5 | ✓ |
| Add the shifts (fills in) | in (08) | 54.190 | 54.057 | 54.104 | -86 | -160 | ✓ |
| everyone's shifts (Ryan's new week) | shifts (09) | 56.664 | 56.570 | 56.714 | 50 | 50 | ✓ |
| on their own phone | phone (09) | 58.064 | 57.894 | 58.083 | 19 | -105 | ✓ |
| Customers (side bar) | customers (10) | 59.925 | 59.715 | 59.873 | -52 | -52 | ✓ |
| Cachia Miriam | one (10) | 61.285 | 61.139 | 61.305 | 20 | 94 | ✓ |
| the whole story | story (10) | 62.665 | 62.559 | 62.717 | 52 | 52 | ✓ |
| the loyalty card | card (10) | 64.105 | 63.965 | 64.126 | 21 | 67 | ✓ |
| the distributor's screen | distributor (11) | 67.859 | 67.608 | 67.862 | 3 | 3 | ✓ |
| every order | order (11) | 69.219 | 69.054 | 69.239 | 20 | 99 | ✓ |
| head office's screen | head (11) | 70.139 | 69.697 | 70.034 | -105 | -121 | ✓ |
| each pharmacy, side by side | each (11) | 71.219 | 71.084 | 71.240 | 21 | 66 | ✓ |
| back to the pharmacy's Today | everything (12) | 74.467 | 74.216 | 74.510 | 43 | 43 | ✓ |
| the sign-in page | try (13) | 79.231 | 79.080 | 79.251 | 20 | -80 | ✓ |
| one click | click (13) | 80.561 | 80.616 | 80.581 | 20 | -132 | ✓ |
| no password | password (13) | 81.501 | 81.451 | 81.538 | 37 | -1 | ✓ |
| end card | eikon (13) | 82.081 | 81.842 | 82.122 | 41 | 74 | ✓ |

**Retiming in the edit.** The capture machine is shared, and when it was busy some screen responses came late. The picture (never the voice) was retimed between cue points, the way an editor trims: local playback speed 0.88–1.12×, 26 cue points moved (largest 291 ms). The column *Capture* is the offset as captured, before this.


## Other checks

- **Length:** 85.87 s (captioned 85.87 s); 30 fps, H.264 High, CRF 15; AAC 256 kb/s 48 kHz.
- **Loudness (ffmpeg ebur128 on the delivered files):** -16.0 LUFS integrated, true peak -1.3 dBFS (captioned: -16.0 LUFS).
- **Captions vs audio:** a fresh faster-whisper pass on the finished film against the .srt: 152 caption words, WER 0.0; no differences.
- **Still stretches over 2 s:** none.
- **Errors on screen:** page errors / console errors / dialogs during capture: 0; error wording seen in the page text: 0.
- **Names:** `node agents/demo/names.mjs --check`: passes; every visible text captured (116 screens, the phone, the distributor, head office, the sign-in page and the printed pack included) was scanned for ċ ġ ħ ż outside genuinely Maltese names and places: 0 found.
- **Cursor:** after each press it moves off to rest where nothing can be pressed (18 rests), unless the next move starts first.
- **Actions that ran late** (> 40 ms after their cue): 12 [{'t': 16.681, 'lateBy': 0.108}, {'t': 22.872, 'lateBy': 0.109}, {'t': 29.754, 'lateBy': 0.382}, {'t': 35.674, 'lateBy': 0.081}, {'t': 37.484, 'lateBy': 0.348}, {'t': 40.591, 'lateBy': 0.213}, {'t': 43.251, 'lateBy': 0.262}, {'t': 45.846, 'lateBy': 0.375}, {'t': 48.2, 'lateBy': 0.178}, {'t': 48.92, 'lateBy': 0.266}, {'t': 51.74, 'lateBy': 0.708}, {'t': 79.171, 'lateBy': 0.313}].

## Notes and compromises

- **Takes.** 6–7 Chatterbox takes per sentence, scored as before (UTMOS, timbre similarity to the prompt, Whisper word-perfect, stress and phrase ends); the best word-perfect take was used, except two chosen after a Whisper pass on the whole film: sentence 06 (take 04: in take 05 "At closing time" was heard as "A closing time") and 07 (take 04: take 05's "due today" was heard as "due to day").
- **Wording changed for the ear.** "The rota?" became "The roster?": every take of "rota" was transcribed "rotor" (they sound the same in a British voice). A final "Eikon." on its own came out garbled in all six takes, so the name closes sentence 13 instead ("…no password. ‖‖ Eikon.").
- **Seed.** The busy seed was tidied for a calm, up-to-date pharmacy (old orders handed over, old questions answered, past deliveries delivered, temperatures within limits, October signed off and counted, certificates dated, the locum register complete, pharmacy details saved); then this film's own data: the controlled drug given in part, Miriam's loyalty card, Ryan's usual week, today's end of day counted but not locked, a second pharmacy, a distributor and a head office in the same group, and a separate empty demo group so the sign-in page shows "Try the demo". No problem report was seeded for the distributor (see the app faults below).
- **Error wording.** The printed pack's own legend says "Not checked: the register could not be read when the pack was made" (it explains the word, no register failed); that one legend line is left out of the error-wording scan.
- **Phone, distributor, head office, sign-in page.** Each is a second sign-in on its own local origin, shown in a frame over the desktop (as the Team film's phone).
