import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";
const supportedTranscriptLanguages = new Set(["en", "zh", "fr"]);

loadEnvFile(".env");
loadEnvFile(".env.local");

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/realtime/session" && request.method === "POST") {
      await createRealtimeSession(response);
      return;
    }

    if (url.pathname === "/api/transcribe" && request.method === "POST") {
      await transcribeAudioChunk(request, response);
      return;
    }

    if (url.pathname === "/api/diarize" && request.method === "POST") {
      await transcribeAudioChunk(request, response, { diarize: true });
      return;
    }

    if (url.pathname === "/api/plan-actions" && request.method === "POST") {
      await planActions(request, response);
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    serveStatic(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Server error" });
  }
});

server.listen(port, host, () => {
  console.log(`RoomPilot server running at http://localhost:${port}`);
});

function loadEnvFile(fileName) {
  const filePath = join(root, fileName);

  if (!existsSync(filePath)) return;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function createRealtimeSession(response) {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 501, {
      error: "OPENAI_API_KEY is missing in .env.local",
    });
    return;
  }

  const transcriptModel =
    process.env.OPENAI_REALTIME_TRANSCRIBE_MODEL ||
    process.env.OPENAI_TRANSCRIBE_MODEL ||
    "gpt-4o-mini-transcribe";
  const realtimeModel = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
  const sessionConfig = buildRealtimeTranscriptionSession({
    realtimeModel,
    transcriptModel,
  });

  const upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: {
        anchor: "created_at",
        seconds: 600,
      },
      session: sessionConfig,
    }),
  });

  const payload = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    sendJson(response, upstream.status, {
      error: payload.error?.message || "OpenAI Realtime session failed",
      details: payload,
    });
    return;
  }

  console.log("Realtime transcription client secret created", {
    realtimeModel,
    transcriptModel,
  });

  sendJson(response, 200, {
    ...payload,
    realtime_model: realtimeModel,
    transcription_model: transcriptModel,
    session_type: sessionConfig.type,
  });
}

function buildRealtimeTranscriptionSession({ realtimeModel, transcriptModel }) {
  const transcription = {
    model: transcriptModel,
  };
  const language = getTranscriptionLanguage();

  if (language) {
    transcription.language = language;
  }

  return {
    type: "realtime",
    model: realtimeModel,
    instructions:
      "Only transcribe English, Chinese, or French speech for live captions. Do not translate, answer, greet, encourage, or continue the conversation.",
    audio: {
      input: {
        transcription,
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 350,
        },
      },
    },
  };
}

function getTranscriptionLanguage() {
  const rawLanguage = cleanText(process.env.OPENAI_TRANSCRIBE_LANGUAGE).toLowerCase();

  if (!rawLanguage) return null;

  const normalizedLanguage =
    {
      english: "en",
      chinese: "zh",
      mandarin: "zh",
      "zh-cn": "zh",
      "zh-tw": "zh",
      cn: "zh",
      french: "fr",
      francais: "fr",
      "français": "fr",
    }[rawLanguage] || rawLanguage;

  if (supportedTranscriptLanguages.has(normalizedLanguage)) {
    return normalizedLanguage;
  }

  console.warn("Ignoring unsupported OPENAI_TRANSCRIBE_LANGUAGE", {
    language: rawLanguage,
    supported: Array.from(supportedTranscriptLanguages),
  });
  return null;
}

async function transcribeAudioChunk(request, response, options = {}) {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 501, {
      error: "OPENAI_API_KEY is missing in .env.local",
    });
    return;
  }

  const audio = await readRequestBody(request, 8 * 1024 * 1024);

  if (audio.length < 1200) {
    sendJson(response, 400, { error: "Audio chunk is too small" });
    return;
  }

  const form = new FormData();
  const contentType = normalizeAudioContentType(
    request.headers["content-type"] || "audio/webm"
  );
  const fileName = contentType === "audio/mp4" ? "roompilot.mp4" : "roompilot.webm";
  const wantsDiarization = Boolean(options.diarize);
  const model =
    (wantsDiarization
      ? process.env.OPENAI_DIARIZE_MODEL
      : process.env.OPENAI_AUDIO_TRANSCRIBE_MODEL) ||
    process.env.OPENAI_TRANSCRIBE_MODEL ||
    (wantsDiarization ? "gpt-4o-transcribe-diarize" : "gpt-4o-mini-transcribe");

  console.log("Transcribe chunk", {
    bytes: audio.length,
    contentType,
    model,
  });

  form.append("model", model);
  form.append("file", new Blob([audio], { type: contentType }), fileName);

  if (wantsDiarization) {
    form.append("response_format", "diarized_json");
    form.append("chunking_strategy", "auto");
    form.append(
      "prompt",
      "The conversation may switch between English, Mandarin Chinese, and French. Preserve the original language. Do not translate. Separate different speakers when there is enough evidence."
    );
  }

  const language = getTranscriptionLanguage();

  if (language) {
    form.append("language", language);
  }

  const upstream = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: form,
  });

  const payload = await upstream.json().catch(() => ({}));

  if (!upstream.ok) {
    console.warn("Transcription failed", {
      status: upstream.status,
      error: payload.error?.message,
    });
    sendJson(response, upstream.status, {
      error: payload.error?.message || "OpenAI transcription failed",
      details: payload,
    });
    return;
  }

  sendJson(response, 200, {
    text: payload.text || "",
    segments: normalizeTranscriptionSegments(payload),
    model,
  });

  console.log("Transcription complete", {
    chars: (payload.text || "").length,
  });
}

function normalizeTranscriptionSegments(payload) {
  const segments = Array.isArray(payload.segments) ? payload.segments : [];

  return segments
    .map((segment) => ({
      speaker: normalizeSpeakerLabel(segment.speaker),
      text: cleanText(segment.text),
      start: typeof segment.start === "number" ? segment.start : null,
      end: typeof segment.end === "number" ? segment.end : null,
    }))
    .filter((segment) => segment.text);
}

function normalizeSpeakerLabel(speaker) {
  const label = cleanText(speaker);

  if (!label) return "Speaker";

  return label
    .replace(/^speaker[_\s-]?/i, "Speaker ")
    .replace(/\s+/g, " ")
    .trim();
}

async function planActions(request, response) {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const body = await readJsonBody(request, 128 * 1024);
  const userGoal = String(body.user_goal || "Find useful follow-up after Tech Europe.");
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const memoryQuotes = Array.isArray(body.memory_quotes) ? body.memory_quotes : [];
  const signalGate = evaluateSignalGate(transcript, memoryQuotes);
  const fallbackPlan = buildLocalPlan(userGoal, transcript, memoryQuotes, signalGate);

  if (!signalGate.should_consider) {
    sendJson(response, 200, {
      ...emptyPlan(userGoal),
      source: "pioneer_signal_gate",
      gate_reason: signalGate.reason,
    });
    return;
  }

  if (!process.env.OPENAI_API_KEY) {
    sendJson(response, 200, {
      ...fallbackPlan,
      source: "local_fallback",
      planner_status: "OPENAI_API_KEY is missing in .env.local",
    });
    return;
  }

  try {
    const model =
      process.env.OPENAI_PLANNER_MODEL ||
      process.env.OPENAI_MODEL ||
      "gpt-4.1-nano";
    const plannerTimeoutMs = Number(process.env.OPENAI_PLANNER_TIMEOUT_MS || 6500);
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(plannerTimeoutMs),
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: plannerSystemPrompt(),
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: JSON.stringify(
                  {
                    user_goal: userGoal,
                    transcript,
                    memory_quotes: memoryQuotes,
                    action_gate: signalGate,
                  },
                  null,
                  2
                ),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "roompilot_action_plan",
            strict: true,
            schema: plannerSchema(),
          },
        },
        max_output_tokens: 260,
      }),
    });

    const payload = await upstream.json().catch(() => ({}));

    if (!upstream.ok) {
      console.warn("Planner failed", {
        status: upstream.status,
        error: payload.error?.message,
      });
      sendJson(response, 200, {
        ...fallbackPlan,
        source: "local_fallback",
        planner_status: payload.error?.message || "OpenAI planner failed",
      });
      return;
    }

    const plan = parsePlannerResponse(payload);
    sendJson(response, 200, {
      ...normalizePlan(plan, fallbackPlan),
      source: "openai",
      model,
      gate_reason: signalGate.reason,
    });
  } catch (error) {
    console.warn("Planner exception", error);
    sendJson(response, 200, {
      ...fallbackPlan,
      source: "local_fallback",
      planner_status: error.message,
    });
  }
}

function plannerSystemPrompt() {
  return [
    "You are RoomPilot's live conversation planner.",
    "Decide whether the user should act now based only on visible transcript evidence and the user's goal.",
    "Respect the action_gate. If action_gate.should_consider is false, return should_act=false.",
    "If action_gate.focus_quote is present, use that quote as the evidence unless the transcript has a clearer later quote.",
    "RoomPilot only supports English, Chinese, and French. If the transcript is in another language, return should_act=false.",
    "The UI must feel like a thoughtful friend, not a sales tool.",
    "Never use sales-methodology words in user-visible strings.",
    "Your job is only the live suggestion card. Keep the JSON short.",
    "Do not reuse canned demo wording. Do not say follow-up problem unless the evidence quote literally concerns follow-up.",
    "If the evidence points to a person, department, event, resource, LinkedIn profile, email, or next path, write the cue about clarifying that path.",
    "Every recommendation must cite one exact evidence quote from the transcript or memory quotes.",
    "If evidence is weak, set should_act=false and keep all user-visible suggestion fields empty.",
    "If should_act=true, live_cue must include a concrete next move, not just a summary.",
    "live_cue should be one plain sentence, 10 to 22 words, with one natural question or action.",
    "For live_cue, prefer what to ask while the person is still talking. Put reach-out, email, LinkedIn, and lookup work after the conversation.",
    "not_inferred must be a short non-empty sentence whenever should_act=true.",
    "not_inferred must fit the evidence. Do not mention deals, buying, or meetings unless the quote raised that topic.",
    "Visible action labels must be short: Ask, Save, Compare, Draft later, Find public context, Reminder.",
    "Do not infer budget, title, intent to buy, or relationship unless directly stated.",
    "Actions are user-confirmed. Never say an email, social lookup, reminder, or intro has already happened.",
    "Prefer one light live cue. Local code will fill action queues after your cue.",
  ].join(" ");
}

function plannerSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "should_act",
      "evidence_quote",
      "live_cue",
      "not_inferred",
      "confidence",
      "recommended_action_type",
      "action_reason",
    ],
    properties: {
      should_act: { type: "boolean" },
      evidence_quote: { type: "string" },
      live_cue: { type: "string" },
      not_inferred: { type: "string" },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      recommended_action_type: {
        type: "string",
        enum: [
          "none",
          "ask",
          "save",
          "compare",
          "draft_later",
          "find_public_context",
          "reminder",
        ],
      },
      action_reason: { type: "string" },
    },
  };
}

function parsePlannerResponse(payload) {
  if (payload.output_text) {
    return JSON.parse(payload.output_text);
  }

  const message = payload.output
    ?.flatMap((item) => item.content || [])
    ?.find((part) => part.type === "output_text" || part.text);

  return JSON.parse(message?.text || "{}");
}

function normalizePlan(plan, fallbackPlan) {
  if (!plan || typeof plan !== "object") return fallbackPlan;

  if (!plan.should_act) {
    return {
      ...fallbackPlan,
      should_act: false,
      evidence_quote: "",
      live_cue: "",
      not_inferred: "",
      recommended_action_type: "none",
      action_reason: "",
      actions: [],
      after_session_actions: [],
    };
  }

  const modelRecommendedActionType = [
    "none",
    "ask",
    "save",
    "compare",
    "draft_later",
    "find_public_context",
    "reminder",
  ].includes(plan.recommended_action_type)
    ? plan.recommended_action_type
    : "";
  const recommendedActionType =
    modelRecommendedActionType || fallbackPlan.recommended_action_type || "ask";

  return {
    should_act: Boolean(plan.should_act),
    evidence_quote: cleanText(plan.evidence_quote),
    live_cue: ensureConcreteCue(plan, fallbackPlan),
    not_inferred: normalizeNotInferred(plan.not_inferred, fallbackPlan.not_inferred),
    confidence: ["low", "medium", "high"].includes(plan.confidence)
      ? plan.confidence
      : "medium",
    recommended_action_type: recommendedActionType,
    action_reason: cleanText(plan.action_reason),
    actions: normalizeActions(
      Array.isArray(plan.actions) ? plan.actions : fallbackPlan.actions,
      recommendedActionType
    ),
    after_session_actions: normalizeAfterSessionActions(
      Array.isArray(plan.after_session_actions)
        ? plan.after_session_actions.slice(0, 5)
        : fallbackPlan.after_session_actions,
      fallbackPlan
    ),
    memory_update: normalizeMemoryUpdate(
      plan.memory_update,
      fallbackPlan.memory_update,
      false
    ),
  };
}

function normalizeNotInferred(value, fallbackValue) {
  const text = cleanText(value);
  const lower = text.toLowerCase();
  const looksLikeRestraint =
    lower.startsWith("not ") ||
    lower.startsWith("does not ") ||
    lower.startsWith("do not ") ||
    lower.includes(" not ") ||
    lower.includes("n't ") ||
    lower.includes("yet") ||
    lower.includes("unknown");
  const soundsLikeExplanation =
    lower.includes("directly mentioned") ||
    lower.includes("explicitly stated") ||
    lower.includes("evidence shows") ||
    lower.includes("the speaker said");

  if (text && looksLikeRestraint && !soundsLikeExplanation) {
    return text;
  }

  return cleanText(fallbackValue) || "Not assuming they want to buy or meet anyone yet.";
}

function ensureConcreteCue(plan, fallbackPlan) {
  const cue = cleanText(plan.live_cue);

  if (!cue) return fallbackPlan.live_cue;

  const lower = cue.toLowerCase();
  const evidence = cleanText(plan.evidence_quote || fallbackPlan.evidence_quote).toLowerCase();
  const soundsLikeMove =
    lower.includes("ask") ||
    lower.includes("save") ||
    lower.includes("draft") ||
    lower.includes("look up") ||
    lower.includes("follow up") ||
    lower.includes("compare") ||
    lower.includes("reach out") ||
    lower.includes("clarify") ||
    lower.includes("check") ||
    lower.includes("find");

  if (soundsLikeMove) return cue;

  if (/hexa|hx|nick|负责人|部门|相关的项目|email|gmail|linkedin|领英|资源|resource|person/.test(evidence)) {
    return `${cue} Ask who to talk to first and what to mention.`;
  }

  if (/会议|约|meeting|call|q[1-4]|q2|q3|之前|before/.test(evidence)) {
    return `${cue} Ask who should be in the first meeting.`;
  }

  return `${cue} Ask what they have already tried.`;
}

function normalizeMemoryUpdate(memoryUpdate, fallbackMemoryUpdate, preferFallback) {
  if (preferFallback) {
    return fallbackMemoryUpdate;
  }

  return {
    ...fallbackMemoryUpdate,
    ...(memoryUpdate || {}),
  };
}

function normalizeActions(actions, selectedType) {
  const allowed = [
    ["ask", "Ask"],
    ["save", "Save"],
    ["compare", "Compare"],
    ["draft_later", "Draft later"],
    ["find_public_context", "Find public context"],
    ["reminder", "Reminder"],
  ];
  const incomingTypes = new Set(actions.map((action) => action.type));
  const orderedTypes = allowed
    .filter(([type]) => incomingTypes.has(type) || type === selectedType)
    .map(([type]) => type);
  const finalTypes = orderedTypes.length
    ? orderedTypes
    : ["ask", "save", "draft_later", "find_public_context"];

  return allowed
    .filter(([type]) => finalTypes.includes(type))
    .map(([type, label]) => ({
      type,
      label,
      selected: type === selectedType,
    }));
}

function normalizeAfterSessionActions(actions, fallbackPlan) {
  const normalized = actions
    .filter((action) => action.title && action.detail && action.proof)
    .map((action) => ({
      title: cleanText(action.title),
      detail: cleanText(action.detail),
      proof: cleanText(action.proof),
    }));
  const titles = new Set(normalized.map((action) => action.title.toLowerCase()));

  for (const action of fallbackPlan.after_session_actions || []) {
    const title = action.title.toLowerCase();

    if (!titles.has(title)) {
      normalized.push(action);
      titles.add(title);
    }
  }

  return normalized.slice(0, 5);
}

function evaluateSignalGate(transcript, memoryQuotes) {
  const speakerLines = transcript
    .map((line, index) => ({ ...line, index }))
    .filter((line) => cleanText(line.text) && !isUserLine(line));
  const latestLine = speakerLines[speakerLines.length - 1];

  if (!speakerLines.length) {
    return {
      should_consider: false,
      fast_path: false,
      focus_quote: "",
      score: 0,
      reason: "No speaker quote yet.",
    };
  }

  const allText = transcript.map((line) => line.text || "").join(" ");
  const candidates = speakerLines
    .filter((line) => !isLowValueQuote(line.text))
    .map((line) => {
      const priorText = transcript
        .filter((candidate) => candidate !== line)
        .map((candidate) => candidate.text || "")
        .join(" ");

      return scoreSignalCandidate(cleanText(line.text), priorText, allText, memoryQuotes, line.index);
    })
    .filter((candidate) => candidate.language.supported)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const best = candidates[0];
  const quote = best?.focus_quote || best?.quote || cleanText(latestLine?.text);

  if (!best && isLowValueQuote(quote)) {
    return {
      should_consider: false,
      fast_path: false,
      focus_quote: quote,
      score: 0,
      reason: "Small talk or acknowledgement; stay quiet.",
    };
  }

  const language = best?.language || detectSupportedQuoteLanguage(quote);

  if (!language.supported) {
    return {
      should_consider: false,
      fast_path: false,
      focus_quote: quote,
      score: 0,
      reason: "Unsupported language; RoomPilot only supports English, Chinese, and French.",
    };
  }

  const score = best?.score || 0;
  const shouldConsider = Boolean(best?.should_consider);

  return {
    should_consider: shouldConsider,
    fast_path: shouldConsider && (score >= 3 || best.hasOwner || best.hasTiming || best.hasContactRequest),
    focus_quote: quote,
    score,
    language: language.code,
    reason: shouldConsider
      ? "Speaker gave a quote-backed problem, owner, timing, contact step, or memory bridge."
      : "No new quote-backed move; keep the UI quiet.",
  };
}

function scoreSignalCandidate(quote, priorText, allText, memoryQuotes, index) {
  const lowerQuote = quote.toLowerCase();
  const lowerPrior = priorText.toLowerCase();
  const lowerAll = allText.toLowerCase();
  const language = detectSupportedQuoteLanguage(quote);
  const hasProblem = hasAny(lowerQuote, [
    "hard",
    "difficult",
    "struggle",
    "struggling",
    "bad",
    "broken",
    "pain",
    "problem",
    "nobody remembers",
    "lose",
    "lost",
    "inconsistent",
    "consistently",
    "can't",
    "cannot",
    "messy",
    "难",
    "麻烦",
    "问题",
    "痛点",
    "做不好",
    "混乱",
    "乱",
    "没人记得",
    "记不住",
    "丢",
    "difficile",
    "compliqué",
    "complique",
    "problème",
    "probleme",
    "douleur",
    "mauvais",
    "personne ne se souvient",
    "perdre",
    "perdu",
    "incohérent",
    "incoherent",
    "désorganisé",
    "desorganise",
  ]);
  const hasFollowUpTopic = hasAny(lowerQuote, [
    "follow up",
    "follow-up",
    "lead",
    "leads",
    "intro",
    "intros",
    "event",
    "跟进",
    "线索",
    "客户",
    "介绍",
    "对接",
    "活动",
    "会后",
    "表格",
    "crm",
    "hubspot",
    "suivi",
    "relance",
    "prospect",
    "prospects",
    "événement",
    "evenement",
    "salon",
    "après l'événement",
    "apres l'evenement",
    "tableur",
  ]);
  const hasProviderOrSolution = /vendor|provider|service provider|supplier|tool|solution|solve|service|服务商|供应商|工具|产品|服务|解决方案|解决.*问题|方案|prestataire|fournisseur|outil|solution|résoudre|resoudre/i.test(
    quote
  );
  const hasMeetingStep = /meeting|call|book time|schedule|meet|discussion|talk further|会议|约会|约一个会议|约会议|约时间|再约|深入.*讨论|进一步.*聊|电话|réunion|reunion|rendez-vous|appel|discussion/i.test(
    quote
  );
  const hasContactRequest = /gmail|e-mail|email|mail|contact|联系方式|邮箱|邮件|微信|电话|要一下|要.*联系方式|courriel|coordonnées|coordonnees/i.test(
    quote
  );
  const hasResourcePath = /what'?s next|next step|resource|resources|expand|expansion|linkedin|linked in|下一步|拓展|扩展|资源|领英|黑客松|部门|相关的项目|行动节点|可以去跟|聊一下|参加/i.test(
    quote
  );
  const hasNamedPerson = /\bnick\b|\bhexa\b|\bhx\b|负责人|负责的人|联系人|contact person/i.test(
    quote
  );
  const hasOwner = /head of|owns it|owner|responsible|has to deal|team owns|负责人|负责|谁管|谁来|responsable|s'en occupe|équipe croissance|equipe croissance/i.test(
    quote
  );
  const hasTiming = /\bq[1-4]\b|\bt[1-4]\b|quarter|before|next month|this month|this week|deadline|push|季度|下个月|这周|本周|截止|之前|推进|未来|trimestre|avant|mois prochain|ce mois|cette semaine|échéance|echeance|lancement/i.test(
    quote
  );
  const hasExplicitIntent = /\b(evaluating|looking for|needs?|wants?|trying to|we should|we have to)\b|正在看|想找|需要|想要|必须|得|évaluer|evaluer|cherchons|cherche|besoin|voulons|veulent|essayer|on doit|il faut/i.test(
    quote
  );
  const hasHesitation = /budget|approval|approve|approved|not approved|blocked|blocker|预算|审批|批准|还没批|卡住|阻力|approbation|validé|valide|bloqué|bloque|frein/i.test(
    quote
  );
  const hasTriedSolution = /tried|last time|spreadsheet|hubspot|crm|no one updated|nobody updated|manual|试过|用过|上次|表格|没人更新|手动|essayé|essaye|testé|teste|dernière fois|derniere fois|personne n'a mis à jour|personne n'a mis a jour|manuel/i.test(
    quote
  );
  const hasBridgeRequest = /compare notes|know someone|intro|introduce|connect us|talk to someone|认识.*人|介绍|对接|交流|比较|取经|comparer|échanger|echanger|présenter|presenter|mise en relation|connaissez quelqu'un|parler à quelqu'un|parler a quelqu'un/i.test(
    quote
  );
  const hasCurrentProcess = /usually|process|workflow|spreadsheet|intern|manual|normally|现在|目前|通常|流程|表格|实习生|手动|généralement|generalement|processus|tableur|stagiaire|manuel/i.test(
    quote
  );
  const hasPriorContext = /follow[- ]?up|lead|intro|event|meeting|solution|vendor|provider|contact|email|跟进|线索|介绍|活动|会后|会议|服务商|解决方案|解决.*问题|联系方式|邮箱|约时间|讨论|suivi|relance|prospect|événement|evenement|salon|réunion|reunion|solution|prestataire|contact/i.test(
    lowerAll
  );
  const hadPriorProblem = /hard|difficult|struggle|bad|broken|problem|nobody remembers|lose|lost|inconsistent|consistently|难|麻烦|问题|痛点|没人记得|丢|difficile|compliqué|complique|problème|probleme|personne ne se souvient|perdu|désorganisé|desorganise/i.test(
    lowerPrior
  );
  const hasMemoryBridge =
    hasPriorContext &&
    memoryQuotes.some((item) =>
      /follow[- ]?up|lead|intro|event|跟进|线索|介绍|活动|suivi|relance|prospect|événement|evenement|salon/i.test(
        item.quote || ""
      )
    );

  const duplicateProblemOnly =
    hasProblem &&
    hadPriorProblem &&
    !hasOwner &&
    !hasTiming &&
    !hasExplicitIntent &&
    !hasHesitation &&
    !hasTriedSolution &&
    !hasBridgeRequest &&
    !hasCurrentProcess;

  let score = 0;
  if (duplicateProblemOnly) score -= 2;
  if (hasProblem && hasFollowUpTopic && !duplicateProblemOnly) score += 3;
  else if (hasProblem) score += 2;
  if (hasOwner && hasPriorContext) score += 2;
  if (hasTiming && hasPriorContext) score += 1;
  if (hasExplicitIntent && hasPriorContext) score += 1;
  if (hasProviderOrSolution && (hasProblem || hasExplicitIntent || hasPriorContext)) score += 2;
  if (hasResourcePath && (hasPriorContext || hasExplicitIntent || hasNamedPerson)) score += 3;
  if (hasContactRequest && hasPriorContext) score += 3;
  if (hasMeetingStep && (hasPriorContext || hasProblem || hasExplicitIntent)) score += 2;
  if (hasNamedPerson && (hasContactRequest || hasMeetingStep || hasOwner)) score += 1;
  if (hasHesitation && hasPriorContext) score += 3;
  if (hasTriedSolution && hasPriorContext) score += 3;
  if (hasBridgeRequest && (hasPriorContext || hasMemoryBridge)) score += 3;
  if (hasCurrentProcess && hasTriedSolution && hadPriorProblem) score += 2;
  if (hasMemoryBridge && (hasProblem || hasOwner || hasTiming || hasBridgeRequest)) score += 1;

  const shouldConsider =
    score >= 3 ||
    (hasOwner && hasTiming && hasPriorContext) ||
    (hasBridgeRequest && hasMemoryBridge) ||
    (hasResourcePath && (hasPriorContext || hasNamedPerson || hasContactRequest)) ||
    (hasContactRequest && hasPriorContext) ||
    (hasMeetingStep && hasExplicitIntent && hasPriorContext);

  return {
    should_consider: shouldConsider,
    quote,
    focus_quote: pickFocusedEvidenceQuote(quote),
    index,
    score,
    hasOwner,
    hasTiming,
    hasContactRequest,
    language,
  };
}

function pickFocusedEvidenceQuote(text) {
  const clean = cleanText(text);

  if (clean.length <= 150) return clean;

  const clauses = clean
    .split(/(?<=[。！？!?])|[，,；;]|(?:\s+然后\s*)|(?:然后)/)
    .map((part) => cleanText(part))
    .filter(Boolean);

  if (!clauses.length) return clean.slice(0, 150);

  let bestIndex = 0;
  let bestScore = -1;

  clauses.forEach((clause, index) => {
    const lower = clause.toLowerCase();
    let score = 0;

    if (/hexa|hx|nick|负责人|谁谁谁|部门|相关的项目|person|someone|contact/.test(lower)) score += 6;
    if (/what'?s next|next step|下一步|拓展|扩展|资源|resource|expand|expansion/.test(lower)) score += 5;
    if (/linkedin|linked in|领英|gmail|email|邮箱|联系方式/.test(lower)) score += 4;
    if (/会议|约|聊一下|参加|行动节点|meeting|event|talk|join/.test(lower)) score += 3;
    if (/问题|解决方案|服务商|solution|provider|problem/.test(lower)) score += 2;
    if (clause.length < 6) score -= 2;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  const selected = [clauses[bestIndex]];
  const nextClause = clauses[bestIndex + 1];

  if (
    nextClause &&
    selected.join("，").length + nextClause.length < 150 &&
    /linkedin|领英|gmail|email|邮箱|联系方式|部门|相关的项目|资源|resource|行动节点/i.test(
      nextClause
    )
  ) {
    selected.push(nextClause);
  }

  return selected.join("，");
}

function pickContactEvidenceQuote(text) {
  const clean = cleanText(text);
  const clauses = clean
    .split(/(?<=[。！？!?])|[，,；;]|(?:\s+然后\s*)|(?:然后)/)
    .map((part) => cleanText(part))
    .filter(Boolean);
  const contactClauses = clauses.filter((clause) =>
    /linkedin|linked in|领英|gmail|email|邮箱|联系方式|mail|contact/i.test(clause)
  );

  if (!contactClauses.length) return pickFocusedEvidenceQuote(clean);

  return contactClauses.slice(0, 2).join("，");
}

function isUserLine(line) {
  return /^you$/i.test(cleanText(line.speaker));
}

function detectSupportedQuoteLanguage(text) {
  const clean = cleanText(text);
  const lower = clean.toLowerCase();

  if (!clean) {
    return { supported: false, code: "unknown" };
  }

  if (/[\u3400-\u9fff]/.test(clean)) {
    return { supported: true, code: "zh" };
  }

  if (/[а-яё\u0370-\u03ff\u0590-\u05ff\u0600-\u06ff\u3040-\u30ff\uac00-\ud7af]/i.test(clean)) {
    return { supported: false, code: "unsupported" };
  }

  const hasLatinLetters = /[a-zà-ÿ]/i.test(clean);

  if (!hasLatinLetters) {
    return { supported: false, code: "unknown" };
  }

  if (
    /\b(el|los|las|gracias|hola|nuestro|nuestra|necesitamos|seguimiento|cliente|clientes|problema|presupuesto|aprobaci[oó]n|despu[eé]s)\b/i.test(
      lower
    ) ||
    /\b(der|die|das|und|nicht|kunden|budget|genehmigung|nachverfolgung)\b/i.test(
      lower
    ) ||
    /\b(il|lo|gli|ciao|grazie|bisogno|clienti|approvazione)\b/i.test(lower)
  ) {
    return { supported: false, code: "unsupported" };
  }

  if (
    /[àâçéèêëîïôûùüÿœæ]/i.test(clean) ||
    /\b(le|la|les|nous|vous|ils|elles|avec|pour|dans|sur|avant|après|apres|besoin|probl[eè]me|suivi|relance|budget|équipe|equipe)\b/i.test(
      lower
    )
  ) {
    return { supported: true, code: "fr" };
  }

  return { supported: true, code: "en" };
}

function isLowValueQuote(text) {
  const lower = cleanText(text).toLowerCase();
  const hasCjk = /[\u3400-\u9fff]/.test(lower);

  if (!hasCjk && lower.length < 18) return true;
  if (hasCjk && lower.length < 4) return true;

  return /^(yeah|yep|yes|no|okay|ok|sure|right|exactly|cool|nice|thanks|thank you|sounds good|makes sense|oui|non|d'accord|merci|super|très bien|tres bien|好的|好呀|可以|嗯|对|是的|没错|谢谢|太好了)[.!。！ ]*$/i.test(
    lower
  );
}

function hasAny(text, needles) {
  return needles.some((needle) => text.includes(needle));
}

function buildLocalPlan(userGoal, transcript, memoryQuotes, signalGate = null) {
  const text = transcript.map((line) => line.text || "").join(" ");
  const gate = signalGate || evaluateSignalGate(transcript, memoryQuotes);
  const quote = gate.focus_quote || "";
  const contactQuote =
    transcript
      .slice()
      .reverse()
      .map((line) => cleanText(line.text))
      .find((line) =>
        /gmail|e-mail|email|mail|contact|联系方式|邮箱|邮件|微信|电话|要一下|要.*联系方式|courriel|coordonnées|coordonnees/i.test(
          line
        )
      );
  const contactEvidenceQuote = contactQuote ? pickContactEvidenceQuote(contactQuote) : quote;
  const quoteHasContactRequest = /gmail|e-mail|email|mail|contact|联系方式|邮箱|邮件|微信|电话|要一下|要.*联系方式|courriel|coordonnées|coordonnees/i.test(
    quote
  );
  const hasContactRequest = /gmail|e-mail|email|mail|contact|联系方式|邮箱|邮件|微信|电话|要一下|要.*联系方式|courriel|coordonnées|coordonnees/i.test(
    text
  );
  const quoteHasResourcePath = /what'?s next|next step|resource|resources|expand|expansion|linkedin|linked in|下一步|拓展|扩展|资源|领英|黑客松|部门|相关的项目|行动节点|可以去跟|聊一下|参加/i.test(
    quote
  );
  const hasResourcePath = /what'?s next|next step|resource|resources|expand|expansion|linkedin|linked in|下一步|拓展|扩展|资源|领英|黑客松|部门|相关的项目|行动节点|可以去跟|聊一下|参加/i.test(
    text
  );
  const hasMeetingStep = /meeting|call|book time|schedule|meet|discussion|talk further|会议|约会|约一个会议|约会议|约时间|再约|深入.*讨论|进一步.*聊|电话|réunion|reunion|rendez-vous|appel|discussion/i.test(
    text
  );
  const hasServiceNeed = /vendor|provider|service provider|supplier|tool|solution|solve|service|服务商|供应商|工具|产品|服务|解决方案|解决.*问题|方案|prestataire|fournisseur|outil|solution|résoudre|resoudre/i.test(
    text
  );
  const hasEventFollowUpContext = /follow-up|follow up|lead|leads|intro|event|跟进|线索|介绍|对接|活动|会后|suivi|relance|prospect|événement|evenement|salon/i.test(
    text
  );
  const hasOwner = /head of growth|owns it|owner|responsible|负责人|增长负责人|负责|谁管|谁来|responsable|s'en occupe|équipe croissance|equipe croissance/i.test(
    text
  );
  const hasTiming = /\bq[1-4]\b|\bt[1-4]\b|quarter|before|next month|this month|deadline|push|季度|下个月|本周|这周|截止|之前|推进|trimestre|avant|mois prochain|ce mois|échéance|echeance|lancement/i.test(
    text
  );
  const bridge = memoryQuotes.find((item) =>
    /follow-up|follow up|lead|intro|event|跟进|线索|介绍|对接|活动|会后|suivi|relance|prospect|événement|evenement|salon/i.test(
      item.quote || ""
    )
  );

  if (!quote || !gate.should_consider) {
    return emptyPlan(userGoal);
  }

  const selectedType =
    hasContactRequest || hasMeetingStep
      ? "ask"
      : hasOwner && bridge && hasEventFollowUpContext
        ? "compare"
        : hasOwner
          ? "draft_later"
          : "ask";
  const actions = [
    { label: "Ask", type: "ask", selected: selectedType === "ask" },
    { label: "Save", type: "save", selected: false },
    { label: "Draft later", type: "draft_later", selected: selectedType === "draft_later" },
    { label: "Find public context", type: "find_public_context", selected: false },
  ];

  if (bridge) {
    actions.splice(2, 0, { label: "Compare", type: "compare", selected: selectedType === "compare" });
  }

  const liveCue = quoteHasResourcePath || hasResourcePath
    ? "They pointed to a person or resource path. Ask who to talk to first and what to ask them."
    : quoteHasContactRequest
      ? "They named the missing contact detail. Ask for the right email before the thread gets loose."
      : hasMeetingStep && hasTiming
        ? "They named someone to reach and a Q2 window. Ask who should be in the first meeting."
      : hasOwner
        ? "They named who is closest to this and when it matters. Ask what they tried last time."
        : hasServiceNeed
          ? "They said the current problem still lacks a good solution. Ask what has already been tried."
          : "They described a follow-up problem, but not who feels it most. Ask who has to deal with this after the event.";
  const notInferred = quoteHasResourcePath || hasResourcePath
    ? "Not assuming that person is the right contact yet."
    : quoteHasContactRequest
      ? "Not assuming this email is enough to start a deal."
      : hasMeetingStep
      ? "Not assuming they already agreed to meet."
      : hasOwner
        ? "Not assuming they want to buy anything."
        : "They have not named who decides yet.";
  const actionReason =
    hasContactRequest || hasMeetingStep
      ? "Ask the light next question now. Draft and lookup can wait until after the conversation."
      : hasOwner
        ? "Prepare follow-up after the conversation. Do not send anything without review."
        : "Ask one quiet question now. Leave email and profile work for after the conversation.";

  return {
    should_act: true,
    evidence_quote: quote,
    live_cue: liveCue,
    not_inferred: notInferred,
    confidence: hasOwner || hasTiming ? "high" : "medium",
    recommended_action_type: selectedType,
    action_reason: actionReason,
    actions,
    after_session_actions: hasOwner || hasContactRequest || hasMeetingStep
      ? [
          {
            title: "Draft follow-up email",
            detail: "Prepare a short note that references the exact quote. Keep it unsent.",
            proof: quote,
          },
          {
            title: "Find public profile",
            detail: hasContactRequest
              ? "Use the name or email clue after the session. Do not open another tool mid-conversation."
              : "Look up their company and role after the session.",
            proof: hasContactRequest ? contactEvidenceQuote : quote,
          },
          ...(hasTiming
            ? [
                {
                  title: "Create reminder",
                  detail: "Follow up before the timing window they named.",
                  proof: quote,
                },
              ]
            : []),
        ]
      : [
          {
            title: "Save this moment",
            detail: "Keep the exact quote with the session.",
            proof: quote,
          },
        ],
    memory_update: {
      what_they_said: hasResourcePath
        ? "They may know a person or resource path for the project."
        : hasServiceNeed
        ? "They have not found a good service provider or solution yet."
        : "Event follow-up is hard to do consistently.",
      who_seems_closest: hasOwner
        ? hasContactRequest
          ? "HX负责人 / Nick"
          : "Person they named"
        : hasResourcePath
          ? "Hexa person / resource owner"
        : "Not named yet.",
      when_it_matters: hasTiming ? "Before Q2/Q3 window" : "Not named yet.",
      still_unknown: hasResourcePath
        ? "Which person or resource to follow first."
        : hasContactRequest
        ? "The right email and whether Nick can help."
        : hasOwner
          ? "What they already tried last time."
          : "Who handles this after the event.",
    },
  };
}

function emptyPlan(userGoal) {
  return {
    should_act: false,
    evidence_quote: "",
    live_cue: "",
    not_inferred: "",
    confidence: "low",
    recommended_action_type: "none",
    action_reason: "",
    actions: [],
    after_session_actions: [],
    memory_update: {
      what_they_said: "Waiting for a quote.",
      who_seems_closest: "Not named yet.",
      when_it_matters: "Not named yet.",
      still_unknown: userGoal ? "A quote worth acting on." : "The user's goal.",
    },
  };
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeAudioContentType(type) {
  if (type.startsWith("audio/mp4")) return "audio/mp4";
  if (type.startsWith("audio/webm")) return "audio/webm";
  return "audio/webm";
}

function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;

  if (!isAllowedStaticPath(requestedPath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  const filePath = resolve(root, normalize(`.${requestedPath}`));

  if (!filePath.startsWith(root)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cache-Control": "no-store",
  });

  if (request.method === "HEAD") {
    response.end();
    return;
  }

  createReadStream(filePath).pipe(response);
}

function isAllowedStaticPath(pathname) {
  return (
    pathname === "/index.html" ||
    pathname === "/app.js" ||
    pathname === "/styles.css" ||
    pathname.startsWith("/data/")
  );
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on("data", (chunk) => {
      total += chunk.length;

      if (total > maxBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request, maxBytes) {
  const body = await readRequestBody(request, maxBytes);

  if (!body.length) return {};

  return JSON.parse(body.toString("utf8"));
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}
