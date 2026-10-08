/* 丧尸英语城 - M0.2 战斗引擎（忍者神龟式八向移动舞台版）
 * - 街道 = 有边界的横版舞台，人物可上下左右走位（含纵深排序/投影）
 * - 相机双向平滑跟随（修复：向左走人物消失 / 向右卡死）
 * - 房屋有交互门：走到门口出现"进入"按钮 → 黑场过渡进入新场景（便利店内部）
 * - 喊词/画符/安全屋按钮均有响应反馈（对应里程碑开放前的提示）
 * 素材缺失时自动用色块剪影兜底
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var A = ZCITY.Assets;

  /* ---------- 舞台（场景）定义 ---------- */
  var SCENES = {
    street: {
      id: 'street', name: '死亡大道', worldW: 1700, indoor: false,
      spawn: { x: 140 }, doors: [
        { x: 1150, label: '进入便利店', to: 'store', backX: 210, w: 58 }
      ]
    },
    store: {
      id: 'store', name: '便利店内部', worldW: 780, indoor: true,
      spawn: { x: 150 }, doors: [
        { x: 90, label: '回到街道', to: 'street', backX: 1100, w: 54 }
      ]
    }
  };

  var WALK = { hero: 225, vert: 150, bandTop: 24, bandBot: 12 };   // 移动速度/可走带边距
  var Z_WALK = 46;

  var canvas, ctx, dpr = 1;
  var view = { w: 0, h: 0, groundY: 0 };
  var scene, hero, zombies, camera, trans = { a: 0, phase: 0, cb: null };
  var keys = { left: false, right: false, up: false, down: false };
  var running = false, lastT = 0, rafId = 0;
  var hud = {}, coinsCount = 0, nearDoor = null, toastTimer = 0;

  function bandTop() { return view.groundY + WALK.bandTop; }
  function bandBot() { return view.h - WALK.bandBot; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

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
    return { x: x, y: (bandTop() + bandBot()) / 2, face: 1, walkPhase: 0, moving: false, hp: 100, hpMax: 100 };
  }
  function spawnZombie(type) {
    zombies.push({
      type: type,
      x: camera.x + view.w + 60 + Math.random() * 260,
      y: bandTop() + Math.random() * (bandBot() - bandTop()),
      dispH: 96 + Math.random() * 18,
      speed: Z_WALK * (type === 'B' ? 1.65 : type === 'C' ? 0.75 : 1),
      phase: Math.random() * 10,
      atkT: 0, close: false,
      dead: false, deadT: 0,
      spell: Math.random() < 0.5 ? '火' : '冰'
    });
  }

  /* ---------- 场景切换 ---------- */
  function enterScene(id, backX) {
    scene = SCENES[id];
    zombies.length = 0;
    hero.x = backX != null ? backX : scene.spawn.x;
    hero.y = (bandTop() + bandBot()) / 2;
    camera.x = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    nearDoor = null;
    document.getElementById('enterBtn').style.display = 'none';
    if (hud.scene) hud.scene.textContent = scene.name;
  }
  function startTransition(cb) {
    if (trans.phase !== 0) return;
    trans.phase = 1; trans.cb = cb;                    // 1=渐黑 2=渐亮
  }

  /* ---------- 街道背景（Warped City 三层视差） ---------- */
  var BG_LAYERS = [
    { key: 'bg.skyline',   parallax: 0.15, scale: 2.3 },
    { key: 'bg.buildings', parallax: 0.42, scale: 2.9 },
    { key: 'bg.near',      parallax: 0.8,  scale: 2.3 }
  ];
  function drawStreetBg(camX) {
    var sky = ctx.createLinearGradient(0, 0, 0, view.groundY);
    sky.addColorStop(0, '#2b2333');
    sky.addColorStop(0.6, '#5a3a44');
    sky.addColorStop(1, '#8a5a3a');
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
  }

  /* ---------- 便利店内部背景（程序化占位） ---------- */
  function drawStoreBg(camX) {
    // 墙
    var wall = ctx.createLinearGradient(0, 0, 0, view.groundY);
    wall.addColorStop(0, '#1c2430'); wall.addColorStop(1, '#2c3a48');
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, view.w, view.groundY);
    // 货架（世界坐标，随相机移动）
    for (var s = 120; s < scene.worldW; s += 230) {
      var sx = s - camX;
      if (sx < -160 || sx > view.w + 160) continue;
      ctx.fillStyle = '#3d4f60'; ctx.fillRect(sx, view.groundY - 150, 150, 110);   // 架体
      ctx.fillStyle = '#556b80';
      for (var r = 0; r < 3; r++) ctx.fillRect(sx + 6, view.groundY - 142 + r * 34, 138, 8);
      var cols = ['#e2574c', '#ffd873', '#7ec8ff', '#9ce89c'];
      for (var c2 = 0; c2 < 6; c2++) {
        ctx.fillStyle = cols[(s + c2 + r) % 4];
        ctx.fillRect(sx + 12 + c2 * 22, view.groundY - 130 + ((c2 % 2) ? 34 : 0), 14, 20);
      }
    }
    // 天花灯
    ctx.fillStyle = 'rgba(220,240,255,0.85)';
    for (var l = 0; l < scene.worldW; l += 260) {
      var lx = l - camX * 1;
      if (lx > -90 && lx < view.w) ctx.fillRect(lx, 26, 70, 8);
    }
    // 地板（方格）
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

  /* ---------- 门（世界坐标，画在建筑前沿） ---------- */
  function drawDoor(d) {
    var x = d.x - camera.x;
    if (x < -80 || x > view.w + 80) return;
    var dw = d.w || 56, dh = 88, top = view.groundY - dh;
    ctx.save();
    ctx.fillStyle = '#191420';                                 // 门洞
    ctx.fillRect(x - dw / 2, top, dw, dh);
    ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 3;            // 金框
    ctx.strokeRect(x - dw / 2, top, dw, dh);
    var g = ctx.createLinearGradient(0, top, 0, view.groundY); // 门内暖光
    g.addColorStop(0, 'rgba(255,190,90,0.55)');
    g.addColorStop(1, 'rgba(255,120,60,0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(x - dw / 2 + 3, top + 3, dw - 6, dh - 6);
    ctx.fillStyle = '#ffe28a';                                 // 招牌
    ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillRect(x - dw / 2 - 6, top - 24, dw + 12, 20);
    ctx.fillStyle = '#5a2a10';
    ctx.fillText(d.label.replace(/^(进入|回到)/, ''), x, top - 14);
    ctx.restore();
  }

  /* ---------- 边界路障 ---------- */
  function drawBarricades() {
    if (scene.indoor) return;
    var hy = view.groundY, bh = view.h - view.groundY;
    [[0, 1], [scene.worldW - 12, 1]].forEach(function (b) {
      var x = b[0] - camera.x;
      if (x < -20 || x > view.w + 20) return;
      ctx.save();
      for (var i = 0; i < 10; i++) {
        ctx.fillStyle = i % 2 ? '#e2574c' : '#f5e6c8';
        ctx.fillRect(x, hy + i * (bh / 10), 12, bh / 10);
      }
      ctx.restore();
    });
  }

  /* ---------- 角色绘制 ---------- */
  function drawShadow(x, y, w) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath();
    ctx.ellipse(x, y + 3, w, w * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  function drawHero(h) {
    var x = h.x - camera.x, y = h.y;
    drawShadow(x, y, 22);
    var e = A.get('hero.run'), moving = h.moving;
    if (e && e.ok) {
      var idx = moving ? Math.floor(h.walkPhase) : 0;
      var ee = moving ? e : (A.get('hero.idle') || e);
      A.drawFrame(ctx, ee, idx, x, y, 108, h.face);
      return;
    }
    ctx.save();                                                // 兜底剪影
    ctx.translate(x, y); ctx.scale(h.face, 1);
    var swing = Math.sin(h.walkPhase * Math.PI * 2) * (moving ? 1 : 0.12);
    ctx.fillStyle = '#3a6ea8';
    ctx.fillRect(-9 + 7 * swing, -22, 8, 22);
    ctx.fillRect(1 - 7 * swing, -22, 8, 22);
    ctx.fillStyle = '#e2574c'; ctx.fillRect(-10, -48, 20, 27);
    ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-4, -44); ctx.lineTo(-12 * swing - 4, -32);
    ctx.moveTo(4, -44); ctx.lineTo(12 * swing + 4, -32);
    ctx.stroke();
    ctx.fillStyle = '#ffcf9e'; ctx.beginPath(); ctx.arc(0, -56, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2333'; ctx.fillRect(-9, -66, 18, 7);
    ctx.restore();
  }
  function drawZombie(z) {
    var x = z.x - camera.x;
    if (x < -170 || x > view.w + 170) return;
    drawShadow(x, z.y, 18);
    var anim = (z.close && !z.dead) ? z.type + '_attack' : z.type + '_walk';
    var e = A.get('zombie.' + anim) || A.get('zombie.' + z.type + '_walk');
    var idx = z.dead ? 0 : Math.floor(z.close ? z.atkT : z.phase);
    var face = (hero.x < z.x) ? 1 : -1;                        // 素材原生朝左
    var ok = A.drawFrame(ctx, e, idx, x, z.y, z.dispH, face);
    if (!ok) {
      ctx.fillStyle = '#5c8a4a';
      ctx.fillRect(x - 12, z.y - z.dispH * 0.75, 24, z.dispH * 0.75);
      ctx.beginPath(); ctx.arc(x, z.y - z.dispH * 0.8, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (z.hurtT > 0) {
      ctx.save(); ctx.globalAlpha = Math.min(0.6, z.hurtT * 2);
      ctx.fillStyle = '#ff5544';
      ctx.fillRect(x - 20, z.y - z.dispH, 40, z.dispH);
      ctx.restore();
    }
    if (!z.dead && z.spell) {                                  // 弱点字符牌
      var bob = Math.sin(z.phase * 0.6) * 3;
      var bw = 34, bx = x - bw / 2, by = z.y - z.dispH - 40 + bob;
      ctx.save();
      ctx.fillStyle = '#f5e6c8';
      ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, 32, 6); else ctx.rect(bx, by, bw, 32);
      ctx.fill(); ctx.stroke();
      ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c03028';
      ctx.fillText(z.spell, x, by + 17);
      ctx.restore();
    }
  }

  /* ---------- HUD/提示 ---------- */
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
    if (hud.coins) hud.coins.textContent = coinsCount;
  }

  /* ---------- 主循环 ---------- */
  function tick(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;

    // 场景过渡
    if (trans.phase === 1) {
      trans.a += dt * 4;
      if (trans.a >= 1) { trans.a = 1; if (trans.cb) { trans.cb(); trans.cb = null; } trans.phase = 2; }
    } else if (trans.phase === 2) {
      trans.a -= dt * 2.4;
      if (trans.a <= 0) { trans.a = 0; trans.phase = 0; }
    }

    // 八向移动（忍者神龟式走位）
    var vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var vy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    hero.moving = !!(vx || vy);
    if (vx) hero.face = vx;
    hero.x = clamp(hero.x + vx * WALK.hero * dt, 26, scene.worldW - 26);
    hero.y = clamp(hero.y + vy * WALK.vert * dt, bandTop(), bandBot());
    if (hero.moving) hero.walkPhase += dt * 1.7;

    // 相机双向平滑跟随（修复左移消失/右移卡死）
    var target = clamp(hero.x - view.w * 0.38, 0, Math.max(0, scene.worldW - view.w));
    camera.x += (target - camera.x) * Math.min(1, dt * 6);
    if (Math.abs(target - camera.x) < 0.5) camera.x = target;

    // 僵尸 AI：追击（含纵深），贴身切换攻击动画
    for (var i = zombies.length - 1; i >= 0; i--) {
      var z = zombies[i];
      if (z.dead) { z.deadT += dt; if (z.deadT > 1.2) zombies.splice(i, 1); continue; }
      var dx = hero.x - z.x, dy = hero.y - z.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      z.close = d < 46;
      if (z.close) {
        z.atkT += dt * 8;
      } else {
        z.x += dx / d * z.speed * dt;
        z.y += dy / d * z.speed * dt * 0.65;
        z.y = clamp(z.y, bandTop(), bandBot());
        z.phase += dt * 7;
      }
      if (z.hurtT > 0) z.hurtT -= dt;
      if (z.x < camera.x - 280) zombies.splice(i, 1);
    }
    if (!scene.indoor) {
      var ahead = zombies.filter(function (z2) { return !z2.dead && z2.x > camera.x + view.w - 60; }).length;
      var onScr = zombies.filter(function (z2) { return !z2.dead; }).length;
      if (onScr < 4 && ahead < 2 && Math.random() < dt * 0.9) spawnZombie(['A', 'A', 'B', 'C'][Math.floor(Math.random() * 4)]);
    }

    // 门口检测
    nearDoor = null;
    for (var k = 0; k < scene.doors.length; k++) {
      var dd = scene.doors[k];
      if (Math.abs(hero.x - dd.x) < (dd.w || 56) / 2 + 22 && hero.y < bandTop() + 64) { nearDoor = dd; break; }
    }
    var eb = document.getElementById('enterBtn');
    if (eb) {
      var want = nearDoor && trans.phase === 0;
      eb.style.display = want ? 'flex' : 'none';
      if (want) eb.textContent = '🚪 ' + nearDoor.label;
    }

    // ---- 渲染 ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (scene.indoor) drawStoreBg(camera.x); else drawStreetBg(camera.x);
    drawBarricades();
    for (var m = 0; m < scene.doors.length; m++) drawDoor(scene.doors[m]);
    var list = zombies.slice();
    list.push({ isHero: true, y: hero.y });
    list.sort(function (a, b) { return a.y - b.y; });          // 纵深排序：脚底靠下者后画（遮挡在上者）
    for (var j = 0; j < list.length; j++) {
      if (list[j].isHero) drawHero(hero); else drawZombie(list[j]);
    }

    // 过渡黑幕
    if (trans.a > 0) {
      ctx.fillStyle = 'rgba(8,6,12,' + trans.a + ')';
      ctx.fillRect(0, 0, view.w, view.h);
    }

    updateHud();
    rafId = requestAnimationFrame(tick);
  }

  /* ---------- 输入 ---------- */
  function bindHold(el, key) {
    function on(e) { e.preventDefault(); keys[key] = true; el.classList.add('on'); }
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
    document.getElementById('btnVoice').addEventListener('click', function () {
      showToast('🎤 语音喊词 M2 开放——现在先练走位！');
    });
    document.getElementById('btnRune').addEventListener('click', function () {
      showToast('✍️ 画符施法 M3 开放——敬请期待！');
    });
    document.getElementById('homeBtn').addEventListener('click', function () {
      showToast('🏠 安全屋 M4 开放（和现有小游戏金币互通）');
    });
    document.getElementById('enterBtn').addEventListener('click', function () {
      if (!nearDoor || trans.phase !== 0) return;
      var d = nearDoor;
      startTransition(function () { enterScene(d.to, d.backX); });
    });
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

    // 开场两只在门口附近给玩家看
    setTimeout(function () {
      if (!running) return;
      spawnZombie('A'); zombies[zombies.length - 1].x = 620;
      spawnZombie('B'); zombies[zombies.length - 1].x = 760;
    }, 500);

    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  document.addEventListener('DOMContentLoaded', function () {
    var tip = document.getElementById('loadingTip');
    if (tip) tip.textContent = '加载素材...';
    A.load(function (done, total) {
      if (tip) tip.textContent = '加载素材 ' + done + '/' + total;
    }).then(function () {
      if (tip) tip.textContent = '';
      start();
    });
  });

  ZCITY.Game = { start: start };
  /* 测试钩子 */
  ZCITY.Debug = {
    get hero() { return hero; },
    get zombies() { return zombies; },
    get camera() { return camera; },
    get scene() { return scene; },
    get nearDoor() { return nearDoor; },
    view: function () { return view; },
    spawn: function (type) { spawnZombie(type || 'A'); return zombies[zombies.length - 1]; },
    toast: showToast,
    go: function (id, backX) { enterScene(id, backX); }
  };
})();
