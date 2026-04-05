import { parseArgs, main } from '../callrail_qualify_latest_call.mjs';

export default async function handler(req, res) {
  try {
    // Override process.argv so parseArgs picks up the right flags
    const originalArgv = process.argv;
    process.argv = ['node', 'callrail_qualify_latest_call.mjs', '--apply', '--process-all'];

    await main();

    process.argv = originalArgv;
    res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
