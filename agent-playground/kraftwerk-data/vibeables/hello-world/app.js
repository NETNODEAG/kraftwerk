// hello vibe coderzzz, but make it ✨ vibes ✨
// no framework. no build. no regrets.

const $ = (s) => document.querySelector(s);
const root = document.documentElement;
const hero = $('#hero');
const glow = $('#glow');
const fill = $('#fill');
const label = $('#vibe-label');

// 🌌 stars: a tiny particle field that reacts to the cursor
const canvas = $('#stars');
const ctx = canvas.getContext('2d');
let W, H, stars = [];
const mouse = { x: -9999, y: -9999 };

function resize() {
  W = canvas.width = innerWidth * devicePixelRatio;
  H = canvas.height = innerHeight * devicePixelRatio;
  stars = Array.from({ length: Math.min(160, (innerWidth * innerHeight) / 9000) }, () => ({
    x: Math.random() * W, y: Math.random() * H,
    r: (Math.random() * 1.6 + 0.4) * devicePixelRatio,
    vx: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
    vy: (Math.random() - 0.5) * 0.15 * devicePixelRatio,
    tw: Math.random() * Math.PI * 2,
  }));
}
addEventListener('resize', resize);
resize();

function tick(t) {
  ctx.clearRect(0, 0, W, H);
  const light = root.classList.contains('light');
  for (const s of stars) {
    s.x += s.vx; s.y += s.vy; s.tw += 0.03;
    if (s.x < 0) s.x = W; if (s.x > W) s.x = 0;
    if (s.y < 0) s.y = H; if (s.y > H) s.y = 0;
    // gently flee the cursor
    const dx = s.x - mouse.x * devicePixelRatio, dy = s.y - mouse.y * devicePixelRatio;
    const d2 = dx * dx + dy * dy;
    if (d2 < 22000 * devicePixelRatio) { s.x += dx * 0.02; s.y += dy * 0.02; }
    const a = 0.35 + Math.sin(s.tw) * 0.3;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fillStyle = light ? `rgba(21,15,42,${a * 0.6})` : `rgba(255,255,255,${a})`;
    ctx.fill();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// 🖱️ cursor glow + 3D tilt on the headline
addEventListener('pointermove', (e) => {
  mouse.x = e.clientX; mouse.y = e.clientY;
  glow.style.transform = `translate(${e.clientX}px, ${e.clientY}px) translate(-50%, -50%)`;
  const rx = ((e.clientY / innerHeight) - 0.5) * -14;
  const ry = ((e.clientX / innerWidth) - 0.5) * 18;
  hero.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
});
addEventListener('pointerleave', () => { hero.style.transform = ''; mouse.x = mouse.y = -9999; });
document.querySelectorAll('button, .card, .url').forEach((el) => {
  el.addEventListener('pointerenter', () => glow.classList.add('hot'));
  el.addEventListener('pointerleave', () => glow.classList.remove('hot'));
});

// ✨ the vibe economy
const LEVELS = [
  [0, 'vibe level: mid'],
  [30, 'vibe level: immaculate'],
  [55, 'vibe level: unhinged'],
  [75, 'vibe level: transcendent'],
  [92, 'vibe level: main character'],
  [100, 'vibe level: ∞ (max vibes reached)'],
];
let vibes = 42;
function render() {
  fill.style.width = `${vibes}%`;
  label.textContent = [...LEVELS].reverse().find(([min]) => vibes >= min)[1];
  root.style.setProperty('--hue-speed', `${Math.max(1.5, 12 - vibes / 10)}s`);
  hero.classList.toggle('party', vibes >= 100);
}
render();

const COLORS = ['#ff5fb4', '#8b5cf6', '#22d3ee', '#a3e635', '#fbbf24', '#ffffff'];
function confetti(x, y, n = 36) {
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 260;
    p.style.left = `${x}px`; p.style.top = `${y}px`;
    p.style.background = COLORS[i % COLORS.length];
    p.style.setProperty('--dx', `${Math.cos(ang) * dist}px`);
    p.style.setProperty('--dy', `${Math.sin(ang) * dist + 200}px`);
    p.style.setProperty('--rot', `${(Math.random() - 0.5) * 900}deg`);
    document.body.appendChild(p);
    p.addEventListener('animationend', () => p.remove());
  }
}

$('#vibe').addEventListener('click', (e) => {
  vibes = Math.min(100, vibes + 8 + Math.round(Math.random() * 6));
  render();
  confetti(e.clientX || innerWidth / 2, e.clientY || innerHeight / 2, vibes >= 100 ? 120 : 36);
  if (vibes >= 100) e.currentTarget.lastChild.textContent = ' 🔥 vibes maxed';
});

// clicking the words also sparks joy
hero.addEventListener('click', (e) => confetti(e.clientX, e.clientY, 24));

// 🌙 / ☀️
const theme = $('#theme');
theme.addEventListener('click', () => {
  const light = root.classList.toggle('light');
  theme.textContent = light ? '☀️' : '🌙';
});

console.log('%chello vibe coderzzz ✨', 'font-size: 32px; font-weight: 700; background: linear-gradient(90deg,#ff5fb4,#8b5cf6,#22d3ee); color: transparent; -webkit-background-clip: text;');
console.log('%cyes, this console message is also vibe coded.', 'color: #8b5cf6; font-style: italic;');
