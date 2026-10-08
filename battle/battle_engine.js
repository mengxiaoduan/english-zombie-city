/* 丧尸英语城 - M1 战斗核心 + 演出式波次遭遇
 * 关卡设计依据（The Level Design Book / Schell 兴趣曲线 / 快打旋风式清版节奏）：
 *   - 街道 = 探索拍(安全) 与 遭遇拍(战斗锁定) 交替 → 兴趣曲线
 *   - 每场遭遇是"预告(入场标记)→冲突→结算(肃清横幅+金币)"的小故事
 *   - 敌人小组制(2~3只)梯度混编：教学→提速→坦克+背袭，不做无脑刷怪
 * 打击感：hitstop 冻帧 / 受击闪白 / 击退 / 伤害数字 / 连击 / 屏震 / WebAudio 音效
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var A = ZCITY.Assets;

  /* ---------- 场景 ---------- */
  var SCENES = {
    street: {
      id: 'street', name: '死亡大道', worldW: 1700, indoor: false,
      spawn: { x: 140 }, doors: [
        { x: 1560, label: '进入便利店', to: 'store', backX: 1500, w: 58 }
      ]
    },
    store: {
      id: 'store', name: '便利店内部', worldW: 780, indoor: true,
      spawn: { x: 150 }, doors: [
        { x: 90, label: '回到街道', to: 'street', backX: 1500, w: 54 }
      ]
    }
  };

  /* ---------- 遭遇波次表（演出编排）----------
   * 每波: [type, side('R'右侧/'L'左侧背袭), 入场延迟秒]
   * z1 教学: 2 只慢A，先后入场 —— 教会玩家砍击
   * z2 提速: 3 只混编 A/B —— 测试走位
   * z3 高潮: 两波 —— 先 2A 热身，再 B+C+背袭B —— 转合
   */
  var ZONES = [
    { x: 360,  waves: [[['A', 'R', 0.6], ['A', 'R', 2.0]]] },
    { x: 800,  waves: [[['A', 'R', 0.6], ['B', 'R', 1.6], ['A', 'R', 2.8]]] },
    { x: 1250, waves: [[['A', 'R', 0.6], ['A', 'R', 1.6]],
                       [['B', 'R', 0.5], ['C', 'R', 1.2], ['B', 'L', 2.6]]] }
  ];

  /* ---------- 数值 ---------- */
  var WALK = { hero: 225, vert: 150, bandTop: 24, bandBot: 12 };
  var ATK = { dmg: 25, reach: 66, arc: 42, cd: 0.42, dur: 0.16, lunge: 14 };
  var ZSTAT = {
    A: { hp: 50,  speed: 40, dmg: 12, coin: 3, dispH: 100, windup: 0.5,  interruptible: true },
    B: { hp: 35,  speed: 88, dmg: 10, coin: 4, dispH: 92,  windup: 0.38, interruptible: true },
    C: { hp: 130, speed: 30, dmg: 22, coin: 6, dispH: 128, windup: 0.55, interruptible: false }   // 坦克霸体：砍不断蓄力
  };

  var canvas, ctx, dpr = 1;
  var view = { w: 0, h: 0, groundY: 0 };
  var scene, hero, zombies, camera, trans = { a: 0, phase: 0, cb: null };
  var keys = { left: false, right: false, up: false, down: false };
  var running = false, lastT = 0, rafId = 0;
  var hud = {}, coinsCount = 0, coinPop = 0, nearDoor = null, toastTimer = 0;

  /* 战斗状态 */
  var fx = {
    hitstop: 0, shakeT: 0, shakeMag: 0,
    dmgNums: [], coins: [], slashT: 0,
    combo: 0, comboT: 0, comboPop: 0,
    markers: []
  };
  var enc = { zoneIdx: 0, phase: 'calm', waveIdx: 0, queue: [], waveGap: 0, lockCam: -1, allClear: false };
  var defeated = false;

  function bandTop() { return view.groundY + WALK.bandTop; }
  function bandBot() { return view.h - WALK.bandBot; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---------- 音效（WebAudio 合成，零素材） ---------- */
  var AC = null, lastCoinSnd = 0;
  function audio() {
    if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { } }
    if (AC && AC.state === 'suspended') AC.resume();
    return AC;
  }
  function tone(freq, dur, type, vol, slide) {
    var ac = audio(); if (!ac) return;
    var o = ac.createOscillator(), g = ac.createGain();
    o.type = type || 'square'; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, slide), ac.currentTime + dur);
    g.gain.setValueAtTime(vol || 0.12, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(); o.stop(ac.currentTime + dur);
  }
  function noise(dur, vol, freq) {
    var ac = audio(); if (!ac) return;
    var n = Math.floor(ac.sampleRate * dur);
    var buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var s = ac.createBufferSource(); s.buffer = buf;
    var f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq || 900;
    var g = ac.createGain(); g.gain.value = vol || 0.2;
    s.connect(f); f.connect(g); g.connect(ac.destination); s.start();
  }
  var S = {
    swing: function () { noise(0.09, 0.10, 2400); },
    hit:   function () { tone(95, 0.1, 'square', 0.16, 50); noise(0.06, 0.18, 700); },
    hurt:  function () { tone(140, 0.22, 'sawtooth', 0.14, 60); },
    coin:  function () {
      var now = performance.now();
      if (now - lastCoinSnd < 70) return;
      lastCoinSnd = now;
      tone(1320, 0.07, 'square', 0.07); setTimeout(function () { tone(1760, 0.09, 'square', 0.06); }, 60);
    },
    clear: function () { [523, 659, 784, 1047].forEach(function (f, i) { setTimeout(function () { tone(f, 0.14, 'triangle', 0.1); }, i * 90); }); },
    wave:  function () { tone(220, 0.18, 'sawtooth', 0.08, 110); },
    die:   function () { tone(160, 0.3, 'sawtooth', 0.1, 40); noise(0.2, 0.14, 500); }
  };

  /* ---------- 画布 ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w; view.h = h;
    view.groundY = Math.round(h * 0.78);
    ctx.imageSmoothingEnabled = false;
    if (hero) hero.y = clamp(hero.y, bandTop(), bandBot());
  }

  /* ---------- 实体 ---------- */
  function makeHero(x) {
    return { x: x, y: (bandTop() + bandBot()) / 2, face: 1, walkPhase: 0, moving: false,
             hp: 100, hpMax: 100, invulnT: 0, atkCd: 0, atkT: 0 };
  }
  function zStat(t) { return ZSTAT[t] || ZSTAT.A; }
  function spawnZombieNow(type, side) {
    var st = zStat(type);
    var sx = side === 'L' ? camera.x - 60 - Math.random() * 80
                          : camera.x + view.w + 50 + Math.random() * 90;
    zombies.push({
      type: type, x: sx, y: bandTop() + 24 + Math.random() * (bandBot() - bandTop() - 48),
      hp: st.hp, dispH: st.dispH, speed: st.speed, dmg: st.dmg, coin: st.coin,
      phase: Math.random() * 10, entering: true,
      windup: 0, atkCd: 1.2, atkT: 0, hurtT: 0, kb: 0,
      dead: false, deadT: 0, squish: 0,
      spell: Math.random() < 0.5 ? '火' : '冰'
    });
    S.wave();
  }

  /* ---------- 遭遇编排 ---------- */
  function zoneActive() { return enc.phase === 'active'; }
  function beginZone(z) {
    enc.phase = 'active';
    enc.waveIdx = 0;
    enc.lockCam = clamp(z.x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
    scheduleWave(0);
    banner('⚠ 遭遇丧尸', '#ffd873');
  }
  function scheduleWave(i) {
    enc.queue = ZONES[enc.zoneIdx].waves[i].map(function (w) {
      return { type: w[0], side: w[1], t: w[2] };
    });
  }
  function waveDefeated() {
    return enc.queue.length === 0 && zombies.every(function (z) { return z.dead; });
  }
  function encTick(dt) {
    if (scene.indoor) return;
    // 探索拍→触发遭遇 / 肃清拍→进入下一段探索（必须在 active 早退之前）
    if (enc.phase === 'calm' && enc.zoneIdx < ZONES.length) {
      if (hero.x >= ZONES[enc.zoneIdx].x) beginZone(ZONES[enc.zoneIdx]);
    }
    if (enc.phase === 'clear' && enc.zoneIdx < ZONES.length - 1) {
      enc.zoneIdx++; enc.phase = 'calm';
    }
    if (enc.phase !== 'active') return;
    var zone = ZONES[enc.zoneIdx];
    // 入场倒计时
    for (var i = enc.queue.length - 1; i >= 0; i--) {
      var q = enc.queue[i];
      q.t -= dt;
      if (q.t <= 0) { spawnZombieNow(q.type, q.side); enc.queue.splice(i, 1); }
    }
    if (waveDefeated() && enc.waveGap <= 0) {
      if (enc.waveIdx < zone.waves.length - 1) {
        enc.waveGap = 1.15;                                  // 波间呼吸
        enc.waveIdx++;
        banner('第二波来袭！', '#ff9c6b');
      } else {
        // 区域肃清：结算拍
        enc.phase = 'clear'; enc.lockCam = -1;
        hero.hp = Math.min(hero.hpMax, hero.hp + 12);        // 休息回复
        coinsCount += 5; coinPop = 0.3;
        banner('✔ 区域肃清  +5金币', '#9ce89c');
        S.clear();
        if (enc.zoneIdx >= ZONES.length - 1) {
          enc.allClear = true;
          setTimeout(function () { showToast('大道已肃清！进便利店补给吧 🚪', 2600); }, 1500);
        }
      }
    }
    if (enc.waveGap > 0) {
      enc.waveGap -= dt;
      if (enc.waveGap <= 0) scheduleWave(enc.waveIdx);
    }
  }

  /* ---------- 战斗 ---------- */
  function tryAttack() {
    if (defeated || hero.atkCd > 0 || trans.phase !== 0) return;
    hero.atkCd = ATK.cd; hero.atkT = ATK.dur;
    fx.slashT = ATK.dur;
    S.swing();
    var hitAny = false;
    for (var i = 0; i < zombies.length; i++) {
      var z = zombies[i];
      if (z.dead) continue;
      var dx = (z.x - hero.x) * hero.face;                   // 面前为正
      if (dx > -10 && dx < ATK.reach && Math.abs(z.y - hero.y) < ATK.arc) {
        z.hp -= ATK.dmg;
        z.hurtT = 0.16;
        z.kb = hero.face * 150 * (zStat(z.type).interruptible ? 1 : 0.35);   // 坦克抗击退
        if (zStat(z.type).interruptible) z.windup = 0;                       // 只有 A/B 蓄力可被打断
        hitAny = true;
        fx.dmgNums.push({ x: z.x, y: z.y - z.dispH - 14, txt: String(ATK.dmg), t: 0.7, crit: false });
        if (z.hp <= 0) killZombie(z);
      }
    }
    if (hitAny) {
      fx.hitstop = 0.07;                                     // 砍中：人停住（打击阻力）
      fx.combo++; fx.comboT = 2.5; fx.comboPop = 1;
      if (fx.combo >= 3) { fx.shakeT = 0.18; fx.shakeMag = 3; }
      S.hit();
    } else {
      hero.x = clamp(hero.x + hero.face * ATK.lunge, 26, scene.worldW - 26);   // 挥空：进步
    }
  }
  function killZombie(z) {
    z.dead = true; z.deadT = 0; z.squish = 1;
    S.die();
    for (var c = 0; c < z.coin; c++) {
      fx.coins.push({
        sx: z.x - camera.x, sy: z.y - z.dispH * 0.6 - c * 4,
        t: 0, dur: 0.55 + Math.random() * 0.3,
        delay: c * 0.06,
        cx: (Math.random() - 0.5) * 90,                      // 抛物线控制点
        arc: 60 + Math.random() * 70
      });
    }
  }
  function hurtPlayer(dmg, fromX) {
    if (hero.invulnT > 0 || defeated) return;
    hero.hp -= dmg;
    hero.invulnT = 0.95;
    hero.x = clamp(hero.x + (hero.x < fromX ? -26 : 26), 26, scene.worldW - 26);
    fx.combo = 0;
    fx.hitstop = 0.09;
    fx.shakeT = 0.3; fx.shakeMag = 5;
    fx.dmgNums.push({ x: hero.x, y: hero.y - 120, txt: '-' + dmg, t: 0.8, hurt: true });
    S.hurt();
    var v = document.getElementById('hurtFx');
    if (v) { v.style.opacity = '1'; setTimeout(function () { v.style.opacity = '0'; }, 180); }
    if (hero.hp <= 0) {
      hero.hp = 0; defeated = true;
      var p = document.getElementById('defeatPanel');
      if (p) p.classList.add('show');
    }
  }
  function retry() {
    var p = document.getElementById('defeatPanel');
    if (p) p.classList.remove('show');
    defeated = false;
    hero.hp = hero.hpMax; hero.invulnT = 1.6;
    zombies.length = 0; enc.queue.length = 0;
    // 重打当前区
    enc.phase = 'active'; enc.waveIdx = 0;
    enc.lockCam = clamp(ZONES[enc.zoneIdx].x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
    hero.x = enc.lockCam + 70; hero.y = (bandTop() + bandBot()) / 2;
    scheduleWave(0);
    banner('再战！', '#ffd873');
  }

  /* ---------- 场景切换 ---------- */
  function enterScene(id, backX) {
    scene = SCENES[id];
    zombies.length = 0; enc.queue.length = 0;
    if (id === 'street' && enc.allClear) enc.phase = 'clear';    // 肃清后回街不再触发
    hero.x = backX != null ? backX : scene.spawn.x;
    hero.y = (bandTop() + bandBot()) / 2;
    camera.x = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    if (id === 'street' && !enc.allClear && enc.phase === 'active') {
      enc.lockCam = clamp(ZONES[enc.zoneIdx].x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
      scheduleWave(enc.waveIdx);
    }
    nearDoor = null;
    document.getElementById('enterBtn').style.display = 'none';
    if (hud.scene) hud.scene.textContent = scene.name;
  }
  function startTransition(cb) {
    if (trans.phase !== 0) return;
    trans.phase = 1; trans.cb = cb;
  }

  /* ---------- 背景 ---------- */
  var BG_LAYERS = [
    { key: 'bg.skyline',   parallax: 0.15, scale: 2.3 },
    { key: 'bg.buildings', parallax: 0.42, scale: 2.9 },
    { key: 'bg.near',      parallax: 0.8,  scale: 2.3 }
  ];
  function drawStreetBg(camX) {
    var sky = ctx.createLinearGradient(0, 0, 0, view.groundY);
    sky.addColorStop(0, '#2b2333'); sky.addColorStop(0.6, '#5a3a44'); sky.addColorStop(1, '#8a5a3a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, view.w, view.groundY);
    var drew = 0;
    for (var i = 0; i < BG_LAYERS.length; i++) {
      var L = BG_LAYERS[i], e = A.get(L.key);
      if (!e || !e.ok) continue;
      var tw = e.img.naturalWidth * L.scale, th = e.img.naturalHeight * L.scale;
      var off = (camX * L.parallax) % tw;
      for (var x = -off; x < view.w; x += tw) ctx.drawImage(e.img, x, view.groundY - th, tw, th);
      drew++;
    }
    if (!drew) { ctx.fillStyle = '#241d2b'; ctx.fillRect(0, view.groundY - 220, view.w, 220); }
    ctx.fillStyle = '#2a2438'; ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.fillStyle = '#4a4060'; ctx.fillRect(0, view.groundY, view.w, 4);
    var dashY = view.groundY + (view.h - view.groundY) * 0.55;
    ctx.fillStyle = 'rgba(240,120,160,0.4)';
    var dashOff = -(camX % 90);
    for (var dx = dashOff; dx < view.w; dx += 90) ctx.fillRect(dx, dashY, 44, 3);
  }
  function drawStoreBg(camX) {
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#1c2430'); wall.addColorStop(1, '#2c3a48');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    for (var s = 120; s < scene.worldW; s += 230) {
      var sx = s - camX;
      if (sx < -160 || sx > view.w + 160) continue;
      ctx.fillStyle = '#3d4f60'; ctx.fillRect(sx, view.groundY - 150, 150, 110);
      ctx.fillStyle = '#556b80';
      for (var r = 0; r < 3; r++) ctx.fillRect(sx + 6, view.groundY - 142 + r * 34, 138, 8);
      var cols = ['#e2574c', '#ffd873', '#7ec8ff', '#9ce89c'];
      for (var c2 = 0; c2 < 6; c2++) {
        ctx.fillStyle = cols[(s + c2 + r) % 4];
        ctx.fillRect(sx + 12 + c2 * 22, view.groundY - 130 + ((c2 % 2) ? 34 : 0), 14, 20);
      }
    }
    ctx.fillStyle = 'rgba(220,240,255,0.85)';
    for (var l = 0; l < scene.worldW; l += 260) {
      var lx = l - camX;
      if (lx > -90 && lx < view.w) ctx.fillRect(lx, 26, 70, 8);
    }
    ctx.fillStyle = '#43414e';
    ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.strokeStyle = 'rgba(20,20,28,0.5)'; ctx.lineWidth = 1;
    var tile = 46, oy = (camX % tile);
    for (var gx = -oy; gx < view.w; gx += tile) {
      ctx.beginPath(); ctx.moveTo(gx, view.groundY); ctx.lineTo(gx - 26, view.h); ctx.stroke();
    }
    for (var gy = view.groundY + 18; gy < view.h; gy += 26) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(view.w, gy); ctx.stroke();
    }
  }
  function drawDoor(d) {
    var x = d.x - camera.x;
    if (x < -80 || x > view.w + 80) return;
    var dw = d.w || 56, dh = 88, top = view.groundY - dh;
    ctx.save();
    ctx.fillStyle = '#191420';
    ctx.fillRect(x - dw / 2, top, dw, dh);
    ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 3;
    ctx.strokeRect(x - dw / 2, top, dw, dh);
    var g = ctx.createLinearGradient(0, top, 0, view.groundY);
    g.addColorStop(0, 'rgba(255,190,90,0.55)'); g.addColorStop(1, 'rgba(255,120,60,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - dw / 2 + 3, top + 3, dw - 6, dh - 6);
    ctx.fillStyle = '#ffe28a';
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillRect(x - dw / 2 - 6, top - 24, dw + 12, 20);
    ctx.fillStyle = '#5a2a10';
    ctx.fillText(d.label.replace(/^(进入|回到)/, ''), x, top - 14);
    ctx.restore();
  }
  function drawBarricades() {
    if (scene.indoor) return;
    var hy = view.groundY, bh = view.h - view.groundY;
    [[0], [scene.worldW - 12]].forEach(function (b) {
      var x = b[0] - camera.x;
      if (x < -20 || x > view.w + 20) return;
      for (var i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 ? '#e2574c' : '#f5e6c8';
        ctx.fillRect(x, hy + i * (bh / 10), 12, bh / 10);
      }
    });
  }

  /* ---------- 角色 ---------- */
  function drawShadow(x, y, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, w, w * 0.28, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.restore();
  }
  function drawHero(h) {
    var x = h.x - camera.x, y = h.y;
    if (h.invulnT > 0 && Math.floor(h.invulnT * 14) % 2 === 0) return;   // 无敌闪烁
    drawShadow(x, y, 22);
    var e = A.get('hero.run'), moving = h.moving;
    var lean = h.atkT > 0 ? h.face * 6 : 0;                  // 出刀前倾
    if (e && e.ok) {
      var idx = moving ? Math.floor(h.walkPhase) : 0;
      var ee = moving ? e : (A.get('hero.idle') || e);
      A.drawFrame(ctx, ee, idx, x + lean, y, 108, h.face);
    } else {
      ctx.save(); ctx.translate(x + lean, y); ctx.scale(h.face, 1);
      var swing = Math.sin(h.walkPhase * Math.PI * 2) * (moving ? 1 : 0.12);
      ctx.fillStyle = '#3a6ea8'; ctx.fillRect(-9 + 7 * swing, -22, 8, 22); ctx.fillRect(1 - 7 * swing, -22, 8, 22);
      ctx.fillStyle = '#e2574c'; ctx.fillRect(-10, -48, 20, 27);
      ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, -44); ctx.lineTo(-12 * swing - 4, -32);
      ctx.moveTo(4, -44); ctx.lineTo(12 * swing + 4, -32); ctx.stroke();
      ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(0, -56, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2333'; ctx.fillRect(-9, -66, 18, 7);
      ctx.restore();
    }
    // 砍击弧光
    if (fx.slashT > 0) {
      var p = 1 - fx.slashT / ATK.dur;
      ctx.save();
      ctx.translate(x, y - 52); ctx.scale(h.face, 1);
      ctx.strokeStyle = 'rgba(255,240,190,' + (1 - p) + ')';
      ctx.lineWidth = 10 * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(10, 0, 46, -1.1 + p * 1.6, 0.6 + p * 1.6);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawZombie(z) {
    var x = z.x - camera.x;
    if (x < -170 || x > view.w + 170) return;
    if (z.dead) {                                            // 死亡：压扁+渐隐
      var p = Math.min(1, z.deadT / 0.55);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawShadow(x, z.y, 18 * (1 - p * 0.5));
      var e2 = A.get('zombie.' + z.type + '_walk');
      ctx.translate(x, z.y);
      ctx.scale(1 + p * 0.5, Math.max(0.05, 1 - p));         // squash
      ctx.translate(-x, -z.y);
      A.drawFrame(ctx, e2, 0, x, z.y, z.dispH, 1);
      ctx.restore();
      return;
    }
    drawShadow(x, z.y, 18);
    var lean = z.windup > 0 ? -6 * (1 - z.windup / zStat(z.type).windup) : 0;   // 蓄力后仰→前扑
    var anim = (z.close && !z.entering) ? z.type + '_attack' : z.type + '_walk';
    var e = A.get('zombie.' + anim) || A.get('zombie.' + z.type + '_walk');
    var rawIdx = z.windup > 0 ? Math.floor((zStat(z.type).windup - z.windup) * 10) : (z.close ? Math.floor(z.atkT) : Math.floor(z.phase));
    var idx = isFinite(rawIdx) ? rawIdx : 0;                 // 防 NaN 帧索引（曾致 tick 崩溃）
    var face = (hero.x < z.x) ? 1 : -1;
    var ok = A.drawFrame(ctx, e, idx, x + lean, z.y, z.dispH, face);
    if (!ok) {
      ctx.fillStyle = '#5c8a4a';
      ctx.fillRect(x - 12, z.y - z.dispH * 0.75, 24, z.dispH * 0.75);
      ctx.beginPath(); ctx.arc(x, z.y - z.dispH * 0.8, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (z.hurtT > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.65, z.hurtT * 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 20, z.y - z.dispH, 40, z.dispH);
      ctx.restore();
    }
    // 蓄力警告
    if (z.windup > 0) {
      ctx.save();
      ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb02e';
      ctx.fillText('!', x, z.y - z.dispH - 46 - (1 - z.windup / 0.5) * 6);
      ctx.restore();
    }
    // 血条（受伤才显示）
    if (z.hp < zStat(z.type).hp) {
      var bw = 44, hpP = z.hp / zStat(z.type).hp;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw, 5);
      ctx.fillStyle = hpP > 0.5 ? '#9ce89c' : hpP > 0.25 ? '#ffd873' : '#ff6b5c';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw * hpP, 5);
    }
    // 弱点字符牌
    var bob = Math.sin(z.phase * 0.6) * 3;
    var bw2 = 34, bx = x - bw2 / 2, by = z.y - z.dispH - 40 + bob;
    ctx.save();
    ctx.fillStyle = '#f5e6c8';
    ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw2, 32, 6); else ctx.rect(bx, by, bw2, 32);
    ctx.fill(); ctx.stroke();
    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c03028';
    ctx.fillText(z.spell, x, by + 17);
    ctx.restore();
  }
  function drawMarker(q) {                                   // 入场预告 "!"
    var x = (q.side === 'L' ? camera.x - 40 : camera.x + view.w + 40) - camera.x;
    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,90,70,' + (0.5 + 0.5 * Math.sin(performance.now() / 90)) + ')';
    ctx.fillText('!', x, view.groundY + 30);
    ctx.restore();
  }

  /* ---------- 特效层 ---------- */
  function drawFx(dt) {
    // 金币飞行（屏幕坐标，贝塞尔飞向金币 HUD）
    var tx = view.w - 64, ty = 38;
    for (var i = fx.coins.length - 1; i >= 0; i--) {
      var c = fx.coins[i];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.t += dt / c.dur;
      var t = Math.min(1, c.t);
      var mx = (c.sx + tx) / 2 + c.cx;
      var my = Math.min(c.sy, ty) - c.arc;
      var x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * mx + t * t * tx;
      var y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * my + t * t * ty;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.abs(Math.cos(t * 9)) * 0.7 + 0.3, 1);   // 硬币翻转
      ctx.fillStyle = '#ffd873'; ctx.strokeStyle = '#a87818'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (t >= 1) { fx.coins.splice(i, 1); coinsCount++; coinPop = 0.3; S.coin(); }
    }
    // 伤害数字
    for (var d = fx.dmgNums.length - 1; d >= 0; d--) {
      var n = fx.dmgNums[d];
      n.t -= dt; n.y -= dt * 44;
      if (n.t <= 0) { fx.dmgNums.splice(d, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, n.t * 2.5);
      ctx.font = 'bold 19px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = n.hurt ? '#ff6b5c' : '#ffe9a0';
      ctx.strokeStyle = 'rgba(20,10,0,0.8)'; ctx.lineWidth = 3;
      ctx.strokeText(n.txt, n.x - camera.x, n.y);
      ctx.fillText(n.txt, n.x - camera.x, n.y);
      ctx.restore();
    }
    // 连击
    if (fx.combo >= 2) {
      fx.comboPop = Math.max(0, fx.comboPop - dt * 4);
      ctx.save();
      var sc = 1 + fx.comboPop * 0.5;
      ctx.translate(view.w - 60, 96); ctx.scale(sc, sc);
      ctx.rotate(-0.08);
      ctx.font = 'bold 24px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd873'; ctx.strokeStyle = 'rgba(60,30,0,0.85)'; ctx.lineWidth = 4;
      ctx.strokeText('×' + fx.combo + ' 连击', 0, 0);
      ctx.fillText('×' + fx.combo + ' 连击', 0, 0);
      ctx.restore();
    }
    if (coinPop > 0) coinPop = Math.max(0, coinPop - dt * 3);
    if (fx.slashT > 0) fx.slashT -= dt;
  }

  /* ---------- HUD ---------- */
  function banner(text, color) {
    var b = document.getElementById('waveBanner');
    if (!b) return;
    b.textContent = text;
    b.style.color = color || '#ffd873';
    b.classList.remove('show');
    void b.offsetWidth;                                      // 重启动画
    b.classList.add('show');
  }
  function showToast(msg, ms) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 1900);
  }
  function updateHud() {
    if (hud.hp) hud.hp.style.width = Math.max(0, hero.hp / hero.hpMax * 100) + '%';
    if (hud.coins) {
      hud.coins.textContent = coinsCount;
      hud.coins.style.transform = coinPop > 0 ? 'scale(' + (1 + coinPop * 0.5) + ')' : '';
    }
  }

  /* ---------- 主循环 ---------- */
  function tick(t) {
    if (!running) return;
    var rdt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;

    if (trans.phase === 1) { trans.a += rdt * 4; if (trans.a >= 1) { trans.a = 1; if (trans.cb) { trans.cb(); trans.cb = null; } trans.phase = 2; } }
    else if (trans.phase === 2) { trans.a -= rdt * 2.4; if (trans.a <= 0) { trans.a = 0; trans.phase = 0; } }

    var dt = rdt;
    if (fx.hitstop > 0) { fx.hitstop -= rdt; dt = 0; }       // 冻帧：世界暂停仍在渲染
    if (fx.shakeT > 0) fx.shakeT -= rdt;

    if (!defeated) {
      // 八向移动
      var vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      hero.moving = !!(vx || vy);
      if (vx) hero.face = vx;
      var minX = 26, maxX = scene.worldW - 26;
      if (enc.lockCam >= 0) { minX = enc.lockCam + 26; maxX = enc.lockCam + view.w - 26; }  // 战斗锁定
      hero.x = clamp(hero.x + vx * WALK.hero * dt, minX, maxX);
      hero.y = clamp(hero.y + vy * WALK.vert * dt, bandTop(), bandBot());
      if (hero.moving) hero.walkPhase += dt * 1.7;
      if (hero.atkCd > 0) hero.atkCd -= rdt;
      if (hero.atkT > 0) hero.atkT -= rdt;
      if (hero.invulnT > 0) hero.invulnT -= rdt;

      encTick(dt);

      // 僵尸 AI
      for (var i = zombies.length - 1; i >= 0; i--) {
        var z = zombies[i];
        if (z.dead) { z.deadT += dt; if (z.deadT > 0.55) zombies.splice(i, 1); continue; }
        if (z.hurtT > 0) z.hurtT -= rdt;
        // 击退
        if (Math.abs(z.kb) > 4) { z.x += z.kb * dt; z.kb *= Math.max(0, 1 - 7 * dt); }
        var dx = hero.x - z.x, dy = hero.y - z.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        z.close = d < 50;
        if (z.entering) {                                     // 入场：走到屏内
          var inX = camera.x + view.w * (z.x > camera.x + view.w / 2 ? 0.86 : 0.14);
          var edx = inX - z.x;
          z.x += Math.sign(edx) * z.speed * 1.3 * dt;
          z.phase += dt * 7;
          if (Math.abs(edx) < 24) z.entering = false;
          continue;
        }
        if (z.windup > 0) {                                   // 蓄力→扑击
          z.windup -= dt;
          if (z.windup <= 0) {
            z.x += Math.sign(dx) * 18;                        // 前扑
            if (d < 62 && hero.invulnT <= 0) hurtPlayer(z.dmg, z.x);
            z.atkCd = 1.7;
          }
          continue;
        }
        if (z.close && z.atkCd <= 0) { z.windup = zStat(z.type).windup; continue; }
        if (z.atkCd > 0) z.atkCd -= dt;
        if (z.close) z.atkT += dt * 8;                       // 攻击动画计时
        if (!z.close) {
          z.x += dx / d * z.speed * dt;
          z.y += dy / d * z.speed * dt * 0.65;
          z.y = clamp(z.y, bandTop(), bandBot());
          z.phase += dt * 7;
        }
      }
      // 僵尸间防重叠（可读性）
      for (var a = 0; a < zombies.length; a++) {
        var za = zombies[a]; if (za.dead || za.entering) continue;
        for (var b2 = a + 1; b2 < zombies.length; b2++) {
          var zb = zombies[b2]; if (zb.dead || zb.entering) continue;
          var ddx = zb.x - za.x, ddy = zb.y - za.y;
          if (Math.abs(ddx) < 30 && Math.abs(ddy) < 20) {
            var push = (30 - Math.abs(ddx)) * 0.5 * dt * 6;
            var s = ddx >= 0 ? 1 : -1;
            za.x -= s * push; zb.x += s * push;
          }
        }
      }
    }

    // 相机
    var target = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    if (enc.lockCam >= 0) target = enc.lockCam;              // 战斗锁定相机
    camera.x += (target - camera.x) * Math.min(1, rdt * 6);
    if (Math.abs(target - camera.x) < 0.5) camera.x = target;

    // 门口检测（战斗中不给进门）
    nearDoor = null;
    if (!zoneActive() && !defeated) {
      for (var k = 0; k < scene.doors.length; k++) {
        var dd = scene.doors[k];
        if (Math.abs(hero.x - dd.x) < (dd.w || 56) / 2 + 22 && hero.y < bandTop() + 64) { nearDoor = dd; break; }
      }
    }
    var eb = document.getElementById('enterBtn');
    if (eb) {
      var want = nearDoor && trans.phase === 0;
      eb.style.display = want ? 'flex' : 'none';
      if (want) eb.textContent = '🚪 ' + nearDoor.label;
    }

    // ---- 渲染 ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var shx = 0, shy = 0;
    if (fx.shakeT > 0) { var m = fx.shakeMag * (fx.shakeT / 0.3); shx = (Math.random() - 0.5) * 2 * m; shy = (Math.random() - 0.5) * 2 * m; }
    ctx.save();
    ctx.translate(shx, shy);
    if (scene.indoor) drawStoreBg(camera.x); else drawStreetBg(camera.x);
    drawBarricades();
    for (var m2 = 0; m2 < scene.doors.length; m2++) drawDoor(scene.doors[m2]);
    for (var q = 0; q < enc.queue.length; q++) if (enc.queue[q].t < 0.5) drawMarker(enc.queue[q]);
    var list = zombies.slice();
    list.push({ isHero: true, y: hero.y });
    list.sort(function (a, b) { return a.y - b.y; });
    for (var j = 0; j < list.length; j++) {
      if (list[j].isHero) drawHero(hero); else drawZombie(list[j]);
    }
    drawFx(rdt);
    ctx.restore();
    if (trans.a > 0) {
      ctx.fillStyle = 'rgba(8,6,12,' + trans.a + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }
    updateHud();
    rafId = requestAnimationFrame(tick);
  }

  /* ---------- 输入 ---------- */
  function bindHold(el, key) {
    function on(e) { e.preventDefault(); keys[key] = true; el.classList.add('on'); audio(); }
    function off(e) { if (e) e.preventDefault(); keys[key] = false; el.classList.remove('on'); }
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }
  function bindUi() {
    bindHold(document.getElementById('btnL'), 'left');
    bindHold(document.getElementById('btnR'), 'right');
    bindHold(document.getElementById('btnU'), 'up');
    bindHold(document.getElementById('btnD'), 'down');
    document.getElementById('btnAttack').addEventListener('click', function () { audio(); tryAttack(); });
    document.getElementById('btnVoice').addEventListener('click', function () { showToast('🎤 语音喊词 M2 开放'); });
    document.getElementById('btnRune').addEventListener('click', function () { showToast('✍️ 画符施法 M3 开放'); });
    document.getElementById('homeBtn').addEventListener('click', function () { showToast('🏠 安全屋 M4 开放'); });
    document.getElementById('retryBtn').addEventListener('click', retry);
    document.getElementById('enterBtn').addEventListener('click', function () {
      if (!nearDoor || trans.phase !== 0) return;
      var d = nearDoor;
      startTransition(function () { enterScene(d.to, d.backX); });
    });
    // 键盘（桌面/自动化）
    var KMAP = { a: 'left', d: 'right', w: 'up', s: 'down', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' };
    document.addEventListener('keydown', function (e) {
      var k = KMAP[e.key.toLowerCase()];
      if (k) { keys[k] = true; e.preventDefault(); audio(); }
      if (e.key === 'j' || e.key === 'J' || e.key === ' ') { tryAttack(); e.preventDefault(); }
    });
    document.addEventListener('keyup', function (e) {
      var k = KMAP[e.key.toLowerCase()];
      if (k) keys[k] = false;
    });
    window.addEventListener('blur', function () { keys.left = keys.right = keys.up = keys.down = false; });
  }

  /* ---------- 启动 ---------- */
  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    hud.hp = document.getElementById('hpFill');
    hud.coins = document.getElementById('coinNum');
    hud.scene = document.getElementById('sceneName');
    resize();
    window.addEventListener('resize', resize);
    hero = makeHero(SCENES.street.spawn.x);
    zombies = [];
    camera = { x: 0 };
    scene = SCENES.street;
    if (hud.scene) hud.scene.textContent = scene.name;
    bindUi();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
      else if (!running) { running = true; lastT = performance.now(); rafId = requestAnimationFrame(tick); }
    });
    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var tip = document.getElementById('loadingTip');
    if (tip) tip.textContent = '加载素材...';
    A.load(function (done, total) { if (tip) tip.textContent = '加载素材 ' + done + '/' + total; })
      .then(function () { if (tip) tip.textContent = ''; start(); });
  });

  ZCITY.Game = { start: start };
  ZCITY.Debug = {
    get hero() { return hero; },
    get zombies() { return zombies; },
    get camera() { return camera; },
    get scene() { return scene; },
    get enc() { return enc; },
    get fx() { return fx; },
    view: function () { return view; },
    attack: tryAttack,
    hurt: function (n) { hurtPlayer(n || 999, hero.x + 30); },
    retry: retry,
    banner: banner,
    toast: showToast,
    go: function (id, backX) { enterScene(id, backX); },
    state: function () {
      return {
        scene: scene.id, encPhase: enc.phase, zoneIdx: enc.zoneIdx, waveIdx: enc.waveIdx,
        lockCam: enc.lockCam, queue: enc.queue.length, zombies: zombies.length,
        dead: zombies.filter(function (z) { return z.dead; }).length,
        heroHp: hero.hp, coins: coinsCount, combo: fx.combo, allClear: enc.allClear
      };
    }
  };
})();
