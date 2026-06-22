#!/usr/bin/env node

const DEFAULT_ACCOUNT_ID = '435146390';
const DEFAULT_MODEL = 'gpt-4.1';
const HARDCODED_CALLRAIL_API_KEY = '';
const HARDCODED_OPENAI_API_KEY = '';

const TAGS = [
  'Existing Client/Duplicate',
  'JOB APPLICATION',
  'Caller Disconnected',
  'Insurance Company',
  'Treatment provider',
  'SPAM',
  'Human Review',
  'Other',
  'Unrelated Case',
  'Client_Rejected',
];
const DUPLICATE_TAG = 'Existing Client/Duplicate';
const QUALIFIED_TAG = 'Qualified';
const HUMAN_REVIEW_TAG = 'Human Review';
const OTHER_TAG = 'Other';
const CLIENT_REJECTED_TAG = 'Client_Rejected';
const DUAL_SOURCE_TAG = 'Dual Source';
const REFERRAL_SOURCE_TAG = 'Referral / Word of Mouth';
const WORKFLOW_TAGS = [...new Set([...TAGS, QUALIFIED_TAG, DUAL_SOURCE_TAG, REFERRAL_SOURCE_TAG])];

const CALL_FIELDS = [
  'transcription',
  'lead_status',
  'tags',
  'note',
  'company_id',
  'customer_phone_number',
  'customer_name',
  'start_time',
  'duration',
  'answered',
  'voicemail',
  'first_call',
  'recording_duration',
  'direction',
  'tracking_phone_number',
  'business_phone_number',
];

const DUAL_SOURCE_EVIDENCE_PATTERNS = [
  /where\s+did\s+you\s+hear\s+about\s+us/gi,
  /how\s+did\s+you\s+hear\s+about\s+us/gi,
  /how\s+did\s+you\s+find\s+us/gi,
  /where\s+did\s+you\s+find\s+us/gi,
  /how\s+did\s+you\s+find\s+out\s+about\s+us/gi,
  /who\s+referred\s+you/gi,
  /did\s+someone\s+refer\s+you/gi,
  /\breferred\b|\brefer\b|\breferral\b|\brecommended\b|\btold\s+me\b|\bsent\s+me\b/gi,
  /friend|coworker|co-worker|co worker|employee|employer|boss|supervisor|family|relative|mom|mother|dad|father|brother|sister|wife|husband|attorney|lawyer|doctor|chiropractor|chiro|clinic|provider|therapist|previous client|former client|past client|word of mouth|google|online|website|social|facebook|instagram|tiktok|amig[oa]|quiropr[aá]ctico|abogado/gi,
];

const DIGITAL_PASS_ALONG_PATTERNS = [
  /\b(friend|coworker|co-worker|co worker|employee|employer|boss|supervisor|family|relative|mom|mother|dad|father|brother|sister|wife|husband|fianc[eé]e?)\b.{0,120}\b(googled|google|searched|looked\s+(?:you|us|brumley)?\s*up|found\s+(?:you|us|brumley).{0,40}\bonline|found\s+(?:you|us|brumley).{0,40}\bgoogle|saw\s+(?:you|us|brumley).{0,40}\b(?:facebook|instagram|tiktok|social))\b/i,
  /\b(googled|google|searched|online|website|facebook|instagram|tiktok|social)\b.{0,140}\b(friend|coworker|co-worker|co worker|employee|employer|boss|supervisor|family|relative|mom|mother|dad|father|brother|sister|wife|husband|fianc[eé]e?)\b.{0,140}\b(told|sent|shared|recommended|suggested)\b/i,
  /\b(friend|coworker|co-worker|co worker|employee|employer|boss|supervisor|family|relative|mom|mother|dad|father|brother|sister|wife|husband|fianc[eé]e?)\b.{0,100}\b(told|said|suggested)\b.{0,140}\b(look\s+up|google|search|find)\s+(?:a|an|some)?\s*(lawyer|attorney|firm)\b/i,
  /\b(reposted|shared)\b.{0,80}\b(instagram|facebook|tiktok|social|post)\b/i,
];

const NON_DIGITAL_REFERRAL_PATTERNS = [
  /\bi\s+was\s+referred\b/i,
  /\breferred\s+(?:to\s+(?:you|us|brumley)\s+)?by\b/i,
  /\breferral\s+from\b/i,
  /\brecommended\s+by\b/i,
  /\b(friend|coworker|co-worker|co worker|employee|employer|boss|supervisor|family|relative|parent|mom|mother|dad|father|brother|sister|wife|husband)\b.{0,120}\b(referred|recommended|told|sent|gave|passed)\b.{0,140}\b(you|us|brumley|law firm|firm|your number|your name|call)\b/i,
  /\b(?:my|a|our)\s+(chiropractor|chiro|doctor|attorney|lawyer|clinic|provider|therapist)\b.{0,140}\b(referred|recommended|gave|sent|told|passed)\b/i,
  /\b(chiropractor|chiro|doctor|attorney|lawyer|clinic|provider|therapist)\b.{0,140}\b(referred|recommended|gave|sent|told|passed)\b.{0,140}\b(you|us|brumley|law firm|firm|your number|your name)\b/i,
  /\b(previous|former|past|current|existing)\s+client\b.{0,140}\b(referred|recommended|told|gave|sent|passed)\b/i,
  /\bword\s+of\s+mouth\b/i,
  /\bsaw\s+(?:a|your|the)\s+(poster|billboard|sign)\b/i,
  /\b(?:un|una|mi)\s+amig[oa]\b.{0,140}\b(recomend[oó]|refiri[oó]|dio|dieron|pas[oó]|coment[oó])\b/i,
  /\bme\s+(recomend[oó]|refiri[oó]|dieron|dio|pasaron|pas[oó])\b.{0,140}\b(n[uú]mero|brumley|firma|abogado|ustedes)\b/i,
  /\b(quiropr[aá]ctico|doctor|cl[ií]nica|abogado)\b.{0,140}\b(recomend[oó]|refiri[oó]|dio|dieron|pas[oó])\b/i,
];

function printUsage() {
  console.log(`Usage:
  node callrail_qualify_latest_call.mjs [options]

Options:
  --apply                       Actually update CallRail (default is dry-run)
  --process-all                 Process all matching calls (instead of only one)
  --call-id <id>               Process a specific call id instead of latest unscored call
  --force                       Reprocess call even if already lead-scored/tagged (use with --call-id)
  --include-tagged              When auto-selecting, allow not_scored calls that already have tags
  --date-from <YYYY-MM-DD>     Optional local call-date lower bound (inclusive)
  --date-to <YYYY-MM-DD>       Optional local call-date upper bound (inclusive)
  --company-id <id>            Optional CallRail company filter
  --account-id <id>            CallRail account id (default: ${DEFAULT_ACCOUNT_ID})
  --callrail-api-key <key>     CallRail API key (or env CALLRAIL_API_KEY)
  --openai-api-key <key>       OpenAI API key (or env OPENAI_API_KEY)
  --model <model>              OpenAI model (default: ${DEFAULT_MODEL})
  --debug                       Print extra debug context
  --help                        Show this message

Examples:
  node callrail_qualify_latest_call.mjs
  node callrail_qualify_latest_call.mjs --apply
  node callrail_qualify_latest_call.mjs --process-all --date-from 2026-03-01 --date-to 2026-03-31 --apply
  node callrail_qualify_latest_call.mjs --call-id CAL123 --apply
  node callrail_qualify_latest_call.mjs --call-id CAL123 --force --apply`);
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    processAll: false,
    callId: null,
    force: false,
    includeTagged: false,
    dateFrom: null,
    dateTo: null,
    companyId: null,
    accountId: DEFAULT_ACCOUNT_ID,
    callrailApiKey: process.env.CALLRAIL_API_KEY?.trim() || HARDCODED_CALLRAIL_API_KEY,
    openAiApiKey: process.env.OPENAI_API_KEY?.trim() || HARDCODED_OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    debug: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '#') {
      break;
    }
    if (typeof arg === 'string' && arg.trim().startsWith('#')) {
      break;
    }
    if (arg === '--apply') {
      parsed.apply = true;
    } else if (arg === '--process-all') {
      parsed.processAll = true;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--include-tagged') {
      parsed.includeTagged = true;
    } else if (arg === '--date-from') {
      parsed.dateFrom = (argv[i + 1] ?? '').trim() || null;
      i += 1;
    } else if (arg === '--date-to') {
      parsed.dateTo = (argv[i + 1] ?? '').trim() || null;
      i += 1;
    } else if (arg === '--call-id') {
      parsed.callId = (argv[i + 1] ?? '').trim() || null;
      i += 1;
    } else if (arg === '--company-id') {
      parsed.companyId = (argv[i + 1] ?? '').trim() || null;
      i += 1;
    } else if (arg === '--account-id') {
      parsed.accountId = (argv[i + 1] ?? '').trim() || DEFAULT_ACCOUNT_ID;
      i += 1;
    } else if (arg === '--callrail-api-key') {
      parsed.callrailApiKey = (argv[i + 1] ?? '').trim();
      i += 1;
    } else if (arg === '--openai-api-key') {
      parsed.openAiApiKey = (argv[i + 1] ?? '').trim();
      i += 1;
    } else if (arg === '--model') {
      parsed.model = (argv[i + 1] ?? '').trim() || DEFAULT_MODEL;
      i += 1;
    } else if (arg === '--debug') {
      parsed.debug = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  parsed.accountId = normalizeAccountId(parsed.accountId);
  if (!parsed.callrailApiKey) {
    throw new Error('Missing CallRail API key. Pass --callrail-api-key or set CALLRAIL_API_KEY.');
  }
  if (!parsed.openAiApiKey) {
    throw new Error('Missing OpenAI API key. Pass --openai-api-key or set OPENAI_API_KEY.');
  }
  if (parsed.dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.dateFrom)) {
    throw new Error('--date-from must be in YYYY-MM-DD format');
  }
  if (parsed.dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.dateTo)) {
    throw new Error('--date-to must be in YYYY-MM-DD format');
  }
  if (parsed.dateFrom && parsed.dateTo && parsed.dateFrom > parsed.dateTo) {
    throw new Error('--date-from must be <= --date-to');
  }
  if (parsed.processAll && parsed.callId) {
    throw new Error('Use either --process-all or --call-id, not both');
  }

  return parsed;
}

function normalizeAccountId(input) {
  return String(input || '')
    .replace(/#/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .trim();
}

function isLeadScored(call) {
  const raw = String(call?.lead_status ?? '').trim().toLowerCase();
  return raw === 'good_lead' || raw === 'not_a_lead' || raw === 'previously_marked_good_lead';
}

function isQualifiedLead(call) {
  const raw = String(call?.lead_status ?? '').trim().toLowerCase();
  return raw === 'good_lead' || raw === 'previously_marked_good_lead';
}

function getTags(call) {
  return Array.isArray(call?.tags) ? call.tags : [];
}

function tagName(tag) {
  if (typeof tag === 'string') return tag;
  if (tag && typeof tag === 'object' && typeof tag.name === 'string') return tag.name;
  return '';
}

function getTagNames(call) {
  return getTags(call)
    .map((t) => tagName(t))
    .filter(Boolean);
}

function hasTagName(call, wanted) {
  return getTagNames(call).includes(wanted);
}

function canonicalizeTagName(tag) {
  const raw = String(tag || '').trim();
  if (!raw) return '';
  const exact = TAGS.find((t) => t === raw);
  if (exact) return exact;

  const lower = raw.toLowerCase();
  const found = TAGS.find((t) => t.toLowerCase() === lower);
  if (found) return found;

  // Legacy alias support.
  if (lower === 'unrelated case' || lower === 'unrelated case.' || lower === 'unrelated case ') {
    return 'Unrelated Case';
  }
  return raw;
}

function hasAnyTags(call) {
  return getTagNames(call).length > 0;
}

function toJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getDualSourceDetectionText(call) {
  return [call?.transcription, call?.note]
    .map((x) => String(x ?? '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDualSourceEvidenceWindows(text) {
  const haystack = String(text || '').replace(/\s+/g, ' ').trim();
  if (!haystack) return [];

  const windows = [];
  for (const pattern of DUAL_SOURCE_EVIDENCE_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(haystack)) && windows.length < 20) {
      windows.push(haystack.slice(Math.max(0, match.index - 650), Math.min(haystack.length, match.index + 1300)));
    }
  }

  const deduped = [];
  for (const windowText of windows) {
    const key = windowText.slice(180, 420);
    if (!deduped.some((existing) => existing.includes(key) || windowText.includes(existing.slice(180, 420)))) {
      deduped.push(windowText);
    }
  }
  return deduped.length ? deduped : [haystack.slice(0, 2000)];
}

function isDigitalPassAlongSource(text) {
  const haystack = String(text || '');
  return DIGITAL_PASS_ALONG_PATTERNS.some((re) => re.test(haystack));
}

function isNonDigitalReferralSource(text) {
  const haystack = String(text || '');
  return NON_DIGITAL_REFERRAL_PATTERNS.some((re) => re.test(haystack));
}

function isDigitalSourceMention(text) {
  return /\b(google|googled|search(?:ed)?|online|website|web\s+search|facebook|instagram|tiktok|social|ad|ads|lsa|maps|google\s+my\s+business)\b/i.test(String(text || ''));
}

function getSecondarySourceTag(text) {
  const windows = getDualSourceEvidenceWindows(text);
  for (const windowText of windows) {
    if (isNonDigitalReferralSource(windowText) && (isDigitalPassAlongSource(windowText) || isDigitalSourceMention(windowText))) {
      return DUAL_SOURCE_TAG;
    }
  }
  if (windows.some((windowText) => isNonDigitalReferralSource(windowText))) {
    return REFERRAL_SOURCE_TAG;
  }
  return null;
}

function applySourceSecondaryTag(call, payload, options = {}) {
  const textForDetection = options.textForDetection ?? getDualSourceDetectionText(call);
  const hasExplicitSourceTag = Object.prototype.hasOwnProperty.call(options, 'sourceTag');
  const requestedSourceTag = [DUAL_SOURCE_TAG, REFERRAL_SOURCE_TAG].includes(options.sourceTag) ? options.sourceTag : null;
  const sourceTag = hasExplicitSourceTag ? requestedSourceTag : getSecondarySourceTag(textForDetection);
  const sourceTags = new Set([DUAL_SOURCE_TAG, REFERRAL_SOURCE_TAG]);
  const currentTags = getTagNames(call);
  const payloadHasTags = Array.isArray(payload.tags);
  const payloadTags = payloadHasTags ? payload.tags.filter(Boolean) : [];
  const hasCurrentSourceTag = currentTags.some((tag) => sourceTags.has(tag));
  const hasPayloadSourceTag = payloadTags.some((tag) => sourceTags.has(tag));

  if (!sourceTag) {
    if (!hasCurrentSourceTag && !hasPayloadSourceTag) {
      return { payload, changed: false, added: false };
    }

    const next = { ...payload };
    const baseTags = payloadHasTags ? payloadTags : currentTags;
    next.tags = [...new Set(baseTags.filter((tag) => !sourceTags.has(tag)))];
    next.append_tags = false;
    return { payload: next, changed: true, added: false, removed: true };
  }

  const otherSourceTags = new Set([...sourceTags].filter((tag) => tag !== sourceTag));
  const currentAlreadyCorrect = currentTags.includes(sourceTag) && currentTags.every((tag) => !otherSourceTags.has(tag));
  if (!payloadHasTags && currentAlreadyCorrect) {
    return { payload, changed: false, added: false };
  }

  const next = { ...payload };
  const baseTags = payloadHasTags ? payloadTags : currentTags;
  next.tags = [...new Set([...baseTags.filter((tag) => !sourceTags.has(tag)), sourceTag])];
  next.append_tags = false;

  return {
    payload: next,
    changed: true,
    added: !currentTags.includes(sourceTag),
    removed: currentTags.some((tag) => otherSourceTags.has(tag)),
    tag: sourceTag,
  };
}

function ensureOneOrTwoSentences(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const pieces = cleaned.match(/[^.!?]+[.!?]?/g) ?? [cleaned];
  const sentences = pieces.map((x) => x.trim()).filter(Boolean);
  if (sentences.length === 0) return '';
  if (sentences.length === 1) return sentences[0].endsWith('.') ? sentences[0] : `${sentences[0]}.`;
  const two = `${sentences[0]} ${sentences[1]}`.trim();
  return /[.!?]$/.test(two) ? two : `${two}.`;
}

function normalizeSourceSummary(text) {
  const cleaned = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  if (/^(none|null|n\/a|not discussed|unknown)$/i.test(cleaned)) return '';
  const withoutPrefix = cleaned.replace(/^source\s*:\s*/i, '').trim();
  if (!withoutPrefix) return '';
  const sentence = /[.!?]$/.test(withoutPrefix) ? withoutPrefix : `${withoutPrefix}.`;
  return `Source: ${sentence}`;
}

function appendSourceSummaryToNote(summaryNote, sourceSummary) {
  const note = String(summaryNote || '').trim();
  const source = normalizeSourceSummary(sourceSummary);
  if (!source) return note;
  if (/\bSource\s*:/i.test(note)) return note;
  return `${note} ${source}`.trim();
}

function detectCallerDisconnectedHeuristic(call) {
  const duration = Number(call?.duration ?? 0);
  const transcript = String(call?.transcription ?? '').trim();
  const text = transcript.toLowerCase().replace(/\s+/g, ' ');
  const participantText = extractParticipantUtterances(transcript, ['Caller', 'Customer', 'Client'])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

  // Empty transcript + short call generally means no meaningful intake occurred.
  if (!text && duration > 0 && duration <= 20) {
    return {
      decision: 'tag_only',
      tag: 'Caller Disconnected',
      lead_status: null,
      confidence: 0.99,
      summary_note:
        'No meaningful caller conversation was captured and the call ended quickly, so this was tagged as Caller Disconnected.',
      source: 'heuristic_empty_short_call',
    };
  }

  if (!text) return null;

  const ivrPhrasePatterns = [
    /thank you for calling/g,
    /if you are a new client/g,
    /if you are an existing client/g,
    /for all other inquiries/g,
    /press\s+\d/g,
    /car accident lawyers/g,
  ];
  const ivrHits = ivrPhrasePatterns.reduce((sum, pattern) => {
    const matches = text.match(pattern);
    return sum + (matches ? matches.length : 0);
  }, 0);

  const hasCustomerSpeechMarker = /\b(customer|caller|client|lead)\s*:\s*[a-z0-9]/i.test(transcript);
  const hasAgentOnlyMarker = /\bagent\s*:/i.test(transcript) && !hasCustomerSpeechMarker;
  const repeatedMenuPrompt = (text.match(/press\s+\d/g) || []).length >= 2;
  const participantWordCount = participantText ? participantText.split(/\s+/).filter(Boolean).length : 0;
  const hasMeaningfulIntakeSignal = /\b(accident|injury|hurt|pain|insurance|claim|rear[- ]?ended|car|truck|motorcycle|hospital|police)\b/i.test(
    participantText
  );

  // IVR-only transcript + no customer speech + short call => disconnected.
  if ((duration <= 90 || repeatedMenuPrompt) && ivrHits >= 3 && (hasAgentOnlyMarker || !hasCustomerSpeechMarker)) {
    return {
      decision: 'tag_only',
      tag: 'Caller Disconnected',
      lead_status: null,
      confidence: 0.99,
      summary_note:
        'The transcript is IVR/menu audio only with no meaningful caller dialogue, so this was tagged as Caller Disconnected.',
      source: 'heuristic_ivr_only',
    };
  }

  // IVR/menu plus only a tiny, non-substantive participant utterance (e.g. "five years ago").
  if (duration <= 45 && ivrHits >= 3 && participantWordCount > 0 && participantWordCount <= 4 && !hasMeaningfulIntakeSignal) {
    return {
      decision: 'tag_only',
      tag: 'Caller Disconnected',
      lead_status: null,
      confidence: 0.99,
      summary_note:
        'The call is mostly IVR/menu audio and the participant utterance is too minimal to constitute a meaningful intake, so this was tagged as Caller Disconnected.',
      source: 'heuristic_ivr_minimal_participant',
    };
  }

  return null;
}

function detectExistingClientDuplicateHeuristic(call, sameNumberOtherCalls) {
  const transcript = String(call?.transcription ?? '').trim();
  const text = transcript.toLowerCase().replace(/\s+/g, ' ');
  if (!text) return null;

  const callerText = extractParticipantUtterances(transcript, ['Caller', 'Customer', 'Client'])
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  const callerOrFullText = callerText || text;

  const strongPatterns = [
    /\bi('m| am)?\s*an?\s*existing client\b/i,
    /\bi('m| am)\s+the client\b/i,
    /\bi\s+(currently\s+)?have\s+(an?\s+)?case\s+with\s+(you|you guys|your firm|brumley)\b/i,
    /\bi('d| would| want to)?\s*like to talk to (my|the) lawyer\b/i,
    /\bregarding (my|the) case\b/i,
    /\bwhere\s+we\s+are\s+with\s+(my|the)\s+case\b/i,
    /\bwho\s+is\s+in\s+charge\s+of\s+(my|the)\s+case\b/i,
    /\balready (have|got) (an )?attorney\b/i,
    /\byou (already|still) represent me\b/i,
    /\bcase manager\b/i,
    /\bcase handler\b/i,
    /\bupdate on (my )?case\b/i,
    /\bcase update\b/i,
    /\bstatus of (my )?case\b/i,
    /\bfollow(?:ing)? up (on|about)?\b/i,
    /\bcalled (back|again)\b/i,
    /\bnot receiving updates?\b/i,
    /\bhasn'?t (called|reached|contacted) me back\b/i,
    /\breturn (my )?call\b/i,
  ];
  const newIntakePatterns = [
    /\blooking for (an?|a)\s+accident lawyer\b/i,
    /\bi was (rear[- ]?ended|hit|in an accident)\b/i,
    /\bcar accident\b/i,
    /\btruck accident\b/i,
    /\bmotorcycle accident\b/i,
    /\bpedestrian\b/i,
    /\bcyclist\b/i,
  ];

  const strongHits = strongPatterns.filter((re) => re.test(callerOrFullText)).length;
  const hasPriorCalls = Array.isArray(sameNumberOtherCalls) && sameNumberOtherCalls.length > 0;
  const hasPriorQualifiedCall = hasPriorCalls && sameNumberOtherCalls.some((c) => isQualifiedLead(c));
  const hasNewIntakeSignal = newIntakePatterns.some((re) => re.test(callerOrFullText));

  // If caller language indicates new intake, do not auto-tag as existing client.
  if (hasNewIntakeSignal) {
    return null;
  }

  if (strongHits >= 1 || hasPriorQualifiedCall) {
    return {
      decision: 'tag_only',
      tag: DUPLICATE_TAG,
      lead_status: null,
      confidence: 0.98,
      summary_note:
        'The caller appears to be an existing client or follow-up contact about an existing matter, so this was tagged as Existing Client/Duplicate.',
      source: 'heuristic_existing_client_followup',
    };
  }

  return null;
}

function extractSpeakerUtterances(transcript, speaker) {
  const text = String(transcript || '');
  const escapedSpeaker = speaker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(
    `${escapedSpeaker}:\\s*([\\s\\S]*?)(?=(?:\\bAgent:|\\bCaller:|\\bCustomer:|\\bClient:|$))`,
    'gi'
  );
  const chunks = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const utterance = String(match[1] || '').trim();
    if (utterance) chunks.push(utterance);
  }
  return chunks.join(' ');
}

function extractParticipantUtterances(transcript, speakers) {
  const chunks = [];
  for (const speaker of speakers) {
    const text = extractSpeakerUtterances(transcript, speaker);
    if (text) chunks.push(text);
  }
  return chunks.join(' ');
}

function enforceQualificationGuardrails(classification, call, sameNumberOtherCalls) {
  if (classification.decision !== 'qualified') {
    return classification;
  }

  const clientRejected = detectClientRejectedByAgent(call);
  if (clientRejected) {
    return normalizeClassification(clientRejected);
  }

  const noInjuryDisqualification = detectNoBodilyInjuryDisqualification(call);
  if (noInjuryDisqualification) {
    return normalizeClassification(noInjuryDisqualification);
  }

  const existingClientHeuristic = detectExistingClientDuplicateHeuristic(call, sameNumberOtherCalls);
  if (existingClientHeuristic) {
    return normalizeClassification({
      ...existingClientHeuristic,
      source: 'guardrail_existing_client_override',
    });
  }

  return classification;
}

function hasPotentialMvaContext(call) {
  const transcript = String(call?.transcription ?? '');
  if (!transcript) return false;
  const participantText = extractParticipantUtterances(transcript, ['Caller', 'Customer', 'Client'])
    .replace(/\s+/g, ' ')
    .trim();
  const hasSpeakerLabels = /\b(agent|caller|customer|client)\s*:/i.test(transcript);
  const text = (hasSpeakerLabels ? participantText : transcript).toLowerCase();
  if (!text) return false;

  const mvaPatterns = [
    /\baccident\b/,
    /\brear[- ]?ended\b/,
    /\bcar\b/,
    /\btruck\b/,
    /\bmotorcycle\b/,
    /\bvehicle\b/,
    /\bhit\b/,
    /\binsurance\b/,
    /\bclaim\b/,
    /\bpolice\b/,
    /\bfreeway\b/,
  ];

  return mvaPatterns.some((re) => re.test(text));
}

function getCallerNarrativeText(call) {
  const transcript = String(call?.transcription ?? '').trim();
  if (!transcript) return '';
  const callerText = extractParticipantUtterances(transcript, ['Caller', 'Customer', 'Client'])
    .replace(/\s+/g, ' ')
    .trim();
  return callerText || transcript.replace(/\s+/g, ' ').trim();
}

function detectNoBodilyInjuryDisqualification(call) {
  const transcript = String(call?.transcription ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!transcript) return null;

  const patterns = [
    /\bno\s+injur(?:y|ies)\b/i,
    /\b(no|not)\s+(injured|hurt)\b/i,
    /\b(no|not)\s+(bodily|physical|personal)\s+injur/i,
    /\b(property|vehicle|car)\s+damage\s+only\b/i,
    /\bonly\s+(property|vehicle|car)\s+damage\b/i,
    /\bproperty\s+damage\s+(aspect|claim|issue|matter|concern)\b/i,
    /\bmain\s+concern\b[\s\S]{0,120}\bproperty\s+damage\b/i,
    /\bsignificant\s+damage\s+to\s+the\s+(building|property|vehicle|car)\b/i,
    /\byou\s+weren't\s+in\s+the\s+car\b/i,
    /\byou\s+were\s+not\s+in\s+the\s+car\b/i,
    /\bout\s+of\s+the\s+car\b[\s\S]{0,160}\b(hit|struck|damage|van|vehicle|car)\b/i,
    /\b(hit|struck|damage)\b[\s\S]{0,160}\bout\s+of\s+the\s+car\b/i,
    /\b(if|because|since)\s+you\s+(weren't|were\s+not)\s+injured\b/i,
    /\b(if|because|since)\s+there\s+(was|were|is|'s)\s+no\s+injur/i,
    /\bif\s+there'?s\s+no\s+injur/i,
    /\b(isn't|is\s+not|not)\s+a\s+case\s+we\s+(would\s+)?be\s+able\s+to\s+take\b/i,
    /\b(we|this firm)\s+(can't|cannot|can\s+not|wouldn't|would\s+not)\s+(take|handle)\s+(this|the)\s+case\b/i,
    /\b(we|i)\s+(do\s+not|don't)\s+think\s+we\s+would\s+be\s+able\s+to\s+(represent|take|handle)\b/i,
    /\bnothing\s+we\s+would\s+necessarily\s+be\s+able\s+to\s+represent\b/i,
    /\bwe\s+represent\s+for\b[\s\S]{0,80}\bbodily\s+injur/i,
    /\bwe\s+(deal|handle)\s+with\b[\s\S]{0,80}\bbodily\s+injur/i,
    /\brefer\s+you\s+to\s+(a\s+)?website\b[\s\S]{0,120}\b(avvo|appropriate representation|attorney)\b/i,
  ];

  if (!patterns.some((re) => re.test(transcript))) return null;

  return {
    decision: 'tag_only',
    tag: 'Unrelated Case',
    lead_status: null,
    confidence: 0.98,
    summary_note:
      'Caller described a motor vehicle/property-damage issue without bodily injury, and the agent indicated BLF could not take the case. Tagged as Unrelated Case.',
    source: 'guardrail_no_bodily_injury_disqualification',
  };
}

function detectClientRejectedByAgent(call) {
  const transcript = String(call?.transcription ?? '').trim();
  if (!transcript) return null;
  const agentText = extractParticipantUtterances(transcript, ['Agent'])
    .replace(/\s+/g, ' ')
    .trim();
  const text = (agentText || transcript.replace(/\s+/g, ' ').trim()).toLowerCase();
  if (!text) return null;

  const patterns = [
    /\bnot\s+something\s+we\s+would\s+be\s+able\s+to\s+help(?:\s+out)?\s+with\b/i,
    /\b(we|i)\s+(won't|will\s+not|wouldn't|would\s+not|can't|cannot|can\s+not)\s+be\s+able\s+to\s+help\b/i,
    /\bsorry\s+that\s+we\s+(won't|will\s+not|can't|cannot|can\s+not)\s+be\s+able\s+to\s+help\b/i,
    /\b(we|i)\s+(do\s+not|don't)\s+think\s+we\s+would\s+be\s+able\s+to\s+(represent|take|handle|help)\b/i,
    /\b(we|i)\s+(won't|will\s+not|wouldn't|would\s+not|can't|cannot|can\s+not)\s+(represent|take|handle)\b/i,
    /\bnot\s+a\s+case\s+we\s+(would\s+be\s+able\s+to\s+take|can\s+take|handle)\b/i,
    /\bwe\s+represent\s+the\s+not\s+at\s+fault\s+part(?:y|ies)\b[\s\S]{0,220}\b(refer|avvo|defense|deny|liability|challenging)\b/i,
    /\brefer\s+you\s+to\s+(a\s+)?website\b[\s\S]{0,160}\b(avvo|appropriate representation|attorney|defense)\b/i,
  ];

  if (!patterns.some((re) => re.test(text))) return null;

  return {
    decision: 'tag_only',
    tag: CLIENT_REJECTED_TAG,
    lead_status: null,
    confidence: 0.99,
    summary_note:
      'The intake agent told the caller BLF could not help or represent the matter after reviewing the facts. Tagged as Client_Rejected.',
    source: 'guardrail_agent_client_rejected',
  };
}

function hasSelfFaultAdmission(text) {
  const selfFaultPatterns = [
    /\b(my fault|i (was|am) at fault)\b/i,
    /\bi (rear[- ]?ended|hit|struck|sideswiped|t[- ]?boned)\s+(them|him|her|another (car|vehicle)|the other (car|vehicle)|someone)\b/i,
    /\bi (ran|blew)\s+(a )?(red light|stop sign)\b/i,
    /\bi (was )?speeding\b/i,
    /\bi (caused|causing)\s+(the )?(accident|crash|collision)\b/i,
  ];
  return selfFaultPatterns.some((re) => re.test(text));
}

function hasFirstPartyMvaNarrative(text) {
  const narrativePatterns = [
    /\bi was (hit|rear[- ]?ended|sideswiped|t[- ]?boned|in an accident|in a crash)\b/i,
    /\bsomeone (hit|rear[- ]?ended|sideswiped|t[- ]?boned) (me|my (car|vehicle))\b/i,
    /\b(my|our)\s+(car|vehicle|truck|motorcycle)\b[\s\S]{0,60}\b(hit|rear[- ]?ended|sideswiped|t[- ]?boned|crash|accident|collision)\b/i,
    /\b(accident|crash|collision)\b[\s\S]{0,80}\b(my|our|me|we)\b/i,
  ];
  return narrativePatterns.some((re) => re.test(text));
}

function getAggressiveQualificationOverride(call, sameNumberOtherCalls) {
  const transcript = String(call?.transcription ?? '').trim();
  if (!transcript) return null;

  const existingClientHeuristic = detectExistingClientDuplicateHeuristic(call, sameNumberOtherCalls);
  if (existingClientHeuristic) return null;

  const text = getCallerNarrativeText(call);
  if (!text) return null;
  if (detectClientRejectedByAgent(call)) return null;
  if (detectNoBodilyInjuryDisqualification(call)) return null;
  if (!hasFirstPartyMvaNarrative(text)) return null;
  if (hasSelfFaultAdmission(text)) return null;

  return normalizeClassification({
    decision: 'qualified',
    tag: null,
    lead_status: 'good_lead',
    confidence: 0.9,
    summary_note:
      'Caller narrative indicates a motor vehicle accident where the caller does not clearly admit fault, so this was auto-qualified.',
    source: 'guardrail_assume_qualified_unless_self_fault',
  });
}

function enforceHumanReviewGuardrails(classification, call) {
  if (classification.decision === 'qualified') return classification;

  if ((classification.tag === OTHER_TAG || !classification.tag) && hasPotentialMvaContext(call)) {
    return normalizeClassification({
      ...classification,
      decision: 'tag_only',
      tag: HUMAN_REVIEW_TAG,
      summary_note:
        'This appears related to a possible motor vehicle accident, but eligibility details (especially fault/coverage) are not clear enough for auto-qualification.',
      source: 'guardrail_human_review_mva_unclear',
    });
  }

  return classification;
}

function getEffectiveCallDurationSeconds(call) {
  const callDuration = Number(call?.duration ?? 0);
  if (Number.isFinite(callDuration) && callDuration > 0) return callDuration;
  const recordingDuration = Number(call?.recording_duration ?? 0);
  if (Number.isFinite(recordingDuration) && recordingDuration > 0) return recordingDuration;
  return 0;
}

function enforceMissingTranscriptGuardrails(classification, call) {
  const transcript = String(call?.transcription ?? '').trim();
  if (transcript) return classification;

  const durationSeconds = getEffectiveCallDurationSeconds(call);
  if (durationSeconds < 45) return classification;

  const riskyAutoTag =
    classification.decision === 'tag_only' &&
    (classification.tag === 'Caller Disconnected' || classification.tag === 'SPAM' || classification.tag === OTHER_TAG);

  if (!riskyAutoTag) return classification;

  return {
    ...classification,
    decision: 'tag_only',
    tag: HUMAN_REVIEW_TAG,
    lead_status: null,
    confidence: Math.min(Number.isFinite(classification.confidence) ? classification.confidence : 0.85, 0.85),
    summary_note: ensureOneOrTwoSentences(
      `Call lasted about ${Math.round(durationSeconds)} seconds but no transcript was available, so this was routed to Human Review instead of auto-tagging as disconnected.`
    ),
    source: 'guardrail_missing_transcript_long_call',
  };
}

function hasExplicitExistingClientSummary(classification) {
  const note = String(classification?.summary_note ?? '').toLowerCase();
  if (!note) return false;
  const patterns = [
    /\bexisting client\b/,
    /\bformer client\b/,
    /\bcurrent client\b/,
    /\bexisting case\b/,
    /\bactive matter\b/,
    /\bcase update\b/,
    /\bcase status\b/,
    /\bstatus update\b/,
    /\bcase manager\b/,
    /\bcase handler\b/,
    /\bsettlement\b/,
    /\bsettlement check\b/,
    /\bpayment check\b/,
    /\bclient file\b/,
    /\bcase file\b/,
    /\bfile transfer\b/,
    /\bsubstitution letter\b/,
    /\bpre[- ]?deposition\b/,
    /\blop\b/,
    /\bnot a new intake\b/,
  ];
  return patterns.some((re) => re.test(note));
}

function canUseDuplicateTag(call, priorSameNumberCalls, existingClientHeuristic, classification = null) {
  if (existingClientHeuristic) return true;
  if (Array.isArray(priorSameNumberCalls) && priorSameNumberCalls.some((c) => isQualifiedLead(c))) return true;
  if (classification?.tag === DUPLICATE_TAG && hasExplicitExistingClientSummary(classification)) return true;
  return false;
}

async function callrailRequest(config, endpoint, { method = 'GET', body = null } = {}) {
  const url = `https://api.callrail.com/v3/a/${encodeURIComponent(config.accountId)}${endpoint}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Token token=${config.callrailApiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const raw = await response.text();
  const parsed = toJsonSafe(raw);
  if (!response.ok) {
    const detail = parsed ? JSON.stringify(parsed) : raw.slice(0, 500);
    throw new Error(`CallRail API failed (${response.status}) ${method} ${endpoint}: ${detail}`);
  }

  if (parsed == null) {
    throw new Error(`CallRail API returned non-JSON response for ${method} ${endpoint}`);
  }
  return parsed;
}

async function ensureWorkflowTagsExist(config, companyId) {
  const cid = String(companyId || '').trim();
  if (!cid) return;
  if (!config.apply) return;

  if (!config._ensuredTagCompanies) {
    config._ensuredTagCompanies = new Set();
  }
  if (config._ensuredTagCompanies.has(cid)) return;

  const existingLower = new Set();
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const list = await callrailRequest(config, `/tags.json?per_page=250&page=${page}`);
    totalPages = Number(list.total_pages ?? 1) || 1;
    const tags = Array.isArray(list.tags) ? list.tags : [];
    for (const tag of tags) {
      if (String(tag?.company_id || '') !== cid) continue;
      const name = String(tag?.name || '').trim();
      if (name) existingLower.add(name.toLowerCase());
    }
    page += 1;
  }

  for (const name of WORKFLOW_TAGS) {
    const key = String(name).toLowerCase();
    if (existingLower.has(key)) continue;
    try {
      await callrailRequest(config, '/tags.json', {
        method: 'POST',
        body: { name, company_id: cid },
      });
      existingLower.add(key);
      console.log(`Created missing tag "${name}" for company ${cid}.`);
    } catch (error) {
      const msg = String(error?.message || '');
      if (msg.includes('Name has already been taken') || msg.includes('agency-level tag')) {
        existingLower.add(key);
        continue;
      }
      throw error;
    }
  }

  config._ensuredTagCompanies.add(cid);
}

function buildCallListParams({
  perPage,
  page,
  sort,
  order,
  companyId,
  leadStatus,
  fields,
  startDate,
  endDate,
  dateRange,
}) {
  const params = new URLSearchParams();
  params.set('per_page', String(perPage));
  if (page) params.set('page', String(page));
  params.set('sort', sort);
  params.set('order', order);
  params.set('fields', fields.join(','));
  if (companyId) params.set('company_id', companyId);
  if (leadStatus) params.set('lead_status', leadStatus);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (dateRange) params.set('date_range', dateRange);
  return params.toString();
}

function callLocalDateKey(call) {
  const start = String(call?.start_time ?? '');
  return /^\d{4}-\d{2}-\d{2}/.test(start) ? start.slice(0, 10) : '';
}

function isWithinDateRange(call, config) {
  const key = callLocalDateKey(call);
  if (!key) return true;
  if (config.dateFrom && key < config.dateFrom) return false;
  if (config.dateTo && key > config.dateTo) return false;
  return true;
}

async function fetchTargetCall(config, { excludeIds = new Set() } = {}) {
  if (config.callId) {
    const params = new URLSearchParams();
    params.set('fields', CALL_FIELDS.join(','));
    const single = await callrailRequest(config, `/calls/${encodeURIComponent(config.callId)}.json?${params.toString()}`);
    return single.call ?? single;
  }

  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const hasExplicitRange = Boolean(config.dateFrom || config.dateTo);
    const query = buildCallListParams({
      perPage: 100,
      page,
      sort: 'start_time',
      order: 'desc',
      companyId: config.companyId,
      leadStatus: null,
      fields: CALL_FIELDS,
      startDate: config.dateFrom || null,
      endDate: config.dateTo || null,
      dateRange: hasExplicitRange ? null : 'all_time',
    });

    const list = await callrailRequest(config, `/calls.json?${query}`);
    totalPages = Number(list.total_pages ?? 1) || 1;
    const calls = Array.isArray(list.calls) ? list.calls : [];
    const unprocessed = calls.find(
      (c) =>
        !excludeIds.has(c.id) &&
        !isLeadScored(c) &&
        (config.includeTagged || !hasAnyTags(c)) &&
        isWithinDateRange(c, config)
    );
    if (unprocessed) return unprocessed;

    page += 1;
  }

  return null;
}

async function fetchRecentCallsForNumber(config, phoneNumber) {
  if (!phoneNumber) return [];
  const hasExplicitRange = Boolean(config.dateFrom || config.dateTo);
  const query = buildCallListParams({
    perPage: 100,
    page: 1,
    sort: 'start_time',
    order: 'desc',
    companyId: config.companyId,
    leadStatus: null,
    fields: ['id', 'customer_phone_number', 'start_time', 'duration', 'answered', 'first_call', 'tags', 'lead_status'],
    startDate: config.dateFrom || null,
    endDate: config.dateTo || null,
    dateRange: hasExplicitRange ? null : 'all_time',
  });

  const list = await callrailRequest(config, `/calls.json?${query}`);
  const all = Array.isArray(list.calls) ? list.calls : [];
  return all.filter((c) => c.customer_phone_number === phoneNumber);
}

function buildOpenAiPrompt(call, sameNumberCalls, options = {}) {
  const { disallowDuplicateTag = false } = options;
  const allowedTags = disallowDuplicateTag ? TAGS.filter((t) => t !== DUPLICATE_TAG) : TAGS;
  const history = sameNumberCalls
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      start_time: c.start_time,
      duration: c.duration,
      answered: c.answered,
      first_call: c.first_call,
      lead_status: c.lead_status,
      tags: c.tags,
    }));

  return [
    'You are a legal intake assistant for a personal injury law firm.',
    '',
    'Primary qualification rule:',
    '- QUALIFIED only if this is a motor vehicle accident case (car, truck, motorcycle, rideshare, bus, boating, etc.)',
    '- and caller/injured party appears NOT at fault.',
    '- Injured party may be driver, passenger, pedestrian, cyclist, etc.',
    '',
    'Allowed tags:',
    `- ${allowedTags.join(', ')}`,
    '',
    'Tag guidance:',
    '- Existing Client/Duplicate: repeat caller, active client, disconnected then immediate callback continuation.',
    '- JOB APPLICATION: recruiting/employment inquiry.',
    '- Caller Disconnected: no meaningful conversation, dead air/ivr, very short abrupt disconnect.',
    '- Insurance Company: carrier/adjuster outreach.',
    '- Treatment provider: medical/chiro/clinic provider outreach.',
    '- SPAM: robocall/solicitation/scam.',
    '- Human Review: possible MVA intake but not enough clarity to decide qualification automatically (especially unclear fault/coverage).',
    '- Unrelated Case: legal matter outside MVA personal injury scope.',
    `- ${CLIENT_REJECTED_TAG}: intake agent says BLF cannot help, cannot represent, cannot take the case, or refers the caller elsewhere after reviewing the facts.`,
    '- Other: non-MVA or miscellaneous non-intake items that do not fit any specific tag.',
    '',
    'Decision rules:',
    '- Use decision=qualified when caller narrative indicates an MVA and caller does not clearly admit they caused the crash.',
    '- Do NOT require police report, insurance details, or coverage confirmation to mark qualified.',
    `- If the agent says BLF cannot help, cannot represent, cannot take the case, or refers the caller elsewhere after reviewing the facts, use ${CLIENT_REJECTED_TAG} and never qualified.`,
    '- If the caller was not injured or only vehicle/property damage is described and no explicit agent rejection is present, use Unrelated Case and never qualified.',
    '- For non-MVA or non-intake calls, use decision=tag_only and choose one tag.',
    '- Never use lead-status concepts in output. This workflow only marks qualified calls.',
    '- If caller appears to be existing client / callback / case update / follow-up, ALWAYS use Existing Client/Duplicate (never qualified).',
    '- If there is already an older same-number call with good_lead, default to Existing Client/Duplicate unless clear evidence this is a new unrelated intake.',
    disallowDuplicateTag
      ? '- IMPORTANT: For this classification pass, do NOT use Existing Client/Duplicate.'
      : '',
    '',
    'Source attribution rules for source_tag (only use for decision=qualified; otherwise null):',
    `- ${REFERRAL_SOURCE_TAG}: caller clearly says Brumley was recommended/referred directly by a friend, family member, coworker, employer/employee, attorney/lawyer, chiropractor/doctor/clinic/provider, prior client, or word of mouth. Use this only when that person/source appears to have already known or recommended Brumley directly.`,
    `- ${DUAL_SOURCE_TAG}: source chain is mixed or unclear, such as both Google/social/web search and word-of-mouth/referral being mentioned, or the caller says they were told by someone but also found/confirmed Brumley online and it is not clear which source was original.`,
    '- null: no source discussed, existing client/duplicate/non-qualified, or clearly digital-only source. If a friend/family member merely found Brumley on Google/social and passed along the link/name, treat it as digital-only and use null.',
    '',
    'Source note rules for source_summary:',
    '- If the caller says how they heard about or found BLF, return a short sentence explaining it, even when source_tag is null.',
    '- Include answers to agent questions like "Where did you hear about us?" and volunteered statements like "I heard about you from a friend."',
    '- If no source is discussed, return null.',
    '',
    'Return 1-2 sentence summary_note about the case/routing decision. Keep source attribution in source_summary, not summary_note.',
    '',
    'CALL JSON:',
    JSON.stringify(
      {
        id: call.id,
        start_time: call.start_time,
        customer_name: call.customer_name,
        customer_phone_number: call.customer_phone_number,
        duration: call.duration,
        answered: call.answered,
        voicemail: call.voicemail,
        first_call: call.first_call,
        existing_tags: getTagNames(call),
        existing_note: call.note ?? null,
        transcription: call.transcription ?? null,
        same_number_recent_calls: history,
      },
      null,
      2
    ),
  ].join('\n');
}

async function classifyCall(config, call, sameNumberCalls, options = {}) {
  const { disallowDuplicateTag = false } = options;
  const allowedTags = disallowDuplicateTag ? TAGS.filter((t) => t !== DUPLICATE_TAG) : TAGS;
  const schema = {
    name: 'callrail_intake_classification',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        decision: {
          type: 'string',
          enum: ['qualified', 'tag_only'],
        },
        tag: {
          type: ['string', 'null'],
          enum: [...allowedTags, null],
        },
        summary_note: {
          type: 'string',
        },
        confidence: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        source_tag: {
          type: ['string', 'null'],
          enum: [REFERRAL_SOURCE_TAG, DUAL_SOURCE_TAG, null],
        },
        source_summary: {
          type: ['string', 'null'],
        },
      },
      required: ['decision', 'tag', 'summary_note', 'confidence', 'source_tag', 'source_summary'],
    },
  };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openAiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model,
      ...(!/^gpt-5(?:$|-)/i.test(String(config.model || '').trim()) ? { temperature: 0.1 } : {}),
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
      messages: [
        {
          role: 'system',
          content:
            'Classify call transcripts for legal intake workflow. Follow business rules exactly and produce valid schema JSON.',
        },
        {
          role: 'user',
          content: buildOpenAiPrompt(call, sameNumberCalls, { disallowDuplicateTag }),
        },
      ],
    }),
  });

  const raw = await response.text();
  const data = toJsonSafe(raw);
  if (!response.ok) {
    throw new Error(`OpenAI classification failed (${response.status}): ${raw.slice(0, 500)}`);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error(`Missing OpenAI content: ${raw.slice(0, 500)}`);
  }

  const parsed = toJsonSafe(content);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Failed parsing OpenAI JSON: ${content.slice(0, 500)}`);
  }
  return parsed;
}

function normalizeClassification(raw) {
  const result = {
    decision: raw.decision,
    tag: raw.tag ? canonicalizeTagName(raw.tag) : null,
    lead_status: null,
    summary_note: ensureOneOrTwoSentences(raw.summary_note),
    confidence: Number(raw.confidence),
    source_tag: [REFERRAL_SOURCE_TAG, DUAL_SOURCE_TAG].includes(raw.source_tag) ? raw.source_tag : null,
    source_summary: normalizeSourceSummary(raw.source_summary),
    source: typeof raw.source === 'string' ? raw.source : 'openai',
  };

  if (!['qualified', 'tag_only'].includes(result.decision)) {
    result.decision = 'tag_only';
  }

  if (result.decision === 'qualified') {
    result.lead_status = 'good_lead';
    result.tag = null;
    if (![REFERRAL_SOURCE_TAG, DUAL_SOURCE_TAG].includes(result.source_tag)) {
      result.source_tag = null;
    }
  } else {
    if (!result.tag || !TAGS.includes(result.tag)) {
      result.tag = HUMAN_REVIEW_TAG;
    }
    result.lead_status = null;
    result.source_tag = null;
  }

  if (!Number.isFinite(result.confidence)) {
    result.confidence = 0.5;
  } else {
    result.confidence = Math.max(0, Math.min(1, result.confidence));
  }

  if (!result.summary_note) {
    if (result.decision === 'qualified') {
      result.summary_note = 'Transcript indicates an MVA intake where the injured party appears not at fault. Marked as qualified.';
    } else {
      result.summary_note = 'Transcript did not meet qualification criteria and was tagged for follow-up routing.';
    }
  }

  result.summary_note = appendSourceSummaryToNote(result.summary_note, result.source_summary);

  return enforceReferralSourceNotQualified(result);
}

function enforceReferralSourceNotQualified(classification) {
  if (classification?.decision !== 'qualified') {
    return classification;
  }

  const sourceText = [classification.source_summary, classification.summary_note]
    .filter(Boolean)
    .join(' ');
  const hasReferralSource =
    classification.source_tag === REFERRAL_SOURCE_TAG ||
    (isNonDigitalReferralSource(sourceText) && !isDigitalPassAlongSource(sourceText));
  if (!hasReferralSource) {
    return classification;
  }

  const note = String(classification.summary_note || '').trim();
  const referralNote = 'Lead source is referral/word of mouth, so this was not marked Qualified.';
  const summaryNote = note.includes(referralNote) ? note : (note + ' ' + referralNote).trim();

  return {
    ...classification,
    decision: 'tag_only',
    tag: REFERRAL_SOURCE_TAG,
    lead_status: null,
    source_tag: null,
    summary_note: summaryNote,
    source: 'guardrail_referral_source_not_qualified',
  };
}

function buildUpdatePayload(call, classification, options = {}) {
  const forceReplaceTag = Boolean(options.forceReplaceTag);
  if (classification.decision === 'qualified') {
    const payload = {
      note: classification.summary_note,
      lead_status: 'good_lead',
    };

    // Guardrail: qualified call must always have "Qualified" and never keep duplicate tag.
    const currentTags = getTagNames(call);
    const filteredTags = currentTags.filter((tag) => tag !== DUPLICATE_TAG);
    const hasQualifiedTag = filteredTags.includes(QUALIFIED_TAG);
    if (currentTags.includes(DUPLICATE_TAG) || !hasQualifiedTag) {
      payload.tags = [...new Set([...filteredTags, QUALIFIED_TAG])];
      payload.append_tags = false;
    }
    return payload;
  }

  const currentTagNames = getTagNames(call);
  if (forceReplaceTag) {
    return {
      note: classification.summary_note,
      lead_status: null,
      tags: [classification.tag || HUMAN_REVIEW_TAG],
      append_tags: false,
    };
  }
  const payload = {
    note: classification.summary_note,
    append_tags: true,
    tags: [classification.tag || HUMAN_REVIEW_TAG],
  };
  // If this call was incorrectly marked qualified earlier, clear that state on tag-only correction.
  if (isQualifiedLead(call) || currentTagNames.includes(QUALIFIED_TAG)) {
    payload.lead_status = null;
    payload.tags = [...new Set([...currentTagNames.filter((t) => t !== QUALIFIED_TAG), classification.tag || HUMAN_REVIEW_TAG])];
    payload.append_tags = false;
  }
  return payload;
}

function getTimestampMs(value) {
  const ms = Number(new Date(value).getTime());
  return Number.isFinite(ms) ? ms : null;
}

function getDuplicateBackfillCandidates(currentCall, sameNumberOtherCalls) {
  if (!sameNumberOtherCalls.length) return [];
  const currentMs = getTimestampMs(currentCall.start_time);

  return sameNumberOtherCalls
    .filter((other) => {
      if (!other?.id) return false;
      if (isQualifiedLead(other)) return false;
      if (hasTagName(other, DUPLICATE_TAG)) return false;
      if (currentMs == null) return true;
      const otherMs = getTimestampMs(other.start_time);
      return otherMs == null || otherMs <= currentMs;
    })
    .sort((a, b) => (getTimestampMs(a.start_time) ?? 0) - (getTimestampMs(b.start_time) ?? 0));
}

function buildDuplicateBackfillPayload(qualifiedCall) {
  const note = ensureOneOrTwoSentences(
    `A newer call from this same caller (${qualifiedCall.id}) was identified as the valid qualified intake. This earlier interaction was tagged as Existing Client/Duplicate.`
  );
  return {
    note,
    append_tags: true,
    tags: [DUPLICATE_TAG],
  };
}

function formatDecisionPreview(call, classification, payload) {
  return {
    call_id: call.id,
    start_time: call.start_time,
    customer_phone_number: call.customer_phone_number,
    current_lead_status: call.lead_status ?? null,
    current_tags: getTagNames(call),
    decision: classification.decision,
    tag: classification.tag,
    lead_status_to_set: classification.lead_status,
    confidence: classification.confidence,
    classification_source: classification.source ?? 'openai',
    note: classification.summary_note,
    update_payload: payload,
  };
}

async function applyUpdate(config, callId, payload) {
  return callrailRequest(config, `/calls/${encodeURIComponent(callId)}.json`, {
    method: 'PUT',
    body: payload,
  });
}

function printNoTargetCallMessage(config) {
  if (config.processAll && (config.dateFrom || config.dateTo)) {
    if (config.includeTagged) {
      console.log('No target call found. (No unscored calls matched your date filters.)');
    } else {
      console.log('No target call found. (No unscored-and-untagged calls matched your date filters.)');
    }
    return;
  }
  if (config.includeTagged) {
    console.log('No target call found. (No unscored calls matched your filters.)');
  } else {
    console.log('No target call found. (No unscored-and-untagged calls matched your filters.)');
    console.log('Tip: use --include-tagged to allow tagged unscored calls.');
  }
}

async function processSingleCall(config, call) {
  if (isLeadScored(call) && !config.force) {
    console.log(`Call ${call.id} already has lead_status="${call.lead_status}". Skipping.`);
    return { status: 'skipped' };
  }
  if (config.force) {
    console.log(`Force mode enabled for call ${call.id}; existing lead status/tags will be re-evaluated.`);
  }

  const sameNumberCalls = await fetchRecentCallsForNumber(config, call.customer_phone_number);
  const sameNumberOtherCalls = sameNumberCalls.filter((c) => c.id !== call.id);
  const currentCallMs = getTimestampMs(call.start_time);
  const priorSameNumberCalls = sameNumberOtherCalls.filter((c) => {
    if (currentCallMs == null) return true;
    const ms = getTimestampMs(c.start_time);
    return ms == null || ms <= currentCallMs;
  });
  const laterSameNumberCalls = sameNumberOtherCalls.filter((c) => {
    if (currentCallMs == null) return false;
    const ms = getTimestampMs(c.start_time);
    return ms != null && ms > currentCallMs;
  });

  if (config.debug) {
    console.log(
      JSON.stringify(
        {
          selected_call_id: call.id,
          selected_call_duration: call.duration,
          selected_call_first_call: call.first_call,
          selected_call_has_transcription: Boolean(call.transcription),
          same_number_other_calls_found: sameNumberOtherCalls.length,
          same_number_prior_calls_found: priorSameNumberCalls.length,
          same_number_later_calls_found: laterSameNumberCalls.length,
        },
        null,
        2
      )
    );
  }

  const heuristicClassification = detectCallerDisconnectedHeuristic(call);
  let classification;
  const existingClientHeuristic = detectExistingClientDuplicateHeuristic(call, priorSameNumberCalls);
  const clientRejected = detectClientRejectedByAgent(call);
  const noInjuryDisqualification = detectNoBodilyInjuryDisqualification(call);
  const callForClassification = config.force ? { ...call, tags: [], note: null } : call;
  if (heuristicClassification) {
    console.log(`Heuristic classification matched for ${call.id}: ${heuristicClassification.source}`);
    classification = normalizeClassification(heuristicClassification);
  } else if (existingClientHeuristic) {
    console.log(`Heuristic classification matched for ${call.id}: ${existingClientHeuristic.source}`);
    classification = normalizeClassification(existingClientHeuristic);
  } else if (clientRejected) {
    console.log(`Heuristic classification matched for ${call.id}: ${clientRejected.source}`);
    classification = normalizeClassification(clientRejected);
  } else if (noInjuryDisqualification) {
    console.log(`Heuristic classification matched for ${call.id}: ${noInjuryDisqualification.source}`);
    classification = normalizeClassification(noInjuryDisqualification);
  } else {
    console.log(`Classifying call ${call.id} with model ${config.model}...`);
    const rawClassification = await classifyCall(config, callForClassification, priorSameNumberCalls);
    classification = normalizeClassification(rawClassification);
    classification = enforceQualificationGuardrails(classification, call, priorSameNumberCalls);
    classification = enforceHumanReviewGuardrails(classification, call);
    classification = enforceMissingTranscriptGuardrails(classification, call);
    const aggressiveQualification = getAggressiveQualificationOverride(call, priorSameNumberCalls);
    if (aggressiveQualification) {
      aggressiveQualification.source_tag = classification.source_tag;
      aggressiveQualification.source_summary = classification.source_summary;
      aggressiveQualification.summary_note = appendSourceSummaryToNote(
        aggressiveQualification.summary_note,
        classification.source_summary
      );
      classification = aggressiveQualification;
    }

    const duplicateAllowed = canUseDuplicateTag(call, priorSameNumberCalls, existingClientHeuristic, classification);
    if (classification.decision === 'tag_only' && classification.tag === DUPLICATE_TAG && !duplicateAllowed) {
      console.log(`Duplicate tag not allowed for ${call.id} (no duplicate evidence). Reclassifying without duplicate option...`);
      const retryRaw = await classifyCall(config, callForClassification, priorSameNumberCalls, {
        disallowDuplicateTag: true,
      });
      classification = normalizeClassification(retryRaw);
      classification = enforceQualificationGuardrails(classification, call, priorSameNumberCalls);
      classification = enforceHumanReviewGuardrails(classification, call);
      classification = enforceMissingTranscriptGuardrails(classification, call);
      const aggressiveQualification = getAggressiveQualificationOverride(call, priorSameNumberCalls);
      if (aggressiveQualification) {
        aggressiveQualification.source_tag = classification.source_tag;
        aggressiveQualification.source_summary = classification.source_summary;
        aggressiveQualification.summary_note = appendSourceSummaryToNote(
          aggressiveQualification.summary_note,
          classification.source_summary
        );
        classification = aggressiveQualification;
      }
      if (classification.source === 'openai') {
        classification.source = 'openai_no_duplicate_retry';
      }
    }
  }

  if (classification.decision === 'tag_only' && classification.tag === HUMAN_REVIEW_TAG) {
    const lateExistingClientCheck = detectExistingClientDuplicateHeuristic(call, priorSameNumberCalls);
    if (lateExistingClientCheck) {
      console.log(`Human Review overridden by existing-client heuristic for ${call.id}.`);
      classification = normalizeClassification(lateExistingClientCheck);
    }
  }
  classification = enforceReferralSourceNotQualified(classification);

  const basePayload = buildUpdatePayload(call, classification, {
    forceReplaceTag: config.force && classification.decision === 'tag_only',
  });
  const sourceTagResult =
    classification.decision === 'qualified'
      ? applySourceSecondaryTag(call, basePayload, { sourceTag: classification.source_tag })
      : { payload: basePayload, added: false };
  const payload = sourceTagResult.payload;
  if (sourceTagResult.changed) {
    if (sourceTagResult.tag) {
      console.log(`Source attribution resolved for ${call.id}; setting secondary tag "${sourceTagResult.tag}".`);
    } else {
      console.log(`Source attribution resolved for ${call.id}; removing secondary source tags.`);
    }
  }

  const duplicateBackfillCandidates =
    classification.decision === 'qualified'
      ? getDuplicateBackfillCandidates(call, sameNumberOtherCalls)
      : [];
  const duplicateBackfillPlan = duplicateBackfillCandidates.map((c) => ({
    call_id: c.id,
    start_time: c.start_time,
    existing_tags: getTagNames(c),
    update_payload: buildDuplicateBackfillPayload(call),
  }));

  const preview = formatDecisionPreview(call, classification, payload);
  if (sourceTagResult.changed) {
    if (sourceTagResult.tag) {
      preview.source_tag_set = sourceTagResult.tag;
    } else if (sourceTagResult.removed) {
      preview.source_tag_removed = true;
    }
  }
  if (duplicateBackfillPlan.length > 0) {
    preview.duplicate_backfill_updates = duplicateBackfillPlan;
  }
  console.log(JSON.stringify(preview, null, 2));

  if (!config.apply) {
    console.log('Dry run only. Re-run with --apply to update CallRail.');
    return { status: 'processed', decision: classification.decision };
  }

  await ensureWorkflowTagsExist(config, config.companyId || call.company_id);

  console.log(`Updating call ${call.id} in CallRail...`);
  await applyUpdate(config, call.id, payload);

  if (classification.decision === 'qualified' && duplicateBackfillCandidates.length > 0) {
    for (const dupCall of duplicateBackfillCandidates) {
      console.log(`Tagging older duplicate call ${dupCall.id}...`);
      await applyUpdate(config, dupCall.id, buildDuplicateBackfillPayload(call));
    }
  }
  console.log('Update complete.');
  return { status: 'processed', decision: classification.decision };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const modeLabel = config.apply ? 'APPLY MODE' : 'DRY RUN';

  if (!config.processAll) {
    console.log(`[${modeLabel}] Looking up target call...`);
    const call = await fetchTargetCall(config);
    if (!call) {
      printNoTargetCallMessage(config);
      return;
    }
    await processSingleCall(config, call);
    return;
  }

  console.log(`[${modeLabel}] Processing all matching calls...`);
  const processedIds = new Set();
  let processed = 0;
  let skipped = 0;

  while (true) {
    const call = await fetchTargetCall(config, { excludeIds: processedIds });
    if (!call) break;
    processedIds.add(call.id);
    console.log(`\nProcessing ${processedIds.size}: ${call.id} (${call.start_time})`);
    const result = await processSingleCall(config, call);
    if (result.status === 'skipped') skipped += 1;
    else processed += 1;
  }

  if (processedIds.size === 0) {
    printNoTargetCallMessage(config);
    return;
  }

  console.log(`Batch complete. Processed=${processed}, Skipped=${skipped}, TotalSeen=${processedIds.size}`);
}

export { main, processSingleCall, fetchTargetCall, parseArgs };

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('callrail_qualify_latest_call.mjs') ||
  process.argv[1].endsWith('callrail_qualify_latest_call')
);
if (isDirectRun) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
