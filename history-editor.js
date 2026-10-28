// History mutations are persisted atomically by changeSessionHistory in script.js.
(() => {
  const el = id => document.getElementById(id);
  const dialog = el('sessionHistoryDialog');
  const list = el('sessionHistoryList');
  const form = el('sessionHistoryEditForm');
  const date = el('sessionHistoryDate');
  const label = el('sessionHistoryTask');
  const queue = el('sessionHistoryQueue');
  let editingId = null, limit = 50;
  const status = message => { el('sessionHistoryStatus').textContent = message; };
  const button = (text, action) => {
    const node = document.createElement('button');
    node.type = 'button'; node.className = 'profile-text-button'; node.textContent = text;
    node.addEventListener('click', action); return node;
  };
  function cancelEdit() { editingId = null; form.hidden = true; }
  function edit(entry) {
    editingId = entry.id; form.hidden = false; label.value = entry.task;
    queue.replaceChildren();
    const options = [{id: '', name: 'Custom label (no task link)'}, ...taskQueue];
    if (entry.taskId && !taskQueue.some(task => task.id === entry.taskId))
      options.push({id: entry.taskId, name: `${entry.task || 'Previous task'} (removed from queue)`});
    options.forEach(task => {
      const option = document.createElement('option'); option.value = task.id; option.textContent = task.name;
      queue.appendChild(option);
    });
    queue.value = entry.taskId || ''; label.focus();
  }
  function render() {
    if (!dialog.open) return;
    const selected = date.value ? date.value.split('-').map(Number).join('-') : null;
    const entries = focusHistory.entries.filter(entry => !selected || entry.day === selected)
      .slice().sort((a,b) => b.endedAt - a.endedAt);
    list.replaceChildren();
    entries.slice(0, limit).forEach(entry => {
      const row = document.createElement('li');
      const name = document.createElement('p'); name.textContent = entry.task || 'Focus session';
      const detail = document.createElement('p'); detail.className = 'profile-save-note';
      detail.textContent = `${new Date(entry.endedAt).toLocaleString()} · ${Math.round(entry.seconds / 60)} min`;
      const actions = document.createElement('div'); actions.className = 'history-toolbar';
      const editButton = button('Edit', () => edit(entry));
      editButton.setAttribute('aria-label', `Edit ${entry.task || 'focus session'}`);
      const remove = button('Delete', () => {
        const result = changeSessionHistory('delete', entry.id); status(result.message);
        if (result.ok) { cancelEdit(); el('undoSessionHistory').focus(); }
      });
      remove.setAttribute('aria-label', `Delete ${entry.task || 'focus session'}`);
      actions.appendChild(editButton); actions.appendChild(remove);
      row.appendChild(name); row.appendChild(detail); row.appendChild(actions); list.appendChild(row);
    });
    if (!entries.length) {
      const empty = document.createElement('li'); empty.textContent = 'No sessions for this date.'; list.appendChild(empty);
    }
    el('moreSessionHistory').hidden = entries.length <= limit;
    el('undoSessionHistory').disabled = !focusHistory.undo?.length;
  }
  window.renderSessionHistory = render;
  el('openSessionHistory').addEventListener('click', () => {
    const parts = selectedHistoryDay.split('-'); date.value = `${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`;
    limit = 50; cancelEdit(); status(''); hideHistoryPopup(); dialog.showModal(); render(); date.focus();
  });
  el('closeSessionHistory').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    cancelEdit(); setSidebarOpen(true); el('openSessionHistory').focus();
  });
  date.addEventListener('change', () => { limit = 50; cancelEdit(); render(); });
  el('allSessionHistory').addEventListener('click', () => { date.value = ''; limit = 50; cancelEdit(); render(); });
  el('moreSessionHistory').addEventListener('click', () => { limit += 50; render(); });
  el('cancelSessionHistoryEdit').addEventListener('click', () => { cancelEdit(); date.focus(); });
  queue.addEventListener('change', () => {
    const task = taskQueue.find(item => item.id === queue.value); if (task) label.value = task.name;
  });
  label.addEventListener('input', () => { queue.value = ''; });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const result = changeSessionHistory('edit', editingId, label.value, queue.value || null);
    status(result.message); if (result.ok) { cancelEdit(); el('undoSessionHistory').focus(); }
  });
  el('undoSessionHistory').addEventListener('click', () => {
    const result = changeSessionHistory('undo'); status(result.message);
    if (result.ok) { cancelEdit(); if (el('undoSessionHistory').disabled) date.focus(); }
  });
})();
