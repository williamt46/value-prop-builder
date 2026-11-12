# Coach demo: vet clinic no-show killer

A recorded brain-dump session (12 Nov 2026), ready to show without waiting on the model.

## Before the demo
1. Restart the dev server so it has the coach code: `npm run dev` (or `PORT=3100 node dev-server.mjs`).
2. Open `http://127.0.0.1:<port>/demo/vet-no-show` in the browser you will present from and click **Restore demo**.
   Browser storage is per address, so do this on the same port you will demo on.

You land on the filled workbook with the coach panel open: the pasted notes, the fill, three answered
questions, a second fill, and the coach's summary with **The Assignment**.

## During the demo
- **Undo AI fill** shows the workbook as it was before the coach (just "Small independent veterinary clinics.").
  Restore the demo page again to get the filled version back.
- Typing in the coach box continues the recorded session live (needs Claude Code signed in).
  Note: the recorded session also contains one later test turn ("I undid your fill…"), which the model remembers.
- To run it live instead, click the reset icon in the panel, then paste the notes below and click **Fill my workbook**.
  A run takes about 2 minutes plus your three answers.
- Read-only copy saved in the database: `http://127.0.0.1:<port>/?w=0y_ahYODp0CY`.

## The notes that were pasted
> ok so the idea: no-show killer for small vet clinics. my sister Dana runs Riverbend Animal Clinic (3 vets, Portland) and she says ~12% of appts no-show, each one is ~$180 lost. they use AVImark and the front desk calls everyone the day before, takes Maria (front desk) like 90 min every afternoon. they tried the built-in text reminders but people ignore them. idea is reminders where you can rebook/cancel in one tap and the slot auto-fills from a waitlist. Dana said she'd pay $200/mo if it cut no-shows in half. talked to 2 other clinics, one said "interesting", one said they already use PetDesk. ~30k independent vet practices in the US. I think the waitlist data could be a moat?? not sure. clinics hate switching software.

Answers given: waitlist → "I don't know"; appointments per week → "About 150 a week across the 3 vets."; why now → "Front desk stretched".

## Files
- `vet-no-show.html` — the restore page (snapshot embedded), served at `/demo/vet-no-show`.
- `vet-no-show.snapshot.json` — the same snapshot as plain JSON.
- `build-vet-no-show.mjs` — rebuilds both from the SDK session file in `~/.claude/projects/-Users-kabst-value-prop-workbook-coach/`.
