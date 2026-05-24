import { WebSocketServer } from 'ws';

/**
 * WebSocket broadcaster — push state ไปทุก browser client
 *
 * Protocol (server → client):
 *   { type: 'state', payload: { state, billsTotal, ... } }
 *   { type: 'event', name: 'dispense_completed' | 'error' | 'low_coin', ... }
 */
export function attachWebSocket(httpServer, machine) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  wss.on('connection', (ws) => {
    // ส่ง state ปัจจุบันให้ทันทีที่ connect
    sendTo(ws, { type: 'state', payload: machine.getState() });
  });

  // Forward machine events
  machine.on('state', (payload) => broadcast(wss, { type: 'state', payload }));
  machine.on('dispense_completed', (payload) =>
    broadcast(wss, { type: 'event', name: 'dispense_completed', payload })
  );
  machine.on('error_occurred', (payload) =>
    broadcast(wss, { type: 'event', name: 'error', payload })
  );
  machine.on('low_coin', (payload) =>
    broadcast(wss, { type: 'event', name: 'low_coin', payload })
  );

  return wss;
}

function sendTo(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(wss, msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}
