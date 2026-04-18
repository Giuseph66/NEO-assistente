/**
 * renderPhoneMicPage() — Single-file HTML served by the PhoneMicServer.
 * Connects immediately. Only allows 1 concurrent connection to the Desktop.
 */
export function renderPhoneMicPage(): string {
  return /* html */ `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>NEO — Microfone</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0a0a14;
    --bg2: #10101e;
    --card: #14142a;
    --border: rgba(139,92,246,0.25);
    --accent: #7c3aed;
    --accent2: #a78bfa;
    --text: #e2e8f0;
    --muted: #64748b;
    --danger: #ef4444;
    --success: #10b981;
    --warn: #f59e0b;
    --radius: 20px;
  }

  html, body { height: 100%; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; overflow: hidden; }

  body {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100dvh; padding: env(safe-area-inset-top, 16px) 24px env(safe-area-inset-bottom, 24px);
    background: radial-gradient(ellipse at top, rgba(124,58,237,0.12) 0%, transparent 60%), var(--bg);
  }

  .screen { display: none; width: 100%; max-width: 360px; flex-direction: column; align-items: center; gap: 20px; animation: fadein .3s ease; }
  .screen.active { display: flex; }
  @keyframes fadein { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }

  /* ── Logo ── */
  .logo { display: flex; align-items: center; gap: 10px; font-size: 19px; font-weight: 700; letter-spacing: -0.5px; }
  .logo-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--accent2); box-shadow: 0 0 12px var(--accent2); }

  /* ── Cards ── */
  .card { width: 100%; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 28px 24px; }

  /* ── Buttons ── */
  .btn { width: 100%; padding: 16px; border-radius: 14px; border: none; font-size: 15px; font-weight: 600; cursor: pointer; transition: opacity .15s, transform .1s; }
  .btn:active { transform: scale(0.97); }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-ghost { background: rgba(255,255,255,0.06); color: var(--text); border: 1px solid var(--border); }
  .btn:disabled { opacity: 0.45; cursor: default; }

  /* ── Status indicator ── */
  .status-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex-shrink: 0; }
  .status-dot.green { background: var(--success); box-shadow: 0 0 8px var(--success); }
  .status-dot.amber { background: var(--warn); box-shadow: 0 0 8px var(--warn); animation: pulse 1.2s ease-in-out infinite; }
  .status-dot.red { background: var(--danger); box-shadow: 0 0 8px var(--danger); }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .4; } }

  /* ── Mic button ── */
  .mic-wrap { position: relative; width: 120px; height: 120px; display: flex; align-items: center; justify-content: center; }
  .mic-ripple { position: absolute; inset: 0; border-radius: 50%; border: 2px solid var(--accent2); animation: ripple 1.8s ease-out infinite; }
  .mic-ripple:nth-child(2) { animation-delay: -.6s; }
  .mic-ripple:nth-child(3) { animation-delay: -1.2s; }
  @keyframes ripple { 0% { transform: scale(1); opacity: .6; } 100% { transform: scale(1.9); opacity: 0; } }
  .mic-btn { width: 96px; height: 96px; border-radius: 50%; background: var(--accent); border: none; display: flex; align-items: center; justify-content: center; cursor: pointer; position: relative; z-index: 1; box-shadow: 0 0 30px rgba(124,58,237,.5); transition: transform .2s; }
  .mic-btn.recording { background: var(--danger); box-shadow: 0 0 30px rgba(239,68,68,.5); }
  .mic-btn:active { transform: scale(0.94); }
  .mic-btn.muted { background: rgba(100,116,139,0.4); box-shadow: none; }

  /* ── Visualizer ── */
  canvas { border-radius: 10px; background: rgba(255,255,255,.03); }

  /* ── Timer ── */
  .timer { font-size: 28px; font-weight: 700; letter-spacing: 0.04em; font-variant-numeric: tabular-nums; }

  /* ── Row util ── */
  .row { display: flex; align-items: center; gap: 10px; }
  p.muted { color: var(--muted); font-size: 13px; text-align: center; line-height: 1.5; }
  h2 { font-size: 18px; font-weight: 700; }

  /* ── Denied ── */
  .denied-icon { width: 56px; height: 56px; border-radius: 50%; background: rgba(239,68,68,0.12); display: flex; align-items: center; justify-content: center; border: 1px solid rgba(239,68,68,0.3); }

  /* mobile safe areas */
  .safe-bottom { height: env(safe-area-inset-bottom, 0px); }
</style>
</head>
<body>

<!-- ══ SCREEN: connect — landing ══════════════════════════════════════ -->
<div class="screen active" id="scr-connect">
  <div class="logo"><div class="logo-dot"></div>NEO Mic</div>
  <div class="card" style="gap:20px;display:flex;flex-direction:column;align-items:center;">
    <div style="text-align: center;">
      <h2 style="margin-bottom:6px">Conectar ao Desktop</h2>
      <p class="muted">Toque no botão abaixo para usar este celular como microfone.</p>
    </div>
    <button class="btn btn-primary" id="btn-connect">Conectar Microfone</button>
  </div>
</div>

<!-- ══ SCREEN: denied ════════════════════════════════════════════════════════ -->
<div class="screen" id="scr-denied">
  <div class="logo"><div class="logo-dot"></div>NEO Mic</div>
  <div class="card" style="gap:16px;display:flex;flex-direction:column;align-items:center;text-align:center">
    <div class="denied-icon">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5">
        <circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/>
      </svg>
    </div>
    <div>
      <h2 style="margin-bottom:6px">Acesso Bloqueado</h2>
      <p class="muted" id="denied-msg">O Desktop já está com um microfone conectado.</p>
    </div>
    <button class="btn btn-ghost" id="btn-restart">Tentar novamente</button>
  </div>
</div>

<!-- ══ SCREEN: recording ══════════════════════════════════════════════════════ -->
<div class="screen" id="scr-record">
  <div class="logo"><div class="logo-dot"></div>NEO Mic</div>

  <div class="row" style="gap:8px">
    <div class="status-dot green"></div>
    <span style="font-size:13px;color:var(--muted)" id="rec-device-name">Celular Conectado</span>
  </div>

  <div class="mic-wrap" id="mic-wrap">
    <div class="mic-ripple" id="rip1"></div>
    <div class="mic-ripple" id="rip2"></div>
    <div class="mic-ripple" id="rip3"></div>
    <button class="mic-btn recording" id="mic-btn">
      <svg id="ico-mic" width="36" height="36" viewBox="0 0 24 24" fill="white">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2" stroke="white" stroke-width="2" fill="none" stroke-linecap="round"/>
        <line x1="12" y1="19" x2="12" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/>
        <line x1="8" y1="23" x2="16" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <svg id="ico-muted" width="36" height="36" viewBox="0 0 24 24" fill="none" style="display:none">
        <line x1="1" y1="1" x2="23" y2="23" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" stroke="white" stroke-width="2" fill="none"/>
        <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" stroke="white" stroke-width="2" fill="none"/>
        <line x1="12" y1="19" x2="12" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/>
        <line x1="8" y1="23" x2="16" y2="23" stroke="white" stroke-width="2" stroke-linecap="round"/>
      </svg>
    </button>
  </div>

  <span class="timer" id="timer">00:00</span>

  <canvas id="viz" width="320" height="60"></canvas>

  <p class="muted" id="hint-mute">Toque no microfone para silenciar</p>
  <div class="safe-bottom"></div>
</div>

<script>
/* ─── Globals & Identity ────────────────────────────────────────────────── */
let ws = null, audioCtx = null, workletNode = null, stream = null;
let muted = false, timerInterval = null, startAt = 0;

/* ─── UI Actions ─────────────────────────────────────────────────────────── */
function doRestart() {
  if (ws) { ws.close(); ws = null; }
  stopRecording();
  show('scr-connect');
}

function doToggleMute() {
  muted = !muted;
  var btn = document.getElementById('mic-btn');
  btn.classList.toggle('recording', !muted);
  btn.classList.toggle('muted', muted);
  document.getElementById('ico-mic').style.display = muted ? 'none' : '';
  document.getElementById('ico-muted').style.display = muted ? '' : 'none';
  document.getElementById('hint-mute').textContent = muted ? 'Microfone silenciado — toque para reativar' : 'Toque no microfone para silenciar';
  ['rip1','rip2','rip3'].forEach(function(id) {
    document.getElementById(id).style.display = muted ? 'none' : '';
  });
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'mute', muted: muted }));
  }
}

/* ─── Screen management ─────────────────────────────────────────────────── */
function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) el.classList.add('active');
}

/* ─── WebSocket connection ──────────────────────────────────────────────── */
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = proto + '://' + location.host + '/phone-mic/ws';

  if (ws) { try { ws.close(); } catch {} }
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.addEventListener('message', e => {
    if (typeof e.data === 'string') {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === 'approved') onApproved();
      } catch {}
    }
  });

  ws.addEventListener('close', e => {
    stopRecording();
    if (e.code === 1008) {
      document.getElementById('denied-msg').textContent = 'O Desktop já possui um microfone ativo.';
      show('scr-denied');
    } else {
      document.getElementById('denied-msg').textContent = 'Conexão encerrada.';
      show('scr-denied');
    }
  });

  ws.addEventListener('error', () => {
    stopRecording();
    document.getElementById('denied-msg').textContent = 'Erro de conexão.';
    show('scr-denied');
  });
}

/* ─── Audio Handling ────────────────────────────────────────────────────── */
async function onApproved() {
  show('scr-record');

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: {
      echoCancellation: true, noiseSuppression: true, sampleRate: 16000, channelCount: 1
    }});
  } catch(err) {
    document.getElementById('denied-msg').textContent = 'Sem permissão de microfone.';
    show('scr-denied');
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const source = audioCtx.createMediaStreamSource(stream);

  const workletCode = 'class PCMProcessor extends AudioWorkletProcessor {' +
    'process(inputs) {' +
      'const ch = inputs[0] ? inputs[0][0] : null;' +
      'if (ch && ch.length > 0) {' +
        'const buf = new Int16Array(ch.length);' +
        'for (let i = 0; i < ch.length; i++) buf[i] = Math.max(-32768, Math.min(32767, ch[i] * 32767));' +
        'this.port.postMessage(buf.buffer, [buf.buffer]);' +
      '}' +
      'return true;' +
    '}' +
  '}' +
  "registerProcessor('pcm-proc', PCMProcessor);";

  const blob = new Blob([workletCode], { type: 'application/javascript' });
  const burl = URL.createObjectURL(blob);
  await audioCtx.audioWorklet.addModule(burl);
  URL.revokeObjectURL(burl);

  workletNode = new AudioWorkletNode(audioCtx, 'pcm-proc');
  workletNode.port.onmessage = e => {
    if (!muted && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(e.data);
    }
  };
  source.connect(workletNode);
  workletNode.connect(audioCtx.destination);

  startRecordingUI();
  startViz(source);
}

function startRecordingUI() {
  startAt = Date.now();
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const s = Math.floor((Date.now() - startAt) / 1000);
    const m = Math.floor(s / 60);
    const ss = s % 60;
    document.getElementById('timer').textContent =
      String(m).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
  }, 500);
}

function stopRecording() {
  if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
  if (workletNode) { try { workletNode.disconnect(); } catch {} workletNode = null; }
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
}

function startViz(source) {
  const canvas = document.getElementById('viz');
  const ctx = canvas.getContext('2d');
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 128;
  source.connect(analyser);
  const data = new Uint8Array(analyser.frequencyBinCount);
  const w = canvas.width, h = canvas.height;

  function draw() {
    if (!audioCtx) return;
    requestAnimationFrame(draw);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, w, h);
    const barW = (w / data.length) * 2.2;
    let x = 0;
    for (let i = 0; i < data.length; i++) {
      const barH = (data[i] / 255) * h;
      const grad = ctx.createLinearGradient(0, h, 0, h - barH);
      grad.addColorStop(0, 'rgba(124,58,237,0.9)');
      grad.addColorStop(1, 'rgba(167,139,250,0.5)');
      ctx.fillStyle = muted ? 'rgba(100,116,139,0.3)' : grad;
      ctx.beginPath();
      ctx.roundRect(x, h - barH, barW - 1, barH, 2);
      ctx.fill();
      x += barW + 1;
    }
  }
  draw();
}

/* ─── Initialization ───────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  var btnConnect = document.getElementById('btn-connect');
  if (btnConnect) btnConnect.addEventListener('click', connect);

  var btnRestart = document.getElementById('btn-restart');
  if (btnRestart) btnRestart.addEventListener('click', doRestart);

  var micBtn = document.getElementById('mic-btn');
  if (micBtn) micBtn.addEventListener('click', doToggleMute);
});
</script>
</body>
</html>`;
}
