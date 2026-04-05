import { parseArgs as parseCallArgs, main as callMain } from '../../callrail_qualify_latest_call.mjs';
import { parseArgs as parseRecordingArgs, main as recordingMain } from '../../callrail_qualify_latest_call_recording_transcribe.mjs';
import { parseArgs as parseFormArgs, main as formMain } from '../../callrail_qualify_latest_form_submission.mjs';

function isLAWindow() {
  const la = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const hour = new Date(la).getHours();
  return hour >= 0 && hour < 6;
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

export default async function handler(req, res) {
  // Auth
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${secret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const force = req.query.force === '1';
  if (!force && !isLAWindow()) {
    return res.status(200).json({ skipped: true, reason: 'Outside LA 1am window' });
  }

  const accountIds = (process.env.CALLRAIL_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (accountIds.length === 0) {
    return res.status(500).json({ error: 'CALLRAIL_ACCOUNT_IDS not configured' });
  }

  const transcribeSet = new Set(
    (process.env.CALLRAIL_TRANSCRIBE_ACCOUNT_IDS || '').split(',').map(s => s.trim()).filter(Boolean)
  );

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dateTo = dateStr(now);
  const dateFrom = dateStr(sevenDaysAgo);

  const results = [];

  for (const accountId of accountIds) {
    const accountResult = { accountId, calls: null, forms: null };

    // --- Calls ---
    try {
      const useRecording = transcribeSet.has(accountId);
      const callArgv = ['--apply', '--process-all', '--account-id', accountId, '--date-from', dateFrom, '--date-to', dateTo];
      const originalArgv = process.argv;

      if (useRecording) {
        process.argv = ['node', 'callrail_qualify_latest_call_recording_transcribe.mjs', ...callArgv];
        await recordingMain();
      } else {
        process.argv = ['node', 'callrail_qualify_latest_call.mjs', ...callArgv];
        await callMain();
      }

      process.argv = originalArgv;
      accountResult.calls = { ok: true, script: useRecording ? 'recording-transcribe' : 'call' };
    } catch (error) {
      accountResult.calls = { ok: false, error: error.message };
    }

    // --- Forms ---
    try {
      const formArgv = ['--apply', '--process-all', '--account-id', accountId, '--date-from', dateFrom, '--date-to', dateTo];
      const originalArgv = process.argv;
      process.argv = ['node', 'callrail_qualify_latest_form_submission.mjs', ...formArgv];

      await formMain();

      process.argv = originalArgv;
      accountResult.forms = { ok: true };
    } catch (error) {
      accountResult.forms = { ok: false, error: error.message };
    }

    results.push(accountResult);
  }

  const hasErrors = results.some(r => !r.calls?.ok || !r.forms?.ok);
  return res.status(hasErrors ? 207 : 200).json({ results, dateFrom, dateTo });
}
