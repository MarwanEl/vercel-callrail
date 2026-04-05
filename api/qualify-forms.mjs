import { parseArgs, main } from '../callrail_qualify_latest_form_submission.mjs';

export default async function handler(req, res) {
  try {
    const originalArgv = process.argv;
    process.argv = ['node', 'callrail_qualify_latest_form_submission.mjs', '--apply', '--process-all'];

    await main();

    process.argv = originalArgv;
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
