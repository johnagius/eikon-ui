# Sync: narrated word → on-screen change

Every scripted action, measured on the captured frames (Chrome screencast at device scale 4/3, 2560×1440, each frame time-stamped). **Word** = start of the narrated word (faster-whisper small.en word timestamps on the mastered narration; a word after a pause starts at the voice onset). **Press** = when the click/keystroke was sent. **Change** = first captured frame whose target area differs from the frame before the action (> 18 grey levels on ≥ 0.15 % of the area; cursor and click ripple masked out). **Offset** = change − word. Pass: |offset| ≤ 150 ms.

Result: **33/33 within ±150 ms**; worst 65 ms; median 20 ms (absolute).

| Action | Word | Word (s) | Press (s) | Change (s) | Offset (ms) | Capture (ms) | |
|---|---|---|---|---|---|---|---|
| Services (side bar) | today's (02) | 6.519 | 6.438 | 6.545 | 26 | 26 | ✓ |
| who is waiting | waiting (02) | 8.199 | 8.045 | 8.219 | 20 | 85 | ✓ |
| what is due | due (02) | 9.739 | 9.582 | 9.759 | 20 | 77 | ✓ |
| New test | new (03) | 11.307 | 11.189 | 11.327 | 20 | -75 | ✓ |
| fills in the rest | rest (03) | 14.587 | 14.448 | 14.607 | 20 | 68 | ✓ |
| type 136 | type (04) | 16.251 | 16.314 | 16.271 | 20 | 136 | ✓ |
| the result, in words | words (04) | 18.821 | 18.717 | 18.847 | 26 | 26 | ✓ |
| against last time | last (04) | 20.061 | 19.964 | 20.105 | 44 | 44 | ✓ |
| Save test | save (05) | 22.700 | 22.500 | 22.652 | -48 | -48 | ✓ |
| the trend | trend (05) | 23.855 | 23.762 | 23.891 | 36 | 36 | ✓ |
| Vaccines | second (06) | 28.123 | 28.156 | 28.143 | 20 | -76 | ✓ |
| due today | today (06) | 29.303 | 29.178 | 29.329 | 26 | 72 | ✓ |
| Record the dose | record (06) | 30.693 | 30.599 | 30.693 | 0 | -117 | ✓ |
| it's filled in | filled (06) | 32.283 | 32.147 | 32.303 | 20 | 76 | ✓ |
| batch and all | batch (06) | 33.243 | 33.058 | 33.263 | 20 | 115 | ✓ |
| the arm | arm (07) | 35.505 | 35.451 | 35.541 | 36 | 36 | ✓ |
| the next dose | next (07) | 36.265 | 36.267 | 36.281 | 16 | 16 | ✓ |
| consent: the patient | consent (07) | 37.085 | 37.000 | 37.105 | 20 | 63 | ✓ |
| Save vaccination | saved (07) | 38.205 | 37.998 | 38.205 | 0 | 0 | ✓ |
| off the list | list (07) | 39.605 | 39.507 | 39.655 | 50 | 50 | ✓ |
| a reaction after a flu jab | reaction (08) | 41.181 | 41.084 | 41.226 | 45 | 45 | ✓ |
| Reaction | tap (08) | 43.801 | 43.601 | 43.807 | 6 | 6 | ✓ |
| the report is filled in | report (08) | 44.821 | 44.723 | 44.876 | 55 | 55 | ✓ |
| from the vaccination | vaccination (08) | 46.821 | 46.659 | 46.841 | 20 | 91 | ✓ |
| say what happened | just (09) | 48.666 | 48.715 | 48.716 | 50 | 50 | ✓ |
| Save report | save (09) | 50.471 | 50.314 | 50.491 | 20 | 105 | ✓ |
| Dispensing labels | counter (10) | 53.396 | 53.229 | 53.416 | 20 | 129 | ✓ |
| a label prints again | label (10) | 54.376 | 54.172 | 54.396 | 20 | 125 | ✓ |
| Print again (one tap) | tap (10) | 56.456 | 56.261 | 56.476 | 20 | 114 | ✓ |
| Over the counter | guide (10) | 57.836 | 57.779 | 57.817 | -19 | -86 | ✓ |
| Sore throat | recommend (10) | 59.036 | 59.078 | 59.056 | 20 | -125 | ✓ |
| what to recommend, by symptom | symptom (10) | 60.196 | 60.116 | 60.261 | 65 | 64 | ✓ |
| end card | eikon (11) | 62.067 | 61.820 | 62.087 | 20 | -61 | ✓ |

**Retiming in the edit.** The capture machine is shared, and when it was busy some screen responses came late. The picture (never the voice) was retimed between cue points, the way an editor trims: local playback speed 0.88–1.12×, 19 cue points moved (largest 145 ms). The column *Capture* is the offset as captured, before this.


## Other checks

- **Length:** 66.96 s (captioned 66.96 s); 30 fps, H.264 High, CRF 15; AAC 256 kb/s 48 kHz.
- **Loudness (ffmpeg ebur128 on the delivered files):** -16.0 LUFS integrated, true peak -1.3 dBFS (captioned: -16.0 LUFS).
- **Captions vs audio:** a fresh faster-whisper pass on the finished film against the .srt: 128 caption words, WER 0.0; no differences.
- **Still stretches over 2 s:** none.
- **Errors on screen:** page errors / console errors / dialogs during capture: 0; error wording seen in the page text: 0.
- **Names:** `node agents/demo/names.mjs --check`: passes; every visible text captured (13 screens) was scanned for ċ ġ ħ ż outside genuinely Maltese names and places: {len(V['maltese_scan_fails'])} found.
- **Cursor:** after each press it moves off to rest where nothing can be pressed (14 rests), unless the next move starts first.
- **Actions that ran late** (> 40 ms after their cue): 7 [{'t': 15.581, 'lateBy': 0.556}, {'t': 16.191, 'lateBy': 0.237}, {'t': 16.211, 'lateBy': 0.379}, {'t': 16.781, 'lateBy': 0.133}, {'t': 50.961, 'lateBy': 0.065}, {'t': 56.576, 'lateBy': 0.143}, {'t': 57.346, 'lateBy': 0.057}].
