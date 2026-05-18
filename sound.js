// sound.js

let ctx = null;
let soundEnabled = true;

// AudioContext はユーザー操作後でないとブラウザに弾かれる
// 最初のキー入力時に一度だけ初期化する
function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
}

// 音の有効/無効を切り替える
function toggleSound(enabled) {
  soundEnabled = enabled;
}

// 1キー押すたびに呼ぶ関数
function playKey() {
  if (!soundEnabled) return;
  initAudio();
  if (!ctx) return;

  // --- ここで音の特性を決める ---
  const now = ctx.currentTime;

  // 高域のクリック成分（キーの「コン」という立ち上がり）
  const osc1 = ctx.createOscillator();
  const gain1 = ctx.createGain();
  osc1.type = 'sine';
  osc1.frequency.setValueAtTime(1200, now);
  osc1.frequency.exponentialRampToValueAtTime(400, now + 0.03);
  gain1.gain.setValueAtTime(0.25, now);
  gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
  osc1.connect(gain1);
  gain1.connect(ctx.destination);
  osc1.start(now);
  osc1.stop(now + 0.04);

  // 低域のノイズ成分（キーの「底打ち感」）
  const bufferSize = ctx.sampleRate * 0.03;
  const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1);
  }
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const gain2 = ctx.createGain();
  gain2.gain.setValueAtTime(0.08, now);
  gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.03);
  noise.connect(gain2);
  gain2.connect(ctx.destination);
  noise.start(now);
}
