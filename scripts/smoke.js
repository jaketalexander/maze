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
  ws.events = [];
  ws.on('message', (buf) => {
    const m = JSON.parse(String(buf));
    ws.events.push(m.type);
    if (['joined','roomState','countdown','gameStart','win','error','peerLeft'].includes(m.type)) {
      console.log(`[${name}] <`, m.type, m.type === 'gameStart' ? `${m.difficulty} ${m.cols}x${m.rows}` : (m.value ?? m.slot ?? m.canStart ?? m.winner ?? m.msg ?? ''));
    }
  });
  return new Promise((resolve) => ws.on('open', () => resolve(ws)));
}

const host = await openWS('Host');
await new Promise(r => setTimeout(r, 200));
const guest = await openWS('Guest');
await new Promise(r => setTimeout(r, 400));

host.send(JSON.stringify({ type:'start', difficulty:'easy' }));
await new Promise(r => setTimeout(r, 1500));

// Guest drives left-to-right across the top row as a reasonable smoke test.
// P2 = bottom-right → top-left. So move left + up.
guest.send(JSON.stringify({ type:'input', left:true, right:false, up:false, down:false }));
host.send(JSON.stringify({ type:'input', left:false, right:true, up:false, down:false }));

await new Promise(r => setTimeout(r, 2000));
console.log('[smoke] host events:', host.events.slice(0, 20).join(','));
console.log('[smoke] guest events (count):', guest.events.length);

host.close();
guest.close();
process.exit(0);
