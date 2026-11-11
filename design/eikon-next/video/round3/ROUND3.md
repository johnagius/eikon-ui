# Eikon narration, round 3: natural expressive delivery in the #4 timbre

John's note on round 2: #4 (Kokoro bm_lewis, speed 0.85) has a "good tone", but the directed version "sounds artificial".
He still wants real accentuation, changes of tone and pauses.
Round 3 drops round 2's pitch surgery. That surgery was PSOLA shifts up to +12 st, gain bumps on single words, phrase-by-phrase synthesis and imposed contours.
In its place, three approaches were tried and measured.

**Listen to:** `compare-round3.mp3` (1:42). For each of the five lines it plays round-2 directed #4, then A, then B, then C, with 0.8 s gaps.

## Index of compare-round3.mp3

| Time | Line | Clip |
|---|---|---|
| 0:00.0 | L1 register | round-2 directed #4 (`../round2/processed/v4_reg_directed.mp3`) |
| 0:06.6 | L1 register | A (`A/reg.mp3`) |
| 0:12.7 | L1 register | B (`B/reg.mp3`) |
| 0:18.6 | L1 register | C (`C/reg.mp3`) |
| 0:24.6 | L2 Eikon | round-2 directed #4 |
| 0:30.1 | L2 Eikon | A (`A/eik.mp3`) |
| 0:35.5 | L2 Eikon | B (`B/eik.mp3`) |
| 0:40.3 | L2 Eikon | C (`C/eik.mp3`) |
| 0:45.5 | L3 question | round-2 directed #4 |
| 0:50.0 | L3 question | A (`A/ask.mp3`) |
| 0:54.2 | L3 question | B (`B/ask.mp3`) |
| 0:58.2 | L3 question | C (`C/ask.mp3`): **the same take as B** (see C below) |
| 1:02.2 | L4 list | round-2 directed #4 |
| 1:07.2 | L4 list | A (`A/list.mp3`) |
| 1:12.3 | L4 list | B (`B/list.mp3`) |
| 1:17.4 | L4 list | C (`C/list.mp3`) |
| 1:22.7 | L5 reassurance | round-2 directed #4 |
| 1:28.0 | L5 reassurance | A (`A/calm.mp3`) |
| 1:33.0 | L5 reassurance | B (`B/calm.mp3`) |
| 1:37.7 | L5 reassurance | C (`C/calm.mp3`) |
| 1:41.8 | end | |

**Deliverables**

- `{A,B,C}/{reg,eik,ask,list,calm}.mp3`: 15 files, 48 kHz mono, 192 kbps, measured -16.3 LUFS (ffmpeg ebur128) with peaks at -1.6 to -1.7 dBFS.
- `dry/{A,B,C}_*.wav`: the unprocessed 24 kHz takes that were measured.
- `metrics-round3.json`: every measurement, the chosen settings and the mastering statistics.

## The approaches

### A: Kokoro #4, directed through the text only

The voice is the stock bm_lewis style with RP IPA, as in rounds 1–2.

**How it is steered.** Each sentence is synthesised whole, so coarticulation is kept. The levers are:
- punctuation (comma, ellipsis, em-dash, semicolon, full stop, question mark);
- the full dictionary stress marks, or primary stress `ˈ` on the key word only;
- a speed per sentence (0.80, 0.85 or 0.90).

**Sentence splits.** Lines are split only at sentence boundaries: after "asks for.", after "Eikon," and after "relax.".
The gaps are the marked pauses (450, 900 and 500 ms) over the same faint room tone (-72 dBFS).

**Processing.** None on pitch or gain.

**Selection.** 214 combinations were rendered and measured. The best by score is used.

**Result.** Clean and the closest timbre to #4. A always gets the words right and is calmer than plain.
But Kokoro cannot be made to rise or hold by text alone:
- I tried `?`, `??`, `?!`, the ↗ token, en-us, a yes/no reword and the clause order.
- The question still ends -1.7 to -5.0 st.
- The list goes fall-fall-fall, and "pharmacy…" falls.
- Within this rule (no pitch surgery), A cannot get those contours.

### B: Chatterbox with #4 as the voice prompt

Chatterbox is by Resemble AI. The code and weights are **MIT**.

**Voice prompt.** The prompt is a clean 13.7 s Kokoro bm_lewis 0.85 clip (`work/ref_prompt.wav`).
It is synthetic, on neutral text, not a real person, and not any of the test lines.
Chatterbox takes its timbre from that clip and produces its own whole-line prosody.

**Takes.** 80 takes (16 per line). Each one varies:
- the expressiveness (`exaggeration` 0.5–0.9);
- the pacing (`cfg_weight` 0.25–0.5);
- the seed;
- the text: ellipsis or comma, and "Eikon" or "Eye-kon".

**Processing.** Only one step. If the silence at a sentence boundary is shorter than the mark, room tone is inserted at the quietest point of that existing silence.
It was used mainly to open the beat after "Eikon" to 900 ms.

**Selection.** The take with the best score is used. If the delivered MP3 is misheard, the next-best take is used instead (this happened once, on L1).

**Result.** B is the most natural-sounding of the three by the MOS predictor. Its rises, lifts and holds come from the model itself, not from pitch shifting.

### C: hybrid, the most natural take that also makes the marks

**Pool.** The 8 best A takes and all 80 B takes for each line.

**Two-sentence lines (L1, L2, L5).** Each take is cut inside the silence at the sentence boundary. The candidate sentences are ranked by UTMOS and timbre.
The top 4 × 4 pairings are re-joined with the marked pause and measured as whole lines. A pairing gets a bonus if every marked phrase ending passes.

**One-sentence lines (L3, L4).** C is the highest-UTMOS take whose phrase endings all pass.

**Mixing engines.** Kokoro and Chatterbox could be mixed within a line, but only when their timbres are within 0.05 and at a small penalty. No Kokoro sentence ever won.
So **C is all Chatterbox**: two-take splices on L1, L2 and L5, a different take on L4, and the same take as B on L3 (the only B take that both rises and scores high).
On L2 the top pairing was misheard on the MP3, so the second one was used.

### Considered, not used

- **Parler-TTS (Apache-2.0).** Delivery is set by a text description, with no reference audio. So it cannot hold #4's timbre.
- **StyleTTS2 (MIT code).** Its usable checkpoints carry extra use terms, and it needs a GPL espeak phonemizer at runtime. Chatterbox covered the same need.
- **F5-TTS and XTTS.** Skipped because their licences are non-commercial.

## Mastering (light)

The chain is gentle EQ, then gain to -16 LUFS, then a look-ahead peak limiter at -1.5 dBFS. The limiter has a 1.5 ms look-ahead and 25 ms release.
- **EQ:** high-pass at 70 Hz, +1 dB at 3.2 kHz and -0.8 dB at 180 Hz.
- **Removed from rounds 1–2:** there is **no compressor and no reverb/room**. The earlier chain used 2.2:1 compression plus an echo "room".

Measured choices:
- The round-1 compressor lowered UTMOS on the MP3s by about 0.05 (B 4.04 → 3.98).
- A phase-rotation trick that lowers peaks cost 0.17 (B 4.20 → 4.04). Both were left out.
- The limiter alone costs about 0.03.

**Be aware:** these TTS waveforms are peaky. The peak sits about 21–22 dB above the loudness.
Reaching -16 LUFS therefore needs real peak limiting:
- **A:** 5–10 dB on the loudest peaks, with the limiter active on 19–33 % of samples;
- **B and C:** 2.5–14.5 dB, active on 28–48 % (`metrics-round3.json`, field `peak`).

If that ever sounds squashed, the dry WAVs at about -19 LUFS would need almost no limiting.

## What was measured, and how it maps to "natural"

All of this is done by `scripts/m3.py`, the same code for round 2 and round 3, on the dry 24 kHz files. Words, UTMOS and timbre are measured again on the delivered MP3s.

**Naturalness**
- **UTMOS22-strong MOS prediction:** an ONNX export, MIT, `TigreGotico/utmos-onnx`.
- **Pitch jumps:** jumps of more than 4 st between 10 ms frames inside a word.
- **Flat segments:** "robotic" stretches of 250 ms or more with a pitch SD below 0.3 st.
- **Voice quality:** Praat jitter and shimmer (local).
- **Splices:** the largest frame-to-frame log-mel change in speech, as a multiple of the median. Splices show up as outliers.

**Is UTMOS a fair stand-in for John's ear?** The same predictor scores round-2 plain #4 at **4.05** (mean of 5 lines) and round-2 directed at **3.48**.
That agrees with his verdict that directed sounds artificial while plain has the good tone.

**Direction** (as in round 2, with word times from Whisper)
- **Stress:** a key word passes when 2 of 3 clear +1 st, +1 dB or +10 % per phoneme against its nearest unstressed neighbours.
- **Phrase ends:** the last 150 ms of voicing against the phrase median. Fall ≤ -2 st, rise ≥ +2, lift ≥ +0.5, hold ≥ -1.5.

**Words:** faster-whisper small.en. "Eikon" counts when heard as Icon or Ikon.

**Pace:** wpm over the speech span, in-line pauses included.

**Timbre:** cosine of resemblyzer d-vectors (Apache-2.0) against a *held-out* Kokoro #4 clip, which is not the Chatterbox prompt.
For scale, Kokoro's own plain #4 lines score 0.84–0.93 against it.

## Results: summary

| Version | Mean UTMOS (dry) | Mean UTMOS (MP3) | Mean timbre cos vs #4 | Lines word-perfect (MP3) | Stress words passing | Phrase ends passing | Pitch jumps >4 st | Mean wpm |
|---|---|---|---|---|---|---|---|---|
| Round-2 directed #4 | 3.48 | 3.36 | 0.865 | 5/5 | 11/16 | 11/13 | 1 | 127 |
| A Kokoro, text-directed | 4.02 | 3.92 | 0.895 | 5/5 | 11/16 | 6/13 | 0 | 124 |
| B Chatterbox, #4 prompt | 4.33 | 4.19 | 0.872 | 5/5 | 11/16 | 10/13 | 1 | 135 |
| C hybrid (all Chatterbox) | 4.31 | 4.21 | 0.879 | 5/5 | 12/16 | 11/13 | 1 | 128 |

**Notes on the results**
- **No robotic flat stretches.** None were found in any version, and pitch jumps are rare everywhere (0–1 per line).
- **Jitter and shimmer** are 2–4.4 % and 10–15 % in every version, round 2 included. That is the range of creaky, low male connected speech, and no version stands out.
- **Pitch range** is 12–18 st on B and C, against 10–13 on round 2 and A. The movement is wider, and here it is the model's own, not imposed.
- **No splices stand out.** The largest mel-flux is 3.6–6.8 × the median on B and C, against 3.3–8.3 on A and 3.3–6.6 on round 2.
- **"Eikon" is heard as "Icon"** in every delivered clip. Four of the 16 B takes of L2 were misheard ("I can", "ACON", "ICOM") and were never picked.
- **Pace** is 124–135 wpm on average, inside 120–140. L2 is about 105–120 wpm because of its 0.9 s beat, and L3 runs 147–156.

## Full measurement table

Stress deltas are pitch st / energy dB / duration %. ✗ marks a miss.

| Line | Version | UTMOS dry / MP3 | Timbre cos vs #4 | Words (small.en, MP3) | Stress words passing (pitch st / energy dB / duration %) | Phrase ends (st; ✗ = miss) | Pitch jumps >4 st in a word | Flat (s) | F0 range st | Jitter % / shimmer % | Max mel-flux (× median) | Pauses ms | wpm |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| L1 register | R2 directed | 3.53 / 3.43 | 0.866 | every register an inspector asks for ready before they walk in | 4/5: register ✗ -0.4/+5.1/-44; asks +1.1/+3.6/-25; ready +9.7/+8.2/-27; before +9.2/+5.7/-8; walk +3.2/+4.3/-23 | fall -7.2, hold -0.4, fall -7.1 (3/3) | 0 | 0.0 | 13.4 | 2.69 / 10.88 | 4.8 | 250, 450, 300 | 132 |
| L1 register | A Kokoro text-directed | 4.06 / 3.93 | 0.903 | Every register an inspector asks for, ready before they walk in. | 3/5: register +4.0/+6.2/-54; asks ✗ -0.3/+3.7/-9; ready +7.0/+10.9/-81; before +6.4/+4.2/-27; walk ✗ +0.0/+4.1/-23 | fall -5.1, hold -4.4 ✗, fall -2.2 (2/3) | 0 | 0.0 | 12.1 | 3.12 / 13.36 | 4.9 | 230, 555, 260 | 137 |
| L1 register | B Chatterbox | 4.32 / 4.23 | 0.895 | every register an inspector asks for ready before they walk in | 4/5: register +4.9/+3.1/-64; asks +17.9/+5.6/-13; ready +7.5/+10.8/-79; before +9.8/+6.4/-13; walk ✗ -0.3/+1.9/-47 | fall -7.8, hold -0.0, fall -2.9 (3/3) | 1 | 0.0 | 17.1 | 3.71 / 13.82 | 6.8 | 105, 515, 365 | 145 |
| L1 register | C hybrid | 4.32 / 4.21 | 0.909 | Every register an inspector asks for, ready before they walk in. | 4/5: register +4.8/+6.6/-67; asks +3.1/+5.4/-26; ready +6.8/+10.3/-54; before +8.9/+6.6/-39; walk ✗ -1.8/+1.6/-48 | fall -9.1, hold -1.4, fall -2.7 (3/3) | 1 | 0.0 | 14.1 | 3.22 / 11.96 | 5.6 | 85, 550, 215 | 138 |
| L2 Eikon | R2 directed | 3.71 / 3.40 | 0.894 | icon the pharmacy in one calm place | 3/3: eikon +6.8/+14.6/-41; pharmacy +5.2/+10.4/-76; calm +2.4/+3.1/+50 | fall -3.1, hold -2.2 ✗, fall -5.2 (2/3) | 0 | 0.0 | 10.8 | 1.9 / 10.52 | 6.2 | 900, 320, 90 | 107 |
| L2 Eikon | A Kokoro text-directed | 4.00 / 3.84 | 0.933 | Icon. The pharmacy in one calm place. | 3/3: eikon +nan/+4.2/+70; pharmacy +4.5/+7.1/-64; calm +5.1/+1.3/+37 | fall -5.9, hold -8.7 ✗, fall -4.7 (2/3) | 0 | 0.0 | 13.3 | 3.47 / 12.8 | 8.3 | 975, 350 | 103 |
| L2 Eikon | B Chatterbox | 4.28 / 4.05 | 0.880 | ICON. The pharmacy in one calm place. | 3/3: eikon -0.9/+2.6/+133; pharmacy +9.7/+5.7/-60; calm +1.0/+2.4/+31 | fall -8.7, hold -15.9 ✗, fall -3.9 (2/3) | 0 | 0.0 | 17.4 | 3.19 / 11.73 | 5.3 | 900, 235, 80 | 119 |
| L2 Eikon | C hybrid | 4.34 / 4.16 | 0.902 | Icon. The pharmacy in one calm place. | 3/3: eikon +4.7/+4.2/+36; pharmacy +10.3/+7.9/-66; calm +3.9/+3.1/+26 | fall -7.2, hold -8.0 ✗, fall -4.5 (2/3) | 0 | 0.0 | 15.6 | 3.6 / 11.89 | 4.9 | 1005, 340 | 107 |
| L3 question | R2 directed | 3.39 / 3.41 | 0.842 | What if every check was already done? | 1/2: check +5.7/+2.2/+11; done ✗ -4.0/-1.4/+108 | rise +2.3 (1/1) | 0 | 0.0 | 10.8 | 2.37 / 14.99 | 3.3 | 220, 90 | 144 |
| L3 question | A Kokoro text-directed | 4.06 / 3.99 | 0.880 | What if every check was already done? | 1/2: check +10.4/+6.4/+4; done ✗ -5.5/-2.3/+109 | rise -2.1 ✗ (0/1) | 0 | 0.0 | 12.8 | 2.86 / 15.35 | 4.1 | 125, 385 | 147 |
| L3 question | B Chatterbox | 4.35 / 4.27 | 0.841 | What if every check was already done? | 1/2: check ✗ +3.0/-3.6/-20; done +4.6/-0.9/+133 | rise +2.4 (1/1) | 0 | 0.0 | 12.9 | 3.98 / 13.18 | 3.6 | 80, 95, 265 | 156 |
| L3 question | C hybrid | 4.35 / 4.27 | 0.841 | What if every check was already done? | 1/2: check ✗ +3.0/-3.6/-20; done +4.6/-0.9/+133 | rise +2.4 (1/1) | 0 | 0.0 | 12.9 | 3.98 / 13.18 | 3.6 | 80, 95, 265 | 156 |
| L4 list | R2 directed | 3.19 / 3.10 | 0.885 | daily temperatures, controlled drugs and every signature. | 1/3: temperatures +2.7/+1.2/+26; drugs ✗ +0.9/+2.5/-3; signature ✗ -0.1/-3.8/-23 | lift +3.4, lift +2.0, fall -1.6 ✗ (2/3) | 0 | 0.0 | 10.6 | 2.6 / 12.73 | 6.6 | 300, 300 | 124 |
| L4 list | A Kokoro text-directed | 4.10 / 3.98 | 0.942 | daily temperatures, controlled drugs and every signature. | 2/3: temperatures ✗ -1.3/-6.6/-9; drugs -2.4/+4.2/+13; signature +3.5/-6.1/+29 | lift -8.6 ✗, lift -3.9 ✗, fall -2.3 (1/3) | 0 | 0.0 | 12.1 | 4.38 / 14.02 | 5.4 | 330, 325 | 107 |
| L4 list | B Chatterbox | 4.32 / 4.14 | 0.885 | daily temperatures, controlled drugs and every signature. | 1/3: temperatures ✗ +2.5/-6.2/-15; drugs +3.7/+2.8/+202; signature ✗ -0.5/-5.2/-32 | lift -10.2 ✗, lift +1.4, fall -6.2 (2/3) | 0 | 0.0 | 13.7 | 4.06 / 11.92 | 4.6 | 280, 280, 80 | 111 |
| L4 list | C hybrid | 4.18 / 4.11 | 0.884 | daily temperatures, controlled drugs and every signature. | 1/3: temperatures ✗ +2.3/-1.2/-23; drugs +7.4/+3.7/+247; signature ✗ +0.9/-7.6/-31 | lift +2.0, lift +3.7, fall -6.8 (3/3) | 0 | 0.0 | 13.9 | 3.99 / 13.08 | 4.8 | 275, 325 | 105 |
| L5 reassurance | R2 directed | 3.60 / 3.48 | 0.838 | So when they arrive, relax. It's all here. | 2/3: arrive ✗ -2.1/+0.1/+13; relax +3.1/+3.4/-54; all +5.1/+5.1/-20 | hold -0.2, fall -3.8, fall -4.2 (3/3) | 1 | 0.0 | 9.9 | 2.43 / 11.91 | 4.4 | 420, 550 | 128 |
| L5 reassurance | A Kokoro text-directed | 3.89 / 3.84 | 0.818 | So when they arrive, relax. It's all here. | 2/3: arrive +1.6/-0.5/+33; relax ✗ -8.4/-7.5/-52; all +3.0/+3.0/-14 | hold -7.2 ✗, fall -0.4 ✗, fall -2.6 (1/3) | 0 | 0.0 | 12.4 | 3.64 / 13.52 | 4.7 | 375, 125, 585 | 127 |
| L5 reassurance | B Chatterbox | 4.36 / 4.24 | 0.858 | So when they arrive, relax, it's all here. | 2/3: arrive +1.2/+3.7/-7; relax +3.0/+5.4/-62; all ✗ -1.4/+2.9/-51 | hold +2.0, fall -0.5 ✗, fall -5.1 (2/3) | 0 | 0.0 | 13.0 | 4.16 / 12.62 | 3.8 | 255, 95, 500 | 145 |
| L5 reassurance | C hybrid | 4.37 / 4.32 | 0.857 | So when they arrive, relax. It's all here. | 3/3: arrive +0.2/+1.4/+29; relax +2.2/+2.5/-57; all +6.1/+6.4/-19 | hold +7.2, fall -0.2 ✗, fall -6.0 (2/3) | 0 | 0.0 | 18.3 | 3.68 / 10.59 | 3.6 | 255, 95, 745 | 132 |

## Recommendation

**Take C (or B, which is almost the same): Chatterbox, prompted with a clean #4 clip.**

**Why**
- **It sounds the most natural.** It has the highest predicted MOS (4.21 on the MP3s, against 3.36 for round-2 directed and 3.92 for A) and no measurable processing artefacts.
- **It still does what John asked for:**
  - real stress (12/16 key words pass);
  - 11/13 marked phrase endings: the question rises +2.4 st, the list lifts +2.0 and +3.7 then falls -6.8, and "Ready" holds;
  - the 0.9 s beat after "Eikon";
  - all of it produced by the model, not by pitch shifting.
- **A is the safe fallback** if John feels C has drifted from #4. It is plain #4 with better phrasing and pauses, and the closest timbre (0.895), but it cannot rise or hold.

**Check by ear first**
1. **Timbre.** Does C still read as #4? Its timbre score is 0.88 against 0.895 for A, both within the spread of Kokoro's own #4 lines (0.84–0.93), but it is a re-voicing, not the same engine.
2. **The splices in C.** The joins fall inside a natural silence at a sentence boundary, but on L1, L2 and L5 the two halves come from different takes.
   B has no joins at all, apart from the widened Eikon beat.
3. **Production.** For the full script, generate several takes per sentence with B and keep the best, as here. Only about one take in eight rises on a question.

## Limits

- **No ears.** UTMOS, a d-vector and pitch statistics are proxies. UTMOS did agree with John on round 2, but a listening pass is still needed.
- **Chatterbox is stochastic.** Only 2 of 16 L3 takes rise. "walk" (L1) and "signature" (L4) are the weak stresses in every version, because the model puts the weight on "before" and "drugs".
  L5's "relax." does not quite reach the -2 st fall threshold, at -0.2 st.
- **Phrase-end measures on creaky endings are noisy.** Values like -15.9 st come from pitch tracking through creak.
- **Watermark.** Chatterbox embeds Resemble AI's Perth watermark in every output. It is designed to be inaudible and survives MP3. It is part of the MIT release and does not restrict use.
- **The mastering limiter works hard** to reach -16 LUFS (see Mastering).

## Licences

| Component | Licence |
|---|---|
| Kokoro-82M v1.0 and kokoro-onnx, voice bm_lewis | Apache-2.0 / MIT |
| Chatterbox (`chatterbox-tts` 0.1.7, `ResembleAI/chatterbox` weights) | MIT |
| resemble-perth | MIT |
| s3tokenizer | Apache-2.0 |
| UTMOS22-strong ONNX | MIT |
| resemblyzer | Apache-2.0 |
| faster-whisper and Whisper weights | MIT |
| Praat/parselmouth (measurement only) | GPL, not shipped |

All of these allow commercial use. No real person's voice was cloned or imitated: the only voice prompt is synthetic Kokoro #4.

## Reproduce

Run from `video/round3/` with a Python 3.13 venv:
- `torch==2.6.0 torchaudio==2.6.0 transformers==5.2.0 diffusers==0.29.0 safetensors==0.5.3 conformer==0.3.2 resemble-perth s3tokenizer librosa==0.11.0 omegaconf`;
- `kokoro-onnx==0.6.1 faster-whisper praat-parselmouth resemblyzer "setuptools<81" onnxruntime pyloudnorm`;
- `chatterbox-tts==0.1.7 --no-deps`.

Download the Chatterbox weights with `HF_HUB_DISABLE_XET=1`, because the Xet CDN is blocked here.

```
python scripts/ref.py                  # #4 voice prompt + held-out timbre reference
python scripts/baseline_r2.py          # round-2 plain/directed #4 measured with the round-3 code -> work/baseline_r2.json
python scripts/gen_a.py                # A: 214 Kokoro renderings, measured
python scripts/gen_b.py n=6; python scripts/gen_b.py n=10; python scripts/gen_b.py reprocess   # B: 16 takes/line
python scripts/sel_c.py                # C
python scripts/render3.py              # picks, mastering, MP3 re-checks, compare-round3.mp3, metrics-round3.json
python scripts/tables3.py              # tables
```
The venv (6 GB), the Chatterbox weights (3 GB), the UTMOS model (0.4 GB) and the unpicked A renderings were deleted afterwards to save disk.
The B takes and all result JSONs are kept in `work/`.
