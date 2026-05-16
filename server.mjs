import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { createServer } from "node:http";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const host = process.env.HOST || "127.0.0.1";

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

  if (process.env.OPENAI_TRANSCRIBE_LANGUAGE) {
    transcription.language = process.env.OPENAI_TRANSCRIBE_LANGUAGE;
  }

  return {
    type: "realtime",
    model: realtimeModel,
    instructions:
      "Transcribe the user's speech for live captions. Do not answer the user.",
    audio: {
      input: {
        transcription,
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500,
        },
      },
      output: {
        voice: process.env.OPENAI_REALTIME_VOICE || "marin",
      },
    },
  };
}

async function transcribeAudioChunk(request, response) {
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
  const model =
    process.env.OPENAI_AUDIO_TRANSCRIBE_MODEL ||
    process.env.OPENAI_TRANSCRIBE_MODEL ||
    "gpt-4o-mini-transcribe";

  console.log("Transcribe chunk", {
    bytes: audio.length,
    contentType,
    model,
  });

  form.append("model", model);
  form.append("file", new Blob([audio], { type: contentType }), fileName);

  if (process.env.OPENAI_TRANSCRIBE_LANGUAGE) {
    form.append("language", process.env.OPENAI_TRANSCRIBE_LANGUAGE);
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
    model,
  });

  console.log("Transcription complete", {
    chars: (payload.text || "").length,
  });
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

  if (signalGate.fast_path) {
    sendJson(response, 200, {
      ...fallbackPlan,
      source: "pioneer_fast_path",
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
      "gpt-4.1-mini";
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(7000),
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
    "The UI must feel like a thoughtful friend, not a sales tool.",
    "Never use sales-methodology words in user-visible strings.",
    "Every recommendation must cite one exact evidence quote from the transcript or memory quotes.",
    "If evidence is weak, set should_act=false and keep all user-visible suggestion fields empty.",
    "If should_act=true, live_cue must include a concrete next move, not just a summary.",
    "not_inferred must be a short non-empty sentence whenever should_act=true.",
    "Visible action labels must be short: Ask, Save, Compare, Draft later, Find public context, Reminder.",
    "Do not infer budget, title, intent to buy, or relationship unless directly stated.",
    "Actions are user-confirmed. Never say an email, social lookup, reminder, or intro has already happened.",
    "Prefer one light live cue. Put email/social/profile/reminder work into after_session_actions.",
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
      "actions",
      "after_session_actions",
      "memory_update",
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
      actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["label", "type", "selected"],
          properties: {
            label: { type: "string" },
            type: { type: "string" },
            selected: { type: "boolean" },
          },
        },
      },
      after_session_actions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "detail", "proof"],
          properties: {
            title: { type: "string" },
            detail: { type: "string" },
            proof: { type: "string" },
          },
        },
      },
      memory_update: {
        type: "object",
        additionalProperties: false,
        required: ["what_they_said", "who_seems_closest", "when_it_matters", "still_unknown"],
        properties: {
          what_they_said: { type: "string" },
          who_seems_closest: { type: "string" },
          when_it_matters: { type: "string" },
          still_unknown: { type: "string" },
        },
      },
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

  const recommendedActionType = fallbackPlan.should_act
    ? fallbackPlan.recommended_action_type
    : plan.recommended_action_type || "ask";

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
      fallbackPlan.should_act
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
  const soundsLikeMove =
    lower.includes("ask") ||
    lower.includes("save") ||
    lower.includes("draft") ||
    lower.includes("look up") ||
    lower.includes("follow up") ||
    lower.includes("compare");

  if (soundsLikeMove) return cue;

  return `${cue} Ask what would make this worth fixing now.`;
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
  const latestLine = transcript
    .slice()
    .reverse()
    .find((line) => cleanText(line.text) && !isUserLine(line));
  const quote = cleanText(latestLine?.text);

  if (!quote) {
    return {
      should_consider: false,
      fast_path: false,
      focus_quote: "",
      score: 0,
      reason: "No speaker quote yet.",
    };
  }

  if (isLowValueQuote(quote)) {
    return {
      should_consider: false,
      fast_path: false,
      focus_quote: quote,
      score: 0,
      reason: "Small talk or acknowledgement; stay quiet.",
    };
  }

  const allText = transcript.map((line) => line.text || "").join(" ");
  const lowerQuote = quote.toLowerCase();
  const lowerAll = allText.toLowerCase();
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
  ]);
  const hasFollowUpTopic = hasAny(lowerQuote, [
    "follow up",
    "follow-up",
    "lead",
    "leads",
    "intro",
    "intros",
    "event",
  ]);
  const hasOwner = /head of|owns it|owner|responsible|has to deal|team owns/i.test(quote);
  const hasTiming = /\bq[1-4]\b|quarter|before|next month|this month|this week|deadline|push/i.test(
    quote
  );
  const hasExplicitIntent = /evaluating|looking for|need|needs|want|wants|trying to|we should|we have to/i.test(
    quote
  );
  const hasPriorContext = /follow[- ]?up|lead|intro|event/i.test(lowerAll);
  const hasMemoryBridge =
    hasPriorContext &&
    memoryQuotes.some((item) => /follow[- ]?up|lead|intro|event/i.test(item.quote || ""));

  let score = 0;
  if (hasProblem && hasFollowUpTopic) score += 3;
  else if (hasProblem) score += 2;
  if (hasOwner && hasPriorContext) score += 2;
  if (hasTiming && hasPriorContext) score += 1;
  if (hasExplicitIntent && hasPriorContext) score += 1;
  if (hasMemoryBridge && (hasProblem || hasOwner || hasTiming)) score += 1;

  const shouldConsider = score >= 3 || (hasOwner && hasTiming && hasPriorContext);

  return {
    should_consider: shouldConsider,
    fast_path: shouldConsider && (score >= 3 || hasOwner || hasTiming),
    focus_quote: quote,
    score,
    reason: shouldConsider
      ? "Speaker gave a quote-backed problem, owner, timing, or memory bridge."
      : "No new quote-backed move; keep the UI quiet.",
  };
}

function isUserLine(line) {
  return /^you$/i.test(cleanText(line.speaker));
}

function isLowValueQuote(text) {
  const lower = cleanText(text).toLowerCase();

  if (lower.length < 18) return true;

  return /^(yeah|yep|yes|no|okay|ok|sure|right|exactly|cool|nice|thanks|thank you|sounds good|makes sense)[.! ]*$/i.test(
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
  const lower = text.toLowerCase();
  const hasFollowUp = lower.includes("follow") || lower.includes("lead");
  const hasOwner = lower.includes("head of growth") || lower.includes("owns it");
  const hasTiming = lower.includes("q3") || lower.includes("quarter");
  const bridge = memoryQuotes.find((item) =>
    /follow-up|follow up|event/i.test(item.quote || "")
  );

  if (!quote || !gate.should_consider || !hasFollowUp) {
    return emptyPlan(userGoal);
  }

  const selectedType = hasOwner && bridge ? "compare" : hasOwner ? "draft_later" : "ask";
  const actions = [
    { label: "Ask", type: "ask", selected: selectedType === "ask" },
    { label: "Save", type: "save", selected: false },
    { label: "Draft later", type: "draft_later", selected: selectedType === "draft_later" },
    { label: "Find public context", type: "find_public_context", selected: false },
  ];

  if (bridge) {
    actions.splice(2, 0, { label: "Compare", type: "compare", selected: selectedType === "compare" });
  }

  return {
    should_act: true,
    evidence_quote: quote,
    live_cue: hasOwner
      ? "They named who is closest to this and when it matters. Ask what they tried last time."
      : "They described a follow-up problem, but not who feels it most. Ask who has to deal with this after the event.",
    not_inferred: hasOwner
      ? "Not assuming they want to buy anything."
      : "They have not named who decides yet.",
    confidence: hasOwner || hasTiming ? "high" : "medium",
    recommended_action_type: selectedType,
    action_reason: hasOwner
      ? "Prepare follow-up after the conversation. Do not send anything without review."
      : "Ask one quiet question now. Leave email and profile work for after the conversation.",
    actions,
    after_session_actions: hasOwner
      ? [
          {
            title: "Draft follow-up email",
            detail: "Prepare a short note that references the exact quote. Keep it unsent.",
            proof: quote,
          },
          {
            title: "Find public profile",
            detail: "Look up their company and role after the session.",
            proof: "Head of Growth owns it.",
          },
          ...(hasTiming
            ? [
                {
                  title: "Create reminder",
                  detail: "Follow up before their Q3 push.",
                  proof: "They want something before the Q3 event push.",
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
      what_they_said: "Event follow-up is hard to do consistently.",
      who_seems_closest: hasOwner ? "Head of Growth" : "Not named yet.",
      when_it_matters: hasTiming ? "Before Q3" : "Not named yet.",
      still_unknown: hasOwner ? "What they already tried last time." : "Who handles this after the event.",
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
