# Eikon — Registers & inspection: pilot film script

Length 72.0 s · 1920×1080, 30 fps · voice C (Chatterbox, prompted with the clean synthetic #4 clip) · narration mastered to -16 LUFS.

**The story, not a feature list.** An inspector walks in and asks for the registers. Eikon has them ready: today's registers on one screen, a fridge logged in one tap, a month of temperatures at a glance with the missed day standing out, the monthly sign-off, controlled drugs kept by medicine with a running balance (and a nudge to count when the numbers do not add up), the Inspection check that says what to put right, and the whole pack printed in one tap.

**Narrator's marks** (as in round 2): CAPS = stressed word · | = short pause · ‖ = sentence pause · ‖‖ = held beat · … = held (level) ending. "Eikon" is said EYE-kon. Plain, warm, confident; short sentences. Pace: sentences are delivered at about 140–150 words a minute; with the pauses between them the film runs at 122 words a minute overall.

Each sentence was recorded as several takes; the take used, its scores and the pause marks it was fitted to are in `timing.json` (`chosen`). Planned times are the timeline the narration was laid on; measured times are the faster-whisper word starts on the mastered narration.


## The problem

Title card "Eikon — Registers & inspection" (the Atlas mark, as in the app's side rail). It holds while the inspector walks in, then dissolves into the app on "order".

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 01 | An INSPECTOR walks in… ‖ and asks to see your REGISTERS. | after “in” 420 | 0:01.00–0:04.91 | **—**  — Title card holds. |
| 02 | With EYE-kon… \| they're ALREADY in ORDER. | after “eikon” 380 | 0:05.46–0:08.28 | **order** 0:07.80 — Title card dissolves (0.7 s) into the Today screen; the cursor appears. |

## Today's registers

What is due today, on one screen; the fridge logged without leaving it.

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 03 | OPEN Registers. ‖ Today's registers lists what is DUE, \| and what is DONE. | after “registers” 420, after “due” 180 | 0:09.23–0:14.70 | **registers** 0:09.57 — Click Registers in the side bar: the Registers screen opens.<br>**today's** 0:10.99 — Spotlight on Today's registers.<br>**due** 0:12.87 — Spotlight moves to the rows still to do.<br>**done** 0:14.15 — Spotlight moves to the rows already done. |
| 04 | For the FRIDGE, \| type the LOWEST and the HIGHEST… ‖ ONE TAP, \| and it's LOGGED. | after “fridge” 200, after “highest” 380, after “tap” 220 | 0:15.45–0:21.12 | **fridge** 0:15.71 — Gentle zoom (1.18) on the Pharmacy Fridge row; click its min box.<br>**lowest** 0:17.07 — Type 3.4.<br>**and** 0:17.41 — Click the max box.<br>**highest** 0:18.13 — Type 6.1.<br>**one** 0:19.00 — Click Log: the row turns done ("Logged 3.4 to 6.1 °C") and the toast confirms. |

## Daily registers

Temperature: the month at a glance, the missed day, the monthly sign-off.

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 05 | Every DAILY register works the SAME way: \| a MONTH, at a GLANCE. | after “way” 320, after “month” 160 | 0:22.07–0:27.05 | **daily** 0:22.43 — Click the Temperature card: the Temperature register opens on this month.<br>**month** 0:25.31 — Spotlight on the Room's month. |
| 06 | A MISSED day… \| stands OUT. | after “day” 300 | 0:27.55–0:29.72 | **missed** 0:27.67 — Spotlight and zoom (1.22) on 6 Nov, "Not logged" (dashed). |
| 07 | When the month is OVER, \| SIGN it off. ‖ Your NAME, \| and the DATE, \| on RECORD. | after “over” 200, after “off” 420, after “name” 180, after “date” 180 | 0:30.32–0:36.10 | **sign** 0:31.98 — Click "Sign off October": October opens with the sign-off form.<br>**name** 0:33.50 — Click "Sign off October" to confirm.<br>**record** 0:35.38 — Spotlight on "Signed off by Maria Borg on 11 Nov 2026". |

## Controlled drugs

By medicine: in, out, running balance from the last count; "count it now" when more went out than came in.

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 08 | Controlled drugs are kept by MEDICINE. ‖ IN, \| OUT, \| and the running BALANCE, \| line by line. | after “medicine” 420, after “in” 150, after “out” 150, after “balance” 200 | 0:37.35–0:43.67 | **controlled** 0:37.37 — Click "Controlled drugs by medicine" (Registers opened from the side bar in the pause before).<br>**in** 0:40.13 — Click a medicine counted on 31 Oct: its running register opens.<br>**out** 0:40.58 — Spotlight on the In / out column.<br>**balance** 0:41.73 — Spotlight on the Balance column. |
| 09 | If more went OUT than came IN, \| it tells you: \| COUNT it NOW. | after “in” 300, after “you” 380 | 0:44.42–0:49.68 | **if** 0:44.43 — Click "All medicines".<br>**tells** 0:47.30 — Spotlight and zoom (1.2) on Lorazepam 1mg: "Check: 14 more supplied than received — count it now". |

## The inspection pack

The Inspection check, then the whole pack in one tap.

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 10 | Before an INSPECTOR comes, \| the INSPECTION check reads EVERY register, \| and tells you EXACTLY what to put RIGHT. | after “comes” 200, after “register” 240 | 0:50.93–0:58.32 | **before** 0:50.95 — Registers (side bar, in the pause before); scroll to the Inspection check card.<br>**inspection** 0:53.07 — Click the Inspection check: it reads every register.<br>**exactly** 0:56.69 — Spotlight on the verdict and the Temperature line (6 Nov not logged). |
| 11 | Then ONE TAP… \| prints the WHOLE pack. ‖ Every REGISTER. ‖ Every SIGNATURE. ‖ In ORDER. | after “tap” 220, after “pack” 420, after “register” 340, after “signature” 340 | 0:58.92–1:05.55 | **one** 0:59.35 — Click "Print inspection pack": the pack slides in as a print preview.<br>**every** 1:02.21 — The preview moves to the contents (every register).<br>**every** 1:03.47 — The preview moves on to the sign-off page. |

## End

End card: "Ready, before they walk in." and eikonhq.com.

| # | Narration (marked) | Pause marks (ms) | Spoken | On-screen action, cued to the word in **bold** |
|---|---|---|---|---|
| 12 | EYE-kon. ‖‖ READY… \| beFORE they walk in. | after “eikon” 520, after “ready” 300 | 1:06.65–1:09.41 | **eikon** 1:06.67 — End card dissolves in (0.7 s), cursor gone. |

**Between sentences** (planned silence, s): before 02: 0.55, before 03: 0.95, before 04: 0.75, before 05: 0.95, before 06: 0.5, before 07: 0.6, before 08: 1.25, before 09: 0.75, before 10: 1.25, before 11: 0.6, before 12: 1.1; narration starts at 1.0 s.

