// One writer per origin: a second page must not initialize stale application state.
// Unlike a storage lease, a Web Lock cannot expire while its owner is backgrounded.
(() => {
  const guard = document.getElementById("tabGuard");
  const title = document.getElementById("tabGuardTitle");
  const message = document.getElementById("tabGuardMessage");
  const retry = document.getElementById("tabGuardRetry");
  const recovery = document.getElementById("tabGuardRecovery");
  const app = document.getElementById("pomodoroApp");
  const scripts = ["script.js", "mini-timer.js", "ambient.js", "data-tools.js", "history-editor.js"];
  let closed = false;

  retry.addEventListener("click", () => window.location.reload());
  recovery.addEventListener("click", () => {
    try { window.PomodoroStorageSafety.downloadRecovery(); }
    catch (_) { message.textContent = "Could not download the recovery copy. Your saved data has not been cleared."; }
  });

  function showError(heading, detail) {
    app.hidden = true;
    app.inert = true;
    guard.hidden = false;
    title.textContent = heading;
    message.textContent = detail;
    retry.hidden = false;
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        window.removeEventListener("error", runtimeError);
        script.onload = script.onerror = null;
        if (error) {
          script.remove?.();
          reject(error);
        } else resolve();
      };
      // An HTTP 200 does not mean the application script executed successfully.
      const runtimeError = (event) => {
        if (event.filename?.split(/[?#]/)[0].endsWith(`/${src}`))
          finish(new Error(`Could not initialize ${src}`));
      };
      const timeout = setTimeout(() => finish(new Error(`Loading ${src} timed out`)), 15000);
      window.addEventListener("error", runtimeError);
      script.src = src;
      script.onload = () => finish();
      script.onerror = () => finish(new Error(`Could not load ${src}`));
      document.body.appendChild(script);
    });
  }

  // A queued/discarded document must never boot after it has been navigated away.
  window.addEventListener("pagehide", () => { closed = true; });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) window.location.reload();
  });

  if (!navigator.locks?.request) {
    showError(
      "Open your timer securely",
      "This browser cannot protect your data across tabs here. Open the site over HTTPS or localhost in a browser with Web Locks support.",
    );
    return;
  }

  title.textContent = "Timer open in another tab?";
  message.textContent = "Only one Pomodoro tab can make changes at a time. If another tab is open, close it to continue here. Your saved timer and tasks will load automatically.";

  navigator.locks.request("neumorphism-pomodoro-app-v1", async () => {
    if (closed) return;
    title.textContent = "Opening your timer…";
    message.textContent = "Loading your saved timer and tasks.";
    try {
      await loadScript("storage-safety.js");
      if (closed) return;
      window.PomodoroStorageSafety.onBlocked = (error) => {
        window.pausePomodoroForRecovery?.();
        showError("Your saved data needs recovery", error.message);
        recovery.hidden = false;
      };
      window.PomodoroStorageSafety.recover();
      window.PomodoroStorageSafety.inspect();
      app.hidden = false;
      app.style.visibility = "hidden";
      // Do not read or write app state before ownership. On handoff each script
      // reads fresh storage, including the previous tab's latest task and deadline.
      for (const src of scripts) {
        if (closed) return;
        await loadScript(src);
      }
      if (closed) return;
      app.hidden = false;
      app.inert = false;
      app.style.visibility = "";
      guard.hidden = true;
    } catch (error) {
      if (error.storageSafety) {
        showError("Your saved data needs recovery", error.message);
        recovery.hidden = false;
      } else showError("Your timer could not load", "Check your connection and browser storage access, then try again. Your saved data has not been cleared.");
    }
    // Hold even after partial startup failure: an initialized timer may still be
    // running. The browser releases ownership when this document is destroyed.
    await new Promise(() => {});
  }).catch(() => {
    if (!closed) showError("Your timer could not open", "Tab protection is unavailable. Try reopening the site over HTTPS or localhost.");
  });
})();
