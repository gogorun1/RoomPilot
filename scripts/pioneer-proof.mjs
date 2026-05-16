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
  const primaryNeedOwner = /head of growth/i.test(text) ? "Head of Growth" : null;
  const timingSignal = /\bq3\b/i.test(text) ? "before Q3" : null;

  return {
    primary_need_owner: primaryNeedOwner,
    timing_signal: timingSignal,
    missing_information: ["what they already tried"],
    not_inferred: ["whether they will buy"],
    confidence: primaryNeedOwner && timingSignal ? 0.9 : 0.62,
  };
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
    threshold: 0.5,
    schema,
  };

  const response = await fetch("https://api.pioneer.ai/inference", {
    method: "POST",
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
    },
    raw: payload,
    normalized: normalizePioneerResult(payload, text),
  };
}

async function callPioneerChatCompat(apiKey, text) {
  const model = env.PIONEER_CHAT_MODEL || "openai/gpt-oss-20b";

  const response = await fetch("https://api.pioneer.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      model,
      max_tokens: 256,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Extract only quote-backed fields. Do not infer buyer intent, budget, or purchase likelihood. Return strict JSON.",
        },
        {
          role: "user",
          content: `Quote: ${text}\n\nReturn keys: primary_need_owner, timing_signal, missing_information, not_inferred, confidence.`,
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

  if (!apiKey) {
    printResult({
      provider: "mock",
      mode: "no_api_key",
      input: { quote },
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
      process.exitCode = 1;
    }
  }
}

main();
