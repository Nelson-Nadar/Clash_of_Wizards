const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { WebSocketServer } = require('ws');

const network = require('./config/network');
const app = express();
const certPath = path.resolve(__dirname, network.CERT_FILE);
const keyPath = path.resolve(__dirname, network.KEY_FILE);
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  console.error('HTTPS certificates not found.\nRun the mkcert setup steps in README.md before starting the server.\nExpected certificate: ' + certPath + '\nExpected private key: ' + keyPath);
  process.exit(1);
}
const server = https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app);
const wss = new WebSocketServer({ server });
const PORT = network.HTTPS_PORT;
const DATA = path.join(__dirname, 'data', 'leaderboard.json');
const ADMIN_PIN = process.env.ADMIN_PIN || '274913';
let store = JSON.parse(fs.readFileSync(DATA, 'utf8'));
let state = { phase: 'idle', score: 0, lives: 3, bombsHit: 0, duration: 150, difficulty: 'medium', timeLeft: 150, controller: false, calibration: store.calibration || null, completedResult: null };
let clients = new Set();
let pendingEndReason = null;

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_, res) => res.redirect('/game/'));
app.get(['/game','/controller','/admin','/leaderboard'], (req, res) => res.sendFile(path.join(__dirname, 'public', req.path.slice(1), 'index.html')));
function save() { fs.writeFileSync(DATA, JSON.stringify(store, null, 2)); }
function snapshot() { return { type:'state', state, highScore: store.highScore || 0, leaderboard: [...store.leaderboard].sort((a,b)=>b.score-a.score || a.createdAt.localeCompare(b.createdAt)) }; }
function broadcast(message, except) { const data=JSON.stringify(message); for (const c of clients) if (c!==except && c.readyState===1) c.send(data); }
function send(ws, message) { if(ws.readyState===1) ws.send(JSON.stringify(message)); }
function sanitizeName(n) { return String(n || '').trim().replace(/[^a-zA-Z0-9 ._-]/g,'').slice(0,24) || 'PLAYER'; }
wss.on('connection', ws => {
  clients.add(ws); let role='viewer'; send(ws, snapshot());
  ws.on('message', raw => { let msg; try { msg=JSON.parse(raw); } catch { return; }
    if (msg.type==='hello') { role=msg.role || role; if(role==='controller') { state.controller=true; broadcast(snapshot()); } return; }
    if (msg.type==='laser' && role==='controller') { if(state.phase==='running') broadcast({type:'laser', detected:!!msg.detected, x:msg.x, y:msg.y, timestamp:msg.timestamp}, ws); return; }
    // The countdown is rendered by the Game client, so only that client can
    // acknowledge its completion. Admin remains the sole controller of all
    // other lifecycle commands.
    if (msg.type==='countdownComplete' && role==='game') { if(state.phase==='countdown') { state.phase='running'; broadcast(snapshot()); } return; }
    if (msg.type==='calibration' && role==='controller') { state.calibration=msg.points; store.calibration=msg.points; save(); broadcast(snapshot()); return; }
    if (msg.type==='command' && role!=='admin') return;
    if (msg.type==='command') {
      const c=msg.command;
      if(c==='start' && ['idle','over'].includes(state.phase)) { pendingEndReason=null; state={...state,phase:'countdown',score:0,lives:3,bombsHit:0,timeLeft:msg.duration||150,duration:msg.duration||150,difficulty:msg.difficulty||'medium',completedResult:null}; broadcast(snapshot()); }
      if(c==='pause' && state.phase==='running') { state.phase='paused'; broadcast(snapshot()); }
      if(c==='resume' && state.phase==='paused') { state.phase='running'; broadcast(snapshot()); }
      if(c==='end' && ['running','paused','countdown'].includes(state.phase)) { pendingEndReason='ADMIN_ENDED'; broadcast({type:'endGame',reason:'ADMIN_ENDED'}); }
      if(c==='reset') { pendingEndReason=null; state={...state,phase:'idle',score:0,lives:3,bombsHit:0,timeLeft:state.duration,completedResult:null}; broadcast(snapshot()); }
      return;
    }
    if(msg.type==='gameUpdate' && role==='game' && ['running','paused'].includes(state.phase)) {
      state.score=Math.max(0,Number(msg.score)||0);
      state.lives=Math.max(0,Number(msg.lives)||0);
      state.bombsHit=Math.max(0,Number(msg.bombsHit)||0);
      state.timeLeft=Math.max(0,Number(msg.timeLeft)||0);
      broadcast(snapshot());
      return;
    }
    if(msg.type==='gameComplete' && role==='game' && ['running','paused','countdown'].includes(state.phase)) {
      const score=Math.max(0,Number(msg.score)||0);
      const highestScore=Math.max(score, store.highScore || 0);
      const livesRemaining=Math.max(0,Number(msg.livesRemaining)||0);
      const bombsHit=Math.max(0,Number(msg.bombsHit)||0);
      const duration=state.duration;
      const requestedReason=pendingEndReason;
      const gameEndReason=requestedReason || (livesRemaining===0 ? 'LIVES_DEPLETED' : Number(msg.timeLeft)<=0 ? 'TIME' : null);
      if(!gameEndReason) return;
      state.score=score;
      state.lives=livesRemaining;
      state.bombsHit=bombsHit;
      state.timeLeft=gameEndReason==='TIME' ? 0 : Math.max(0,Number(msg.timeLeft) || state.timeLeft);
      state.phase='over';
      state.completedResult={score,highestScore,livesRemaining,bombsHit,difficulty:state.difficulty,duration,gameEndReason};
      pendingEndReason=null;
      if(score>store.highScore){store.highScore=score;save();}
      broadcast(snapshot());
      return;
    }
    if(msg.type==='submitScore' && role==='admin' && state.phase==='over') { const record={id:Date.now().toString(36)+Math.random().toString(36).slice(2,7),name:sanitizeName(msg.name),score:state.score,difficulty:state.difficulty,duration:state.duration,bombsHit:state.bombsHit,createdAt:new Date().toISOString()}; store.leaderboard.push(record); save(); broadcast(snapshot()); return; }
    if((msg.type==='deleteRecord' || msg.type==='clearLeaderboard') && role==='admin') { if(String(msg.pin)!==ADMIN_PIN) return send(ws,{type:'error',message:'Incorrect confirmation PIN.'}); if(msg.type==='deleteRecord') store.leaderboard=store.leaderboard.filter(x=>x.id!==msg.id); else store.leaderboard=[]; save(); broadcast(snapshot()); }
  });
  ws.on('close',()=>{clients.delete(ws);if(role==='controller'){state.controller=false;broadcast(snapshot());}});
});
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Laser Fruit Slash HTTPS server running on https://${network.HOST_IP}:${PORT}`);
  console.log(`Laptop access: https://localhost:${PORT}`);
});
