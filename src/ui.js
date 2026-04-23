export function fmt(seconds) {
  const m  = Math.floor(seconds / 60);
  const s  = Math.floor(seconds % 60);
  const cs = Math.floor((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function fmtShort(seconds) {
  const m  = Math.floor(seconds / 60);
  const s  = Math.floor(seconds % 60);
  const ds = Math.floor((seconds % 1) * 10);
  return `${m}:${String(s).padStart(2, '0')}.${ds}`;
}

export function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
export function hide(id) { document.getElementById(id)?.classList.add('hidden'); }

export function updateTimers(p1Time, p2Time) {
  document.getElementById('hud-time-p1').textContent = fmtShort(p1Time);
  document.getElementById('hud-time-p2').textContent = fmtShort(p2Time);
}

export function updateWallIndicator(playerId, used) {
  const ind  = document.getElementById(`wall-ind-p${playerId}`);
  const text = document.getElementById(`wall-text-p${playerId}`);
  if (!ind || !text) return;
  if (used) {
    text.textContent = 'FAKE WALL USED';
    text.classList.add('used');
  } else {
    text.textContent = 'FAKE WALL READY';
    text.classList.remove('used');
  }
}
