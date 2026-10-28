// State
let totalSeconds = 25 * 60;
let remainingSeconds = 25 * 60;
let isRunning = false;
let timerInterval = null;
let soundEnabled = true;
let currentMode = "pomodoro";
let timerDeadline = null;
let hintTimeout = null;
let timerSessionId = null;
let preFinishCuePlayed = false;
let completionPending = false;
let currentTask = "";
let focusHistoryReady = false;
const taskCompletionEffects = new Map();
const queueFocusTargets = new Map();
let lastAnnouncedTimerState = "";
const TASK_QUEUE_KEY = "pomodoro-task-queue-v1";
const savedTaskQueue = readLocalData(TASK_QUEUE_KEY);
let taskQueue = validTaskQueue(savedTaskQueue);
let deletedQueueTasks = validDeletedTasks(savedTaskQueue?.deletedTasks);
let mobileLayoutActive = false;
let selectedTaskId = taskQueue.some(
  (task) => task.id === savedTaskQueue?.selectedTaskId && !task.done,
)
  ? savedTaskQueue.selectedTaskId
  : null;
if (selectedTaskId) {
  currentTask = taskQueue.find((task) => task.id === selectedTaskId).name;
  document.getElementById("currentTaskInput").value = currentTask;
}
const TIMER_STORAGE_KEY = "pomodoro-timer-state-v1";

// Tone.js Synths
let mechanicalClickSynth = null;
let popUpSynth = null;
let finishChimeSynth = null;
let rewardPopSynth = null;
let preFinishSynth = null;

function initAudio() {
  if (!mechanicalClickSynth && window.Tone) {
    // Heavy tactile push down click
    mechanicalClickSynth = new Tone.MembraneSynth({
      pitchDecay: 0.035,
      octaves: 3,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.09, sustain: 0, release: 0.06 },
    }).toDestination();
    mechanicalClickSynth.volume.value = -8;

    // Snappy spring pop-up release sound
    popUpSynth = new Tone.MembraneSynth({
      pitchDecay: 0.06,
      octaves: 2.2,
      oscillator: { type: "sine" },
      envelope: { attack: 0.002, decay: 0.12, sustain: 0, release: 0.08 },
    }).toDestination();
    popUpSynth.volume.value = -10;

    // Rounded, quiet notes leave space for the tactile landing sound.
    finishChimeSynth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.004, decay: 0.45, sustain: 0, release: 0.65 },
    }).toDestination();
    finishChimeSynth.volume.value = -18;

    rewardPopSynth = new Tone.MembraneSynth({
      pitchDecay: 0.012,
      octaves: 1.4,
      oscillator: { type: "sine" },
      envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.08 },
    }).toDestination();
    rewardPopSynth.volume.value = -17;

    preFinishSynth = new Tone.Synth({
      oscillator: { type: "sine" },
      envelope: { attack: 0.03, decay: 0.7, sustain: 0, release: 0.7 },
    }).toDestination();
    preFinishSynth.volume.value = -24;
  }
}

function playAudioFeedback(action) {
  if (!soundEnabled) return;
  try {
    if (window.Tone && Tone.context.state !== "running") {
      Tone.start();
    }
    initAudio();

    if (action === "preFinish" && preFinishSynth) {
      preFinishSynth.triggerAttackRelease("G5", "8n", Tone.now(), 0.35);
    } else if (action === "pushDown" && mechanicalClickSynth) {
      mechanicalClickSynth.triggerAttackRelease("D2", "16n");
    } else if (action === "popUp" && popUpSynth) {
      popUpSynth.triggerAttackRelease("A3", "16n");
    } else if (action === "rewardLaunch" && rewardPopSynth) {
      rewardPopSynth.triggerAttackRelease("C4", "64n", Tone.now(), 0.55);
    } else if (action === "taskComplete" && finishChimeSynth) {
      const now = Tone.now();
      if (rewardPopSynth)
        rewardPopSynth.triggerAttackRelease("G3", "64n", now, 0.35);
      finishChimeSynth.triggerAttackRelease("C5", "16n", now + 0.025, 0.45);
      finishChimeSynth.triggerAttackRelease("E5", "16n", now + 0.095, 0.4);
      finishChimeSynth.triggerAttackRelease("G5", "8n", now + 0.165, 0.3);
    } else if (
      (action === "rewardLand" || action === "finish") &&
      finishChimeSynth
    ) {
      const now = Tone.now();
      if (action === "rewardLand" && rewardPopSynth) {
        rewardPopSynth.triggerAttackRelease("G4", "64n", now, 0.4);
      }
      // A short rising reward, synchronized to the bead receiving the circle.
      finishChimeSynth.triggerAttackRelease("E5", "16n", now + 0.015, 0.55);
      finishChimeSynth.triggerAttackRelease("G5", "16n", now + 0.085, 0.45);
      finishChimeSynth.triggerAttackRelease("C6", "8n", now + 0.155, 0.35);
    }
  } catch (e) {}
}

function formatTime(secs) {
  const mins = Math.floor(secs / 60);
  const remainingSecs = secs % 60;
  const mm = mins < 10 ? "0" + mins : mins;
  const ss = remainingSecs < 10 ? "0" + remainingSecs : remainingSecs;
  return `${mm}:${ss}`;
}

function updateDisplay() {
  const display = document.getElementById("timeText");
  display.textContent = formatTime(remainingSeconds);
  const modeLabel = currentMode === "pomodoro" ? "Focus" : currentMode === "longBreak" ? "Long break" : "Short break";
  const action = completionPending ? "Retry saving completed session" : isRunning ? "Pause" : remainingSeconds < totalSeconds ? "Resume" : "Start";
  const dial = document.getElementById("timerButton");
  dial.setAttribute("aria-label", `${action} · ${modeLabel} · ${formatTime(remainingSeconds)} remaining`);
  dial.setAttribute("aria-pressed", String(isRunning));
  const mute = document.getElementById("muteToggle");
  mute.setAttribute("aria-label", soundEnabled ? "Mute timer sounds" : "Unmute timer sounds");
  mute.setAttribute("aria-pressed", String(!soundEnabled));
  const state = `${modeLabel} ${completionPending ? "completed; save pending" : isRunning ? "running" : remainingSeconds === totalSeconds ? "ready" : "paused"}`;
  if (state !== lastAnnouncedTimerState) {
    document.getElementById("timerA11yStatus").textContent = state;
    lastAnnouncedTimerState = state;
  }
  window.syncMiniTimer?.();
  document.title = isRunning
    ? `(${formatTime(remainingSeconds)}) Running...`
    : "Neumorphic Pomodoro Timer";
}

function showHint(text) {
  const annotation = document.getElementById("annotationEl");
  document.getElementById("annotationLabel").textContent = text;
  annotation.classList.remove("is-hidden");
  clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => {
    annotation.classList.add("is-hidden");
  }, 3000);
}

function setDialVisualState(pushed) {
  const dial = document.getElementById("timerButton");
  document
    .getElementById("plateElement")
    .classList.toggle("is-running", pushed);
  document
    .getElementById("breakMessage")
    .setAttribute("aria-hidden", String(currentMode === "pomodoro" || pushed));

  if (pushed) {
    // Pushed down into socket
    dial.classList.add("is-pushed");
    showHint("Push to pause");
  } else {
    // Popped back out / raised
    dial.classList.remove("is-pushed");
    showHint(
      remainingSeconds === totalSeconds ? "Push to start" : "Push to resume",
    );
  }
}

function newSessionId() {
  return (
    window.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`
  );
}

function saveTimerState() {
  window.syncMiniTimer?.();
  writeLocalData(TIMER_STORAGE_KEY, {
    version: 1,
    mode: currentMode,
    totalSeconds,
    remainingSeconds,
    running: isRunning,
    deadline: timerDeadline,
    sessionId: timerSessionId,
    preFinishCuePlayed,
    completionPending,
    soundEnabled,
    task: currentTask,
    taskId: selectedTaskId,
  });
}

function applyTimerVisuals() {
  const isBreak = currentMode !== "pomodoro";
  document.getElementById("plateElement").classList.toggle("is-break", isBreak);
  document.getElementById("modeShortBreak").hidden = !isBreak;
  document.getElementById("skipBreakButton").hidden = !isBreak;
  document.getElementById("modePomodoro").textContent =
    `${currentMode === "pomodoro" ? totalSeconds / 60 : profile.focusMinutes}m`;
  document.getElementById("modeShortBreak").textContent =
    `${currentMode === "longBreak" ? "Long break" : "Short break"} · ${totalSeconds / 60}m`;
  document.getElementById("breakMessage").textContent =
    currentMode === "longBreak" ? "Take a longer break" : "Take a break";
  document.getElementById("modePomodoro").classList.toggle("active", !isBreak);
  document.getElementById("modeShortBreak").classList.toggle("active", isBreak);
  document.getElementById("muteToggle").textContent = soundEnabled
    ? "🔊"
    : "🔇";
  updateDisplay();
  setDialVisualState(isRunning);
  renderTaskQueue();
}

function finishTimer(notify = true) {
  ensureGoalDay();
  const finishedPomodoro = currentMode === "pomodoro";
  const pendingIndex = profile.goalChecks.findIndex(
    (checked, index) => index < profile.dailyGoal && !checked,
  );
  let rewardIndex = pendingIndex;
  if (rewardIndex < 0) {
    rewardIndex =
      Array.from({ length: profile.dailyGoal }, (_, i) => i).find(
        (i) => !profile.goalChecks[i],
      ) ?? profile.dailyGoal - 1;
  }
  const seconds = totalSeconds;
  const endedAt = timerDeadline || Date.now();
  const sessionId = timerSessionId;
  clearInterval(timerInterval);
  timerInterval = null;
  isRunning = false;
  remainingSeconds = 0;
  // An immutable session ID makes recovery idempotent if interrupted here.
  if (finishedPomodoro && !recordFocusedSession(
      seconds,
      sessionId,
      endedAt,
      selectedTaskId || profile.showCurrentTask ? currentTask : "",
      selectedTaskId,
    )) {
    completionPending = true;
    saveTimerState();
    updateDisplay();
    setDialVisualState(false);
    showHint("Session not saved. Free browser storage, then press to retry.");
    return;
  }
  completionPending = false;
  const completedInHistory =
    focusHistory.entries.findIndex((entry) => entry.id === sessionId) + 1;
  const nextMode = finishedPomodoro
    ? completedInHistory > 0 &&
      completedInHistory % profile.longBreakInterval === 0
      ? "longBreak"
      : "break"
    : "pomodoro";
  setMode(nextMode);
  if (notify) sendSessionNotification(finishedPomodoro, nextMode, sessionId);
  if (notify && !finishedPomodoro) playAudioFeedback("finish");
  showHint(
    finishedPomodoro
      ? currentMode === "longBreak"
        ? "Push for a long break"
        : "Push to start break"
      : "Push for a new session",
  );
  if (notify && finishedPomodoro && !document.hidden)
    animateSessionToGoal(rewardIndex);
  const autoStart = finishedPomodoro
    ? profile.autoStartBreaks
    : profile.autoStartFocus;
  if (notify && autoStart) handleDialPress();
}

function tickTimer(notify = true) {
  if (!isRunning) return;
  const previousSeconds = remainingSeconds;
  remainingSeconds = Math.max(
    0,
    Math.ceil((timerDeadline - Date.now()) / 1000),
  );
  if (currentMode === "pomodoro" && totalSeconds > 60 && !preFinishCuePlayed &&
      previousSeconds > 60 && remainingSeconds <= 60) {
    // Consume the boundary even when muted, disabled, or restoring a closed tab.
    preFinishCuePlayed = true;
    saveTimerState();
    // Small scheduling delays are fine; never play a stale cue near the finish.
    if (notify && remainingSeconds >= 55 && profile.preFinishCue)
      playAudioFeedback("preFinish");
  }
  if (remainingSeconds === 0) {
    // A suspended page can wake hours after its deadline. Credit that session,
    // but do not replay old alerts or start a fresh cycle while the user is away.
    const recentlyFinished = Date.now() - timerDeadline <= 60_000;
    finishTimer(notify && recentlyFinished);
  }
  else updateDisplay();
}

function handleDialPress() {
  if (window.PomodoroStorageSafety?.blocked) return;
  if (completionPending) { finishTimer(false); return; }
  if (isRunning) {
    pauseTimer();
    return;
  }
  if (remainingSeconds <= 0) remainingSeconds = totalSeconds;
  if (!timerSessionId) { timerSessionId = newSessionId(); preFinishCuePlayed = false; }
  timerDeadline = Date.now() + remainingSeconds * 1000;
  isRunning = true;
  applyTimerVisuals();
  saveTimerState();
  playAudioFeedback("pushDown");
  clearInterval(timerInterval);
  timerInterval = setInterval(tickTimer, 250);
}

function pauseTimer() {
  if (!isRunning) return;
  tickTimer();
  if (!isRunning) return;
  clearInterval(timerInterval);
  timerInterval = null;
  timerDeadline = null;
  isRunning = false;
  applyTimerVisuals();
  saveTimerState();
  playAudioFeedback("popUp");
}

function resetTimer() {
  if (window.PomodoroStorageSafety?.blocked) return;
  if (completionPending) { finishTimer(false); return; }
  clearInterval(timerInterval);
  timerInterval = null;
  isRunning = false;
  timerDeadline = null;
  timerSessionId = null;
  preFinishCuePlayed = false;
  totalSeconds = configuredDuration(currentMode);
  remainingSeconds = totalSeconds;
  applyTimerVisuals();
  saveTimerState();
  showHint("Push to start");
}

function configuredDuration(mode) {
  if (mode === "longBreak") return profile.longBreakMinutes * 60;
  if (mode === "break") return profile.shortBreakMinutes * 60;
  return profile.focusMinutes * 60;
}

function setMode(mode) {
  if (window.PomodoroStorageSafety?.blocked) return;
  if (completionPending) {
    showHint("Save your finished session first. Press the timer to retry.");
    return;
  }
  clearInterval(timerInterval);
  timerInterval = null;
  isRunning = false;
  timerDeadline = null;
  timerSessionId = null;
  preFinishCuePlayed = false;
  currentMode =
    mode === "longBreak"
      ? "longBreak"
      : mode === "break" || mode === 5
        ? "break"
        : "pomodoro";
  totalSeconds = configuredDuration(currentMode);
  remainingSeconds = totalSeconds;
  applyTimerVisuals();
  saveTimerState();
}

function skipBreak() {
  if (currentMode === "pomodoro") return;
  setMode("pomodoro");
  handleDialPress();
}

function toggleAudio() {
  soundEnabled = !soundEnabled;
  document.getElementById("muteToggle").textContent = soundEnabled
    ? "🔊"
    : "🔇";
  saveTimerState();
  updateDisplay();
}

function restoreTimerState() {
  const saved = readLocalData(TIMER_STORAGE_KEY);
  if (
    !saved ||
    saved.version !== 1 ||
    !["pomodoro", "break", "longBreak"].includes(saved.mode)
  )
    return false;
  const expected = saved.totalSeconds;
  if (
    !Number.isInteger(expected) ||
    expected < 60 ||
    expected > 10800 ||
    expected % 60 !== 0
  )
    return false;
  if (
    saved.totalSeconds !== expected ||
    !Number.isInteger(saved.remainingSeconds) ||
    saved.remainingSeconds < 0 ||
    saved.remainingSeconds > expected ||
    typeof saved.running !== "boolean"
  )
    return false;
  if (
    saved.running &&
    (!Number.isFinite(saved.deadline) ||
      saved.deadline <= 0 ||
      saved.deadline > Date.now() + expected * 1000 + 1000 ||
      typeof saved.sessionId !== "string" ||
      !saved.sessionId)
  )
    return false;
  clearInterval(timerInterval);
  timerInterval = null;
  currentTask = typeof saved.task === "string" ? saved.task.slice(0, 120) : "";
  selectedTaskId =
    typeof saved.taskId === "string" &&
    taskQueue.some((task) => task.id === saved.taskId && !task.done)
      ? saved.taskId
      : null;
  document.getElementById("currentTaskInput").value = currentTask;
  currentMode = saved.mode;
  totalSeconds = expected;
  remainingSeconds = saved.remainingSeconds;
  isRunning = saved.running;
  timerDeadline = isRunning || saved.completionPending === true ? saved.deadline : null;
  timerSessionId = typeof saved.sessionId === "string" ? saved.sessionId : null;
  preFinishCuePlayed = saved.preFinishCuePlayed === true;
  completionPending = saved.completionPending === true &&
    remainingSeconds === 0 && Boolean(timerSessionId) && currentMode === "pomodoro";
  if (typeof saved.soundEnabled === "boolean")
    soundEnabled = saved.soundEnabled;
  if (completionPending) finishTimer(false);
  else if (isRunning) {
    tickTimer(false);
    if (isRunning) timerInterval = setInterval(tickTimer, 250);
  }
  applyTimerVisuals();
  return true;
}

document
  .getElementById("currentTaskInput")
  .addEventListener("input", (event) => {
    if (completionPending) {
      event.target.value = currentTask;
      showHint("Save your finished session first. Press the timer to retry.");
      return;
    }
    currentTask = event.target.value.slice(0, 120);
    // Editing switches to a free-form label; keep the original queued task.
    if (selectedTaskId) {
      selectedTaskId = null;
      saveTaskQueue();
      renderTaskQueue();
    }
    saveTimerState();
  });

// Initial load
updateDisplay();
showHint("Push to start");

// Let the heading quietly disappear after the first introduction.
setTimeout(() => {
  document.querySelector(".stage-wrapper").classList.add("title-is-quiet");
}, 3500);

// Sidebar interactions from the provided design.

function selectDate(cell) {
  if (!cell.dataset.date) return;
  selectedHistoryDay = cell.dataset.date;
  document.querySelectorAll("#calendarDays .cal-day-cell").forEach((day) => {
    const selected = day.dataset.date === selectedHistoryDay;
    day.classList.toggle("active-date", selected);
    day.setAttribute("aria-pressed", String(selected));
    day.tabIndex = selected ? 0 : -1;
  });
  playAudioFeedback("popUp");
}

const sidebarShell = document.getElementById("sidebarShell");
const sidebarToggle = document.getElementById("sidebarToggle");
const sidebarPanel = document.getElementById("sidebarPanel");
let sidebarCloseTimeout = null;
let sidebarFocusTimeout = null;
let sidebarPointerInside = false;

function setSidebarOpen(open) {
  clearTimeout(sidebarCloseTimeout);
  if (!open) hideHistoryPopup();
  sidebarShell.classList.toggle("is-open", open);
  sidebarToggle.setAttribute("aria-expanded", String(open));
  sidebarToggle.setAttribute(
    "aria-label",
    isMobileLayout()
      ? open
        ? "Hide cards"
        : "Show cards"
      : open
        ? "Hide goals and calendar"
        : "Show goals and calendar",
  );
  sidebarPanel.setAttribute("aria-hidden", String(!open));
  sidebarPanel.inert = !open;
}

sidebarShell.addEventListener("pointerenter", (event) => {
  if (event.pointerType === "touch" || isMobileLayout()) return;
  sidebarPointerInside = true;
  setSidebarOpen(true);
});
sidebarShell.addEventListener("pointerleave", (event) => {
  if (event.pointerType === "touch" || isMobileLayout()) return;
  sidebarPointerInside = false;
  sidebarCloseTimeout = setTimeout(() => {
    if (!sidebarPanel.contains(document.activeElement)) setSidebarOpen(false);
  }, 180);
});
sidebarToggle.addEventListener("click", () => {
  setSidebarOpen(sidebarToggle.getAttribute("aria-expanded") !== "true");
});
sidebarShell.addEventListener("focusout", () => {
  clearTimeout(sidebarFocusTimeout);
  // Rebuilding a focused row/date temporarily blurs the removed node. Let the
  // replacement receive focus before deciding whether the user left the drawer.
  sidebarFocusTimeout = setTimeout(() => {
    if (!sidebarShell.contains(document.activeElement) && !sidebarPointerInside)
      setSidebarOpen(false);
  }, 0);
});
sidebarShell.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!historyPopup.hidden) {
      hideHistoryPopup();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    sidebarToggle.focus();
    setSidebarOpen(false);
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!sidebarShell.contains(event.target)) setSidebarOpen(false);
});

// Detachable cards: drag by the heading, leaving the controls usable.
const floatingWidgets = new Set();
const widgetControllers = new Map();
const LAYOUT_STORAGE_KEY = "pomodoro-widget-layout-v1";
let savedWidgetLayout = readLocalData(LAYOUT_STORAGE_KEY) || {};

function saveWidgetLayout() {
  if (mobileLayoutActive || isMobileLayout()) return;
  const positions = {};
  floatingWidgets.forEach((widget) => {
    positions[widget.id] = {
      left: parseFloat(widget.style.left),
      top: parseFloat(widget.style.top),
    };
  });
  savedWidgetLayout = positions;
  writeLocalData(LAYOUT_STORAGE_KEY, positions);
}
function raiseWidget(widget) {
  if (!floatingWidgets.has(widget)) return;
  floatingWidgets.delete(widget);
  floatingWidgets.add(widget);
  floatingWidgets.forEach((card) => {
    card.style.zIndex = String(25 + Array.from(floatingWidgets).indexOf(card));
  });
  saveWidgetLayout();
}
function restoreWidgetLayout() {
  if (isMobileLayout()) return;
  const positions = savedWidgetLayout;
  // Saved insertion order follows the cards from back to front.
  Object.entries(positions).forEach(([id, point]) => {
    const controller = widgetControllers.get(id);
    if (
      controller &&
      point &&
      Number.isFinite(point.left) &&
      Number.isFinite(point.top)
    )
      controller.detach(point.left, point.top);
  });
}

document.getElementById("resetLayoutButton").addEventListener("click", () => {
  widgetControllers.forEach((controller) => controller.returnToSidebar());
  saveWidgetLayout();
  setSidebarOpen(true);
  document.getElementById("resetLayoutButton").focus();
  document.getElementById("layoutResetStatus").textContent =
    "All cards returned to the sidebar.";
});

function clampWidgetPosition(widget, left, top) {
  const margin = 12;
  const maxLeft = Math.max(
    margin,
    window.innerWidth - widget.offsetWidth - margin,
  );
  const maxTop = Math.max(
    margin,
    window.innerHeight - widget.offsetHeight - margin,
  );
  widget.style.left = `${Math.min(maxLeft, Math.max(margin, left))}px`;
  widget.style.top = `${Math.min(maxTop, Math.max(margin, top))}px`;
}

document.querySelectorAll(".movable-widget").forEach((widget) => {
  const handle = widget.querySelector(".widget-drag-handle");
  const returnButton = widget.querySelector(".widget-return");
  let placeholder = null;
  let drag = null;

  function detach(left, top) {
    if (floatingWidgets.has(widget)) return;
    const width = widget.offsetWidth;
    placeholder = document.createElement("button");
    placeholder.type = "button";
    placeholder.className = "widget-placeholder";
    placeholder.textContent = `↶ Return ${widget.dataset.widgetName}`;
    placeholder.addEventListener("click", returnToSidebar);
    widget.before(placeholder);
    document.body.appendChild(widget);
    widget.classList.add("is-floating");
    widget.style.width = `${width}px`;
    floatingWidgets.add(widget);
    raiseWidget(widget);
    clampWidgetPosition(widget, left, top);
    setSidebarOpen(false);
    saveWidgetLayout();
  }

  function returnToSidebar() {
    if (!floatingWidgets.has(widget)) return;
    widget.classList.remove("is-floating", "is-dragging");
    ["left", "top", "width", "z-index", "zIndex"].forEach((property) =>
      widget.style.removeProperty(property),
    );
    placeholder.replaceWith(widget);
    placeholder = null;
    floatingWidgets.delete(widget);
    saveWidgetLayout();
    if (sidebarToggle.getAttribute("aria-expanded") === "true") handle.focus();
    else sidebarToggle.focus();
  }

  widget.addEventListener("pointerdown", (event) => {
    if (event.button === 0) raiseWidget(widget);
  });
  widget.addEventListener("focusin", () => raiseWidget(widget));
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || isMobileLayout()) return;
    const rect = widget.getBoundingClientRect();
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      moved: false,
    };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    if (
      !drag.moved &&
      Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4
    )
      return;
    if (!drag.moved) {
      drag.moved = true;
      detach(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
      handle.setPointerCapture(event.pointerId);
      widget.classList.add("is-dragging");
    }
    clampWidgetPosition(
      widget,
      event.clientX - drag.offsetX,
      event.clientY - drag.offsetY,
    );
  });
  function endDrag(event) {
    if (!drag || drag.id !== event.pointerId) return;
    widget.classList.remove("is-dragging");
    if (drag.moved) saveWidgetLayout();
    drag = null;
    if (handle.hasPointerCapture(event.pointerId))
      handle.releasePointerCapture(event.pointerId);
  }
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  handle.addEventListener("click", () => {
    if (isMobileLayout()) return;
    if (floatingWidgets.has(widget)) {
      raiseWidget(widget);
      return;
    }
    const timer = document
      .getElementById("plateElement")
      .getBoundingClientRect();
    detach(timer.right + 32, timer.top);
    handle.focus();
  });
  handle.addEventListener("keydown", (event) => {
    if (!floatingWidgets.has(widget)) return;
    if (event.key === "Escape") {
      event.preventDefault();
      returnToSidebar();
      return;
    }
    const movement = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }[event.key];
    if (!movement) return;
    event.preventDefault();
    const step = event.shiftKey ? 30 : 10;
    clampWidgetPosition(
      widget,
      parseFloat(widget.style.left) + movement[0] * step,
      parseFloat(widget.style.top) + movement[1] * step,
    );
    saveWidgetLayout();
  });
  returnButton.addEventListener("click", returnToSidebar);
  widgetControllers.set(widget.id, { detach, returnToSidebar });
});
window.addEventListener("resize", () => {
  syncResponsiveLayout();
  if (isMobileLayout()) return;
  floatingWidgets.forEach((widget) =>
    clampWidgetPosition(
      widget,
      parseFloat(widget.style.left),
      parseFloat(widget.style.top),
    ),
  );
  saveWidgetLayout();
});

const BUILTIN_FOCUS_PRESETS = [
  { id: "study", name: "Study", focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakInterval: 4 },
  { id: "deep-work", name: "Deep Work", focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 30, longBreakInterval: 4 },
];
function validFocusPresets(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  return items.slice(0, 12).flatMap((item) => {
    if (!item || typeof item.id !== "string" || !item.id || item.id.length > 100 ||
      ["study", "deep-work"].includes(item.id) || seen.has(item.id) ||
      typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 30 ||
      !["focusMinutes", "shortBreakMinutes", "longBreakMinutes"].every((key) => Number.isInteger(item[key]) && item[key] >= 1 && item[key] <= 180) ||
      !Number.isInteger(item.longBreakInterval) || item.longBreakInterval < 1 || item.longBreakInterval > 12) return [];
    seen.add(item.id);
    return [{ id: item.id, name: item.name.trim(), focusMinutes: item.focusMinutes,
      shortBreakMinutes: item.shortBreakMinutes, longBreakMinutes: item.longBreakMinutes,
      longBreakInterval: item.longBreakInterval }];
  });
}
const PROFILE_STORAGE_KEY = "pomodoro-local-profile";
let profile = {
  name: "Guest",
  role: "",
  joined: new Date().getFullYear(),
  photo: "",
  focusedSeconds: 0,
  dailyGoal: 6,
  goalDay: "",
  goalChecks: [],
  focusPresets: [],
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  showCurrentTask: true,
  longBreakInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  preFinishCue: false,
  desktopNotifications: false,
};
try {
  const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY));
  if (saved && typeof saved.name === "string" && saved.name.trim()) {
    profile.name = saved.name.slice(0, 50);
    profile.focusPresets = validFocusPresets(saved.focusPresets);
    for (const key of [
      "autoStartBreaks",
      "autoStartFocus",
      "preFinishCue",
      "desktopNotifications",
    ]) {
      if (typeof saved[key] === "boolean") profile[key] = saved[key];
    }
    if (
      Number.isInteger(saved.longBreakInterval) &&
      saved.longBreakInterval >= 1 &&
      saved.longBreakInterval <= 12
    )
      profile.longBreakInterval = saved.longBreakInterval;
    if (typeof saved.showCurrentTask === "boolean")
      profile.showCurrentTask = saved.showCurrentTask;
    if (typeof saved.role === "string") profile.role = saved.role.slice(0, 70);
    if (
      Number.isInteger(saved.joined) &&
      saved.joined > 2000 &&
      saved.joined <= new Date().getFullYear()
    )
      profile.joined = saved.joined;
    if (
      typeof saved.photo === "string" &&
      /^data:image\/(png|jpeg|webp);base64,/.test(saved.photo)
    )
      profile.photo = saved.photo;
    if (Number.isFinite(saved.focusedSeconds) && saved.focusedSeconds >= 0)
      profile.focusedSeconds = saved.focusedSeconds;
    if (
      Number.isInteger(saved.dailyGoal) &&
      saved.dailyGoal >= 1 &&
      saved.dailyGoal <= 99
    )
      profile.dailyGoal = saved.dailyGoal;
    if (typeof saved.goalDay === "string") profile.goalDay = saved.goalDay;
    if (Array.isArray(saved.goalChecks))
      profile.goalChecks = saved.goalChecks
        .slice(0, 99)
        .map((value) => value === true);
    for (const key of [
      "focusMinutes",
      "shortBreakMinutes",
      "longBreakMinutes",
    ]) {
      if (Number.isInteger(saved[key]) && saved[key] >= 1 && saved[key] <= 180)
        profile[key] = saved[key];
    }
  }
} catch (error) {
  /* Use defaults if browser storage is unavailable. */
}

function goalDayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}
function ensureGoalDay() {
  const today = goalDayKey();
  if (profile.goalDay !== today) {
    profile.goalDay = today;
    profile.goalChecks = [];
  }
}
function renderGoalBeads() {
  ensureGoalDay();
  if (focusHistoryReady) reconcileTodayGoal();
  const container = document.getElementById("goalBeadsContainer");
  const completed = profile.goalChecks.filter(Boolean).length;
  container.setAttribute(
    "aria-label",
    `Daily focus progress: ${completed} of ${profile.dailyGoal} sessions completed`,
  );
  container.replaceChildren();
  for (let i = 0; i < profile.dailyGoal; i++) {
    const bead = document.createElement("span");
    const active = Boolean(profile.goalChecks[i]);
    bead.className = active ? "goal-bead active" : "goal-bead";
    bead.dataset.sessionIndex = String(i);
    bead.setAttribute("role", "img");
    bead.setAttribute(
      "aria-label",
      `Focus session ${i + 1}: ${active ? "completed" : "not completed"}`,
    );
    container.appendChild(bead);
  }
}

function renderProfile() {
  document.getElementById("currentTaskArea").hidden = !profile.showCurrentTask;
  renderGoalBeads();
  document.getElementById("profileName").textContent = profile.name;
  document.getElementById("profileRole").textContent = profile.role;
  document.getElementById("profileJoined").textContent =
    `joined since ${profile.joined}`;
  const image = document.getElementById("profilePhoto");
  image.hidden = !profile.photo;
  document.getElementById("profilePlaceholder").hidden = Boolean(profile.photo);
  if (profile.photo) image.src = profile.photo;
  else image.removeAttribute("src");
  const minutes = Math.floor(profile.focusedSeconds / 60);
  const hours = Math.floor(minutes / 60);
  document.getElementById("profileFocus").textContent =
    `Total Focused: ${hours ? `${hours}h ${minutes % 60}m` : `${minutes} min`}`;
}
function recordFocusedSession(
  seconds,
  sessionId = newSessionId(),
  endedAt = Date.now(),
  task = currentTask,
  taskId = selectedTaskId,
) {
  const latest = validHistory(readLocalData(HISTORY_STORAGE_KEY));
  const persistedIds = new Set(latest?.entries.map((entry) => entry.id) || []);
  if (latest) {
    const savedIds = new Set(latest.entries.map((entry) => entry.id));
    const deletedIds = new Set(latest.deletedIds);
    // Preserve in-memory completions from earlier failed writes for export/retry.
    latest.entries.push(...focusHistory.entries.filter((entry) => !savedIds.has(entry.id) && !deletedIds.has(entry.id)));
    focusHistory = latest;
  }
  if (!focusHistory.deletedIds?.includes(sessionId) && !focusHistory.entries.some((entry) => entry.id === sessionId)) {
    focusHistory.entries.push({
      id: sessionId,
      seconds,
      endedAt,
      task: task.trim().slice(0, 120),
      taskId: typeof taskId === "string" ? taskId : null,
      day: localDateKey(new Date(endedAt)),
    });
    ensureGoalDay();
    if (localDateKey(new Date(endedAt)) === goalDayKey()) {
      for (let i = 0; i < profile.dailyGoal; i++) {
        if (!profile.goalChecks[i]) {
          profile.goalChecks[i] = true;
          break;
        }
      }
    }
  }
  // A completion must reach durable history before the next mode replaces it.
  const saved = focusHistory.entries.every((entry) => persistedIds.has(entry.id)) ||
    writeLocalData(HISTORY_STORAGE_KEY, focusHistory);
  syncFocusedTotal();
  if (saved) writeLocalData(PROFILE_STORAGE_KEY, profile);
  renderProfile();
  renderCalendar();
  return saved;
}

const profileDialog = document.getElementById("profileDialog");
const profileForm = document.getElementById("profileForm");
const profileNameInput = document.getElementById("profileNameInput");
const profileRoleInput = document.getElementById("profileRoleInput");
const dailyGoalInput = document.getElementById("dailyGoalInput");
const showCurrentTaskInput = document.getElementById("showCurrentTaskInput");
const durationInputs = {
  focusMinutes: document.getElementById("focusMinutesInput"),
  shortBreakMinutes: document.getElementById("shortBreakMinutesInput"),
  longBreakMinutes: document.getElementById("longBreakMinutesInput"),
};
const profilePhotoInput = document.getElementById("profilePhotoInput");
const profileStatus = document.getElementById("profileFormStatus");
const profilePanelNames = ["profile", "timer", "notifications", "backup"];
function setProfileTab(name, focusTab = false) {
  if (!profilePanelNames.includes(name)) return;
  for (const panel of profilePanelNames) {
    const selected = panel === name;
    const tab = document.getElementById(`profileTab-${panel}`);
    tab.setAttribute("aria-selected", String(selected));
    tab.setAttribute("tabindex", selected ? "0" : "-1");
    document.getElementById(`profilePanel-${panel}`).hidden = !selected;
  }
  document.getElementById("profilePanelScroll").scrollTop = 0;
  if (focusTab) document.getElementById(`profileTab-${name}`).focus();
}
for (const [index, name] of profilePanelNames.entries()) {
  const tab = document.getElementById(`profileTab-${name}`);
  tab.addEventListener("click", () => setProfileTab(name));
  tab.addEventListener("keydown", (event) => {
    let next;
    if (event.key === "ArrowRight")
      next = (index + 1) % profilePanelNames.length;
    if (event.key === "ArrowLeft")
      next = (index + profilePanelNames.length - 1) % profilePanelNames.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = profilePanelNames.length - 1;
    if (next !== undefined) {
      event.preventDefault();
      setProfileTab(profilePanelNames[next], true);
    }
  });
}
profileForm.addEventListener(
  "invalid",
  (event) => {
    const panel = profilePanelNames.find((name) =>
      document.getElementById(`profilePanel-${name}`).contains(event.target),
    );
    if (panel) setProfileTab(panel);
  },
  true,
);

let draftPhoto = "";
const longBreakIntervalInput = document.getElementById(
  "longBreakIntervalInput",
);
const autoStartBreaksInput = document.getElementById("autoStartBreaksInput");
const autoStartFocusInput = document.getElementById("autoStartFocusInput");
const preFinishCueInput = document.getElementById("preFinishCueInput");
const desktopNotificationsInput = document.getElementById(
  "desktopNotificationsInput",
);
const notificationSettingsStatus = document.getElementById(
  "notificationSettingsStatus",
);
const testNotificationButton = document.getElementById(
  "testNotificationButton",
);

function notificationsSupported() {
  return (
    typeof window.Notification === "function" &&
    window.isSecureContext !== false
  );
}
function updateNotificationSettings() {
  const supported = notificationsSupported();
  desktopNotificationsInput.disabled = !supported;
  const permission = supported ? window.Notification.permission : "unavailable";
  testNotificationButton.disabled =
    !desktopNotificationsInput.checked || permission !== "granted";
  notificationSettingsStatus.textContent = !supported
    ? "Desktop notifications need a supported browser on HTTPS or localhost."
    : permission === "denied"
      ? "Notifications are blocked. Allow them in your browser's site settings, then turn this on."
      : permission === "granted"
        ? "Permission granted. Save profile to apply your preference."
        : "Turn on to allow focus and break completion alerts.";
}
desktopNotificationsInput.addEventListener("change", async () => {
  if (desktopNotificationsInput.checked && notificationsSupported()) {
    try {
      const permission =
        window.Notification.permission === "default"
          ? await window.Notification.requestPermission()
          : window.Notification.permission;
      desktopNotificationsInput.checked = permission === "granted";
    } catch (_) {
      desktopNotificationsInput.checked = false;
    }
  }
  updateNotificationSettings();
});
longBreakIntervalInput.addEventListener("input", () =>
  longBreakIntervalInput.setCustomValidity(""),
);
function displayDesktopNotification(title, body, tag, isTest = false) {
  let deliveryTimeout;
  try {
    const notice = new window.Notification(title, {
      body,
      tag,
      silent: !soundEnabled,
    });
    if (isTest) {
      notificationSettingsStatus.textContent =
        "Waiting for the browser to display the test…";
      deliveryTimeout = setTimeout(() => {
        notificationSettingsStatus.textContent =
          "No display confirmation. Check macOS System Settings → Notifications → Google Chrome, and your Focus settings.";
      }, 6000);
      notice.onshow = () => {
        clearTimeout(deliveryTimeout);
        notificationSettingsStatus.textContent =
          "Browser reported the test displayed. If no banner appeared, check Chrome's macOS notification settings and Focus.";
      };
    }
    notice.onclick = () => {
      window.focus();
      notice.close();
    };
    notice.onerror = () => {
      clearTimeout(deliveryTimeout);
      notificationSettingsStatus.textContent =
        "Could not display the alert. Check browser and system notification settings.";
    };
    return true;
  } catch (_) {
    clearTimeout(deliveryTimeout);
    notificationSettingsStatus.textContent =
      "Desktop alerts are unavailable. Try a supported desktop browser.";
    return false;
  }
}
function sendSessionNotification(finishedFocus, nextMode, sessionId) {
  if (
    !profile.desktopNotifications ||
    !notificationsSupported() ||
    window.Notification.permission !== "granted"
  )
    return;
  const key = "pomodoro-last-notification-v1";
  if (sessionId && readLocalData(key) === sessionId) return;
  if (sessionId) writeLocalData(key, sessionId);
  const title = finishedFocus ? "Focus session complete" : "Break finished";
  const body = finishedFocus
    ? `${nextMode === "longBreak" ? "Long break" : "Short break"} ${profile.autoStartBreaks ? "has started." : "is ready. Take a moment to recharge."}`
    : profile.autoStartFocus
      ? "Your next focus session has started."
      : "Ready for another focus session?";
  displayDesktopNotification(title, body, `pomodoro-session-${sessionId}`);
}
testNotificationButton.addEventListener("click", () => {
  if (
    !desktopNotificationsInput.checked ||
    !notificationsSupported() ||
    window.Notification.permission !== "granted"
  )
    return;
  displayDesktopNotification(
    "Pomodoro Timer",
    "Test successful. Your session alerts are working.",
    `pomodoro-notification-test-${Date.now()}`,
    true,
  );
});

document.getElementById("editProfileButton").addEventListener("click", () => {
  setProfileTab("profile");
  draftFocusPresets = profile.focusPresets.map((preset) => ({ ...preset }));
  presetNameInput.value = "";
  presetStatus.textContent = "";
  profileNameInput.value = profile.name;
  profileRoleInput.value = profile.role;
  dailyGoalInput.value = profile.dailyGoal;
  showCurrentTaskInput.checked = profile.showCurrentTask;
  longBreakIntervalInput.value = profile.longBreakInterval;
  longBreakIntervalInput.setCustomValidity("");
  autoStartBreaksInput.checked = profile.autoStartBreaks;
  autoStartFocusInput.checked = profile.autoStartFocus;
  preFinishCueInput.checked = profile.preFinishCue;
  document.getElementById("preFinishCueTestStatus").textContent = "";
  desktopNotificationsInput.checked =
    profile.desktopNotifications &&
    notificationsSupported() &&
    window.Notification.permission === "granted";
  updateNotificationSettings();
  for (const [key, input] of Object.entries(durationInputs)) {
    input.value = profile[key];
    input.setCustomValidity("");
  }
  renderFocusPresetPicker();
  dailyGoalInput.setCustomValidity("");
  profilePhotoInput.value = "";
  profileNameInput.setCustomValidity("");
  profileStatus.textContent = "";
  draftPhoto = profile.photo;
  profileDialog.showModal();
  profileNameInput.focus();
});
document
  .getElementById("cancelProfile")
  .addEventListener("click", () => profileDialog.close());
profileDialog.addEventListener("close", () => {
  if (sidebarPanel.contains(document.getElementById("profileWidget")))
    setSidebarOpen(true);
  document.getElementById("editProfileButton").focus();
});
profileNameInput.addEventListener("input", () =>
  profileNameInput.setCustomValidity(""),
);
dailyGoalInput.addEventListener("input", () =>
  dailyGoalInput.setCustomValidity(""),
);
Object.values(durationInputs).forEach((input) =>
  input.addEventListener("input", () => input.setCustomValidity("")),
);
document.getElementById("removeProfilePhoto").addEventListener("click", () => {
  draftPhoto = "";
  profilePhotoInput.value = "";
  profileStatus.textContent = "Default avatar selected. Save to apply.";
});
profilePhotoInput.addEventListener("change", () => {
  const file = profilePhotoInput.files[0];
  if (!file) return;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  ) {
    profileStatus.textContent = "Choose a PNG, JPG or WebP under 2 MB.";
    profilePhotoInput.value = "";
    return;
  }
  const saveButton = document.getElementById("saveProfileButton");
  saveButton.disabled = true;
  const reader = new FileReader();
  reader.onload = () => {
    draftPhoto = reader.result;
    profileStatus.textContent = "Photo selected. Save to apply.";
    saveButton.disabled = false;
  };
  reader.onerror = () => {
    profileStatus.textContent = "Could not read that photo. Try another.";
    saveButton.disabled = false;
  };
  reader.readAsDataURL(file);
});
profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = profileNameInput.value.trim() || "Guest";
  const dailyGoal = Number(dailyGoalInput.value);
  if (!Number.isInteger(dailyGoal) || dailyGoal < 1 || dailyGoal > 99) {
    dailyGoalInput.setCustomValidity("Choose a whole number from 1 to 99.");
    dailyGoalInput.reportValidity();
    return;
  }
  const durations = {};
  for (const [key, input] of Object.entries(durationInputs)) {
    const minutes = Number(input.value);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 180) {
      input.setCustomValidity("Choose whole minutes from 1 to 180.");
      input.reportValidity();
      return;
    }
    durations[key] = minutes;
  }
  const longBreakInterval = Number(longBreakIntervalInput.value);
  if (
    !Number.isInteger(longBreakInterval) ||
    longBreakInterval < 1 ||
    longBreakInterval > 12
  ) {
    longBreakIntervalInput.setCustomValidity(
      "Choose a whole number from 1 to 12.",
    );
    longBreakIntervalInput.reportValidity();
    return;
  }
  ensureGoalDay();
  const updated = {
    ...profile,
    name,
    role: profileRoleInput.value.trim(),
    photo: draftPhoto,
    dailyGoal,
    showCurrentTask: showCurrentTaskInput.checked,
    longBreakInterval,
    autoStartBreaks: autoStartBreaksInput.checked,
    autoStartFocus: autoStartFocusInput.checked,
    preFinishCue: preFinishCueInput.checked,
    desktopNotifications:
      desktopNotificationsInput.checked &&
      notificationsSupported() &&
      window.Notification.permission === "granted",
    ...durations,
    focusPresets: draftFocusPresets.map((preset) => ({ ...preset })),
  };
  try {
    if (!writeLocalData(PROFILE_STORAGE_KEY, updated)) throw new Error("storage");
  } catch (error) {
    profileStatus.textContent =
      "Could not save on this browser. Try a smaller photo or allow browser storage.";
    return;
  }
  const refreshIdleTimer = !isRunning && remainingSeconds === totalSeconds;
  profile = updated;
  renderProfile();
  if (refreshIdleTimer) setMode(currentMode);
  profileDialog.close();
});
renderProfile();

const avatarUploadButton = document.getElementById("avatarUploadButton");
const avatarUploadInput = document.getElementById("avatarUploadInput");
const avatarUploadStatus = document.getElementById("avatarUploadStatus");

avatarUploadButton.addEventListener("click", () => {
  avatarUploadStatus.hidden = true;
  avatarUploadInput.value = "";
  avatarUploadInput.click();
});
avatarUploadInput.addEventListener("change", async () => {
  const file = avatarUploadInput.files[0];
  if (!file) return;
  avatarUploadStatus.hidden = false;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 2 * 1024 * 1024
  ) {
    avatarUploadStatus.textContent = "Choose a PNG, JPG or WebP under 2 MB.";
    return;
  }
  avatarUploadButton.disabled = true;
  avatarUploadStatus.textContent = "Saving photo…";
  try {
    const photo = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("read"));
      reader.readAsDataURL(file);
    });
    const image = new Image();
    image.src = photo;
    try {
      await image.decode();
    } catch (error) {
      throw new Error("image");
    }
    const updated = { ...profile, photo };
    try {
      if (!writeLocalData(PROFILE_STORAGE_KEY, updated)) throw new Error("storage");
    } catch (error) {
      throw new Error("storage");
    }
    profile = updated;
    renderProfile();
    avatarUploadStatus.textContent = "Photo saved";
  } catch (error) {
    avatarUploadStatus.textContent =
      error.message === "storage"
        ? "Could not save. Try a smaller photo or allow browser storage."
        : "Could not open this image. Try another photo.";
  } finally {
    avatarUploadButton.disabled = false;
  }
});

setInterval(() => {
  if (profile.goalDay !== goalDayKey()) {
    renderGoalBeads();
    try {
      writeLocalData(PROFILE_STORAGE_KEY, profile);
    } catch (error) {}
  }
}, 60000);

function readLocalData(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch (error) {
    if (!(error instanceof SyntaxError)) showStorageNotice();
    return null;
  }
}
function writeLocalData(key, value) {
  if (window.PomodoroStorageSafety?.blocked) return false;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    showStorageNotice();
    return false;
  }
}
window.pausePomodoroForRecovery = () => {
  clearInterval(timerInterval);
  timerInterval = null;
  isRunning = false;
};
function showStorageNotice() {
  const notice = document.getElementById("persistenceStatus");
  notice.hidden = false;
  notice.textContent =
    "Browser storage unavailable. Changes may last only for this visit.";
}
function localDateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}
const HISTORY_STORAGE_KEY = "pomodoro-focus-history-v1";
function validHistoryEntry(entry) {
  if (!entry || typeof entry.id !== "string" || !entry.id ||
      !Number.isFinite(entry.seconds) || entry.seconds <= 0 || entry.seconds > 86400 ||
      !Number.isFinite(entry.endedAt) || !Number.isFinite(new Date(entry.endedAt).getTime())) return null;
  return {
    id: entry.id, seconds: entry.seconds, endedAt: entry.endedAt,
    task: typeof entry.task === "string" ? entry.task.slice(0, 120) : "",
    taskId: typeof entry.taskId === "string" ? entry.taskId.slice(0, 100) : null,
    day: localDateKey(new Date(entry.endedAt)),
  };
}
function validHistory(value) {
  if (
    !value ||
    value.version !== 1 ||
    !Number.isFinite(value.baselineSeconds) ||
    value.baselineSeconds < 0 ||
    !Array.isArray(value.entries)
  )
    return null;
  const deletedIds = value.deletedIds ?? [];
  const undo = value.undo ?? [];
  if (!Array.isArray(deletedIds) || deletedIds.length > 50000 ||
      deletedIds.some((id) => typeof id !== "string" || !id) ||
      new Set(deletedIds).size !== deletedIds.length || !Array.isArray(undo) || undo.length > 20) return null;
  const changes = [];
  for (const change of undo) {
    const before = validHistoryEntry(change?.before);
    if (!before || !["edit", "delete"].includes(change.type) ||
        !Number.isInteger(change.index) || change.index < 0) return null;
    changes.push({ type: change.type, before, index: change.index });
  }
  const deleted = new Set(deletedIds);
  const ids = new Set();
  const entries = [];
  for (const entry of value.entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      ids.has(entry.id) || deleted.has(entry.id) ||
      !Number.isFinite(entry.seconds) ||
      entry.seconds <= 0 ||
      entry.seconds > 86400 ||
      !Number.isFinite(entry.endedAt) ||
      !Number.isFinite(new Date(entry.endedAt).getTime())
    )
      continue;
    ids.add(entry.id);
    entries.push({
      id: entry.id,
      seconds: entry.seconds,
      endedAt: entry.endedAt,
      task: typeof entry.task === "string" ? entry.task.slice(0, 120) : "",
      taskId:
        typeof entry.taskId === "string" ? entry.taskId.slice(0, 100) : null,
      day: localDateKey(new Date(entry.endedAt)),
    });
  }
  return { version: 1, baselineSeconds: value.baselineSeconds, entries, deletedIds: [...deletedIds], undo: changes };
}

function changeSessionHistory(operation, id, task = "", taskId = null) {
  if (completionPending || window.PomodoroStorageSafety?.blocked)
    return { ok: false, message: "Save your finished session before changing history." };
  const next = validHistory(readLocalData(HISTORY_STORAGE_KEY));
  if (!next) return { ok: false, message: "Could not read saved history. No changes were made." };
  if (operation === "undo") {
    const change = next.undo.pop();
    if (!change) return { ok: false, message: "No history changes to undo." };
    const existing = next.entries.findIndex((entry) => entry.id === change.before.id);
    if (change.type === "edit") {
      if (existing < 0) return { ok: false, message: "This session is no longer available to undo." };
      next.entries[existing] = change.before;
    } else {
      if (existing >= 0) return { ok: false, message: "This session has already been restored." };
      next.entries.splice(Math.min(change.index, next.entries.length), 0, change.before);
      next.deletedIds = next.deletedIds.filter((key) => key !== change.before.id);
    }
  } else {
    const index = next.entries.findIndex((entry) => entry.id === id);
    if (index < 0) return { ok: false, message: "This session is no longer available." };
    const before = { ...next.entries[index] };
    if (id === timerSessionId) return { ok: false, message: "Finish the current timer before changing this session." };
    if (operation === "edit") {
      if (typeof task !== "string" || task.length > 120)
        return { ok: false, message: "Use a task label of up to 120 characters." };
      if (taskId !== null && !taskQueue.some((item) => item.id === taskId) && taskId !== before.taskId)
        return { ok: false, message: "Choose an available task or a custom label." };
      task = task.trim();
      if (before.task === task && before.taskId === taskId) return { ok: true, message: "No changes to save." };
      next.entries[index] = { ...before, task, taskId };
    } else if (operation === "delete") {
      if (next.deletedIds.length >= 50000) return { ok: false, message: "The history deletion limit has been reached. Export a backup before making further changes." };
      next.entries.splice(index, 1);
      next.deletedIds.push(id);
    } else return { ok: false, message: "Unknown history action." };
    next.undo.push({ type: operation, before, index });
    next.undo = next.undo.slice(-20);
  }
  if (!writeLocalData(HISTORY_STORAGE_KEY, next))
    return { ok: false, message: "Could not save history. Free browser storage and try again. No changes were made." };
  focusHistory = next;
  syncFocusedTotal();
  reconcileTodayGoal();
  writeLocalData(PROFILE_STORAGE_KEY, profile);
  renderProfile();
  renderCalendar();
  return { ok: true, message: operation === "delete" ? "Session deleted. Undo is available." : operation === "undo" ? "History change undone." : "Session updated. Undo is available." };
}
const historyPopup = document.getElementById("historyPopup");
let historyPopupAnchor = null;

function hideHistoryPopup() {
  if (historyPopupAnchor)
    historyPopupAnchor.removeAttribute("aria-describedby");
  historyPopupAnchor = null;
  historyPopup.hidden = true;
}
function showHistoryPopup(cell) {
  hideHistoryPopup();
  historyPopupAnchor = cell;
  const [year, month, day] = cell.dataset.date.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const summary = dayHistory(cell.dataset.date);
  document.getElementById("historyPopupDate").textContent =
    date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  document.getElementById("historyPopupSessions").textContent =
    `${summary.count} ${summary.count === 1 ? "focus session" : "focus sessions"}`;
  document.getElementById("historyPopupDuration").textContent =
    `${focusDuration(summary.seconds)} focused`;
  const beads = document.getElementById("historyPopupBeads");
  beads.replaceChildren();
  beads.hidden = summary.count === 0;
  for (let i = 0; i < Math.min(summary.count, 7); i++) {
    const bead = document.createElement("span");
    bead.className = "history-popup-bead";
    beads.appendChild(bead);
  }
  if (summary.count > 7) {
    const extra = document.createElement("span");
    extra.className = "history-popup-extra";
    extra.textContent = `+${summary.count - 7}`;
    beads.appendChild(extra);
  }
  const tasks = document.getElementById("historyPopupTasks");
  tasks.replaceChildren();
  const sessions = focusHistory.entries.filter(
    (entry) => entry.day === cell.dataset.date,
  );
  tasks.hidden = sessions.length === 0;
  for (const entry of sessions.slice(-5).reverse()) {
    const item = document.createElement("li");
    item.textContent = `${entry.task || "Focus session"} · ${focusDuration(entry.seconds)}`;
    tasks.appendChild(item);
  }
  if (sessions.length > 5) {
    const extra = document.createElement("li");
    extra.textContent = `+${sessions.length - 5} earlier sessions`;
    tasks.appendChild(extra);
  }
  historyPopup.hidden = false;
  cell.setAttribute("aria-describedby", "historyPopup");
  const anchor = cell.getBoundingClientRect();
  const box = historyPopup.getBoundingClientRect();
  const left = Math.min(
    window.innerWidth - box.width - 12,
    Math.max(12, anchor.left + anchor.width / 2 - box.width / 2),
  );
  let top = anchor.top - box.height - 10;
  if (top < 12) top = anchor.bottom + 10;
  historyPopup.style.left = `${Math.max(12, left)}px`;
  historyPopup.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 12, top))}px`;
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") hideHistoryPopup();
  if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const blocked = "input, textarea, select, button, a, summary, [role='button'], [role='textbox'], [role='slider'], [contenteditable]:not([contenteditable='false'])";
  const targets = [...(event.composedPath?.() || [event.target]), document.activeElement];
  if (targets.some((target) => target?.closest?.(blocked)) || document.querySelectorAll("dialog[open]").length) return;
  const space = event.code === "Space" || event.key === " ";
  if (!space && event.key?.toLowerCase() !== "r") return;
  event.preventDefault();
  if (event.repeat) return;
  if (space) handleDialPress();
  else resetTimer();
});
document.addEventListener("pointerdown", (event) => {
  if (historyPopupAnchor && !historyPopupAnchor.contains(event.target))
    hideHistoryPopup();
});
window.addEventListener("scroll", hideHistoryPopup, true);
window.addEventListener("resize", hideHistoryPopup);

let focusHistory = validHistory(readLocalData(HISTORY_STORAGE_KEY));
if (!focusHistory) {
  focusHistory = {
    version: 1,
    baselineSeconds: profile.focusedSeconds,
    entries: [],
  };
  writeLocalData(HISTORY_STORAGE_KEY, focusHistory);
}
focusHistoryReady = true;
let historyMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedHistoryDay = localDateKey(new Date());
let calendarTodayKey = selectedHistoryDay;

function syncFocusedTotal() {
  profile.focusedSeconds =
    focusHistory.baselineSeconds +
    focusHistory.entries.reduce((sum, entry) => sum + entry.seconds, 0);
}
function reconcileTodayGoal() {
  ensureGoalDay();
  const completed = focusHistory.entries.filter(
    (entry) => entry.day === goalDayKey(),
  ).length;
  profile.goalChecks = Array.from(
    { length: profile.dailyGoal },
    (_, index) => index < completed,
  );
}
function dayHistory(key) {
  const entries = focusHistory.entries.filter((entry) => entry.day === key);
  return {
    count: entries.length,
    seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0),
  };
}
function focusDuration(seconds) {
  const minutes = Math.floor(seconds / 60);
  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
    : `${minutes} min`;
}
function weeklyStats(today = new Date()) {
  const start = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const entries = focusHistory.entries.filter(
    (entry) =>
      entry.endedAt >= start.getTime() &&
      entry.endedAt < end.getTime() &&
      entry.endedAt <= today.getTime(),
  );
  const days = new Set(
    focusHistory.entries
      .filter((entry) => entry.endedAt <= today.getTime())
      .map((entry) => entry.day),
  );
  const cursor = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  // Yesterday's streak stays active while today is still in progress.
  if (!days.has(localDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(localDateKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return {
    start,
    end,
    seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0),
    count: entries.length,
    streak,
  };
}
function renderWeeklyStats() {
  const stats = weeklyStats();
  const last = new Date(stats.end);
  last.setDate(last.getDate() - 1);
  const format = (date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  document.getElementById("weeklyStatsRange").textContent =
    `${format(stats.start)} – ${format(last)} · Mon–Sun`;
  const minutes = Math.floor(stats.seconds / 60);
  document.getElementById("weeklyFocusTime").textContent =
    `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  document.getElementById("weeklySessions").textContent = String(stats.count);
  document.getElementById("weeklyStreak").textContent =
    `${stats.streak} ${stats.streak === 1 ? "day" : "days"}`;
}
function renderCalendar() {
  renderWeeklyStats();
  renderTaskQueue();
  hideHistoryPopup();
  const year = historyMonth.getFullYear();
  const month = historyMonth.getMonth();
  document.getElementById("calendarMonthLabel").textContent =
    historyMonth.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });
  const container = document.getElementById("calendarDays");
  container.replaceChildren();
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  for (let i = 0; i < offset; i++)
    container.appendChild(document.createElement("span"));
  const days = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= days; day++) {
    const date = new Date(year, month, day);
    const key = localDateKey(date);
    const summary = dayHistory(key);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className =
      key === selectedHistoryDay ? "cal-day-cell active-date" : "cal-day-cell";
    cell.dataset.date = key;
    const selectedInMonth = selectedHistoryDay.startsWith(`${year}-${month + 1}-`);
    cell.tabIndex = key === selectedHistoryDay || (!selectedInMonth && day === 1) ? 0 : -1;
    cell.setAttribute("aria-pressed", String(key === selectedHistoryDay));
    if (key === localDateKey(new Date()))
      cell.setAttribute("aria-current", "date");
    const label = `${date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}: ${summary.count} sessions, ${focusDuration(summary.seconds)}`;
    cell.setAttribute("aria-label", label);

    const number = document.createElement("span");
    number.className = "day-num";
    number.textContent = day;
    cell.appendChild(number);
    const dots = document.createElement("span");
    dots.className = "dots-row";
    dots.setAttribute("aria-hidden", "true");
    for (let i = 0; i < Math.min(summary.count, 3); i++) {
      const dot = document.createElement("span");
      dot.className = "dot";
      dots.appendChild(dot);
    }
    if (summary.count > 3) {
      const extra = document.createElement("span");
      extra.className = "calendar-extra";
      extra.textContent = "+";
      dots.appendChild(extra);
    }
    cell.appendChild(dots);
    cell.addEventListener("pointerenter", (event) => {
      if (event.pointerType !== "touch") showHistoryPopup(cell);
    });
    cell.addEventListener("pointerleave", () => {
      if (!cell.matches(":focus-visible")) hideHistoryPopup();
    });
    cell.addEventListener("focus", () => showHistoryPopup(cell));
    cell.addEventListener("blur", hideHistoryPopup);
    cell.addEventListener("click", () => {
      selectDate(cell);
      showHistoryPopup(cell);
    });
    cell.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const shifts = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      const weekday = (date.getDay() + 6) % 7;
      const delta = event.key === "Home" ? -weekday : event.key === "End" ? 6 - weekday : shifts[event.key];
      if (delta === undefined) return;
      event.preventDefault();
      const next = new Date(year, month, day + delta);
      selectedHistoryDay = localDateKey(next);
      historyMonth = new Date(next.getFullYear(), next.getMonth(), 1);
      renderCalendar();
      Array.from(container.children).find((item) => item.dataset.date === selectedHistoryDay)?.focus();
    });
    container.appendChild(cell);
  }
  floatingWidgets.forEach((widget) =>
    clampWidgetPosition(
      widget,
      parseFloat(widget.style.left),
      parseFloat(widget.style.top),
    ),
  );
  window.renderSessionHistory?.();
}
function moveHistoryMonth(delta) {
  historyMonth = new Date(
    historyMonth.getFullYear(),
    historyMonth.getMonth() + delta,
    1,
  );
  selectedHistoryDay = localDateKey(historyMonth);
  renderCalendar();
}
document
  .getElementById("calendarPrevious")
  .addEventListener("click", () => moveHistoryMonth(-1));
document
  .getElementById("calendarNext")
  .addEventListener("click", () => moveHistoryMonth(1));
document.getElementById("calendarToday").addEventListener("click", () => {
  const today = new Date();
  historyMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  selectedHistoryDay = localDateKey(today);
  renderCalendar();
});
window.addEventListener("storage", (event) => {
  if (event.key === HISTORY_STORAGE_KEY) {
    const latest = validHistory(readLocalData(HISTORY_STORAGE_KEY));
    if (latest) {
      focusHistory = latest;
      syncFocusedTotal();
      reconcileTodayGoal();
      renderProfile();
      renderCalendar();
    }
  }
  if (event.key === TIMER_STORAGE_KEY) restoreTimerState();
});
function recoverVisibleTimer() {
  if (!document.hidden) tickTimer(false);
}
document.addEventListener("visibilitychange", recoverVisibleTimer);
// Unlocking/waking a device does not always change document visibility.
window.addEventListener("focus", recoverVisibleTimer);
document.addEventListener("resume", recoverVisibleTimer);
setInterval(() => {
  if (calendarTodayKey !== localDateKey(new Date())) {
    calendarTodayKey = localDateKey(new Date());
    renderCalendar();
  }
}, 60000);

syncFocusedTotal();
reconcileTodayGoal();
renderProfile();
renderCalendar();
restoreWidgetLayout();
if (!restoreTimerState()) setMode("pomodoro");

let goalRewardAnimation = null;
async function animateSessionToGoal(index) {
  if (goalRewardAnimation) return;
  const goal = document.getElementById("goalWidget");
  const target = document.getElementById("goalBeadsContainer").children[index];
  if (!target) return;
  goalRewardAnimation = true;
  const wasClosed =
    !goal.classList.contains("is-floating") &&
    sidebarToggle.getAttribute("aria-expanded") !== "true";
  let orb = null;
  const reducedMotion = window.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  try {
    target.classList.add("is-receiving-session");
    if (wasClosed) {
      setSidebarOpen(true);
      goal.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      await new Promise((resolve) =>
        setTimeout(resolve, reducedMotion ? 0 : 280),
      );
    }
    const source = document
      .getElementById("timerButton")
      .getBoundingClientRect();
    const destination = target.getBoundingClientRect();
    const size = source.width;
    if (!reducedMotion && size > 0 && target.isConnected) {
      orb = document.createElement("div");
      orb.className = "session-transfer-orb";
      orb.setAttribute("aria-hidden", "true");
      orb.style.width = `${size}px`;
      orb.style.height = `${size}px`;
      orb.style.left = `${source.left}px`;
      orb.style.top = `${source.top}px`;
      document.body.appendChild(orb);
      const dx =
        destination.left +
        destination.width / 2 -
        source.left -
        source.width / 2;
      const dy =
        destination.top +
        destination.height / 2 -
        source.top -
        source.height / 2;
      const scale = destination.width / size;
      playAudioFeedback("rewardLaunch");
      const flight = orb.animate(
        [
          { transform: "translate(0, 0) scale(1)", opacity: 0.85 },
          {
            transform: `translate(${dx * 0.45}px, ${dy * 0.25 - 45}px) scale(0.5)`,
            opacity: 1,
            offset: 0.45,
          },
          {
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            opacity: 1,
          },
        ],
        {
          duration: 1000,
          easing: "cubic-bezier(0.22, 0.65, 0.3, 1)",
          fill: "forwards",
        },
      );
      await flight.finished;
    }
    target.classList.remove("is-receiving-session");
    target.classList.add("is-rewarded");
    playAudioFeedback("rewardLand");
    await new Promise((resolve) =>
      setTimeout(resolve, reducedMotion ? 250 : 850),
    );
  } catch (error) {
    // Progress is already saved; animation never blocks the timer.
    playAudioFeedback("finish");
  } finally {
    if (orb) orb.remove();
    target.classList.remove("is-receiving-session", "is-rewarded");
    goalRewardAnimation = null;
    if (
      wasClosed &&
      !sidebarPointerInside &&
      !sidebarShell.contains(document.activeElement)
    )
      setSidebarOpen(false);
  }
}

// Task queue uses stable IDs, so tasks with matching names keep separate history.
function validTaskQueue(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.tasks)) return [];
  const seen = new Set();
  return value.tasks
    .filter((task) => {
      if (
        !task ||
        typeof task.id !== "string" ||
        !task.id ||
        seen.has(task.id) ||
        typeof task.name !== "string" ||
        !task.name.trim()
      )
        return false;
      seen.add(task.id);
      return true;
    })
    .map((task) => ({
      id: task.id.slice(0, 100),
      name: task.name.trim().slice(0, 120),
      done: task.done === true,
      dailyTarget:
        Number.isInteger(task.dailyTarget) &&
        task.dailyTarget >= 1 &&
        task.dailyTarget <= 99
          ? task.dailyTarget
          : 1,
    }));
}
function saveTaskQueue() {
  writeLocalData(TASK_QUEUE_KEY, {
    version: 1,
    tasks: taskQueue,
    selectedTaskId,
    deletedTasks: deletedQueueTasks,
  });
}
function queueTaskLocked() {
  return (
    currentMode === "pomodoro" && (isRunning || remainingSeconds < totalSeconds)
  );
}
function selectQueueTask(id, revealTask = false) {
  if (completionPending) {
    showHint("Save your finished session first. Press the timer to retry.");
    return;
  }
  const task = taskQueue.find((item) => item.id === id && !item.done);
  if (task && revealTask) {
    profile.showCurrentTask = true;
    writeLocalData(PROFILE_STORAGE_KEY, profile);
    document.getElementById("currentTaskArea").hidden = false;
  }
  selectedTaskId = task?.id || null;
  currentTask = task?.name || "";
  document.getElementById("currentTaskInput").value = currentTask;
  saveTaskQueue();
  saveTimerState();
  renderTaskQueue();
  document.getElementById("taskQueueStatus").textContent = task
    ? `Selected: ${task.name}`
    : "No task selected.";
}
function toggleQueueTask(id) {
  const task = taskQueue.find((item) => item.id === id);
  if (!task || (id === selectedTaskId && queueTaskLocked())) return;
  task.done = !task.done;
  if (task.done) {
    playAudioFeedback("taskComplete");
    if (!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      const token = {};
      taskCompletionEffects.set(id, token);
      setTimeout(() => {
        if (taskCompletionEffects.get(id) !== token) return;
        taskCompletionEffects.delete(id);
        renderTaskQueue();
        document.getElementById("taskQueueStatus").textContent =
          `Completed: ${task.name}`;
      }, 650);
    }
  } else taskCompletionEffects.delete(id);
  if (task.done && selectedTaskId === id) {
    const next = taskQueue.find((item) => !item.done);
    selectedTaskId = next?.id || null;
    currentTask = next?.name || "";
    document.getElementById("currentTaskInput").value = currentTask;
    saveTimerState();
  }
  saveTaskQueue();
  renderTaskQueue();
  document.getElementById("taskQueueStatus").textContent = task.done
    ? `Completed: ${task.name}`
    : `Reopened: ${task.name}`;
}
function taskQueueTotals(id) {
  const entries = focusHistory.entries.filter((entry) => entry.taskId === id);
  return {
    count: entries.length,
    seconds: entries.reduce((sum, entry) => sum + entry.seconds, 0),
  };
}
function renderTaskQueue() {
  const pending = document.getElementById("taskQueueList");
  const completed = document.getElementById("completedTaskQueueList");
  const active = document.activeElement;
  const hadQueueFocus = pending.contains(active) || completed.contains(active);
  const focusKey = hadQueueFocus ? active.dataset.queueFocusKey : null;
  queueFocusTargets.clear();
  const trackFocus = (button, task, action) => {
    const key = `${task.id}:${action}`;
    button.dataset.queueFocusKey = key;
    queueFocusTargets.set(key, button);
  };
  pending.replaceChildren();
  completed.replaceChildren();
  const locked = queueTaskLocked();
  for (const task of taskQueue) {
    const row = document.createElement("li");
    const celebrating = task.done && taskCompletionEffects.has(task.id);
    row.className = `task-queue-row${task.done ? " is-complete" : ""}${celebrating ? " is-completing" : ""}`;
    const check = document.createElement("button");
    check.type = "button";
    trackFocus(check, task, "check");
    check.className = "task-queue-check";
    check.textContent = task.done ? "✓" : "";
    check.setAttribute(
      "aria-label",
      `${task.done ? "Reopen" : "Complete"} ${task.name}`,
    );
    check.setAttribute("aria-pressed", String(task.done));
    check.disabled = celebrating || (locked && task.id === selectedTaskId);
    check.addEventListener("click", () => toggleQueueTask(task.id));
    const choose = document.createElement("button");
    choose.type = "button";
    trackFocus(choose, task, "select");
    choose.className = "task-queue-select";
    choose.setAttribute(
      "aria-label",
      `${task.done ? "Completed task" : "Focus on"} ${task.name}`,
    );
    choose.setAttribute("aria-pressed", String(task.id === selectedTaskId));
    choose.disabled = task.done;
    const name = document.createElement("span");
    name.textContent = task.name;
    const stats = document.createElement("small");
    const totals = taskQueueTotals(task.id);
    stats.textContent = `${task.id === selectedTaskId ? "Selected · " : ""}${totals.count} ${totals.count === 1 ? "session" : "sessions"} · ${focusDuration(totals.seconds)}`;
    choose.appendChild(name);
    choose.appendChild(stats);
    const today = focusHistory.entries.filter(
      (entry) => entry.taskId === task.id && entry.day === goalDayKey(),
    ).length;
    const daily = document.createElement("small");
    daily.textContent = `Today: ${today} / ${task.dailyTarget} sessions${today >= task.dailyTarget ? " · Target met ✓" : ""}`;
    const progress = document.createElement("progress");
    progress.max = task.dailyTarget;
    progress.value = Math.min(today, task.dailyTarget);
    progress.setAttribute(
      "aria-label",
      `Daily target for ${task.name}: ${today} of ${task.dailyTarget} sessions`,
    );
    choose.appendChild(daily);
    choose.appendChild(progress);
    choose.addEventListener("click", () => selectQueueTask(task.id, true));
    row.appendChild(check);
    row.appendChild(choose);
    const actions = document.createElement("div");
    actions.className = "task-row-actions";
    if (!task.done) {
      const focus = document.createElement("button");
      focus.type = "button";
      trackFocus(focus, task, "focus");
      focus.className = "task-action-button";
      focus.textContent = task.id === selectedTaskId ? "Focused" : "Focus";
      focus.setAttribute("aria-label", `Use ${task.name} as current task`);
      focus.disabled = task.id === selectedTaskId;
      focus.addEventListener("click", () => selectQueueTask(task.id, true));
      actions.appendChild(focus);
    }
    for (const action of ["Edit", "Delete"]) {
      const button = document.createElement("button");
      button.type = "button";
      trackFocus(button, task, action.toLowerCase());
      button.className = "task-action-button";
      button.textContent = action;
      button.setAttribute("aria-label", `${action} ${task.name}`);
      button.disabled = celebrating || (locked && task.id === selectedTaskId);
      button.addEventListener("click", () =>
        action === "Edit"
          ? openQueueTaskEditor(task.id)
          : deleteQueueTask(task.id),
      );
      actions.appendChild(button);
    }
    row.appendChild(actions);
    (task.done && !celebrating ? completed : pending).appendChild(row);
  }
  document.getElementById("undoQueueDelete").hidden =
    deletedQueueTasks.length === 0;
  document.getElementById("undoQueueDelete").textContent =
    deletedQueueTasks.at(-1)?.batch ? "Undo clear" : "Undo delete";
  const count = taskQueue.filter(
    (task) => task.done && !taskCompletionEffects.has(task.id),
  ).length;
  document.getElementById("completedQueueTasks").hidden = count === 0;
  document.getElementById("clearCompletedTasks").hidden = count === 0;
  document.getElementById("completedQueueSummary").textContent =
    `Completed tasks (${count})`;
  document.getElementById("taskQueueEmpty").hidden = taskQueue.some(
    (task) => !task.done || taskCompletionEffects.has(task.id),
  );
  const clear = document.getElementById("clearTaskSelection");
  clear.hidden = !selectedTaskId;
  clear.disabled = false;
  document.getElementById("currentTaskInput").readOnly = false;
  document.getElementById("taskQueueStatus").textContent = "";
  if (hadQueueFocus) {
    const same = queueFocusTargets.get(focusKey);
    const details = document.getElementById("completedQueueTasks");
    const sameIsVisible = same && (pending.contains(same) ||
      (completed.contains(same) && details.open && !details.hidden));
    const fallback = Array.from(queueFocusTargets.values()).find((button) =>
      !button.disabled && pending.contains(button));
    (sameIsVisible && !same.disabled ? same : fallback || document.getElementById("queueTaskInput")).focus();
  }
}
document
  .getElementById("addQueueTaskForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    const input = document.getElementById("queueTaskInput");
    const name = input.value.trim();
    if (!name) {
      input.setCustomValidity("Enter a task name.");
      input.reportValidity();
      return;
    }
    const dailyTarget = Number(
      document.getElementById("queueTaskTarget").value || 1,
    );
    if (!Number.isInteger(dailyTarget) || dailyTarget < 1 || dailyTarget > 99)
      return;
    const task = {
      id: newSessionId(),
      name: name.slice(0, 120),
      done: false,
      dailyTarget,
    };
    taskQueue.push(task);
    input.value = "";
    saveTaskQueue();
    if (!selectedTaskId && !queueTaskLocked()) selectQueueTask(task.id);
    else renderTaskQueue();
    input.focus();
  });
document
  .getElementById("queueTaskInput")
  .addEventListener("input", (event) => event.target.setCustomValidity(""));
document
  .getElementById("clearTaskSelection")
  .addEventListener("click", () => selectQueueTask(null));

function isMobileLayout() {
  return window.matchMedia?.("(max-width: 640px)")?.matches || false;
}
function syncResponsiveLayout() {
  const mobile = isMobileLayout();
  if (mobile === mobileLayoutActive) return;
  mobileLayoutActive = mobile;
  if (mobile) {
    widgetControllers.forEach((controller) => controller.returnToSidebar());
    setSidebarOpen(false);
  } else {
    restoreWidgetLayout();
    setSidebarOpen(false);
  }
}
syncResponsiveLayout();
function validDeletedTasks(items) {
  if (!Array.isArray(items)) return [];
  const validItem = (item) => {
    const tasks = validTaskQueue({ version: 1, tasks: [item?.task] });
    return tasks.length ? {
      task: tasks[0],
      index: Number.isInteger(item.index) && item.index >= 0 ? item.index : 0,
      wasSelected: item.wasSelected === true,
    } : null;
  };
  return items.slice(-20).flatMap((item) => {
    if (Array.isArray(item?.batch)) {
      const batch = item.batch.map(validItem).filter(Boolean);
      return batch.length ? [{ batch }] : [];
    }
    const valid = validItem(item);
    return valid ? [valid] : [];
  });
}
function clearCompletedQueueTasks() {
  const batch = taskQueue.flatMap((task, index) => task.done
    ? [{ task: { ...task }, index, wasSelected: false }] : []);
  if (!batch.length) return;
  deletedQueueTasks.push({ batch });
  deletedQueueTasks = deletedQueueTasks.slice(-20);
  for (const item of batch) taskCompletionEffects.delete(item.task.id);
  taskQueue = taskQueue.filter((task) => !task.done);
  saveTaskQueue();
  renderTaskQueue();
  document.getElementById("taskQueueStatus").textContent =
    `Cleared ${batch.length} completed ${batch.length === 1 ? "task" : "tasks"}. Undo is available.`;
  document.getElementById("undoQueueDelete").focus();
}
document.getElementById("clearCompletedTasks")
  .addEventListener("click", clearCompletedQueueTasks);
function deleteQueueTask(id) {
  const index = taskQueue.findIndex((task) => task.id === id);
  if (index < 0 || (id === selectedTaskId && queueTaskLocked())) return;
  const task = taskQueue[index];
  deletedQueueTasks.push({
    task: { ...task },
    index,
    wasSelected: id === selectedTaskId,
  });
  deletedQueueTasks = deletedQueueTasks.slice(-20);
  taskQueue.splice(index, 1);
  if (id === selectedTaskId) selectQueueTask(null);
  saveTaskQueue();
  renderTaskQueue();
  document.getElementById("taskQueueStatus").textContent =
    `Deleted: ${task.name}. Undo is available.`;
}
function undoQueueTaskDelete() {
  const item = deletedQueueTasks.pop();
  if (!item) return;
  if (item.batch) {
    for (const entry of item.batch.slice().sort((a, b) => a.index - b.index)) {
      if (!taskQueue.some((task) => task.id === entry.task.id))
        taskQueue.splice(Math.min(entry.index, taskQueue.length), 0, entry.task);
    }
    saveTaskQueue();
    renderTaskQueue();
    document.getElementById("taskQueueStatus").textContent =
      `Restored ${item.batch.length} completed ${item.batch.length === 1 ? "task" : "tasks"}.`;
    return;
  }
  if (!taskQueue.some((task) => task.id === item.task.id))
    taskQueue.splice(Math.min(item.index, taskQueue.length), 0, item.task);
  if (
    item.wasSelected &&
    !selectedTaskId &&
    !queueTaskLocked() &&
    !item.task.done
  )
    selectQueueTask(item.task.id);
  saveTaskQueue();
  renderTaskQueue();
  document.getElementById("taskQueueStatus").textContent =
    `Restored: ${item.task.name}`;
}
let editingQueueTaskId = null;
function openQueueTaskEditor(id) {
  const task = taskQueue.find((item) => item.id === id);
  if (!task || (id === selectedTaskId && queueTaskLocked())) return;
  editingQueueTaskId = id;
  document.getElementById("editQueueTaskName").value = task.name;
  document.getElementById("editQueueTaskTarget").value = task.dailyTarget;
  document.getElementById("queueTaskEditor").showModal();
  document.getElementById("editQueueTaskName").focus();
}
document
  .getElementById("editQueueTaskForm")
  .addEventListener("submit", (event) => {
    event.preventDefault();
    const task = taskQueue.find((item) => item.id === editingQueueTaskId);
    if (!task || (task.id === selectedTaskId && queueTaskLocked())) return;
    const name = document.getElementById("editQueueTaskName").value.trim();
    const target = Number(document.getElementById("editQueueTaskTarget").value);
    if (
      !name ||
      name.length > 120 ||
      !Number.isInteger(target) ||
      target < 1 ||
      target > 99
    )
      return;
    task.name = name;
    task.dailyTarget = target;
    if (task.id === selectedTaskId) {
      currentTask = name;
      document.getElementById("currentTaskInput").value = name;
      saveTimerState();
    }
    saveTaskQueue();
    renderTaskQueue();
    document.getElementById("queueTaskEditor").close();
  });
document
  .getElementById("cancelQueueTaskEdit")
  .addEventListener("click", () =>
    document.getElementById("queueTaskEditor").close(),
  );
document.getElementById("queueTaskEditor").addEventListener("close", () => {
  const target = queueFocusTargets.get(`${editingQueueTaskId}:edit`);
  const destination = target && !target.disabled ? target : document.getElementById("queueTaskInput");
  if (sidebarPanel.contains(destination)) setSidebarOpen(true);
  destination.focus();
});
document
  .getElementById("undoQueueDelete")
  .addEventListener("click", undoQueueTaskDelete);

// Presets are drafts until the profile's Save button is pressed.
let draftFocusPresets = [];
const presetPicker = document.getElementById("focusPresetSelect");
const presetNameInput = document.getElementById("focusPresetName");
const presetStatus = document.getElementById("focusPresetStatus");
const presetKeys = ["focusMinutes", "shortBreakMinutes", "longBreakMinutes", "longBreakInterval"];
function presetFormValues() {
  return { ...Object.fromEntries(Object.entries(durationInputs).map(([key, input]) => [key, Number(input.value)])),
    longBreakInterval: Number(longBreakIntervalInput.value) };
}
function renderFocusPresetPicker() {
  const values = presetFormValues();
  presetPicker.replaceChildren();
  const custom = document.createElement("option");
  custom.value = ""; custom.textContent = "Custom settings";
  presetPicker.appendChild(custom);
  let match = "";
  for (const preset of [...BUILTIN_FOCUS_PRESETS, ...draftFocusPresets]) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = `${preset.name} · ${preset.focusMinutes}/${preset.shortBreakMinutes}`;
    presetPicker.appendChild(option);
    if (!match && presetKeys.every((key) => preset[key] === values[key])) match = preset.id;
  }
  presetPicker.value = match;
  document.getElementById("deleteFocusPreset").disabled = !draftFocusPresets.some((preset) => preset.id === match);
}
presetPicker.addEventListener("change", () => {
  const preset = [...BUILTIN_FOCUS_PRESETS, ...draftFocusPresets].find((item) => item.id === presetPicker.value);
  if (!preset) return;
  for (const [key, input] of Object.entries(durationInputs)) {
    input.value = preset[key]; input.setCustomValidity("");
  }
  longBreakIntervalInput.value = preset.longBreakInterval;
  longBreakIntervalInput.setCustomValidity("");
  presetNameInput.value = draftFocusPresets.some((item) => item.id === preset.id) ? preset.name : "";
  document.getElementById("deleteFocusPreset").disabled = !draftFocusPresets.some((item) => item.id === preset.id);
  presetStatus.textContent = `${preset.name} selected. Save profile to apply.`;
});
for (const input of [...Object.values(durationInputs), longBreakIntervalInput]) input.addEventListener("input", renderFocusPresetPicker);
presetNameInput.addEventListener("input", () => presetNameInput.setCustomValidity(""));
document.getElementById("saveFocusPreset").addEventListener("click", () => {
  const name = presetNameInput.value.trim();
  if (!name || name.length > 30) {
    presetNameInput.setCustomValidity("Name your routine using 1–30 characters."); presetNameInput.reportValidity(); return;
  }
  const values = presetFormValues();
  const candidate = { id: newSessionId(), name, ...values };
  if (!validFocusPresets([candidate]).length) {
    presetStatus.textContent = "Use whole minutes from 1–180 and a long-break interval from 1–12."; return;
  }
  const existing = draftFocusPresets.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());
  if (existing < 0 && draftFocusPresets.length >= 12) {
    presetStatus.textContent = "You can save up to 12 custom routines. Delete one first."; return;
  }
  if (existing >= 0) { candidate.id = draftFocusPresets[existing].id; draftFocusPresets[existing] = candidate; }
  else draftFocusPresets.push(candidate);
  renderFocusPresetPicker();
  presetPicker.value = candidate.id;
  document.getElementById("deleteFocusPreset").disabled = false;
  presetStatus.textContent = "Routine saved in this draft. Save profile to keep it.";
});
document.getElementById("deleteFocusPreset").addEventListener("click", () => {
  draftFocusPresets = draftFocusPresets.filter((item) => item.id !== presetPicker.value);
  presetNameInput.value = ""; renderFocusPresetPicker();
  presetStatus.textContent = "Routine removed from this draft. Save profile to keep the change.";
});

// Temporary sound preview: no timer or saved settings are changed.
document.getElementById("testPreFinishCue").addEventListener("click", async () => {
  const test = document.getElementById("testPreFinishCue");
  const message = document.getElementById("preFinishCueTestStatus");
  if (test.disabled) return;
  if (!soundEnabled) { message.textContent = "Unmute the timer to hear the cue."; return; }
  if (!window.Tone) { message.textContent = "Audio is still loading. Try again in a moment."; return; }
  test.disabled = true;
  try {
    await Tone.start();
    if (!soundEnabled) { message.textContent = "Unmute the timer to hear the cue."; return; }
    playAudioFeedback("preFinish");
    message.textContent = "Playing the one-minute cue.";
  } catch (_) { message.textContent = "Could not play the cue. Try again."; }
  finally { test.disabled = false; }
});
