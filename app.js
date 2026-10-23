'use strict';
(() => {
  const C = window.Scheduler;
  const $ = id => document.getElementById(id);
  const KEY = 'sched.v2';
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  let today = C.dateKey(), selected = today, filter = 'day', state, editId = null, actualDate = today;
  let storageBlocked = false, undoState = null, toastTimer, pendingImport = null;
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem('sched.v1');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.version > 2) throw new Error('このアプリより新しい形式のデータです。');
      state = C.migrate(parsed, today);
    } else state = C.defaultState(today);
  } catch (error) {
    state = C.defaultState(today);
    storageBlocked = true;
    showStorageWarning('保存済みデータを読み込めませんでした。元の保存データは上書きしていません。「データ」からバックアップを復元してください。');
  }
  try { document.documentElement.dataset.theme = localStorage.getItem('sched.theme') || 'light'; } catch (_) {}
  function showStorageWarning(message) {
    $('storage-warning').textContent = message;
    $('storage-warning').hidden = false;
    $('storage-status').innerHTML = `${icon('shield')}<span>保存を確認してください</span>`;
  }
  function save() {
    if (storageBlocked) { showStorageWarning('保存済みデータを保護するため、変更の保存を停止しています。「データ」からバックアップを復元してください。'); return false; }
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      $('storage-warning').hidden = true;
      $('storage-status').innerHTML = `${icon('shield')}<span>このブラウザに保存</span>`;
      return true;
    } catch (_) {
      showStorageWarning('ブラウザに保存できませんでした。今の変更はこの画面にだけ残っています。「データ」からバックアップを保存してください。');
      return false;
    }
  }
  function notify(message, canUndo = false) {
    clearTimeout(toastTimer);
    $('toast-message').textContent = message;
    $('undo-button').hidden = !canUndo;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, canUndo ? 18000 : 7000);
  }
  function mutate(change, message, reversible = false) {
    undoState = reversible ? JSON.stringify(state) : null;
    change();
    const saved = save();
    render();
    if (message) notify(saved ? message : `${message}（保存はできていません）`, reversible);
  }
  function taskById(id) { return state.tasks.find(task => task.id === id); }
  function dateText(key) { return new Intl.DateTimeFormat('ja-JP', { month: 'long', day: 'numeric', weekday: 'long' }).format(C.dateObject(key)); }
  function numericDuration(value) {
    return value >= 60 ? `${Math.floor(value / 60)}<span>時間</span>${value % 60 ? `${value % 60}<span>分</span>` : ''}` : `${value}<span>分</span>`;
  }
  function dueText(task) {
    if (!task.dl) return '';
    const diff = Math.round((C.dateObject(task.dl) - C.dateObject(selected)) / 86400000);
    return diff < 0 ? '期限を過ぎています' : diff === 0 ? 'この日が期限' : diff === 1 ? '翌日が期限' : `${Number(task.dl.slice(5, 7))}/${Number(task.dl.slice(8))} まで`;
  }
  function renderWeek() {
    $('month-title').textContent = new Intl.DateTimeFormat('ja-JP', { year: 'numeric', month: 'long' }).format(C.dateObject(selected));
    $('date-picker').value = selected;
    const first = C.shiftDate(selected, -((C.dateObject(selected).getDay() + 6) % 7));
    $('week-days').innerHTML = Array.from({ length: 7 }, (_, i) => {
      const date = C.shiftDate(first, i), object = C.dateObject(date), count = state.tasks.filter(task => C.isActive(task, date)).length;
      return `<button class="day-button${date === selected ? ' selected' : ''}${date === today ? ' is-today' : ''}${count ? ' has-tasks' : ''}" data-date="${date}" aria-pressed="${date === selected}" aria-label="${dateText(date)}${date === today ? '、今日' : ''}、タスク${count}件"><span class="day-name">${weekdays[object.getDay()]}</span><span class="day-number">${object.getDate()}</span><span class="day-dot" aria-hidden="true"></span></button>`;
    }).join('');
  }
  function renderStats(plan) {
    const tasks = plan.queue.map(item => item.task), done = tasks.filter(task => C.isDone(task, selected)).length;
    const percent = tasks.length ? Math.round(done / tasks.length * 100) : 0;
    const openMinutes = plan.blocks.filter(block => block.ty === 'free').reduce((sum, block) => sum + block.e - block.s, 0);
    $('stat-count').innerHTML = `${tasks.length}<span>件</span>`;
    $('stat-count-caption').textContent = done ? `${done}件できました · 残り${tasks.length - done}件` : tasks.length ? 'ひとつずつ進めましょう' : 'まずはひとつ、追加してみましょう';
    $('stat-work').innerHTML = numericDuration(plan.work);
    $('stat-work-caption').textContent = `未完了 ${C.duration(plan.remaining)}`;
    $('stat-free').innerHTML = numericDuration(plan.free);
    $('stat-free-caption').textContent = `自由に使える時間 ${C.duration(openMinutes)}`;
    $('stat-progress').innerHTML = `${percent}<span>%</span>`;
    $('progress-fill').style.width = `${percent}%`;
    $('progress-bar').setAttribute('aria-valuenow', String(percent));
    $('pace-copy').textContent = percent === 100 ? 'この日のやること、全部できました。残りの時間はゆっくり自分のために。' : plan.left.length ? '入りきらなかった分は、翌日へ。必要なことから、無理なく進めましょう。' : '集中する時間と、ひと息つく時間。無理のない一日を組み立てましょう。';
  }
  function renderFocus(plan) {
    const now = new Date(), nowMinutes = selected === today ? now.getHours() * 60 + now.getMinutes() : -1;
    const unfinished = plan.blocks.filter(block => block.id && !block.done);
    const next = unfinished.find(block => block.e > nowMinutes) || unfinished[0];
    const allDone = plan.queue.length && plan.queue.every(item => C.isDone(item.task, selected));
    if (next) {
      const current = selected === today && next.s <= nowMinutes && next.e > nowMinutes;
      const past = selected === today && next.e <= nowMinutes;
      $('focus-card').innerHTML = `<div class="focus-symbol">${icon(current ? 'clock' : 'leaf')}</div><div class="focus-body"><p class="focus-label">${current ? 'いま取り組むこと' : past ? 'まだ残っていること' : '次のひとつ'}</p><p class="focus-title">${escape(next.nm)}</p><p class="focus-meta">${C.timeLabel(next.s)}–${C.timeLabel(next.e)} · ${next.e - next.s}分 · ${C.labels[next.ty]}</p></div><button class="icon-button" data-action="edit" data-id="${escape(next.id)}" aria-label="${escape(next.nm)}の詳細">${icon('arrow')}</button>`;
    } else {
      $('focus-card').innerHTML = `<div class="focus-symbol">${icon(allDone ? 'check' : 'leaf')}</div><div class="focus-body"><p class="focus-label">${allDone ? 'よくできました' : '一日を組み立てましょう'}</p><p class="focus-title">${allDone ? 'この日のタスクは、すべて完了。' : plan.queue.length ? '使える時間を追加してみましょう。' : 'まずは、やることをひとつ。'}</p></div>`;
    }
  }
  function renderTimeline(plan) {
    $('timeline-heading').textContent = selected === today ? '今日のタイムライン' : `${Number(selected.slice(5, 7))}月${Number(selected.slice(8))}日のタイムライン`;
    const manual = Boolean(state.days[selected]?.order);
    $('plan-mode').innerHTML = `<span class="tiny-dot"></span>${manual ? '順番を調整中' : '自動でプラン'}`;
    $('reset-order').hidden = !manual;
    $('plan-caption').textContent = manual ? '矢印で、タスクの順番を調整できます。' : '優先度に合わせて、休憩もいっしょに。';
    renderFocus(plan);
    const ids = plan.queue.map(item => item.task.id);
    $('timeline').innerHTML = plan.slots.map((slot, si) => {
      const rows = plan.blocks.filter(block => block.si === si).map(block => {
        const task = block.id ? taskById(block.id) : null, index = ids.indexOf(block.id);
        const taskButtons = task ? `<div class="block-actions"><div class="move-actions"><button class="move-button" data-action="up" data-id="${escape(task.id)}" aria-label="${escape(task.nm)}を前へ"${index === 0 ? ' disabled' : ''}>↑</button><button class="move-button" data-action="down" data-id="${escape(task.id)}" aria-label="${escape(task.nm)}を後へ"${index === ids.length - 1 ? ' disabled' : ''}>↓</button></div><button class="done-toggle" data-action="toggle" data-id="${escape(task.id)}" aria-pressed="${block.done}" aria-label="${escape(task.nm)}を${block.done ? '未完了に戻す' : '完了にする'}">${block.done ? icon('check') : ''}</button></div>` : '';
        return `<div class="timeline-row ${block.ty}${block.done ? ' is-done' : ''}"><time class="time-stamp">${C.timeLabel(block.s)}</time><span class="timeline-dot" aria-hidden="true"></span><div class="time-block"><div class="block-body"><p class="block-name">${escape(block.nm)}</p><div class="block-meta"><span>${C.timeLabel(block.s)}–${C.timeLabel(block.e)}</span><span>${block.e - block.s}分</span>${task ? `<span class="block-badge">${block.done ? '完了' : C.labels[block.ty]}</span>` : ''}</div></div>${taskButtons}</div></div>`;
      }).join('');
      return `<div class="time-window">${icon('clock')} ${C.timeLabel(slot.s)}–${C.timeLabel(slot.e)} <span>使える時間 ${C.duration(slot.e - slot.s)}</span></div>${rows}`;
    }).join('') || `<div class="empty-state">${icon('calendar')}<strong>使える時間を教えてください。</strong><p>時間帯を入れると、自動で予定が並びます。</p><button class="soft-button" data-action="slots">使える時間を設定</button></div>`;
    $('overflow').hidden = !plan.left.length;
    $('overflow').innerHTML = plan.left.length ? `<h3>この日は、少し入りきらないようです。</h3><p>残りは翌日へ回すか、使える時間を増やせます。</p><ul>${plan.left.map(item => `<li>${escape(item.task.nm)} · 残り${item.remaining}分</li>`).join('')}</ul><button class="secondary" data-action="carry">残りを翌日に回す ${icon('arrow')}</button>` : '';
  }
  function taskRow(task, deferred = false) {
    const done = filter === 'all' && !task.daily ? Boolean(task.doneDate) : C.isDone(task, selected);
    const estimate = C.estimate(task, state, selected);
    const active = C.isActive(task, selected), repeat = task.daily ? task.days.length ? task.days.map(day => weekdays[day]).join('・') : '毎日' : '';
    const deadline = dueText(task), future = task.hold > selected ? task.hold : task.createdOn > selected ? task.createdOn : '';
    return `<li class="task-item${done ? ' done' : ''}${deferred ? ' deferred' : ''}"><button class="task-check" data-action="toggle" data-id="${escape(task.id)}" aria-pressed="${done}" aria-label="${escape(task.nm)}を${done ? '未完了に戻す' : '完了にする'}"${!active && (task.daily || !done) ? ' disabled' : ''}>${done ? icon('check') : ''}</button><div class="task-body"><button class="task-name" data-action="edit" data-id="${escape(task.id)}">${escape(task.nm)}</button><div class="task-tags"><span>${estimate}分${estimate !== task.min ? `（入力${task.min}分）` : ''}</span><span class="task-tag ${task.ty}">${C.labels[task.ty]}</span>${repeat ? `<span>↻ ${repeat}</span>` : ''}${deadline ? `<span class="${task.dl < selected && !done ? 'deadline-overdue' : ''}">${deadline}</span>` : ''}${future ? `<span>${Number(future.slice(5, 7))}/${Number(future.slice(8))} から</span>` : ''}${task.daily && task.skips[selected] ? '<span>この日はスキップ</span>' : ''}${done && task.doneDate && task.doneDate !== selected ? `<span>${task.doneDate} 完了</span>` : ''}</div>${deferred && task.createdOn <= selected ? `<button class="text-button" data-action="restore" data-id="${escape(task.id)}">この日に戻す</button>` : ''}</div><div class="task-row-actions"><button class="icon-button task-edit" data-action="edit" data-id="${escape(task.id)}" aria-label="${escape(task.nm)}を編集">${icon('edit')}</button><button type="button" class="task-delete" data-action="delete" data-id="${escape(task.id)}" aria-label="${escape(task.nm)}を削除">削除</button></div></li>`;
  }
  function renderTasks() {
    document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === filter)));
    const tasks = state.tasks.filter(task => filter === 'all' || C.isActive(task, selected));
    tasks.sort((a, b) => Number(a.daily ? C.isDone(a, selected) : Boolean(a.doneDate)) - Number(b.daily ? C.isDone(b, selected) : Boolean(b.doneDate)) || C.priorities[a.ty] - C.priorities[b.ty]);
    $('task-count').textContent = tasks.length;
    let html = tasks.map(task => taskRow(task)).join('') || '<li class="empty-state"><strong>やることは、ここに。</strong><p>タスクを入れて、一日を始めましょう。</p></li>';
    if (filter === 'day') {
      const future = state.tasks.filter(task => !C.isActive(task, selected) && !task.doneDate && (task.hold > selected && task.createdOn <= selected || task.daily && task.skips[selected] || task.createdOn === C.shiftDate(selected, 1)));
      if (future.length) html += `<li class="task-subheading">翌日以降・この日はお休み</li>${future.map(task => taskRow(task, true)).join('')}`;
    }
    $('task-list').innerHTML = html;
  }
  function render() {
    const plan = C.plan(state, selected);
    renderWeek(); renderStats(plan); renderTimeline(plan); renderTasks();
    $('slot-summary').innerHTML = plan.slots.map(slot => `<div class="slot-summary-row"><span>${C.timeLabel(slot.s)} <span class="muted">—</span> ${C.timeLabel(slot.e)}</span><span>${C.duration(slot.e - slot.s)}</span></div>`).join('') || '<p class="small muted">使える時間は未設定です。</p>';
    const raw = C.getSlots(state, selected), rawSum = raw.reduce((sum, slot) => sum + C.minutes(slot.e) - C.minutes(slot.s), 0);
    $('slot-scope').textContent = `${state.days[selected]?.slots ? 'この日だけの時間帯' : '毎日の基本の時間帯'}${rawSum > plan.free ? ' · 重なった時間をまとめました' : ''}`;
    updateThemeLabel();
    if (timer) { renderTimerTasks(); renderTimer(); }
  }
  function chooseDate(date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(C.dateObject(date).getTime())) return;
    selected = date; render();
  }
  function newTask(name, minutes = 30, type = 'want') {
    return { id: globalThis.crypto?.randomUUID ? crypto.randomUUID() : `task-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      nm: name, min: minutes, ty: type, dl: '', daily: false, days: [], createdOn: selected, doneDate: '', hold: '', until: '', completions: {}, skips: {}, actuals: {}, minutesOn: {}, fixedEstimate: false };
  }
  function openTask(id = null) {
    const task = id ? taskById(id) : null;
    editId = task?.id ?? null;
    actualDate = task?.doneDate || selected;
    $('task-form').reset();
    $('task-dialog-title').textContent = task ? 'タスクを編集' : 'タスクを追加';
    $('task-name').value = task?.nm || '';
    $('task-minutes').value = task?.min || 30;
    $('task-minutes').min = task?.fixedEstimate ? '1' : '5';
    $('task-minutes').step = task?.fixedEstimate || task?.min % 5 ? '1' : '5';
    $('task-type').value = task?.ty || 'want';
    $('task-deadline').value = task?.dl || '';
    $('task-recurring').checked = task?.daily || false;
    $('repeat-fields').hidden = !$('task-recurring').checked;
    $('repeat-days').innerHTML = [1, 2, 3, 4, 5, 6, 0].map(day => `<label class="weekday-option"><input type="checkbox" value="${day}" aria-label="${weekdays[day]}曜日"${task?.days.includes(day) ? ' checked' : ''}><span>${weekdays[day]}</span></label>`).join('');
    $('actual-field').hidden = !task || !(task.daily ? C.isDone(task, selected) : task.doneDate);
    $('task-actual').value = task?.actuals[actualDate] || '';
    $('task-actual').disabled = $('actual-field').hidden;
    $('delete-task').hidden = !task;
    $('edit-note').hidden = !task?.daily;
    $('task-dialog').showModal();
    $('task-name').focus();
  }
  $('task-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('task-name').value.trim();
    if (!name) { $('task-name').focus(); return; }
    const existing = editId ? taskById(editId) : null;
    const days = [...$('repeat-days').querySelectorAll('input:checked')].map(input => Number(input.value));
    mutate(() => {
      const task = existing || newTask(name);
      const oldName = task.nm, oldMin = task.min, oldActual = task.actuals[actualDate];
      task.nm = name; task.min = Number($('task-minutes').value); task.ty = $('task-type').value; task.dl = $('task-deadline').value;
      const wasDaily = task.daily;
      task.daily = $('task-recurring').checked; task.days = task.daily ? days : [];
      if (wasDaily !== task.daily) {
        if (task.daily && task.doneDate) task.completions[task.doneDate] = true;
        if (!task.daily && task.completions[selected]) task.doneDate = selected;
        else task.doneDate = '';
      }
      if (existing && !$('task-actual').disabled) {
        const value = Number($('task-actual').value);
        if (oldActual) {
          const history = Object.hasOwn(state.hist, oldName) ? state.hist[oldName] : [];
          const at = history.lastIndexOf(oldActual / oldMin);
          if (at >= 0) history.splice(at, 1);
        }
        if (value > 0) {
          task.actuals[actualDate] = value;
          const history = Object.hasOwn(state.hist, name) ? state.hist[name] : [];
          history.push(value / task.min);
          Object.defineProperty(state.hist, name, { value: history.slice(-5), writable: true, enumerable: true, configurable: true });
        } else delete task.actuals[actualDate];
      }
      if (!existing) state.tasks.push(task);
    }, existing ? 'タスクを更新しました' : 'タスクを追加しました', true);
    $('task-dialog').close();
  });
  function deleteTask(id) {
    if (!taskById(id)) return;
    mutate(() => { state.tasks = state.tasks.filter(task => task.id !== id); }, 'タスクを削除しました', true);
  }
  $('delete-task').addEventListener('click', () => {
    deleteTask(editId);
    $('task-dialog').close();
  });
  $('task-recurring').addEventListener('change', () => { $('repeat-fields').hidden = !$('task-recurring').checked; });
  $('quick-form').addEventListener('submit', event => {
    event.preventDefault();
    const name = $('quick-name').value.trim();
    if (!name) return;
    mutate(() => { state.tasks.push(newTask(name)); }, '30分のタスクを追加しました', true);
    $('quick-name').value = ''; $('quick-name').focus();
  });
  function openSlots() {
    $('slots-date-label').textContent = `${dateText(selected)}の時間帯`;
    $('slot-fields').innerHTML = '';
    C.getSlots(state, selected).forEach(addSlotField);
    $('slots-default').checked = false;
    for (const [id, key] of [['focus-length', 'focus'], ['rest-length', 'rest'], ['buffer-length', 'buffer']]) {
      const select = $(id), value = state.preferences[key];
      if (![...select.options].some(option => Number(option.value) === value)) select.add(new Option(`${value}分`, String(value)));
      select.value = String(value);
    }
    $('slots-validation').hidden = true;
    $('use-default-slots').hidden = !state.days[selected]?.slots;
    $('slots-dialog').showModal();
  }
  function addSlotField(slot = { s: '20:00', e: '21:00' }) {
    const row = document.createElement('div'); row.className = 'slot-field-row';
    row.innerHTML = `<input type="time" class="slot-start" aria-label="時間帯の開始" required value="${escape(slot.s)}"><span>—</span><input type="time" class="slot-end" aria-label="時間帯の終了" required value="${escape(slot.e)}"><button type="button" class="icon-button remove-slot" aria-label="この時間帯を削除">${icon('close')}</button>`;
    $('slot-fields').append(row);
  }
  $('slots-form').addEventListener('submit', event => {
    event.preventDefault();
    const slots = [...$('slot-fields').querySelectorAll('.slot-field-row')].map(row => ({ s: row.querySelector('.slot-start').value, e: row.querySelector('.slot-end').value }));
    if (slots.some(slot => C.minutes(slot.e) <= C.minutes(slot.s))) {
      $('slots-validation').hidden = false;
      $('slots-validation').textContent = '終了時刻は開始時刻より後にしてください。日をまたぐ場合は日付を分けて設定します。';
      return;
    }
    mutate(() => {
      state.days[selected] ??= {};
      state.days[selected].slots = slots;
      if ($('slots-default').checked) { state.slots = slots; delete state.days[selected].slots; }
      state.preferences = { focus: Number($('focus-length').value), rest: Number($('rest-length').value), buffer: Number($('buffer-length').value) };
    }, '使える時間とプランを更新しました', true);
    $('slots-dialog').close();
  });
  $('add-slot').addEventListener('click', () => addSlotField());
  $('slot-fields').addEventListener('click', event => { if (event.target.closest('.remove-slot')) event.target.closest('.slot-field-row').remove(); });
  $('use-default-slots').addEventListener('click', () => {
    mutate(() => { if (state.days[selected]) delete state.days[selected].slots; }, '基本の時間帯に戻しました', true);
    $('slots-dialog').close();
  });
  function reorder(id, amount) {
    const ids = C.plan(state, selected).queue.map(item => item.task.id), at = ids.indexOf(id), target = at + amount;
    if (at < 0 || target < 0 || target >= ids.length) return;
    [ids[at], ids[target]] = [ids[target], ids[at]];
    mutate(() => { state.days[selected] ??= {}; state.days[selected].order = ids; }, 'タスクの順番を変更しました', true);
  }
  document.addEventListener('click', event => {
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.close) { $(button.dataset.close).close(); return; }
    if (button.dataset.date) { chooseDate(button.dataset.date); return; }
    if (button.dataset.filter) { filter = button.dataset.filter; renderTasks(); return; }
    const id = button.dataset.id, task = id ? taskById(id) : null;
    switch (button.dataset.action) {
      case 'edit': openTask(id); break;
      case 'delete': deleteTask(id); break;
      case 'toggle':
        if (task) {
          mutate(() => { if (!task.daily && task.doneDate && filter === 'all') task.doneDate = ''; else C.toggleTask(task, selected); }, '', true);
          notify(C.isDone(task, selected) ? 'ひとつ完了。おつかれさまでした！' : '未完了に戻しました', true);
          $('task-list').querySelector(`[data-action="toggle"][data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
        } break;
      case 'up': reorder(id, -1); break;
      case 'down': reorder(id, 1); break;
      case 'slots': openSlots(); break;
      case 'carry': mutate(() => { C.carryRemaining(state, selected); }, `残りを${dateText(C.shiftDate(selected, 1))}へ回しました`, true); break;
      case 'restore': if (task) mutate(() => { task.hold = ''; delete task.skips[selected]; }, 'この日の予定に戻しました', true); break;
    }
  });
  $('reset-order').addEventListener('click', () => { mutate(() => { delete state.days[selected].order; }, '優先度に合わせた順番に戻しました', true); });
  ['add-task', 'add-task-side', 'nav-task'].forEach(id => $(id).addEventListener('click', () => openTask()));
  ['go-today', 'nav-today'].forEach(id => $(id).addEventListener('click', () => chooseDate(today)));
  $('prev-week').addEventListener('click', () => chooseDate(C.shiftDate(selected, -7)));
  $('next-week').addEventListener('click', () => chooseDate(C.shiftDate(selected, 7)));
  $('date-picker').addEventListener('change', event => chooseDate(event.target.value));
  $('edit-slots').addEventListener('click', openSlots);
  function updateThemeLabel() { $('theme-button').setAttribute('aria-label', document.documentElement.dataset.theme === 'dark' ? 'ライトモードに切り替える' : 'ダークモードに切り替える'); }
  $('theme-button').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('sched.theme', theme); } catch (_) {}
    updateThemeLabel();
  });
  function openData() {
    $('import-file').value = ''; pendingImport = null; $('import-preview').hidden = true; $('confirm-import').hidden = true;
    $('data-dialog').showModal();
  }
  ['data-button', 'privacy-button'].forEach(id => $(id).addEventListener('click', openData));
  $('export-data').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = `hibi-backup-${today}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('バックアップの保存を開始しました');
  });
  $('import-file').addEventListener('change', async event => {
    const file = event.target.files[0]; pendingImport = null; $('confirm-import').hidden = true;
    if (!file) { $('import-preview').hidden = true; return; }
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('ファイルは2MB以下にしてください。');
      const raw = JSON.parse(await file.text());
      if (raw.version > 2) throw new Error('このアプリより新しい形式のバックアップです。');
      pendingImport = C.migrate(raw, today);
      $('import-preview').textContent = `タスク${pendingImport.tasks.length}件、基本の時間帯${pendingImport.slots.length}件を読み込みました。現在のデータを置き換えて復元します。`;
      $('confirm-import').hidden = false;
    } catch (error) { $('import-preview').textContent = `読み込めませんでした。${error.message}`; }
    $('import-preview').hidden = false;
  });
  $('confirm-import').addEventListener('click', () => {
    if (!pendingImport) return;
    const replacement = pendingImport;
    storageBlocked = false;
    mutate(() => { state = replacement; }, 'バックアップから復元しました', true);
    pendingImport = null; $('data-dialog').close();
  });
  $('undo-button').addEventListener('click', () => {
    if (!undoState) return;
    state = JSON.parse(undoState); undoState = null;
    save(); render(); notify('ひとつ前の状態に戻しました');
  });
  $('toast-close').addEventListener('click', () => { $('toast').hidden = true; clearTimeout(toastTimer); });
  document.addEventListener('keydown', event => {
    if (event.key.toLowerCase() === 'n' && !event.ctrlKey && !event.metaKey && !event.altKey && !event.target.closest('input,select,textarea,[contenteditable]') && !document.querySelector('dialog[open]')) {
      event.preventDefault(); openTask();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const next = C.dateKey();
    if (next !== today) { if (selected === today) selected = next; today = next; render(); }
  });
  window.addEventListener('storage', event => {
    if (event.key !== KEY || !event.newValue) return;
    try {
      const changed = JSON.parse(event.newValue);
      if (changed.version > 2) throw new Error('新しい形式');
      state = C.migrate(changed, today); undoState = null; render();
      notify('別のタブでの変更を反映しました');
    } catch (_) { notify('別のタブのデータを読み込めません。バックアップを保存してから再読み込みしてください。'); }
  });
  const P = window.Pomodoro, TIMER_KEY = 'sched.pomodoro.v1', baseTitle = document.title;
  const modeLabels = { focus: '集中', short: '短い休憩', long: '長い休憩' };
  let timer, audioContext;
  try { timer = P.create(JSON.parse(localStorage.getItem(TIMER_KEY) || '{}')); }
  catch (_) { timer = P.create(); }
  function saveTimer() {
    try { localStorage.setItem(TIMER_KEY, JSON.stringify(timer)); }
    catch (_) { notify('タイマーの状態を保存できません。この画面では続けて使えます。'); }
  }
  function prepareAudio() {
    if (!timer.sound) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!audioContext && Audio) audioContext = new Audio();
      if (audioContext?.state === 'suspended') audioContext.resume().catch(() => {});
    } catch (_) {}
  }
  function playTimerSound() {
    if (!timer.sound || audioContext?.state !== 'running') return;
    try {
      [0, .28].forEach(delay => {
        const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
        const start = audioContext.currentTime + delay;
        oscillator.frequency.value = 660;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(.12, start + .02);
        gain.gain.exponentialRampToValueAtTime(.001, start + .2);
        oscillator.connect(gain); gain.connect(audioContext.destination);
        oscillator.start(start); oscillator.stop(start + .22);
      });
    } catch (_) {}
  }
  function renderTimerTasks() {
    const tasks = state.tasks.filter(task => C.isActive(task, selected) && !C.isDone(task, selected));
    let options = '<option value="">タスクを指定しない</option>';
    if (timer.taskId && !tasks.some(task => task.id === timer.taskId)) options += `<option value="${escape(timer.taskId)}">${escape(timer.taskName)}（このセッション）</option>`;
    options += tasks.map(task => `<option value="${escape(task.id)}">${escape(task.nm)}</option>`).join('');
    $('timer-task').innerHTML = options; $('timer-task').value = timer.taskId;
    $('timer-task').disabled = timer.running;
  }
  function renderTimer() {
    const seconds = Math.ceil(timer.remainingMs / 1000), minutes = Math.floor(seconds / 60), remainder = seconds % 60;
    const display = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    const completed = timer.remainingMs === 0, paused = !timer.running && !completed && timer.remainingMs < timer.durationMs;
    const next = P.nextMode(timer, C.dateKey());
    const summary = timer.history[C.dateKey()] || { sessions: 0, minutes: 0 };
    $('timer-display').textContent = display;
    $('timer-display').setAttribute('aria-label', `残り${minutes}分${remainder}秒`);
    $('timer-ring-progress').setAttribute('stroke-dashoffset', String(490.088 * timer.remainingMs / timer.durationMs));
    $('timer-mode-label').textContent = timer.mode === 'focus' ? 'FOCUS TIME' : 'TAKE A BREATH';
    $('timer-duration-label').textContent = timer.mode === 'focus' ? `${timer.durations.focus}分、ひとつに集中。` : `${timer.durations[timer.mode]}分、ひと息つきましょう。`;
    $('timer-start').innerHTML = `${icon(timer.running ? 'pause' : 'play')}<span>${timer.running ? '一時停止' : completed ? `${modeLabels[next]}を始める` : paused ? '再開する' : `${modeLabels[timer.mode]}を始める`}</span>`;
    $('timer-start').setAttribute('aria-label', timer.running ? 'タイマーを一時停止' : completed ? `${modeLabels[next]}のタイマーを開始` : paused ? 'タイマーを再開' : `${modeLabels[timer.mode]}のタイマーを開始`);
    const status = completed ? `${modeLabels[timer.mode]}が終了しました。次は${modeLabels[next]}です。` : timer.running ? `${modeLabels[timer.mode]}しています${timer.taskName ? ` · ${timer.taskName}` : '。'}` : paused ? '一時停止中です。自分のペースで再開できます。' : '準備ができたら、始めましょう。';
    if ($('timer-status').textContent !== status) $('timer-status').textContent = status;
    $('timer-summary').textContent = `今日の集中 ${summary.sessions}回 · ${summary.minutes}分`;
    $('timer-sound').checked = timer.sound;
    $('timer-task').disabled = timer.running;
    $('timer-settings').disabled = timer.running;
    document.querySelectorAll('[data-timer-mode]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.timerMode === timer.mode)); button.disabled = timer.running;
    });
    document.title = timer.running ? `${display} ${modeLabels[timer.mode]} · 日々の余白` : baseTitle;
  }
  function tickTimer() {
    const now = Date.now(), completionDate = C.dateKey(new Date(timer.endsAt || now));
    const finished = P.advance(timer, now, completionDate);
    if (finished) {
      saveTimer(); playTimerSound();
      notify(timer.mode === 'focus' ? '集中、おつかれさまでした。休憩を取りましょう。' : '休憩が終わりました。次の集中へ進めます。');
    }
    renderTimer();
  }
  $('timer-start').addEventListener('click', () => {
    tickTimer();
    if (timer.running) P.pause(timer, Date.now(), C.dateKey());
    else {
      if (timer.remainingMs === 0) P.setMode(timer, P.nextMode(timer, C.dateKey()));
      prepareAudio(); P.start(timer, Date.now());
    }
    saveTimer(); renderTimer();
  });
  $('timer-reset').addEventListener('click', () => { P.reset(timer); saveTimer(); renderTimer(); });
  document.querySelectorAll('[data-timer-mode]').forEach(button => button.addEventListener('click', () => {
    if (timer.running || timer.mode === button.dataset.timerMode && timer.remainingMs > 0) return;
    P.setMode(timer, button.dataset.timerMode); saveTimer(); renderTimer();
  }));
  $('timer-task').addEventListener('change', event => {
    if (timer.running) return;
    timer.taskId = event.target.value; timer.taskName = taskById(timer.taskId)?.nm || '';
    saveTimer(); renderTimer();
  });
  $('timer-sound').addEventListener('change', event => { timer.sound = event.target.checked; prepareAudio(); saveTimer(); });
  $('timer-settings').addEventListener('click', () => {
    if (timer.running) return;
    for (const mode of Object.keys(modeLabels)) $(`timer-${mode}-minutes`).value = timer.durations[mode];
    $('timer-dialog').showModal();
  });
  $('nav-timer').addEventListener('click', () => {
    $('pomodoro-heading').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    $('pomodoro-heading').focus({ preventScroll: true });
  });
  $('timer-form').addEventListener('submit', event => {
    event.preventDefault();
    P.configure(timer, { focus: Number($('timer-focus-minutes').value), short: Number($('timer-short-minutes').value), long: Number($('timer-long-minutes').value) });
    saveTimer(); renderTimer(); $('timer-dialog').close(); notify('集中と休憩の時間を更新しました');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tickTimer(); });
  window.addEventListener('storage', event => {
    if (event.key !== TIMER_KEY || !event.newValue) return;
    try { timer = P.create(JSON.parse(event.newValue)); renderTimerTasks(); tickTimer(); } catch (_) {}
  });
  render(); tickTimer();
  setInterval(tickTimer, 1000);
})();
