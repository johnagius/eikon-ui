# Sync: narrated word → on-screen change

Every scripted action, measured on the captured frames (Chrome screencast at device scale 4/3, 2560×1440, each frame time-stamped). **Word** = start of the narrated word (faster-whisper small.en word timestamps on the mastered narration; a word after a pause starts at the voice onset). **Press** = when the click/keystroke was sent. **Change** = first captured frame whose target area differs from the frame before the action (> 18 grey levels on ≥ 0.15 % of the area; cursor and click ripple masked out). **Offset** = change − word. Pass: |offset| ≤ 150 ms.

Result: **27/27 within ±150 ms**; worst 60 ms; median 20 ms (absolute).

| Action | Word | Word (s) | Press (s) | Change (s) | Offset (ms) | Capture (ms) | |
|---|---|---|---|---|---|---|---|
| Team (side bar) | today's (02) | 5.273 | 5.134 | 5.293 | 20 | 81 | ✓ |
| who is in | in (02) | 6.833 | 6.729 | 6.890 | 57 | 57 | ✓ |
| until when | when (02) | 7.713 | 7.616 | 7.768 | 55 | 55 | ✓ |
| the pharmacist in charge | pharmacist (02) | 8.893 | 8.741 | 8.913 | 20 | 85 | ✓ |
| Plan shifts | plan (03) | 13.519 | 13.362 | 13.539 | 20 | 97 | ✓ |
| Fill… | fill (03) | 14.339 | 14.173 | 14.311 | -28 | -28 | ✓ |
| A usual week or rotation | rotation (03) | 15.979 | 15.879 | 15.942 | -37 | -37 | ✓ |
| Wednesday | three (04) | 18.003 | 17.892 | 18.010 | 7 | 8 | ✓ |
| Saturday, week B | other (04) | 19.708 | 19.606 | 19.728 | 20 | 148 | ✓ |
| Save usual week | save (05) | 21.433 | 21.262 | 21.453 | 20 | 128 | ✓ |
| Put it on the rota… | do (05) | 23.523 | 23.363 | 23.530 | 7 | 7 | ✓ |
| a whole year of shifts | year (05) | 24.543 | 24.395 | 24.563 | 20 | 79 | ✓ |
| public holidays skipped | skipped (05) | 27.063 | 26.876 | 27.083 | 20 | 112 | ✓ |
| Add the shifts | add (06) | 28.695 | 28.565 | 28.730 | 35 | 35 | ✓ |
| undo, in one step | undo (06) | 31.220 | 31.122 | 31.265 | 45 | 45 | ✓ |
| no pharmacist | no (07) | 35.982 | 35.837 | 36.002 | 20 | 71 | ✓ |
| more hours than the contract | hours (07) | 37.882 | 37.782 | 37.932 | 50 | 50 | ✓ |
| it says so | says (07) | 40.182 | 40.001 | 40.202 | 20 | 117 | ✓ |
| the phone | phone (08) | 43.792 | 43.585 | 43.812 | 20 | 111 | ✓ |
| his own shifts | own (08) | 45.632 | 45.529 | 45.691 | 59 | 59 | ✓ |
| who he works with | with (08) | 47.952 | 47.796 | 47.972 | 20 | 84 | ✓ |
| Add to my calendar | add (09) | 49.339 | 49.180 | 49.375 | 36 | 36 | ✓ |
| a note whenever his shifts change | note (09) | 51.139 | 50.909 | 51.159 | 20 | 173 | ✓ |
| Handover: Read | left (10) | 55.688 | 55.530 | 55.748 | 60 | 60 | ✓ |
| read it | read (10) | 56.758 | 56.605 | 56.778 | 20 | 100 | ✓ |
| Got it | got (10) | 57.528 | 57.330 | 57.494 | -34 | -34 | ✓ |
| end card | eikon (11) | 59.356 | 59.138 | 59.376 | 20 | -87 | ✓ |

**Retiming in the edit.** The capture machine is shared, and when it was busy some screen responses came late. The picture (never the voice) was retimed between cue points, the way an editor trims: local playback speed 0.888–1.086×, 14 cue points moved (largest 153 ms). The column *Capture* is the offset as captured, before this.


## Other checks

- **Length:** 65.27 s (captioned 65.27 s); 30 fps, H.264 High, CRF 15; AAC 256 kb/s 48 kHz.
- **Loudness (ffmpeg ebur128 on the delivered files):** -16.0 LUFS integrated, true peak -1.2 dBFS (captioned: -16.0 LUFS).
- **Captions vs audio:** a fresh faster-whisper pass on the finished film against the .srt: 130 caption words, WER 0.0; no differences.
- **Still stretches over 2 s:** none.
- **Errors on screen:** page errors / console errors / dialogs during capture: 0; error wording seen in the page text: 0.
- **Names:** `node agents/demo/names.mjs --check`: passes; every visible text captured (22 screens, the phone included) was scanned for ċ ġ ħ ż outside genuinely Maltese names and places: {len(V['maltese_scan_fails'])} found.
- **Cursor:** after each press it moves off to rest where nothing can be pressed (11 rests), unless the next move starts first.
- **Actions that ran late** (> 40 ms after their cue): 10 [{'t': 13.619, 'lateBy': 0.148}, {'t': 16.249, 'lateBy': 0.106}, {'t': 16.983, 'lateBy': 0.162}, {'t': 17.503, 'lateBy': 0.129}, {'t': 17.948, 'lateBy': 0.057}, {'t': 18.238, 'lateBy': 0.066}, {'t': 18.538, 'lateBy': 0.135}, {'t': 19.228, 'lateBy': 0.218}, {'t': 49.533, 'lateBy': 0.1}, {'t': 49.709, 'lateBy': 0.139}].
