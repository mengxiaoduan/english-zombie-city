/* 丧尸英语城 - M0 战斗引擎骨架
 * 游戏循环 / 主角 / 僵尸游走 / 相机 / 程序化城市兜底渲染
 * 素材缺失时自动用色块剪影兜底，保证任何情况下页面可玩可看
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var A = ZCITY.Assets;

  /* ---------- 世界参数 ---------- */
  var GROUND_FRAC = 0.82;          // 地面线在画布高度的比例
  var WORLD = { startX: 0, endX: 4000 };   // 本关世界长度（M1 波次制后重定义）
  var HERO = { speed: 220 };       // px/s（世界坐标）
  var ZOMBIE_WALK_SPEED = 42;

  var canvas, ctx, dpr = 1;
  var view = { w: 0, h: 0, groundY: 0 };
  var hero, zombies, coins, camera;
  var keys = { left: false, right: false };
  var running = false, lastT = 0, rafId = 0;
  var hud = {};                    // HUD DOM 元素引用
  var coinsCount = 0;

  /* ---------- 画布尺寸 ---------- */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    view.w = w; view.h = h;
    view.groundY = Math.round(h * GROUND_FRAC);
    ctx.imageSmoothingEnabled = false;                       // 像素风：关闭平滑
  }

  /* ---------- 实体 ---------- */
  function makeHero() {
    return { x: 120, y: 0, vx: 0, face: 1, walkPhase: 0, hp: 100, hpMax: 100 };
  }
  function spawnZombie(type) {
    var e = A.get('zombie.' + type + '_walk');
    var h = 96 + Math.random() * 18;             // 显示高度（脚底起）
    zombies.push({
      type: type,
      x: camera.x + view.w + 60 + Math.random() * 240,
      dispH: h,
      speed: ZOMBIE_WALK_SPEED * (type === 'B' ? 1.7 : type === 'C' ? 0.75 : 1),
      phase: Math.random() * 10,
      hurtT: 0,
      dead: false, deadT: 0
    });
  }

  /* ---------- 城市背景：Warped City 三层视差（缺失时程序化兜底） ---------- */
  var BG_LAYERS = [
    { key: 'bg.skyline',   parallax: 0.15, scale: 2.3 },
    { key: 'bg.buildings', parallax: 0.42, scale: 2.9 },
    { key: 'bg.near',      parallax: 0.8,  scale: 2.3 }
  ];
  function drawBackground(camX) {
    // 天空渐变（末世昏黄）
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
      var y = view.groundY - th;
      for (var x = -off; x < view.w; x += tw) ctx.drawImage(e.img, x, y, tw, th);
      drew++;
    }
    if (!drew) drawBuildings(camX * 0.2, view.groundY * 0.55, 90, '#241d2b', 0.5);

    // 街道
    ctx.fillStyle = '#2a2438';
    ctx.fillRect(0, view.groundY, view.w, view.h - view.groundY);
    ctx.fillStyle = '#4a4060';
    ctx.fillRect(0, view.groundY, view.w, 4);
    var dashY = view.groundY + (view.h - view.groundY) * 0.55;
    ctx.fillStyle = 'rgba(240,120,160,0.4)';
    var dashOff = -(camX % 90);
    for (var dx = dashOff; dx < view.w; dx += 90) ctx.fillRect(dx, dashY, 44, 3);
  }
  function drawBuildings(off, baseH, maxH, color, litChance) {
    ctx.fillStyle = color;
    var unit = 76, i = Math.floor(off / unit) - 1;
    var x0 = i * unit - off;
    for (var k = 0; k < Math.ceil(view.w / unit) + 2; k++) {
      var seed = Math.abs((i + k) * 2654435761 % 997) / 997;      // 伪随机但稳定
      var bw = unit * (0.55 + seed * 0.35);
      var bh = baseH * (0.45 + seed * 0.75) + (seed > 0.8 ? maxH * 0.4 : 0);
      var bx = x0 + k * unit + (unit - bw) * seed * 0.5;
      var by = view.groundY - bh;
      ctx.fillRect(bx, by, bw, bh);
      // 楼顶水塔/天线剪影
      if (seed > 0.6) ctx.fillRect(bx + bw * 0.3, by - 10 - seed * 12, 3, 10 + seed * 12);
      // 零星亮窗
      if (litChance > 0) {
        ctx.fillStyle = 'rgba(255,200,80,' + litChance + ')';
        for (var wy = by + 10; wy < view.groundY - 14; wy += 18) {
          for (var wx = bx + 6; wx < bx + bw - 8; wx += 14) {
            if ((wx * 7 + wy * 13 + i) % 17 === 0) ctx.fillRect(wx, wy, 5, 7);
          }
        }
        ctx.fillStyle = color;
      }
    }
  }

  /* ---------- 主角（程序化剪影，Warped City hero 登记后自动换 sprite） ---------- */
  function drawHero(h) {
    var e = A.get('hero.run');
    if (e && e.ok) {
      var moving = Math.abs(h.vx) > 10;
      var idx = moving ? Math.floor(h.walkPhase) : 0;
      A.drawFrame(ctx, moving ? e : (A.get('hero.idle') || e), idx, h.x - camera.x, view.groundY, 110, h.face);
      return;
    }
    // 兜底：像素风小人（填充剪影，跑动摆臂）
    var x = h.x - camera.x, y = view.groundY;
    var moving = Math.abs(h.vx) > 10;
    var swing = Math.sin(h.walkPhase * Math.PI * 2) * (moving ? 1 : 0.12);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(h.face, 1);
    ctx.fillStyle = '#3a6ea8';                                 // 裤子
    ctx.fillRect(-9 + 7 * swing, -22, 8, 22);
    ctx.fillRect(1 - 7 * swing, -22, 8, 22);
    ctx.fillStyle = '#e2574c';                                 // 上衣
    ctx.fillRect(-10, -48, 20, 27);
    ctx.strokeStyle = '#ffd873'; ctx.lineWidth = 5; ctx.lineCap = 'round';   // 手臂
    ctx.beginPath();
    ctx.moveTo(-4, -44); ctx.lineTo(-12 * swing - 4, -32);
    ctx.moveTo(4, -44); ctx.lineTo(12 * swing + 4, -32);
    ctx.stroke();
    ctx.fillStyle = '#ffcf9e';                                 // 头
    ctx.beginPath(); ctx.arc(0, -56, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#2b2333';                                 // 头发
    ctx.fillRect(-9, -66, 18, 7);
    ctx.restore();
  }

  /* ---------- 僵尸 ---------- */
  function drawZombie(z) {
    var x = z.x - camera.x;
    if (x < -160 || x > view.w + 160) return;
    var e = A.get('zombie.' + z.type + (z.dead ? '_walk' : '_walk'));
    var idx = z.dead ? 0 : Math.floor(z.phase);
    var ok = A.drawFrame(ctx, e, idx, x, view.groundY, z.dispH, 1);
    if (!ok) {                                                // 兜底：绿剪影
      ctx.fillStyle = '#5c8a4a';
      ctx.fillRect(x - 12, view.groundY - z.dispH * 0.75, 24, z.dispH * 0.75);
      ctx.beginPath(); ctx.arc(x, view.groundY - z.dispH * 0.8, 11, 0, Math.PI * 2); ctx.fill();
    }
    if (z.hurtT > 0) {                                        // 受击红闪
      ctx.save(); ctx.globalAlpha = Math.min(0.6, z.hurtT * 2);
      ctx.fillStyle = '#ff5544';
      ctx.fillRect(x - 20, view.groundY - z.dispH, 40, z.dispH);
      ctx.restore();
    }
    // 弱点字（M2 接判定，M0 先展示）——符牌样式：米黄纸底+朱砂字，醒目
    if (!z.dead && z.spell) {
      var bob = Math.sin(z.phase * 0.6) * 3;
      var bw = 34, bx = x - bw / 2, by = view.groundY - z.dispH - 40 + bob;
      ctx.save();
      ctx.fillStyle = '#f5e6c8';                               // 符纸
      ctx.strokeStyle = '#8a5a2a'; ctx.lineWidth = 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(bx, by, bw, 32, 6); else ctx.rect(bx, by, bw, 32);
      ctx.fill(); ctx.stroke();
      ctx.font = 'bold 22px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#c03028';                               // 朱砂红字
      ctx.fillText(z.spell, x, by + 17);
      ctx.restore();
    }
  }

  /* ---------- HUD ---------- */
  function updateHud() {
    if (hud.hp) hud.hp.style.width = Math.max(0, hero.hp / hero.hpMax * 100) + '%';
    if (hud.coins) hud.coins.textContent = '🪙'.replace('🪙', '') + coinsCount;   // Win10 无 🪙，直接数字
  }

  /* ---------- 主循环 ---------- */
  function tick(t) {
    if (!running) return;
    var dt = Math.min(0.05, (t - lastT) / 1000 || 0);
    lastT = t;

    // 主角移动
    var vx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    hero.vx = vx * HERO.speed;
    if (vx !== 0) { hero.face = vx; hero.walkPhase += dt * 1.6; }
    hero.x = Math.max(WORLD.startX + 20, Math.min(WORLD.endX - 20, hero.x + hero.vx * dt));

    // 相机跟随（主角保持在屏 38% 处，不回卷过左边界）
    var targetCam = hero.x - view.w * 0.38;
    camera.x = Math.max(WORLD.startX, Math.min(WORLD.endX - view.w, Math.max(camera.x, targetCam)));

    // 僵尸
    var alive = 0;
    for (var i = zombies.length - 1; i >= 0; i--) {
      var z = zombies[i];
      if (z.dead) { z.deadT += dt; if (z.deadT > 1.2) zombies.splice(i, 1); continue; }
      z.x -= z.speed * dt;
      z.phase += dt * 7;
      if (z.hurtT > 0) z.hurtT -= dt;
      if (z.x > camera.x - 200) alive++;
      if (z.x < camera.x - 260) zombies.splice(i, 1);          // 走丢的清理
    }
    // 稀疏补给：屏外右侧保持 2~4 只
    if (alive < 4 && Math.random() < dt * 0.8) spawnZombie(['A', 'A', 'B', 'C'][Math.floor(Math.random() * 4)]);

    // ---- 渲染 ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawBackground(camera.x);
    var list = zombies.slice().sort(function (a, b) { return a.dispH - b.dispH; });
    for (var j = 0; j < list.length; j++) drawZombie(list[j]);
    drawHero(hero);

    updateHud();
    rafId = requestAnimationFrame(tick);
  }

  /* ---------- 输入：◀ ▶ 长按走动 ---------- */
  function bindHold(el, key) {
    function on(e) { e.preventDefault(); keys[key] = true; el.classList.add('on'); }
    function off(e) { if (e) e.preventDefault(); keys[key] = false; el.classList.remove('on'); }
    el.addEventListener('pointerdown', on);
    el.addEventListener('pointerup', off);
    el.addEventListener('pointerleave', off);
    el.addEventListener('pointercancel', off);
  }

  /* ---------- 启动 ---------- */
  function start() {
    canvas = document.getElementById('gameCanvas');
    ctx = canvas.getContext('2d');
    hud.hp = document.getElementById('hpFill');
    hud.coins = document.getElementById('coinNum');
    resize();
    window.addEventListener('resize', resize);

    hero = makeHero();
    zombies = []; coins = [];
    camera = { x: WORLD.startX };

    bindHold(document.getElementById('btnL'), 'left');
    bindHold(document.getElementById('btnR'), 'right');

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { running = false; cancelAnimationFrame(rafId); }
      else if (!running) { running = true; lastT = performance.now(); rafId = requestAnimationFrame(tick); }
    });

    // M0：先造 2 只在屏内给玩家看
    setTimeout(function () {
      ['A', 'B'].forEach(function (tp) {
        spawnZombie(tp);
        zombies[zombies.length - 1].x = camera.x + view.w * (0.6 + Math.random() * 0.3);
        zombies[zombies.length - 1].spell = ['火', '冰'][Math.floor(Math.random() * 2)];
      });
    }, 600);

    running = true;
    lastT = performance.now();
    rafId = requestAnimationFrame(tick);
  }

  document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('loadingTip').textContent = '加载素材...';
    A.load(function (done, total) {
      document.getElementById('loadingTip').textContent = '加载素材 ' + done + '/' + total;
    }).then(function () {
      document.getElementById('loadingTip').textContent = '';
      start();
    });
  });

  ZCITY.Game = { start: start };
  /* 测试钩子：控制台/自动化测试直接读写内部状态 */
  ZCITY.Debug = {
    get hero() { return hero; },
    get zombies() { return zombies; },
    get camera() { return camera; },
    view: function () { return view; },
    spawn: function (type) { spawnZombie(type || 'A'); return zombies[zombies.length - 1]; }
  };
})();
