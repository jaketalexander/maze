// Shared wire protocol + constants. ESM so the same file is importable from
// both the server and (if needed later) the browser client.

export const DIFFICULTIES = {
  easy:   { cols: 15, rows: 11, name: 'EASY' },
  medium: { cols: 25, rows: 17, name: 'MEDIUM' },
  hard:   { cols: 37, rows: 25, name: 'HARD' },
  expert: { cols: 51, rows: 35, name: 'EXPERT' },
};

// Message types (string tags on the `type` field).
export const MSG = {
  // client → server
  HELLO:   'hello',
  START:   'start',
  INPUT:   'input',
  ACTION:  'action',
  REMATCH: 'rematch',
  NEXT:    'next',
  LEAVE:   'leave',
  SET_DIFFICULTY: 'setDifficulty',
  // server → client
  JOINED:     'joined',
  ROOM_STATE: 'roomState',
  PEER_LEFT:  'peerLeft',
  GAME_START: 'gameStart',
  COUNTDOWN:  'countdown',
  STATE:      'state',
  WIN:        'win',
  ERROR:      'error',
  /** Opponent left from post-game; everyone must return to main menu. */
  FORCED_MENU: 'forcedMenu',
};

// 4-letter room code, excluding confusing glyphs (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ';
export function generateRoomCode() {
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}
