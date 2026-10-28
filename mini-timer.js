// A view of the existing timer, never a separate session or countdown.
(() => {
  const button = document.getElementById('miniTimerButton');
  const status = document.getElementById('miniTimerStatus');
  let mini = null, interval = null, view = null, opening = false;
  function resetButton() {
    button.textContent = 'Mini ↗';
    button.setAttribute('aria-pressed', 'false');
    button.disabled = false;
  }
  function cleanup(closed) {
    if (mini !== closed) return;
    if (interval !== null) closed.clearInterval(interval);
    interval = null; mini = null; view = null;
    resetButton();
  }
  function paint() {
    if (!mini || mini.closed || !view) return;
    const seconds = isRunning && timerDeadline
      ? Math.max(0, Math.ceil((timerDeadline - Date.now()) / 1000)) : remainingSeconds;
    const mode = currentMode === 'pomodoro' ? 'Focus' : currentMode === 'longBreak' ? 'Long break' : 'Short break';
    view.mode.textContent = "Pomodoro Timer";
    view.time.textContent = formatTime(seconds);
    view.dial.setAttribute('aria-label', `${completionPending ? 'Retry saving completed session' : isRunning ? 'Pause' : seconds < totalSeconds ? 'Resume' : 'Start'} · ${mode} · ${formatTime(seconds)} remaining`);
    view.dial.setAttribute('aria-pressed', String(isRunning));
    view.dial.classList.toggle('is-pushed', isRunning);
    view.plate.classList.toggle('is-running', isRunning);
    view.plate.classList.toggle('is-break', currentMode !== 'pomodoro');
    view.caption.textContent = currentMode === 'longBreak' ? 'Take a longer break' : 'Take a break';
    view.caption.setAttribute('aria-hidden', String(currentMode === 'pomodoro' || isRunning));
    view.state.textContent = isRunning ? 'Push to pause' : seconds < totalSeconds ? 'Push to resume' : 'Push to start';
    view.task.textContent = profile.showCurrentTask ? currentTask : '';
    view.task.hidden = !view.task.textContent;
    view.task.title = view.task.textContent;
    view.skip.hidden = currentMode === 'pomodoro';
    mini.document.title = `${formatTime(seconds)} · ${mode}`;
  }
  window.syncMiniTimer = paint;
  function createView(target, pinned) {
    const doc = target.document;
    doc.documentElement.lang = 'en';
    doc.head.replaceChildren(); doc.body.replaceChildren();
    // Reuse the actual main timer styles and fonts instead of approximating them.
    for (const href of [new URL('base.css', document.baseURI).href, new URL('style.css', document.baseURI).href,
      'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Short+Stack&display=swap']) {
      const link = doc.createElement('link'); link.rel = 'stylesheet'; link.href = href; doc.head.appendChild(link);
    }
    const style = doc.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}html{color-scheme:light}
      body{min-width:280px;min-height:100vh;padding:26px 24px;display:flex;align-items:center;justify-content:center;overflow-x:hidden}
      .mini-shell{display:flex;flex-direction:column;align-items:center;width:256px;max-width:100%;position:relative}
      header{width:100%;position:relative}.timer-title{margin:0 0 24px;text-align:center}
      .mini-return{position:absolute;right:-12px;top:-18px;font-size:12px;padding:6px 9px;opacity:1}
      .mini-return:hover,.mini-return:focus-visible{opacity:1}
      .squircle-plate{flex-shrink:0}
      .mini-task{font-family:'Short Stack',cursive,sans-serif;font-size:11px;line-height:1.6;color:#4b6575;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;margin:22px 0 0}
      .mini-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:28px}
      button:focus-visible{outline:2px solid #5882a0;outline-offset:4px}
      [hidden]{display:none!important}
    `;
    doc.head.appendChild(style);
    const main = doc.createElement('main'); main.className = 'stage-wrapper mini-shell';
    const header = doc.createElement('header');
    const mode = doc.createElement('h1'); mode.className = 'timer-title';
    const back = doc.createElement('button'); back.className = 'pill-btn mini-return'; back.textContent = '↗'; back.title = 'Return to main timer'; back.setAttribute('aria-label', 'Return to main timer');
    back.addEventListener('click', () => { window.focus(); target.close(); });
    header.appendChild(mode); header.appendChild(back); main.appendChild(header);
    const ring = doc.createElement('div'); ring.className = 'squircle-plate';
    const socket = doc.createElement('div'); socket.className = 'socket-well';
    const dial = doc.createElement('button'); dial.className = 'push-button-dial'; dial.type = 'button';
    const time = doc.createElement('output'); time.className = 'time-digits'; time.setAttribute('role', 'timer'); time.setAttribute('aria-live', 'off');
    dial.appendChild(time);
    const indicator = doc.createElement('span'); indicator.className = 'status-indicator'; indicator.setAttribute('aria-hidden', 'true'); dial.appendChild(indicator);
    socket.appendChild(dial); ring.appendChild(socket);
    const caption = doc.createElement('p'); caption.className = 'break-message'; ring.appendChild(caption);
    main.appendChild(ring);
    dial.addEventListener('click', () => { handleDialPress(); paint(); });
    const state = doc.createElement('p'); state.hidden = true; main.appendChild(state);
    const task = doc.createElement('p'); task.className = 'mini-task'; main.appendChild(task);
    const actions = doc.createElement('div'); actions.className = 'minimal-controls mini-actions';
    const reset = doc.createElement('button'); reset.className = 'pill-btn'; reset.textContent = 'Reset'; reset.addEventListener('click', () => { resetTimer(); paint(); });
    const skip = doc.createElement('button'); skip.className = 'pill-btn'; skip.textContent = 'Skip break'; skip.addEventListener('click', () => { skipBreak(); paint(); });
    actions.appendChild(reset); actions.appendChild(skip); main.appendChild(actions);

    doc.body.appendChild(main);
    target.addEventListener('keydown', (event) => {
      if (event.defaultPrevented || event.isComposing || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || event.target?.closest?.('button,input,textarea,select,[contenteditable]')) return;
      const space = event.code === 'Space' || event.key === ' ';
      if (!space && event.key?.toLowerCase() !== 'r') return;
      event.preventDefault(); if (event.repeat) return;
      if (space) handleDialPress(); else resetTimer();
      paint();
    });
    const quietTitle = target.setTimeout(() => main.classList.add('title-is-quiet'), 3500);
    target.addEventListener('pagehide', () => target.clearTimeout(quietTitle));
    return { mode, time, dial, state, task, skip, plate: ring, caption };
  }
  button.addEventListener('click', async () => {
    if (opening) return;
    if (mini && !mini.closed) { mini.close(); return; }
    opening = true; button.disabled = true; status.hidden = true;
    let opened;
    try {
      const pinned = typeof window.documentPictureInPicture?.requestWindow === 'function';
      if (pinned) opened = await window.documentPictureInPicture.requestWindow({ width: 340, height: 440 });
      else opened = window.open('', 'pomodoro-mini-timer', 'popup=yes,width=340,height=440,resizable=yes');
      if (!opened) throw new Error('blocked');
      mini = opened;
      view = createView(opened, pinned);
      opened.addEventListener('pagehide', () => cleanup(opened));
      paint();
      interval = opened.setInterval(() => {
        if (opened.closed) { cleanup(opened); return; }
        // The visible mini window can wake the existing deadline-based timer.
        if (isRunning) tickTimer();
        paint();
      }, 250);
      button.textContent = 'Close mini'; button.setAttribute('aria-pressed', 'true');
    } catch (_) {
      if (opened && !opened.closed) opened.close();
      mini = null; view = null; resetButton();
      status.textContent = 'Could not open the mini timer. Allow this site’s pop-up if it was blocked, then try again.';
      status.hidden = false;
    } finally { opening = false; button.disabled = false; }
  });
  window.addEventListener('pagehide', () => { if (mini && !mini.closed) mini.close(); });
})();
