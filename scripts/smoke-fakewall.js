import WebSocket from 'ws';
import http from 'node:http';

const PORT = Number(process.env.PORT || 3000);
function post(path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: 'localhost', port: PORT, path, method: 'POST', headers: {'Content-Type':'application/json'} }, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const { code } = await post('/api/create-room', {});
console.log('[smoke] room', code);

function openWS(name) {
  const ws = new WebSocket(`ws://localhost:${PORT}/ws?room=${code}&name=${encodeURIComponent(name)}`);
  ws.last = null;
  ws.on('error', (e) => console.error(`[${name}] err`, e.message));
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    ws.last = m;
    if (m.type === 'state' && m.lifecycle === 'playing') ws.lastPlay = m;
  });
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

const host = await openWS('Host');
await new Promise(r => setTimeout(r, 200));
const guest = await openWS('Guest');
await new Promise(r => setTimeout(r, 400));

host.send(JSON.stringify({ type:'start', difficulty:'easy' }));
console.log('[smoke] start sent — waiting for play');
// Wait for gameplay to begin (countdown + GO)
await new Promise(r => setTimeout(r, 4500));

console.log('[smoke] host lifecycle now:', host.last?.lifecycle, 'p1.fakeWall=', host.last?.p1?.fakeWall, 'used=', host.last?.p1?.fakeWallUsed);

console.log('[smoke] sending host fakeWall action');
host.send(JSON.stringify({ type:'action', action:'fakeWall' }));
await new Promise(r => setTimeout(r, 300));
console.log('[smoke] AFTER: p1.fakeWall=', JSON.stringify(host.last?.p1?.fakeWall), 'used=', host.last?.p1?.fakeWallUsed);

host.close();
guest.close();
process.exit(0);
