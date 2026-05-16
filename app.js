const fallbackSeed = {
  sessions: [
    {
      id: "session_sarah_station_f",
      person: "Sarah",
      company: "Station F",
      when: "Yesterday",
      quote: "We're evaluating tools for event follow-up this quarter.",
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
      text: "Hi, I’m Gogo. I’m building RoomPilot today: it helps me turn live conversations into the next useful move.",
      at: 3200,
    },
    {
      id: "t2",
      speaker: "Heard",
      text: "I’m Camille. Nice to meet you. I work with founder programs around events, so I’ve seen this kind of problem a lot.",
      at: 5400,
    },
    {
      id: "t3",
      speaker: "Gogo",
      text: "Nice. How has the hackathon been for you so far? It’s a pretty intense room.",
      at: 7800,
    },
    {
      id: "t4",
      speaker: "Camille",
      text: "Yeah, intense but good. I’ve had too much coffee already, but the projects are strong.",
      at: 10200,
    },
    {
      id: "t5",
      speaker: "Gogo",
      text: "I built this RoomPilot demo today, but I’m honestly not sure what the next step is after the hackathon. I don’t want it to just become another weekend project.",
      at: 13200,
    },
    {
      id: "t6",
      speaker: "Camille",
      text: "Yeah, that happens a lot. You get a demo working, everyone says it’s cool, and then Monday comes and nobody knows who to talk to.",
      at: 16200,
      hero: true,
    },
    {
      id: "t7",
      speaker: "Camille",
      text: "The real risk is that the demo dies after the weekend.",
      at: 18600,
    },
    {
      id: "t8",
      speaker: "Gogo",
      text: "That is exactly what I’m worried about. Who do you think would actually care enough to try something like this next week?",
      at: 24400,
    },
    {
      id: "t9",
      speaker: "Camille",
      text: "I’d talk to someone at Hexa. They see a lot of founder meetings and event follow-up problems. There’s probably a team or partner there who would understand this immediately.",
      at: 28600,
      evidence: true,
    },
    {
      id: "t10",
      speaker: "Gogo",
      text: "Okay, that helps. Who at Hexa would be the right first person to talk to?",
      at: 34800,
    },
    {
      id: "t11",
      speaker: "Camille",
      text: "Maybe Nick. I don’t know if he owns this exactly, but he’d know who does. I can send you his email, or you can probably find him on LinkedIn.",
      at: 38600,
      evidence: true,
    },
    {
      id: "t12",
      speaker: "Gogo",
      text: "Amazing. I’ll keep it light. What should I ask him without sounding like I’m pitching too hard?",
      at: 44400,
    },
    {
      id: "t13",
      speaker: "Camille",
      text: "Just say you tested it live at Tech Europe and want to know whether this helps founders avoid losing useful conversations after events.",
      at: 48200,
      evidence: true,
    },
    {
      id: "t14",
      speaker: "Gogo",
      text: "That’s perfect. Thanks, Camille. Good luck with the rest of the demos.",
      at: 52200,
    },
    {
      id: "t15",
      speaker: "Camille",
      text: "You too. I’ll send Nick’s contact later if I find the right one.",
      at: 54800,
    },
  ],
  events: [
    { type: "showSession", at: 2800 },
    { type: "beat1", at: 19800 },
    { type: "askQuestion", at: 23200 },
    { type: "escalateMemory", at: 31000 },
    { type: "beat2", at: 40800 },
    { type: "showFinalMemory", at: 50000 },
  ],
};

let seed = fallbackSeed;
let timeline = fallbackTimeline;
let timers = [];
let clockTimer = null;
let statusTimer = null;
let statusIndex = 0;
let demoStartedAt = null;
let demoSpeechVoices = null;
let demoAudioCache = new Map();
let demoAudioElements = [];
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
    userGoal: "Find useful follow-up after Tech Europe.",
    actionState: "waiting",
    actionReason: "Waiting for enough proof.",
    selectedAction: null,
    actions: [],
    queue: [],
  },
  listening: {
    plannerState: "set before listening",
    userGoal: "Find useful follow-up after Tech Europe.",
    actionState: "quiet",
    actionReason: "",
    selectedAction: null,
    actions: [],
    queue: [],
  },
  firstQuote: {
    plannerState: "set before listening",
    userGoal: "Find useful follow-up after Tech Europe.",
    actionState: "one safe move",
    actionReason:
      "Turn the shared hackathon fear into one useful question.",
    selectedAction: "Ask",
    actions: ["Ask", "Save", "Compare", "Draft later", "Find public context"],
    queue: [
      {
        title: "Ask who would try it next week.",
        person: "Camille",
        detail: "Find the person who would care before the demo becomes a weekend artifact.",
        proof: "The real risk is that the demo dies after the weekend.",
      },
    ],
  },
  updated: {
    plannerState: "set before listening",
    userGoal: "Find useful follow-up after Tech Europe.",
    actionState: "first path",
    actionReason: "They pointed to Hexa. Ask for the first person before jumping to email.",
    selectedAction: "Ask",
    actions: ["Ask", "Save", "Draft later", "Find public context", "Reminder"],
    queue: [
      {
        title: "Ask who at Hexa to start with.",
        person: "Hexa",
        detail: "Get the name first. Email or LinkedIn can wait until after the conversation.",
        proof: "I’d talk to someone at Hexa.",
      },
      {
        title: "Save Hexa as the first path.",
        person: "Hexa",
        detail: "Keep the reason attached: they see founder meetings and event follow-up problems.",
        proof: "They see a lot of founder meetings and event follow-up problems.",
      },
    ],
  },
  bridge: {
    plannerState: "set before listening",
    userGoal: "Find useful follow-up after Tech Europe.",
    actionState: "contact path",
    actionReason: "Nick is a plausible path, but the speaker has not confirmed he owns this.",
    selectedAction: "Draft later",
    actions: ["Ask", "Save", "Draft later", "Find public context", "Reminder"],
    queue: [
      {
        title: "Save Nick as the next follow-up.",
        person: "Nick",
        detail: "Ask for the best contact route, then draft a short note after the conversation.",
        proof: "Maybe Nick. I don’t know if he owns this exactly, but he’d know who does.",
      },
      {
        title: "Find Nick after the session.",
        person: "Nick",
        detail: "Use email if they send it, otherwise search LinkedIn after the conversation.",
        proof: "I can send you his email, or you can probably find him on LinkedIn.",
      },
      {
        title: "Draft a soft follow-up note to Nick.",
        person: "Nick",
        detail: "Ask for feedback, not a sale.",
        proof: "Say you tested it live at Tech Europe.",
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

const userGoal = "Find useful follow-up after Tech Europe.";

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
  stopDemoSpeech();

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

function getDemoSpeechVoices() {
  if (demoSpeechVoices) return demoSpeechVoices;

  const voices = window.speechSynthesis?.getVoices?.() || [];
  const englishVoices = voices.filter((voice) => /^en[-_]/i.test(voice.lang));
  const pool = englishVoices.length ? englishVoices : voices;
  const lowerName = (voice) => voice.name.toLowerCase();
  const gogoVoice =
    pool.find((voice) => /male|daniel|alex|fred|thomas|david|george/i.test(voice.name)) ||
    pool[0] ||
    null;
  const camilleVoice =
    pool.find(
      (voice) =>
        voice !== gogoVoice &&
        /female|samantha|victoria|karen|moira|serena|zira|susan|ava/i.test(voice.name)
    ) ||
    pool.find((voice) => voice !== gogoVoice && lowerName(voice) !== lowerName(gogoVoice || { name: "" })) ||
    null;

  demoSpeechVoices = {
    gogo: gogoVoice,
    camille: camilleVoice,
  };
  return demoSpeechVoices;
}

function stopDemoSpeech() {
  demoAudioElements.forEach((audio) => {
    audio.pause();
    audio.currentTime = 0;
  });
  demoAudioElements = [];

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

function resolveDemoSpeakerRole(line) {
  const speaker = String(line.speaker || "").toLowerCase();
  const text = String(line.text || "").toLowerCase();
  const isCamille = speaker.includes("camille") || text.includes("i’m camille") || text.includes("i'm camille");
  const isGogo = speaker.includes("gogo") || text.includes("i’m gogo") || text.includes("i'm gogo");

  return isCamille && !isGogo ? "camille" : "gogo";
}

async function getGradiumDemoAudio(line) {
  if (!line?.text) return null;

  const speaker = resolveDemoSpeakerRole(line);
  const cacheKey = `${speaker}:${line.text}`;

  if (demoAudioCache.has(cacheKey)) {
    return demoAudioCache.get(cacheKey).cloneNode();
  }

  const response = await fetch("/api/demo-tts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      speaker,
      text: line.text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Demo TTS failed: ${response.status}`);
  }

  const audioBlob = await response.blob();
  const audio = new Audio(URL.createObjectURL(audioBlob));
  audio.preload = "auto";
  demoAudioCache.set(cacheKey, audio);

  return audio.cloneNode();
}

async function preloadDemoSpeech() {
  const lines = timeline.transcript || [];
  await Promise.allSettled(lines.slice(0, 6).map(getGradiumDemoAudio));
  lines.slice(6).forEach((line) => {
    getGradiumDemoAudio(line).catch(() => {});
  });
}

function speakBrowserDemoLine(line) {
  if (!window.speechSynthesis || !line?.text) return;

  const utterance = new SpeechSynthesisUtterance(line.text);
  const voices = getDemoSpeechVoices();
  const isCamille = resolveDemoSpeakerRole(line) === "camille";

  utterance.voice = isCamille ? voices.camille : voices.gogo;
  utterance.lang = "en-US";
  utterance.rate = isCamille ? 1.02 : 1;
  utterance.pitch = isCamille ? 1.18 : 0.82;
  utterance.volume = 0.95;

  window.speechSynthesis.speak(utterance);
}

async function speakDemoLine(line) {
  try {
    const audio = await getGradiumDemoAudio(line);

    if (!audio) return;

    demoAudioElements.push(audio);
    audio.addEventListener(
      "ended",
      () => {
        demoAudioElements = demoAudioElements.filter((item) => item !== audio);
      },
      { once: true }
    );
    await audio.play();
  } catch (error) {
    speakBrowserDemoLine(line);
  }
}

if (window.speechSynthesis) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    demoSpeechVoices = null;
  });
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
  els.nextCardTitle.textContent = "Ask who at Hexa to start with.";
  els.nextCardBody.textContent =
    "Get the name first. Email or LinkedIn can wait until after the conversation.";
  setSessionActive(false);
  els.graphWrap.classList.remove("is-live", "is-bridge");
  liveTranscriptLines = [];
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
    els.demoClock.textContent = `00:${String(seconds).padStart(2, "0")}`;
  }, 250);
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
  speaker.textContent = line.speaker;
  text.textContent = line.text;
  item.append(speaker, text);

  els.transcriptList.appendChild(item);
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function addLiveTranscript(text, options = {}) {
  const normalized = normalizeTranscript(text);
  if (!normalized) return;

  if (options.render !== false) {
    addTranscript({
      speaker: "Heard",
      text: normalized,
    });
  }

  addPlannerLine(
    {
      speaker: "Heard",
      text: normalized,
    },
    {
      finalizeDraft: options.render === false,
    }
  );
}

function addPlannerLine(line, options = {}) {
  const normalized = normalizeTranscript(line.text);
  if (!normalized) return;

  const latestLine = liveTranscriptLines[liveTranscriptLines.length - 1];

  if (options.finalizeDraft && liveDraftPlannerLineActive && latestLine?.isDraft) {
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

  quoteBlocks[0].querySelector(".eyebrow").textContent = "Earlier / Camille";
  quoteBlocks[0].querySelector("blockquote").textContent = quoteWithMarks(
    "The real risk is that the demo dies after the weekend."
  );
  quoteBlocks[1].querySelector(".eyebrow").textContent = "Right now / Camille";
  quoteBlocks[1].querySelector("blockquote").textContent = quoteWithMarks(currentQuote);

  cueText.textContent =
    "Nick may know the path. Ask for the best contact route before drafting anything.";
  notClaiming.textContent = "Not assuming Nick owns this yet.";
  confidence.textContent = `Confidence: ${plan.confidence || "medium"}`;
  confidence.classList.remove("low", "medium", "high");
  confidence.classList.add(plan.confidence || "medium");

  setHidden(els.beat1Cue, true);
  setHidden(els.beat2Cue, false);
  els.graphWrap.classList.add("is-bridge");
}

function findCurrentBridgeQuote(plan) {
  const current = liveTranscriptLines.find((line) =>
    /nick|email|linkedin|hexa|contact|owns this/i.test(line.text || "")
  );

  return (
    current?.text ||
    plan.evidence_quote ||
    "Maybe Nick. I don’t know if he owns this exactly, but he’d know who does."
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
    need: "The demo might die after the weekend.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who would care enough to try it next week.",
    note: "Ask who would actually care before asking for contact details.",
  });
}

function showAskQuestion() {
  renderProductStage("firstQuote");
  updateMemory({
    state: "question asked",
    need: "The demo might die after the weekend.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who would care enough to try it next week.",
    note: "Asking who would care enough to try it.",
  });
}

function escalateMemory() {
  setHidden(els.evidenceCapture, false);
  renderProductStage("updated");
  updateMemory({
    state: "updated",
    need: "Hexa may be the first path.",
    owner: "Someone at Hexa",
    timing: "Next week",
    unknown: "Who at Hexa to start with.",
    note: "The card changed only after Hexa was named.",
  });
}

function showBeat2() {
  setHidden(els.emptyCue, true);
  setHidden(els.beat1Cue, true);
  setHidden(els.evidenceCapture, true);
  setHidden(els.beat2Cue, false);
  setHidden(els.nextCard, false);
  els.nextCardTitle.textContent = "Save Nick as the next follow-up.";
  els.nextCardBody.textContent =
    "Ask for the best contact route, then draft a short note after the conversation.";
  els.graphWrap.classList.add("is-bridge");
  renderProductStage("bridge");
  updateMemory({
    state: "contact path",
    need: "Hexa may be the first path.",
    owner: "Nick may know who owns this.",
    timing: "After Tech Europe",
    unknown: "Whether Nick is the right person.",
    note: "Email or LinkedIn can wait until after the conversation.",
  });
}

function showFinalMemory() {
  setHidden(els.nextCard, false);
  els.nextCardTitle.textContent = "Draft a soft follow-up note to Nick.";
  els.nextCardBody.textContent =
    "Say you tested it live at Tech Europe and ask whether it helps founders keep useful conversations from getting lost.";
  renderProductStage("bridge");
  addRightActionCard({
    type: "Draft later",
    person: "Nick",
    title: "Draft a soft follow-up note to Nick.",
    body: "Say you tested it live at Tech Europe and ask whether it helps founders keep useful conversations from getting lost.",
    proof:
      "Just say you tested it live at Tech Europe and want to know whether this helps founders avoid losing useful conversations after events.",
    reason: "Not assuming Nick owns this yet.",
    queued: [],
  });
  updateMemory({
    state: "ready",
    need: "Keep the demo from becoming a weekend project.",
    owner: "Nick may know the right Hexa path.",
    timing: "After Tech Europe",
    unknown: "Whether Nick is the owner or the bridge.",
    note: "Draft a soft note after the conversation.",
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
    evidence: [
      {
        id: "evidence_weekend_risk",
        speaker: "Camille",
        quote: "The real risk is that the demo dies after the weekend.",
      },
      {
        id: "evidence_hexa_path",
        speaker: "Camille",
        quote: "I’d talk to someone at Hexa.",
      },
      {
        id: "evidence_nick_contact",
        speaker: "Camille",
        quote: "Maybe Nick. I don’t know if he owns this exactly, but he’d know who does.",
      },
      {
        id: "evidence_soft_note",
        speaker: "Camille",
        quote:
          "Say you tested it live at Tech Europe and want to know whether this helps founders avoid losing useful conversations after events.",
      },
    ],
    visible_cues: [
      {
        cue: "They named the real risk. Ask who would care enough to try this next week.",
        not_inferred: "Not assuming anyone has agreed to help yet.",
        confidence: "high",
        evidence_ids: ["evidence_weekend_risk"],
      },
      {
        cue: "Nick may know the path. Ask for the best contact route before drafting anything.",
        not_inferred: "Not assuming Nick owns this yet.",
        confidence: "medium",
        evidence_ids: ["evidence_nick_contact"],
      },
    ],
    memory: {
      what_they_said: els.needText.textContent,
      who_seems_closest_to_it: els.ownerText.textContent,
      when_it_matters: els.timingText.textContent,
      still_unknown: els.unknownText.textContent,
      next_thing_to_do: "Draft a soft follow-up note to Nick.",
    },
    pioneer_proof: pioneerProof,
  };
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
  preloadDemoSpeech();

  timeline.transcript.forEach((line) => {
    timers.push(
      window.setTimeout(() => {
        speakDemoLine(line);
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
  timeline.transcript.slice(0, 3).forEach(addTranscript);
  showBeat1();
  els.demoClock.textContent = "01:15";
}

function jumpToBeat2() {
  resetDemo();
  setSessionActive(true);
  showSession();
  timeline.transcript.forEach(addTranscript);
  showBeat2();
  els.demoClock.textContent = "02:55";
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
    addLiveTranscript(transcript, { render: false });
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
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
  queueLiveDraftPlanner();
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
        speaker: "Heard",
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
