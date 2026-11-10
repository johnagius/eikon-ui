# Eikon narration: voice samples, round 1

The brief: a mature, warm, measured, authoritative British male narrator. Stock voices only;
no real person's voice is cloned or imitated. Phase 1 covers voice samples only.

**Listen to:** `shortlist-round1.mp3` (87 s). It plays the 8 shortlisted samples in order with 0.8 s gaps.
Each sample says both test lines:
*"Every register an inspector asks for. Ready before they walk in."* then *"Eikon. The pharmacy, in one calm place."*

## Index of shortlist-round1.mp3

| Time | # | Sample (file in `shortlist/processed/`) |
|---|---|---|
| 0:00.0 | 1 | `1_kokoro_george70-lewis30_speed0.88_phon.mp3` |
| 0:10.9 | 2 | `2_kokoro_bm-george_speed0.88_phondash.mp3` |
| 0:21.9 | 3 | `3_kokoro_george50-lewis50_speed0.85_ellipsis.mp3` |
| 0:33.2 | 4 | `4_kokoro_bm-lewis_speed0.85_phon.mp3` |
| 0:44.3 | 5 | `5_kokoro_george40-lewis60_speed0.88_phondash.mp3` |
| 0:55.2 | 6 | `6_kokoro_george50-lewis30-fable20_speed0.88_phondash.mp3` |
| 1:05.8 | 7 | `7_kokoro_lewis60-daniel40_speed0.85_ellipsis.mp3` |
| 1:16.5 | 8 | `8_piper_vctk-p226_speed0.90_dash.mp3` |
| 1:26.9 | end | |

Unprocessed versions of the same 8 (peak-normalised only) are in `shortlist/dry/*_dry.mp3`.

## Engines and licences

| Engine / voice | Code licence | Voice/model licence | Commercial use | Used? |
|---|---|---|---|---|
| **Kokoro-82M v1.0** (hexgrad), run via `kokoro-onnx` 0.6.1 | kokoro-onnx: MIT | **Apache-2.0** (model card `cards/kokoro-README.md`) | Yes, no attribution required (keep the licence notice) | **Yes**: bm_george, bm_lewis, bm_daniel, bm_fable and blends |
| Piper `piper-tts` 1.8.0 | GPL-3.0 (engine only; GPL does not cover audio it outputs) | n/a | n/a | engine |
| Piper en_GB **vctk** medium | | **CC BY 4.0** (VCTK corpus, Univ. of Edinburgh) | Yes, **with attribution** | Yes (p226, p254, p274, p287) |
| Piper en_GB **aru** medium | | **CC BY 4.0** (Liverpool ARU corpus) | Yes, **with attribution** | Yes (speakers 01, 05) |
| Piper en_GB **northern_english_male** medium | | **CC BY-SA 4.0** (OpenSLR 83) | Yes, attribution + share-alike | Yes |
| Piper en_GB **alan** | | Mimic3 "apope" dataset: **"Copyright 2022 Mycroft AI, All Rights Reserved"**, and based on a real person's voice | **No** | **Excluded** |
| Piper en_GB **semaine** | | **CC BY-NC-SA 4.0** | **No** (non-commercial) | **Excluded** |

Caveat on Piper: every Piper "medium" voice is fine-tuned from the US "lessac" checkpoint, whose original
dataset terms are less clear-cut than the per-voice cards. Kokoro has no such caveat, which is another
reason it is preferred. Speech recognition is faster-whisper "base" (MIT), used here only for measurement.

How the files were obtained: Kokoro weights came from the kokoro-onnx GitHub release (`model-files-v1.0`;
it is the same Apache-2.0 Kokoro-82M v1.0). Piper voices and Whisper came from huggingface.co. Hugging Face
now serves downloads from `us.aws.cdn.hf.co`, so that host was added to the session's network allowlist
(the owner approved it at the prompt). No PyTorch: everything runs on CPU through ONNX Runtime.

## What was generated (456 dry clips plus 456 processed)

- **Kokoro** (lang `en-gb`): bm_george, bm_lewis, bm_daniel, bm_fable, and blends of their style vectors:
  george50-lewis50, george60-fable40, lewis60-daniel40 (round 1a), plus george70-lewis30, george40-lewis60
  and george50-lewis30-fable20 (round 1b, added after George/Lewis blends led the first ranking).
- **Piper**: northern_english_male. VCTK p226/p254/p274/p287 and ARU 01/05 were chosen by pitch screening
  of 15 English VCTK males and all 12 ARU speakers (lowest, steadiest male voices kept).
- **Speeds** 0.85, 0.90, 0.95, 1.00 (round 1b adds 0.88 and 0.92). For Piper, speed is applied as length_scale divided by speed.
- **Phrasing variants**:
  - `plain`: the text as given.
  - `dash`: an em-dash pause.
  - `ellip`/`ellipsis`: "Every register an inspector asks for... Ready, before they walk in." / "Eikon... The pharmacy... in one calm place."
  - `phon`: **stress/phoneme hints (Kokoro only)**. Hand-corrected IPA: RP **/ɑːsks/** (espeak en-gb gave a northern short /a/),
    clear "every" /ˈɛvɹi/, a full **"EYE-kon" /ˈaɪkɒn/** (espeak reduces it to "EYE-kun" /ˈaɪkən/), stress on "beFORE", and "one" as /wʌn/.
  - `phondash`: `phon` with an em-dash pause.
  - `respell` (Piper only): "Icon" in place of "Eikon".
- **Processing** (`scripts/process.py`, applied to every clip in `processed/` and to the shortlist): 250 ms lead-in, high-pass 60 Hz,
  +2 dB at 160 Hz (warmth), -1 dB at 3.2 kHz and a -1.5 dB shelf from 7.5 kHz (softens edge), 2.2:1 compression
  (-21 dB threshold, soft knee), a subtle room (three early reflections at 19/37/53 ms, -21 to -29 dB), then two-pass
  loudnorm to **-16 LUFS, -1.5 dBTP**, 48 kHz mono MP3 at 192 kbps. Shortlist measured result: -16.2 to -16.4 LUFS, peak -1.8 dB, no clipping.

## How each clip was measured (I cannot listen)

Scripts: `scripts/analyze.py` and `scripts/score.py`. Every metric for every clip is in `metrics_all.csv` and `metrics_all_scored.json`.

- **Pace**: words per minute over the speech span. The target is about 140 wpm for the register line; about 120 wpm for the short brand line, because of its deliberate pause.
- **Pauses**: internal silences of at least 80 ms (librosa split, 38 dB). Sentence-break pauses should be 0.25–0.75 s (0.35–1.0 s for ellipsis); any pause over 1.1 s is penalised.
- **Pitch** (Praat via parselmouth, cross-checked with librosa pyin): mean F0, 5–95 % range and SD in semitones, frame-to-frame
  movement, glitch jumps (>4 semitones in 10 ms), and the final fall (how far the last quarter sits below the median).
- **Voice quality**: harmonics-to-noise ratio (HNR; higher is cleaner) and warmth (energy at 100–500 Hz relative to 2–6 kHz, in dB).
- **Loudness and clipping**: integrated LUFS, peak level, and runs of full-scale samples. Piper peak-normalises to 0 dBFS, so it has single full-scale
  samples, but no clip has a run of 3 or more samples, so none is counted as clipped.
- **Intelligibility**: faster-whisper base transcribes each clip and the transcript is scored for WER against the script.
  "Eikon" counts as correct when heard as Icon/Ikon/"I can". "an" heard as "and" counts as half an error, because base Whisper does that with almost every voice.
- **Score out of about 105** = intelligibility 45, pace 20, pitch movement 15 (+3 for a final fall, -1 per glitch), pauses 10, warmth/HNR 10, depth 8 (full marks at a mean F0 of 105 Hz or below).

### Findings across all 456 clips

| Voice | Mean score | Mean WER | wpm (register line) | Mean F0 | Pitch SD (st) | HNR |
|---|---|---|---|---|---|---|
| Kokoro george70-lewis30 | 93.4 | 0.025 | 140 | 131 Hz | 3.8 | 11.9 |
| Kokoro bm_george | 91.6 | 0.025 | 139 | 143 Hz | 3.8 | 13.4 |
| Kokoro george40-lewis60 | 91.5 | 0.025 | 142 | 116 Hz | 4.2 | 9.9 |
| Kokoro george50-lewis30-fable20 | 91.2 | 0.025 | 144 | 125 Hz | 4.0 | 10.8 |
| Kokoro george50-lewis50 | 90.4 | 0.025 | 143 | 121 Hz | 4.1 | 10.2 |
| Kokoro bm_lewis | 89.9 | 0.025 | 144 | 91 Hz | 3.9 | 6.8 |
| Kokoro lewis60-daniel40 | 87.0 | 0.025 | 154 | 107 Hz | 3.9 | 8.7 |
| Kokoro george60-fable40 | 86.1 | 0.025 | 149 | 134 Hz | 4.0 | 12.0 |
| Kokoro bm_fable | 83.3 | 0.033 | 144 | 123 Hz | 4.4 | 9.2 |
| Kokoro bm_daniel | 77.2 | 0.025 | 169 (fast) | 124 Hz | 3.0 | 10.0 |
| Piper aru-01 | 75.2 | 0.167 | 137 | 100 Hz | 2.2 | 12.3 |
| Piper vctk-p274 | 75.1 | 0.189 | 141 | 97 Hz | 2.4 | 12.8 |
| Piper vctk-p226 | 70.8 | 0.220 | 148 | 110 Hz | 2.4 | 14.4 |
| Piper northern_male | 67.5 | 0.067 | 198 (much too fast) | 109 Hz | 1.9 | 9.1 |
| Piper vctk-p287 | 65.5 | 0.217 | 161 | 97 Hz | 2.2 | 12.7 |
| Piper aru-05 | 53.6 | 0.212 | 172 | 105 Hz | 2.3 | 11.5 |
| Piper vctk-p254 | 47.2 | 0.321 | 162 | 80 Hz | 1.7 | 6.7 |

- **Kokoro is clearly the better engine.** Its WER is 2.5 % on every voice, against 7–32 % averaged per Piper voice; Piper misheard "calm" as "come"/"car", and "pharmacy" as "farmers see". Kokoro also has far more natural
  pitch movement (3.8–4.2 st SD against Piper's 1.7–2.4 st, which reads as flat), and every Kokoro sample ends on a clean falling cadence.
- **The phoneme-hint phrasing wins.** Mean score: phondash 91.8, phon 87.4, plain 77.5, dash 77.4, ellipsis 70.6, respell 71.6.
  Its WER is 2.5–2.9 %, against 9.5–15 % for the others. Ellipses make Piper garble words; on Kokoro they give longer, more dramatic pauses.
- **Speed**: 0.85–0.90 lands on 130–145 wpm, the calm target. 1.0 is too brisk for this brief, at 163 wpm on the register line.
- **Depth**: bm_lewis is the deepest (about 90 Hz) but has the lowest HNR (about 7), so it may sound slightly rough or breathy. bm_george is the cleanest (HNR about 13) but lighter (about 143 Hz).
  Blending them gives something between the two, which is why the George/Lewis blends rank highest.

## Round-1 shortlist (8, chosen for diversity)

Pace is given as register line / brand line. Pauses are in seconds, for the register line / the brand line.

| # | Score | wpm | Pauses (s) | Mean F0 Hz | Range st | SD st | Final fall st | HNR | Warmth dB | WER |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 94.3 | 137 / 136 | 0.41, 0.26 / 0.26 | 130 | 13.7 | 3.87 | -2.7 | 11.9 | 13.6 | 0.049 / 0.000 |
| 2 | 93.3 | 136 / 134 | 0.23, 0.28 / 0.25 | 143 | 14.3 | 3.74 | -2.6 | 13.7 | 14.6 | 0.049 / 0.000 |
| 3 | 94.0 | 134 / 130 | 0.44, 0.28 / 0.08, 0.33 | 121 | 13.2 | 4.00 | -2.2 | 10.1 | 13.1 | 0.049 / 0.000 |
| 4 | 93.1 | 135 / 131 | 0.52, 0.34 / 0.14, 0.33 | 92 | 12.0 | 4.01 | -2.2 | 7.0 | 9.6 | 0.049 / 0.000 |
| 5 | 92.2 | 140 / 136 | 0.29, 0.32 / 0.33 | 115 | 13.7 | 4.21 | -2.1 | 9.9 | 12.1 | 0.049 / 0.000 |
| 6 | 92.7 | 143 / 141 | 0.26, 0.28 / 0.26 | 126 | 13.0 | 3.89 | -2.3 | 11.0 | 12.5 | 0.049 / 0.000 |
| 7 | 92.1 | 143 / 139 | 0.38, 0.19 / 0.29 | 108 | 12.8 | 4.13 | -1.1 | 9.1 | 12.4 | 0.049 / 0.000 |
| 8 | 96.2* | 146 / 112 | 0.09 / none | 112 | 10.2 | 2.74 | -1.1 | 14.6 | 14.0 | 0.049 / 0.000 |

(A WER of 0.049 is the "an" heard as "and" half-error. Each processed shortlist file was transcribed again after processing and every word was still correct.)

Why each one is on the list:

1. **Kokoro george70-lewis30, 0.88, phon**: the best Kokoro overall. George's clarity with some of Lewis's weight; calm at 137 wpm, the strongest final fall, and a clean 0.41 s sentence break. **The front-runner.**
2. **Kokoro bm_george, 0.88, phondash**: the clearest, cleanest voice (top HNR and warmth). Lighter and more "senior gentleman" than deep. The em-dash gives a tighter, more conversational join.
3. **Kokoro george50-lewis50, 0.85, ellipsis**: a lower register (121 Hz) and the slowest delivery, with longer dramatic pauses. The most "trailer voice" of the set.
4. **Kokoro bm_lewis, 0.85, phon**: the deepest (92 Hz) and most authoritative, with the longest pause (0.52 s). Lowest HNR, so listen for any roughness.
5. **Kokoro george40-lewis60, 0.88, phondash**: deep-leaning (115 Hz) with the liveliest pitch movement (4.2 st). Rich without Lewis's roughness.
6. **Kokoro george50-lewis30-fable20, 0.88, phondash**: adds bm_fable's storyteller colour; slightly brisker (143 wpm).
7. **Kokoro lewis60-daniel40, 0.85, ellipsis**: a different timbre, low (108 Hz) and crisper. A gentler final fall, so it sounds less "finished".
8. **Piper VCTK p226 (Surrey male), 0.90, dash**: included as the best of the second engine, for comparison. *Its top score is partly luck: Piper is random from run to run, the same voice averaged 22 % WER, and it runs "Eikon" straight into "the pharmacy" with no pause. Its pitch is flatter (2.7 st). Not recommended for long narration.

What to listen for: whether the 0.88 speed feels calm or slow, whether Lewis-heavy voices (4, 5) sound rough,
and whether "EYE-kon" is how the brand should be said. If it should be "AY-kon", the phoneme hint changes to /ˈeɪkɒn/.

## Files

- `shortlist-round1.mp3`: the 8 samples in a row (processed, 48 kHz, 0.8 s gaps).
- `shortlist/processed/*.mp3` and `shortlist/dry/*_dry.mp3`: the 8 samples, each processed and dry, 48 kHz.
- `dry/*.wav`: all 456 raw clips (24 kHz for Kokoro, 22.05 kHz for Piper). `processed/*.mp3`: all 456 processed (-16 LUFS, 48 kHz).
- `metrics_all.csv` / `metrics_all_scored.json`: every measurement, plus the Whisper transcript, for every clip.
- `scripts/`: `gen.py`, `gen2.py`, `analyze.py`, `score.py`, `process.py`, `shortlist.py`, `piper_voices.json`. `cards/`: the licence and model cards.
- `models/`: the Kokoro ONNX model and voices, three Piper voices, and Whisper base (686 MB). `venv/` (Python 3.12): about 1 GB.
