# Vercel CallRail Cron (Deployment Copy)

This folder contains deployment-safe copies of the CallRail classifiers.
Your original/manual scripts in the repo root are unchanged.

## Files

- `callrail_qualify_latest_call.mjs`
- `callrail_qualify_latest_call_recording_transcribe.mjs`
- `callrail_qualify_latest_form_submission.mjs`

## Cron Endpoint

- Route: `/api/cron/callrail`
- Schedule: daily at 1:00 AM America/Los_Angeles (DST-safe via two UTC schedules)
- Default window: past 7 days (`CALLRAIL_LOOKBACK_DAYS`, default `7`)

## Environment Variables (shared names)

Required:
- `CALLRAIL_API_KEY`
- `OPENAI_API_KEY`
- `CALLRAIL_ACCOUNT_IDS` (CSV, order controls account processing)

Optional:
- `CALLRAIL_COMPANY_IDS` (CSV aligned by index to `CALLRAIL_ACCOUNT_IDS`)
- `CALLRAIL_COMPANY_ID` (fallback company id when aligned csv entry is empty)
- `CALLRAIL_TRANSCRIBE_ACCOUNT_IDS` (CSV; these accounts use recording transcription call script)
- `OPENAI_MODEL` (default in scripts: `gpt-4.1`)
- `OPENAI_TRANSCRIPTION_MODEL` (for recording transcription script)
- `RECORDING_MIN_SECONDS` (for recording transcription script)
- `CALLRAIL_LOOKBACK_DAYS` (default `7`)
- `CALLRAIL_INCLUDE_TAGGED` (`1` to include already-tagged unscored records; default `0`)
- `RUN_CALLS` (`1` default)
- `RUN_FORMS` (`1` default)
- `CRON_SECRET` (recommended; send `Authorization: Bearer <secret>`)

## Manual Trigger

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-vercel-domain>/api/cron/callrail?force=1"
```

`force=1` bypasses the 1AM PT hour gate for manual testing.
