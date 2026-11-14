# Research behind the build

What similar products and studies do, and what Rise took from each. Collected November 2026.

## Phone-video sit-to-stand

- **Sit2Stand (Boswell et al., npj Digital Medicine 2023)** found sit-to-stand events from peaks in the nose's vertical path, after a 6 Hz low-pass filter, with keypoints normalised by body height. Test time agreed with motion capture at r = 0.997. Of 489 home videos, 84 were unusable. The main reasons were filming straight-on (34), long pauses (29), being too close or out of frame (25), using the arms (20) and a soft chair (2). [PMC9985590](https://pmc.ncbi.nlm.nih.gov/articles/PMC9985590)
  - *Rise:* asks for a side or 45° view, checks framing before recording, flags arms and prompts "keep going" after long pauses.
- **Exer Scan (IJSPT 2025):** a 2D side-view camera for a 30-second test on an 18-inch chair. Power estimates matched force plates (r = 0.93–0.95), and test–retest ICC was 0.94. [IJSPT](https://ijspt.scholasticahq.com/article/158667-from-force-plates-to-ai-establishing-validity-and-reliability-of-a-2d-ai-camera-system-for-quantifying-sit-to-stand-power-measurement)
- **MediaPipe BlazePose sit-to-stand (Sensors 2025):** test–retest ICC 0.81–0.99, phone on a tripod at about 90 cm. [MDPI](https://mdpi.com/1424-8220/25/10/3122)
- **Waist-worn phone, 30-second test:** reps were counted correctly 98.7% of the time, but only after the peak thresholds were tuned (71% before). Recordings shorter than 28 seconds were flagged. [NTU](https://irep.ntu.ac.uk/id/eprint/52324/1/2231187_Sher.pdf)
  - *Rise:* thresholds are written down in one place so they can be tuned, and short captures are rejected.

## How camera health apps handle capture quality

- **Hinge Health TrueMotion:** phone propped 5–6 ft away. It infers hidden joints and widens its tracking box when confidence drops. [Hinge R&D](https://rnd.hingehealth.com/blog/seeing-what-isnt-there-3d-pose-estimation)
- **Kaia Motion Coach:** phone on the floor against a wall, 6–10 ft away, in a bright room. [Kaia](https://help.kaiahealth.com/article/39-getting-started-with-motion-coach)
- **Sword Health:** the tablet sits in a stand, and a guided positioning step runs before every exercise. [Sword IFU](https://edge-content-cdn.swordhealth.com/DT_IFUPUK_EN_02_e425feed58/DT_IFUPUK_EN_02_e425feed58.pdf)
- **Spren (photo body scan):** phone propped and still, a tilt indicator, and a skeleton that turns from red to green. The photo is taken automatically once everything is green, and the scan is retaken if needed. [Spren](https://help.spren.com/article/655-new-scan-process-phone-position-and-pose)
  - *Rise:* live skeleton overlay, tilt check, automatic start after 2 s of all-green.
- **Bodygram:** front A-pose with arms 25–35° out, side view with feet together. [Bodygram](https://docs.bodygram.com/platform/pose-guidelines)
- **ZOZOFIT:** scans fail when the phone is tilted, lighting is uneven, or a window is behind the person. [ZOZO](https://help.zozofit.com/hc/en-us/articles/41713936839699-Why-is-my-scan-failing)
  - *Rise:* checks for backlight and blown-out windows.
- **Lens smudges:** iOS 26 has lens-cleaning hints, but only inside Apple's Camera app; third-party apps can't use them. [iGeeksBlog](https://www.igeeksblog.com/ios-26-lens-cleaning-hints/)
  - *Rise:* runs its own blur and haze check, with thresholds to be tuned on real phones.

## Protein and exercise on GLP-1s

- **2025 joint advisory (ACLM, ASN, OMA, The Obesity Society):**
  - Protein: 1.2–1.6 g/kg/day during active weight loss, or about 80–120 g/day. Actual weight can overstate needs, and about 1.5 g/kg of lean mass may fit better.
  - Exercise: strength training at least 3 days a week, and at least 150 minutes a week of aerobic activity.
  - Monitoring: track function with sit-to-stand, stair climbing or timed up-and-go. Smartphone body composition methods are "under development".
  - [Full text](https://cme.cecentral.com/sites/default/files/course/2026-06/Nutritional%20Priorities%20to%20Support%20GLP-1%20Therapy%20for%20Obesity.pdf)
  - *Rise:* plan targets come from `server/src/norms.js` and `plan.js`.
- **CDC STEADI 30-second chair stand:**
  - 17-inch armless chair, arms crossed on the chest.
  - A stand more than halfway up at 30 s counts.
  - Using the arms scores 0.
  - Age and sex cut-offs are in `norms.js`.
  - [STEADI form](https://www.nj.gov/humanservices/doas/forms/STEADI-Assessment-30Sec-508.pdf)

## Photo body composition accuracy

| Method | Compared with | Error | Notes and source |
|---|---|---|---|
| 2D photo deep learning | DXA | MAE 2.34% body fat; limits of agreement −4.7 to +6.4 | [medRxiv](https://www.medrxiv.org/content/10.1101/2021.06.10.21258595v1.full) |
| Prism 3D phone scan | DXA | MAE about 3.4%; limits of agreement about ±8.7% | [Frontiers 2024](https://www.frontiersin.org/articles/10.3389/fmed.2024.1485450/full) |
| Navy circumference equation (the method the Rise scan uses) | DXA, 609 Marines | Individual limits of agreement roughly ±7–9 points; men underestimated by about 2.5%, women overestimated by 1.3–2.3% | Good for classification, weak for tracking. [Frontiers 2022](https://www.frontiersin.org/articles/10.3389/fphys.2022.868627/full) |

*What Rise does with this:* labels its own scan as an estimate, compares only same-device scans, and supports importing DEXA, InBody or smart-scale results. A licensed SDK is the path to better accuracy.

## Thresholds chosen from this

| Setting | Value | Why |
|---|---|---|
| Watch threshold | 2 stands below baseline for every tier | A 1-stand drop is within test–retest noise. A Cal Athletics staff interview also stressed that a screen is only useful if it flags a few people, not most. |
| Check in (Higher tier) | 3 stands | |
| Check in (Standard tier) | 4 stands | |
| Rep signal | Hip rise ≥ 0.65 thigh lengths with knee > 150° counts as up; < 0.25 counts as down; 0.7 s minimum between stands | Suggested from the literature. Tune on recorded videos. |
| Reject a capture | Tracking below 75% of frames, or any gap over 2.5 s | |
