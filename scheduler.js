(function (root) {
  'use strict';
  const labels = { must: '必須', due: '期限付き', want: 'やりたいこと' };
  const priorities = { must: 0, due: 1, want: 2 };
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const clamp = (value, low, high, fallback) => Number.isFinite(Number(value)) ? Math.min(high, Math.max(low, Math.round(Number(value)))) : fallback;
  function dateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
  function dateObject(key) { return new Date(`${key}T12:00:00`); }
  function shiftDate(key, amount) { const date = dateObject(key); date.setDate(date.getDate() + amount); return dateKey(date); }
  function minutes(time) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : NaN; }
  function timeLabel(value) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
  function duration(value) { return value >= 60 ? `${Math.floor(value / 60)}時間${value % 60 ? `${value % 60}分` : ''}` : `${value}分`; }
  function slotList(slots) {
    return Array.isArray(slots) ? slots.filter(item => object(item) && Number.isFinite(minutes(item.s)) && minutes(item.e) > minutes(item.s)).map(item => ({ s: item.s, e: item.e })) : [];
  }
  function normalizeSlots(slots) {
    const sorted = slotList(slots).map(item => ({ s: minutes(item.s), e: minutes(item.e) })).sort((a, b) => a.s - b.s);
    const merged = [];
    for (const slot of sorted) {
      const last = merged[merged.length - 1];
      if (last && slot.s <= last.e) last.e = Math.max(last.e, slot.e);
      else merged.push({ ...slot });
    }
    return merged;
  }
  function dateMap(value, numbers = false) {
    const result = {};
    if (object(value)) for (const [key, item] of Object.entries(value)) {
      if (datePattern.test(key) && (numbers ? Number.isFinite(Number(item)) && Number(item) > 0 : item === true)) result[key] = numbers ? clamp(item, 1, 1440, 30) : true;
    }
    return result;
  }
  function migrate(raw, today = dateKey()) {
    if (!object(raw) || !Array.isArray(raw.tasks) || !Array.isArray(raw.slots)) throw new Error('予定データの形式が正しくありません。');
    const state = { version: 2, tasks: [], slots: slotList(raw.slots), days: {}, hist: {}, preferences: { focus: 50, rest: 10, buffer: 30 } };
    const used = new Set();
    raw.tasks.forEach((item, index) => {
      if (!object(item) || typeof item.nm !== 'string') throw new Error('タスクの形式が正しくありません。');
      let id = String(item.id ?? `import-${index}`);
      while (used.has(id)) id += '-copy';
      used.add(id);
      const days = Array.isArray(item.days) ? [...new Set(item.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))] : [];
      const daily = Boolean(item.daily || days.length);
      const completions = dateMap(item.completions), skips = dateMap(item.skips), actuals = dateMap(item.actuals, true);
      if (daily && datePattern.test(item.doneOn || '')) completions[item.doneOn] = true;
      if (datePattern.test(item.skipOn || '')) skips[item.skipOn] = true;
      if (item.act && datePattern.test(item.actOn || '')) actuals[item.actOn] = clamp(item.act, 1, 1440, 30);
      state.tasks.push({
        id, nm: item.nm.trim().slice(0, 160) || '名称未設定', min: clamp(item.min, item.fixedEstimate ? 1 : 5, 1440, 30),
        ty: labels[item.ty] ? item.ty : 'want', dl: datePattern.test(item.dl || '') ? item.dl : '', daily, days,
        createdOn: datePattern.test(item.createdOn || '') ? item.createdOn : today,
        doneDate: daily ? '' : datePattern.test(item.doneDate || '') ? item.doneDate : item.done ? today : '',
        hold: datePattern.test(item.hold || '') ? item.hold : '', until: datePattern.test(item.until || '') ? item.until : '',
        completions, skips, actuals, minutesOn: dateMap(item.minutesOn, true), fixedEstimate: Boolean(item.fixedEstimate)
      });
    });
    if (object(raw.hist)) for (const [name, values] of Object.entries(raw.hist)) {
      if (Array.isArray(values)) Object.defineProperty(state.hist, name, { value: values.filter(n => Number.isFinite(n) && n > 0).slice(-5), writable: true, enumerable: true, configurable: true });
    }
    if (object(raw.preferences)) {
      state.preferences.focus = clamp(raw.preferences.focus, 5, 180, 50);
      state.preferences.rest = clamp(raw.preferences.rest, 0, 30, 10);
      state.preferences.buffer = clamp(raw.preferences.buffer, 0, 60, 30);
    }
    if (object(raw.days)) for (const [key, value] of Object.entries(raw.days)) {
      if (datePattern.test(key) && object(value)) {
        state.days[key] = {};
        if (Array.isArray(value.slots)) state.days[key].slots = slotList(value.slots);
        if (Array.isArray(value.order)) state.days[key].order = [...new Set(value.order.map(String))];
      }
    }
    if (object(raw.man) && datePattern.test(raw.man.on || '') && Array.isArray(raw.man.ids)) {
      state.days[raw.man.on] = { ...(state.days[raw.man.on] || {}), order: raw.man.ids.map(String) };
    }
    return state;
  }
  function defaultState(today = dateKey()) {
    return migrate({ tasks: [
      { id: '1', nm: '基本情報の勉強', min: 90, ty: 'must' },
      { id: '2', nm: 'レポート', min: 120, ty: 'due' },
      { id: '3', nm: '競プロ1問', min: 30, ty: 'want' }
    ], slots: [{ s: '09:00', e: '11:00' }, { s: '12:30', e: '13:30' }, { s: '16:00', e: '20:00' }] }, today);
  }
  function isDone(task, date) { return task.daily ? Boolean(task.completions[date]) : task.doneDate === date; }
  function isActive(task, date) {
    return task.createdOn <= date && (!task.until || task.until >= date) && (!task.hold || task.hold <= date) && !task.skips[date]
      && (!task.daily || !task.days.length || task.days.includes(dateObject(date).getDay()))
      && (task.daily || !task.doneDate || task.doneDate >= date);
  }
  function estimate(task, state, date) {
    if (task.minutesOn[date]) return task.minutesOn[date];
    const history = Object.hasOwn(state.hist, task.nm) ? state.hist[task.nm] : [];
    if (task.fixedEstimate || !history?.length) return task.min;
    return clamp(Math.round(task.min * history.reduce((a, b) => a + b, 0) / history.length / 5) * 5, 5, 1440, task.min);
  }
  function getSlots(state, date) { return state.days[date]?.slots ?? state.slots; }
  function plan(state, date) {
    const slots = normalizeSlots(getSlots(state, date));
    const order = state.days[date]?.order;
    const queue = state.tasks.filter(task => isActive(task, date)).map(task => ({ task, total: estimate(task, state, date), remaining: estimate(task, state, date) }));
    queue.sort((a, b) => {
      if (order) {
        const ai = order.indexOf(a.task.id), bi = order.indexOf(b.task.id);
        if (ai !== bi) return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi);
      }
      return priorities[a.task.ty] - priorities[b.task.ty] || (a.task.dl || '9999').localeCompare(b.task.dl || '9999');
    });
    const blocks = [], prefs = state.preferences;
    slots.forEach((slot, index) => {
      // Reserve slack only when the final time window can support it.
      const buffer = index === slots.length - 1 && slot.e - slot.s >= prefs.buffer + 30 ? prefs.buffer : 0;
      const end = slot.e - buffer;
      let cursor = slot.s, needsRest = false;
      for (const item of queue) {
        while (item.remaining > 0 && cursor < end) {
          if (needsRest && prefs.rest) {
            if (end - cursor < prefs.rest + Math.min(5, item.remaining)) break;
            blocks.push({ s: cursor, e: cursor + prefs.rest, ty: 'rest', nm: 'ひと息つく', si: index });
            cursor += prefs.rest;
          }
          needsRest = false;
          const amount = Math.min(item.remaining, prefs.focus, end - cursor);
          if (amount < 5 && amount < item.remaining) break;
          blocks.push({ s: cursor, e: cursor + amount, ty: item.task.ty, nm: item.task.nm, id: item.task.id, si: index, done: isDone(item.task, date) });
          cursor += amount;
          item.remaining -= amount;
          needsRest = true;
        }
      }
      if (cursor < end) blocks.push({ s: cursor, e: end, ty: 'free', nm: '自由に使える時間', si: index });
      if (buffer) blocks.push({ s: end, e: slot.e, ty: 'buffer', nm: '予定が延びたときの余白', si: index });
    });
    const left = queue.filter(item => item.remaining > 0 && !isDone(item.task, date));
    return { blocks, slots, queue, left, free: slots.reduce((sum, slot) => sum + slot.e - slot.s, 0),
      work: queue.reduce((sum, item) => sum + item.total, 0), remaining: queue.filter(item => !isDone(item.task, date)).reduce((sum, item) => sum + item.total, 0) };
  }
  function toggleTask(task, date) {
    if (task.daily) { if (task.completions[date]) delete task.completions[date]; else task.completions[date] = true; }
    else task.doneDate = task.doneDate === date ? '' : date;
  }
  function carryRemaining(state, date, ids) {
    const current = plan(state, date), tomorrow = shiftDate(date, 1);
    const chosen = current.left.filter(item => !ids || ids.includes(item.task.id));
    chosen.forEach(item => {
      const task = item.task, scheduled = item.total - item.remaining;
      if (task.daily) {
        if (scheduled) task.minutesOn[date] = scheduled;
        else task.skips[date] = true;
      } else if (!scheduled) task.hold = tomorrow;
      else {
        task.minutesOn[date] = scheduled;
        task.until = date;
        state.tasks.push({ ...task, id: `carry-${task.id}-${date}`, nm: task.nm.replace(/（続き）$/, '') + '（続き）',
          min: item.remaining, createdOn: tomorrow, hold: '', until: '', doneDate: '', completions: {}, skips: {}, actuals: {}, minutesOn: {}, fixedEstimate: true });
      }
    });
    return chosen.length;
  }
  const api = { labels, priorities, dateKey, dateObject, shiftDate, minutes, timeLabel, duration, normalizeSlots, migrate, defaultState, isDone, isActive, estimate, getSlots, plan, toggleTask, carryRemaining };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scheduler = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
