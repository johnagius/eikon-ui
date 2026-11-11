# Sync: narrated word → on-screen change

Every scripted action, measured on the captured frames (Chrome screencast, each frame time-stamped). **Word** = start of the narrated word (faster-whisper small.en word timestamps on the mastered narration; a word after a pause starts at the voice onset). **Press** = when the click/keystroke was sent. **Change** = first captured frame whose target area differs from the frame before the action (> 18 grey levels on ≥ 0.15 % of the area; cursor and click ripple masked out). **Offset** = change − word. Pass: |offset| ≤ 150 ms.

Result: **26/26 within ±150 ms**; worst 127 ms; median 25 ms.

| Action | Word | Word (s) | Press (s) | Change (s) | Offset (ms) | Capture (ms) | |
|---|---|---|---|---|---|---|---|
| Open Registers (sidebar) | registers (03) | 9.574 | 9.473 | 9.614 | 40 | 40 | ✓ |
| Today's registers | today's (03) | 10.994 | 10.897 | 11.008 | 14 | 14 | ✓ |
| what is due | due (03) | 12.874 | 12.776 | 12.906 | 32 | 32 | ✓ |
| what is done | done (03) | 14.154 | 14.059 | 14.224 | 70 | 70 | ✓ |
| type lowest 3.4 | lowest (04) | 17.066 | 17.007 | 17.046 | -20 | -20 | ✓ |
| type highest 6.1 | highest (04) | 18.126 | 18.066 | 18.111 | -15 | -15 | ✓ |
| Log (one tap) | one (04) | 18.996 | 18.895 | 19.001 | 5 | 5 | ✓ |
| Temperature card | daily (05) | 22.434 | 22.384 | 22.368 | -66 | -66 | ✓ |
| a month, at a glance | month (05) | 25.314 | 25.216 | 25.331 | 17 | 17 | ✓ |
| the missed day | missed (06) | 27.672 | 27.575 | 27.668 | -3 | -3 | ✓ |
| Sign off October | sign (07) | 31.978 | 31.878 | 31.959 | -19 | -19 | ✓ |
| confirm sign-off | name (07) | 33.498 | 33.447 | 33.550 | 52 | 52 | ✓ |
| signed off, on record | record (07) | 35.378 | 35.279 | 35.374 | -4 | -4 | ✓ |
| Controlled drugs by medicine card | controlled (08) | 37.367 | 37.266 | 37.316 | -51 | -51 | ✓ |
| open Oxycodone 5mg | in (08) | 40.127 | 40.060 | 40.234 | 107 | 107 | ✓ |
| in / out column | out (08) | 40.582 | 40.502 | 40.709 | 127 | 127 | ✓ |
| running balance column | balance (08) | 41.727 | 41.629 | 41.716 | -11 | -11 | ✓ |
| All medicines | if (09) | 44.431 | 44.311 | 44.420 | -11 | -11 | ✓ |
| Lorazepam: count it now | tells (09) | 47.296 | 47.198 | 47.326 | 30 | 30 | ✓ |
| scroll to Inspection check | before (10) | 50.947 | 50.871 | 50.972 | 25 | 25 | ✓ |
| Inspection check card | inspection (10) | 53.072 | 52.971 | 52.952 | -120 | -120 | ✓ |
| what to put right | exactly (10) | 56.692 | 56.593 | 56.685 | -7 | -7 | ✓ |
| Print inspection pack (one tap) | one (11) | 59.354 | 59.313 | 59.428 | 74 | 74 | ✓ |
| pack: contents | every (11) | 62.214 |  | 62.238 | 24 | 24 | ✓ |
| pack: sign-off page | every (11) | 63.469 |  | 63.459 | -10 | -10 | ✓ |
| end card | eikon (12) | 66.673 |  | 66.579 | -94 | -94 | ✓ |

## Other checks

- **Length:** 72.00 s (captioned 72.00 s); 30 fps, H.264 High, CRF 15; AAC 256 kb/s 48 kHz.
- **Loudness (ffmpeg ebur128 on the delivered files):** -16.0 LUFS integrated, true peak -1.3 dBFS (captioned: -16.0 LUFS).
- **Captions vs audio:** a fresh faster-whisper pass on the finished film against the .srt: 139 caption words, WER 0.0; no differences.
- **Still stretches over 2 s:** none.
- **Errors on screen:** page errors / console errors / dialogs during capture: 0; error wording seen in the page text: 0.
- **Names:** `node agents/demo/names.mjs --check` passes; every visible text captured (each screen and the printed pack) was scanned for ċ ġ ħ ż outside genuinely Maltese names and places: 0 found.
- **Actions that ran late** (> 40 ms after their cue): 3 [{'t': 14.886, 'lateBy': 0.115}, {'t': 44.636, 'lateBy': 0.2}, {'t': 49.612, 'lateBy': 0.204}].
