# Sync: narrated word → on-screen change

Every scripted action, measured on the captured frames (Chrome screencast at device scale 4/3, 2560×1440, each frame time-stamped). **Word** = start of the narrated word (faster-whisper small.en word timestamps on the mastered narration; a word after a pause starts at the voice onset). **Press** = when the click/keystroke was sent. **Change** = first captured frame whose target area differs from the frame before the action (> 18 grey levels on ≥ 0.15 % of the area; cursor and click ripple masked out). **Offset** = change − word. Pass: |offset| ≤ 150 ms.

Result: **29/29 within ±150 ms**; worst 55 ms; median 20 ms (absolute).

| Action | Word | Word (s) | Press (s) | Change (s) | Offset (ms) | Capture (ms) | |
|---|---|---|---|---|---|---|---|
| Money (side bar) | today's (02) | 6.490 | 6.320 | 6.510 | 20 | 112 | ✓ |
| what is left to do | left (02) | 8.090 | 7.947 | 8.110 | 20 | 62 | ✓ |
| Paid out: Open | courier (03) | 11.646 | 11.539 | 11.666 | 20 | -98 | ✓ |
| New payment | paid (03) | 13.986 | 13.841 | 13.931 | -55 | -55 | ✓ |
| tap his name (Courier Ltd) | name (03) | 15.166 | 15.039 | 15.186 | 20 | 73 | ✓ |
| type 8.50 | amount (03) | 16.386 | 16.334 | 16.388 | 2 | 2 | ✓ |
| Enter saves | done (03) | 17.071 | 17.013 | 17.109 | 38 | 38 | ✓ |
| End of day: Open | end (04) | 19.222 | 19.076 | 19.242 | 20 | 149 | ✓ |
| it goes in steps | steps (04) | 21.582 | 21.433 | 21.602 | 20 | 66 | ✓ |
| type the X reading | type (05) | 23.051 | 23.091 | 23.071 | 20 | 110 | ✓ |
| type the card total | readings (05) | 24.081 | 24.152 | 24.101 | 20 | 67 | ✓ |
| Use them (paid outs come in) | themselves (05) | 26.541 | 26.440 | 26.527 | -14 | -14 | ✓ |
| count the notes | count (06) | 28.809 | 28.857 | 28.830 | 21 | 98 | ✓ |
| type the coins | coins (06) | 30.519 | 30.518 | 30.572 | 53 | 53 | ✓ |
| a little short (the footer) | short (07) | 32.325 | 32.184 | 32.345 | 20 | 68 | ✓ |
| it says so in words | words (07) | 34.405 | 34.304 | 34.443 | 38 | 38 | ✓ |
| write what you found | write (08) | 39.407 | 39.458 | 39.409 | 2 | 2 | ✓ |
| Save and lock | lock (08) | 41.137 | 41.058 | 41.168 | 31 | 31 | ✓ |
| Money (side bar) | if (09) | 44.204 | 44.004 | 44.175 | -29 | -29 | ✓ |
| Emergency till: Open | emergency (09) | 46.849 | 46.735 | 46.869 | 20 | -71 | ✓ |
| Enter: into the basket | selling (09) | 48.129 | 48.177 | 48.149 | 20 | -81 | ✓ |
| Take €3.95 | no (09) | 49.729 | 49.627 | 49.749 | 20 | 84 | ✓ |
| even with no connection | connection (09) | 50.049 | 49.884 | 50.069 | 20 | 98 | ✓ |
| Credit notes: Open | credit (10) | 52.311 | 52.154 | 52.331 | 20 | -86 | ✓ |
| what each customer holds | holds (10) | 54.691 | 54.599 | 54.736 | 45 | 45 | ✓ |
| find her name | find (10) | 56.026 | 56.095 | 56.046 | 20 | 73 | ✓ |
| Use | use (10) | 57.391 | 57.338 | 57.441 | 50 | 50 | ✓ |
| what is left stays on her note | left (10) | 58.671 | 58.716 | 58.678 | 7 | 7 | ✓ |
| end card | eikon (11) | 61.929 | 61.732 | 61.960 | 31 | 31 | ✓ |

**Retiming in the edit.** The capture machine is shared, and when it was busy some screen responses came late. The picture (never the voice) was retimed between cue points, the way an editor trims: local playback speed 0.919–1.103×, 16 cue points moved (largest 129 ms). The column *Capture* is the offset as captured, before this.


## Other checks

- **Length:** 67.26 s (captioned 67.26 s); 30 fps, H.264 High, CRF 15; AAC 256 kb/s 48 kHz.
- **Loudness (ffmpeg ebur128 on the delivered files):** -16.0 LUFS integrated, true peak -1.4 dBFS (captioned: -16.0 LUFS).
- **Captions vs audio:** a fresh faster-whisper pass on the finished film against the .srt: 126 caption words, WER 0.0; no differences.
- **Still stretches over 2 s:** none.
- **Errors on screen:** page errors / console errors / dialogs during capture: 0; error wording seen in the page text: 0.
- **Names:** `node agents/demo/names.mjs --check`: passes; every visible text captured (12 screens) was scanned for ċ ġ ħ ż outside genuinely Maltese names and places: {len(V['maltese_scan_fails'])} found.
- **Cursor:** after each press it moves off to rest where nothing can be pressed (15 rests), unless the next move starts first.
- **Actions that ran late** (> 40 ms after their cue): 17 [{'t': 10.606, 'lateBy': 0.06}, {'t': 17.552, 'lateBy': 0.182}, {'t': 18.302, 'lateBy': 0.373}, {'t': 22.181, 'lateBy': 0.302}, {'t': 23.101, 'lateBy': 0.079}, {'t': 23.481, 'lateBy': 0.298}, {'t': 24.101, 'lateBy': 0.097}, {'t': 37.585, 'lateBy': 0.549}, {'t': 38.025, 'lateBy': 0.386}, {'t': 46.759, 'lateBy': 0.422}, {'t': 47.429, 'lateBy': 0.18}, {'t': 55.156, 'lateBy': 0.505}, {'t': 55.906, 'lateBy': 0.24}, {'t': 57.441, 'lateBy': 0.057}, {'t': 57.501, 'lateBy': 0.668}, {'t': 58.451, 'lateBy': 0.25}, {'t': 58.571, 'lateBy': 0.143}].
