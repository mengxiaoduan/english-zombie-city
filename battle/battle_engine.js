/* 丧尸英语城 - 战斗引擎（M1 遭遇波次 + M2/M3 施法整合 + 无尽街区）
 * 引擎向施法模块暴露：zombies/hero/locked/toast/banner/spellStrike/micState
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var A = ZCITY.Assets;
  var SP = ZCITY.Spells;

  /* ---------- 街区模板（无尽递进） ---------- */
  var BLOCK_NAMES = ['死亡大道', '霓虹巷', '地铁废墟', '医院外墙', '码头栈桥'];
  function makeZones(block) {
    var ex = block - 1;                     // 递进强度
    var z = [
      { x: 360,  waves: [[['A', 'R', 0.6], ['A', 'R', 2.0]]] },
      { x: 800,  waves: [[['A', 'R', 0.6], ['B', 'R', 1.6], ['A', 'R', 2.8]]] },
      { x: 1250, waves: [[['A', 'R', 0.6], ['A', 'R', 1.6]],
                         [['B', 'R', 0.5], ['C', 'R', 1.2], ['B', 'L', 2.6]]] }
    ];
    if (ex > 0) {
      for (var i = 0; i < ex && i < 4; i++) {
        z[0].waves[0].push(['A', 'R', 3.2 + i * 0.9]);
        z[1].waves[0].push([i % 2 ? 'B' : 'A', 'R', 3.6 + i * 0.9]);
        z[2].waves[1].push([i % 2 ? 'C' : 'B', i > 1 ? 'L' : 'R', 3.4 + i * 1.0]);
      }
    }
    return z;
  }

  var SCENES = {
    street: {
      id: 'street', name: '第1街区 · 死亡大道', worldW: 1700, indoor: false,
      spawn: { x: 140 }, doors: [{ x: 1560, label: '进入便利店', to: 'store', backX: 1500, w: 58 }]
    },
    store: {
      id: 'store', name: '便利店 · 安全屋', worldW: 780, indoor: true,
      spawn: { x: 150 }, doors: [
        { x: 90, label: '回到街道', to: 'street', backX: 1500, w: 54 },
        { x: 690, label: '深入下一街区', to: 'street', backX: 140, w: 60, next: true }
      ]
    }
  };

  var WALK = { hero: 225, vert: 150, bandTop: 24, bandBot: 12 };
  var ATK = { dmg: 25, reach: 66, arc: 42, cd: 0.42, dur: 0.16, lunge: 12 };
  var ZSTAT = {
    A: { hp: 50,  speed: 40, dmg: 12, coin: 3, dispH: 100, windup: 0.5,  interruptible: true },
    B: { hp: 35,  speed: 88, dmg: 10, coin: 4, dispH: 92,  windup: 0.38, interruptible: true },
    C: { hp: 130, speed: 30, dmg: 22, coin: 6, dispH: 128, windup: 0.55, interruptible: false }
  };

  var canvas, ctx, dpr = 1;
  var view = { w: 0, h: 0, groundY: 0 };
  var scene, hero, zombies, camera, trans = { a: 0, phase: 0, cb: null };
  var keys = { left: false, right: false, up: false, down: false };
  var running = false, lastT = 0, rafId = 0;
  var hud = {}, coinsCount = 0, coinPop = 0, nearDoor = null, toastTimer = 0;

  var fx = {
    hitstop: 0, shakeT: 0, shakeMag: 0, shakeDur: 0.3,
    dmgNums: [], coins: [], slashT: 0, spells: [], parts: [],
    combo: 0, comboT: 0, comboPop: 0
  };
  var enc = { block: 1, zones: makeZones(1), zoneIdx: 0, phase: 'calm', waveIdx: 0,
              queue: [], waveGap: 0, lockCam: -1, allClear: false, tutDone: false };
  var defeated = false;

  function bandTop() { return view.groundY + WALK.bandTop; }
  function bandBot() { return view.h - WALK.bandBot; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function tierMul() { return 1 + 0.3 * (enc.block - 1); }

  /* ---------- 音效 ---------- */
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
    die:   function () { tone(160, 0.3, 'sawtooth', 0.1, 40); noise(0.2, 0.14, 500); },
    fire:  function () { noise(0.3, 0.22, 1500); tone(300, 0.25, 'sawtooth', 0.12, 90); },
    water: function () { tone(900, 0.3, 'sine', 0.14, 300); noise(0.2, 0.1, 3000); },
    stone: function () { tone(80, 0.2, 'square', 0.2, 40); noise(0.25, 0.2, 400); },
    rock:  function () { tone(60, 0.3, 'square', 0.24, 30); noise(0.35, 0.24, 300); },
    magic: function () { tone(880, 0.12, 'triangle', 0.1, 1320); tone(1320, 0.2, 'triangle', 0.08, 1760); }
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
    var tm = tierMul();
    zombies.push({
      type: type, x: sx, y: bandTop() + 24 + Math.random() * (bandBot() - bandTop() - 48),
      hp: Math.round(st.hp * tm), hpMax: Math.round(st.hp * tm),
      dispH: st.dispH, speed: st.speed, dmg: st.dmg + (enc.block - 1) * 2,
      coin: st.coin + Math.floor((enc.block - 1) / 2),
      phase: Math.random() * 10, entering: true,
      windup: 0, atkCd: enc.block === 1 ? 2.0 : 1.2, atkT: 0, hurtT: 0, kb: 0, charWin: null,
      dead: false, deadT: 0,
      spell: SP ? SP.pickSpellKey() : '火'
    });
    S.wave();
  }

  /* ---------- 遭遇编排 ---------- */
  function beginZone(z) {
    enc.phase = 'active';
    enc.waveIdx = 0;
    enc.lockCam = clamp(z.x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
    scheduleWave(0);
    banner('⚠ 遭遇丧尸', '#ffd873');
    if (!enc.tutDone) {
      enc.tutDone = true;
      setTimeout(function () { showToast('🎯 僵尸头顶有汉字弱点', 2200); }, 700);
      setTimeout(function () { showToast('🎤 点喊词读出它 → 释放法术', 2200); }, 3100);
      setTimeout(function () { showToast('✍️ 再画符 → 双倍伤害！', 2200); }, 5500);
    }
  }
  function scheduleWave(i) {
    enc.queue = enc.zones[enc.zoneIdx].waves[i].map(function (w) {
      return { type: w[0], side: w[1], t: w[2] };
    });
  }
  function waveDefeated() {
    return enc.queue.length === 0 && zombies.every(function (z) { return z.dead; });
  }
  function encTick(dt) {
    if (scene.indoor) return;
    if (enc.phase === 'calm' && enc.zoneIdx < enc.zones.length) {
      if (hero.x >= enc.zones[enc.zoneIdx].x) beginZone(enc.zones[enc.zoneIdx]);
    }
    if (enc.phase === 'clear' && enc.zoneIdx < enc.zones.length - 1) {
      enc.zoneIdx++; enc.phase = 'calm';
    }
    if (enc.phase !== 'active') return;
    var zone = enc.zones[enc.zoneIdx];
    for (var i = enc.queue.length - 1; i >= 0; i--) {
      var q = enc.queue[i];
      q.t -= dt;
      if (q.t <= 0) { spawnZombieNow(q.type, q.side); enc.queue.splice(i, 1); }
    }
    if (waveDefeated() && enc.waveGap <= 0) {
      if (enc.waveIdx < zone.waves.length - 1) {
        enc.waveGap = 1.15;
        enc.waveIdx++;
        banner('第二波来袭！', '#ff9c6b');
      } else {
        enc.phase = 'clear'; enc.lockCam = -1;
        hero.hp = Math.min(hero.hpMax, hero.hp + 12);
        coinsCount += 5; coinPop = 0.3;
        banner('✔ 区域肃清  +5金币', '#9ce89c');
        S.clear();
        if (enc.zoneIdx >= enc.zones.length - 1) {
          enc.allClear = true;
          setTimeout(function () { showToast('街区已肃清！便利店补给 🚪 或深入下一街区 →', 3000); }, 1500);
        }
      }
    }
    if (enc.waveGap > 0) {
      enc.waveGap -= dt;
      if (enc.waveGap <= 0) scheduleWave(enc.waveIdx);
    }
  }

  /* ---------- 下一街区（无尽循环） ---------- */
  function nextBlock() {
    enc.block++;
    enc.zones = makeZones(enc.block);
    enc.zoneIdx = 0; enc.waveIdx = 0;
    enc.phase = 'calm'; enc.lockCam = -1; enc.allClear = false; enc.queue = [];
    var nm = BLOCK_NAMES[(enc.block - 1) % BLOCK_NAMES.length];
    SCENES.street.name = '第' + enc.block + '街区 · ' + nm;
    if (hud.scene) hud.scene.textContent = SCENES.street.name;
    banner('第' + enc.block + '街区 · ' + nm + '（难度+' + Math.round((tierMul() - 1) * 100) + '%）', '#cbb8ff');
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
      var dx = (z.x - hero.x) * hero.face;
      if (dx > -10 && dx < ATK.reach && Math.abs(z.y - hero.y) < ATK.arc) {
        z.hp -= ATK.dmg;
        z.hurtT = 0.16;
        z.kb = hero.face * 150 * (zStat(z.type).interruptible ? 1 : 0.35);
        if (zStat(z.type).interruptible) z.windup = 0;
        hitAny = true;
        fx.dmgNums.push({ x: z.x, y: z.y - z.dispH - 14, txt: String(ATK.dmg), t: 0.7 });
        if (z.hp <= 0) killZombie(z);
      }
    }
    if (hitAny) {
      fx.hitstop = 0.07;
      fx.combo++; fx.comboT = 2.5; fx.comboPop = 1;
      if (fx.combo >= 3) { fx.shakeT = 0.18; fx.shakeMag = 3; fx.shakeDur = 0.18; }
      S.hit();
    } else {
      hero.x = clamp(hero.x + hero.face * ATK.lunge, 26, scene.worldW - 26);
    }
  }
  function killZombie(z, bySpell) {
    z.dead = true; z.deadT = 0; z.charWin = null;
    S.die();
    var n = z.coin + (bySpell ? 2 : 0);
    for (var c = 0; c < n; c++) {
      fx.coins.push({
        sx: z.x - camera.x, sy: z.y - z.dispH * 0.6 - c * 4,
        t: 0, dur: 0.55 + Math.random() * 0.3, delay: c * 0.06,
        cx: (Math.random() - 0.5) * 90, arc: 60 + Math.random() * 70
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
    fx.shakeT = 0.3; fx.shakeMag = 5; fx.shakeDur = 0.3;
    fx.dmgNums.push({ x: hero.x, y: hero.y - 120, txt: '-' + dmg, t: 0.8, hurt: true });
    S.hurt();
    var v = document.getElementById('hurtFx');
    if (v) { v.style.opacity = '1'; setTimeout(function () { v.style.opacity = '0'; }, 180); }
    if (hero.hp <= 0) {
      hero.hp = 0; defeated = true;
      if (ZCITY.Voice) ZCITY.Voice.closePanel();
      if (ZCITY.Rune) ZCITY.Rune.close();
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
    if (enc.allClear || enc.phase === 'clear') {
      // 已肃清后的意外死亡：原地复活即可
      enc.lockCam = -1;
      banner('重新出发', '#ffd873');
      return;
    }
    enc.phase = 'active'; enc.waveIdx = 0;
    enc.lockCam = clamp(enc.zones[enc.zoneIdx].x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
    hero.x = enc.lockCam + 70; hero.y = (bandTop() + bandBot()) / 2;
    scheduleWave(0);
    banner('再战！', '#ffd873');
  }

  /* ---------- 法术（spell_cast 回调） ---------- */
  function spellStrike(z, ch, sp, dmg, doubled, action) {
    // 从主角发出的"字弹"追踪目标
    fx.spells.push({
      ch: ch, color: sp.color, kind: sp.kind,
      x: hero.x - camera.x + hero.face * 20, y: hero.y - 70,
      z: z, t: 0, dur: 0.45, dmg: dmg, doubled: doubled, hitBig: false
    });
    if (sp.kind === 'fire') S.fire();
    else if (sp.kind === 'water') S.water();
    else if (sp.kind === 'stone') S.stone();
    else S.rock();
    S.magic();
    void action;
  }
  function spellHit(p) {
    var z = p.z;
    if (!z || z.dead) return;
    z.hp -= p.dmg;
    z.hurtT = 0.22;
    z.windup = 0;                                        // 法术打断蓄力（含C——法术特权）
    z.kb = (z.x >= hero.x ? 1 : -1) * (p.doubled ? 220 : 110) * (z.type === 'C' ? 0.4 : 1);
    fx.dmgNums.push({
      x: z.x, y: z.y - z.dispH - 22, txt: (p.doubled ? '双倍 ' : '') + p.dmg,
      t: 0.9, big: p.doubled, color: p.color
    });
    burst(z.x - camera.x, z.y - z.dispH * 0.5, p.color, p.doubled ? 26 : 14);
    fx.hitstop = p.doubled ? 0.11 : 0.06;
    if (p.doubled) { fx.shakeT = 0.32; fx.shakeMag = 6; fx.shakeDur = 0.32; }
    fx.combo++; fx.comboT = 2.5; fx.comboPop = 1;
    // 法术冲击波：全场僵尸震慑（施法者获得喘息——学习节奏保护）
    zombies.forEach(function (o) {
      if (o === z || o.dead || o.entering) return;
      o.hurtT = Math.max(o.hurtT, 0.3);
      o.windup = 0;
      o.atkCd = Math.max(o.atkCd, p.doubled ? 2.2 : 1.4);
      o.kb = (o.x >= z.x ? 1 : -1) * 60;
    });
    if (z.hp <= 0) killZombie(z, true);
  }
  function burst(x, y, color, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2, sp2 = 60 + Math.random() * 180;
      fx.parts.push({ x: x, y: y, vx: Math.cos(a) * sp2, vy: Math.sin(a) * sp2 - 60,
                      t: 0.5 + Math.random() * 0.35, color: color, r: 2 + Math.random() * 3.5 });
    }
  }

  /* ---------- 场景切换 ---------- */
  function enterScene(id, backX, viaDoor) {
    scene = SCENES[id];
    zombies.length = 0; enc.queue.length = 0;
    if (viaDoor && viaDoor.next) nextBlock();
    if (id === 'street' && enc.allClear) enc.phase = 'clear';
    hero.x = backX != null ? backX : scene.spawn.x;
    hero.y = (bandTop() + bandBot()) / 2;
    camera.x = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    if (id === 'street' && !enc.allClear && enc.phase === 'active') {
      enc.lockCam = clamp(enc.zones[enc.zoneIdx].x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
      scheduleWave(enc.waveIdx);
    }
    nearDoor = null;
    document.getElementById('enterBtn').style.display = 'none';
    if (hud.scene) hud.scene.textContent = scene.name;
    if (id === 'store') { hero.hp = hero.hpMax; showToast('🛒 便利店安全 · 血量全满', 1800); }
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
    var hue = (enc.block - 1) % BLOCK_NAMES.length;
    var skies = [['#2b2333', '#5a3a44', '#8a5a3a'], ['#1a2030', '#2a3a5a', '#4a5a8a'],
                 ['#231a28', '#4a2a3a', '#7a3a3a'], ['#20281e', '#3a4a2e', '#6a7a3e'],
                 ['#1c222e', '#2e4456', '#4a6a7a']];
    var sk = skies[hue];
    sky.addColorStop(0, sk[0]); sky.addColorStop(0.6, sk[1]); sky.addColorStop(1, sk[2]);
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
    ctx.strokeStyle = d.next ? '#7ec8ff' : '#ffd873'; ctx.lineWidth = 3;
    ctx.strokeRect(x - dw / 2, top, dw, dh);
    var g = ctx.createLinearGradient(0, top, 0, view.groundY);
    g.addColorStop(0, d.next ? 'rgba(120,190,255,0.55)' : 'rgba(255,190,90,0.55)');
    g.addColorStop(1, d.next ? 'rgba(60,120,255,0.12)' : 'rgba(255,120,60,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - dw / 2 + 3, top + 3, dw - 6, dh - 6);
    ctx.fillStyle = d.next ? '#a8d8ff' : '#ffe28a';
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillRect(x - dw / 2 - 8, top - 24, dw + 16, 20);
    ctx.fillStyle = d.next ? '#1a3a5a' : '#5a2a10';
    ctx.fillText(d.label.replace(/^(进入|回到|深入)/, ''), x, top - 14);
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
    if (h.invulnT > 0 && Math.floor(h.invulnT * 14) % 2 === 0) return;
    drawShadow(x, y, 22);
    var e = A.get('hero.run'), moving = h.moving;
    var lean = h.atkT > 0 ? h.face * 6 : 0;
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
    if (z.dead) {
      var p = Math.min(1, z.deadT / 0.55);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawShadow(x, z.y, 18 * (1 - p * 0.5));
      var e2 = A.get('zombie.' + z.type + '_walk');
      ctx.translate(x, z.y);
      ctx.scale(1 + p * 0.5, Math.max(0.05, 1 - p));
      ctx.translate(-x, -z.y);
      A.drawFrame(ctx, e2, 0, x, z.y, z.dispH, 1);
      ctx.restore();
      return;
    }
    drawShadow(x, z.y, 18);
    var lean = z.windup > 0 ? -6 * (1 - z.windup / zStat(z.type).windup) : 0;
    var anim = (z.close && !z.entering) ? z.type + '_attack' : z.type + '_walk';
    var e = A.get('zombie.' + anim) || A.get('zombie.' + z.type + '_walk');
    var rawIdx = z.windup > 0 ? Math.floor((zStat(z.type).windup - z.windup) * 10) : (z.close ? Math.floor(z.atkT) : Math.floor(z.phase));
    var idx = isFinite(rawIdx) ? rawIdx : 0;
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
    if (z.windup > 0) {
      ctx.save();
      ctx.font = 'bold 26px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb02e';
      ctx.fillText('!', x, z.y - z.dispH - 46 - (1 - z.windup / zStat(z.type).windup) * 6);
      ctx.restore();
    }
    if (z.hp < z.hpMax) {
      var bw = 44, hpP = Math.max(0, z.hp / z.hpMax);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw, 5);
      ctx.fillStyle = hpP > 0.5 ? '#9ce89c' : hpP > 0.25 ? '#ffd873' : '#ff6b5c';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw * hpP, 5);
    }
    // 弱点字符牌（双倍窗口内金光呼吸）
    var bob = Math.sin(z.phase * 0.6) * 3;
    var bw2 = 34, bx = x - bw2 / 2, by = z.y - z.dispH - 40 + bob;
    var pend = z.charWin && (z.charWin.voice || z.charWin.rune);
    ctx.save();
    ctx.fillStyle = '#f5e6c8';
    ctx.strokeStyle = pend ? '#ffd873' : '#8a5a2a'; ctx.lineWidth = pend ? 3 : 2;
    if (pend) ctx.shadowColor = '#ffd873', ctx.shadowBlur = 10;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw2, 32, 6); else ctx.rect(bx, by, bw2, 32);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#c03028';
    ctx.fillText(z.spell, x, by + 17);
    if (z.charWin && (z.charWin.voice || z.charWin.rune)) {         // 完成角标
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#3a7a2a';
      ctx.textAlign = 'left';
      ctx.fillText((z.charWin.voice ? '🔊' : '') + (z.charWin.rune ? '✍' : ''), bx + 2, by + 30);
    }
    ctx.restore();
  }
  function drawMarker(q) {
    var x = (q.side === 'L' ? camera.x - 40 : camera.x + view.w + 40) - camera.x;
    ctx.save();
    ctx.font = 'bold 30px sans-serif'; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,90,70,' + (0.5 + 0.5 * Math.sin(performance.now() / 90)) + ')';
    ctx.fillText('!', x, view.groundY + 30);
    ctx.restore();
  }

  /* ---------- 特效层 ---------- */
  function drawFx(dt) {
    // 法术字弹（追踪目标）
    for (var s = fx.spells.length - 1; s >= 0; s--) {
      var p = fx.spells[s];
      p.t += dt / p.dur;
      var tx = p.z.x - camera.x, ty = p.z.y - p.z.dispH * 0.55;
      var k = Math.min(1, p.t);
      var cx = p.x + (tx - p.x) * k;
      var cy = p.y + (ty - p.y) * k - Math.sin(k * Math.PI) * 60;
      ctx.save();
      ctx.font = 'bold ' + (p.doubled ? 46 : 34) + 'px "Microsoft YaHei", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = p.color; ctx.shadowBlur = p.doubled ? 26 : 14;
      ctx.fillStyle = p.color;
      ctx.fillText(p.ch, cx, cy);
      ctx.restore();
      // 尾迹粒子
      if (Math.random() < 0.6) fx.parts.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        t: 0.3, color: p.color, r: 1.5 + Math.random() * 2 });
      if (k >= 1) { fx.spells.splice(s, 1); spellHit(p); }
    }
    // 粒子
    for (var i = fx.parts.length - 1; i >= 0; i--) {
      var q = fx.parts[i];
      q.t -= dt;
      if (q.t <= 0) { fx.parts.splice(i, 1); continue; }
      q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 260 * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, q.t * 3);
      ctx.fillStyle = q.color;
      ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    // 金币飞行
    var tcx = view.w - 64, tcy = 38;
    for (var c2 = fx.coins.length - 1; c2 >= 0; c2--) {
      var c = fx.coins[c2];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.t += dt / c.dur;
      var t = Math.min(1, c.t);
      var mx = (c.sx + tcx) / 2 + c.cx;
      var my = Math.min(c.sy, tcy) - c.arc;
      var x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * mx + t * t * tcx;
      var y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * my + t * t * tcy;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.abs(Math.cos(t * 9)) * 0.7 + 0.3, 1);
      ctx.fillStyle = '#ffd873'; ctx.strokeStyle = '#a87818'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (t >= 1) { fx.coins.splice(c2, 1); coinsCount++; coinPop = 0.3; S.coin(); }
    }
    // 伤害数字
    for (var d = fx.dmgNums.length - 1; d >= 0; d--) {
      var n = fx.dmgNums[d];
      n.t -= dt; n.y -= dt * 44;
      if (n.t <= 0) { fx.dmgNums.splice(d, 1); continue; }
      ctx.save();
      ctx.globalAlpha = Math.min(1, n.t * 2.5);
      ctx.font = 'bold ' + (n.big ? 26 : 19) + 'px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = n.color || (n.hurt ? '#ff6b5c' : '#ffe9a0');
      ctx.strokeStyle = 'rgba(20,10,0,0.8)'; ctx.lineWidth = 3;
      ctx.strokeText(n.txt, n.x - camera.x, n.y);
      ctx.fillText(n.txt, n.x - camera.x, n.y);
      ctx.restore();
    }
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
    void b.offsetWidth;
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
    if (fx.hitstop > 0) { fx.hitstop -= rdt; dt = 0; }
    if (fx.shakeT > 0) fx.shakeT -= rdt;
    // 施法面板打开时世界冻结（学习者答题/书写不被围殴）
    if (document.getElementById('voicePanel') || document.getElementById('runeBoard')) {
      dt = 0;
      keys.left = keys.right = keys.up = keys.down = false;
    }

    if (!defeated) {
      var vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      var vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
      hero.moving = !!(vx || vy);
      if (vx) hero.face = vx;
      var minX = 26, maxX = scene.worldW - 26;
      if (enc.lockCam >= 0) { minX = enc.lockCam + 26; maxX = enc.lockCam + view.w - 26; }
      hero.x = clamp(hero.x + vx * WALK.hero * dt, minX, maxX);
      hero.y = clamp(hero.y + vy * WALK.vert * dt, bandTop(), bandBot());
      if (hero.moving) hero.walkPhase += dt * 1.7;
      if (hero.atkCd > 0) hero.atkCd -= rdt;
      if (hero.atkT > 0) hero.atkT -= rdt;
      if (hero.invulnT > 0) hero.invulnT -= rdt;

      encTick(dt);
      if (SP) SP.tick(dt, rdt);

      for (var i = zombies.length - 1; i >= 0; i--) {
        var z = zombies[i];
        if (z.dead) { z.deadT += dt; if (z.deadT > 0.55) zombies.splice(i, 1); continue; }
        if (z.hurtT > 0) z.hurtT -= rdt;
        if (Math.abs(z.kb) > 4) { z.x += z.kb * dt; z.kb *= Math.max(0, 1 - 7 * dt); }
        var dx = hero.x - z.x, dy = hero.y - z.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        z.close = d < 50;
        if (z.entering) {
          var inX = camera.x + view.w * (z.x > camera.x + view.w / 2 ? 0.86 : 0.14);
          var edx = inX - z.x;
          z.x += Math.sign(edx) * z.speed * 1.3 * dt;
          z.phase += dt * 7;
          if (Math.abs(edx) < 24) z.entering = false;
          continue;
        }
        if (z.windup > 0) {
          z.windup -= dt;
          if (z.windup <= 0) {
            z.x += Math.sign(dx) * 18;
            if (d < 62 && hero.invulnT <= 0) hurtPlayer(z.dmg, z.x);
            z.atkCd = enc.block === 1 ? 2.6 : 1.7;          // 新手街攻击间隔放宽
          }
          continue;
        }
        if (z.close && z.atkCd <= 0) { z.windup = zStat(z.type).windup + (enc.block === 1 ? 0.25 : 0); continue; }
        if (z.atkCd > 0) z.atkCd -= dt;
        if (z.close) z.atkT += dt * 8;
        if (!z.close) {
          z.x += dx / d * z.speed * dt;
          z.y += dy / d * z.speed * dt * 0.65;
          z.y = clamp(z.y, bandTop(), bandBot());
          z.phase += dt * 7;
        }
      }
      for (var a = 0; a < zombies.length; a++) {
        var za = zombies[a]; if (za.dead || za.entering) continue;
        for (var b2 = a + 1; b2 < zombies.length; b2++) {
          var zb = zombies[b2]; if (zb.dead || zb.entering) continue;
          var ddx = zb.x - za.x, ddy = zb.y - za.y;
          if (Math.abs(ddx) < 30 && Math.abs(ddy) < 20) {
            var push = (30 - Math.abs(ddx)) * 0.5 * dt * 6;
            var sg = ddx >= 0 ? 1 : -1;
            za.x -= sg * push; zb.x += sg * push;
          }
        }
      }
    }

    var target = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    if (enc.lockCam >= 0) target = enc.lockCam;
    camera.x += (target - camera.x) * Math.min(1, rdt * 6);
    if (Math.abs(target - camera.x) < 0.5) camera.x = target;

    nearDoor = null;
    if (enc.phase !== 'active' && !defeated) {
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var shx = 0, shy = 0;
    if (fx.shakeT > 0) { var m = fx.shakeMag * (fx.shakeT / fx.shakeDur); shx = (Math.random() - 0.5) * 2 * m; shy = (Math.random() - 0.5) * 2 * m; }
    ctx.save();
    ctx.translate(shx, shy);
    if (scene.indoor) drawStoreBg(camera.x); else drawStreetBg(camera.x);
    drawBarricades();
    for (var m2 = 0; m2 < scene.doors.length; m2++) drawDoor(scene.doors[m2]);
    for (var q = 0; q < enc.queue.length; q++) if (enc.queue[q].t < 0.5) drawMarker(enc.queue[q]);
    var list = zombies.slice();
    list.push({ isHero: true, y: hero.y });
    list.sort(function (a2, b3) { return a2.y - b3.y; });
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

    var mic = document.getElementById('btnVoice');
    mic.addEventListener('pointerdown', function (e) { e.preventDefault(); audio(); ZCITY.Voice.onMicDown(e); });
    mic.addEventListener('pointerup', function (e) { e.preventDefault(); ZCITY.Voice.onMicUp(); });
    mic.addEventListener('pointerleave', function () { ZCITY.Voice.onMicUp(); });

    document.getElementById('btnRune').addEventListener('click', function () {
      audio();
      if (ZCITY.Spells.locked()) { showToast('法力恢复中…'); return; }
      ZCITY.Rune.open('main');
    });
    document.getElementById('homeBtn').addEventListener('click', function () {
      showToast('🏠 安全屋（完整版 M4）· 当前可在便利店休息');
    });
    document.getElementById('retryBtn').addEventListener('click', retry);
    document.getElementById('enterBtn').addEventListener('click', function () {
      if (!nearDoor || trans.phase !== 0) return;
      var d = nearDoor;
      startTransition(function () { enterScene(d.to, d.backX, d); });
    });
    var KMAP = { a: 'left', d: 'right', w: 'up', s: 'down', arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down' };
    document.addEventListener('keydown', function (e) {
      var k = KMAP[e.key.toLowerCase()];
      if (k) { keys[k] = true; e.preventDefault(); audio(); }
      if (e.key === 'j' || e.key === 'J' || e.key === ' ') { tryAttack(); e.preventDefault(); }
      if (e.key === 'k' || e.key === 'K') ZCITY.Voice.openPanel();
      if (e.key === 'l' || e.key === 'L') ZCITY.Rune.open('main');
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
    if (SP) SP.init({
      get hero() { return hero; },
      get zombies() { return zombies; },
      locked: function () { return defeated || trans.phase !== 0 || scene.indoor || SP.locked(); },
      canCast: function () { return !defeated && trans.phase === 0 && !scene.indoor; },
      toast: showToast,
      banner: banner,
      spellStrike: spellStrike
    });
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

  ZCITY.Game = { start: start, toast: showToast };
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
    heal: function (n) { hero.hp = Math.min(hero.hpMax, hero.hp + (n || 999)); if (defeated) retry(); },
    retry: retry,
    banner: banner,
    toast: showToast,
    go: function (id, backX) { enterScene(id, backX); },
    nextBlock: nextBlock,
    cast: function (ch, action) { ZCITY.Spells._resolve(ch, action); },
    state: function () {
      return {
        scene: scene.id, block: enc.block, encPhase: enc.phase, zoneIdx: enc.zoneIdx, waveIdx: enc.waveIdx,
        lockCam: enc.lockCam, queue: enc.queue.length, zombies: zombies.length,
        dead: zombies.filter(function (z) { return z.dead; }).length,
        heroHp: hero.hp, coins: coinsCount, combo: fx.combo, allClear: enc.allClear,
        spells: fx.spells.length, parts: fx.parts.length, dmgNums: fx.dmgNums.length, coinFly: fx.coins.length
      };
    }
  };
  /* mic 高亮 */
  ZCITY.Game.micState = function (on) {
    var b = document.getElementById('btnVoice');
    if (b) b.classList.toggle('listening', !!on);
  };
})();
