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
  ws.on('error', (e) => console.error(`[${name}] err`, e.message));
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    if (['joined','peerLeft','win','error'].includes(m.type)) {
      console.log(`[${name}] <`, m.type, m.reason || m.winner || m.slot || m.msg || '');
    }
  });
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

const host  = await openWS('Host');
await new Promise(r => setTimeout(r, 200));
const guest = await openWS('Guest');
await new Promise(r => setTimeout(r, 400));

host.send(JSON.stringify({ type:'start', difficulty:'easy' }));
await new Promise(r => setTimeout(r, 1500));

console.log('[smoke] closing guest mid-countdown/race');
guest.close();

await new Promise(r => setTimeout(r, 1000));
host.close();
process.exit(0);
