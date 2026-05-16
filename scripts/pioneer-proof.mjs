#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";

const DEFAULT_QUOTE =
  "Head of Growth owns it. They want something before the Q3 event push.";

const quote = process.argv.slice(2).join(" ").trim() || DEFAULT_QUOTE;

function loadDotEnv(path = ".env") {
  if (!existsSync(path)) return {};

  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((env, line) => {
      const equalsAt = line.indexOf("=");
      if (equalsAt === -1) return env;

      const key = line.slice(0, equalsAt).trim();
      const value = line
        .slice(equalsAt + 1)
        .trim()
        .replace(/^['"]|['"]$/g, "");

      env[key] = value;
      return env;
    }, {});
}

const localEnv = { ...loadDotEnv(".env"), ...loadDotEnv(".env.local") };
const env = { ...localEnv, ...process.env };

function deterministicExtraction(text) {
  const gate = evaluateQuoteGate(text);

  if (!gate.should_extract) {
    return {
      should_extract: false,
      primary_need_owner: null,
      timing_signal: null,
      missing_information: [],
      not_inferred: ["no action-worthy problem, owner, or timing was stated"],
      confidence: gate.confidence,
      gate_reason: gate.reason,
    };
  }

  const primaryNeedOwner = /head of growth/i.test(text) ? "Head of Growth" : null;
  const timingSignal = /\bq3\b/i.test(text) ? "before Q3" : null;

  return {
    should_extract: true,
    primary_need_owner: primaryNeedOwner,
    timing_signal: timingSignal,
    missing_information: ["what they already tried"],
    not_inferred: ["whether they will buy"],
    confidence: Math.max(gate.confidence, primaryNeedOwner && timingSignal ? 0.9 : 0.72),
    gate_reason: gate.reason,
  };
}

function evaluateQuoteGate(text) {
  const quoteText = cleanText(text);
  const lower = quoteText.toLowerCase();

  if (!quoteText) {
    return {
      should_extract: false,
      confidence: 0,
      reason: "empty quote",
    };
  }

  if (isLowValueQuote(quoteText)) {
    return {
      should_extract: false,
      confidence: 0.1,
      reason: "small talk or acknowledgement",
    };
  }

  const hasProblem = hasAny(lower, [
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
  const hasTopic = hasAny(lower, [
    "follow up",
    "follow-up",
    "lead",
    "leads",
    "intro",
    "intros",
    "event",
  ]);
  const hasOwner = /head of|owns it|owner|responsible|has to deal|team owns/i.test(
    quoteText
  );
  const hasTiming = /\bq[1-4]\b|quarter|before|next month|this month|this week|deadline|push/i.test(
    quoteText
  );
  const hasIntent = /evaluating|looking for|need|needs|want|wants|trying to|we should|we have to/i.test(
    quoteText
  );

  let score = 0;
  if (hasProblem && hasTopic) score += 3;
  else if (hasProblem) score += 2;
  if (hasOwner) score += 2;
  if (hasTiming) score += 1;
  if (hasIntent && hasTopic) score += 1;

  return {
    should_extract: score >= 3 || (hasOwner && hasTiming),
    confidence: Math.min(0.95, 0.25 + score * 0.16),
    reason:
      score >= 3 || (hasOwner && hasTiming)
        ? "quote contains a problem, owner, timing, or explicit intent"
        : "quote is not strong enough for a live action",
  };
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

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizePioneerResult(raw, text) {
  const fallback = deterministicExtraction(text);
  const result = raw?.result ?? raw;
  const entities = result?.entities ?? result?.data?.entities ?? {};
  const json =
    result?.json ??
    result?.structured_output ??
    result?.extraction ??
    result?.output ??
    {};

  return {
    should_extract: json.should_extract ?? fallback.should_extract,
    primary_need_owner:
      json.primary_need_owner ??
      firstEntity(entities, ["primary_need_owner", "role", "owner", "person_role"]) ??
      fallback.primary_need_owner,
    timing_signal:
      json.timing_signal ??
      firstEntity(entities, ["timing_signal", "timing", "date", "time"]) ??
      fallback.timing_signal,
    missing_information:
      json.missing_information ??
      fallback.missing_information,
    not_inferred: json.not_inferred ?? fallback.not_inferred,
    gate_reason: json.gate_reason ?? fallback.gate_reason,
    confidence:
      json.confidence ??
      result?.confidence ??
      firstNumber(raw?.confidence, result?.score, result?.confidence_score) ??
      fallback.confidence,
  };
}

function firstEntity(entities, labels) {
  for (const label of labels) {
    const value = entities[label];
    if (Array.isArray(value) && value.length > 0) return value[0];
    if (typeof value === "string" && value) return value;
  }

  return null;
}

function firstNumber(...values) {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }

  return null;
}

async function callPioneerNative(apiKey, text) {
  const modelId = env.PIONEER_MODEL_ID || "fastino/gliner2-base-v1";
  const task = env.PIONEER_TASK || "extract_entities";

  const schema =
    task === "extract_entities"
      ? ["primary_need_owner", "timing_signal"]
      : {
          primary_need_owner: "The named role or person who owns the need, only if explicitly stated.",
          timing_signal: "The timing phrase, only if explicitly stated.",
          missing_information: "Important unknowns that remain open.",
          not_inferred: "Claims the system must not make from this quote.",
          confidence: "A numeric confidence score between 0 and 1.",
        };

  const body = {
    model_id: modelId,
    task,
    text,
    threshold: Number(env.PIONEER_THRESHOLD || 0.72),
    schema,
  };

  const response = await fetch("https://api.pioneer.ai/inference", {
    method: "POST",
    signal: AbortSignal.timeout(Number(env.PIONEER_TIMEOUT_MS || 3500)),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload;

  try {
    payload = JSON.parse(responseText);
  } catch {
    payload = { raw_text: responseText };
  }

  if (!response.ok) {
    const error = new Error(`Pioneer native inference failed with ${response.status}`);
    error.details = payload;
    throw error;
  }

  return {
    provider: "pioneer",
    mode: "native_inference",
    request: {
      model_id: modelId,
      task,
      threshold: body.threshold,
    },
    raw: payload,
    normalized: normalizePioneerResult(payload, text),
  };
}

async function callPioneerChatCompat(apiKey, text) {
  const model = env.PIONEER_CHAT_MODEL || "openai/gpt-oss-20b";

  const response = await fetch("https://api.pioneer.ai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(Number(env.PIONEER_TIMEOUT_MS || 3500)),
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 160,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Act as a strict quote gate and extractor. If the quote is small talk or weak evidence, return should_extract=false. Extract only quote-backed fields. Do not infer buyer intent, budget, or purchase likelihood. Return strict JSON.",
        },
        {
          role: "user",
          content: `Quote: ${text}\n\nReturn keys: should_extract, primary_need_owner, timing_signal, missing_information, not_inferred, gate_reason, confidence.`,
        },
      ],
    }),
  });

  const payload = await response.json().catch(async () => ({
    raw_text: await response.text(),
  }));

  if (!response.ok) {
    const error = new Error(`Pioneer OpenAI-compatible inference failed with ${response.status}`);
    error.details = payload;
    throw error;
  }

  const content = payload?.choices?.[0]?.message?.content ?? "{}";
  let parsed;

  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = deterministicExtraction(text);
  }

  return {
    provider: "pioneer",
    mode: "openai_compatible_chat",
    request: { model },
    raw: payload,
    normalized: {
      ...deterministicExtraction(text),
      ...parsed,
    },
  };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  const apiKey = env.PIONEER_API_KEY;
  const gate = evaluateQuoteGate(quote);

  if (!gate.should_extract) {
    printResult({
      provider: "pioneer_gate",
      mode: "not_actionable",
      input: { quote },
      gate,
      normalized: deterministicExtraction(quote),
      next_step: "Stay quiet. Do not create a live quote-action for this sentence.",
    });
    return;
  }

  if (!apiKey) {
    printResult({
      provider: "mock",
      mode: "no_api_key",
      input: { quote },
      gate,
      normalized: deterministicExtraction(quote),
      next_step: "Put PIONEER_API_KEY=pio_sk_... in .env to run a real Pioneer call.",
    });
    return;
  }

  try {
    printResult({
      input: { quote },
      ...(await callPioneerNative(apiKey, quote)),
    });
  } catch (nativeError) {
    try {
      printResult({
        input: { quote },
        native_error: {
          message: nativeError.message,
          details: nativeError.details,
        },
        ...(await callPioneerChatCompat(apiKey, quote)),
      });
    } catch (compatError) {
      printResult({
        provider: "mock",
        mode: "pioneer_error_fallback",
        input: { quote },
        native_error: {
          message: nativeError.message,
          details: nativeError.details,
        },
        compat_error: {
          message: compatError.message,
          details: compatError.details,
        },
        normalized: deterministicExtraction(quote),
      });

      if (env.PIONEER_STRICT === "1") {
        process.exitCode = 1;
      }
    }
  }
}

main();
