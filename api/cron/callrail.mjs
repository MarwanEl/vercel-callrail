import { main as callMain } from '../../callrail_qualify_latest_call.mjs';
import { main as recordingMain } from '../../callrail_qualify_latest_call_recording_transcribe.mjs';
import { main as formMain } from '../../callrail_qualify_latest_form_submission.mjs';

function isLAWindow() {
  const la = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  const hour = new Date(la).getHours();
  return hour >= 0 && hour < 6;
}

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function captureConsole(fn) {
  const lines = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => { const line = args.join(' '); lines.push(line); origLog(...args); };
  console.error = (...args) => { const line = args.join(' '); lines.push(`[ERROR] ${line}`); origErr(...args); };
  const restore = () => { console.log = origLog; console.error = origErr; };
  return { lines, restore };
}

function parseBatchLine(lines) {
  for (const line of lines) {
    const m = line.match(/Batch complete\.\s*Processed=(\d+),\s*Skipped=(\d+),\s*TotalSeen=(\d+)/);
    if (m) return { processed: +m[1], skipped: +m[2], totalSeen: +m[3] };
  }
  // Check for single-call processing or no-target messages
  const hasNoTarget = lines.some(l => /no .*(calls?|form).* found|nothing to process/i.test(l));
  if (hasNoTarget) return { processed: 0, skipped: 0, totalSeen: 0 };
  // If we saw processing but no batch line, it was a single item
  const hasProcessed = lines.some(l => /Update complete|classification|Decision:/i.test(l));
  if (hasProcessed) return { processed: 1, skipped: 0, totalSeen: 1 };
  return { processed: 0, skipped: 0, totalSeen: 0 };
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
  const dateFromQ = typeof req.query.from === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const dateToQ = typeof req.query.to === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  const dateTo = dateToQ || dateStr(now);
  const dateFrom = dateFromQ || dateStr(sevenDaysAgo);

  const results = [];

  for (const accountId of accountIds) {
    const accountResult = { accountId, calls: null, forms: null };

    // --- Calls ---
    try {
      const useRecording = transcribeSet.has(accountId);
      const callArgv = ['--apply', '--process-all', '--account-id', accountId, '--date-from', dateFrom, '--date-to', dateTo];
      const originalArgv = process.argv;
      const { lines, restore } = captureConsole();

      if (useRecording) {
        process.argv = ['node', 'callrail_qualify_latest_call_recording_transcribe.mjs', ...callArgv];
        await recordingMain();
      } else {
        process.argv = ['node', 'callrail_qualify_latest_call.mjs', ...callArgv];
        await callMain();
      }

      restore();
      process.argv = originalArgv;
      const counts = parseBatchLine(lines);
      accountResult.calls = { ok: true, script: useRecording ? 'recording-transcribe' : 'call', ...counts };
    } catch (error) {
      accountResult.calls = { ok: false, error: error.message };
    }

    // --- Forms ---
    try {
      const formArgv = ['--apply', '--process-all', '--account-id', accountId, '--date-from', dateFrom, '--date-to', dateTo];
      const originalArgv = process.argv;
      const { lines, restore } = captureConsole();
      process.argv = ['node', 'callrail_qualify_latest_form_submission.mjs', ...formArgv];

      await formMain();

      restore();
      process.argv = originalArgv;
      const counts = parseBatchLine(lines);
      accountResult.forms = { ok: true, ...counts };
    } catch (error) {
      accountResult.forms = { ok: false, error: error.message };
    }

    results.push(accountResult);
  }

  const hasErrors = results.some(r => !r.calls?.ok || !r.forms?.ok);
  return res.status(hasErrors ? 207 : 200).json({ results, dateFrom, dateTo });
}
