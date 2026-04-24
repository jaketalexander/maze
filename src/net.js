// Tiny event-emitter style WebSocket wrapper for the browser.
// Emits the raw server messages as events keyed by `type`, plus
// synthetic 'open' / 'close' / 'error' events.

export class Net {
  constructor() {
    this.ws       = null;
    this.handlers = new Map();     // type → Set<fn>
    this.pending  = [];            // messages queued while connecting
    this.open     = false;
  }

  on(type, fn) {
    let set = this.handlers.get(type);
    if (!set) { set = new Set(); this.handlers.set(type, set); }
    set.add(fn);
    return () => set.delete(fn);
  }

  emit(type, data) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of set) fn(data);
  }

  connect({ code, name }) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const qs = new URLSearchParams({ room: code, name: name || '' });
    const url = `${proto}//${location.host}/ws?${qs.toString()}`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.open = true;
      for (const m of this.pending) ws.send(m);
      this.pending.length = 0;
      this.emit('open', null);
    });

    ws.addEventListener('message', (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      this.emit(msg.type, msg);
    });

    ws.addEventListener('close', (e) => {
      this.open = false;
      this.emit('close', { code: e.code, reason: e.reason });
    });

    ws.addEventListener('error', (e) => {
      this.emit('error', e);
    });
  }

  send(msg) {
    const payload = JSON.stringify(msg);
    if (this.open && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(payload);
    } else {
      this.pending.push(payload);
    }
  }

  close() {
    this.pending.length = 0;
    if (this.ws) { try { this.ws.close(); } catch {} this.ws = null; }
    this.open = false;
  }
}
