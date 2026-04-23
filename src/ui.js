
export function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
export function hide(id) { document.getElementById(id)?.classList.add('hidden'); }


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
