// Local-only JSON backups. Import accepts known data fields, never executable content.
const BACKUP_FORMAT = "neumorphism-pomodoro";
const RESTORE_UNDO_KEY = "pomodoro-before-restore-v1";
const BACKUP_STORAGE_KEYS = [
  PROFILE_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  TASK_QUEUE_KEY,
  LAYOUT_STORAGE_KEY,
  TIMER_STORAGE_KEY,
  "pomodoro-ambient-settings-v1",
  "pomodoro-last-notification-v1",
];
let pendingBackup = null;
function makePomodoroBackup() {
  return {
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    profile: { ...profile },
    history: focusHistory,
    queue: {
      version: 1,
      tasks: taskQueue,
      selectedTaskId,
      deletedTasks: deletedQueueTasks,
    },
    layout: savedWidgetLayout,
    ambient: readLocalData("pomodoro-ambient-settings-v1"),
  };
}
function validatePomodoroBackup(value) {
  const bad = () => {
    throw new Error(
      "This file is not a valid Pomodoro backup. No data was changed.",
    );
  };
  if (!value || value.format !== BACKUP_FORMAT || value.version !== 1) bad();
  const source = value.profile;
  if (
    !source ||
    typeof source.name !== "string" ||
    !source.name.trim() ||
    source.name.length > 50 ||
    typeof source.role !== "string" ||
    source.role.length > 70
  )
    bad();
  const bounded = (n, max) => Number.isInteger(n) && n >= 1 && n <= max;
  if (
    !bounded(source.dailyGoal, 99) ||
    !bounded(source.focusMinutes, 180) ||
    !bounded(source.shortBreakMinutes, 180) ||
    !bounded(source.longBreakMinutes, 180) ||
    !bounded(source.longBreakInterval ?? 4, 12)
  )
    bad();
  if (
    typeof source.photo !== "string" ||
    source.photo.length > 3000000 ||
    (source.photo &&
      !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(
        source.photo,
      ))
  )
    bad();
  if (
    !Number.isInteger(source.joined) ||
    source.joined < 2001 ||
    source.joined > new Date().getFullYear()
  )
    bad();
  const presets = validFocusPresets(source.focusPresets);
  if (source.focusPresets !== undefined && (!Array.isArray(source.focusPresets) || presets.length !== source.focusPresets.length)) bad();
  const history = validHistory(value.history);
  if (
    !history ||
    history.entries.length !== value.history.entries.length ||
    history.entries.length > 50000
  )
    bad();
  if (
    !value.queue ||
    value.queue.version !== 1 ||
    !Array.isArray(value.queue.tasks) ||
    value.queue.tasks.length > 10000
  )
    bad();
  const tasks = validTaskQueue(value.queue);
  if (
    tasks.length !== value.queue.tasks.length ||
    new Set(tasks.map((task) => task.id)).size !== tasks.length
  )
    bad();
  for (const task of value.queue.tasks) {
    if (
      task.id.length > 100 ||
      task.name.length > 120 ||
      (task.dailyTarget !== undefined && !bounded(task.dailyTarget, 99)) ||
      typeof task.done !== "boolean"
    )
      bad();
  }
  const selected = value.queue.selectedTaskId ?? null;
  if (
    selected !== null &&
    !tasks.some((task) => task.id === selected && !task.done)
  )
    bad();
  const cleaned = {
    focusPresets: presets,
    name: source.name.trim(),
    role: source.role,
    photo: source.photo,
    joined: source.joined,
    dailyGoal: source.dailyGoal,
    focusedSeconds:
      history.baselineSeconds +
      history.entries.reduce((sum, entry) => sum + entry.seconds, 0),
    focusMinutes: source.focusMinutes,
    shortBreakMinutes: source.shortBreakMinutes,
    longBreakMinutes: source.longBreakMinutes,
    longBreakInterval: source.longBreakInterval ?? 4,
    autoStartBreaks: source.autoStartBreaks === true,
    autoStartFocus: source.autoStartFocus === true,
    preFinishCue: source.preFinishCue === true,
    showCurrentTask: source.showCurrentTask !== false,
    desktopNotifications:
      source.desktopNotifications === true &&
      notificationsSupported() &&
      window.Notification.permission === "granted",
    goalDay:
      typeof source.goalDay === "string" ? source.goalDay.slice(0, 10) : "",
    goalChecks: Array.isArray(source.goalChecks)
      ? source.goalChecks.slice(0, 99).map((item) => item === true)
      : [],
  };
  const layout = {};
  if (value.layout && typeof value.layout === "object") {
    for (const id of widgetControllers.keys()) {
      const point = value.layout[id];
      if (point && Number.isFinite(point.left) && Number.isFinite(point.top))
        layout[id] = { left: point.left, top: point.top };
    }
  }
  const ambient =
    value.ambient &&
    ["rain", "fireplace", "beach", "jazz", "cafe", "white"].includes(value.ambient.sound) &&
    Number.isFinite(value.ambient.volume)
      ? {
          sound: value.ambient.sound,
          volume: Math.max(0, Math.min(100, value.ambient.volume)),
        }
      : null;
  return {
    profile: cleaned,
    history,
    queue: {
      version: 1,
      tasks,
      selectedTaskId: selected,
      deletedTasks: validDeletedTasks(value.queue.deletedTasks),
    },
    layout,
    ambient,
  };
}
function captureStorage() {
  return Object.fromEntries(
    BACKUP_STORAGE_KEYS.map((key) => [key, localStorage.getItem(key)]),
  );
}
function applyPomodoroBackup(backup) {
  const before = captureStorage();
  window.PomodoroStorageSafety.transact({
    [RESTORE_UNDO_KEY]: JSON.stringify(before),
    [PROFILE_STORAGE_KEY]: JSON.stringify(backup.profile),
    [HISTORY_STORAGE_KEY]: JSON.stringify(backup.history),
    [TASK_QUEUE_KEY]: JSON.stringify(backup.queue),
    [LAYOUT_STORAGE_KEY]: JSON.stringify(backup.layout),
    ["pomodoro-ambient-settings-v1"]: backup.ambient ? JSON.stringify(backup.ambient) : null,
    [TIMER_STORAGE_KEY]: null,
    ["pomodoro-last-notification-v1"]: null,
  });
}

document.getElementById("exportBackupButton").addEventListener("click", () => {
  try {
    const blob = new Blob([JSON.stringify(makePomodoroBackup(), null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `pomodoro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    document.getElementById("backupStatus").textContent =
      "Backup downloaded. Unsaved profile edits are not included.";
  } catch (_) {
    document.getElementById("backupStatus").textContent =
      "Could not create the backup. Please try again.";
  }
});
document
  .getElementById("importBackupInput")
  .addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    pendingBackup = null;
    try {
      if (file.size > 10 * 1024 * 1024)
        throw new Error("Choose a backup smaller than 10 MB.");
      pendingBackup = validatePomodoroBackup(JSON.parse(await file.text()));
      document.getElementById("restoreBackupPreview").textContent =
        `${pendingBackup.profile.name} · ${pendingBackup.queue.tasks.length} tasks · ${pendingBackup.history.entries.length} completed focus sessions`;
      document.getElementById("restoreBackupStatus").textContent = "";
      document.getElementById("restoreBackupDialog").showModal();
    } catch (error) {
      document.getElementById("backupStatus").textContent =
        error instanceof SyntaxError
          ? "This file is not valid JSON. No data was changed."
          : error.message;
    }
    event.target.value = "";
  });
document.getElementById("cancelRestoreBackup").addEventListener("click", () => {
  pendingBackup = null;
  document.getElementById("restoreBackupDialog").close();
});
document
  .getElementById("confirmRestoreBackup")
  .addEventListener("click", () => {
    if (!pendingBackup) return;
    if (isRunning || completionPending) {
      document.getElementById("restoreBackupStatus").textContent =
        completionPending ? "Save your finished session before restoring a backup." : "Pause the timer before restoring a backup.";
      return;
    }
    try {
      applyPomodoroBackup(pendingBackup);
      window.location.reload();
    } catch (error) {
      document.getElementById("restoreBackupStatus").textContent =
        error.message;
    }
  });
try {
  document.getElementById("undoBackupRestore").hidden =
    !localStorage.getItem(RESTORE_UNDO_KEY);
} catch (_) {}
document.getElementById("undoBackupRestore").addEventListener("click", () => {
  if (isRunning || completionPending) {
    showHint(completionPending ? "Save your finished session before undoing restore" : "Pause the timer before undoing restore");
    return;
  }
  try {
    const previous = JSON.parse(localStorage.getItem(RESTORE_UNDO_KEY));
    if (!previous || typeof previous !== "object") return;
    const changes = Object.fromEntries(BACKUP_STORAGE_KEYS.map((key) => [key, previous[key] ?? null]));
    // Keep a restored timer paused; stale deadlines must not start or finish on undo.
    const timer = changes[TIMER_STORAGE_KEY] && JSON.parse(changes[TIMER_STORAGE_KEY]);
    if (timer) {
      timer.running = false;
      timer.deadline = null;
      changes[TIMER_STORAGE_KEY] = JSON.stringify(timer);
    }
    changes[RESTORE_UNDO_KEY] = null;
    window.PomodoroStorageSafety.transact(changes);
    window.location.reload();
  } catch (error) {
    showHint(error.message || "Could not undo restore. Try again after freeing browser storage.");
  }
});
