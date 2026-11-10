# Eikon narration, round 2: directed narration for voices #4 and #7

John's note on round 1: #4 and #7 have the right tone but, reading plain text, they lack accentuation, changes of tone and pauses.
Round 2 keeps both timbres (same Kokoro voices, same style vectors) and replaces plain text-to-speech with a **directed** performance:
each line is written with narrator's marks, then realised phrase by phrase, and every mark is checked by measurement.

**Listen to:** `compare-round2.mp3` (1:43). For each of the 5 lines it plays plain #4, directed #4, plain #7, directed #7, with 0.8 s gaps.

## Index of compare-round2.mp3

| Time | Line | Clip |
|---|---|---|
| 0:00.0 | L1 register | #4 plain (`processed/v4_reg_plain.mp3`) |
| 0:06.4 | L1 register | #4 directed (`processed/v4_reg_directed.mp3`) |
| 0:13.0 | L1 register | #7 plain (`processed/v7_reg_plain.mp3`) |
| 0:19.1 | L1 register | #7 directed (`processed/v7_reg_directed.mp3`) |
| 0:25.8 | L2 Eikon | #4 plain (`processed/v4_eik_plain.mp3`) |
| 0:30.5 | L2 Eikon | #4 directed (`processed/v4_eik_directed.mp3`) |
| 0:36.0 | L2 Eikon | #7 plain (`processed/v7_eik_plain.mp3`) |
| 0:40.5 | L2 Eikon | #7 directed (`processed/v7_eik_directed.mp3`) |
| 0:46.1 | L3 question | #4 plain (`processed/v4_ask_plain.mp3`) |
| 0:50.2 | L3 question | #4 directed (`processed/v4_ask_directed.mp3`) |
| 0:54.7 | L3 question | #7 plain (`processed/v7_ask_plain.mp3`) |
| 0:58.8 | L3 question | #7 directed (`processed/v7_ask_directed.mp3`) |
| 1:03.3 | L4 list | #4 plain (`processed/v4_list_plain.mp3`) |
| 1:08.9 | L4 list | #4 directed (`processed/v4_list_directed.mp3`) |
| 1:13.8 | L4 list | #7 plain (`processed/v7_list_plain.mp3`) |
| 1:19.3 | L4 list | #7 directed (`processed/v7_list_directed.mp3`) |
| 1:24.2 | L5 reassurance | #4 plain (`processed/v4_calm_plain.mp3`) |
| 1:28.7 | L5 reassurance | #4 directed (`processed/v4_calm_directed.mp3`) |
| 1:34.0 | L5 reassurance | #7 plain (`processed/v7_calm_plain.mp3`) |
| 1:38.5 | L5 reassurance | #7 directed (`processed/v7_calm_directed.mp3`) |
| 1:43.1 | end | |

Other deliverables (all 48 kHz mono MP3, 192 kbps, processed with the round-1 chain: warm EQ, light compression, subtle room, -16 LUFS):

- `processed/{v4,v7}_{reg,eik,ask,list,calm}_{plain,directed}.mp3`: each line on its own (20 files; measured -16.0 to -16.5 LUFS, peak -1.7 to -2.4 dBFS).
- `processed/{v4,v7}_ALL5_{plain,directed}.mp3`: all five lines in a row, one file per voice and version.
- `dry/*.wav`: the unprocessed 24 kHz renderings that were measured. `measure.json` holds every measurement; `dry/build_meta.json` has the phonemes, speeds and shaping applied to each phrase.

"Plain" means a round-1 style rendering: one Kokoro call per line at speed 0.85. #4 gets the round-1 hand-corrected IPA; #7 gets the round-1 ellipsis text.
Lines 1 and 2 are exactly the round-1 inputs.

## The marked-up script

Shorthand: CAPS = primary stress, | = short pause, ‖ = sentence pause, ‖‖ = dramatic beat, … = held (level) ending.

| # | Line | What it tests |
|---|---|---|
| L1 | Every REGISTER \| an inspector ASKS for. ‖ Ready… \| beFORE they walk in. | stress, a held suspense word, sentence fall |
| L2 | EYE-kon. ‖‖ The PHARmacy… \| in one CALM place. | brand name, a 0.9 s dramatic beat, a slow key phrase |
| L3 | What if every CHECK \| was already DONE? | question rise |
| L4 | Daily TEMPeratures, \| controlled DRUGS, \| and every SIGNATURE. | a list: rise, rise, fall |
| L5 | So when they arrive… ‖ reLAX. ‖ It's ALL here. | gentle reassurance, slow single-word phrase |

The script file the pipeline reads, `script.marks`:

```
# Eikon narration - narrator's marks (round 2)
# One phrase per line:   text  |  pitch target  pace  pause  tone
#   ^^word   primary stress      ^word   secondary stress      (unmarked words are de-stressed)
#   /lift  ends slightly up (more to come)     /fall  sentence-final fall
#   /hold  stays level (suspense, "...")       /rise  question rise
#   pace=-10   10 % slower than the base speed (0.85)     pace=+8   8 % faster
#   ||250 comma pause  ||420-550 sentence pause  ||800-1200 dramatic beat  ||0 end of line (ms)
#   tone=warm | confident | gentle | emphatic
#   punct=,   engine-level override of the phrase-end punctuation fed to Kokoro (the fall is then made by pitch shaping)
# Shorthand used in ROUND2.md:  CAPS = primary, | = short pause, ‖ = sentence pause, ‖‖ = dramatic beat, … = held

@reg  "Every REGISTER | an inspector ASKS for. ‖ Ready… | beFORE they walk in."
Every ^^register             | /lift  pace=-6   ||250   tone=confident
an inspector ^asks for.      | /fall  pace=+10  ||450   tone=confident
^^Ready…                     | /hold  pace=-12  ||300   tone=confident  punct=,
^^before they ^walk in.      | /fall  pace=-6   ||0     tone=warm

@eik  "EYE-kon. ‖‖ The PHARmacy… | in one CALM place."
^^Eikon.                     | /fall  pace=+0   ||900   tone=emphatic  punct=,
the ^pharmacy…               | /hold  pace=+8   ||320   tone=warm
in one ^^calm place.         | /fall  pace=-14  ||0     tone=warm

@ask  "What if every CHECK | was already DONE?"
what if every ^^check        | /lift  pace=-20  ||220   tone=gentle
was already ^done?           | /rise  pace=-30  ||0     tone=gentle

@list "Daily TEMPeratures, | controlled DRUGS, | and every SIGNATURE."
daily ^^temperatures,        | /lift  pace=+20  ||300   tone=confident
controlled ^^drugs,          | /lift  pace=+20  ||300   tone=confident
and every ^^signature.       | /fall  pace=+8   ||0     tone=confident

@calm "So when they arrive… ‖ reLAX. ‖ It's ALL here."
so when they ^arrive…        | /hold  pace=+4   ||420   tone=gentle
^^relax.                     | /fall  pace=-8   ||550   tone=gentle
it's ^^all here.             | /fall  pace=-12  ||0     tone=warm
```

Three wording choices came from testing, not taste: L4 began as "Fridge temperatures", but "fridge" alone at the start of a phrase
was heard as "3D", "Friendly" or "Friggy". "Eikon" and "Ready" are fed to the engine with a comma rather than a full stop or an ellipsis:
with a full stop Kokoro adds a release that Whisper heard as "I conned", and the ellipsis made #4 drop into creak, where pitch cannot be shaped.
The pitch shaping still makes the fall and the held ending.

## Method: how the marks become a performance

Script: `scripts/narr.py` (the pipeline), `scripts/build.py` (renders both voices), `scripts/measure.py` (the checks), `scripts/render.py` (processing and the comparison file).

1. **Exact timings from the engine.** The Kokoro ONNX model has a duration head that kokoro-onnx does not expose. `scripts/make_dur_model.py`
   adds it as an extra output (same weights, same audio), so every phoneme and word has an exact start and end time. Whisper is not used for alignment.
2. **Stress in the phonemes.** Each phrase is written in RP IPA (misaki style). Marked words keep their primary stress mark `ˈ`;
   unmarked content words are lowered to secondary `ˌ`; function words (and unmarked "every") lose stress altogether, which makes the contrast bigger.
3. **Phrase by phrase.** Each phrase is synthesised alone at its own speed (base 1.22 × pace mark; key phrases are 8–30 % slower).
   The engine picks a style row by phoneme count, so every phrase in a line is pinned to the row the whole line would use. That keeps the timbre the same as the plain rendering.
4. **Shaping (Praat PSOLA via parselmouth).** Each phrase is resynthesised with overlap-add, which keeps the formants. The pitch is analysed from 40 Hz with dense pulses so the creaky phrase ends can be shaped too.
   - Stressed words get a pitch peak at the stressed vowel (primary +2.6 st, secondary +1.3 st, scaled by tone), a gain bump (+2.6 / +1.3 dB) and 4–8 % lengthening.
   - Phrase ends: the linear trend over the last word's voiced part is replaced by a target relative to the phrase median. The targets are fall -4.5 st, rise +6, lift +3.5 and hold +2. The fine pitch movement is kept.
   - Tone sets the pitch range and level: confident ×1.10; warm ×1.0 and -0.4 st; gentle ×0.85, -0.6 st and -1 dB; emphatic ×1.15 with bigger stress.
5. **Closed loop.** After shaping, the same measurements as the checks are taken. The loop then adjusts:
   - **Short of prominence:** a stressed word gets more pitch, gain and length, capped at +4.5 st, +5 dB and +25 % length.
   - **At the cap:** its unstressed neighbours are pulled down instead, by at most -2.5 st and -3 dB.
   - **Missed phrase end:** that phrase's end target is moved.

   There are up to 6 passes, and the best one is kept. The settings that were used are recorded in `dry/build_meta.json`.
6. **Joining.** The phrases sit over continuous room tone (pink noise at the engine's own floor, -66 dBFS or lower), with equal-power fades (10 ms in, 60 ms out).
   Each gap is set so that the silence (below -40 dB of the line's peak) equals the marked pause. A long breathy tail is shortened if it would eat into the pause.

## What the checks measure

- **Stress:** for each marked word, against the nearest unstressed word on each side:
  - pitch: 90th percentile F0, in st;
  - energy: 90th percentile of 5 ms frame level, in dB;
  - duration: ms per phoneme.

  A primary stress passes when 2 of these 3 clear +1.0 st, +1.0 dB or +10 %; a secondary passes on 1 of 3.
- **Pauses:** silences of 80 ms or more, below -40 dB of the line peak (the rule kokoro-onnx uses; round 1 used 38 dB), compared with the marks. The tolerance is ±40 ms.
- **Phrase ends:** mean F0 of the last 150 ms of voicing minus the phrase median. The pass thresholds are:
  - fall: -2 st or lower;
  - rise: +2 st or higher;
  - lift: +0.5 st or higher;
  - hold: -1.5 st or higher.

  The list must go lift, lift, fall and the question must rise.
- **Splices:** bursts of energy above 5 kHz that stand 18 dB over the 40 ms around them, counted at every join (±12 ms) and in running speech.
  The sample-to-sample jump at each join is also measured, relative to the local RMS.
- **Words:** faster-whisper **small.en** (the main check) and base (the round-1 model) transcribe every clip. "Eikon" counts when heard as Icon or Ikon.
- **Pace:** words per minute over the speech span including in-line pauses, plus the rate over speech alone.

## Results: before (plain) and after (directed)

| Voice | Version | Stressed words passing | Phrase-end contours passing | Lines with all pauses within ±40 ms | Overall pace, 5 lines (wpm incl. in-line pauses) |
|---|---|---|---|---|---|
| #4 | plain | 11/16 | 6/15 | 1/5 | 137 |
| #4 | directed | 16/16 | 15/15 | 5/5 | 126 |
| #7 | plain | 12/16 | 5/15 | 0/5 | 141 |
| #7 | directed | 16/16 | 15/15 | 5/5 | 125 |

**Notes on the results**

- **Directed passes every check** on both voices: all 16 stressed words, all 15 phrase ends, all 10 lines' pauses and the words.
  The transcripts are word-perfect with small.en, on the dry files and again on the processed MP3s, and "Eikon" is heard as "Icon" every time.
- **Plain, by comparison:**
  - Phrase ends: plain falls almost everywhere. The question ends at -2.4 st (#4) and -3.6 st (#7) instead of rising. The list goes fall-fall-fall (-8.2, -4.3, -1.3 st on #4).
  - Pauses: plain misses the beats. "Eikon" got only 215 ms (#4); on #7 the beat after "Eikon" disappeared and the word was heard as "I can".
  - Stress: on plain #4, REGISTER sits 2.3 st below its neighbours, and RELAX sits 4.7 st below.
- **Stress deltas, directed.** Pitch is +1.1 to +12 st over the neighbours and duration +13 to +278 % per phoneme. Energy is +1.1 to +9 dB, except where noted:
  - REGISTER on both voices, and "done" on #4, are carried by pitch and length while their energy sits about 0.5–1 dB below the neighbours. Their pitch is +1.3 to +9 st.
  - "Ready" and "before" stand out most, at +8 to +12 st.
- **Pace.** Overall it is 126 wpm (#4) and 125 wpm (#7), against 137 and 141 plain, so it sits at the slow end of the 125–145 target.
  That is deliberate: the key phrases are slower ("in one calm place" at speed 1.05, "was already done?" 0.85, "relax" 1.12, against a base of 1.22).
  L2 on its own is 106–107 wpm because of its 0.9 s beat. Speech alone runs at 150–173 wpm, close to plain (121–208).
- **Splices.** No click was found at any join, and the largest jump at a join is 1.8 × the local RMS, which is noise level. The detector counts 4–12 bursts per directed line against 2–9 plain.
  When I mapped them to words in two lines, they fell on plosives (/k t p d/) and /s/, which plain has too. One extra burst in "inspector" on #4 may come from PSOLA on creaky voicing.
- **How exact the pauses are.** They come out exact at the -40 dB definition because the joining uses the same rule.
  With other thresholds, the pauses are off by a mean of +41 ms at -35 dB and -29 ms at -45 dB, with a worst case of 115 ms and 80 ms.
  So treat the ±40 ms claim as true under that definition. The plain renderings miss by up to 685 ms under the same definition.

## Full measurement table

Stress deltas are pitch st / energy dB / duration %. In the "Phrase ends" column, ✗ marks a failed check.

| Line | Voice | Version | Stress words passing | Stress deltas (pitch st / energy dB / duration %, vs nearest unstressed neighbours) | Pauses ms (marked) | Pause error ms | Phrase ends (target: st) | wpm (with pauses / speech only) | Transcript (whisper small.en) | WER small / base |
|---|---|---|---|---|---|---|---|---|---|---|
| L1 register | #4 | plain | 4/5 | REGISTER -2.3/+0.0/+33; asks +3.1/+6.5/-49; READY +7.0/+9.6/-19; BEFORE +6.2/+7.3/-54; walk +3.4/+6.0/+16 | 80, 580, 405 (250, 450, 300) | -170, +130, +105 | lift -5.3 ✗, fall -3.0, hold -0.8, fall -4.3 (3/4) | 138 / 177 | Every register an inspector asks for, ready before they walk in. | 0.00 / 0.09 |
| L1 register | #4 | directed | 5/5 | REGISTER +3.0/-0.3/+87; asks +1.2/+4.0/+13; READY +12.2/+9.0/+69; BEFORE +11.9/+8.2/+27; walk +6.9/+8.6/+38 | 250, 450, 300 (250, 450, 300) | +0, +0, +0 | lift +1.8, fall -4.6, hold -0.5, fall -5.1 (4/4) | 132 / 165 | Every register an inspector asks for ready before they walk in | 0.00 / 0.09 |
| L1 register | #7 | plain | 5/5 | REGISTER +2.3/-0.8/+27; asks +5.4/+5.8/-49; READY +5.7/+6.8/-25; BEFORE +5.4/+5.6/-54; walk +1.3/+3.6/-14 | 80, 430, 235 (250, 450, 300) | -170, -20, -65 | lift -2.6 ✗, fall -6.9, hold -5.6 ✗, fall -5.5 (2/4) | 144 / 172 | Every register an inspector asks for, ready before they walk in. | 0.00 / 0.09 |
| L1 register | #7 | directed | 5/5 | REGISTER +9.1/-0.7/+93; asks +3.6/+4.5/+13; READY +8.5/+6.3/+48; BEFORE +9.3/+6.3/+16; walk +7.2/+9.3/+16 | 250, 450, 300 (250, 450, 300) | +0, +0, +0 | lift +1.1, fall -5.6, hold +0.1, fall -7.2 (4/4) | 128 / 159 | Every register an inspector asks for ready before they walk in | 0.00 / 0.09 |
| L2 Eikon | #4 | plain | 3/3 | EIKON +5.6/+10.1/+233; pharmacy +5.6/+5.0/+195; CALM +0.7/+1.2/+50 | 215, 375 (900, 320) | -685, +55 | fall -4.1, hold -5.0 ✗, fall -4.2 (2/3) | 133 / 163 | Icon, the Pharmacy, in one calm place. | 0.00 / 0.00 |
| L2 Eikon | #4 | directed | 3/3 | EIKON +6.9/+9.2/+254; pharmacy +5.7/+5.2/+107; CALM +1.6/+3.9/+65 | 900, 320 (900, 320) | +0, +0 | fall -2.7, hold -0.2, fall -4.9 (3/3) | 107 / 160 | Icon, the pharmacy in one calm place. | 0.00 / 0.00 |
| L2 Eikon | #7 | plain | 3/3 | EIKON +4.8/+9.1/+167; pharmacy +6.0/+4.1/+195; CALM +2.6/+1.7/+10 | 350 (900, 320) | n/a (model pauses: 350) | fall -0.1 ✗, hold -8.0 ✗, fall -6.2 (1/3) | 141 / 160 | I can the pharmacy in one calm place | 0.29 / 0.29 |
| L2 Eikon | #7 | directed | 3/3 | EIKON +8.5/+6.8/+278; pharmacy +8.1/+4.1/+136; CALM +3.7/+4.5/+33 | 900, 320 (900, 320) | +0, +0 | fall -2.6, hold -0.7, fall -5.5 (3/3) | 106 / 152 | Icon, the pharmacy in one calm place. | 0.00 / 0.00 |
| L3 question | #4 | plain | 2/2 | CHECK +4.7/-1.6/+100; done -1.5/-3.7/+60 | 245 (220) | +25 | lift -3.1 ✗, rise -2.4 ✗ (0/2) | 166 / 208 | What if every check was already done? | 0.00 / 0.00 |
| L3 question | #4 | directed | 2/2 | CHECK +5.9/+1.5/+67; done +1.3/-0.9/+64 | 220 (220) | +0 | lift +2.5, rise +3.9 (2/2) | 144 / 162 | What if every check was already done? | 0.00 / 0.00 |
| L3 question | #7 | plain | 2/2 | CHECK +4.9/-2.8/+142; done -2.5/-4.9/+134 | 300 (220) | +80 | lift -5.9 ✗, rise -3.6 ✗ (0/2) | 163 / 185 | What if every check was already done? | 0.00 / 0.00 |
| L3 question | #7 | directed | 2/2 | CHECK +3.2/+1.5/+111; done +4.5/+1.4/+96 | 220 (220) | +0 | lift +2.5, rise +4.0 (2/2) | 144 / 156 | What if every check was already done? | 0.00 / 0.00 |
| L4 list | #4 | plain | 0/3 | TEMPERATURES -0.3/-5.4/+28; DRUGS -2.7/-0.6/+160; SIGNATURE -2.5/-4.1/+12 | 350, 300 (300, 300) | +50, +0 | lift -8.2 ✗, lift -4.3 ✗, fall -1.3 ✗ (0/3) | 102 / 121 | daily temperatures, controlled drugs and every signature. | 0.00 / 0.00 |
| L4 list | #4 | directed | 3/3 | TEMPERATURES +2.7/+2.1/+13; DRUGS +1.6/+1.1/+41; SIGNATURE +1.9/+1.7/+26 | 300, 300 (300, 300) | +0, +0 | lift +2.4, lift +1.7, fall -2.6 (3/3) | 124 / 150 | daily temperatures, controlled drugs and every signature. | 0.00 / 0.29 |
| L4 list | #7 | plain | 0/3 | TEMPERATURES +0.7/-3.7/+28; DRUGS +1.0/+0.9/+157; SIGNATURE -1.0/-5.2/+28 | 215, 255 (300, 300) | -85, -45 | lift -8.4 ✗, lift -3.1 ✗, fall -7.4 (1/3) | 108 / 122 | daily temperatures, controlled drugs, and every signature. | 0.00 / 0.00 |
| L4 list | #7 | directed | 3/3 | TEMPERATURES +6.1/+1.3/+46; DRUGS +5.9/+1.1/+88; SIGNATURE +5.7/+1.6/+38 | 300, 300 (300, 300) | +0, +0 | lift +0.8, lift +2.8, fall -2.8 (3/3) | 124 / 151 | daily temperatures, controlled drugs, and every signature. | 0.00 / 0.14 |
| L5 reassurance | #4 | plain | 2/3 | arrive -1.7/+1.8/+140; RELAX -4.7/-0.5/+164; ALL +0.1/+1.4/+11 | 125, 345 (420, 550) | -295, -205 | hold -3.1 ✗, fall -1.3 ✗, fall -2.3 (1/3) | 165 / 203 | So when they arrive, relax, it's all here. | 0.00 / 0.00 |
| L5 reassurance | #4 | directed | 3/3 | arrive +1.1/+1.2/+72; RELAX +6.2/+3.8/+126; ALL +5.1/+5.3/+48 | 420, 550 (420, 550) | +0, +0 | hold +0.0, fall -3.1, fall -2.6 (3/3) | 128 / 173 | So when they arrive, relax. It's all here. | 0.00 / 0.00 |
| L5 reassurance | #7 | plain | 2/3 | arrive +3.4/+1.4/+205; RELAX +3.3/+2.4/+118; ALL -2.1/+1.1/-7 | 275, 160 (420, 550) | -145, -390 | hold -9.8 ✗, fall +1.5 ✗, fall -5.0 (1/3) | 160 / 193 | So when they arrive, relax, it's all here. | 0.00 / 0.00 |
| L5 reassurance | #7 | directed | 3/3 | arrive +4.0/+1.3/+84; RELAX +5.1/+4.1/+140; ALL +2.1/+3.4/+17 | 420, 550 (420, 550) | +0, +0 | hold +0.7, fall -6.9, fall -3.7 (3/3) | 125 / 167 | So when they arrive, relax, it's all here. | 0.00 / 0.00 |

## What these engines could not do

- **Kokoro has no intonation control of its own.** "?", the arrow tokens in its vocabulary (↗ ↘), commas and ellipses barely move its phrase-final pitch. Every British voice falls even on a question.
  All the rises, lifts and holds come from PSOLA after synthesis. They are moderate shifts, a few semitones, on the last word only.
- **#4 (bm_lewis) goes creaky at phrase ends.** Pitch can only be moved where there is voicing, so on a word like "done?" the rise sits on about the first 200 ms of the vowel.
  The final creak/breath is left as it is. Both voices pass, at +3.9 st (#4) and +4.0 st (#7).
- **Energy on long words is hard to raise.** REGISTER and "done" get their prominence from pitch and length instead, within the caps above.
  I kept the caps (+4.5 st, +5 dB) because larger shifts start to sound processed.
- **No ears.** Every check is objective. PSOLA at these amounts is normally clean, but small artefacts on creaky voicing cannot be ruled out by measurement alone, so a listening pass is still needed.
  Of the clips, the ones most worth a listen are the "done?" rise on #4 and the held "pharmacy…".
- **The pauses are exact only under one definition** of silence (see above).

## Reproduce

```
python round2/scripts/make_dur_model.py      # once; writes round2/work/kokoro-v1.0-dur.onnx (325 MB, deleted to save space)
python round2/scripts/build.py               # dry renderings (plain + directed, both voices)
python round2/scripts/measure.py             # checks -> round2/measure.json
python round2/scripts/render.py              # processing, ALL5 files, compare-round2.mp3
python round2/scripts/tables.py              # tables for this file
```
Run from `video/` with `venv` (plus `onnx`, added this round). Whisper small.en is in `models/whisper-small.en` (MIT, downloaded from Hugging Face).
Voices: Kokoro-82M v1.0, Apache-2.0, stock voices bm_lewis and bm_daniel only. No real person's voice was cloned or imitated.
