(function (root) {
  'use strict';
  const defaults = { focus: 25, short: 5, long: 15 };
  const limits = { focus: 180, short: 60, long: 120 };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const integer = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Math.round(Number(value)))) : fallback;
  function create(raw = {}, now = Date.now()) {
    if (!object(raw)) raw = {};
    const durations = {};
    for (const mode of Object.keys(defaults)) durations[mode] = integer(raw.durations?.[mode] ?? defaults[mode], 1, limits[mode], defaults[mode]);
    const mode = Object.hasOwn(defaults, raw.mode) ? raw.mode : 'focus';
    const durationMs = durations[mode] * 60000;
    const running = raw.running === true && Number.isFinite(raw.endsAt) && raw.endsAt > 0;
    const endsAt = running ? Math.min(raw.endsAt, now + durationMs) : null;
    const history = {};
    if (object(raw.history)) for (const [date, record] of Object.entries(raw.history)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(date) && object(record)) history[date] = {
        sessions: integer(record.sessions, 0, 100000, 0), minutes: integer(record.minutes, 0, 18000000, 0)
      };
    }
    return { version: 1, durations, mode, durationMs, running, endsAt,
      remainingMs: running ? Math.max(0, endsAt - now) : integer(raw.remainingMs ?? durationMs, 0, durationMs, durationMs),
      taskId: typeof raw.taskId === 'string' ? raw.taskId.slice(0, 200) : '',
      taskName: typeof raw.taskName === 'string' ? raw.taskName.slice(0, 160) : '', sound: raw.sound !== false, history };
  }
  function advance(timer, now, date) {
    if (!timer.running) return false;
    timer.remainingMs = Math.max(0, timer.endsAt - now);
    if (timer.remainingMs > 0) return false;
    timer.running = false; timer.endsAt = null;
    if (timer.mode === 'focus') {
      timer.history[date] ??= { sessions: 0, minutes: 0 };
      timer.history[date].sessions += 1;
      timer.history[date].minutes += timer.durationMs / 60000;
    }
    return true;
  }
  function start(timer, now) {
    if (timer.running) return;
    if (!timer.remainingMs) timer.remainingMs = timer.durationMs;
    timer.endsAt = now + timer.remainingMs; timer.running = true;
  }
  function pause(timer, now, date) {
    const completed = advance(timer, now, date);
    timer.running = false; timer.endsAt = null;
    return completed;
  }
  function reset(timer) {
    timer.running = false; timer.endsAt = null;
    timer.durationMs = timer.durations[timer.mode] * 60000; timer.remainingMs = timer.durationMs;
  }
  function setMode(timer, mode) {
    if (!Object.hasOwn(defaults, mode)) return;
    timer.mode = mode; reset(timer);
  }
  function configure(timer, values) {
    for (const mode of Object.keys(defaults)) timer.durations[mode] = integer(values[mode], 1, limits[mode], defaults[mode]);
    reset(timer);
  }
  function nextMode(timer, date) {
    if (timer.mode !== 'focus') return 'focus';
    const completed = timer.history[date]?.sessions || 0;
    return completed > 0 && completed % 4 === 0 ? 'long' : 'short';
  }
  const api = { create, advance, start, pause, reset, setMode, configure, nextMode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pomodoro = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
