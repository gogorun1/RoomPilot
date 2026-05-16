const fallbackSeed = {
  sessions: [
    {
      id: "session_sarah_station_f",
      person: "Sarah",
      company: "Station F",
      when: "Yesterday",
      quote: "After demo day, the next step disappears unless someone captures the exact quote.",
      x: 18,
      y: 28,
    },
  ],
  today: {
    id: "session_today",
    person: "Camille",
    company: "Founder programs",
  },
};

const fallbackTimeline = {
  transcript: [
    {
      id: "t1",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "Hi, I’m Gogo. I’m building RoomPilot, a quiet assistant for live opportunity conversations.",
      at: 3800,
    },
    {
      id: "t2",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "I’m Camille. I work with founder programs around events, so this is exactly the room where that problem shows up.",
      at: 9000,
    },
    {
      id: "t3",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "The simple pitch is: people leave useful conversations with no clear next move.",
      at: 15000,
    },
    {
      id: "t4",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "Right. The hard part is not meeting people; it is remembering the useful next step before the moment disappears.",
      at: 21000,
      hero: true,
    },
    {
      id: "t5",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "That is the pain. Most tools summarize later; RoomPilot helps while the person is still here.",
      at: 28500,
    },
    {
      id: "t6",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "Then the product should show the exact quote, say what it is not assuming, and give one useful next move.",
      at: 34500,
    },
    {
      id: "t7",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "What one action would save that moment in this room?",
      at: 43000,
    },
    {
      id: "t8",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "If someone says, ‘I’d talk to Hexa,’ capture that, then ask who at Hexa and what to mention.",
      at: 50000,
      evidence: true,
    },
    {
      id: "t9",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "So the tech path is simple: OpenAI Realtime turns speech into live text, Pioneer checks which quote is worth acting on, and RoomPilot turns it into one card.",
      at: 58500,
    },
    {
      id: "t10",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "And the memory graph matters only if it can connect this quote to something Sarah said yesterday.",
      at: 66500,
    },
    {
      id: "t11",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "Right: OpenAI gives us the live words, Pioneer stops every sentence from becoming a card, audio is not stored, and the UI keeps the proof visible.",
      at: 74500,
    },
    {
      id: "t12",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "That is the two-minute pitch: not another call summary, a proof-backed next-move layer for live rooms.",
      at: 83500,
    },
    {
      id: "t13",
      speaker: "Heard",
      speakerId: "speaker_gogo",
      text: "Perfect. That is exactly the story I want the judges to feel.",
      at: 91000,
    },
    {
      id: "t14",
      speaker: "Heard",
      speakerId: "speaker_camille",
      text: "Good. Now make the demo quiet enough that the proof does the selling.",
      at: 96000,
    },
  ],
  events: [
    { type: "showSession", at: 2800 },
    { type: "beat1", at: 23800 },
    { type: "askQuestion", at: 41000 },
    { type: "escalateMemory", at: 53500 },
    { type: "beat2", at: 69500 },
    { type: "showFinalMemory", at: 87500 },
  ],
};

let seed = fallbackSeed;
let timeline = fallbackTimeline;
let timers = [];
let clockTimer = null;
let statusTimer = null;
let statusIndex = 0;
let demoStartedAt = null;
let livePeer = null;
let liveStream = null;
let liveDataChannel = null;
let liveDraftLine = null;
let liveDraftPlannerTimer = null;
let liveDraftPlannerText = "";
let liveDraftPlannerLineActive = false;
let liveAttemptId = 0;
let liveAudioContext = null;
let liveAudioLevelTimer = null;
let lastLiveAudioLevel = 0;
let lastTranscriptAt = 0;
let fallbackActivationTimer = null;
let fallbackTranscriberActive = false;
let fallbackRecorder = null;
let fallbackSegmentTimer = null;
let fallbackTranscribeInFlight = false;
let fallbackPendingBlob = null;
let lastFallbackTranscript = "";
let liveTranscriptLines = [];
const TURN_SPEAKER_COUNT = 2;
let transcriptRecords = [];
let transcriptRecordId = 0;
let speakerIdentityMap = new Map();
let speakerRoster = [];
let turnSpeakerSlots = [];
let nextTurnSpeakerSlotIndex = 0;
let lastAssignedSpeaker = "";
let plannerTimer = null;
let plannerRequestId = 0;
let lastPlannedTranscript = "";
let hasPlannerSuggestion = false;
let rightActionCards = [];
let rightActionCardId = 0;

const fallbackActivationDelayMs = 3800;
const fallbackStaleTranscriptMs = 2800;
const fallbackSegmentMs = 1500;
const fallbackSegmentGapMs = 120;

const statusMessages = [
  "Thinking through your next move",
  "Listening for openings",
  "Sorting the evidence",
  "Keeping the proof visible",
];

const productStages = {
  waiting: {
    plannerState: "set before listening",
    userGoal: "Turn this live room into one useful next move.",
    actionState: "waiting",
    actionReason: "Waiting for enough proof.",
    selectedAction: null,
    actions: [],
    queue: [],
  },
  listening: {
    plannerState: "set before listening",
    userGoal: "Turn this live room into one useful next move.",
    actionState: "quiet",
    actionReason: "",
    selectedAction: null,
    actions: [],
    queue: [],
  },
  firstQuote: {
    plannerState: "set before listening",
    userGoal: "Turn this live room into one useful next move.",
    actionState: "one safe move",
    actionReason:
      "Turn the lost-next-step pain into one useful question.",
    selectedAction: "Ask",
    actions: ["Ask", "Save", "Compare", "Draft later", "Find public context"],
    queue: [
      {
        title: "Ask what one action would save it.",
        person: "Camille",
        detail: "Move from the abstract pain to a concrete next move in this room.",
        proof:
          "The hard part is not meeting people; it is remembering the useful next step before the moment disappears.",
      },
    ],
  },
  updated: {
    plannerState: "set before listening",
    userGoal: "Turn this live room into one useful next move.",
    actionState: "first path",
    actionReason: "They used Hexa as the example path. Ask for the person and wording before drafting anything.",
    selectedAction: "Ask",
    actions: ["Ask", "Save", "Draft later", "Find public context", "Reminder"],
    queue: [
      {
        title: "Ask who at Hexa and what to mention.",
        person: "Hexa",
        detail: "Get the next move while Camille is still in front of you.",
        proof:
          "If someone says, ‘I’d talk to Hexa,’ capture that, then ask who at Hexa and what to mention.",
      },
      {
        title: "Save Hexa as the first path.",
        person: "Hexa",
        detail: "Keep the exact quote attached so the follow-up does not become a vague reminder.",
        proof: "I’d talk to Hexa.",
      },
    ],
  },
  bridge: {
    plannerState: "set before listening",
    userGoal: "Turn this live room into one useful next move.",
    actionState: "memory link",
    actionReason: "Sarah named the same lost-next-step problem yesterday. Show both quotes before suggesting an intro.",
    selectedAction: "Compare",
    actions: ["Ask", "Save", "Draft later", "Find public context", "Reminder"],
    queue: [
      {
        title: "Ask Camille if Sarah is worth comparing notes with.",
        person: "Sarah",
        detail: "Use the memory graph only because both people used the same lost-next-step language.",
        proof: "After demo day, the next step disappears unless someone captures the exact quote.",
      },
      {
        title: "Save the quote-backed memory link.",
        person: "Camille",
        detail: "Keep both quotes visible so the graph does not look like a black box.",
        proof:
          "The hard part is not meeting people; it is remembering the useful next step before the moment disappears.",
      },
      {
        title: "Draft a short compare-notes note later.",
        person: "Sarah",
        detail: "Ask for a lightweight exchange, not a sales call.",
        proof: "Sarah said the same next-step problem yesterday.",
      },
    ],
  },
};

const els = {
  trustFrame: document.querySelector("#trustFrame"),
  demoGrid: document.querySelector("#demoGrid"),
  transcriptList: document.querySelector("#transcriptList"),
  demoClock: document.querySelector("#demoClock"),
  emptyCue: document.querySelector("#emptyCue"),
  beat1Cue: document.querySelector("#beat1Cue"),
  beat2Cue: document.querySelector("#beat2Cue"),
  evidenceCapture: document.querySelector("#evidenceCapture"),
  intentPanel: document.querySelector("#intentPanel"),
  plannerState: document.querySelector("#plannerState"),
  userGoalText: document.querySelector("#userGoalText"),
  statusPills: document.querySelectorAll(".recording-toggle"),
  statusTexts: document.querySelectorAll(".status-text"),
  graphWrap: document.querySelector(".graph-wrap"),
  memoryState: document.querySelector("#memoryState"),
  actionPalette: document.querySelector("#actionPalette"),
  actionPaletteState: document.querySelector("#actionPaletteState"),
  actionChipList: document.querySelector("#actionChipList"),
  actionReasonText: document.querySelector("#actionReasonText"),
  actionQueue: document.querySelector("#actionQueue"),
  queuedActions: document.querySelector("#queuedActions"),
  rightActionCards: document.querySelector("#rightActionCards"),
  nextCard: document.querySelector("#nextCard"),
  nextCardTitle: document.querySelector("#nextCardTitle"),
  nextCardBody: document.querySelector("#nextCardBody"),
  needText: document.querySelector("#needText"),
  ownerText: document.querySelector("#ownerText"),
  timingText: document.querySelector("#timingText"),
  unknownText: document.querySelector("#unknownText"),
  noteText: document.querySelector("#noteText"),
  exportProof: document.querySelector("#exportProof"),
  startDemo: document.querySelector("#startDemo"),
  startDemoHero: document.querySelector("#startDemoHero"),
  liveMic: document.querySelector("#liveMic"),
  liveStatus: document.querySelector("#liveStatus"),
  resetDemo: document.querySelector("#resetDemo"),
  jumpBeat1: document.querySelector("#jumpBeat1"),
  jumpBeat2: document.querySelector("#jumpBeat2"),
  stopSession: document.querySelector("#stopSession"),
};

const userGoal = "Turn this live room into one useful next move.";

async function loadData() {
  try {
    const [seedResponse, timelineResponse] = await Promise.all([
      fetch("./data/seed.json"),
      fetch("./data/timeline.json"),
    ]);

    if (seedResponse.ok && timelineResponse.ok) {
      seed = await seedResponse.json();
      timeline = await timelineResponse.json();
    }
  } catch (error) {
    console.warn("Using embedded demo data because local JSON could not be loaded.", error);
  }
}

function clearTimers() {
  timers.forEach((timer) => window.clearTimeout(timer));
  timers = [];

  if (clockTimer) {
    window.clearInterval(clockTimer);
    clockTimer = null;
  }

  if (statusTimer) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }

  if (plannerTimer) {
    window.clearTimeout(plannerTimer);
    plannerTimer = null;
  }

  if (liveDraftPlannerTimer) {
    window.clearTimeout(liveDraftPlannerTimer);
    liveDraftPlannerTimer = null;
  }
}

function setStatusText(message) {
  els.statusTexts.forEach((element) => {
    element.textContent = message;
  });
}

function startStatusCarousel() {
  if (statusTimer) {
    window.clearInterval(statusTimer);
    statusTimer = null;
  }

  setStatusText(statusMessages[statusIndex]);

  statusTimer = window.setInterval(() => {
    statusIndex = (statusIndex + 1) % statusMessages.length;
    setStatusText(statusMessages[statusIndex]);
  }, 2400);
}

function setSessionActive(active) {
  if (active) {
    els.statusPills.forEach((element) => {
      element.classList.remove("is-inactive");
      element.classList.add("is-active");
      element.setAttribute("aria-pressed", "true");
    });
    setHidden(els.stopSession, false);
    startStatusCarousel();
    return;
  }

  statusIndex = 0;
  setStatusText("Ready when you are");
  els.statusPills.forEach((element) => {
    element.classList.add("is-inactive");
    element.classList.remove("is-active");
    element.setAttribute("aria-pressed", "false");
  });
  setHidden(els.stopSession, true);
}

function setHidden(element, hidden) {
  element.classList.toggle("is-hidden", hidden);
}

function setLiveStatus(message, state = "idle") {
  els.liveStatus.textContent = message;
  els.liveStatus.dataset.state = state;
}

function describeLiveState(message) {
  const level = Math.round(lastLiveAudioLevel * 100);
  setLiveStatus(`${message} Mic ${level}%`, "active");
}

function resetDemo() {
  clearTimers();
  stopLiveMic();
  demoStartedAt = null;
  els.demoClock.textContent = "00:00";
  els.transcriptList.innerHTML = "";
  setHidden(els.trustFrame, false);
  setHidden(els.demoGrid, true);
  setHidden(els.emptyCue, false);
  setHidden(els.beat1Cue, true);
  setHidden(els.beat2Cue, true);
  setHidden(els.evidenceCapture, true);
  setHidden(els.intentPanel, true);
  setHidden(els.actionPalette, true);
  setHidden(els.actionQueue, true);
  setHidden(els.nextCard, true);
  els.nextCardTitle.textContent = "Ask who at Hexa and what to mention.";
  els.nextCardBody.textContent =
    "Keep the action tied to Camille's exact quote before drafting anything.";
  setSessionActive(false);
  els.graphWrap.classList.remove("is-live", "is-bridge");
  liveTranscriptLines = [];
  transcriptRecords = [];
  transcriptRecordId = 0;
  speakerIdentityMap = new Map();
  speakerRoster = [];
  turnSpeakerSlots = [];
  nextTurnSpeakerSlotIndex = 0;
  lastAssignedSpeaker = "";
  liveDraftPlannerText = "";
  liveDraftPlannerLineActive = false;
  rightActionCards = [];
  rightActionCardId = 0;
  plannerRequestId += 1;
  lastPlannedTranscript = "";
  hasPlannerSuggestion = false;
  renderRightActionCards();
  renderProductStage("waiting");
  updateMemory({
    state: "waiting",
    need: "Waiting for a quote.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who would try this first.",
    note: "No note yet.",
  });
}

function startClock() {
  demoStartedAt = Date.now();
  clockTimer = window.setInterval(() => {
    const elapsed = Math.max(0, Date.now() - demoStartedAt);
    const seconds = Math.floor(elapsed / 1000);
    els.demoClock.textContent = formatClock(seconds);
  }, 250);
}

function formatClock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function showSession() {
  setHidden(els.trustFrame, true);
  setHidden(els.demoGrid, false);
  setHidden(els.intentPanel, false);
  els.graphWrap.classList.add("is-live");
  renderProductStage("listening");
  updateMemory({
    state: "listening",
    need: "Listening for the first useful quote.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who would try this first.",
    note: "No note yet.",
  });
}

function addTranscript(line) {
  const item = document.createElement("article");
  item.className = "transcript-line";

  if (line.hero || line.evidence) {
    item.classList.add("is-hero");
  }

  const speaker = document.createElement("strong");
  const text = document.createElement("p");
  text.textContent = line.text;
  const record = registerTranscriptRecord(line, item, speaker);
  const initialLabel = resolveSpeakerLabel(record);
  applySpeakerLabel(record, initialLabel, {
    source: isPlaceholderSpeaker(initialLabel) ? "placeholder" : "known",
    updateTurn: true,
  });
  item.append(speaker, text);

  els.transcriptList.appendChild(item);
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
  learnSpeakerIdentity(record);

  return record;
}

function registerTranscriptRecord(line, item, speakerElement) {
  const record = {
    id: line.id || `transcript_${++transcriptRecordId}`,
    speakerId: line.speakerId || line.speaker_id || "",
    speakerSlotId: line.speakerSlotId || line.speaker_slot_id || "",
    originalSpeaker: line.speaker || "Heard",
    text: normalizeTranscript(line.text),
    element: item,
    speakerElement,
    assignedSpeaker: "",
    speakerSource: "placeholder",
  };

  item.dataset.speakerId = record.speakerId;
  if (record.speakerSlotId) {
    item.dataset.speakerSlot = record.speakerSlotId;
  }
  transcriptRecords.push(record);
  return record;
}

function resolveSpeakerLabel(record) {
  if (record.speakerId && speakerIdentityMap.has(record.speakerId)) {
    return speakerIdentityMap.get(record.speakerId).name;
  }

  return record.originalSpeaker || "Heard";
}

function learnSpeakerIdentity(record) {
  const identity = extractSelfIntroduction(record.text);

  if (!identity) {
    if (assignSpeakerFromTurn(record)) return;
    inferSpeakerFromRoster(record);
    return;
  }

  rememberSpeakerIdentity(identity, record);

  if (!record.speakerId) {
    if (assignSpeakerFromTurn(record, identity, {
      delay: 520,
      highlight: true,
      source: "self_intro",
      updateTurn: true,
    })) {
      return;
    }

    applySpeakerLabel(record, identity.name, {
      delay: 520,
      highlight: true,
      source: "self_intro",
      updateTurn: true,
    });
    return;
  }

  speakerIdentityMap.set(record.speakerId, {
    ...identity,
    speakerId: record.speakerId,
    sourceQuote: record.text,
    updatedAt: new Date().toISOString(),
  });

  transcriptRecords
    .filter((candidate) => candidate.speakerId === record.speakerId)
    .forEach((candidate) => {
      const delay =
        candidate.id === record.id && isPlaceholderSpeaker(candidate.originalSpeaker) ? 520 : 0;
      applySpeakerLabel(candidate, identity.name, {
        delay,
        highlight: true,
        source: "self_intro",
        updateTurn: candidate.id === record.id,
      });
    });
}

function applySpeakerLabel(record, label, options = {}) {
  if (!record?.speakerElement || !label) return;

  record.assignedSpeaker = label;
  record.speakerSource = options.source || record.speakerSource || "known";

  if (options.updateTurn && !isPlaceholderSpeaker(label)) {
    lastAssignedSpeaker = label;
  }

  const apply = () => {
    if (options.delay && !record.speakerElement.isConnected) return;

    record.speakerElement.textContent = label;
    record.element.classList.toggle("has-speaker-name", !isPlaceholderSpeaker(label));
    record.element.dataset.speakerSource = record.speakerSource;
    if (isPlaceholderSpeaker(label)) {
      delete record.element.dataset.speakerTheme;
    } else {
      record.element.dataset.speakerTheme = getSpeakerTheme(label, record);
    }

    if (options.highlight) {
      record.element.classList.add("is-relabeling");
      window.setTimeout(() => {
        record.element.classList.remove("is-relabeling");
      }, 900);
    }
  };

  if (options.delay) {
    window.setTimeout(apply, options.delay);
    return;
  }

  apply();
}

function isPlaceholderSpeaker(label) {
  return /^(heard|speaker|unknown)$/i.test(String(label || "").trim());
}

function getSpeakerTheme(label, record = null) {
  const normalized = normalizeSpeakerName(label);

  if (/^gogo$/.test(normalized)) return "gogo";
  if (/^camill?e$/.test(normalized)) return "camille";
  if (/^nick$/.test(normalized)) return "nick";
  if (record?.speakerSlotId) return record.speakerSlotId;

  const slotMatch = normalized.match(/^speaker\s*(\d+)$/);
  if (slotMatch?.[1]) return `slot-${slotMatch[1]}`;

  return "other";
}

function rememberSpeakerIdentity(identity, record) {
  const normalizedName = normalizeSpeakerName(identity.name);
  if (!normalizedName) return null;

  const existing = speakerRoster.find((speaker) => speaker.normalizedName === normalizedName);

  if (existing) {
    existing.sourceQuote = record.text;
    existing.updatedAt = new Date().toISOString();
    return existing;
  }

  const speaker = {
    name: identity.name,
    normalizedName,
    role: resolveSpeakerRole(identity.name),
    source: identity.source,
    confidence: identity.confidence,
    sourceQuote: record.text,
    createdAt: new Date().toISOString(),
  };

  speakerRoster.push(speaker);
  return speaker;
}

function resolveSpeakerRole(name) {
  if (/^gogo$/i.test(name)) return "user";
  return "other";
}

function normalizeSpeakerName(name) {
  return String(name || "")
    .trim()
    .toLowerCase();
}

function assignSpeakerFromTurn(record, identity = null, options = {}) {
  if (!shouldAssignSpeakerByTurn(record)) return null;

  const slot = pickTurnSpeakerSlot(identity);
  const source = options.source || identity?.source || slot.source || "turn_slot";

  record.speakerSlotId = slot.id;
  record.element.dataset.speakerSlot = slot.id;
  if (!slot.recordIds.includes(record.id)) {
    slot.recordIds.push(record.id);
  }

  if (identity?.name) {
    applyTurnSpeakerIdentity(slot, identity, record, {
      ...options,
      source,
    });
  } else {
    applySpeakerLabel(record, getTurnSpeakerLabel(slot), {
      source,
      updateTurn: true,
      ...options,
    });
  }

  advanceTurnSpeakerSlot(slot);
  return slot;
}

function shouldAssignSpeakerByTurn(record) {
  return Boolean(record && isPlaceholderSpeaker(record.originalSpeaker) && !record.speakerId);
}

function pickTurnSpeakerSlot(identity = null) {
  const normalizedName = normalizeSpeakerName(identity?.name);
  const namedSlot = normalizedName
    ? turnSpeakerSlots.find((slot) => slot.normalizedName === normalizedName)
    : null;

  if (namedSlot) return namedSlot;
  return ensureTurnSpeakerSlot(nextTurnSpeakerSlotIndex);
}

function ensureTurnSpeakerSlot(index) {
  const safeIndex = Math.max(0, index % TURN_SPEAKER_COUNT);

  while (turnSpeakerSlots.length <= safeIndex) {
    const number = turnSpeakerSlots.length + 1;
    turnSpeakerSlots.push({
      id: `slot-${number}`,
      fallbackLabel: `Speaker ${number}`,
      name: "",
      normalizedName: "",
      source: "turn_slot",
      confidence: "low",
      sourceQuote: "",
      recordIds: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  return turnSpeakerSlots[safeIndex];
}

function advanceTurnSpeakerSlot(slot) {
  const index = Math.max(0, turnSpeakerSlots.findIndex((candidate) => candidate.id === slot.id));
  nextTurnSpeakerSlotIndex = (index + 1) % TURN_SPEAKER_COUNT;
}

function applyTurnSpeakerIdentity(slot, identity, currentRecord, options = {}) {
  slot.name = identity.name;
  slot.normalizedName = normalizeSpeakerName(identity.name);
  slot.source = identity.source || options.source || "self_intro";
  slot.confidence = identity.confidence || "medium";
  slot.sourceQuote = currentRecord.text;
  slot.updatedAt = new Date().toISOString();

  transcriptRecords
    .filter((candidate) => candidate.speakerSlotId === slot.id)
    .forEach((candidate) => {
      const isCurrent = candidate.id === currentRecord.id;
      applySpeakerLabel(candidate, getTurnSpeakerLabel(slot), {
        source: options.source || slot.source,
        highlight: options.highlight || isCurrent,
        delay: isCurrent ? options.delay : 0,
        updateTurn: isCurrent,
      });
    });
}

function getTurnSpeakerLabel(slot) {
  return slot?.name || slot?.fallbackLabel || "Heard";
}

function peekNextTurnSpeakerSlot() {
  return ensureTurnSpeakerSlot(nextTurnSpeakerSlotIndex);
}

function peekNextTurnSpeakerLabel(text = "") {
  const identity = extractSelfIntroduction(text);

  if (identity?.name) return identity.name;
  return getTurnSpeakerLabel(peekNextTurnSpeakerSlot());
}

function inferSpeakerFromRoster(record) {
  if (!isPlaceholderSpeaker(record.originalSpeaker)) return null;
  if (record.speakerId) return null;

  const inferred = inferLikelySpeaker(record.text);

  if (!inferred) return null;

  applySpeakerLabel(record, inferred.name, {
    highlight: inferred.confidence === "medium",
    source: inferred.source,
    updateTurn: true,
  });

  return inferred;
}

function inferLikelySpeaker(text) {
  const userSpeaker = getUserSpeaker();
  const otherSpeaker = getOtherSpeaker(userSpeaker);

  if (!userSpeaker || !otherSpeaker) return null;

  const clean = normalizeTranscript(text);
  const lower = clean.toLowerCase();
  const score = {
    [userSpeaker.name]: 0,
    [otherSpeaker.name]: 0,
  };

  if (isLikelyUserProjectLine(clean)) {
    score[userSpeaker.name] += 3;
  }

  if (isLikelyOtherPromptLine(clean)) {
    score[otherSpeaker.name] += 3;
  }

  if (isLikelyOtherAdviceLine(clean)) {
    score[otherSpeaker.name] += 3;
  }

  if (isQuestionLine(clean) && score[userSpeaker.name] === 0 && score[otherSpeaker.name] === 0) {
    const alternate = lastAssignedSpeaker === userSpeaker.name ? otherSpeaker : userSpeaker;
    score[alternate.name] += 1.2;
  }

  if (score[userSpeaker.name] === 0 && score[otherSpeaker.name] === 0 && lastAssignedSpeaker) {
    const alternate = lastAssignedSpeaker === userSpeaker.name ? otherSpeaker : userSpeaker;
    score[alternate.name] += 0.8;
  }

  const winner =
    score[userSpeaker.name] >= score[otherSpeaker.name] ? userSpeaker : otherSpeaker;
  const loser = winner === userSpeaker ? otherSpeaker : userSpeaker;

  if (score[winner.name] < 0.8 || score[winner.name] - score[loser.name] < 0.5) {
    return null;
  }

  return {
    name: winner.name,
    confidence: score[winner.name] >= 3 ? "medium" : "low",
    source: score[winner.name] >= 3 ? "content_guess" : "turn_guess",
  };
}

function getUserSpeaker() {
  return (
    speakerRoster.find((speaker) => speaker.role === "user") ||
    speakerRoster.find((speaker) => /^gogo$/i.test(speaker.name))
  );
}

function getOtherSpeaker(userSpeaker) {
  return speakerRoster.find((speaker) => speaker.name !== userSpeaker?.name) || null;
}

function isLikelyUserProjectLine(text) {
  return (
    /\b(?:we are|we're|we’re|we are building|we're building|we’re building|i built|i'm building|i’m building|my demo|our demo|our product|our platform|what should i|how can i introduce|i don't want|i’m worried|i'm worried|i’ll keep|i'll keep|i need|i want|i'm making|i’m making)\b/i.test(text) ||
    /(我们|我).*(做|建|介绍|项目|demo|演示|担心|需要|想|怎么|不知道)/u.test(text) ||
    /(我的|我们的).*(项目|产品|demo|演示)/u.test(text)
  );
}

function isLikelyOtherPromptLine(text) {
  return (
    /\b(?:nice to meet you too|what are you (?:doing|making|building)|what do you (?:do|make|build)|tell me about|how can i help|what brings you)\b/i.test(text) ||
    /(你|你们).*(今天|现在|在|做|建|介绍|项目|demo|需要|想|什么)/u.test(text)
  );
}

function isLikelyOtherAdviceLine(text) {
  return (
    /\b(?:i'd|i’d|i would|you should|you can|maybe|i can send|i'll send|i’ll send|talk to someone|find him|good luck)\b/i.test(text) ||
    /(我建议|你可以|可以去|联系方式|邮箱|联系人|我发给你|我可以发)/u.test(text)
  );
}

function isQuestionLine(text) {
  return /[?？]$/.test(text.trim()) || /\b(?:what|how|who|where|when|why|can|could|would|should|do|does|did|is|are)\b/i.test(text);
}

function extractSelfIntroduction(text) {
  const clean = normalizeTranscript(text);
  const patterns = [
    /\b(?:I am|I'm|I’m|My name is|This is)\s+([A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]{1,30}(?:\s+[A-Z][A-Za-zÀ-ÖØ-öø-ÿ'’-]{1,30}){0,2})\b/u,
    /\b(?:Je m'appelle|Je m’appelle|Je suis|Moi c'est|Moi c’est)\s+([A-ZÀ-ÖØ-Þ][\p{L}'’-]{1,30}(?:\s+[A-ZÀ-ÖØ-Þ][\p{L}'’-]{1,30}){0,2})\b/u,
    /(?:我叫|我叫做)\s*([\u3400-\u9fff]{2,4}|[A-Za-z][A-Za-z.'’-]{1,30})/u,
    /(?:我是)\s*([A-Za-z][A-Za-z.'’-]{1,30}|[\u3400-\u9fff]{2,4})(?:[，,。.!！?？]|\s|$)/u,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    const name = cleanPersonName(match?.[1]);

    if (name) {
      return {
        name,
        company: extractIntroducedCompany(clean),
        confidence: "medium",
        source: "self_intro",
      };
    }
  }

  return null;
}

function cleanPersonName(value) {
  const name = String(value || "")
    .replace(/[.,!?。！？，].*$/u, "")
    .replace(/\b(?:from|at|with|and)\b.*$/iu, "")
    .trim();

  if (!name || name.length > 40) return "";

  const lower = name.toLowerCase();
  const rejected = new Set([
    "building",
    "honestly",
    "not",
    "sure",
    "happy",
    "looking",
    "working",
    "trying",
    "another",
    "一个",
    "这边",
    "这个",
  ]);

  return rejected.has(lower) ? "" : name;
}

function extractIntroducedCompany(text) {
  const fromMatch = text.match(
    /\bfrom\s+([A-Z][A-Za-z0-9&.'’-]*(?:\s+[A-Z][A-Za-z0-9&.'’-]*){0,3})\b/u
  );

  if (fromMatch?.[1]) return fromMatch[1].trim();

  const chineseMatch = text.match(/(?:来自|在)\s*([\u3400-\u9fffA-Za-z0-9&.'’-]{2,18})/u);
  return chineseMatch?.[1]?.trim() || "";
}

function finalizeLiveDraftTranscript(text) {
  if (!liveDraftLine) return null;

  const speakerElement = liveDraftLine.querySelector("strong");
  const record = registerTranscriptRecord(
    {
      speaker: "Heard",
      text,
    },
    liveDraftLine,
    speakerElement
  );

  const initialLabel = resolveSpeakerLabel(record);
  applySpeakerLabel(record, initialLabel, {
    source: isPlaceholderSpeaker(initialLabel) ? "placeholder" : "known",
    updateTurn: true,
  });
  learnSpeakerIdentity(record);
  return record;
}

function addLiveTranscript(text, options = {}) {
  const normalized = normalizeTranscript(text);
  if (!normalized) return;
  let record = options.record || null;

  if (options.render !== false) {
    record = addTranscript({
      speaker: "Heard",
      text: normalized,
    });
  }

  addPlannerLine(
    {
      speaker: getPlannerSpeakerLabel(record, normalized),
      text: normalized,
    },
    {
      finalizeDraft: options.render === false,
    }
  );
}

function getPlannerSpeakerLabel(record, text) {
  if (record?.assignedSpeaker && !isPlaceholderSpeaker(record.assignedSpeaker)) {
    return record.assignedSpeaker;
  }

  const identity = extractSelfIntroduction(text);
  if (identity?.name) return identity.name;

  return peekNextTurnSpeakerLabel(text) || inferLikelySpeaker(text)?.name || "Heard";
}

function addPlannerLine(line, options = {}) {
  const normalized = normalizeTranscript(line.text);
  if (!normalized) return;

  const latestLine = liveTranscriptLines[liveTranscriptLines.length - 1];

  if (options.finalizeDraft && liveDraftPlannerLineActive && latestLine?.isDraft) {
    latestLine.speaker = line.speaker || latestLine.speaker || "Heard";
    latestLine.text = normalized;
    latestLine.at = new Date().toISOString();
    latestLine.isDraft = false;
    liveDraftPlannerLineActive = false;
    liveDraftPlannerText = normalized;
    queuePlanner();
    return;
  }

  if (options.replaceDraft) {
    if (liveDraftPlannerLineActive && latestLine?.isDraft) {
      latestLine.speaker = line.speaker || latestLine.speaker || "Heard";
      latestLine.text = normalized;
      latestLine.at = new Date().toISOString();
    } else {
      liveTranscriptLines.push({
        speaker: line.speaker || "Heard",
        text: normalized,
        at: new Date().toISOString(),
        isDraft: true,
      });
      liveTranscriptLines = liveTranscriptLines.slice(-8);
      liveDraftPlannerLineActive = true;
    }

    queuePlanner();
    return;
  }

  if (latestLine?.text === normalized) return;

  liveTranscriptLines.push({
    speaker: line.speaker || "Heard",
    text: normalized,
    at: new Date().toISOString(),
  });
  liveTranscriptLines = liveTranscriptLines.slice(-8);
  queuePlanner();
}

function updateMemory(next) {
  els.memoryState.textContent = next.state;
  els.needText.textContent = next.need;
  els.ownerText.textContent = next.owner;
  els.timingText.textContent = next.timing;
  els.unknownText.textContent = next.unknown;
  els.noteText.textContent = next.note;
}

function renderProductStage(stageName) {
  const stage = productStages[stageName] || productStages.waiting;

  els.plannerState.textContent = stage.plannerState;
  els.userGoalText.textContent = stage.userGoal;
  els.actionPaletteState.textContent = stage.actionState;
  els.actionReasonText.textContent = stage.actionReason;
  els.actionChipList.innerHTML = "";
  els.queuedActions.innerHTML = "";

  stage.actions.forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action;
    button.className = "action-chip";

    if (action === stage.selectedAction) {
      button.classList.add("is-selected");
    }

    els.actionChipList.appendChild(button);
  });

  stage.queue.forEach((action) => {
    const item = document.createElement("article");
    item.className = "queued-action";
    item.innerHTML = `
      <h3>${action.title}</h3>
      <p>${action.detail}</p>
      <small>Proof: "${action.proof}"</small>
    `;
    els.queuedActions.appendChild(item);
  });

  setHidden(els.actionPalette, !stage.selectedAction);
  setHidden(els.actionQueue, stage.queue.length === 0);
  addStageActionCard(stageName, stage);
}

function addStageActionCard(stageName, stage) {
  if (!stage.selectedAction || stageName === "waiting" || stageName === "listening") {
    if (!rightActionCards.length) renderRightActionCards();
    return;
  }

  const primaryAction = stage.queue[0] || {};
  const proof = primaryAction.proof || "";
  const title =
    primaryAction.title ||
    (stage.selectedAction === "Compare"
      ? "Ask if comparing notes would help."
      : stage.actionReason || "Save this next move.");

  addRightActionCard({
    type: stage.selectedAction,
    person: primaryAction.person || inferCardPerson(primaryAction),
    title,
    body: primaryAction.detail || stage.actionReason || "",
    proof,
    reason: stage.actionReason || "",
    queued: stage.queue.slice(1),
  });
}

function addRightActionCard(card) {
  const title = cleanCardText(card.title);

  if (!title) return;

  const normalized = {
    id: rightActionCardId + 1,
    type: cleanCardText(card.type || "Next"),
    person: cleanCardText(card.person || inferCardPerson(card)),
    title,
    body: cleanCardText(card.body),
    proof: cleanCardText(card.proof),
    reason: cleanCardText(card.reason),
    queued: Array.isArray(card.queued) ? card.queued.slice(0, 4) : [],
  };
  const key = [normalized.type, normalized.person, normalized.title, normalized.proof].join("|");
  const latest = rightActionCards[rightActionCards.length - 1];

  if (latest?.key === key) {
    rightActionCards[rightActionCards.length - 1] = {
      ...latest,
      ...normalized,
      key,
    };
  } else {
    rightActionCardId += 1;
    rightActionCards.push({
      ...normalized,
      id: rightActionCardId,
      key,
    });
    rightActionCards = rightActionCards.slice(-5);
  }

  renderRightActionCards();
}

function renderRightActionCards() {
  if (!els.rightActionCards) return;

  if (!rightActionCards.length) {
    els.rightActionCards.innerHTML = `
      <article class="right-action-card is-empty">
        <h2>Waiting for a useful next move.</h2>
        <p>Cards appear here only when RoomPilot has a quote-backed action.</p>
      </article>
    `;
    return;
  }

  const latestIndex = rightActionCards.length - 1;

  els.rightActionCards.innerHTML = rightActionCards
    .map((card, index) => {
      const open = index === latestIndex ? " open" : "";
      const collapsed = index === latestIndex ? "" : " is-collapsed";
      const queued = card.queued
        .map(
          (item) => `
            <li>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml(item.detail)}</span>
            </li>
          `
        )
        .join("");

      return `
        <details class="right-action-card${collapsed}"${open}>
          <summary>
            <span class="action-type">${escapeHtml(card.type)}</span>
            ${card.person ? `<span class="person-tag">${escapeHtml(card.person)}</span>` : ""}
            <strong>${escapeHtml(card.title)}</strong>
          </summary>
          <div class="right-action-body">
            ${card.body ? `<p>${escapeHtml(card.body)}</p>` : ""}
            ${card.reason ? `<p class="action-card-reason">${escapeHtml(card.reason)}</p>` : ""}
            ${
              card.proof
                ? `<div class="action-card-proof"><span>Proof</span><q>${escapeHtml(card.proof)}</q></div>`
                : ""
            }
            ${queued ? `<ul class="action-card-queue">${queued}</ul>` : ""}
          </div>
        </details>
      `;
    })
    .join("");
}

function cleanCardText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function inferCardPerson(card) {
  const text = cleanCardText(
    [card.title, card.body, card.proof, card.reason].filter(Boolean).join(" ")
  );

  if (/\bnick\b/i.test(text)) return "Nick";
  if (/\bhexa\b/i.test(text)) return "Hexa";
  if (/\bcamille\b/i.test(text)) return "Camille";
  if (/\bgogo\b/i.test(text)) return "Gogo";

  return "";
}

function queuePlanner() {
  if (plannerTimer) {
    window.clearTimeout(plannerTimer);
  }

  plannerTimer = window.setTimeout(runPlanner, 180);
}

async function runPlanner() {
  const transcriptKey = liveTranscriptLines.map((line) => line.text).join("\n");

  if (!transcriptKey || transcriptKey === lastPlannedTranscript) return;

  lastPlannedTranscript = transcriptKey;
  const requestId = ++plannerRequestId;
  els.plannerState.textContent = "checking transcript";

  try {
    const response = await withTimeout(
      fetch("/api/plan-actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_goal: userGoal,
          transcript: liveTranscriptLines,
          memory_quotes: seed.sessions.map((session) => ({
            person: session.person,
            company: session.company,
            quote: session.quote,
          })),
        }),
      }),
      6500,
      "Planner took too long"
    );
    const plan = await response.json();

    if (requestId !== plannerRequestId) return;

    if (!response.ok) {
      throw new Error(plan.error || "Planner failed");
    }

    renderPlannerPlan(plan);
  } catch (error) {
    console.warn(error);
    els.plannerState.textContent = "planner unavailable";
  }
}

function renderPlannerPlan(plan) {
  if (!plan.should_act) {
    els.plannerState.textContent = hasPlannerSuggestion ? "holding last move" : "staying quiet";

    if (!hasPlannerSuggestion) {
      setHidden(els.beat1Cue, true);
      setHidden(els.actionPalette, true);
      setHidden(els.actionQueue, true);
      setHidden(els.nextCard, true);
      setHidden(els.emptyCue, false);
    }
    updateMemory({
      state: "listening",
      need: plan.memory_update?.what_they_said || "Waiting for a quote.",
      owner: plan.memory_update?.who_seems_closest || "Not named yet.",
      timing: plan.memory_update?.when_it_matters || "Not named yet.",
      unknown: plan.memory_update?.still_unknown || "A quote worth acting on.",
      note: "Staying quiet until there is proof.",
    });
    return;
  }

  els.plannerState.textContent = "found a move";
  setHidden(els.emptyCue, true);
  hasPlannerSuggestion = true;
  setHidden(els.evidenceCapture, true);
  setHidden(els.actionPalette, false);
  setHidden(els.nextCard, false);

  if (plan.recommended_action_type === "compare") {
    renderBridgeCueFromPlan(plan);
  } else {
    setHidden(els.beat2Cue, true);
    setHidden(els.beat1Cue, false);
    els.graphWrap.classList.remove("is-bridge");
    updateCueFromPlan(plan);
  }

  renderActionPalette(plan);
  renderActionQueue(plan.after_session_actions || []);

  els.nextCardTitle.textContent = plan.live_cue || "Keep this moment for follow-up.";
  els.nextCardBody.textContent =
    plan.action_reason || "Use the evidence on screen. Prepare external actions after the session.";
  addRightActionCard({
    type: getSelectedActionLabel(plan),
    person: inferCardPerson({
      title: plan.live_cue,
      body: plan.action_reason,
      proof: plan.evidence_quote,
      reason: plan.not_inferred,
    }),
    title: plan.live_cue || "Keep this moment for follow-up.",
    body: plan.action_reason || "Use the evidence on screen. Prepare external actions after the session.",
    proof: plan.evidence_quote || "",
    reason: plan.not_inferred || "",
    queued: plan.after_session_actions || [],
  });
  updateMemory({
    state: plan.recommended_action_type === "none" ? "listening" : "planned",
    need: plan.memory_update?.what_they_said || "A useful quote appeared.",
    owner: plan.memory_update?.who_seems_closest || "Not named yet.",
    timing: plan.memory_update?.when_it_matters || "Not named yet.",
    unknown: plan.memory_update?.still_unknown || plan.not_inferred || "What to do next.",
    note: plan.action_reason || "A quote-backed move is ready.",
  });
}

function getSelectedActionLabel(plan) {
  const selected = (plan.actions || []).find((action) => action.selected);

  if (selected?.label) return selected.label;

  const labels = {
    ask: "Ask",
    save: "Save",
    compare: "Compare",
    draft_later: "Draft later",
    find_public_context: "Find public context",
    reminder: "Reminder",
  };

  return labels[plan.recommended_action_type] || "Next";
}

function updateCueFromPlan(plan) {
  const quoteBlock = els.beat1Cue.querySelector(".quote-block blockquote");
  const cueText = els.beat1Cue.querySelector(".cue-block h2");
  const notClaiming = els.beat1Cue.querySelector(".not-claiming");
  const confidence = els.beat1Cue.querySelector(".confidence");

  quoteBlock.textContent = quoteWithMarks(plan.evidence_quote);
  cueText.textContent = plan.live_cue;
  notClaiming.textContent = plan.not_inferred;
  confidence.textContent = `Confidence: ${plan.confidence || "medium"}`;
  confidence.classList.remove("low", "medium", "high");
  confidence.classList.add(plan.confidence || "medium");
}

function renderBridgeCueFromPlan(plan) {
  const currentQuote = findCurrentBridgeQuote(plan);
  const quoteBlocks = els.beat2Cue.querySelectorAll(".quote-block");
  const cueText = els.beat2Cue.querySelector(".cue-block h2");
  const notClaiming = els.beat2Cue.querySelector(".not-claiming");
  const confidence = els.beat2Cue.querySelector(".confidence");

  quoteBlocks[0].querySelector(".eyebrow").textContent = "Earlier / Sarah";
  quoteBlocks[0].querySelector("blockquote").textContent = quoteWithMarks(
    "After demo day, the next step disappears unless someone captures the exact quote."
  );
  quoteBlocks[1].querySelector(".eyebrow").textContent = "Right now / Camille";
  quoteBlocks[1].querySelector("blockquote").textContent = quoteWithMarks(currentQuote);

  cueText.textContent =
    "Sarah described the same lost-next-step problem. Worth asking Camille if they should compare notes.";
  notClaiming.textContent = "This only links two quotes. It does not assume they know each other.";
  confidence.textContent = `Confidence: ${plan.confidence || "medium"}`;
  confidence.classList.remove("low", "medium", "high");
  confidence.classList.add(plan.confidence || "medium");

  setHidden(els.beat1Cue, true);
  setHidden(els.beat2Cue, false);
  els.graphWrap.classList.add("is-bridge");
}

function findCurrentBridgeQuote(plan) {
  const current = liveTranscriptLines.find((line) =>
    /hard part|next step|moment disappears|useful next move|clear next move/i.test(line.text || "")
  );

  return (
    current?.text ||
    plan.evidence_quote ||
    "The hard part is not meeting people; it is remembering the useful next step before the moment disappears."
  );
}

function renderActionPalette(plan) {
  els.actionPaletteState.textContent = plan.recommended_action_type === "none" ? "quiet" : "chosen";
  els.actionReasonText.textContent = plan.action_reason || "";
  els.actionChipList.innerHTML = "";

  (plan.actions || []).forEach((action) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.className = "action-chip";

    if (action.selected) {
      button.classList.add("is-selected");
    }

    els.actionChipList.appendChild(button);
  });

  setHidden(els.actionPalette, !(plan.actions || []).some((action) => action.selected));
}

function renderActionQueue(actions) {
  els.queuedActions.innerHTML = "";

  actions.forEach((action) => {
    const item = document.createElement("article");
    item.className = "queued-action";
    item.innerHTML = `
      <h3>${escapeHtml(action.title)}</h3>
      <p>${escapeHtml(action.detail)}</p>
      <small>Proof: "${escapeHtml(action.proof)}"</small>
    `;
    els.queuedActions.appendChild(item);
  });

  setHidden(els.actionQueue, actions.length === 0);
}

function quoteWithMarks(text) {
  const clean = String(text || "").trim();
  return clean.startsWith('"') ? clean : `"${clean}"`;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = String(text || "");
  return div.innerHTML;
}

function showBeat1() {
  setHidden(els.emptyCue, true);
  setHidden(els.beat2Cue, true);
  setHidden(els.beat1Cue, false);
  setHidden(els.evidenceCapture, true);
  renderProductStage("firstQuote");
  updateMemory({
    state: "first quote",
    need: "The next step disappears after useful conversations.",
    owner: "Not named yet.",
    timing: "While the person is still here.",
    unknown: "What one action would save the moment.",
    note: "The card waits for a quote before suggesting anything.",
  });
}

function showAskQuestion() {
  renderProductStage("firstQuote");
  updateMemory({
    state: "question asked",
    need: "The next step disappears after useful conversations.",
    owner: "Not named yet.",
    timing: "While the person is still here.",
    unknown: "Which next move is concrete enough to act on.",
    note: "Asking for one action, not a summary.",
  });
}

function escalateMemory() {
  setHidden(els.evidenceCapture, false);
  renderProductStage("updated");
  updateMemory({
    state: "updated",
    need: "Hexa is named as the example path.",
    owner: "Not named yet.",
    timing: "After this conversation.",
    unknown: "Who at Hexa and what to mention.",
    note: "The card changes only after the Hexa quote appears.",
  });
}

function showBeat2() {
  setHidden(els.emptyCue, true);
  setHidden(els.beat1Cue, true);
  setHidden(els.evidenceCapture, true);
  setHidden(els.beat2Cue, false);
  setHidden(els.nextCard, false);
  els.nextCardTitle.textContent = "Ask Camille if Sarah is worth comparing notes with.";
  els.nextCardBody.textContent =
    "Use the graph only because Sarah and Camille both described the same lost-next-step problem.";
  els.graphWrap.classList.add("is-bridge");
  renderProductStage("bridge");
  updateMemory({
    state: "memory link",
    need: "Two people described the same lost-next-step problem.",
    owner: "Sarah and Camille",
    timing: "After this session.",
    unknown: "Whether they want to compare notes.",
    note: "The graph only speaks because two visible quotes match.",
  });
}

function showFinalMemory() {
  setHidden(els.nextCard, false);
  els.nextCardTitle.textContent = "Draft a short compare-notes note later.";
  els.nextCardBody.textContent =
    "Reference the two exact quotes and ask whether Camille wants to compare notes with Sarah.";
  renderProductStage("bridge");
  addRightActionCard({
    type: "Draft later",
    person: "Sarah",
    title: "Draft a short compare-notes note later.",
    body: "Reference the two exact quotes and ask whether Camille wants to compare notes with Sarah.",
    proof:
      "After demo day, the next step disappears unless someone captures the exact quote.",
    reason: "Not assuming Sarah and Camille know each other yet.",
    queued: [],
  });
  updateMemory({
    state: "ready",
    need: "Turn a live room into one useful next move.",
    owner: "Gogo",
    timing: "After the demo.",
    unknown: "Whether Camille wants the Sarah intro.",
    note: "Draft a proof-backed note after the conversation.",
  });
}

async function buildProofPayload() {
  let pioneerProof = null;

  try {
    const response = await fetch("./data/pioneer-proof-output.json", {
      cache: "no-store",
    });

    if (response.ok) {
      pioneerProof = await response.json();
    }
  } catch (error) {
    console.warn("Pioneer proof artifact could not be loaded.", error);
  }

  return {
    exported_at: new Date().toISOString(),
    product: "RoomPilot",
    session: {
      title: "Tech Europe Opportunity Session",
      audio_stored: false,
      mode: "replay_demo_with_pioneer_smoke_proof",
    },
    speaker_labels: buildSpeakerLabelProof(),
    evidence: [
      {
        id: "evidence_lost_next_step",
        speaker: "Camille",
        quote:
          "The hard part is not meeting people; it is remembering the useful next step before the moment disappears.",
      },
      {
        id: "evidence_hexa_path",
        speaker: "Camille",
        quote:
          "If someone says, ‘I’d talk to Hexa,’ capture that, then ask who at Hexa and what to mention.",
      },
      {
        id: "evidence_sarah_prior",
        speaker: "Sarah",
        quote: "After demo day, the next step disappears unless someone captures the exact quote.",
      },
      {
        id: "evidence_tech_path",
        speaker: "Gogo",
        quote:
          "So the tech path is simple: OpenAI Realtime turns speech into live text, Pioneer checks which quote is worth acting on, and RoomPilot turns it into one card.",
      },
    ],
    visible_cues: [
      {
        cue: "They named the real loss: the next step disappears. Ask what one action would save it.",
        not_inferred: "Not assuming who owns the follow-up yet.",
        confidence: "high",
        evidence_ids: ["evidence_lost_next_step"],
      },
      {
        cue:
          "Sarah described the same lost-next-step problem. Worth asking Camille if they should compare notes.",
        not_inferred: "This only links two quotes. It does not assume they know each other.",
        confidence: "medium",
        evidence_ids: ["evidence_sarah_prior", "evidence_lost_next_step"],
      },
    ],
    memory: {
      what_they_said: els.needText.textContent,
      who_seems_closest_to_it: els.ownerText.textContent,
      when_it_matters: els.timingText.textContent,
      still_unknown: els.unknownText.textContent,
      next_thing_to_do: "Draft a short compare-notes note later.",
    },
    pioneer_proof: pioneerProof,
  };
}

function buildSpeakerLabelProof() {
  const labels = [
    ...Array.from(speakerIdentityMap.values()).map((identity) => ({
      speaker_id: identity.speakerId,
      name: identity.name,
      company: identity.company || null,
      source: identity.source,
      confidence: identity.confidence,
      source_quote: identity.sourceQuote,
    })),
    ...speakerRoster.map((speaker) => ({
      speaker_id: null,
      name: speaker.name,
      company: null,
      source: speaker.source,
      confidence: speaker.confidence,
      source_quote: speaker.sourceQuote,
    })),
    ...turnSpeakerSlots.map((slot) => ({
      speaker_id: slot.id,
      name: getTurnSpeakerLabel(slot),
      company: null,
      source: slot.source,
      confidence: slot.confidence,
      source_quote: slot.sourceQuote,
    })),
  ];

  const seen = new Set();
  return labels.filter((label) => {
    const key = normalizeSpeakerName(label.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function exportProof() {
  const payload = await buildProofPayload();
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = "roompilot-proof.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function schedule(type, at) {
  const callbacks = {
    showSession,
    beat1: showBeat1,
    askQuestion: showAskQuestion,
    escalateMemory,
    beat2: showBeat2,
    showFinalMemory,
  };

  if (!callbacks[type]) return;
  timers.push(window.setTimeout(callbacks[type], at));
}

function startDemo() {
  resetDemo();
  setSessionActive(true);
  showSession();
  startClock();

  timeline.transcript.forEach((line) => {
    timers.push(
      window.setTimeout(() => {
        addTranscript(line);
      }, line.at)
    );
  });

  (timeline.events || []).forEach((event) => {
    schedule(event.type, event.at);
  });
}

function jumpToBeat1() {
  resetDemo();
  setSessionActive(true);
  showSession();
  addTranscriptThrough("beat1");
  showBeat1();
  els.demoClock.textContent = "00:35";
}

function jumpToBeat2() {
  resetDemo();
  setSessionActive(true);
  showSession();
  addTranscriptThrough("beat2");
  showBeat2();
  els.demoClock.textContent = "01:07";
}

function addTranscriptThrough(eventType) {
  const eventAt = (timeline.events || []).find((event) => event.type === eventType)?.at;
  const cutoff = Number.isFinite(eventAt) ? eventAt : Number.POSITIVE_INFINITY;

  timeline.transcript
    .filter((line) => line.at <= cutoff)
    .forEach(addTranscript);
}

function bindControls() {
  els.startDemo.addEventListener("click", startDemo);
  els.startDemoHero.addEventListener("click", startDemo);
  els.resetDemo.addEventListener("click", resetDemo);
  els.jumpBeat1.addEventListener("click", jumpToBeat1);
  els.jumpBeat2.addEventListener("click", jumpToBeat2);
  els.stopSession.addEventListener("click", resetDemo);
  els.exportProof.addEventListener("click", exportProof);
  els.liveMic.addEventListener("click", toggleLiveMic);

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (key === "s") startDemo();
    if (key === "r") resetDemo();
    if (key === "1") jumpToBeat1();
    if (key === "2") jumpToBeat2();
  });
}

async function toggleLiveMic() {
  if (livePeer) {
    stopLiveMic();
    return;
  }

  await startLiveMic();
}

async function startLiveMic() {
  resetDemo();
  const attemptId = ++liveAttemptId;
  setLiveStatus("Preparing live mic", "pending");
  showSession();
  setSessionActive(true);
  startClock();

  try {
    const sessionResponse = await withTimeout(
      fetch("/api/realtime/session", {
        method: "POST",
      }),
      12000,
      "OpenAI took too long to start. Try Replay."
    );
    const session = await sessionResponse.json();

    if (!sessionResponse.ok) {
      throw new Error(session.error || "Realtime session failed");
    }

    const ephemeralKey =
      session.client_secret?.value || session.client_secret || session.value;

    if (!ephemeralKey) {
      throw new Error("Realtime session did not return a client secret");
    }

    setLiveStatus("Opening microphone", "pending");
    const stream = await withTimeout(
      navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      }),
      6000,
      "Allow microphone access, then try again."
    );

    if (attemptId !== liveAttemptId) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    liveStream = stream;

    livePeer = new RTCPeerConnection();
    livePeer.addEventListener("connectionstatechange", () => {
      if (!livePeer) return;
      if (livePeer.connectionState === "connected") {
        describeLiveState("Connected.");
      }
      if (livePeer.connectionState === "failed") {
        setLiveStatus("Realtime connection failed. Use Replay.", "error");
      }
    });
    livePeer.addEventListener("iceconnectionstatechange", () => {
      if (!livePeer) return;
      if (livePeer.iceConnectionState === "connected") {
        describeLiveState("Audio path connected.");
      }
      if (livePeer.iceConnectionState === "failed") {
        setLiveStatus("Audio path failed. Use Replay.", "error");
      }
    });
    livePeer.addEventListener("track", (event) => {
      event.track.enabled = false;
      event.track.stop();
    });
    liveStream
      .getAudioTracks()
      .forEach((track) => livePeer.addTrack(track, liveStream));
    liveDataChannel = livePeer.createDataChannel("oai-events");
    liveDataChannel.addEventListener("open", () => {
      lastTranscriptAt = Date.now();
      describeLiveState("Listening. Speak, then pause.");
      scheduleFallbackTranscriber(liveStream);
    });
    liveDataChannel.addEventListener("message", handleRealtimeMessage);
    liveDataChannel.addEventListener("error", () => {
      setLiveStatus("Realtime event channel failed. Use Replay.", "error");
    });
    startAudioLevelMonitor(liveStream);

    const offer = await livePeer.createOffer();
    await livePeer.setLocalDescription(offer);
    await waitForIceGathering(livePeer, 3000);
    setLiveStatus("Connecting live transcript", "pending");

    const sdpResponse = await withTimeout(
      fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: livePeer.localDescription?.sdp || offer.sdp,
      }),
      12000,
      "Realtime connection took too long. Use Replay."
    );

    if (!sdpResponse.ok) {
      throw new Error(
        await readResponseError(sdpResponse, "Realtime session failed")
      );
    }

    await livePeer.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text(),
    });
    scheduleFallbackTranscriber(liveStream);

    els.liveMic.textContent = "Stop live mic";
    describeLiveState("Connecting.");
  } catch (error) {
    console.error(error);
    stopLiveMic();
    setLiveStatus(error.message, "error");
  }
}

function stopLiveMic() {
  liveAttemptId += 1;

  if (liveDataChannel) {
    liveDataChannel.close();
    liveDataChannel = null;
  }

  if (livePeer) {
    livePeer.close();
    livePeer = null;
  }

  if (liveStream) {
    liveStream.getTracks().forEach((track) => track.stop());
    liveStream = null;
  }

  stopAudioLevelMonitor();
  liveDraftLine = null;
  liveDraftPlannerText = "";
  liveDraftPlannerLineActive = false;
  lastLiveAudioLevel = 0;
  lastTranscriptAt = 0;
  lastFallbackTranscript = "";
  stopFallbackTranscriber();
  els.liveMic.textContent = "Try live mic";
  setLiveStatus("Live mic idle");
}

function withTimeout(promise, duration, message) {
  let timeoutId;

  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), duration);
  });

  return Promise.race([promise, timeout]).finally(() => {
    window.clearTimeout(timeoutId);
  });
}

function waitForIceGathering(peer, timeoutMs) {
  if (peer.iceGatheringState === "complete") {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeoutId = window.setTimeout(done, timeoutMs);

    function done() {
      window.clearTimeout(timeoutId);
      peer.removeEventListener("icegatheringstatechange", handleStateChange);
      resolve();
    }

    function handleStateChange() {
      if (peer.iceGatheringState === "complete") {
        done();
      }
    }

    peer.addEventListener("icegatheringstatechange", handleStateChange);
  });
}

async function readResponseError(response, fallbackMessage) {
  const text = await response.text();

  try {
    const payload = JSON.parse(text);
    return payload.error || fallbackMessage;
  } catch {
    return text || fallbackMessage;
  }
}

function handleRealtimeMessage(message) {
  let event;

  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }

  console.debug("Realtime event", event.type, event);

  if (event.type === "error") {
    setLiveStatus(event.error?.message || "Realtime transcript failed.", "error");
    return;
  }

  if (event.type === "input_audio_buffer.speech_started") {
    describeLiveState("Heard speech. Waiting for transcript.");
    return;
  }

  if (event.type === "input_audio_buffer.speech_stopped") {
    describeLiveState("Speech ended. Transcribing.");
    return;
  }

  if (event.type === "input_audio_buffer.committed") {
    describeLiveState("Audio committed. Waiting for words.");
    return;
  }

  if (event.type?.startsWith("response.")) {
    return;
  }

  if (event.item?.role === "assistant") {
    return;
  }

  if (!isTranscriptionEvent(event)) {
    return;
  }

  const transcript = extractTranscriptText(event);

  if (!transcript) return;

  lastTranscriptAt = Date.now();
  setLiveStatus("Transcript received", "active");
  if (event.type?.includes("delta")) {
    updateLiveDraft(transcript);
    return;
  }

  stopFallbackTranscriber();

  if (liveDraftLine) {
    clearLiveDraftPlannerTimer();
    liveDraftLine.classList.remove("is-live-draft");
    liveDraftLine.querySelector("p").textContent = transcript;
    const record = finalizeLiveDraftTranscript(transcript);
    addLiveTranscript(transcript, { render: false, record });
  } else {
    addLiveTranscript(transcript);
  }

  liveDraftLine = null;
}

function isTranscriptionEvent(event) {
  return event.type?.startsWith("conversation.item.input_audio_transcription.");
}

function extractTranscriptText(event) {
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.transcript === "string") return event.transcript;

  const content = event.item?.content || event.response?.output?.[0]?.content;
  if (!Array.isArray(content)) return "";

  const transcriptPart = content.find((part) => part.transcript || part.text);
  return transcriptPart?.transcript || transcriptPart?.text || "";
}

function updateLiveDraft(delta) {
  if (!liveDraftLine) {
    liveDraftLine = document.createElement("article");
    liveDraftLine.className = "transcript-line is-live-draft";
    liveDraftLine.innerHTML = `
      <strong>Heard</strong>
      <p></p>
    `;
    els.transcriptList.appendChild(liveDraftLine);
  }

  const textElement = liveDraftLine.querySelector("p");
  textElement.textContent += delta;
  updateLiveDraftSpeakerLabel(textElement.textContent);
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
  queueLiveDraftPlanner();
}

function updateLiveDraftSpeakerLabel(text) {
  if (!liveDraftLine) return;

  const speakerElement = liveDraftLine.querySelector("strong");
  const label = getPlannerSpeakerLabel(null, text);

  if (!speakerElement || !label) return;

  const slot = peekNextTurnSpeakerSlot();
  speakerElement.textContent = label;
  liveDraftLine.classList.toggle("has-speaker-name", !isPlaceholderSpeaker(label));
  liveDraftLine.dataset.speakerSource = "turn_slot";

  if (isPlaceholderSpeaker(label)) {
    delete liveDraftLine.dataset.speakerTheme;
  } else {
    liveDraftLine.dataset.speakerTheme = getSpeakerTheme(label, {
      speakerSlotId: slot?.id || "",
    });
  }
}

function clearLiveDraftPlannerTimer() {
  if (liveDraftPlannerTimer) {
    window.clearTimeout(liveDraftPlannerTimer);
    liveDraftPlannerTimer = null;
  }
}

function queueLiveDraftPlanner() {
  clearLiveDraftPlannerTimer();

  liveDraftPlannerTimer = window.setTimeout(() => {
    const text = normalizeTranscript(liveDraftLine?.querySelector("p")?.textContent);

    if (!text || text.length < 18 || text === liveDraftPlannerText) return;

    liveDraftPlannerText = text;
    addPlannerLine(
      {
        speaker: getPlannerSpeakerLabel(null, text),
        text,
      },
      {
        replaceDraft: true,
      }
    );
  }, 900);
}

function scheduleFallbackTranscriber(stream) {
  stopFallbackTranscriber();

  if (new URLSearchParams(window.location.search).get("liveOnly") === "1") {
    console.info("Fallback transcriber disabled by liveOnly=1.");
    return;
  }

  fallbackActivationTimer = window.setTimeout(() => {
    if (!livePeer || !stream?.active || fallbackTranscriberActive) return;

    if (Date.now() - lastTranscriptAt < fallbackStaleTranscriptMs) {
      scheduleFallbackTranscriber(stream);
      return;
    }

    setLiveStatus("Live transcript delayed; using backup.", "pending");
    startFallbackTranscriber(stream);
  }, fallbackActivationDelayMs);
}

function startFallbackTranscriber(stream) {
  fallbackTranscriberActive = true;

  if (!window.MediaRecorder) {
    fallbackTranscriberActive = false;
    console.warn("MediaRecorder is not available in this browser.");
    return;
  }

  recordFallbackSegment(stream);
}

function recordFallbackSegment(stream) {
  if (!livePeer || !fallbackTranscriberActive || !stream.active) return;

  const recorderOptions = getRecorderOptions();
  const chunks = [];
  const attemptId = liveAttemptId;
  const recorder = new MediaRecorder(stream, recorderOptions);
  fallbackRecorder = recorder;

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.addEventListener("stop", () => {
    if (fallbackRecorder === recorder) {
      fallbackRecorder = null;
    }

    if (!livePeer || !fallbackTranscriberActive || attemptId !== liveAttemptId) {
      return;
    }

    const blob = new Blob(chunks, {
      type: recorder.mimeType || recorderOptions.mimeType || "audio/webm",
    });

    if (blob.size >= 1500) {
      setLiveStatus(`Captured audio ${Math.round(blob.size / 1024)}KB`, "active");
      transcribeFallbackChunk(blob);
    }

    fallbackSegmentTimer = window.setTimeout(() => {
      recordFallbackSegment(stream);
    }, fallbackSegmentGapMs);
  });

  recorder.addEventListener("error", () => {
    setLiveStatus("Browser recorder failed. Try Replay.", "error");
  });

  recorder.start();
  fallbackSegmentTimer = window.setTimeout(() => {
    if (recorder.state === "recording") {
      recorder.stop();
    }
  }, fallbackSegmentMs);
}

function getRecorderOptions() {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));

  return mimeType ? { mimeType } : {};
}

function stopFallbackTranscriber() {
  if (fallbackActivationTimer) {
    window.clearTimeout(fallbackActivationTimer);
    fallbackActivationTimer = null;
  }

  if (fallbackSegmentTimer) {
    window.clearTimeout(fallbackSegmentTimer);
    fallbackSegmentTimer = null;
  }

  if (fallbackRecorder && fallbackRecorder.state !== "inactive") {
    fallbackRecorder.stop();
  }

  fallbackRecorder = null;
  fallbackTranscriberActive = false;
  fallbackTranscribeInFlight = false;
  fallbackPendingBlob = null;
}

async function transcribeFallbackChunk(blob) {
  if (!livePeer || !fallbackTranscriberActive) return;

  if (fallbackTranscribeInFlight) {
    fallbackPendingBlob = blob;
    setLiveStatus("Queued audio for transcript", "active");
    return;
  }

  fallbackTranscribeInFlight = true;
  const attemptId = liveAttemptId;
  setLiveStatus("Sending audio for transcript", "active");

  try {
    const response = await withTimeout(
      fetch("/api/transcribe", {
        method: "POST",
        headers: {
          "Content-Type": normalizeAudioContentType(blob.type),
        },
        body: blob,
      }),
      14000,
      "Transcription took too long"
    );
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Chunk transcription failed");
    }

    const text = normalizeTranscript(payload.text);

    if (!text) {
      describeLiveState("No words in last chunk.");
      return;
    }

    if (text === lastFallbackTranscript) {
      describeLiveState("Already captured that line.");
      return;
    }

    if (!livePeer || !fallbackTranscriberActive || attemptId !== liveAttemptId) {
      return;
    }

    lastFallbackTranscript = text;
    lastTranscriptAt = Date.now();
    addLiveTranscript(text);
    setLiveStatus("Transcript received", "active");
  } catch (error) {
    console.warn(error);
    setLiveStatus(error.message, "error");
  } finally {
    fallbackTranscribeInFlight = false;

    if (
      fallbackPendingBlob &&
      livePeer &&
      fallbackTranscriberActive &&
      attemptId === liveAttemptId
    ) {
      const pendingBlob = fallbackPendingBlob;
      fallbackPendingBlob = null;
      window.setTimeout(() => transcribeFallbackChunk(pendingBlob), 100);
    }
  }
}

function normalizeAudioContentType(type) {
  if (type?.startsWith("audio/mp4")) return "audio/mp4";
  if (type?.startsWith("audio/webm")) return "audio/webm";
  return "audio/webm";
}

function normalizeTranscript(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function startAudioLevelMonitor(stream) {
  stopAudioLevelMonitor();

  liveAudioContext = new AudioContext();
  const source = liveAudioContext.createMediaStreamSource(stream);
  const analyser = liveAudioContext.createAnalyser();
  const samples = new Uint8Array(analyser.fftSize);

  source.connect(analyser);

  liveAudioLevelTimer = window.setInterval(() => {
    analyser.getByteTimeDomainData(samples);

    let sum = 0;
    for (const sample of samples) {
      const value = (sample - 128) / 128;
      sum += value * value;
    }

    lastLiveAudioLevel = Math.min(1, Math.sqrt(sum / samples.length) * 4);

    if (!livePeer) return;

    const waitingForTranscript =
      liveDataChannel?.readyState === "open" &&
      Date.now() - lastTranscriptAt > 8000;

    if (waitingForTranscript && lastLiveAudioLevel > 0.04) {
      describeLiveState("Heard audio. Waiting for words.");
    }

    if (waitingForTranscript && lastLiveAudioLevel <= 0.04) {
      describeLiveState("Mic is open but quiet.");
    }
  }, 450);
}

function stopAudioLevelMonitor() {
  if (liveAudioLevelTimer) {
    window.clearInterval(liveAudioLevelTimer);
    liveAudioLevelTimer = null;
  }

  if (liveAudioContext) {
    liveAudioContext.close();
    liveAudioContext = null;
  }
}

async function init() {
  await loadData();
  bindControls();
  resetDemo();

  console.info("RoomPilot demo loaded", {
    seedSessions: seed.sessions.length,
    transcriptLines: timeline.transcript.length,
  });
}

init();
