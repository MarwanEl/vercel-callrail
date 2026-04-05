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
];
const DUPLICATE_TAG = 'Existing Client/Duplicate';
const QUALIFIED_TAG = 'Qualified';
const HUMAN_REVIEW_TAG = 'Human Review';
const OTHER_TAG = 'Other';
const WORKFLOW_TAGS = [...new Set([...TAGS, QUALIFIED_TAG])];

const FORM_FIELDS = [
  'lead_status',
  'tags',
  'note',
  'company_id',
  'submitted_at',
  'first_form',
  'form_data',
  'form_url',
  'landing_page_url',
  'referrer',
  'referring_url',
  'source',
  'keywords',
  'campaign',
  'medium',
  'customer_phone_number',
  'customer_name',
  'customer_email',
];

function printUsage() {
  console.log(`Usage:
  node callrail_qualify_latest_form_submission.mjs [options]

Options:
  --apply                       Actually update CallRail (default is dry-run)
  --process-all                 Process all matching form submissions (instead of only one)
  --form-id <id>               Process a specific form submission id instead of latest unscored form
  --force                       Reprocess form even if already lead-scored/tagged (use with --form-id)
  --include-tagged              When auto-selecting, allow not_scored forms that already have tags
  --date-from <YYYY-MM-DD>     Optional local submitted-date lower bound (inclusive)
  --date-to <YYYY-MM-DD>       Optional local submitted-date upper bound (inclusive)
  --company-id <id>            Optional CallRail company filter
  --account-id <id>            CallRail account id (default: ${DEFAULT_ACCOUNT_ID})
  --callrail-api-key <key>     CallRail API key (or env CALLRAIL_API_KEY)
  --openai-api-key <key>       OpenAI API key (or env OPENAI_API_KEY)
  --model <model>              OpenAI model (default: ${DEFAULT_MODEL})
  --debug                       Print extra debug context
  --help                        Show this message

Examples:
  node callrail_qualify_latest_form_submission.mjs
  node callrail_qualify_latest_form_submission.mjs --apply
  node callrail_qualify_latest_form_submission.mjs --process-all --date-from 2026-03-01 --date-to 2026-03-31 --apply
  node callrail_qualify_latest_form_submission.mjs --form-id FRM123 --apply
  node callrail_qualify_latest_form_submission.mjs --form-id FRM123 --force --apply`);
}

function parseArgs(argv) {
  const parsed = {
    apply: false,
    processAll: false,
    formId: null,
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
    } else if (arg === '--form-id' || arg === '--call-id') {
      parsed.formId = (argv[i + 1] ?? '').trim() || null;
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
  if (parsed.processAll && parsed.formId) {
    throw new Error('Use either --process-all or --form-id, not both');
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

function normalizeToken(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function getFormData(call) {
  return call && typeof call.form_data === 'object' && !Array.isArray(call.form_data) ? call.form_data : {};
}

function isTechnicalFormKey(key) {
  const normalized = normalizeToken(key);
  if (!normalized) return true;
  return (
    normalized.startsWith('input') ||
    normalized.startsWith('gform') ||
    normalized.startsWith('state') ||
    normalized.startsWith('versionhash') ||
    normalized.startsWith('gfzerospam') ||
    normalized.startsWith('postid') ||
    normalized.startsWith('referertitle') ||
    normalized.startsWith('queriedid') ||
    normalized.startsWith('utm') ||
    normalized.includes('akhptextarea')
  );
}

function getPrimaryNarrative(call) {
  const formData = getFormData(call);
  const entries = Object.entries(formData);
  if (entries.length === 0) return '';

  const preferredKeys = [
    'telluswhathappenedtoyou',
    'telluswhathappened',
    'whathappened',
    'message',
    'details',
    'description',
  ];
  for (const [rawKey, rawValue] of entries) {
    const normalizedKey = normalizeToken(rawKey);
    if (!preferredKeys.some((k) => normalizedKey.includes(k))) continue;
    const value = String(rawValue ?? '').trim();
    if (value) return value;
  }
  return '';
}

function getFormTextForClassification(call) {
  const formData = getFormData(call);
  const primary = getPrimaryNarrative(call);
  const chunks = [];
  if (primary) chunks.push(primary);
  for (const [key, value] of Object.entries(formData)) {
    const val = String(value ?? '').trim();
    if (!val) continue;
    if (isTechnicalFormKey(key)) continue;
    const normalizedKey = normalizeToken(key);
    if (normalizedKey.includes('firstname') || normalizedKey.includes('lastname') || normalizedKey === 'name') continue;
    if (normalizedKey.includes('email') || normalizedKey.includes('phone')) continue;
    if (primary && val === primary) continue;
    chunks.push(val);
  }
  return chunks.join(' ').replace(/\s+/g, ' ').trim();
}

function detectCallerDisconnectedHeuristic(call) {
  const text = getFormTextForClassification(call).toLowerCase();
  if (!text) {
    return {
      decision: 'tag_only',
      tag: 'Caller Disconnected',
      lead_status: null,
      confidence: 0.99,
      summary_note:
        'No meaningful case details were provided in the form submission, so this was tagged as Caller Disconnected.',
      source: 'heuristic_empty_form_text',
    };
  }

  const stripped = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = stripped ? stripped.split(' ').filter(Boolean).length : 0;
  const meaninglessPatterns = [/^test+$/i, /^n\/?a$/i, /^none$/i, /^na$/i, /^no+$/i, /^hello$/i, /^hi$/i, /^call me$/i];

  if (wordCount <= 2 || meaninglessPatterns.some((re) => re.test(stripped))) {
    return {
      decision: 'tag_only',
      tag: 'Caller Disconnected',
      lead_status: null,
      confidence: 0.98,
      summary_note:
        'The form submission contains too little meaningful case information for intake, so this was tagged as Caller Disconnected.',
      source: 'heuristic_minimal_form_text',
    };
  }

  return null;
}

function detectExistingClientDuplicateHeuristic(call, sameContactOtherForms) {
  const text = getFormTextForClassification(call).toLowerCase();
  if (!text) return null;

  const explicitExistingPatterns = [
    /\bexisting client\b/i,
    /\bcurrent client\b/i,
    /\bupdate on (my )?case\b/i,
    /\bstatus of (my )?case\b/i,
    /\bfollow(?:ing)? up\b/i,
    /\balready have (an )?attorney\b/i,
    /\byou represent me\b/i,
  ];
  const ambiguousExistingPatterns = [/\bmy case manager\b/i, /\bmy attorney\b/i];
  const newIntakePatterns = [
    /\bcar accident\b/i,
    /\bmotorcycle accident\b/i,
    /\btruck accident\b/i,
    /\brear[- ]?ended\b/i,
    /\bpedestrian\b/i,
    /\bcyclist\b/i,
    /\bi was hit\b/i,
    /\bnot at fault\b/i,
  ];

  const explicitHits = explicitExistingPatterns.filter((re) => re.test(text)).length;
  const ambiguousHits = ambiguousExistingPatterns.filter((re) => re.test(text)).length;
  const hasPriorForms = Array.isArray(sameContactOtherForms) && sameContactOtherForms.length > 0;
  const hasPriorQualifiedForm = hasPriorForms && sameContactOtherForms.some((c) => isQualifiedLead(c));
  const hasNewIntakeSignal = newIntakePatterns.some((re) => re.test(text));

  if (hasNewIntakeSignal && !hasPriorQualifiedForm) return null;

  if (explicitHits >= 1 || hasPriorQualifiedForm || (ambiguousHits >= 1 && hasPriorForms)) {
    return {
      decision: 'tag_only',
      tag: DUPLICATE_TAG,
      lead_status: null,
      confidence: 0.98,
      summary_note:
        'This form appears to be an existing-client follow-up or duplicate submission, so it was tagged as Existing Client/Duplicate.',
      source: 'heuristic_existing_client_followup',
    };
  }

  return null;
}

function enforceQualificationGuardrails(classification, call, sameContactOtherForms) {
  if (classification.decision !== 'qualified') {
    return classification;
  }

  const existingClientHeuristic = detectExistingClientDuplicateHeuristic(call, sameContactOtherForms);
  if (existingClientHeuristic) {
    return normalizeClassification({
      ...existingClientHeuristic,
      source: 'guardrail_existing_client_override',
    });
  }

  return classification;
}

function hasPotentialMvaContext(call) {
  const text = getFormTextForClassification(call).toLowerCase();
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

function canUseDuplicateTag(call, priorSameContactForms, existingClientHeuristic) {
  if (existingClientHeuristic) return true;
  if (Array.isArray(priorSameContactForms) && priorSameContactForms.some((c) => isQualifiedLead(c))) return true;
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
  const nameMap = new Map();
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const list = await callrailRequest(config, `/tags.json?per_page=250&page=${page}`);
    totalPages = Number(list.total_pages ?? 1) || 1;
    const tags = Array.isArray(list.tags) ? list.tags : [];
    for (const tag of tags) {
      if (String(tag?.company_id || '') !== cid) continue;
      const name = String(tag?.name || '').trim();
      if (name) {
        const key = name.toLowerCase();
        existingLower.add(key);
        if (!nameMap.has(key)) nameMap.set(key, name);
      }
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
      nameMap.set(key, name);
      console.log(`Created missing tag "${name}" for company ${cid}.`);
    } catch (error) {
      const msg = String(error?.message || '');
      if (msg.includes('Name has already been taken') || msg.includes('agency-level tag')) {
        existingLower.add(key);
        if (!nameMap.has(key)) nameMap.set(key, name);
        continue;
      }
      throw error;
    }
  }

  if (!config._companyTagNameMap) {
    config._companyTagNameMap = new Map();
  }
  config._companyTagNameMap.set(cid, nameMap);
  config._ensuredTagCompanies.add(cid);
}

function normalizePayloadTagNamesForCompany(config, companyId, payload) {
  if (!payload || !Array.isArray(payload.tags) || payload.tags.length === 0) return payload;
  const cid = String(companyId || '').trim();
  const map = config?._companyTagNameMap?.get(cid);
  if (!map) return payload;
  const tags = [];
  const seen = new Set();
  for (const tag of payload.tags) {
    const raw = String(tag || '').trim();
    if (!raw) continue;
    const resolved = map.get(raw.toLowerCase()) || raw;
    const key = resolved.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(resolved);
  }
  return { ...payload, tags };
}

function buildFormListParams({
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
  if (sort) params.set('sort', sort);
  if (order) params.set('order', order);
  params.set('fields', fields.join(','));
  if (companyId) params.set('company_id', companyId);
  if (leadStatus) params.set('lead_status', leadStatus);
  if (startDate) params.set('start_date', startDate);
  if (endDate) params.set('end_date', endDate);
  if (dateRange) params.set('date_range', dateRange);
  return params.toString();
}

function callLocalDateKey(call) {
  const start = String(call?.submitted_at ?? '');
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
  if (config.formId) {
    const params = new URLSearchParams();
    params.set('fields', FORM_FIELDS.join(','));
    const single = await callrailRequest(config, `/form_submissions/${encodeURIComponent(config.formId)}.json?${params.toString()}`);
    return single.form_submission ?? single;
  }

  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const hasExplicitRange = Boolean(config.dateFrom || config.dateTo);
    const query = buildFormListParams({
      perPage: 100,
      page,
      sort: 'submitted_at',
      order: 'desc',
      companyId: config.companyId,
      leadStatus: null,
      fields: FORM_FIELDS,
      startDate: config.dateFrom || null,
      endDate: config.dateTo || null,
      dateRange: hasExplicitRange ? null : 'all_time',
    });

    const list = await callrailRequest(config, `/form_submissions.json?${query}`);
    totalPages = Number(list.total_pages ?? 1) || 1;
    const forms = Array.isArray(list.form_submissions) ? list.form_submissions : [];
    const unprocessed = forms.find(
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

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isSameFormContact(base, other) {
  const basePhone = normalizePhone(base?.customer_phone_number);
  const otherPhone = normalizePhone(other?.customer_phone_number);
  if (basePhone && otherPhone && basePhone === otherPhone) return true;

  const baseEmail = normalizeEmail(base?.customer_email);
  const otherEmail = normalizeEmail(other?.customer_email);
  if (baseEmail && otherEmail && baseEmail === otherEmail) return true;

  return false;
}

async function fetchRecentCallsForNumber(config, submission) {
  if (!submission?.customer_phone_number && !submission?.customer_email) return [];
  const hasExplicitRange = Boolean(config.dateFrom || config.dateTo);
  const query = buildFormListParams({
    perPage: 250,
    page: 1,
    sort: 'submitted_at',
    order: 'desc',
    companyId: config.companyId,
    leadStatus: null,
    fields: [
      'id',
      'submitted_at',
      'first_form',
      'customer_phone_number',
      'customer_email',
      'customer_name',
      'form_data',
      'lead_status',
      'tags',
      'note',
    ],
    startDate: config.dateFrom || null,
    endDate: config.dateTo || null,
    dateRange: hasExplicitRange ? null : 'all_time',
  });

  const list = await callrailRequest(config, `/form_submissions.json?${query}`);
  const all = Array.isArray(list.form_submissions) ? list.form_submissions : [];
  return all.filter((c) => isSameFormContact(submission, c));
}

function buildOpenAiPrompt(call, sameNumberCalls, options = {}) {
  const { disallowDuplicateTag = false } = options;
  const allowedTags = disallowDuplicateTag ? TAGS.filter((t) => t !== DUPLICATE_TAG) : TAGS;
  const history = sameNumberCalls
    .slice(0, 6)
    .map((c) => ({
      id: c.id,
      submitted_at: c.submitted_at,
      first_form: c.first_form,
      lead_status: c.lead_status,
      tags: c.tags,
    }));
  const primaryNarrative = getPrimaryNarrative(call);
  const freeText = getFormTextForClassification(call);

  return [
    'You are a legal intake assistant for a personal injury law firm.',
    'You are classifying WEBSITE FORM SUBMISSIONS (not call transcripts).',
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
    '- Existing Client/Duplicate: repeat submitter, active client follow-up, or duplicate form about the same matter.',
    '- JOB APPLICATION: recruiting/employment inquiry.',
    '- Caller Disconnected: no meaningful conversation, dead air/ivr, very short abrupt disconnect.',
    '- Insurance Company: carrier/adjuster outreach.',
    '- Treatment provider: medical/chiro/clinic provider outreach.',
    '- SPAM: robocall/solicitation/scam.',
    '- Human Review: possible MVA intake but not enough clarity to decide qualification automatically (especially unclear fault/coverage).',
    '- Unrelated Case: legal matter outside MVA personal injury scope.',
    '- Other: non-MVA or miscellaneous non-intake items that do not fit any specific tag.',
    '',
    'Decision rules:',
    '- Use decision=qualified ONLY when this submission is a valid MVA case and injured party appears not at fault.',
    '- For anything else, use decision=tag_only and choose one tag.',
    '- If the submission looks like a possible MVA but fault is unclear, choose Human Review (not Other).',
    '- Never use lead-status concepts in output. This workflow only marks qualified submissions.',
    '- If submitter appears to be existing client / case update / follow-up, ALWAYS use Existing Client/Duplicate (never qualified).',
    '- If there is already an older same-contact form with good_lead, default to Existing Client/Duplicate unless clear evidence this is a new unrelated intake.',
    disallowDuplicateTag
      ? '- IMPORTANT: For this classification pass, do NOT use Existing Client/Duplicate.'
      : '',
    '',
    'Return 1-2 sentence summary_note.',
    '',
    'FORM SUBMISSION JSON:',
    JSON.stringify(
      {
        id: call.id,
        submitted_at: call.submitted_at,
        customer_name: call.customer_name,
        customer_email: call.customer_email,
        customer_phone_number: call.customer_phone_number,
        first_form: call.first_form,
        existing_tags: getTagNames(call),
        existing_note: call.note ?? null,
        tell_us_what_happened: primaryNarrative || null,
        extracted_form_text: freeText || null,
        form_data: getFormData(call),
        same_contact_recent_forms: history,
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
      },
      required: ['decision', 'tag', 'summary_note', 'confidence'],
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
      temperature: 0.1,
      response_format: {
        type: 'json_schema',
        json_schema: schema,
      },
      messages: [
        {
          role: 'system',
          content:
            'Classify website form submissions for legal intake workflow. Follow business rules exactly and produce valid schema JSON.',
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
    source: typeof raw.source === 'string' ? raw.source : 'openai',
  };

  if (!['qualified', 'tag_only'].includes(result.decision)) {
    result.decision = 'tag_only';
  }

  if (result.decision === 'qualified') {
    result.lead_status = 'good_lead';
    result.tag = null;
  } else {
    if (!result.tag || !TAGS.includes(result.tag)) {
      result.tag = HUMAN_REVIEW_TAG;
    }
    result.lead_status = null;
  }

  if (!Number.isFinite(result.confidence)) {
    result.confidence = 0.5;
  } else {
    result.confidence = Math.max(0, Math.min(1, result.confidence));
  }

  if (!result.summary_note) {
    if (result.decision === 'qualified') {
      result.summary_note = 'Form details indicate an MVA intake where the injured party appears not at fault. Marked as qualified.';
    } else {
      result.summary_note = 'Form details did not meet qualification criteria and were tagged for follow-up routing.';
    }
  }

  return result;
}

function buildUpdatePayload(call, classification, options = {}) {
  const forceReplaceTag = Boolean(options.forceReplaceTag);
  if (classification.decision === 'qualified') {
    const payload = {
      note: classification.summary_note,
      lead_status: 'good_lead',
    };

    // Guardrail: qualified submission must always have "Qualified" and never keep duplicate tag.
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
  // If this submission was incorrectly marked qualified earlier, clear that state on tag-only correction.
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
  const currentMs = getTimestampMs(currentCall.submitted_at);

  return sameNumberOtherCalls
    .filter((other) => {
      if (!other?.id) return false;
      if (isQualifiedLead(other)) return false;
      if (hasTagName(other, DUPLICATE_TAG)) return false;
      if (currentMs == null) return true;
      const otherMs = getTimestampMs(other.submitted_at);
      return otherMs == null || otherMs <= currentMs;
    })
    .sort((a, b) => (getTimestampMs(a.submitted_at) ?? 0) - (getTimestampMs(b.submitted_at) ?? 0));
}

function buildDuplicateBackfillPayload(qualifiedCall) {
  const note = ensureOneOrTwoSentences(
    `A newer form submission from this same contact (${qualifiedCall.id}) was identified as the valid qualified intake. This earlier submission was tagged as Existing Client/Duplicate.`
  );
  return {
    note,
    append_tags: true,
    tags: [DUPLICATE_TAG],
  };
}

function formatDecisionPreview(call, classification, payload) {
  return {
    form_id: call.id,
    submitted_at: call.submitted_at,
    customer_email: call.customer_email,
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
  return callrailRequest(config, `/form_submissions/${encodeURIComponent(callId)}.json`, {
    method: 'PUT',
    body: payload,
  });
}

function printNoTargetCallMessage(config) {
  if (config.processAll && (config.dateFrom || config.dateTo)) {
    if (config.includeTagged) {
      console.log('No target form found. (No unscored forms matched your date filters.)');
    } else {
      console.log('No target form found. (No unscored-and-untagged forms matched your date filters.)');
    }
    return;
  }
  if (config.includeTagged) {
    console.log('No target form found. (No unscored forms matched your filters.)');
  } else {
    console.log('No target form found. (No unscored-and-untagged forms matched your filters.)');
    console.log('Tip: use --include-tagged to allow tagged unscored forms.');
  }
}

async function processSingleCall(config, call) {
  if (isLeadScored(call) && !config.force) {
    console.log(`Form ${call.id} already has lead_status="${call.lead_status}". Skipping.`);
    return { status: 'skipped' };
  }
  if (config.force) {
    console.log(`Force mode enabled for form ${call.id}; existing lead status/tags will be re-evaluated.`);
  }

  const sameNumberCalls = await fetchRecentCallsForNumber(config, call);
  const sameNumberOtherCalls = sameNumberCalls.filter((c) => c.id !== call.id);
  const currentCallMs = getTimestampMs(call.submitted_at);
  const priorSameNumberCalls = sameNumberOtherCalls.filter((c) => {
    if (currentCallMs == null) return true;
    const ms = getTimestampMs(c.submitted_at);
    return ms == null || ms <= currentCallMs;
  });
  const laterSameNumberCalls = sameNumberOtherCalls.filter((c) => {
    if (currentCallMs == null) return false;
    const ms = getTimestampMs(c.submitted_at);
    return ms != null && ms > currentCallMs;
  });

  if (config.debug) {
    console.log(
      JSON.stringify(
        {
          selected_form_id: call.id,
          selected_form_first_form: call.first_form,
          selected_form_has_primary_text: Boolean(getPrimaryNarrative(call)),
          same_contact_other_forms_found: sameNumberOtherCalls.length,
          same_contact_prior_forms_found: priorSameNumberCalls.length,
          same_contact_later_forms_found: laterSameNumberCalls.length,
        },
        null,
        2
      )
    );
  }

  const heuristicClassification = detectCallerDisconnectedHeuristic(call);
  let classification;
  const existingClientHeuristic = detectExistingClientDuplicateHeuristic(call, priorSameNumberCalls);
  const callForClassification = config.force ? { ...call, tags: [], note: null } : call;
  if (heuristicClassification) {
    console.log(`Heuristic classification matched for ${call.id}: ${heuristicClassification.source}`);
    classification = normalizeClassification(heuristicClassification);
  } else if (existingClientHeuristic) {
    console.log(`Heuristic classification matched for ${call.id}: ${existingClientHeuristic.source}`);
    classification = normalizeClassification(existingClientHeuristic);
  } else {
    console.log(`Classifying form ${call.id} with model ${config.model}...`);
    const rawClassification = await classifyCall(config, callForClassification, priorSameNumberCalls);
    classification = normalizeClassification(rawClassification);
    classification = enforceQualificationGuardrails(classification, call, priorSameNumberCalls);
    classification = enforceHumanReviewGuardrails(classification, call);

    const duplicateAllowed = canUseDuplicateTag(call, priorSameNumberCalls, existingClientHeuristic);
    if (classification.decision === 'tag_only' && classification.tag === DUPLICATE_TAG && !duplicateAllowed) {
      console.log(`Duplicate tag not allowed for ${call.id} (no duplicate evidence). Reclassifying without duplicate option...`);
      const retryRaw = await classifyCall(config, callForClassification, priorSameNumberCalls, {
        disallowDuplicateTag: true,
      });
      classification = normalizeClassification(retryRaw);
      classification = enforceQualificationGuardrails(classification, call, priorSameNumberCalls);
      classification = enforceHumanReviewGuardrails(classification, call);
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
  const payload = buildUpdatePayload(call, classification, {
    forceReplaceTag: config.force && classification.decision === 'tag_only',
  });

  const duplicateBackfillCandidates =
    classification.decision === 'qualified'
      ? getDuplicateBackfillCandidates(call, sameNumberOtherCalls)
      : [];
  const duplicateBackfillPlan = duplicateBackfillCandidates.map((c) => ({
    form_id: c.id,
    submitted_at: c.submitted_at,
    existing_tags: getTagNames(c),
    update_payload: buildDuplicateBackfillPayload(call),
  }));

  const preview = formatDecisionPreview(call, classification, payload);
  if (duplicateBackfillPlan.length > 0) {
    preview.duplicate_backfill_updates = duplicateBackfillPlan;
  }
  console.log(JSON.stringify(preview, null, 2));

  if (!config.apply) {
    console.log('Dry run only. Re-run with --apply to update CallRail.');
    return { status: 'processed', decision: classification.decision };
  }

  const companyIdForUpdate = config.companyId || call.company_id;
  await ensureWorkflowTagsExist(config, companyIdForUpdate);

  const payloadForUpdate = normalizePayloadTagNamesForCompany(
    config,
    companyIdForUpdate,
    payload
  );

  console.log(`Updating form submission ${call.id} in CallRail...`);
  await applyUpdate(config, call.id, payloadForUpdate);

  if (classification.decision === 'qualified' && duplicateBackfillCandidates.length > 0) {
    for (const dupCall of duplicateBackfillCandidates) {
      const dupPayload = normalizePayloadTagNamesForCompany(
        config,
        companyIdForUpdate,
        buildDuplicateBackfillPayload(call)
      );
      console.log(`Tagging older duplicate form ${dupCall.id}...`);
      await applyUpdate(config, dupCall.id, dupPayload);
    }
  }
  console.log('Update complete.');
  return { status: 'processed', decision: classification.decision };
}

async function main() {
  const config = parseArgs(process.argv.slice(2));
  const modeLabel = config.apply ? 'APPLY MODE' : 'DRY RUN';

  if (!config.processAll) {
    console.log(`[${modeLabel}] Looking up target form submission...`);
    const call = await fetchTargetCall(config);
    if (!call) {
      printNoTargetCallMessage(config);
      return;
    }
    await processSingleCall(config, call);
    return;
  }

  console.log(`[${modeLabel}] Processing all matching form submissions...`);
  const processedIds = new Set();
  let processed = 0;
  let skipped = 0;

  while (true) {
    const call = await fetchTargetCall(config, { excludeIds: processedIds });
    if (!call) break;
    processedIds.add(call.id);
    console.log(`\nProcessing ${processedIds.size}: ${call.id} (${call.submitted_at})`);
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

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
});
