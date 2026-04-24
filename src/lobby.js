// DOM controller for the Create / Join / Room lobby screens. Exposes an
// async `startLobby({ onEnterGame })` — resolves when the host fires START,
// hands `main.js` a { net, code, slot, isHost, difficulty, firstGameMsg } bundle.

import { Net } from './net.js';

const $ = (id) => document.getElementById(id);
function show(el) { el?.classList.remove('hidden'); }
function hide(el) { el?.classList.add('hidden'); }
function setText(el, t) { if (el) el.textContent = t; }

function readUrlParams() {
  const sp = new URLSearchParams(location.search);
  return { room: (sp.get('room') || '').toUpperCase() };
}

function clearRoomParam() {
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState({}, '', url.toString());
}

function setRoomParam(code) {
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  history.replaceState({}, '', url.toString());
}

/** @returns {Promise<boolean>} true if the server has an active room for this code */
async function roomExistsOnServer(code) {
  const r = await fetch(`/api/room/${encodeURIComponent(code)}`);
  if (r.status === 404) return false;
  if (!r.ok) throw new Error(`room lookup ${r.status}`);
  return true;
}

/**
 * Present the menu / create / join / room screens, then hand control off.
 * @returns {Promise<{net:Net, code:string, slot:'p1'|'p2', isHost:boolean, difficulty:string, firstGameMsg:object}>}
 */
export function startLobby() {
  return new Promise((resolve) => {
    const menu     = $('menu-screen');
    const create   = $('create-screen');
    const join     = $('join-screen');
    const room     = $('room-screen');
    const allLobby = [menu, create, join, room];
    const showOnly = (el) => allLobby.forEach(e => e === el ? show(e) : hide(e));

    // ── Menu ────────────────────────────────────────────────────────────
    $('create-btn').onclick = () => showOnly(create);
    $('join-btn').onclick = () => {
      $('join-code').value = '';
      showOnly(join);
      $('join-code').focus();
    };

    // ── Create flow ─────────────────────────────────────────────────────
    $('create-back-btn').onclick = () => showOnly(menu);
    $('create-go-btn').onclick = async () => {
      $('create-go-btn').disabled = true;
      setText($('create-error'), '');
      try {
        const r = await fetch('/api/create-room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!r.ok) throw new Error('create failed');
        const { code } = await r.json();
        setRoomParam(code);
        enterRoom({ code });
      } catch (err) {
        setText($('create-error'), 'Could not create room. Try again.');
        $('create-go-btn').disabled = false;
      }
    };

    // ── Join flow ───────────────────────────────────────────────────────
    $('join-back-btn').onclick = () => showOnly(menu);
    $('join-code').addEventListener('input', (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    });
    $('join-go-btn').onclick = async () => {
      const code = $('join-code').value.trim().toUpperCase();
      if (code.length !== 4) {
        setText($('join-error'), 'Codes are 4 letters.');
        return;
      }
      setText($('join-error'), '');
      $('join-go-btn').disabled = true;
      try {
        const exists = await roomExistsOnServer(code);
        if (!exists) {
          setText($('join-error'), 'That room does not exist or it has expired. Ask the host for a new code.');
          clearRoomParam();
          $('join-go-btn').disabled = false;
          return;
        }
        setRoomParam(code);
        enterRoom({ code });
      } catch {
        setText($('join-error'), 'Could not reach the game server.');
        clearRoomParam();
        $('join-go-btn').disabled = false;
      }
    };

    // ── Room (waiting / pre-game) ───────────────────────────────────────
    let net = null;
    let mySlot = null;
    let isHost = false;
    let resolved = false;
    let lastRoomState = null;

    function enterRoom({ code }) {
      showOnly(room);
      setText($('room-code-value'), code);
      setText($('room-status'), 'Connecting…');
      setText($('room-error'), '');
      updateInviteLink(code);
      if (net) { net.close(); net = null; }

      net = new Net();
      net.connect({ code, name: '' });

      net.on('open', () => setText($('room-status'), 'Waiting for players…'));

      net.on('joined', (m) => {
        mySlot = m.slot;
        isHost = !!m.host;
      });

      net.on('roomState', (m) => {
        lastRoomState = m;
        renderRoomState(m);
      });

      net.on('peerLeft', () => {
        const peerSlot = mySlot === 'p1' ? 'p2' : 'p1';
        const labelEl = peerSlot === 'p1' ? $('room-p1-label') : $('room-p2-label');
        setText(labelEl, `${peerSlot.toUpperCase()} — disconnected`);
      });

      net.on('close', (m) => {
        if (resolved) return;
        setText($('room-status'), m?.code === 1000 ? 'Closed.' : 'Disconnected.');
        setText($('room-error'), 'Lost connection to server.');
      });

      // Server "error" message
      net.on('error', (m) => {
        if (m && m.msg) setText($('room-error'), m.msg);
      });

      // Host starts the game.
      $('room-start-btn').onclick = () => {
        if (!isHost) return;
        const difficulty = document.querySelector('input[name="room-diff"]:checked')?.value || 'medium';
        net.send({ type: 'start', difficulty });
      };

      // Host changes difficulty → broadcast to peer via server.
      document.querySelectorAll('input[name="room-diff"]').forEach((input) => {
        input.addEventListener('change', () => {
          if (!isHost || !input.checked) return;
          net.send({ type: 'setDifficulty', difficulty: input.value });
        });
      });

      // When server sends `gameStart`, hand off to main.js.
      net.on('gameStart', (m) => {
        if (resolved) return;
        resolved = true;
        resolve({
          net,
          code,
          slot: mySlot,
          isHost,
          difficulty: m.difficulty,
          firstGameMsg: m,
        });
      });

      $('room-leave-btn').onclick = () => {
        try { net?.send({ type: 'leave' }); } catch {}
        try { net?.close(); } catch {}
        net = null;
        mySlot = null;
        isHost = false;
        lastRoomState = null;
        clearRoomParam();
        $('join-go-btn').disabled = false;
        showOnly(menu);
      };

      $('room-copy-btn').onclick = async () => {
        try {
          await navigator.clipboard.writeText(inviteUrl(code));
          const b = $('room-copy-btn');
          const prev = b.textContent;
          b.textContent = 'COPIED!';
          setTimeout(() => (b.textContent = prev), 1200);
        } catch {}
      };
    }

    function renderRoomState(m) {
      for (const slot of ['p1', 'p2']) {
        const entry = m.slots.find(s => s.slot === slot);
        const labelEl = $(`room-${slot}-label`);
        if (entry && !entry.empty) {
          const tags = [];
          if (entry.slot === mySlot) tags.push('YOU');
          if (entry.host)            tags.push('HOST');
          const suffix = tags.length ? ` (${tags.join(' · ')})` : '';
          setText(labelEl, `${slot.toUpperCase()}${suffix}`);
          labelEl.style.color = entry.color;
        } else {
          setText(labelEl, `${slot.toUpperCase()} — waiting…`);
          labelEl.style.color = '';
        }
      }
      setText($('room-status'), m.canStart ? 'Both players in. Ready to race.' : 'Waiting for opponent…');
      $('room-start-btn').disabled = !(isHost && m.canStart);
      const diffInputs = document.querySelectorAll('input[name="room-diff"]');
      diffInputs.forEach(i => { i.disabled = !isHost; if (i.value === m.difficulty) i.checked = true; });
      $('room-start-btn').textContent = isHost ? 'START RACE' : 'WAITING FOR HOST…';
    }

    function inviteUrl(code) {
      const url = new URL(location.href);
      url.searchParams.set('room', code);
      return url.toString();
    }
    function updateInviteLink(code) {
      const u = inviteUrl(code);
      setText($('room-invite-url'), u);
    }

    // ── Auto-join via ?room=CODE — verify room exists before opening WS
    const params = readUrlParams();
    if (params.room && /^[A-Z]{4}$/.test(params.room)) {
      $('join-code').value = params.room;
      showOnly(join);
      setText($('join-error'), 'Checking room…');
      (async () => {
        try {
          const exists = await roomExistsOnServer(params.room);
          if (!exists) {
            setText($('join-error'), 'This invite link is invalid or the room no longer exists.');
            clearRoomParam();
            $('join-code').value = '';
            $('join-code').focus();
            return;
          }
          setText($('join-error'), '');
          setRoomParam(params.room);
          enterRoom({ code: params.room });
        } catch {
          setText($('join-error'), 'Could not reach the game server.');
          clearRoomParam();
          $('join-code').focus();
        }
      })();
    } else {
      showOnly(menu);
    }
  });
}
