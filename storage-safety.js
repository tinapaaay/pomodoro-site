// A durable before-image protects multi-key restores across quota errors/crashes.
(() => {
  const journalKey = "pomodoro-storage-transaction-v1";
  let blocked = false;
  let api;
  const keys = [
    "pomodoro-local-profile", "pomodoro-focus-history-v1", "pomodoro-task-queue-v1",
    "pomodoro-widget-layout-v1", "pomodoro-timer-state-v1", "pomodoro-ambient-settings-v1",
    "pomodoro-last-notification-v1", "pomodoro-before-restore-v1",
  ];
  function safetyError(message) {
    const error = new Error(message);
    error.storageSafety = true;
    return error;
  }
  function snapshot() {
    return Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)]));
  }
  function recover() {
    const raw = localStorage.getItem(journalKey);
    if (raw === null) { blocked = false; return; }
    let journal;
    try { journal = JSON.parse(raw); } catch (_) {}
    if (!journal || journal.version !== 1 || !journal.before ||
        !keys.every((key) => Object.hasOwn(journal.before, key) &&
          (journal.before[key] === null || typeof journal.before[key] === "string"))) {
      blocked = true;
      const error = safetyError("A saved recovery copy is damaged. Download your recovery data before making changes.");
      try { api.onBlocked?.(error); } catch (_) {}
      throw error;
    }
    try {
      // Free changed values first. The complete old data stays in the journal
      // until every key is restored, even if writes keep failing or the tab dies.
      for (const key of keys) {
        if (localStorage.getItem(key) !== journal.before[key]) localStorage.removeItem(key);
      }
      for (const key of keys) {
        const value = journal.before[key];
        if (value !== null && localStorage.getItem(key) !== value) localStorage.setItem(key, value);
      }
      localStorage.removeItem(journalKey);
      blocked = false;
    } catch (_) {
      blocked = true;
      const error = safetyError("Restore recovery could not finish. Your previous data is preserved in a recovery copy. Free browser storage, then try again or download the copy.");
      try { api.onBlocked?.(error); } catch (_) {}
      throw error;
    }
  }
  function transact(changes) {
    recover();
    const before = snapshot();
    if (!Object.entries(changes).every(([key, value]) => keys.includes(key) &&
        (value === null || typeof value === "string"))) throw new Error("Invalid storage changes");
    try { localStorage.setItem(journalKey, JSON.stringify({ version: 1, before })); }
    catch (_) { throw safetyError("Not enough browser storage to restore safely. No saved data was changed. Export a backup or free storage and try again."); }
    try {
      for (const [key, value] of Object.entries(changes)) {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      }
      localStorage.removeItem(journalKey);
    } catch (_) {
      recover();
      throw safetyError("Restore could not be saved. Your previous data was restored.");
    }
  }
  function inspect() {
    for (const key of keys) {
      const raw = localStorage.getItem(key);
      if (raw === null) continue;
      let value;
      try { value = JSON.parse(raw); }
      catch (_) { throw safetyError(`Saved data is damaged (${key}). It was left untouched. Download a recovery copy before making changes.`); }
      if (key === "pomodoro-last-notification-v1" && typeof value === "string") continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw safetyError(`Saved data has an unexpected format (${key}). It was left untouched. Download a recovery copy before making changes.`);
      }
      if (key === "pomodoro-focus-history-v1" &&
          (value.version !== 1 || !Array.isArray(value.entries) || !Number.isFinite(value.baselineSeconds) || value.baselineSeconds < 0)) {
        throw safetyError("Saved focus history is damaged. Download a recovery copy before making changes.");
      }
      if (key === "pomodoro-task-queue-v1" && (value.version !== 1 || !Array.isArray(value.tasks))) {
        throw safetyError("Saved task data is damaged. Download a recovery copy before making changes.");
      }
      if (key === "pomodoro-focus-history-v1") {
        const deleted = value.deletedIds ?? [];
        const undo = value.undo ?? [];
        if (!Array.isArray(deleted) || deleted.length > 50000 || new Set(deleted).size !== deleted.length ||
            deleted.some(id => typeof id !== "string" || !id) || !Array.isArray(undo) || undo.length > 20 ||
            undo.some(change => !change || !["edit", "delete"].includes(change.type) || !Number.isInteger(change.index) || change.index < 0 ||
              !change.before || typeof change.before.id !== "string" || !change.before.id ||
              !Number.isFinite(change.before.seconds) || change.before.seconds <= 0 || change.before.seconds > 86400 ||
              !Number.isFinite(change.before.endedAt) || !Number.isFinite(new Date(change.before.endedAt).getTime())))
          throw safetyError("Saved history changes are damaged. Download a recovery copy before making changes.");
        const ids = new Set();
        if (value.entries.some((entry) => {
          if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || deleted.includes(entry.id) ||
              !Number.isFinite(entry.seconds) || entry.seconds <= 0 || entry.seconds > 86400 ||
              !Number.isFinite(entry.endedAt) || !Number.isFinite(new Date(entry.endedAt).getTime())) return true;
          ids.add(entry.id); return false;
        })) throw safetyError("Saved focus entries are damaged. Download a recovery copy before making changes.");
      }
      if (key === "pomodoro-task-queue-v1") {
        const ids = new Set();
        if (value.tasks.some((task) => {
          if (!task || typeof task.id !== "string" || !task.id || task.id.length > 100 || ids.has(task.id) ||
              typeof task.name !== "string" || !task.name.trim() || task.name.length > 120 ||
              (task.done !== undefined && typeof task.done !== "boolean")) return true;
          ids.add(task.id); return false;
        })) throw safetyError("Saved queue entries are damaged. Download a recovery copy before making changes.");
      }
      if (key === "pomodoro-timer-state-v1" &&
          (value.version !== 1 || !["pomodoro", "break", "longBreak"].includes(value.mode) ||
           !Number.isInteger(value.totalSeconds) || value.totalSeconds < 60 || value.totalSeconds > 10800 || value.totalSeconds % 60 !== 0 ||
           !Number.isInteger(value.remainingSeconds) || value.remainingSeconds < 0 || value.remainingSeconds > value.totalSeconds ||
           typeof value.running !== "boolean" || (value.running && (!Number.isFinite(value.deadline) || value.deadline <= 0 ||
             typeof value.sessionId !== "string" || !value.sessionId)))) {
        throw safetyError("Saved timer data is damaged. Download a recovery copy before making changes.");
      }
      if (key === "pomodoro-local-profile" && (typeof value.name !== "string" || !value.name.trim())) {
        throw safetyError("Saved profile data is damaged. Download a recovery copy before making changes.");
      }
    }
  }
  function downloadRecovery() {
    const raw = { ...snapshot(), [journalKey]: localStorage.getItem(journalKey) };
    const blob = new Blob([JSON.stringify({ format: "neumorphism-pomodoro-recovery", version: 1, raw }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "pomodoro-recovery.json";
    document.body.appendChild(link);
    link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  api = { recover, transact, inspect, downloadRecovery, get blocked() { return blocked; } };
  window.PomodoroStorageSafety = api;
})();
