/* ==========================================================================
   UMA PEQUENA EXPLORAÇÃO — game.js
   Jogo de exploração 2D em Canvas, JavaScript puro (sem frameworks).

   Índice das seções:
     0. CONFIG            -> textos e ajustes que você pode personalizar
     1. Utils              -> funções auxiliares (clamp, colisão AABB, etc)
     2. AudioManager         -> música de fundo + efeitos sonoros
     3. InputManager           -> teclado + controles touch (mobile)
     4. WorldMap                 -> definição do mapa, objetos e colisões
     5. Camera                     -> câmera que segue o personagem
     6. Player                      -> personagem, movimento e colisão
     7. Progression                  -> contador de objetos encontrados
     8. Dialogue                      -> caixa de diálogo
     9. EndSequence                    -> tela final
    10. Renderer                        -> desenho do mundo (pixel art)
    11. Game                              -> loop principal
    12. Bootstrap                          -> inicialização + service worker
   ========================================================================== */

'use strict';

/* ==========================================================================
   0. CONFIG  —  ██████  PERSONALIZE AQUI  ██████
   Troque os textos abaixo pelas suas próprias mensagens.
   ========================================================================== */
const CONFIG = {

  // Mensagens mostradas ao interagir com cada objeto especial do mapa.
  MESSAGES: {
    flower: 'Uma flor pra uma flor HAHAHA (essa foi boa né).',
    star: 'que estrela feia, meudeus mas era oque tinha.',
    tree: 'Ok, não tem nada aqui. Eu só queria colocar uma árvore bonita.',
    animal: 'gostou de falar com esse cara bizarro? eu achei ele legal.',
    house: 'calmaaa brooo é so uma casa .'
  },

  // Mostrada quando os 5 objetos são encontrados e o caminho final se abre.
  UNLOCK_TOAST: 'alguém apareceu......',

  // ---- Tela final: troque livremente pelas suas próprias mensagens ----
  // Use "\n\n" para pular uma linha em branco.
  FINAL_MESSAGE_PART_1:
    'Então... era isso.\n\nEu só queria fazer uma coisa diferente pra você.\nEspero que tenha gostado. :)',

  FINAL_MESSAGE_PART_2:
    'desculpa se não ficou tão legal igual achei.',

  // Caminho do arquivo de música de fundo (opcional). Coloque seu MP3 em
  // assets/music.mp3 — se o arquivo não existir, o botão de música
  // simplesmente fica sem efeito, sem quebrar o jogo.
  MUSIC_PATH: 'assets/music.mp3',

  // Velocidade do personagem (unidades de mundo por segundo).
  PLAYER_SPEED: 92,

  // Distância máxima para conseguir interagir com um objeto.
  INTERACT_RADIUS: 30
};


/* ==========================================================================
   1. Utils
   ========================================================================== */
const Utils = (() => {
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function distance(ax, ay, bx, by) {
    return Math.hypot(ax - bx, ay - by);
  }

  // Interseção entre dois retângulos AABB.
  function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  return { clamp, distance, rectsOverlap };
})();


/* ==========================================================================
   2. AudioManager — música de fundo + efeitos sonoros gerados no navegador
   ========================================================================== */
const AudioManager = (() => {
  let ctx = null;
  let musicOn = false;
  const musicEl = document.getElementById('bg-music');
  const musicBtn = document.getElementById('btn-music');

  function ensureContext() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) ctx = new AC();
    }
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // Toca um "beep" simples com envelope de volume (sem arquivos externos).
  function beep({ freq = 440, duration = 0.12, type = 'sine', volume = 0.06, delay = 0 }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);

    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.02);
  }

  let lastFootstep = 0;
  function footstep(now) {
    if (now - lastFootstep < 260) return;
    lastFootstep = now;
    beep({ freq: 160 + Math.random() * 20, duration: 0.06, type: 'square', volume: 0.025 });
  }

  function interactSound() {
    beep({ freq: 520, duration: 0.09, type: 'triangle', volume: 0.05 });
  }

  function discoverSound() {
    beep({ freq: 660, duration: 0.14, type: 'triangle', volume: 0.06 });
    beep({ freq: 880, duration: 0.18, type: 'triangle', volume: 0.055, delay: 0.09 });
  }

  function completeSound() {
    [523, 659, 784, 1047].forEach((f, i) => {
      beep({ freq: f, duration: 0.22, type: 'triangle', volume: 0.06, delay: i * 0.11 });
    });
  }

  function toggleMusic() {
    ensureContext();
    musicOn = !musicOn;
    if (musicOn) {
      musicEl.volume = 0.35;
      musicEl.play().catch(() => {
        // Sem arquivo de música disponível ou navegador bloqueou — sem problema.
        musicOn = false;
        updateButton();
      });
    } else {
      musicEl.pause();
    }
    updateButton();
  }

  function updateButton() {
    musicBtn.textContent = musicOn ? '🔊' : '🔇';
  }

  function init() {
    musicBtn.addEventListener('click', () => {
      ensureContext();
      toggleMusic();
    });
  }

  return { init, ensureContext, footstep, interactSound, discoverSound, completeSound };
})();


/* ==========================================================================
   3. InputManager — teclado (desktop) + d-pad e botão de interação (mobile)
   ========================================================================== */
const InputManager = (() => {
  const dirs = { up: false, down: false, left: false, right: false };
  let interactPressed = false;

  const KEY_MAP = {
    KeyW: 'up', ArrowUp: 'up',
    KeyS: 'down', ArrowDown: 'down',
    KeyA: 'left', ArrowLeft: 'left',
    KeyD: 'right', ArrowRight: 'right'
  };

  function bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (KEY_MAP[e.code]) { dirs[KEY_MAP[e.code]] = true; e.preventDefault(); }
      if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') {
        interactPressed = true;
        e.preventDefault();
      }
    });
    window.addEventListener('keyup', (e) => {
      if (KEY_MAP[e.code]) { dirs[KEY_MAP[e.code]] = false; e.preventDefault(); }
    });
  }

  function bindTouchDpad() {
    document.querySelectorAll('.dpad-btn').forEach((btn) => {
      const dir = btn.dataset.dir;

      const press = (e) => { e.preventDefault(); dirs[dir] = true; btn.classList.add('active'); };
      const release = (e) => { if (e) e.preventDefault(); dirs[dir] = false; btn.classList.remove('active'); };

      btn.addEventListener('pointerdown', press);
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    const interactBtn = document.getElementById('btn-interact-mobile');
    interactBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); interactPressed = true; });
    interactBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Consome o "pedido" de interação (evita disparar todo frame).
  function consumeInteract() {
    if (interactPressed) { interactPressed = false; return true; }
    return false;
  }

  function getMoveVector() {
    let x = (dirs.right ? 1 : 0) - (dirs.left ? 1 : 0);
    let y = (dirs.down ? 1 : 0) - (dirs.up ? 1 : 0);
    if (x !== 0 && y !== 0) { x *= Math.SQRT1_2; y *= Math.SQRT1_2; }
    return { x, y };
  }

  function isMoving() {
    return dirs.up || dirs.down || dirs.left || dirs.right;
  }

  function init() {
    bindKeyboard();
    bindTouchDpad();
  }

  return { init, getMoveVector, isMoving, consumeInteract };
})();


/* ==========================================================================
   4. WorldMap — mapa, objetos decorativos, colisões e objetos interativos
   ========================================================================== */
const WorldMap = (() => {
  const WORLD_W = 1400;
  const WORLD_H = 1000;

  // ---- Obstáculos sólidos (bloqueiam o personagem): {x,y,w,h} ----
  // Para adicionar um obstáculo novo, basta inserir outro objeto {x,y,w,h}.
  const solids = [
    // casa
    { id: 'house-body', x: 1040, y: 150, w: 140, h: 100 },
    // lago (dividido em duas partes, com uma "ponte" no meio — veja bridgeGapX)
    { id: 'pond-left', x: 600, y: 430, w: 90, h: 130 },
    { id: 'pond-right', x: 710, y: 430, w: 90, h: 130 },
    // banco
    { id: 'bench', x: 505, y: 615, w: 46, h: 18 },
    // pedras
    { id: 'rock1', x: 340, y: 190, w: 22, h: 16 },
    { id: 'rock2', x: 900, y: 560, w: 26, h: 18 },
    { id: 'rock3', x: 150, y: 640, w: 20, h: 16 },
    { id: 'rock4', x: 1030, y: 700, w: 22, h: 16 }
  ];

  // Árvores (tronco = colisão pequena na base; copa só decorativa por cima).
  const trees = [
    { x: 120, y: 140 }, { x: 210, y: 90 }, { x: 60, y: 320 },
    { x: 430, y: 120 }, { x: 520, y: 220 }, { x: 760, y: 130 },
    { x: 900, y: 90 }, { x: 1250, y: 200 }, { x: 1300, y: 400 },
    { x: 1230, y: 560 }, { x: 1150, y: 720 }, { x: 980, y: 860 },
    { x: 760, y: 900 }, { x: 480, y: 880 }, { x: 220, y: 920 },
    { x: 60, y: 760 }, { x: 40, y: 500 }, { x: 350, y: 560 },
    { x: 880, y: 330 }, { x: 660, y: 720 }
  ];
  trees.forEach((t, i) => {
    solids.push({ id: `tree-${i}`, x: t.x - 6, y: t.y + 14, w: 12, h: 10 });
  });

  // ---- Área final: um pequeno recanto cercado, só acessível pelo portão ----
  // As 4 paredes fecham o recanto por completo; o "gate" é o único vão nelas,
  // e é removido das colisões quando os 5 objetos são encontrados.
  const groveWalls = [
    { id: 'grove-top', x: 20, y: 840, w: 170, h: 10 },
    { id: 'grove-bottom', x: 20, y: 980, w: 170, h: 10 },
    { id: 'grove-left', x: 20, y: 840, w: 10, h: 150 },
    { id: 'grove-right-upper', x: 180, y: 840, w: 10, h: 65 },
    { id: 'grove-right-lower', x: 180, y: 925, w: 10, h: 65 }
  ];
  solids.push(...groveWalls);

  const gate = { id: 'gate', x: 180, y: 905, w: 10, h: 20 };
  solids.push(gate);

  // ---- Elementos decorativos (não bloqueiam o personagem) ----
  const flowersDecor = [];
  for (let i = 0; i < 26; i++) {
    const a = i * 2.399963; // espalhamento tipo "phyllotaxis", determinístico
    const r = 30 + i * 24;
    flowersDecor.push({
      x: Utils.clamp(700 + Math.cos(a) * r * 0.9, 40, WORLD_W - 40),
      y: Utils.clamp(500 + Math.sin(a) * r * 0.55, 40, WORLD_H - 40),
      hue: (i * 47) % 360
    });
  }

  const grassTufts = [];
  for (let i = 0; i < 70; i++) {
    const a = i * 1.831;
    const r = 20 + i * 16.2;
    grassTufts.push({
      x: Utils.clamp(700 + Math.cos(a * 1.3) * r * 0.95, 20, WORLD_W - 20),
      y: Utils.clamp(500 + Math.sin(a * 1.3) * r * 0.6, 20, WORLD_H - 20)
    });
  }

  const lanterns = [
    { x: 260, y: 430 }, { x: 470, y: 340 }, { x: 660, y: 400 },
    { x: 900, y: 420 }, { x: 1060, y: 330 }, { x: 350, y: 700 },
    { x: 700, y: 780 }, { x: 150, y: 900 }
  ];

  // Caminho de terra (apenas visual), definido por pontos guia.
  const pathPoints = [
    { x: 150, y: 500 }, { x: 300, y: 460 }, { x: 470, y: 430 },
    { x: 610, y: 470 }, { x: 700, y: 495 }, { x: 790, y: 470 },
    { x: 940, y: 400 }, { x: 1060, y: 300 }, { x: 1110, y: 250 }
  ];
  const pathBranch = [
    { x: 470, y: 430 }, { x: 420, y: 600 }, { x: 350, y: 760 },
    { x: 240, y: 870 }, { x: 195, y: 915 }
  ];

  const pond = { x: 600, y: 430, w: 200, h: 130, bridgeGapX: [690, 710] };
  const house = { x: 1040, y: 150, w: 140, h: 100, doorX: 1110, doorY: 262 };

  // ---- Objetos interativos: os 5 que o jogador precisa encontrar ----
  const interactables = [
    { id: 'flower1', type: 'flower', x: 250, y: 260, icon: '🌷', message: CONFIG.MESSAGES.flower, found: false },
    { id: 'star1', type: 'star', x: 990, y: 700, icon: '⭐', message: CONFIG.MESSAGES.star, found: false },
    { id: 'tree1', type: 'specialtree', x: 270, y: 790, icon: '🌳', message: CONFIG.MESSAGES.tree, found: false },
    { id: 'cat1', type: 'animal', x: 930, y: 390, baseX: 930, baseY: 390, icon: '🐈', message: CONFIG.MESSAGES.animal, found: false },
    { id: 'house1', type: 'house', x: house.doorX, y: house.doorY, icon: '🏠', message: CONFIG.MESSAGES.house, found: false }
  ];

  // Objeto final — só pode ser alcançado depois do portão abrir.
  const finalSpot = { id: 'final', x: 95, y: 915, icon: '✨' };

  function isSolid(rect) {
    for (const s of solids) {
      if (s.id === 'gate' && s.opened) continue; // portão já aberto
      if (Utils.rectsOverlap(rect, s)) return true;
    }
    return false;
  }

  function openGate() {
    gate.opened = true;
  }

  return {
    WORLD_W, WORLD_H,
    solids, trees, flowersDecor, grassTufts, lanterns,
    pathPoints, pathBranch, pond, house, gate,
    interactables, finalSpot,
    isSolid, openGate
  };
})();


/* ==========================================================================
   5. Camera — segue o personagem, sempre dentro dos limites do mundo
   ========================================================================== */
const Camera = (() => {
  const BASE_VIEW_H = 180; // "unidades de mundo" visíveis na vertical (zoom fixo)
  let viewW = 320, viewH = BASE_VIEW_H;
  let x = 0, y = 0;

  function resize(aspect) {
    viewH = BASE_VIEW_H;
    viewW = Utils.clamp(Math.round(BASE_VIEW_H * aspect), 220, 460);
  }

  function follow(targetX, targetY) {
    x = Utils.clamp(targetX - viewW / 2, 0, Math.max(0, WorldMap.WORLD_W - viewW));
    y = Utils.clamp(targetY - viewH / 2, 0, Math.max(0, WorldMap.WORLD_H - viewH));
  }

  return {
    get x() { return x; },
    get y() { return y; },
    get viewW() { return viewW; },
    get viewH() { return viewH; },
    resize,
    follow
  };
})();


/* ==========================================================================
   6. Player — personagem: posição, colisão e animação de caminhada
   ========================================================================== */
const Player = (() => {
  const size = { w: 14, h: 10 }; // caixa de colisão (só os "pés")
  const state = {
    x: 150, y: 520,
    facing: 'down',
    walking: false,
    animTimer: 0,
    animFrame: 0
  };

  function collisionBox(x, y) {
    return { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
  }

  function update(dt) {
    const move = InputManager.getMoveVector();
    state.walking = move.x !== 0 || move.y !== 0;

    if (state.walking) {
      if (Math.abs(move.x) > Math.abs(move.y)) {
        state.facing = move.x > 0 ? 'right' : 'left';
      } else {
        state.facing = move.y > 0 ? 'down' : 'up';
      }

      const speed = CONFIG.PLAYER_SPEED;
      const dx = move.x * speed * dt;
      const dy = move.y * speed * dt;

      // Move em cada eixo separadamente, permitindo "deslizar" ao longo de paredes.
      const tryX = Utils.clamp(state.x + dx, size.w / 2, WorldMap.WORLD_W - size.w / 2);
      if (!WorldMap.isSolid(collisionBox(tryX, state.y))) state.x = tryX;

      const tryY = Utils.clamp(state.y + dy, size.h / 2, WorldMap.WORLD_H - size.h / 2);
      if (!WorldMap.isSolid(collisionBox(state.x, tryY))) state.y = tryY;

      state.animTimer += dt;
      if (state.animTimer > 0.16) {
        state.animTimer = 0;
        state.animFrame = 1 - state.animFrame;
      }
    } else {
      state.animFrame = 0;
      state.animTimer = 0;
    }

    return state.walking;
  }

  return { state, update };
})();


/* ==========================================================================
   7. Progression — contador de objetos encontrados + desbloqueio da área final
   ========================================================================== */
const Progression = (() => {
  const total = WorldMap.interactables.length;
  let foundCount = 0;
  const counterEl = document.getElementById('progress-counter');
  const toastEl = document.getElementById('game-toast');
  let toastTimeout = null;

  function showToast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.add('hidden'), 3200);
  }

  function markFound(obj) {
    if (obj.found) return;
    obj.found = true;
    foundCount++;
    counterEl.textContent = `objetos encontrados: ${foundCount}/${total}`;

    if (foundCount === total) {
      WorldMap.openGate();
      showToast(CONFIG.UNLOCK_TOAST);
    }
  }

  function isComplete() {
    return foundCount === total;
  }

  return { markFound, isComplete, showToast };
})();


/* ==========================================================================
   8. Dialogue — caixa de diálogo ao interagir com objetos
   ========================================================================== */
const Dialogue = (() => {
  const boxEl = document.getElementById('dialogue-box');
  const textEl = document.getElementById('dialogue-text');
  let hideTimeout = null;

  function show(message) {
    textEl.textContent = message;
    boxEl.classList.remove('hidden');
    if (hideTimeout) clearTimeout(hideTimeout);
    hideTimeout = setTimeout(hide, 4200);
  }

  function hide() {
    boxEl.classList.add('hidden');
  }

  return { show, hide };
})();


/* ==========================================================================
   9. EndSequence — tela final (fade + mensagens + botão continuar)
   ========================================================================== */
const EndSequence = (() => {
  const screenEl = document.getElementById('end-screen');
  const text1El = document.getElementById('end-text-1');
  const text2El = document.getElementById('end-text-2');
  const continueBtn = document.getElementById('btn-continue');
  let triggered = false;

  function trigger() {
    if (triggered) return;
    triggered = true;

    AudioManager.completeSound();
    text1El.textContent = CONFIG.FINAL_MESSAGE_PART_1;
    text2El.textContent = CONFIG.FINAL_MESSAGE_PART_2;

    screenEl.classList.remove('hidden');
    requestAnimationFrame(() => screenEl.classList.add('fade-in'));

    continueBtn.classList.add('hidden');
    text2El.classList.add('hidden');

    setTimeout(() => continueBtn.classList.remove('hidden'), 2600);
  }

  function bind() {
    continueBtn.addEventListener('click', () => {
      continueBtn.classList.add('hidden');
      text2El.classList.remove('hidden');
    });
  }

  function isTriggered() { return triggered; }

  return { trigger, bind, isTriggered };
})();


/* ==========================================================================
   10. Renderer — desenha o mundo num canvas de baixa resolução (efeito
       pixel art) e depois amplia sem suavização para o canvas visível.
   ========================================================================== */
const Renderer = (() => {
  const visibleCanvas = document.getElementById('game-canvas');
  const vctx = visibleCanvas.getContext('2d');

  const low = document.createElement('canvas');
  const lctx = low.getContext('2d');

  let time = 0;

  // Partículas ambiente (vaga-lumes) — puramente decorativas.
  const fireflies = [];
  for (let i = 0; i < 14; i++) {
    fireflies.push({
      baseX: 100 + (i * 91) % (WorldMap.WORLD_W - 200),
      baseY: 300 + (i * 137) % (WorldMap.WORLD_H - 500),
      phase: i * 1.7
    });
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;

    visibleCanvas.width = Math.floor(w * dpr);
    visibleCanvas.height = Math.floor(h * dpr);
    visibleCanvas.style.width = w + 'px';
    visibleCanvas.style.height = h + 'px';

    Camera.resize(w / h);
    low.width = Camera.viewW;
    low.height = Camera.viewH;

    vctx.imageSmoothingEnabled = false;
  }

  /* ---------- helpers de desenho ---------- */

  function drawSky() {
    const g = lctx.createLinearGradient(0, 0, 0, low.height);
    g.addColorStop(0, '#060815');
    g.addColorStop(0.6, '#0b0f22');
    g.addColorStop(1, '#141a33');
    lctx.fillStyle = g;
    lctx.fillRect(0, 0, low.width, low.height);

    // lua
    const moonX = low.width * 0.78, moonY = low.height * 0.18, moonR = 13;
    const glow = lctx.createRadialGradient(moonX, moonY, 2, moonX, moonY, moonR * 3);
    glow.addColorStop(0, 'rgba(238,236,214,0.35)');
    glow.addColorStop(1, 'rgba(238,236,214,0)');
    lctx.fillStyle = glow;
    lctx.beginPath(); lctx.arc(moonX, moonY, moonR * 3, 0, Math.PI * 2); lctx.fill();

    lctx.fillStyle = '#f2eede';
    lctx.beginPath(); lctx.arc(moonX, moonY, moonR, 0, Math.PI * 2); lctx.fill();
    lctx.fillStyle = 'rgba(200,196,176,0.5)';
    lctx.beginPath(); lctx.arc(moonX - 4, moonY - 3, 2.4, 0, Math.PI * 2); lctx.fill();
    lctx.beginPath(); lctx.arc(moonX + 3, moonY + 4, 1.6, 0, Math.PI * 2); lctx.fill();

    // estrelas fixas com leve cintilação
    lctx.fillStyle = '#ffffff';
    for (let i = 0; i < 46; i++) {
      const sx = (i * 53.7) % low.width;
      const sy = (i * 91.3) % (low.height * 0.65);
      const tw = 0.5 + 0.5 * Math.sin(time * 2 + i);
      lctx.globalAlpha = 0.25 + tw * 0.55;
      lctx.fillRect(sx, sy, 1, 1);
    }
    lctx.globalAlpha = 1;
  }

  function drawGround() {
    lctx.fillStyle = '#1c3324';
    lctx.fillRect(-Camera.x, -Camera.y, WorldMap.WORLD_W, WorldMap.WORLD_H);
  }

  function drawPath() {
    function strokePath(points) {
      lctx.beginPath();
      lctx.moveTo(points[0].x - Camera.x, points[0].y - Camera.y);
      for (let i = 1; i < points.length; i++) {
        lctx.lineTo(points[i].x - Camera.x, points[i].y - Camera.y);
      }
      lctx.stroke();
    }

    lctx.strokeStyle = '#4a3a28';
    lctx.lineWidth = 15;
    lctx.lineCap = 'round';
    lctx.lineJoin = 'round';
    strokePath(WorldMap.pathPoints);
    strokePath(WorldMap.pathBranch);

    lctx.strokeStyle = '#5c4a34';
    lctx.lineWidth = 9;
    strokePath(WorldMap.pathPoints);
    strokePath(WorldMap.pathBranch);
  }

  function drawGrassTufts() {
    lctx.strokeStyle = 'rgba(90,140,90,0.55)';
    lctx.lineWidth = 1;
    for (const g of WorldMap.grassTufts) {
      const x = g.x - Camera.x, y = g.y - Camera.y;
      if (x < -5 || x > low.width + 5 || y < -5 || y > low.height + 5) continue;
      lctx.beginPath();
      lctx.moveTo(x - 2, y + 2); lctx.lineTo(x, y - 3); lctx.lineTo(x + 2, y + 2);
      lctx.stroke();
    }
  }

  function drawFlowersDecor() {
    for (const f of WorldMap.flowersDecor) {
      const x = f.x - Camera.x, y = f.y - Camera.y;
      if (x < -5 || x > low.width + 5 || y < -5 || y > low.height + 5) continue;
      lctx.fillStyle = `hsl(${f.hue}, 70%, 72%)`;
      lctx.fillRect(x - 1, y - 1, 2, 2);
    }
  }

  function drawPond() {
    const p = WorldMap.pond;
    const x = p.x - Camera.x, y = p.y - Camera.y;

    lctx.fillStyle = '#1c3a52';
    roundRect(lctx, x, y, p.w, p.h, 14);
    lctx.fill();

    // reflexo suave da lua + ondulações animadas
    lctx.strokeStyle = 'rgba(220,230,255,0.18)';
    lctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const ry = y + 20 + i * 30 + Math.sin(time * 0.6 + i) * 3;
      lctx.beginPath();
      lctx.moveTo(x + 14, ry);
      lctx.quadraticCurveTo(x + p.w / 2, ry + 5, x + p.w - 14, ry);
      lctx.stroke();
    }

    // ponte de madeira sobre o vão central
    const gapX0 = p.bridgeGapX[0] - Camera.x, gapX1 = p.bridgeGapX[1] - Camera.x;
    lctx.fillStyle = '#6b4a30';
    lctx.fillRect(gapX0 - 2, y - 4, (gapX1 - gapX0) + 4, p.h + 8);
    lctx.strokeStyle = '#4a3220';
    lctx.lineWidth = 1;
    for (let plank = 0; plank < 7; plank++) {
      const py = y - 4 + plank * ((p.h + 8) / 7);
      lctx.beginPath(); lctx.moveTo(gapX0 - 2, py); lctx.lineTo(gapX1 + 2, py); lctx.stroke();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawRocks() {
    lctx.fillStyle = '#5c5f6b';
    for (const s of WorldMap.solids) {
      if (!s.id.startsWith('rock')) continue;
      const x = s.x - Camera.x, y = s.y - Camera.y;
      roundRect(lctx, x, y, s.w, s.h, 4);
      lctx.fill();
    }
  }

  function drawBench() {
    const b = WorldMap.solids.find(s => s.id === 'bench');
    const x = b.x - Camera.x, y = b.y - Camera.y;
    lctx.fillStyle = '#6b4a30';
    lctx.fillRect(x, y, b.w, b.h);
    lctx.fillRect(x, y - 8, 3, 8);
    lctx.fillRect(x + b.w - 3, y - 8, 3, 8);
  }

  function drawHouse() {
    const h = WorldMap.house;
    const x = h.x - Camera.x, y = h.y - Camera.y;

    lctx.fillStyle = '#3a2f42';
    lctx.fillRect(x, y, h.w, h.h);

    lctx.fillStyle = '#241c30';
    lctx.beginPath();
    lctx.moveTo(x - 10, y);
    lctx.lineTo(x + h.w / 2, y - 42);
    lctx.lineTo(x + h.w + 10, y);
    lctx.closePath();
    lctx.fill();

    // janelas com luz quente
    const winGlow = lctx.createRadialGradient(x + 30, y + 40, 1, x + 30, y + 40, 16);
    winGlow.addColorStop(0, 'rgba(255,214,140,0.55)');
    winGlow.addColorStop(1, 'rgba(255,214,140,0)');
    lctx.fillStyle = winGlow;
    lctx.fillRect(x + 10, y + 20, 40, 40);

    lctx.fillStyle = '#ffd68c';
    lctx.fillRect(x + 24, y + 32, 12, 12);
    lctx.fillRect(x + 96, y + 32, 12, 12);

    // porta
    lctx.fillStyle = '#20161c';
    lctx.fillRect(x + h.w / 2 - 10, y + h.h - 34, 20, 34);
  }

  function drawTrees(specialIds) {
    for (let i = 0; i < WorldMap.trees.length; i++) {
      const t = WorldMap.trees[i];
      drawTree(t.x, t.y, false);
    }
    // árvore especial (interativa) desenhada separadamente com brilho
    for (const obj of WorldMap.interactables) {
      if (obj.type === 'specialtree') drawTree(obj.x, obj.y, true);
    }
  }

  function drawTree(wx, wy, special) {
    const x = wx - Camera.x, y = wy - Camera.y;
    if (x < -40 || x > low.width + 40 || y < -60 || y > low.height + 40) return;

    lctx.fillStyle = '#4a3220';
    lctx.fillRect(x - 3, y, 6, 16);

    if (special) {
      const glow = lctx.createRadialGradient(x, y - 20, 2, x, y - 20, 26);
      glow.addColorStop(0, 'rgba(255,224,150,0.35)');
      glow.addColorStop(1, 'rgba(255,224,150,0)');
      lctx.fillStyle = glow;
      lctx.beginPath(); lctx.arc(x, y - 20, 26, 0, Math.PI * 2); lctx.fill();
    }

    lctx.fillStyle = special ? '#3f6b3a' : '#22462a';
    circleBlob(x, y - 12, 13);
    circleBlob(x - 8, y - 6, 9);
    circleBlob(x + 8, y - 6, 9);

    lctx.fillStyle = special ? '#5c8c4e' : '#2e5934';
    circleBlob(x - 3, y - 18, 8);
  }

  function circleBlob(x, y, r) {
    lctx.beginPath();
    lctx.arc(x, y, r, 0, Math.PI * 2);
    lctx.fill();
  }

  function drawLanterns() {
    for (const l of WorldMap.lanterns) {
      const x = l.x - Camera.x, y = l.y - Camera.y;
      if (x < -30 || x > low.width + 30 || y < -30 || y > low.height + 30) continue;

      const flicker = 0.85 + Math.sin(time * 4 + l.x) * 0.15;
      const glow = lctx.createRadialGradient(x, y - 22, 2, x, y - 22, 34 * flicker);
      glow.addColorStop(0, 'rgba(255,196,110,0.4)');
      glow.addColorStop(1, 'rgba(255,196,110,0)');
      lctx.fillStyle = glow;
      lctx.beginPath(); lctx.arc(x, y - 22, 34 * flicker, 0, Math.PI * 2); lctx.fill();

      lctx.fillStyle = '#3a2f26';
      lctx.fillRect(x - 1.5, y - 22, 3, 22);
      lctx.fillStyle = '#ffcf7a';
      lctx.fillRect(x - 3, y - 28, 6, 8);
    }
  }

  function drawFireflies() {
    lctx.fillStyle = '#d7ffb0';
    for (const f of fireflies) {
      const wx = f.baseX + Math.sin(time * 0.6 + f.phase) * 24;
      const wy = f.baseY + Math.cos(time * 0.5 + f.phase * 1.3) * 14;
      const x = wx - Camera.x, y = wy - Camera.y;
      if (x < 0 || x > low.width || y < 0 || y > low.height) continue;

      const a = 0.4 + 0.6 * Math.max(0, Math.sin(time * 3 + f.phase));
      lctx.globalAlpha = a;
      lctx.fillRect(x, y, 1.4, 1.4);
    }
    lctx.globalAlpha = 1;
  }

  function drawInteractIcon(obj) {
    const x = obj.x - Camera.x;
    const y = obj.y - Camera.y - 16;
    if (x < -20 || x > low.width + 20 || y < -20 || y > low.height + 20) return;

    const bob = Math.sin(time * 2.4 + obj.x) * 2;
    lctx.font = '10px sans-serif';
    lctx.textAlign = 'center';
    lctx.textBaseline = 'middle';

    if (!obj.found) {
      lctx.globalAlpha = 0.9;
      lctx.fillText(obj.icon, x, y + bob);
      lctx.globalAlpha = 1;
    } else {
      lctx.globalAlpha = 0.35;
      lctx.fillText(obj.icon, x, y + bob);
      lctx.globalAlpha = 1;
    }
  }

  function drawCat(obj) {
    const t = time * 1.4 + obj.baseX;
    obj.x = obj.baseX + Math.sin(t) * 26;
    obj.y = obj.baseY + Math.sin(t * 0.6) * 6;

    const x = obj.x - Camera.x, y = obj.y - Camera.y;
    if (x < -20 || x > low.width + 20 || y < -20 || y > low.height + 20) return;

    lctx.fillStyle = '#2f2b3a';
    roundRect(lctx, x - 5, y - 4, 10, 6, 2); lctx.fill();
    roundRect(lctx, x - 3, y - 8, 6, 5, 1); lctx.fill();
    lctx.beginPath();
    lctx.moveTo(x - 3, y - 8); lctx.lineTo(x - 4, y - 11); lctx.lineTo(x - 1.5, y - 8.5); lctx.fill();
    lctx.beginPath();
    lctx.moveTo(x + 3, y - 8); lctx.lineTo(x + 4, y - 11); lctx.lineTo(x + 1.5, y - 8.5); lctx.fill();

    drawInteractIcon(obj);
  }

  function drawFinalSpot() {
    const spot = WorldMap.finalSpot;
    const opened = WorldMap.gate.opened;
    const x = spot.x - Camera.x, y = spot.y - Camera.y;
    if (x < -30 || x > low.width + 30 || y < -30 || y > low.height + 30) return;

    if (opened) {
      const pulse = 20 + Math.sin(time * 2) * 4;
      const glow = lctx.createRadialGradient(x, y - 10, 2, x, y - 10, pulse);
      glow.addColorStop(0, 'rgba(232,195,122,0.45)');
      glow.addColorStop(1, 'rgba(232,195,122,0)');
      lctx.fillStyle = glow;
      lctx.beginPath(); lctx.arc(x, y - 10, pulse, 0, Math.PI * 2); lctx.fill();

      // ===== Personagem do final: menino de cabelo preto e óculos =====
      const idleBob = Math.sin(time * 2.4) * 1.2;
      drawCharacter(x, y, 'down', idleBob, 0, {
        bodyColor: '#1c1c1c',      // roupa preta
        dress: false,
        skinColor: '#f2c9a0',
        hairColor: '#1e1a18',      // preto
        hairStyle: 'short',
        glasses: true
      });
    } else {
      // portão fechado: pequena cerca indicando que ainda não dá pra passar
      lctx.fillStyle = '#4a3220';
      for (let i = 0; i < 3; i++) {
        lctx.fillRect(WorldMap.gate.x - Camera.x + i * 7, WorldMap.gate.y - Camera.y, 4, WorldMap.gate.h);
      }
    }
  }

  // Desenha um personagem genérico (usado pra menina protagonista e pro
  // menino que aparece no final) — x,y são a posição dos "pés" na tela.
  function drawCharacter(x, y, facing, bob, legOffset, opts) {
    const { bodyColor, skinColor, hairColor, hairStyle, glasses } = opts;

    // sombra
    lctx.fillStyle = 'rgba(0,0,0,0.3)';
    lctx.beginPath();
    lctx.ellipse(x, y + 4, 6, 2.4, 0, 0, Math.PI * 2);
    lctx.fill();

    // pernas (ou saia, se hairStyle indicar personagem de vestido)
    if (opts.dress) {
      lctx.fillStyle = opts.dressColor || bodyColor;
      lctx.beginPath();
      lctx.moveTo(x - 3, y - 8 + bob);
      lctx.lineTo(x + 3, y - 8 + bob);
      lctx.lineTo(x + 5, y + bob);
      lctx.lineTo(x - 5, y + bob);
      lctx.closePath();
      lctx.fill();
    } else {
      lctx.fillStyle = '#2b3350';
      lctx.fillRect(x - 4, y - 6 + bob, 3, 7 - legOffset);
      lctx.fillRect(x + 1, y - 6 + bob, 3, 7 + legOffset);
    }

    // corpo
    lctx.fillStyle = bodyColor;
    lctx.fillRect(x - 5, y - 16 + bob, 10, 11);

    // braços (só desenhados nas laterais quando de frente/costas)
    lctx.fillStyle = skinColor;
    if (facing === 'left') {
      lctx.fillRect(x - 7, y - 14 + bob, 3, 7);
    } else if (facing === 'right') {
      lctx.fillRect(x + 4, y - 14 + bob, 3, 7);
    } else {
      lctx.fillRect(x - 7, y - 13 + bob, 2, 6);
      lctx.fillRect(x + 5, y - 13 + bob, 2, 6);
    }

    // cabeça
    lctx.fillStyle = skinColor;
    lctx.fillRect(x - 4, y - 25 + bob, 8, 8);

    // cabelo (varia um pouco conforme a direção)
    lctx.fillStyle = hairColor;
    if (facing === 'up') {
      lctx.fillRect(x - 4, y - 26 + bob, 8, 4);
      if (hairStyle === 'long') {
        lctx.fillRect(x - 5, y - 22 + bob, 2, 6);
        lctx.fillRect(x + 3, y - 22 + bob, 2, 6);
      }
    } else {
      lctx.fillRect(x - 4, y - 26 + bob, 8, 3);
      lctx.fillRect(x - 4, y - 23 + bob, 2, 3);
      lctx.fillRect(x + 2, y - 23 + bob, 2, 3);
      if (hairStyle === 'long') {
        // cabelo comprido descendo pelos ombros
        lctx.fillRect(x - 6, y - 21 + bob, 2, 8);
        lctx.fillRect(x + 4, y - 21 + bob, 2, 8);
      }
    }

    // óculos (fixos no rosto, sempre visíveis quando o personagem os usa)
    if (glasses) {
      lctx.fillStyle = '#20202a';
      lctx.fillRect(x - 4, y - 21 + bob, 3, 2);
      lctx.fillRect(x + 1, y - 21 + bob, 3, 2);
      lctx.fillRect(x - 1, y - 20 + bob, 2, 1);
    }

    // rosto simples (só quando de frente, e sem óculos por cima dos olhos)
    if (facing === 'down' && !glasses) {
      lctx.fillStyle = '#33261e';
      lctx.fillRect(x - 2, y - 21 + bob, 1, 1);
      lctx.fillRect(x + 1, y - 21 + bob, 1, 1);
    }
  }

  function drawPlayer() {
    const p = Player.state;
    const x = p.x - Camera.x, y = p.y - Camera.y;
    const bob = p.walking ? (p.animFrame === 0 ? 0 : -1) : 0;
    const legOffset = p.walking ? (p.animFrame === 0 ? 1 : -1) : 0;

    // ===== Personagem principal: menina de cabelo loiro =====
    drawCharacter(x, y, p.facing, bob, legOffset, {
      bodyColor: '#5fae6f',       // vestido verde
      dress: true,
      dressColor: '#5fae6f',
      skinColor: '#f2c9a0',
      hairColor: '#e8c85a',       // loiro
      hairStyle: 'long',
      glasses: false
    });
  }

  function draw(nearestInteractable) {
    time += 0.016;

    drawSky();
    drawGround();
    drawPath();
    drawGrassTufts();
    drawFlowersDecor();
    drawPond();
    drawRocks();
    drawBench();
    drawHouse();
    drawLanterns();
    drawTrees();
    drawFinalSpot();

    for (const obj of WorldMap.interactables) {
      if (obj.type === 'animal') { drawCat(obj); continue; }
      drawInteractIcon(obj);
    }

    // desenha jogador respeitando profundidade (y) em relação às árvores/casa
    drawPlayer();

    drawFireflies();

    // amplia o canvas de baixa resolução para o canvas visível (pixel art)
    vctx.imageSmoothingEnabled = false;
    vctx.clearRect(0, 0, visibleCanvas.width, visibleCanvas.height);
    vctx.drawImage(low, 0, 0, low.width, low.height, 0, 0, visibleCanvas.width, visibleCanvas.height);
  }

  return { resize, draw };
})();


/* ==========================================================================
   11. Game — loop principal, interação e transições de tela
   ========================================================================== */
const Game = (() => {
  const hintEl = document.getElementById('interact-hint');
  let lastTime = 0;
  let running = false;

  function findNearestInteractable() {
    const p = Player.state;
    let nearest = null, nearestDist = Infinity;

    for (const obj of WorldMap.interactables) {
      const d = Utils.distance(p.x, p.y, obj.x, obj.y);
      if (d < CONFIG.INTERACT_RADIUS && d < nearestDist) {
        nearest = obj; nearestDist = d;
      }
    }

    if (WorldMap.gate.opened) {
      const spot = WorldMap.finalSpot;
      const d = Utils.distance(p.x, p.y, spot.x, spot.y);
      if (d < CONFIG.INTERACT_RADIUS && d < nearestDist) {
        nearest = spot; nearestDist = d;
      }
    }

    return nearest;
  }

  function handleInteract(target) {
    if (!target) return;

    if (target.id === 'final') {
      EndSequence.trigger();
      return;
    }

    AudioManager.interactSound();
    Dialogue.show(target.message);

    if (!target.found) {
      AudioManager.discoverSound();
      Progression.markFound(target);
    }
  }

  function loop(now) {
    if (!running) return;
    const dt = Math.min((now - lastTime) / 1000 || 0, 0.05);
    lastTime = now;

    const walking = Player.update(dt);
    if (walking) AudioManager.footstep(now);

    Camera.follow(Player.state.x, Player.state.y);

    const nearest = findNearestInteractable();
    hintEl.classList.toggle('hidden', !nearest || EndSequence.isTriggered());

    if (InputManager.consumeInteract() && !EndSequence.isTriggered()) {
      handleInteract(nearest);
    }

    Renderer.draw(nearest);

    requestAnimationFrame(loop);
  }

  function start() {
    running = true;
    lastTime = performance.now();
    requestAnimationFrame(loop);
  }

  return { start };
})();


/* ==========================================================================
   12. Bootstrap
   ========================================================================== */
document.addEventListener('DOMContentLoaded', () => {
  InputManager.init();
  AudioManager.init();
  EndSequence.bind();
  Renderer.resize();

  window.addEventListener('resize', () => Renderer.resize());
  window.addEventListener('orientationchange', () => setTimeout(Renderer.resize, 200));

  const startScreen = document.getElementById('start-screen');
  const gameContainer = document.getElementById('game-container');
  const startBtn = document.getElementById('btn-start');

  startBtn.addEventListener('click', () => {
    AudioManager.ensureContext();
    startScreen.classList.add('hidden');
    gameContainer.classList.remove('hidden');
    Renderer.resize();
    Game.start();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
});