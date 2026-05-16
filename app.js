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
    person: "Today's speaker",
    company: "AI event team",
  },
};

const fallbackTimeline = {
  transcript: [
    {
      id: "t1",
      speaker: "You",
      text: "Tell me what usually happens after an event like this.",
      at: 4600,
    },
    {
      id: "t2",
      speaker: "Today's speaker",
      text: "Honestly, our event leads are hard to follow up consistently.",
      at: 7600,
      hero: true,
    },
    {
      id: "t3",
      speaker: "Today's speaker",
      text: "We meet useful people, but two weeks later nobody remembers who needed what.",
      at: 9800,
    },
    {
      id: "t4",
      speaker: "You",
      text: "Who has to deal with this after the event?",
      at: 17600,
    },
    {
      id: "t5",
      speaker: "Today's speaker",
      text: "Head of Growth owns it. They want something before the Q3 event push.",
      at: 21800,
      evidence: true,
    },
  ],
  events: [
    { type: "showSession", at: 2800 },
    { type: "beat1", at: 10800 },
    { type: "askQuestion", at: 16400 },
    { type: "escalateMemory", at: 24200 },
    { type: "beat2", at: 31000 },
    { type: "showFinalMemory", at: 38600 },
  ],
};

let seed = fallbackSeed;
let timeline = fallbackTimeline;
let timers = [];
let clockTimer = null;
let statusTimer = null;
let statusIndex = 0;
let demoStartedAt = null;

const statusMessages = [
  "Thinking through your next move",
  "Listening for openings",
  "Sorting the evidence",
  "Keeping the proof visible",
];

const els = {
  trustFrame: document.querySelector("#trustFrame"),
  demoGrid: document.querySelector("#demoGrid"),
  transcriptList: document.querySelector("#transcriptList"),
  demoClock: document.querySelector("#demoClock"),
  emptyCue: document.querySelector("#emptyCue"),
  beat1Cue: document.querySelector("#beat1Cue"),
  beat2Cue: document.querySelector("#beat2Cue"),
  evidenceCapture: document.querySelector("#evidenceCapture"),
  statusPills: document.querySelectorAll(".recording-toggle"),
  statusTexts: document.querySelectorAll(".status-text"),
  graphWrap: document.querySelector(".graph-wrap"),
  memoryState: document.querySelector("#memoryState"),
  nextCard: document.querySelector("#nextCard"),
  needText: document.querySelector("#needText"),
  ownerText: document.querySelector("#ownerText"),
  timingText: document.querySelector("#timingText"),
  unknownText: document.querySelector("#unknownText"),
  noteText: document.querySelector("#noteText"),
  startDemo: document.querySelector("#startDemo"),
  startDemoHero: document.querySelector("#startDemoHero"),
  resetDemo: document.querySelector("#resetDemo"),
  jumpBeat1: document.querySelector("#jumpBeat1"),
  jumpBeat2: document.querySelector("#jumpBeat2"),
  stopSession: document.querySelector("#stopSession"),
};

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

function resetDemo() {
  clearTimers();
  demoStartedAt = null;
  els.demoClock.textContent = "00:00";
  els.transcriptList.innerHTML = "";
  setHidden(els.trustFrame, false);
  setHidden(els.demoGrid, true);
  setHidden(els.emptyCue, false);
  setHidden(els.beat1Cue, true);
  setHidden(els.beat2Cue, true);
  setHidden(els.evidenceCapture, true);
  setHidden(els.nextCard, true);
  setSessionActive(false);
  els.graphWrap.classList.remove("is-live", "is-bridge");
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
  els.graphWrap.classList.add("is-live");
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

  item.innerHTML = `
    <strong>${line.speaker}</strong>
    <p>${line.text}</p>
  `;

  els.transcriptList.appendChild(item);
  els.transcriptList.scrollTop = els.transcriptList.scrollHeight;
}

function updateMemory(next) {
  els.memoryState.textContent = next.state;
  els.needText.textContent = next.need;
  els.ownerText.textContent = next.owner;
  els.timingText.textContent = next.timing;
  els.unknownText.textContent = next.unknown;
  els.noteText.textContent = next.note;
}

function showBeat1() {
  setHidden(els.emptyCue, true);
  setHidden(els.beat2Cue, true);
  setHidden(els.beat1Cue, false);
  setHidden(els.evidenceCapture, true);
  updateMemory({
    state: "first quote",
    need: "Event leads are hard to follow up consistently.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who has to deal with this after the event.",
    note: "Wait for the next answer before claiming more.",
  });
}

function showAskQuestion() {
  updateMemory({
    state: "question asked",
    need: "Event leads are hard to follow up consistently.",
    owner: "Not named yet.",
    timing: "Not named yet.",
    unknown: "Who has to deal with this after the event.",
    note: "Asking the quiet question now.",
  });
}

function escalateMemory() {
  setHidden(els.evidenceCapture, false);
  updateMemory({
    state: "updated",
    need: "Event leads are hard to follow up consistently.",
    owner: "Head of Growth",
    timing: "Before Q3",
    unknown: "What they already tried last time.",
    note: "The card changed only after they named a person and timing.",
  });
}

function showBeat2() {
  setHidden(els.emptyCue, true);
  setHidden(els.beat1Cue, true);
  setHidden(els.evidenceCapture, true);
  setHidden(els.beat2Cue, false);
  setHidden(els.nextCard, false);
  els.graphWrap.classList.add("is-bridge");
  updateMemory({
    state: "two quotes",
    need: "Two people described the same follow-up problem.",
    owner: "Head of Growth for today's speaker.",
    timing: "Before Q3 for today's speaker.",
    unknown: "Whether they want to compare notes.",
    note: "Sarah mentioned the same problem yesterday.",
  });
}

function showFinalMemory() {
  setHidden(els.nextCard, false);
  updateMemory({
    state: "ready",
    need: "Event leads are hard to follow up consistently.",
    owner: "Head of Growth",
    timing: "Before Q3",
    unknown: "What they already tried last time.",
    note: "Sarah mentioned the same problem yesterday. Ask if they want to compare notes.",
  });
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

  timeline.events.forEach((event) => schedule(event.type, event.at));
  timeline.transcript.forEach((line) => {
    timers.push(window.setTimeout(() => addTranscript(line), line.at));
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

  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();

    if (key === "s") startDemo();
    if (key === "r") resetDemo();
    if (key === "1") jumpToBeat1();
    if (key === "2") jumpToBeat2();
  });
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
