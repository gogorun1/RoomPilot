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
let livePeer = null;
let liveStream = null;
let liveDataChannel = null;
let liveDraftLine = null;
let liveAttemptId = 0;
let liveAudioContext = null;
let liveAudioLevelTimer = null;
let lastLiveAudioLevel = 0;
let lastTranscriptAt = 0;
let fallbackRecorder = null;
let fallbackSegmentTimer = null;
let fallbackTranscribeInFlight = false;
let fallbackPendingBlob = null;
let lastFallbackTranscript = "";

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
        id: "evidence_event_followup",
        speaker: "Today's speaker",
        quote: "Our event leads are hard to follow up consistently.",
      },
      {
        id: "evidence_q3_owner",
        speaker: "Today's speaker",
        quote: "Head of Growth owns it. They want something before the Q3 event push.",
      },
      {
        id: "evidence_sarah_prior",
        speaker: "Sarah, Station F",
        quote: "We're evaluating tools for event follow-up this quarter.",
      },
    ],
    visible_cues: [
      {
        cue: "They described a follow-up problem, but not who feels it most. Ask who has to deal with this after the event.",
        not_inferred: "They have not named who decides yet.",
        confidence: "high",
        evidence_ids: ["evidence_event_followup"],
      },
      {
        cue: "Sarah described the same follow-up problem yesterday. Worth asking if they want to compare notes.",
        not_inferred: "This only links the two quotes. It does not assume they know each other.",
        confidence: "medium",
        evidence_ids: ["evidence_event_followup", "evidence_sarah_prior"],
      },
    ],
    memory: {
      what_they_said: els.needText.textContent,
      who_seems_closest_to_it: els.ownerText.textContent,
      when_it_matters: els.timingText.textContent,
      still_unknown: els.unknownText.textContent,
      next_thing_to_do: "Ask if they want to compare notes with Sarah.",
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
    liveStream
      .getAudioTracks()
      .forEach((track) =>
        livePeer.addTransceiver(track, {
          direction: "sendonly",
          streams: [liveStream],
        })
      );
    liveDataChannel = livePeer.createDataChannel("oai-events");
    liveDataChannel.addEventListener("open", () => {
      lastTranscriptAt = Date.now();
      describeLiveState("Listening. Speak, then pause.");
    });
    liveDataChannel.addEventListener("message", handleRealtimeMessage);
    liveDataChannel.addEventListener("error", () => {
      setLiveStatus("Realtime event channel failed. Use Replay.", "error");
    });
    startAudioLevelMonitor(liveStream);
    startFallbackTranscriber(liveStream);

    const offer = await livePeer.createOffer();
    await livePeer.setLocalDescription(offer);

    const sdpResponse = await withTimeout(
      fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ephemeralKey}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
      }),
      12000,
      "Realtime connection took too long. Use Replay."
    );

    if (!sdpResponse.ok) {
      throw new Error(await sdpResponse.text());
    }

    await livePeer.setRemoteDescription({
      type: "answer",
      sdp: await sdpResponse.text(),
    });

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

function handleRealtimeMessage(message) {
  let event;

  try {
    event = JSON.parse(message.data);
  } catch {
    return;
  }

  console.debug("Realtime event", event.type, event);

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

  if (liveDraftLine) {
    liveDraftLine.classList.remove("is-live-draft");
    liveDraftLine.querySelector("p").textContent = transcript;
  } else {
    addTranscript({
      speaker: "Heard",
      text: transcript,
    });
  }

  liveDraftLine = null;
}

function isTranscriptionEvent(event) {
  return (
    event.type?.startsWith("conversation.item.input_audio_transcription.") ||
    event.type?.includes("input_audio_transcription") ||
    event.type?.includes("transcription")
  );
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
}

function startFallbackTranscriber(stream) {
  stopFallbackTranscriber();

  if (!window.MediaRecorder) {
    console.warn("MediaRecorder is not available in this browser.");
    return;
  }

  recordFallbackSegment(stream);
}

function recordFallbackSegment(stream) {
  if (!livePeer || !stream.active) return;

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

    if (!livePeer || attemptId !== liveAttemptId) return;

    const blob = new Blob(chunks, {
      type: recorder.mimeType || recorderOptions.mimeType || "audio/webm",
    });

    if (blob.size >= 1500) {
      setLiveStatus(`Captured audio ${Math.round(blob.size / 1024)}KB`, "active");
      transcribeFallbackChunk(blob);
    }

    fallbackSegmentTimer = window.setTimeout(() => {
      recordFallbackSegment(stream);
    }, 180);
  });

  recorder.addEventListener("error", () => {
    setLiveStatus("Browser recorder failed. Try Replay.", "error");
  });

  recorder.start();
  fallbackSegmentTimer = window.setTimeout(() => {
    if (recorder.state === "recording") {
      recorder.stop();
    }
  }, 3600);
}

function getRecorderOptions() {
  const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));

  return mimeType ? { mimeType } : {};
}

function stopFallbackTranscriber() {
  if (fallbackSegmentTimer) {
    window.clearTimeout(fallbackSegmentTimer);
    fallbackSegmentTimer = null;
  }

  if (fallbackRecorder && fallbackRecorder.state !== "inactive") {
    fallbackRecorder.stop();
  }

  fallbackRecorder = null;
  fallbackTranscribeInFlight = false;
  fallbackPendingBlob = null;
}

async function transcribeFallbackChunk(blob) {
  if (!livePeer) return;

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

    if (!livePeer || attemptId !== liveAttemptId) return;

    lastFallbackTranscript = text;
    lastTranscriptAt = Date.now();
    addTranscript({
      speaker: "Heard",
      text,
    });
    setLiveStatus("Transcript received", "active");
  } catch (error) {
    console.warn(error);
    setLiveStatus(error.message, "error");
  } finally {
    fallbackTranscribeInFlight = false;

    if (fallbackPendingBlob && livePeer && attemptId === liveAttemptId) {
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
