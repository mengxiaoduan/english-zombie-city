/* 丧尸英语城 - 战斗引擎 v2（场景词汇教学版）
 * 新增：医院场景(医护僵尸+Boss战) / 店员僵尸 / 食物补血与武器拾取(念词获得) /
 *       双语建筑招牌 / 弱点卡英文释义 / Boss喊词技能(可躲避字弹)
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var A = ZCITY.Assets;
  var SP = ZCITY.Spells;

  /* ---------- 拾取物品词表（食物回血/武器强化，走拼音拾取面板） ---------- */
  var ITEMS = {
    '水': { py: 'shuǐ', en: 'water',    kind: 'heal',   heal: 22, color: '#7ec8ff' },
    '饭': { py: 'fàn',  en: 'rice',     kind: 'heal',   heal: 38, color: '#ffd873' },
    '药': { py: 'yào',  en: 'medicine', kind: 'heal',   heal: 65, color: '#9ce89c' },
    '棒': { py: 'bàng', en: 'club',     kind: 'weapon', bonus: 16, color: '#c9a86a' },
    '刀': { py: 'dāo',  en: 'knife',    kind: 'weapon', bonus: 30, color: '#d8d8e8' },
    /* 第一章·暴食餐厅/厨房 */
    '米': { py: 'mǐ',   en: 'rice',     kind: 'heal',   heal: 30, color: '#f5eeda' },
    '汤': { py: 'tāng', en: 'soup',     kind: 'heal',   heal: 42, color: '#f0c890' },
    '甜': { py: 'tián', en: 'sweet',    kind: 'heal',   heal: 25, color: '#ffa8d8' },
    '面': { py: 'miàn', en: 'noodles',  kind: 'heal',   heal: 35, color: '#e8d890' },
    '肉': { py: 'ròu',  en: 'meat',     kind: 'heal',   heal: 48, color: '#e88a7a' }
  };

  /* ---------- 街区模板（无尽递进） ---------- */
  var BLOCK_NAMES = ['死亡大道', '霓虹巷', '地铁废墟', '医院外墙', '码头栈桥'];
  function makeZones(block) {
    var ex = block - 1;
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
  /* 医院遭遇：护士快刀→医生坦克→Boss */
  var HOSPITAL_ZONES = [
    { x: 260, waves: [[['NUR', 'R', 0.6], ['NUR', 'R', 1.8]]] },
    { x: 560, waves: [[['DOC', 'R', 0.6], ['NUR', 'L', 1.6], ['DOC', 'R', 2.8]]] },
    { x: 760, waves: [[['BOSS', 'R', 1.0]]] }                // Boss 房
  ];
  var STORE_ZONES = [
    { x: 300, waves: [[['CLR', 'R', 0.6], ['CLR', 'L', 1.8]]] }
  ];

  /* 第一章·暴食：餐厅(前5难)→厨房(后5难) */
  var DINING_ZONES = [
    { x: 240, waves: [[['CHEF', 'R', 0.6], ['CHEF', 'R', 1.9]]] },
    { x: 520, waves: [[['CHEF', 'R', 0.6], ['WAIT', 'R', 1.5], ['CHEF', 'L', 2.6]]] },
    { x: 740, waves: [[['WAIT', 'R', 0.5], ['CHEF', 'R', 1.4], ['WAIT', 'L', 2.4]]] }
  ];
  var KITCHEN_ZONES = [
    { x: 240, waves: [[['CHEF', 'R', 0.6], ['CHEF', 'L', 1.8]]] },
    { x: 520, waves: [[['COOK', 'R', 0.8], ['WAIT', 'L', 2.0]]] },
    { x: 740, waves: [[['GLUT', 'R', 1.2]]] }               // 第10难：暴食Boss
  ];

  var SCENES = {
    street: {
      id: 'street', name: '第1街区 · 死亡大道', worldW: 1700, indoor: false,
      spawn: { x: 140 }, zones: null,
      doors: [
        { x: 1380, label: '进入医院', to: 'hospital', backX: 120, w: 58 },
        { x: 1560, label: '进入便利店', to: 'store', backX: 1500, w: 58 }
      ],
      chapterDoor: { x: 1680, label: '第一章 · 暴食食堂', to: 'dining', backX: 100, w: 64, chapter: 1 }
    },
    hospital: {
      id: 'hospital', name: '仁爱医院 · 病房区', worldW: 900, indoor: true,
      spawn: { x: 100 }, zones: HOSPITAL_ZONES,
      doors: [
        { x: 60, label: '回到街道', to: 'street', backX: 1350, w: 54 }
      ],
      bossDoor: { x: 860, label: '深入下一街区', to: 'street', backX: 140, w: 60, next: true }
    },
    store: {
      id: 'store', name: '便利店 · 补给站', worldW: 780, indoor: true,
      spawn: { x: 100 }, zones: STORE_ZONES,
      doors: [
        { x: 60, label: '回到街道', to: 'street', backX: 1540, w: 54 },
        { x: 700, label: '深入下一街区', to: 'street', backX: 140, w: 60, next: true }
      ]
    },
    dining: {
      id: 'dining', name: '第一章 · 暴食堂（餐厅）', worldW: 900, indoor: true,
      spawn: { x: 100 }, zones: DINING_ZONES,
      doors: [
        { x: 60, label: '回到街道', to: 'street', backX: 1660, w: 54 },
        { x: 850, label: '进入厨房', to: 'kitchen', backX: 100, w: 60 }
      ]
    },
    safehouse: {
      id: 'safehouse', name: '茅山安全屋', worldW: 720, indoor: true,
      spawn: { x: 360 }, zones: [],
      doors: []
    },
    kitchen: {
      id: 'kitchen', name: '第一章 · 暴食堂（厨房）', worldW: 900, indoor: true,
      spawn: { x: 100 }, zones: KITCHEN_ZONES,
      doors: [
        { x: 60, label: '回到餐厅', to: 'dining', backX: 820, w: 54 }
      ],
      bossDoor: { x: 860, label: '下一章 · 敬请期待', to: 'street', backX: 140, w: 60, next: true, locked: true }
    }
  };

  /* 街道装饰招牌（认知建筑词汇，纯展示） */
  var BILLBOARDS = [
    { x: 520,  en: 'HOTEL',  zh: '酒店' }, { x: 700,  en: 'BANK',  zh: '银行' },
    { x: 940,  en: 'POLICE', zh: '警局' }, { x: 1120, en: 'CAFE',  zh: '咖啡店' }
  ];

  var WALK = { hero: 225, vert: 150, bandTop: 24, bandBot: 12 };
  var ATK = { dmg: 25, reach: 66, arc: 42, cd: 0.42, dur: 0.16, lunge: 12 };
  var ZSTAT = {
    A:   { hp: 50,  speed: 40, dmg: 12, coin: 3,  dispH: 100, windup: 0.5,  interruptible: true, anim: 'A' },
    B:   { hp: 35,  speed: 70, dmg: 10, coin: 4,  dispH: 92,  windup: 0.38, interruptible: true, anim: 'B' },
    C:   { hp: 130, speed: 30, dmg: 22, coin: 6,  dispH: 128, windup: 0.55, interruptible: false, anim: 'C' },
    DOC: { hp: 60,  speed: 34, dmg: 14, coin: 4,  dispH: 104, windup: 0.5,  interruptible: true, anim: 'DOC' },
    NUR: { hp: 40,  speed: 78, dmg: 10, coin: 4,  dispH: 92,  windup: 0.36, interruptible: true, anim: 'NUR' },
    CLR: { hp: 45,  speed: 44, dmg: 10, coin: 4,  dispH: 98,  windup: 0.5,  interruptible: true, anim: 'CLR' },
    BOSS:{ hp: 600, speed: 24, dmg: 28, coin: 40, dispH: 210, windup: 0.7,  interruptible: false, anim: 'BOSS' },
    /* 第一章·暴食 */
    CHEF: { hp: 55,  speed: 40, dmg: 12, coin: 4, dispH: 102, windup: 0.5,  interruptible: true,  anim: 'CHEF' },
    WAIT: { hp: 38,  speed: 74, dmg: 10, coin: 4, dispH: 92,  windup: 0.36, interruptible: true,  anim: 'WAIT' },
    COOK: { hp: 140, speed: 30, dmg: 20, coin: 6, dispH: 130, windup: 0.55, interruptible: false, anim: 'COOK' },
    GLUT: { hp: 750, speed: 22, dmg: 30, coin: 60, dispH: 220, windup: 0.7,  interruptible: false, anim: 'GLUT' }   // 暴食Boss
  };
  var STRIKE = { dur: 0.18, speed: 120 };

  var canvas, ctx, dpr = 1;
  var view = { w: 0, h: 0, groundY: 0 };
  var scene, hero, zombies, items, camera, trans = { a: 0, phase: 0, cb: null };
  var keys = { left: false, right: false, up: false, down: false };
  var running = false, lastT = 0, rafId = 0;
  var hud = {}, coinsCount = 0, coinPop = 0, nearDoor = null, toastTimer = 0;

  var fx = {
    hitstop: 0, shakeT: 0, shakeMag: 0, shakeDur: 0.3,
    dmgNums: [], coins: [], slashT: 0, spells: [], parts: [], bossSpells: [],
    combo: 0, comboT: 0, comboPop: 0
  };
  var enc = { block: 1, zones: makeZones(1), zoneIdx: 0, phase: 'calm', waveIdx: 0,
              queue: [], waveGap: 0, lockCam: -1, allClear: false, tutDone: false };
  var defeated = false;
  var zKill = 0;                                   // 距安全屋解锁的击杀计数
  var SAFE_KILLS = 4;                              // 用户定案：击败4只僵尸开安全屋

  function bandTop() { return view.groundY + WALK.bandTop; }
  function heroWallet(n) { try { if (window.HERO && window.HERO.addCoins && n > 0) window.HERO.addCoins(n); } catch (e) { } }
  function safehouseReady() { return zKill >= SAFE_KILLS; }
  function updateHomeBtn() {
    var b = document.getElementById('homeBtn');
    if (b) b.classList.toggle('ready', safehouseReady());
  }
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
    magic: function () { tone(880, 0.12, 'triangle', 0.1, 1320); tone(1320, 0.2, 'triangle', 0.08, 1760); },
    heal:  function () { tone(660, 0.18, 'sine', 0.12, 990); setTimeout(function () { tone(880, 0.22, 'sine', 0.1); }, 140); },
    boss:  function () { tone(90, 0.5, 'sawtooth', 0.18, 45); tone(45, 0.7, 'square', 0.14, 30); }
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
    return { x: x, y: (bandTop() + bandBot()) / 2, face: 1, walkPhase: 0, idlePhase: 0, moving: false,
             hp: 100, hpMax: 100, invulnT: 0, atkCd: 0, atkT: 0, spellPoseT: 0,
             weapon: null };
  }
  function zStat(t) { return ZSTAT[t] || ZSTAT.A; }
  function isBossT(t) { return t === 'BOSS' || t === 'GLUT'; }
  function atkDmg() { return ATK.dmg + (hero.weapon ? hero.weapon.bonus : 0); }

  function spawnZombieNow(type, side) {
    var st = zStat(type);
    var sx = side === 'L' ? camera.x - 60 - Math.random() * 80
                          : camera.x + view.w + 50 + Math.random() * 90;
    var tm = tierMul();
    zombies.push({
      type: type, x: sx, y: bandTop() + 24 + Math.random() * (bandBot() - bandTop() - 48),
      hp: Math.round(st.hp * (type === 'BOSS' ? (1 + 0.25 * (enc.block - 1)) : tm)),
      hpMax: Math.round(st.hp * (type === 'BOSS' ? (1 + 0.25 * (enc.block - 1)) : tm)),
      dispH: st.dispH, speed: st.speed, dmg: st.dmg + (enc.block - 1) * 2,
      coin: st.coin + Math.floor((enc.block - 1) / 2),
      phase: Math.random() * 10, entering: true,
      windup: 0, atkCd: enc.block === 1 ? 2.0 : 1.2, atkT: 0, hurtT: 0, kb: 0, charWin: null,
      strikeT: 0, strikeDir: 1,
      bossT: 5.5, shout: null, shoutT: 0, buffT: 0,          // Boss 技能
      dead: false, deadT: 0,
      spell: SP ? SP.pickSpellKey() : '火'
    });
    if (type === 'BOSS') S.boss(); else S.wave();
  }

  /* ---------- 遭遇编排 ---------- */
  function beginZone(z) {
    enc.phase = 'active';
    enc.waveIdx = 0;
    enc.lockCam = clamp(z.x - view.w * 0.42, 0, Math.max(0, scene.worldW - view.w));
    scheduleWave(0);
    var isBoss = z.waves[0][0][0] === 'BOSS';
    banner(isBoss ? '☠ BOSS · 巨型医生僵尸' : '⚠ 遭遇丧尸', isBoss ? '#ff6b5c' : '#ffd873');
    if (!enc.tutDone && !isBoss) {
      enc.tutDone = true;
      setTimeout(function () { showToast('🎯 僵尸头顶有汉字弱点（附英文）', 2200); }, 700);
      setTimeout(function () { showToast('✍️ 点画符写汉字 → 释放法术', 2200); }, 3100);
      setTimeout(function () { showToast('📜 击杀4只开安全屋 · 制符背包快捷施法', 2400); }, 5700);
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
    if (!enc.zones) return;
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
        var wasBoss = zone.waves[zone.waves.length - 1][0][0] === 'BOSS';
        enc.phase = 'clear'; enc.lockCam = -1;
        hero.hp = Math.min(hero.hpMax, hero.hp + 12);
        coinsCount += wasBoss ? 40 : 5; coinPop = 0.3; heroWallet(wasBoss ? 40 : 5);
        banner(wasBoss ? '👑 BOSS 击破！ +40金币' : '✔ 区域肃清  +5金币', wasBoss ? '#ffb02e' : '#9ce89c');
        S.clear();
        if (enc.zoneIdx >= enc.zones.length - 1) {
          enc.allClear = true;
          if (wasBoss) {
            if (scene.bossDoor) {
              scene.bossDoor.locked = false;
              scene.doors.push(scene.bossDoor);
            }
            if (scene.id === 'kitchen') {
              setTimeout(function () { showToast('👑 第一章「暴食」通关！黑暗仍未终结…', 3200); }, 1400);
            } else {
              setTimeout(function () { showToast('医院净化完成！右侧之门已开启 →', 3000); }, 1400);
            }
          } else if (scene.id === 'street') {
            if (scene.chapterDoor && scene.doors.indexOf(scene.chapterDoor) < 0) {
              scene.doors.push(scene.chapterDoor);           // 街区肃清 → 开启章节金门
            }
            setTimeout(function () { showToast('街区已肃清！医院🏥 便利店🏪 或章节金门✨', 3200); }, 1400);
          }
        }
      }
    }
    if (enc.waveGap > 0) {
      enc.waveGap -= dt;
      if (enc.waveGap <= 0) scheduleWave(enc.waveIdx);
    }
  }

  /* ---------- 下一街区 ---------- */
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

  /* ---------- 物品（食物/武器，念词拾取） ---------- */
  function makeItems() {
    items = [];
    if (scene.id === 'hospital') {
      items.push({ ch: '水', x: 420 }, { ch: '药', x: 660 });
    } else if (scene.id === 'store') {
      items.push({ ch: '饭', x: 380 }, { ch: '水', x: 460 }, { ch: '棒', x: 520 }, { ch: '刀', x: 580 });
    } else if (scene.id === 'dining') {
      items.push({ ch: '米', x: 300 }, { ch: '汤', x: 560 }, { ch: '甜', x: 700 });
    } else if (scene.id === 'kitchen') {
      items.push({ ch: '面', x: 320 }, { ch: '肉', x: 520 });
    }
  }
  function nearItem() {
    for (var i = 0; i < items.length; i++) {
      if (Math.abs(items[i].x - hero.x) < 46) return items[i];
    }
    return null;
  }
  function applyItem(ch) {
    var it = ITEMS[ch];
    if (!it) return;
    if (it.kind === 'heal') {
      hero.hp = Math.min(hero.hpMax, hero.hp + it.heal);
      fx.dmgNums.push({ x: hero.x, y: hero.y - 110, txt: '+' + it.heal, t: 0.9, color: '#9ce89c' });
      S.heal();
      showToast('🍜 ' + ch + ' ' + it.en + ' · 回血 ' + it.heal, 1800);
    } else if (it.kind === 'weapon') {
      if (hero.weapon && hero.weapon.bonus >= it.bonus) {
        showToast('已有更强的 ' + hero.weapon.ch + '，不换了');
        return false;                                        // 不消耗
      }
      hero.weapon = { ch: ch, bonus: it.bonus };
      S.magic();
      showToast('🗡 获得 ' + ch + ' ' + it.en + ' · 攻击 +' + it.bonus, 2200);
    }
    return true;
  }
  function tryPickup(it) {
    var info = ITEMS[it.ch];
    ZCITY.Voice.openPanel('念词拾取', {
      forcedChar: it.ch, mode: 'pickup',
      onPickup: function (ch) {
        if (applyItem(ch)) {
          var idx = items.indexOf(it);
          if (idx >= 0) items.splice(idx, 1);
        }
      }
    });
    void info;
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
      if (isBossT(z.type) && z.entering) continue;            // Boss 入场演出期免疫
      var dx = (z.x - hero.x) * hero.face;
      if (dx > -10 && dx < ATK.reach && Math.abs(z.y - hero.y) < ATK.arc) {
        z.hp -= atkDmg();
        z.hurtT = 0.16;
        z.kb = hero.face * 150 * (zStat(z.type).interruptible ? 1 : 0.35);
        if (zStat(z.type).interruptible) z.windup = 0;
        hitAny = true;
        fx.dmgNums.push({ x: z.x, y: z.y - z.dispH - 14, txt: String(atkDmg()), t: 0.7 });
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
    zKill++;
    if (zKill === SAFE_KILLS) {
      updateHomeBtn();
      banner('🏠 安全屋已开启！', '#9ce89c');
      setTimeout(function () { showToast('顶栏🏠进入安全屋：回复/画符/买符纸/小游戏', 2600); }, 900);
    }
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
    if (enc.allClear || enc.phase === 'clear' || !enc.zones) {
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

  /* ---------- 法术 ---------- */
  function spellStrike(z, ch, sp, dmg, doubled, action) {
    fx.spells.push({
      ch: ch, color: sp.color, kind: sp.kind,
      x: hero.x - camera.x + hero.face * 20, y: hero.y - 70,
      z: z, t: 0, dur: 0.45, dmg: dmg, doubled: doubled, hitBig: false
    });
    hero.spellPoseT = 0.4;
    hero.face = (z.x >= hero.x) ? 1 : -1;
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
    if (isBossT(z.type) && z.entering) return;               // Boss 入场演出期免疫法术
    z.hp -= p.dmg;
    z.hurtT = 0.22;
    z.windup = 0;
    z.kb = (z.x >= hero.x ? 1 : -1) * (p.doubled ? 220 : 110) * (z.type === 'C' || isBossT(z.type) ? 0.4 : 1);
    fx.dmgNums.push({
      x: z.x, y: z.y - z.dispH - 22, txt: (p.doubled ? '双倍 ' : '') + p.dmg,
      t: 0.9, big: p.doubled, color: p.color
    });
    burst(z.x - camera.x, z.y - z.dispH * 0.5, p.color, p.doubled ? 26 : 14);
    fx.hitstop = p.doubled ? 0.11 : 0.06;
    if (p.doubled) { fx.shakeT = 0.32; fx.shakeMag = 6; fx.shakeDur = 0.32; }
    fx.combo++; fx.comboT = 2.5; fx.comboPop = 1;
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

  /* ---------- Boss 技能（喊词施法，技能与词义关联） ---------- */
  var BOSS_SKILLS = {
    BOSS: ['火', '水', '石', '山'],                            // 巨型医生：元素字弹
    GLUT: ['吃', '大', '饭']                                   // 暴食：吃(吞币)/大(巨大化)/饭(回血)
  };
  function bossTick(z, dt) {
    if (z.dead || z.entering) return;
    z.bossT -= dt;
    if (z.bossT <= 0 && !z.shout) {
      var pool2 = BOSS_SKILLS[z.type] || Object.keys(SP.SPELLS);
      z.shout = pool2[Math.floor(Math.random() * pool2.length)];
      z.shoutT = 1.2;
      z.bossT = (z.type === 'GLUT' ? 6.5 : 8) + Math.random() * 3;
      S.wave();
    }
    if (z.shout) {
      z.shoutT -= dt;
      if (z.shoutT <= 0) {
        var ch = z.shout;
        z.shout = null;
        if (z.type === 'GLUT') execGluttonySkill(z, ch);      // 暴食特殊技能
        else {                                                 // 通用：字弹攻击
          var sp = SP.SPELLS[ch];
          fx.bossSpells.push({
            ch: ch, color: sp.color,
            x: z.x - camera.x, y: z.y - z.dispH * 0.6,
            tx: hero.x - camera.x, ty: hero.y - 46,
            t: 0, dur: 1.5, dmg: 20
          });
          if (sp.kind === 'fire') S.fire(); else if (sp.kind === 'water') S.water(); else S.stone();
        }
      }
    }
    if (z.buffT > 0) {                                         // 「大」巨大化增益
      z.buffT -= dt;
      z.dispH = zStat(z.type).dispH * (1 + 0.25 * Math.min(1, z.buffT / 3));
      if (z.buffT <= 0) z.dispH = zStat(z.type).dispH;
    }
  }
  function execGluttonySkill(z, ch) {
    if (ch === '吃') {                                         // 吃：吞噬玩家金币
      var bite = Math.min(coinsCount, 4 + Math.floor(Math.random() * 6));
      if (bite > 0) {
        coinsCount -= bite;
        fx.dmgNums.push({ x: hero.x, y: hero.y - 116, txt: '被吃掉 ' + bite + ' 金币！', t: 1.1, color: '#ff9c6b' });
        for (var c = 0; c < Math.min(bite, 8); c++) {         // 金币反向飞向Boss
          fx.coins.push({ sx: view.w - 64, sy: 38, t: 0, dur: 0.6, delay: c * 0.05,
            cx: (Math.random() - 0.5) * 160, arc: 90, backTo: z });
        }
        S.rock();
      }
    } else if (ch === '大') {                                  // 大：巨大化+伤害提升
      z.buffT = 4; z.dmg += 4;
      fx.dmgNums.push({ x: z.x, y: z.y - z.dispH - 40, txt: '变大！', t: 1, color: '#ffb02e', big: true });
      S.boss();
    } else if (ch === '饭') {                                  // 饭：吞噬回血
      var h2 = Math.min(z.hpMax - z.hp, 45);
      z.hp += h2;
      fx.dmgNums.push({ x: z.x, y: z.y - z.dispH - 40, txt: '+' + h2, t: 1, color: '#9ce89c' });
      S.heal();
    }
  }
  function drawBossSpells(dt) {
    for (var i = fx.bossSpells.length - 1; i >= 0; i--) {
      var p = fx.bossSpells[i];
      p.t += dt / p.dur;
      var k = Math.min(1, p.t);
      var x = p.x + (p.tx - p.x) * k;
      var y = p.y + (p.ty - p.y) * k - Math.sin(k * Math.PI) * 90;
      ctx.save();
      ctx.font = 'bold 44px "Microsoft YaHei", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = p.color; ctx.shadowBlur = 20;
      ctx.fillStyle = p.color;
      ctx.fillText(p.ch, x, y);
      ctx.restore();
      if (Math.random() < 0.4) fx.parts.push({ x: x, y: y, vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30,
        t: 0.35, color: p.color, r: 2 + Math.random() * 2 });
      // 命中判定（屏幕坐标 vs 主角屏幕坐标）
      var hx = hero.x - camera.x, hy = hero.y - 46;
      if (Math.abs(x - hx) < 26 && Math.abs(y - hy) < 46) {
        fx.bossSpells.splice(i, 1);
        if (hero.invulnT <= 0) hurtPlayer(p.dmg, p.x + camera.x);
        continue;
      }
      if (k >= 1) fx.bossSpells.splice(i, 1);
    }
  }

  /* 光明词治疗（『爱』等 heal 系法术） */
  function healSelf(amount, ch, sp) {
    hero.hp = Math.min(hero.hpMax, hero.hp + amount);
    hero.spellPoseT = 0.4;
    fx.dmgNums.push({ x: hero.x, y: hero.y - 116, txt: ch + ' +' + amount, t: 1, color: sp.color });
    burst(hero.x - camera.x, hero.y - 60, sp.color, 16);
    S.heal(); S.magic();
    fx.combo++; fx.comboT = 2.5; fx.comboPop = 1;
  }

  /* ---------- 场景切换 ---------- */
  function enterScene(id, backX, viaDoor) {
    scene = SCENES[id];
    zombies.length = 0; enc.queue.length = 0;
    fx.bossSpells.length = 0;
    if (viaDoor && viaDoor.next) nextBlock();
    if (id === 'street') {
      enc.zones = makeZones(enc.block);
      if (enc.allClear) enc.phase = 'clear';
      else enc.phase = 'calm';
      enc.zoneIdx = 0; enc.waveIdx = 0;
    } else {
      enc.zones = scene.zones;
      enc.phase = 'calm'; enc.zoneIdx = 0; enc.waveIdx = 0; enc.allClear = false;
      // 重置医院/厨房 Boss 门（每轮重新挑战）
      if (scene.bossDoor) {
        scene.bossDoor.locked = true;
        scene.doors = scene.doors.filter(function (d) { return d !== scene.bossDoor; });
      }
    }
    hero.x = backX != null ? backX : scene.spawn.x;
    hero.y = (bandTop() + bandBot()) / 2;
    camera.x = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    makeItems();
    if (SP && SP.setPool) SP.setPool((scene.id === 'dining' || scene.id === 'kitchen') ? 'chapter1' : 'street');
    nearDoor = null;
    document.getElementById('enterBtn').style.display = 'none';
    if (hud.scene) hud.scene.textContent = scene.name;
    var shUI = document.getElementById('safehouseUI');
    if (shUI) shUI.classList.toggle('show', id === 'safehouse');
    var mg = document.getElementById('minigameOverlay');
    if (mg && id !== 'safehouse') mg.classList.remove('show');
    if (id === 'safehouse') {
      hero.hp = hero.hpMax;
      zKill = 0; updateHomeBtn();
      if (ZCITY.Charms) ZCITY.Charms.render();
      if (window.__shRefresh) window.__shRefresh();
      showToast('🛖 茅山安全屋 · 伤势已完全回复', 2200);
    }
    if (id === 'store') showToast('🏪 击退店员僵尸后可搜刮补给', 2000);
    if (id === 'hospital') showToast('🏥 院内有效尸化医护，小心', 2000);
    if (id === 'dining') showToast('🍽 第一章·暴食：僵尸吃撑了这里……', 2400);
    if (id === 'kitchen') showToast('🔥 厨房深处，暴食之主在等你', 2400);
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
    // 装饰招牌：中英双语（建筑词汇认知）
    ctx.save();
    ctx.textAlign = 'center';
    for (var b = 0; b < BILLBOARDS.length; b++) {
      var bb = BILLBOARDS[b];
      var bx = bb.x - camX;
      if (bx < -90 || bx > view.w + 90) continue;
      var by = view.groundY - 235 + Math.sin(b * 2.7) * 8;
      ctx.fillStyle = b % 2 ? 'rgba(60,140,190,0.85)' : 'rgba(190,80,70,0.85)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bx - 52, by, 104, 44, 6); ctx.fill(); }
      else ctx.fillRect(bx - 52, by, 104, 44);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 15px monospace';
      ctx.fillText(bb.en, bx, by + 19);
      ctx.font = '12px "Microsoft YaHei", sans-serif';
      ctx.fillText(bb.zh, bx, by + 36);
    }
    ctx.restore();
    ctx.fillStyle = '#2a2438'; ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.fillStyle = '#4a4060'; ctx.fillRect(0, view.groundY, view.w, 4);
    var dashY = view.groundY + (view.h - view.groundY) * 0.55;
    ctx.fillStyle = 'rgba(240,120,160,0.4)';
    var dashOff = -(camX % 90);
    for (var dx = dashOff; dx < view.w; dx += 90) ctx.fillRect(dx, dashY, 44, 3);
  }
  function drawHospitalBg(camX) {
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#1e2a30'); wall.addColorStop(1, '#2e4048');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    // 墙裙 + 病房元素（世界坐标）
    ctx.fillStyle = '#3a5a5a';
    ctx.fillRect(0, view.groundY - 70, view.w, 70);
    for (var s = 160; s < scene.worldW; s += 300) {
      var sx = s - camX;
      if (sx < -220 || sx > view.w + 220) continue;
      // 病床
      ctx.fillStyle = '#5a7a8a'; ctx.fillRect(sx, view.groundY - 44, 130, 18);
      ctx.fillStyle = '#e8e8e8'; ctx.fillRect(sx + 6, view.groundY - 48, 40, 10);
      ctx.fillStyle = '#3a4a5a';
      ctx.fillRect(sx - 6, view.groundY - 26, 8, 26); ctx.fillRect(sx + 128, view.groundY - 26, 8, 26);
      // 输液架
      ctx.strokeStyle = '#8aa8b8'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(sx + 165, view.groundY); ctx.lineTo(sx + 165, view.groundY - 120);
      ctx.lineTo(sx + 195, view.groundY - 120); ctx.stroke();
      ctx.fillStyle = 'rgba(180,220,200,0.7)'; ctx.fillRect(sx + 188, view.groundY - 112, 12, 22);
      // 红十字（世界认知：医院）
      if (s % 600 === 160) {
        ctx.fillStyle = '#e2574c';
        ctx.fillRect(sx + 60 - 40, view.groundY - 210, 80, 26);
        ctx.fillRect(sx + 60 - 27, view.groundY - 223, 54, 52);
      }
    }
    // 地板（净色格）
    ctx.fillStyle = '#3a4a48';
    ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.strokeStyle = 'rgba(180,210,210,0.14)'; ctx.lineWidth = 1;
    var tile = 52, oy = (camX % tile);
    for (var gx = -oy; gx < view.w; gx += tile) {
      ctx.beginPath(); ctx.moveTo(gx, view.groundY); ctx.lineTo(gx - 30, view.h); ctx.stroke();
    }
    for (var gy = view.groundY + 20; gy < view.h; gy += 28) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(view.w, gy); ctx.stroke();
    }
  }
  /* 茅山安全屋：暖木色道观内景（程序绘制：月窗/挂符/烛台/案桌） */
  function drawSafehouseBg(camX) {
    var g = ctx.createLinearGradient(0, 0, 0, view.groundY);
    g.addColorStop(0, '#241a12'); g.addColorStop(0.55, '#3a2a1a'); g.addColorStop(1, '#574028');
    ctx.fillStyle = g; ctx.fillRect(0, 0, view.w, view.groundY);
    var t = performance.now() / 1000;
    var wx = 360 - camX;
    if (wx > -120 && wx < view.w + 120) {
      var wy = view.groundY - 235;
      ctx.beginPath(); ctx.arc(wx, wy, 52, 0, 7); ctx.fillStyle = '#0e1626'; ctx.fill();
      ctx.lineWidth = 7; ctx.strokeStyle = '#6a4a26'; ctx.stroke();
      ctx.beginPath(); ctx.arc(wx - 13, wy - 9, 28, 0, 7); ctx.fillStyle = '#f5e9c8'; ctx.fill();
      ctx.strokeStyle = '#6a4a26'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(wx - 52, wy); ctx.lineTo(wx + 52, wy);
      ctx.moveTo(wx, wy - 52); ctx.lineTo(wx, wy + 52); ctx.stroke();
    }
    var hang = [130, 235, 485, 590];
    for (var hi = 0; hi < hang.length; hi++) {
      var hx = hang[hi] - camX;
      if (hx < -40 || hx > view.w + 40) continue;
      ctx.save();
      ctx.translate(hx, view.groundY - 205);
      ctx.rotate(Math.sin(t * 1.2 + hi * 1.7) * 0.07);
      ctx.fillStyle = '#e8d5a0'; ctx.fillRect(-17, 0, 34, 80);
      ctx.strokeStyle = '#b82820'; ctx.lineWidth = 2; ctx.strokeRect(-12, 6, 24, 68);
      ctx.fillStyle = '#b82820'; ctx.font = '900 15px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('敕', 0, 30); ctx.fillText('令', 0, 55);
      ctx.restore();
    }
    var candles = [75, 645];
    for (var ci = 0; ci < candles.length; ci++) {
      var x = candles[ci] - camX;
      if (x < -30 || x > view.w + 30) continue;
      var cy = view.groundY - 50;
      ctx.fillStyle = '#4a3320'; ctx.fillRect(x - 7, cy, 14, 50);
      ctx.fillStyle = '#e8d5a0'; ctx.fillRect(x - 4, cy - 7, 8, 8);
      var fl = 1 + Math.sin(t * 9 + ci * 3) * 0.28;
      var fg = ctx.createRadialGradient(x, cy - 16, 2, x, cy - 16, 20 * fl);
      fg.addColorStop(0, 'rgba(255,224,130,0.95)'); fg.addColorStop(1, 'rgba(255,140,40,0)');
      ctx.beginPath(); ctx.ellipse(x, cy - 15, 5 * fl, 11 * fl, 0, 0, 7);
      ctx.fillStyle = fg; ctx.fill();
    }
    ctx.fillStyle = '#3a2a18'; ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 2;
    for (var px = -(camX % 90); px < view.w + 40; px += 90) {
      ctx.beginPath(); ctx.moveTo(px, view.groundY); ctx.lineTo(px - 30, view.h); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,220,150,0.07)'; ctx.fillRect(0, view.groundY, view.w, 8);
    var tx = 360 - camX;
    if (tx > -160 && tx < view.w + 160) {
      ctx.fillStyle = '#5a3a20'; ctx.fillRect(tx - 72, view.groundY - 62, 144, 18);
      ctx.fillRect(tx - 64, view.groundY - 44, 10, 44); ctx.fillRect(tx + 54, view.groundY - 44, 10, 44);
      ctx.fillStyle = '#e8d5a0'; ctx.fillRect(tx - 36, view.groundY - 77, 72, 16);
      ctx.strokeStyle = '#b82820'; ctx.lineWidth = 2; ctx.strokeRect(tx - 36, view.groundY - 77, 72, 16);
      ctx.fillStyle = '#b82820'; ctx.font = '900 12px system-ui'; ctx.textAlign = 'center';
      ctx.fillText('符', tx, view.groundY - 65);
    }
  }
  function drawStoreBg(camX) {
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#1c2430'); wall.addColorStop(1, '#2c3a48');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    for (var s = 140; s < scene.worldW; s += 230) {
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
  function drawDiningBg(camX) {
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#2a2028'); wall.addColorStop(1, '#40303a');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    for (var s = 150; s < scene.worldW; s += 280) {
      var sx = s - camX;
      if (sx < -220 || sx > view.w + 220) continue;
      // 圆餐桌+桌布
      ctx.fillStyle = '#d8c8d0';
      ctx.beginPath(); ctx.ellipse(sx, view.groundY - 40, 66, 18, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#7a5a6a';
      ctx.beginPath(); ctx.ellipse(sx, view.groundY - 36, 58, 14, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c9a86a'; ctx.fillRect(sx - 5, view.groundY - 36, 10, 36);   // 桌腿
      // 餐具
      ctx.fillStyle = '#e8e8f0';
      ctx.beginPath(); ctx.arc(sx - 20, view.groundY - 44, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillRect(sx + 10, view.groundY - 50, 3, 12); ctx.fillRect(sx + 20, view.groundY - 50, 3, 12);
      // 吊灯
      if (s % 560 === 150) {
        ctx.strokeStyle = '#8a7a8a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, view.groundY - 260); ctx.lineTo(sx, view.groundY - 210); ctx.stroke();
        ctx.fillStyle = 'rgba(255,220,140,0.9)';
        ctx.beginPath(); ctx.moveTo(sx - 20, view.groundY - 210); ctx.lineTo(sx + 20, view.groundY - 210);
        ctx.lineTo(sx + 10, view.groundY - 186); ctx.lineTo(sx - 10, view.groundY - 186); ctx.closePath(); ctx.fill();
      }
    }
    // 自助餐台（ Buffet 词汇牌）
    var bx2 = 480 - camX;
    if (bx2 > -120 && bx2 < view.w + 120) {
      ctx.fillStyle = '#5a4a3a'; ctx.fillRect(bx2 - 70, view.groundY - 56, 140, 56);
      ctx.fillStyle = '#c9a86a'; ctx.fillRect(bx2 - 74, view.groundY - 62, 148, 10);
      ctx.fillStyle = '#8a5a2a'; ctx.fillRect(bx2 - 40, view.groundY - 86, 80, 26);
      ctx.fillStyle = '#ffe28a'; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
      ctx.fillText('BUFFET 餐台', bx2, view.groundY - 69);
    }
    // 地板
    ctx.fillStyle = '#4a3a40';
    ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.strokeStyle = 'rgba(220,190,200,0.12)'; ctx.lineWidth = 1;
    var tile = 50, oy = (camX % tile);
    for (var gx = -oy; gx < view.w; gx += tile) {
      ctx.beginPath(); ctx.moveTo(gx, view.groundY); ctx.lineTo(gx - 28, view.h); ctx.stroke();
    }
    for (var gy = view.groundY + 20; gy < view.h; gy += 27) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(view.w, gy); ctx.stroke();
    }
  }
  function drawKitchenBg(camX) {
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#242a24'); wall.addColorStop(1, '#38443a');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    // 白瓷砖墙
    ctx.strokeStyle = 'rgba(200,220,200,0.15)'; ctx.lineWidth = 1;
    for (var ty = 40; ty < view.groundY - 80; ty += 44) {
      ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(view.w, ty); ctx.stroke();
    }
    for (var s = 170; s < scene.worldW; s += 300) {
      var sx = s - camX;
      if (sx < -220 || sx > view.w + 220) continue;
      // 灶台+火
      ctx.fillStyle = '#4a4a52'; ctx.fillRect(sx - 70, view.groundY - 64, 140, 64);
      ctx.fillStyle = '#2a2a30'; ctx.fillRect(sx - 58, view.groundY - 58, 44, 40);
      ctx.fillRect(sx + 12, view.groundY - 58, 44, 40);
      var fl = 0.6 + 0.4 * Math.sin(performance.now() / 130 + s);
      ctx.fillStyle = 'rgba(255,140,60,' + (0.75 * fl) + ')';
      ctx.beginPath(); ctx.arc(sx - 36, view.groundY - 56, 9 + 4 * fl, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(sx + 34, view.groundY - 56, 9 + 4 * fl, 0, Math.PI * 2); ctx.fill();
      // 大锅
      if (s % 600 === 170) {
        ctx.fillStyle = '#3a3a42';
        ctx.beginPath(); ctx.arc(sx + 90, view.groundY - 40, 34, Math.PI, 0); ctx.fill();
        ctx.fillStyle = 'rgba(240,220,180,0.85)';
        ctx.fillRect(sx + 58, view.groundY - 44, 64, 6);
        ctx.fillStyle = '#8a5a2a'; ctx.fillRect(sx + 60, view.groundY - 78, 76, 22);
        ctx.fillStyle = '#ffe28a'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText('SOUP 汤', sx + 98, view.groundY - 63);
      }
      // 案板
      if (s % 600 === 470) {
        ctx.fillStyle = '#c9a86a'; ctx.fillRect(sx - 60, view.groundY - 92, 120, 12);
        ctx.fillStyle = '#e8e8f0';
        ctx.beginPath(); ctx.moveTo(sx - 30, view.groundY - 92); ctx.lineTo(sx - 22, view.groundY - 116); ctx.lineTo(sx - 14, view.groundY - 92); ctx.closePath(); ctx.fill();
      }
    }
    // 排风扇
    ctx.fillStyle = '#2e362e';
    for (var v = 100; v < scene.worldW; v += 420) {
      var vx = v - camX;
      if (vx > -40 && vx < view.w + 40) { ctx.beginPath(); ctx.arc(vx, 70, 26, 0, Math.PI * 2); ctx.fill(); }
    }
    // 地板（防滑格）
    ctx.fillStyle = '#3a4038';
    ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.strokeStyle = 'rgba(180,200,180,0.15)';
    var tile2 = 44, oy2 = (camX % tile2);
    for (var gx2 = -oy2; gx2 < view.w; gx2 += tile2) {
      ctx.beginPath(); ctx.moveTo(gx2, view.groundY); ctx.lineTo(gx2 - 24, view.h); ctx.stroke();
    }
    for (var gy2 = view.groundY + 20; gy2 < view.h; gy2 += 25) {
      ctx.beginPath(); ctx.moveTo(0, gy2); ctx.lineTo(view.w, gy2); ctx.stroke();
    }
  }
  function drawDoor(d) {
    var x = d.x - camera.x;
    if (x < -90 || x > view.w + 90) return;
    var dw = d.w || 56, dh = 96, top = view.groundY - dh;
    ctx.save();
    ctx.fillStyle = '#191420';
    ctx.fillRect(x - dw / 2, top, dw, dh);
    var isHosp = d.to === 'hospital';
    ctx.strokeStyle = d.next ? '#7ec8ff' : (isHosp ? '#ff8a8a' : '#ffd873'); ctx.lineWidth = 3;
    ctx.strokeRect(x - dw / 2, top, dw, dh);
    var g = ctx.createLinearGradient(0, top, 0, view.groundY);
    g.addColorStop(0, d.next ? 'rgba(120,190,255,0.55)' : isHosp ? 'rgba(255,140,130,0.5)' : 'rgba(255,190,90,0.55)');
    g.addColorStop(1, 'rgba(60,60,80,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - dw / 2 + 3, top + 3, dw - 6, dh - 6);
    // 门顶双语招牌
    var en = d.next ? 'NEXT BLOCK' : isHosp ? 'HOSPITAL' : 'MART';
    ctx.fillStyle = isHosp ? '#e2574c' : d.next ? '#2a5a8a' : '#8a5a2a';
    ctx.fillRect(x - dw / 2 - 10, top - 30, dw + 20, 26);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(en, x, top - 22);
    ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
    ctx.fillText(d.label.replace(/^(进入|回到|深入)/, ''), x, top - 8);
    if (isHosp) {                                            // 门上红十字
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 4, top + 16, 8, 22);
      ctx.fillRect(x - 10, top + 23, 20, 8);
    }
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
    drawShadow(x, y, 22);
    var alpha = 1;
    if (h.invulnT > 0) alpha = Math.max(0.35, 0.62 + 0.25 * Math.sin(h.invulnT * 22));
    ctx.save();
    ctx.globalAlpha = alpha;
    var e = null, idx = 0;
    if (h.invulnT > 0.7) { e = A.get('hero.hurt'); }
    else if (h.spellPoseT > 0 || h.atkT > 0) {
      if (h.moving) { e = A.get('hero.runShoot'); idx = Math.floor(h.walkPhase); }
      else e = A.get('hero.shoot');
    } else if (h.moving) { e = A.get('hero.run'); idx = Math.floor(h.walkPhase); }
    else { e = A.get('hero.idle'); idx = Math.floor(h.idlePhase || 0); }
    var lean = h.atkT > 0 ? h.face * 6 : 0;
    if (!e || !e.ok) {
      ctx.save(); ctx.translate(x + lean, y); ctx.scale(h.face, 1);
      var swing = Math.sin(h.walkPhase * Math.PI * 2) * (h.moving ? 1 : 0.12);
      ctx.fillStyle = '#3a6ea8'; ctx.fillRect(-9 + 7 * swing, -22, 8, 22); ctx.fillRect(1 - 7 * swing, -22, 8, 22);
      ctx.fillStyle = '#e2574c'; ctx.fillRect(-10, -48, 20, 27);
      ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-4, -44); ctx.lineTo(-12 * swing - 4, -32);
      ctx.moveTo(4, -44); ctx.lineTo(12 * swing + 4, -32); ctx.stroke();
      ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(0, -56, 9, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2b2333'; ctx.fillRect(-9, -66, 18, 7);
      ctx.restore();
    } else {
      A.drawFrame(ctx, e, idx, x + lean, y, 108, h.face);
    }
    // 武器可视（持棒/刀时手侧绘制）
    if (h.weapon && h.weapon.ch === '棒') {
      ctx.save(); ctx.translate(x + h.face * 14, y - 40); ctx.rotate(h.face * 0.5);
      ctx.fillStyle = '#8a6a3a'; ctx.fillRect(-3, -26, 6, 34);
      ctx.fillStyle = '#c9a86a'; ctx.fillRect(-3, -30, 6, 8);
      ctx.restore();
    } else if (h.weapon && h.weapon.ch === '刀') {
      ctx.save(); ctx.translate(x + h.face * 15, y - 44); ctx.rotate(h.face * -0.3);
      ctx.fillStyle = '#d8d8e8'; ctx.beginPath();
      ctx.moveTo(0, -30); ctx.lineTo(5, 4); ctx.lineTo(-2, 6); ctx.lineTo(-4, -26); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#8a5a2a'; ctx.fillRect(-6, 4, 12, 4);
      ctx.restore();
    }
    ctx.restore();
    if (fx.slashT > 0) {
      var p = 1 - fx.slashT / ATK.dur;
      ctx.save();
      ctx.translate(x, y - 52); ctx.scale(h.face, 1);
      ctx.strokeStyle = hero.weapon ? 'rgba(255,220,150,' + (1 - p) + ')' : 'rgba(255,240,190,' + (1 - p) + ')';
      ctx.lineWidth = (hero.weapon ? 14 : 10) * (1 - p * 0.5);
      ctx.beginPath();
      ctx.arc(10, 0, hero.weapon ? 56 : 46, -1.1 + p * 1.6, 0.6 + p * 1.6);
      ctx.stroke();
      ctx.restore();
    }
  }
  function drawZombie(z) {
    var x = z.x - camera.x;
    if (x < -220 || x > view.w + 220) return;
    var st = zStat(z.type);
    if (z.dead) {
      var p = Math.min(1, z.deadT / 0.55);
      ctx.save();
      ctx.globalAlpha = 1 - p;
      drawShadow(x, z.y, 18 * (1 - p * 0.5));
      var e2 = A.get('zombie.' + st.anim + '_walk');
      ctx.translate(x, z.y);
      ctx.scale(1 + p * 0.5, Math.max(0.05, 1 - p));
      ctx.translate(-x, -z.y);
      A.drawFrame(ctx, e2, 0, x, z.y, z.dispH, 1);
      ctx.restore();
      return;
    }
    drawShadow(x, z.y, z.dispH * 0.18);
    var lean = z.windup > 0 ? -8 * (1 - z.windup / st.windup) : 0;
    var anim = (z.close && !z.entering) ? st.anim + '_attack' : st.anim + '_walk';
    var e = A.get('zombie.' + anim) || A.get('zombie.' + st.anim + '_walk');
    var rawIdx = z.windup > 0 ? Math.floor((st.windup - z.windup) * 10) : (z.close ? Math.floor(z.atkT) : Math.floor(z.phase));
    var idx = isFinite(rawIdx) ? rawIdx : 0;
    var face = (hero.x < z.x) ? 1 : -1;
    var ok = A.drawFrame(ctx, e, idx, x + lean, z.y, z.dispH, face);
    if (!ok) {
      ctx.fillStyle = st.anim === 'DOC' ? '#c8d8e0' : st.anim === 'NUR' ? '#e8b8c8' : st.anim === 'BOSS' ? '#d8d8e8' : '#5c8a4a';
      ctx.fillRect(x - 12, z.y - z.dispH * 0.75, 24, z.dispH * 0.75);
      ctx.beginPath(); ctx.arc(x, z.y - z.dispH * 0.8, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (z.hurtT > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.65, z.hurtT * 4);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - 24, z.y - z.dispH, 48, z.dispH);
      ctx.restore();
    }
    if (z.windup > 0) {
      ctx.save();
      ctx.font = 'bold ' + (z.type === 'BOSS' ? 40 : 26) + 'px sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb02e';
      ctx.fillText('!', x, z.y - z.dispH - (z.type === 'BOSS' ? 80 : 46) - (1 - z.windup / st.windup) * 6);
      ctx.restore();
    }
    if (z.hp < z.hpMax) {
      var bw = z.type === 'BOSS' ? 90 : 44, hpP = Math.max(0, z.hp / z.hpMax);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw, 5);
      ctx.fillStyle = hpP > 0.5 ? '#9ce89c' : hpP > 0.25 ? '#ffd873' : '#ff6b5c';
      ctx.fillRect(x - bw / 2, z.y - z.dispH - 12, bw * hpP, 5);
    }
    // Boss 喊词气泡
    if (z.shout) {
      var wi = SP.wordInfo ? SP.wordInfo(z.shout) : null;
      var wColor = wi ? wi.color : '#ffd873';
      ctx.save();
      var bbW = 64, bbH = 46;
      var bbX = x - bbW / 2, bbY = z.y - z.dispH - 92;
      ctx.fillStyle = 'rgba(20,10,14,0.88)';
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bbX, bbY, bbW, bbH, 10); ctx.fill(); }
      else ctx.fillRect(bbX, bbY, bbW, bbH);
      ctx.strokeStyle = wColor; ctx.lineWidth = 2;
      if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(bbX, bbY, bbW, bbH, 10); ctx.stroke(); }
      else ctx.strokeRect(bbX, bbY, bbW, bbH);
      ctx.font = 'bold 30px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = wColor;
      ctx.fillText(z.shout, x, bbY + 22);
      ctx.font = '10px monospace';
      ctx.fillStyle = '#fff';
      ctx.fillText(wi ? wi.en.toUpperCase() + '!' : 'BOSS CAST', x, bbY + bbH - 8);
      ctx.restore();
    }
    // 弱点字符牌（字 + 英文释义）
    var bob = Math.sin(z.phase * 0.6) * 3;
    var bw2 = z.type === 'BOSS' ? 58 : 36, bh2 = z.type === 'BOSS' ? 52 : 44;
    var bx = x - bw2 / 2, by = z.y - z.dispH - (z.type === 'BOSS' ? 46 : 40) + bob;
    var pend = z.charWin && (z.charWin.voice || z.charWin.rune);
    var sp2 = SP.SPELLS[z.spell];
    ctx.save();
    ctx.fillStyle = '#f5e6c8';
    ctx.strokeStyle = pend ? '#ffd873' : '#8a5a2a'; ctx.lineWidth = pend ? 3 : 2;
    if (pend) { ctx.shadowColor = '#ffd873'; ctx.shadowBlur = 10; }
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(bx, by, bw2, bh2, 6); else ctx.rect(bx, by, bw2, bh2);
    ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + (z.type === 'BOSS' ? 32 : 22) + 'px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = '#c03028';
    ctx.fillText(z.spell, x, by + (z.type === 'BOSS' ? 20 : 16));
    ctx.font = 'bold ' + (z.type === 'BOSS' ? 11 : 9) + 'px monospace';
    ctx.fillStyle = '#2a5a2a';
    ctx.fillText(sp2 ? sp2.en : '', x, by + (z.type === 'BOSS' ? 40 : 34));
    if (z.charWin && (z.charWin.voice || z.charWin.rune)) {
      ctx.font = '11px sans-serif';
      ctx.fillStyle = '#3a7a2a';
      ctx.textAlign = 'left';
      ctx.fillText((z.charWin.voice ? '🔊' : '') + (z.charWin.rune ? '✍' : ''), bx + 2, by + bh2 - 4);
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
  /* 物品绘制（发光浮字） */
  function drawItems() {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var x = it.x - camera.x;
      if (x < -60 || x > view.w + 60) continue;
      var info = ITEMS[it.ch];
      var y = view.groundY - 26 + Math.sin(performance.now() / 400 + i) * 5;
      var near = Math.abs(it.x - hero.x) < 46;
      ctx.save();
      ctx.shadowColor = info.color; ctx.shadowBlur = near ? 22 : 12;
      ctx.font = 'bold 30px "Microsoft YaHei", serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = info.color;
      ctx.fillText(it.ch, x, y);
      ctx.shadowBlur = 0;
      ctx.font = 'bold 10px monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(info.en.toUpperCase(), x, y + 22);
      if (near) {
        ctx.font = 'bold 11px "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#ffe28a';
        ctx.fillText('靠近 → 念词拾取', x, y - 28);
      }
      ctx.restore();
    }
  }

  /* ---------- 特效层 ---------- */
  function drawFx(dt) {
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
      if (Math.random() < 0.6) fx.parts.push({ x: cx, y: cy, vx: (Math.random() - 0.5) * 40, vy: (Math.random() - 0.5) * 40,
        t: 0.3, color: p.color, r: 1.5 + Math.random() * 2 });
      if (k >= 1) { fx.spells.splice(s, 1); spellHit(p); }
    }
    drawBossSpells(dt);
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
    var tcx = view.w - 64, tcy = 38;
    for (var c2 = fx.coins.length - 1; c2 >= 0; c2--) {
      var c = fx.coins[c2];
      if (c.delay > 0) { c.delay -= dt; continue; }
      c.t += dt / c.dur;
      var t = Math.min(1, c.t);
      var tcx2 = tcx, tcy2 = tcy;
      if (c.backTo) { tcx2 = c.backTo.x - camera.x; tcy2 = c.backTo.y - c.backTo.dispH * 0.6; }  // 被吃：飞向Boss
      var mx = (c.sx + tcx2) / 2 + c.cx;
      var my = Math.min(c.sy, tcy2) - c.arc;
      var x = (1 - t) * (1 - t) * c.sx + 2 * (1 - t) * t * mx + t * t * tcx2;
      var y = (1 - t) * (1 - t) * c.sy + 2 * (1 - t) * t * my + t * t * tcy2;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(Math.abs(Math.cos(t * 9)) * 0.7 + 0.3, 1);
      ctx.fillStyle = '#ffd873'; ctx.strokeStyle = '#a87818'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(0, 0, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.restore();
      if (t >= 1) { fx.coins.splice(c2, 1); if (!c.backTo) { coinsCount++; coinPop = 0.3; S.coin(); heroWallet(1); } }
    }
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
    var w = document.getElementById('weaponChip');
    if (w) w.style.display = hero.weapon ? 'flex' : 'none';
    if (hero.weapon && w) w.textContent = '🗡 ' + hero.weapon.ch + ' +' + hero.weapon.bonus;
    var kc = document.getElementById('karmaChip');
    if (kc) {
      var k = SP && SP.karma ? SP.karma() : { light: 0 };
      kc.textContent = '💛 ' + k.light;
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
      else hero.idlePhase = (hero.idlePhase + dt * 1.4) % 4;
      if (hero.atkCd > 0) hero.atkCd -= rdt;
      if (hero.atkT > 0) hero.atkT -= rdt;
      if (hero.spellPoseT > 0) hero.spellPoseT -= rdt;
      if (hero.invulnT > 0) hero.invulnT -= rdt;

      encTick(dt);
      if (SP) SP.tick(dt, rdt);

      for (var i = zombies.length - 1; i >= 0; i--) {
        var z = zombies[i];
        if (z.dead) { z.deadT += dt; if (z.deadT > 0.55) zombies.splice(i, 1); continue; }
        if (z.hurtT > 0) z.hurtT -= rdt;
        if (Math.abs(z.kb) > 4) { z.x += z.kb * dt; z.kb *= Math.max(0, 1 - 7 * dt); }
        var dx = hero.x - z.x, dy = hero.y - z.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        z.close = d < (isBossT(z.type) ? 74 : 46);
        if (isBossT(z.type)) bossTick(z, dt);
        if (z.entering) {
          var inX = camera.x + view.w * (z.x > camera.x + view.w / 2 ? 0.86 : 0.14);
          var edx = inX - z.x;
          z.x += Math.sign(edx) * z.speed * (isBossT(z.type) ? 2.8 : 1.15) * dt;   // Boss入场加速演出
          z.phase += dt * 7;
          if (Math.abs(edx) < 24 || d < 90) z.entering = false;
          continue;
        }
        if (z.strikeT > 0) {
          z.strikeT -= dt;
          z.x += z.strikeDir * STRIKE.speed * dt;
          if (z.strikeT <= 0) z.atkCd = enc.block === 1 ? 2.6 : 1.7;
          continue;
        }
        if (z.windup > 0) {
          z.windup -= dt;
          if (z.windup <= 0) {
            z.strikeT = STRIKE.dur; z.strikeDir = Math.sign(dx) || 1;
            if (d < (z.type === 'BOSS' ? 88 : 62) && hero.invulnT <= 0) hurtPlayer(z.dmg, z.x);
          }
          continue;
        }
        if (z.close && z.atkCd <= 0) { z.windup = zStat(z.type).windup + (enc.block === 1 ? 0.25 : 0); continue; }
        if (z.atkCd > 0) z.atkCd -= dt;
        if (z.close) z.atkT += dt * 8;
        if (!z.close) {
          z.x += dx / d * z.speed * dt;
          z.y += dy / d * z.speed * dt * 0.5;
          z.y = clamp(z.y, bandTop(), bandBot());
          z.phase += dt * 7;
        } else if (d < (isBossT(z.type) ? 60 : 30)) {
          z.x -= dx / d * 26 * dt;
          z.y -= dy / d * 26 * dt * 0.5;
          z.y = clamp(z.y, bandTop(), bandBot());
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

      // 物品拾取（自动弹念词面板）
      if (enc.phase !== 'active' && !defeated && !document.getElementById('voicePanel')) {
        var ni = nearItem();
        if (ni && !ni.opened) {
          ni.opened = true;
          tryPickup(ni);
        } else if (!ni) {
          items.forEach(function (it2) { it2.opened = false; });
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
    if (scene.id === 'hospital') drawHospitalBg(camera.x);
    else if (scene.id === 'dining') drawDiningBg(camera.x);
    else if (scene.id === 'kitchen') drawKitchenBg(camera.x);
    else if (scene.id === 'safehouse') drawSafehouseBg(camera.x);
    else if (scene.indoor) drawStoreBg(camera.x);
    else drawStreetBg(camera.x);
    drawBarricades();
    for (var m2 = 0; m2 < scene.doors.length; m2++) drawDoor(scene.doors[m2]);
    drawItems();
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
      audio();
      if (scene.id === 'safehouse') { showToast('已在安全屋中'); return; }
      if (!safehouseReady()) {
        showToast('还需击杀 ' + (SAFE_KILLS - zKill) + ' 只僵尸开启安全屋（' + zKill + '/' + SAFE_KILLS + '）', 2200);
        return;
      }
      startTransition(function () { enterScene('safehouse'); });
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
    zombies = []; items = [];
    camera = { x: 0 };
    scene = SCENES.street;
    if (hud.scene) hud.scene.textContent = scene.name;
    makeItems();
    // 僵尸服装变体（着色）：医生白大褂/护士粉/店员绿裙/BOSS巨医白
    A.tintEntry('zombie.A_walk', 'zombie.DOC_walk', '#e8eef2', 0.5);
    A.tintEntry('zombie.A_attack', 'zombie.DOC_attack', '#e8eef2', 0.5);
    A.tintEntry('zombie.B_walk', 'zombie.NUR_walk', '#f2b8c8', 0.5);
    A.tintEntry('zombie.B_attack', 'zombie.NUR_attack', '#f2b8c8', 0.5);
    A.tintEntry('zombie.A_walk', 'zombie.CLR_walk', '#8ad08a', 0.45);
    A.tintEntry('zombie.A_attack', 'zombie.CLR_attack', '#8ad08a', 0.45);
    A.tintEntry('zombie.C_walk', 'zombie.BOSS_walk', '#e8eef2', 0.55);
    A.tintEntry('zombie.C_attack', 'zombie.BOSS_attack', '#e8eef2', 0.55);
    // 第一章·暴食厨系变体：厨工白帽/服务员红/厨师白/暴食Boss土黄
    A.tintEntry('zombie.A_walk', 'zombie.CHEF_walk', '#f0ede4', 0.5);
    A.tintEntry('zombie.A_attack', 'zombie.CHEF_attack', '#f0ede4', 0.5);
    A.tintEntry('zombie.B_walk', 'zombie.WAIT_walk', '#e86a5a', 0.5);
    A.tintEntry('zombie.B_attack', 'zombie.WAIT_attack', '#e86a5a', 0.5);
    A.tintEntry('zombie.C_walk', 'zombie.COOK_walk', '#f0ede4', 0.55);
    A.tintEntry('zombie.C_attack', 'zombie.COOK_attack', '#f0ede4', 0.55);
    A.tintEntry('zombie.C_walk', 'zombie.GLUT_walk', '#d8a850', 0.6);
    A.tintEntry('zombie.C_attack', 'zombie.GLUT_attack', '#d8a850', 0.6);
    if (SP) SP.init({
      get hero() { return hero; },
      get zombies() { return zombies; },
      locked: function () { return defeated || trans.phase !== 0 || scene.indoor || SP.locked(); },
      canCast: function () { return !defeated && trans.phase === 0; },
      healSelf: healSelf,
      toast: showToast,
      banner: banner,
      spellStrike: spellStrike
    });
    bindUi();
    updateHomeBtn();
    if (ZCITY.Charms) ZCITY.Charms.boot();
    if (ZCITY.VoiceWake) ZCITY.VoiceWake.boot();   // 免按声纹引擎：进战斗即持续监听
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
  /* 战斗对外接口（符纸背包/安全屋 UI 使用） */
  ZCITY.Combat = {
    get scene() { return scene; },
    get hero() { return hero; },
    get zombies() { return zombies; },
    spellStrike: spellStrike,
    healHero: function (n) { hero.hp = Math.min(hero.hpMax, hero.hp + (n || 0)); },
    canCast: function () { return !defeated && trans.phase === 0; },
    go: function (id, backX) { startTransition(function () { enterScene(id, backX); }); },
    toast: showToast
  };
  ZCITY.Game.micState = function (on) {
    var b = document.getElementById('btnVoice');
    if (b) b.classList.toggle('listening', !!on);
  };
  ZCITY.Debug = {
    get hero() { return hero; },
    get zombies() { return zombies; },
    get camera() { return camera; },
    get scene() { return scene; },
    get enc() { return enc; },
    get fx() { return fx; },
    get items() { return items; },
    ITEMS: ITEMS,
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
        weapon: hero.weapon ? hero.weapon.ch : null, items: items.map(function (i2) { return i2.ch; }),
        bossSpells: fx.bossSpells.length,
        spells: fx.spells.length, parts: fx.parts.length, dmgNums: fx.dmgNums.length, coinFly: fx.coins.length
      };
    }
  };
})();
