/* ============================================================
 * 世界语言方块 · 单词语义特效引擎 v1 (word_fx.js)
 * ------------------------------------------------------------
 * 数据源：word_fx_data.js（由 word_fx_特效设计表.csv 编译生成）
 * 设计：拼出具体词 → 词义专属特效
 *   - scene 类（风/雪/雨/雾/火/雷/夜/爱/魔法…）：全幕布场景粒子 + 色调 + 网格边框辉光
 *   - swarm 类（猫/狗/鱼/冰箱…）：大量该词 emoji 从消掉的格子起飞、扑向怪物，怪物受击扣血
 *   - burst 类（兜底）：金色星屑爆发 + 怪物受击，保证任何词都有反馈
 * 音效：WebAudio 合成（呼啸/爆炸/闪光/雨声…）+ 预生成拟声词 wav（汪汪汪/喵/哞…）
 * 性能：单画布 + 单 rAF 循环（无粒子时零开销）、粒子上限、DPR≤2、页面隐藏自动暂停
 * ============================================================ */
(function () {
    'use strict';
    if (window.WORD_FX) return;

    /* ================= 样式注入 ================= */
    var CSS = ''
        + '@keyframes wfxHit { 0%{transform:translate(0,0) rotate(0);} 18%{transform:translate(-7px,3px) rotate(-9deg);} 38%{transform:translate(6px,-2px) rotate(8deg);} 58%{transform:translate(-5px,2px) rotate(-6deg);} 78%{transform:translate(4px,-1px) rotate(4deg);} 100%{transform:none;} }'
        + '.wfx-monster-hit { animation: wfxHit .55s ease !important; filter: hue-rotate(-25deg) saturate(2.2) brightness(1.35) !important; }'
        + '@keyframes wfxDmg { 0%{ transform: translateY(0) scale(.5); opacity:0;} 18%{ transform: translateY(-12px) scale(1.2); opacity:1;} 100%{ transform: translateY(-52px) scale(1); opacity:0;} }'
        + '.wfx-dmg { position:fixed; z-index:5300; font-weight:900; font-size:1.7rem; color:#ff5252; text-shadow:0 2px 6px rgba(0,0,0,.65); pointer-events:none; animation:wfxDmg 1.05s ease-out forwards; font-family:inherit; }'
        + '.wfx-dmg.dmg-crit { color:#ffd04c; font-size:2.1rem; }'
        + '@keyframes wfxHpFlash { 0%,100%{ color:#ff6b6b; } 50%{ color:#fff; text-shadow:0 0 12px #ff3030; } }'
        + '.wfx-hp-flash { animation: wfxHpFlash .5s ease 2 !important; }'
        + '@keyframes wfxGridGlow { 0%,100% { box-shadow: 0 0 0 rgba(0,0,0,0); } 25% { box-shadow: 0 0 52px 6px var(--wfx-glow,rgba(255,160,60,.95)), inset 0 0 26px var(--wfx-glow,rgba(255,160,60,.5)); } 60% { box-shadow: 0 0 30px 2px var(--wfx-glow,rgba(255,160,60,.85)), inset 0 0 16px var(--wfx-glow,rgba(255,160,60,.35)); } }'
        + '.wfx-scene-glow { animation: wfxGridGlow 2.1s ease; }'
        + '.wfx-hero-gain { animation: wfxHeroGain .55s ease !important; }'
        + '@keyframes wfxHeroGain { 0%{transform:scale(1)} 45%{transform:scale(1.45) translateY(-6px); filter:brightness(1.65) drop-shadow(0 0 12px rgba(255,215,0,.95));} 100%{transform:scale(1)} }';
    var styleEl = document.createElement('style');
    styleEl.textContent = CSS;
    document.head.appendChild(styleEl);

    /* ================= 画布层 ================= */
    var canvas = null, ctx = null, particles = [], rafId = 0, running = false, dpr = 1;
    var gen = 0;   /* 会话代数号：stopAll 递增，使所有挂起的延迟回调（粒子启动器/场景interval）失效 */
    var MAX_PARTICLES = ((navigator.deviceMemory && navigator.deviceMemory <= 4) || (window.innerWidth * window.innerHeight > 2200000 && (window.devicePixelRatio || 1) >= 2)) ? 140 : 260;   /* 低端/高分小屏自适应降粒子 */

    function ensureCanvas() {
        if (canvas && canvas.isConnected) return;
        canvas = document.createElement('canvas');
        canvas.id = 'wfx-canvas';
        canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:4700;pointer-events:none;';
        document.body.appendChild(canvas);
        ctx = canvas.getContext('2d');
        resize();
        window.addEventListener('resize', resize);
    }
    function resize() {
        if (!canvas) return;
        dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(window.innerWidth * dpr);
        canvas.height = Math.round(window.innerHeight * dpr);
        if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function spawn(p) {
        if (particles.length >= MAX_PARTICLES) particles.shift();
        particles.push(p);
    }
    function startLoop(durationMs) {
        ensureCanvas();
        if (running) return;
        running = true;
        var stopAt = Date.now() + (durationMs || 2400) + 600;
        var last = Date.now();
        function frame() {
            if (!running) return;
            var now = Date.now();
            var dt = Math.min(48, now - last) / 1000;
            last = now;
            ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
            var tints = sceneTints;   // 本轮场景色调
            for (var i = 0; i < tints.length; i++) drawTint(tints[i]);
            for (var j = particles.length - 1; j >= 0; j--) {
                var p = particles[j];
                p.life -= dt;
                if (p.life <= 0 || p.dead) { particles.splice(j, 1); continue; }
                /* 单粒子异常不得中断 rAF 链——一旦抛错最后一帧会永久冻结成"残留/灰遮罩" */
                try {
                    if (p.update) p.update(p, dt, now / 1000);
                } catch (e) { p.dead = true; }
                if (p.dead) { particles.splice(j, 1); continue; }
                try {
                    if (p.draw) p.draw(p, ctx);
                } catch (e) { p.dead = true; }
            }
            if (Date.now() > stopAt && particles.length === 0) {
                running = false; sceneTints = [];
                ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
                return;
            }
            rafId = requestAnimationFrame(frame);
        }
        rafId = requestAnimationFrame(frame);
    }
    function stopAll() {
        gen++;   /* 旧会话的 setTimeout/setInterval 回调检测到代数变化即静默退出，防止画布复活 */
        running = false;
        if (rafId) cancelAnimationFrame(rafId);
        particles = []; sceneTints = [];
        if (ctx) ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    document.addEventListener('visibilitychange', function () { if (document.hidden) stopAll(); });

    /* ================= 场景色调 ================= */
    var sceneTints = [];
    function drawTint(t) {
        var g = ctx.createLinearGradient(0, t.fromTop ? 0 : window.innerHeight, 0, t.fromTop ? window.innerHeight : 0);
        g.addColorStop(0, t.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }

    /* ================= 工具 ================= */
    function rnd(a, b) { return a + Math.random() * (b - a); }
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    /* 注意：不可加 font-weight —— 彩色 emoji 字体没有字重变体，
       部分安卓内核(X5等)匹配失败会退化成单色符号字体，特效变成黑影 */
    function emojiFont(size) { return size + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","EmojiOne Color","Twemoji",sans-serif'; }
    function drawEmoji(p, ctx2) {
        ctx2.save();
        ctx2.globalAlpha = Math.max(0, Math.min(1, p.alpha == null ? 1 : p.alpha));
        ctx2.translate(p.x, p.y);
        if (p.rot) ctx2.rotate(p.rot);
        if (p.scale) ctx2.scale(p.scale, p.scale);
        ctx2.font = emojiFont(p.size || 26);
        ctx2.textAlign = 'center';
        ctx2.textBaseline = 'middle';
        ctx2.fillText(p.emoji, 0, 0);
        ctx2.restore();
    }
    function drawDot(p, ctx2) {
        ctx2.save();
        ctx2.globalAlpha = Math.max(0, Math.min(1, p.alpha == null ? 1 : p.alpha));
        ctx2.fillStyle = p.color;
        ctx2.beginPath();
        ctx2.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx2.fill();
        ctx2.restore();
    }
    function gridRect() {
        try {
            var g = document.getElementById('m3-grid-container');
            if (g) { var r = g.getBoundingClientRect(); if (r.width > 0) return r; }
        } catch (e) {}
        return null;
    }
    function rectOfCells(cells) {
        // 求若干格子元素的包围盒中心；失败则退回网格中心
        var cx = 0, cy = 0, n = 0;
        try {
            var grid = document.getElementById('m3-grid-container');
            if (cells && cells.length) {
                for (var i = 0; i < cells.length; i++) {
                    var el = (window.__m3CellEls && window.__m3CellEls(cells[i].r, cells[i].c)) || null;
                    if (!el) continue;
                    var r = el.getBoundingClientRect();
                    if (r.width === 0) continue;
                    cx += r.left + r.width / 2; cy += r.top + r.height / 2; n++;
                }
            }
            if (!n && grid) {
                var g = grid.getBoundingClientRect();
                cx = g.left + g.width / 2; cy = g.top + g.height / 2; n = 1;
            }
        } catch (e) {}
        if (!n) { cx = window.innerWidth / 2; cy = window.innerHeight / 2.6; n = 1; }
        return { x: cx / n, y: cy / n };
    }

    /* ================= 词义图片库（fx_img/<key>.svg，Twemoji CC-BY 4.0） ================= */
    var imgCache = {};   // key -> HTMLImageElement(已加载) | null(加载中/失败)
    var imgMissing = {}; // 无图片的 key
    function keyImgUrl(key) { return 'fx_img/' + key + '.svg'; }
    function loadKeyImg(key) {
        if (imgCache[key] !== undefined || imgMissing[key]) return imgCache[key] || null;
        var D = window.WORD_FX_DATA || {};
        if (!D.IMG || !D.IMG[key]) { imgMissing[key] = 1; return null; }
        imgCache[key] = null;   // 加载中
        var im = new Image();
        im.onload = function () { imgCache[key] = im; };
        im.onerror = function () { imgCache[key] = null; imgMissing[key] = 1; };
        im.src = keyImgUrl(key);
        return null;
    }
    function drawKeyImgOrEmoji(p, ctx2) {
        if (p.imgUrl && p.imgEl) {   /* 自定义词图（用户上传，含gif首帧） */
            if (!p.imgEl.complete || !p.imgEl.naturalWidth) { drawEmoji(p, ctx2); return; }
            ctx2.save();
            ctx2.globalAlpha = Math.max(0, Math.min(1, p.alpha == null ? 1 : p.alpha));
            ctx2.translate(p.x, p.y);
            if (p.rot) ctx2.rotate(p.rot);
            var ss = p.size * 1.35;
            ctx2.drawImage(p.imgEl, -ss / 2, -ss / 2, ss, ss);
            ctx2.restore();
            return;
        }
        var im = imgCache[p.fxKey];
        if (im) {
            ctx2.save();
            ctx2.globalAlpha = Math.max(0, Math.min(1, p.alpha == null ? 1 : p.alpha));
            ctx2.translate(p.x, p.y);
            if (p.rot) ctx2.rotate(p.rot);
            var s = p.size * 1.35;
            ctx2.drawImage(im, -s / 2, -s / 2, s, s);
            ctx2.restore();
        } else {
            if (!p.emoji) p.emoji = '⭐';
            drawEmoji(p, ctx2);
        }
    }

    /* ================= 音效：WebAudio 合成 + 拟声词 wav ================= */
    var audioCtx = null;
    function ac() {
        if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
        if (audioCtx && audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
        return audioCtx;
    }
    var noiseBuf = null;
    function getNoise(context) {
        if (noiseBuf) return noiseBuf;
        var len = context.sampleRate * 1.5;
        noiseBuf = context.createBuffer(1, len, context.sampleRate);
        var d = noiseBuf.getChannelData(0);
        for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        return noiseBuf;
    }
    var SYNTH = {
        whoosh: function () { var c = ac(); if (!c) return; var s = c.createBufferSource(); s.buffer = getNoise(c); var f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2; f.frequency.setValueAtTime(220, c.currentTime); f.frequency.exponentialRampToValueAtTime(2400, c.currentTime + 0.45); var g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.16, c.currentTime + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.55); s.connect(f); f.connect(g); g.connect(c.destination); s.start(); s.stop(c.currentTime + 0.6); },
        boom: function () { var c = ac(); if (!c) return; var o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(110, c.currentTime); o.frequency.exponentialRampToValueAtTime(34, c.currentTime + 0.42); var g = c.createGain(); g.gain.setValueAtTime(0.28, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.5); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.52); var s = c.createBufferSource(); s.buffer = getNoise(c); var f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 700; var g2 = c.createGain(); g2.gain.setValueAtTime(0.2, c.currentTime); g2.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.32); s.connect(f); f.connect(g2); g2.connect(c.destination); s.start(); s.stop(c.currentTime + 0.34); },
        sparkle: function () { var c = ac(); if (!c) return; [1318, 1568, 2093, 2637].forEach(function (fq, i) { var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fq; var g = c.createGain(); var t0 = c.currentTime + i * 0.07; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22); o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.24); }); },
        shimmer: function () { var c = ac(); if (!c) return; [1046, 1318, 1568].forEach(function (fq, i) { var o = c.createOscillator(); o.type = 'sine'; o.frequency.value = fq; o.detune.value = i * 6; var g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.07, c.currentTime + 0.25); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.25); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 1.3); }); },
        rain: function () { var c = ac(); if (!c) return; var s = c.createBufferSource(); s.buffer = getNoise(c); s.loop = true; var f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1400; var g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime); g.gain.exponentialRampToValueAtTime(0.11, c.currentTime + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 1.5); s.connect(f); f.connect(g); g.connect(c.destination); s.start(); s.stop(c.currentTime + 1.55); },
        zap: function () { var c = ac(); if (!c) return; var o = c.createOscillator(); o.type = 'square'; o.frequency.setValueAtTime(900, c.currentTime); o.frequency.exponentialRampToValueAtTime(120, c.currentTime + 0.16); var g = c.createGain(); g.gain.setValueAtTime(0.1, c.currentTime); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.18); o.connect(g); g.connect(c.destination); o.start(); o.stop(c.currentTime + 0.2); },
        chime: function () { var c = ac(); if (!c) return; [880, 1174].forEach(function (fq, i) { var o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = fq; var g = c.createGain(); var t0 = c.currentTime + i * 0.12; g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5); o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + 0.52); }); },
        drum: function () { var c = ac(); if (!c) return; [0, 0.16].forEach(function (off) { var o = c.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(160, c.currentTime + off); o.frequency.exponentialRampToValueAtTime(70, c.currentTime + off + 0.12); var g = c.createGain(); g.gain.setValueAtTime(0.0001, c.currentTime + off); g.gain.exponentialRampToValueAtTime(0.2, c.currentTime + off + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + off + 0.14); o.connect(g); g.connect(c.destination); o.start(c.currentTime + off); o.stop(c.currentTime + off + 0.16); }); },
        water: function () { SYNTH.rain(); }
    };
    var ANIMAL_SOUNDS = ['bark', 'meow', 'moo', 'baa', 'quack', 'oink', 'roar', 'cluck', 'chirp', 'ribbit', 'buzz', 'hiss', 'howl'];
    var failedWav = {};
    function playSound(name, lang) {
        if (!name) return;
        if (ANIMAL_SOUNDS.indexOf(name) >= 0) {
            var l = (lang === 'zh') ? 'zh' : 'en';
            var tryWav = function (suffix) {
                var url = 'sounds/fx/' + name + '_' + suffix + '.wav';
                if (failedWav[url]) return false;
                var a = new Audio(url);
                a.volume = 0.9;
                var bad = function () { failedWav[url] = true; };
                a.onerror = bad;
                var p = a.play(); if (p && p.catch) p.catch(bad);
                return true;
            };
            if (tryWav(l)) return;
            if (tryWav(l === 'zh' ? 'en' : 'zh')) return;
            SYNTH.boom();
            return;
        }
        if (SYNTH[name]) { try { SYNTH[name](); } catch (e) {} }
    }

    /* ================= 怪物受击 ================= */
    /* 知识收获：飞达对象（主角/得分手）金光弹跳 */
    function heroGain(el) {
        try {
            if (!el) return;
            el.classList.remove('wfx-hero-gain');
            void el.offsetWidth;
            el.classList.add('wfx-hero-gain');
            setTimeout(function () { el.classList.remove('wfx-hero-gain'); }, 650);
        } catch (e) {}
    }
    function monsterHit(monsterEl, damage, opts) {
        opts = opts || {};
        try {
            if (monsterEl) {
                monsterEl.classList.remove('wfx-monster-hit');
                void monsterEl.offsetWidth;
                monsterEl.classList.add('wfx-monster-hit');
                setTimeout(function () { monsterEl.classList.remove('wfx-monster-hit'); }, 600);
                var r = monsterEl.getBoundingClientRect();
                if (damage) {
                    var d = document.createElement('div');
                    d.className = 'wfx-dmg' + (damage >= 80 ? ' dmg-crit' : '');
                    d.textContent = '-' + damage;
                    d.style.left = (r.left + r.width / 2 + rnd(-8, 8)) + 'px';
                    d.style.top = (r.top - 6) + 'px';
                    document.body.appendChild(d);
                    setTimeout(function () { d.remove(); }, 1200);
                }
            }
            var hp = document.getElementById('m3-pk-monster');
            if (hp) {
                hp.classList.remove('wfx-hp-flash');
                void hp.offsetWidth;
                hp.classList.add('wfx-hp-flash');
                setTimeout(function () { hp.classList.remove('wfx-hp-flash'); }, 1100);
            }
        } catch (e) {}
    }

    /* ================= 场景渲染器 ================= */
    var SCENES = {
        fire: {
            dur: 2300, glow: 'rgba(255,140,40,.9)', tint: { color: 'rgba(255,110,20,.22)', fromTop: false },
            emit: function (W, H) {
                var gr = gridRect();
                var bx0 = gr ? gr.left : W * 0.04, bx1 = gr ? gr.right : W * 0.96;
                var by = gr ? gr.bottom : H + 10;
                var top = gr ? gr.top : H * 0.2;
                for (var i = 0; i < 9; i++) {
                    var x = rnd(bx0, bx1), hot = Math.random() < 0.3;
                    var rise = rnd(120, Math.max(160, (by - top) * 1.15));
                    spawn({ kind: 'dot', x: x, y: by + rnd(0, 14), size: rnd(2.2, hot ? 8 : 5), color: hot ? '#ffd166' : pick(['#ff6b35', '#ff8c42', '#e94560', '#ffb347']), vx: rnd(-14, 14), vy: -rise, life: rnd(0.7, 1.5), alpha: 1,
                        update: function (p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy *= (1 - 0.45 * dt); p.x += Math.sin(p.y * 0.06) * 26 * dt; p.alpha = Math.min(1, p.life * 1.5); },
                        draw: drawDot });
                }
                // 网格底边火苗条
                if (gr && Math.random() < 0.7) {
                    spawn({ kind: 'flame', x: rnd(bx0, bx1), y: by + 4, emoji: '🔥', size: rnd(12, 22), vy: rnd(-90, -50), life: rnd(0.5, 0.9), alpha: 1, rot: 0,
                        update: function (p, dt) { p.y += p.vy * dt; p.rot += 2 * dt; p.alpha = Math.min(1, p.life * 1.8); },
                        draw: drawEmoji });
                }
            }
        },
        rain: {
            dur: 2300, glow: 'rgba(90,160,255,.8)', tint: { color: 'rgba(40,70,140,.20)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 10; i++) {
                    var x = rnd(-40, W), len = rnd(10, 22), sp = rnd(620, 900);
                    spawn({ kind: 'rain', x: x, y: rnd(-H, 0), len: len, sp: sp, life: rnd(0.5, 0.9), alpha: rnd(0.25, 0.55), color: '#9ecbff',
                        update: function (p, dt) { p.y += p.sp * dt; p.x += p.sp * 0.12 * dt; },
                        draw: function (p, c) { c.save(); c.globalAlpha = p.alpha; c.strokeStyle = p.color; c.lineWidth = 1.6; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.len * 0.12, p.y - p.len); c.stroke(); c.restore(); } });
                }
            }
        },
        snow: {
            dur: 2600, glow: 'rgba(180,220,255,.85)', tint: { color: 'rgba(210,230,255,.14)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 6; i++) {
                    var x = rnd(0, W);
                    spawn({ kind: 'snow', x: x, y: rnd(-30, 0), size: rnd(1.6, 4.2), sp: rnd(60, 130), ph: rnd(0, 6.28), life: rnd(1.6, 2.6), alpha: rnd(0.5, 0.95), color: '#ffffff',
                        update: function (p, dt, t) { p.y += p.sp * dt; p.x += Math.sin(t * 1.7 + p.ph) * 26 * dt; },
                        draw: drawDot });
                }
            }
        },
        wind: {
            dur: 2200, glow: 'rgba(140,230,160,.8)', tint: null,
            emit: function (W, H) {
                for (var i = 0; i < 5; i++) {
                    var useLeaf = Math.random() < 0.5;
                    var base = { x: -30, y: rnd(H * 0.1, H * 0.85), sp: rnd(340, 560), ph: rnd(0, 6.28), amp: rnd(16, 44), life: rnd(1.1, 1.9), alpha: rnd(0.5, 0.9), rot: 0 };
                    if (useLeaf) { base.emoji = pick(['🍃', '🌿', '🍂']); base.size = rnd(15, 24); }
                    else { base.color = 'rgba(255,255,255,.5)'; base.size = rnd(1.4, 2.4); base.len = rnd(16, 34); }
                    base.update = function (p, dt, t) { p.x += p.sp * dt; p.y += Math.sin(t * 2.4 + p.ph) * p.amp * dt; p.rot = (p.rot || 0) + 3 * dt; };
                    base.draw = useLeaf ? drawEmoji : function (p, c) { c.save(); c.globalAlpha = p.alpha * 0.6; c.strokeStyle = p.color; c.lineWidth = 1.4; c.beginPath(); c.moveTo(p.x - p.len / 2, p.y); c.lineTo(p.x + p.len / 2, p.y); c.stroke(); c.restore(); };
                    spawn(base);
                }
            }
        },
        fog: {
            dur: 2600, glow: 'rgba(190,200,215,.75)', tint: { color: 'rgba(150,160,175,.22)', fromTop: true },
            emit: function (W, H) {
                if (particles.length < 26) {
                    spawn({ kind: 'fog', x: rnd(0, W), y: rnd(H * 0.15, H * 0.95), size: rnd(60, 150), vx: rnd(8, 26) * (Math.random() < 0.5 ? -1 : 1), life: rnd(1.8, 2.6), alpha: 0, maxA: rnd(0.08, 0.16),
                        update: function (p, dt) { p.x += p.vx * dt; p.alpha = Math.min(p.maxA, p.alpha + 0.25 * dt) * Math.min(1, p.life); },
                        draw: function (p, c) { c.save(); c.globalAlpha = Math.max(0, p.alpha); var g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size); g.addColorStop(0, 'rgba(200,208,220,1)'); g.addColorStop(1, 'rgba(200,208,220,0)'); c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); c.restore(); } });
                }
            }
        },
        storm: {
            dur: 2400, glow: 'rgba(150,120,255,.9)', tint: { color: 'rgba(30,25,70,.30)', fromTop: true },
            start: function (W, H) {
                setTimeout(function () { SYNTH.zap(); }, 500);
                setTimeout(function () { SYNTH.boom(); }, 780);
                // 两道闪电
                [520, 900].forEach(function (delay) {
                    setTimeout(function () {
                        var x0 = rnd(W * 0.2, W * 0.8);
                        var pts = [{ x: x0, y: 0 }];
                        var y = 0;
                        while (y < H * 0.55) { y += rnd(24, 60); pts.push({ x: x0 + rnd(-38, 38), y: y }); }
                        spawn({ kind: 'bolt', pts: pts, life: 0.28, alpha: 1,
                            update: function (p, dt) { p.life -= dt; p.alpha = p.life / 0.28; },
                            draw: function (p, c) { c.save(); c.globalAlpha = Math.max(0, p.alpha); c.strokeStyle = '#e8f0ff'; c.lineWidth = 3; c.shadowColor = '#9db8ff'; c.shadowBlur = 18; c.beginPath(); p.pts.forEach(function (pt, i) { i ? c.lineTo(pt.x, pt.y) : c.moveTo(pt.x, pt.y); }); c.stroke(); c.restore(); } });
                    }, delay);
                });
            },
            emit: function (W, H) { SCENES.rain.emit(W, H); }
        },
        sun: {
            dur: 2400, glow: 'rgba(255,215,80,.9)', tint: { color: 'rgba(255,200,60,.15)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 3; i++) {
                    spawn({ kind: 'sparkle', x: rnd(W * 0.05, W * 0.95), y: rnd(H * 0.3, H), size: rnd(2.5, 5), color: pick(['#ffd04c', '#ffe38a', '#fff3b0']), vy: rnd(-60, -26), life: rnd(0.9, 1.7), alpha: 1, tw: rnd(2, 5),
                        update: function (p, dt, t) { p.y += p.vy * dt; p.alpha = Math.min(1, p.life) * (0.65 + 0.35 * Math.sin(t * p.tw)); },
                        draw: function (p, c) { c.save(); c.globalAlpha = Math.max(0, p.alpha); c.fillStyle = p.color; c.translate(p.x, p.y); c.rotate(Math.PI / 4); c.fillRect(-p.size, -p.size / 3.2, p.size * 2, p.size / 1.6); c.rotate(Math.PI / 2); c.fillRect(-p.size, -p.size / 3.2, p.size * 2, p.size / 1.6); c.restore(); } });
                }
            }
        },
        night: {
            dur: 2600, glow: 'rgba(120,140,255,.8)', tint: { color: 'rgba(12,18,60,.32)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 3; i++) {
                    spawn({ kind: 'star', x: rnd(0, W), y: rnd(0, H * 0.75), size: rnd(1.6, 3.4), color: '#eef2ff', life: rnd(1.4, 2.5), alpha: 0, tw: rnd(1.5, 4), ph: rnd(0, 6.28),
                        update: function (p, dt, t) { p.alpha = Math.max(0, Math.min(1, (0.5 + 0.5 * Math.sin(t * p.tw + p.ph))) * Math.min(1, p.life)); },
                        draw: function (p, c) { c.save(); c.globalAlpha = p.alpha; c.fillStyle = p.color; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); c.restore(); } });
                }
            }
        },
        sea: {
            dur: 2400, glow: 'rgba(60,180,220,.85)', tint: { color: 'rgba(20,110,150,.16)', fromTop: false },
            emit: function (W, H) {
                for (var i = 0; i < 3; i++) {
                    var y0 = rnd(H * 0.35, H * 0.95);
                    spawn({ kind: 'wave', x: -20, y: y0, sp: rnd(180, 320), len: rnd(50, 120), life: rnd(1.2, 2.0), alpha: rnd(0.2, 0.4), color: '#bfeaff',
                        update: function (p, dt, t) { p.x += p.sp * dt; p.y += Math.sin(t * 2 + p.x * 0.02) * 14 * dt; },
                        draw: function (p, c) { c.save(); c.globalAlpha = p.alpha; c.strokeStyle = p.color; c.lineWidth = 2.4; c.beginPath(); for (var xx = 0; xx <= p.len; xx += 8) { var yy = p.y + Math.sin((p.x + xx) * 0.04) * 5; xx ? c.lineTo(p.x + xx, yy) : c.moveTo(p.x + xx, yy); } c.stroke(); c.restore(); } });
                }
                for (var b = 0; b < 2; b++) {
                    spawn({ kind: 'bubble', x: rnd(0, W), y: H + 8, size: rnd(2, 5), sp: rnd(70, 130), life: rnd(1.0, 1.9), alpha: rnd(0.3, 0.6), color: '#d9f6ff',
                        update: function (p, dt, t) { p.y -= p.sp * dt; p.x += Math.sin(t * 3 + p.y * 0.05) * 16 * dt; },
                        draw: function (p, c) { c.save(); c.globalAlpha = p.alpha; c.strokeStyle = p.color; c.lineWidth = 1.4; c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.stroke(); c.restore(); } });
                }
            }
        },
        desert: {
            dur: 2300, glow: 'rgba(230,190,110,.85)', tint: { color: 'rgba(210,170,90,.15)', fromTop: false },
            emit: function (W, H) {
                for (var i = 0; i < 6; i++) {
                    spawn({ kind: 'sand', x: rnd(-20, W), y: rnd(H * 0.45, H), size: rnd(1.2, 2.6), sp: rnd(260, 460), life: rnd(0.7, 1.4), alpha: rnd(0.25, 0.55), color: pick(['#e8c88f', '#d9b26f', '#c9a05e']),
                        update: function (p, dt, t) { p.x += p.sp * dt; p.y += Math.sin(t * 3 + p.x * 0.03) * 20 * dt; },
                        draw: drawDot });
                }
            }
        },
        love: {
            dur: 2500, glow: 'rgba(255,120,170,.85)', tint: { color: 'rgba(255,120,170,.10)', fromTop: false },
            emit: function (W, H) {
                for (var i = 0; i < 2; i++) {
                    spawn({ kind: 'heart', x: rnd(W * 0.05, W * 0.95), y: H + 16, emoji: pick(['💕', '❤️', '💖']), size: rnd(16, 30), sp: rnd(60, 120), ph: rnd(0, 6.28), life: rnd(1.6, 2.5), alpha: 1, rot: rnd(-0.3, 0.3),
                        update: function (p, dt, t) { p.y -= p.sp * dt; p.x += Math.sin(t * 2 + p.ph) * 24 * dt; p.alpha = Math.min(1, p.life * 1.4); },
                        draw: drawEmoji });
                }
            }
        },
        magic: {
            dur: 2500, glow: 'rgba(190,120,255,.9)', tint: { color: 'rgba(140,80,220,.12)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 3; i++) {
                    spawn({ kind: 'magic', emoji: pick(['✨', '⭐', '💫']), x: rnd(W * 0.1, W * 0.9), y: rnd(H * 0.2, H * 0.9), size: rnd(13, 24), a0: rnd(0, 6.28), rad: rnd(20, 70), cx: 0, cy: 0, life: rnd(1.2, 2.2), alpha: 1, rotv: rnd(1.5, 3),
                        init: function (p) { p.cx = p.x; p.cy = p.y; },
                        update: function (p, dt, t) { if (p.init && !p._i) { p.init(p); p._i = 1; } p.a0 += p.rotv * dt; p.x = p.cx + Math.cos(p.a0) * p.rad; p.y = p.cy + Math.sin(p.a0) * p.rad * 0.6; p.alpha = Math.min(1, p.life * 1.3); },
                        draw: drawEmoji });
                }
            }
        },
        autumn: {
            dur: 2500, glow: 'rgba(230,150,60,.85)', tint: { color: 'rgba(220,140,50,.10)', fromTop: true },
            emit: function (W, H) {
                for (var i = 0; i < 2; i++) {
                    spawn({ kind: 'autumn', x: rnd(0, W), y: rnd(-30, 0), emoji: pick(['🍂', '🍁', '🍃']), size: rnd(15, 25), sp: rnd(80, 150), ph: rnd(0, 6.28), life: rnd(1.8, 2.6), alpha: 1, rot: rnd(0, 6.28), rotv: rnd(-2.4, 2.4),
                        update: function (p, dt, t) { p.y += p.sp * dt; p.x += Math.sin(t * 1.8 + p.ph) * 34 * dt; p.rot += p.rotv * dt; },
                        draw: drawEmoji });
                }
            }
        }
    };

    /* ================= 播放入口 ================= */
    function playScene(sceneId, opts) {
        var sc = SCENES[sceneId];
        if (!sc) return;
        opts = opts || {};
        var myGen = gen;
        sceneTints = [];
        if (sc.tint) sceneTints.push(sc.tint);
        ensureCanvas();
        if (sc.glow) {
            try {
                var grid = document.getElementById('m3-grid-container');
                if (grid) {
                    grid.style.setProperty('--wfx-glow', sc.glow);
                    grid.classList.remove('wfx-scene-glow');
                    void grid.offsetWidth;
                    grid.classList.add('wfx-scene-glow');
                    setTimeout(function () { grid.classList.remove('wfx-scene-glow'); }, 2200);
                }
            } catch (e) {}
        }
        if (sc.start) { try { sc.start(window.innerWidth, window.innerHeight); } catch (e) {} }
        var until = Date.now() + (sc.dur || 2400);
        var emitter = function () {
            if (Date.now() < until && !document.hidden) sc.emit(window.innerWidth, window.innerHeight);
        };
        for (var warm = 0; warm < 8; warm++) emitter();   // 预热，避免开场空屏
        startLoop(sc.dur || 2400);
        var iv = setInterval(function () {
            if (gen !== myGen) { clearInterval(iv); return; }
            if (Date.now() >= until || document.hidden) { sceneTints = []; clearInterval(iv); return; }
            emitter();
        }, 55);
        if (sc.tint && sceneTints.length === 0) sceneTints.push(sc.tint);
    }

    function playSwarm(emoji, opts) {
        opts = opts || {};
        var myGen = gen;
        var src = opts.source || { x: window.innerWidth / 2, y: window.innerHeight / 2.6 };
        var mEl = opts.monsterEl || document.getElementById('m3-mouth');   // 粒子飞向的目标（知识归谁）
        var hitEl = opts.hitEl || mEl;                                     // 受击表现对象（怪物掉血）
        var dst = { x: window.innerWidth * 0.5, y: 90 };
        if (mEl) { var r = mEl.getBoundingClientRect(); dst = { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }
        var count = opts.big ? 16 : 10;
        if (opts.wave) count = opts.big ? 20 : 14;
        var dur = 0;
        var hitDone = false;
        for (var i = 0; i < count; i++) {
            (function (i) {
                var sx = src.x + rnd(-70, 70), sy = src.y + rnd(-40, 40);
                var delay = i * rnd(24, 60);
                var flyMs = rnd(650, 1000);
                dur = Math.max(dur, delay + flyMs);
                setTimeout(function () {
                    if (gen !== myGen) return;   /* 会话已被 stopAll 终止：不再启动粒子 */
                    var startX = sx, startY = sy;
                    var fxKey = opts.fxKey || null;
                    var imgEl = null;
                    if (opts.imgUrl) {   /* 自定义词图：预载 Image（gif 会自动播首帧动画序列） */
                        imgEl = new Image();
                        imgEl.src = opts.imgUrl;
                    }
                    if (fxKey) loadKeyImg(fxKey);
                    var ctrlX = (sx + dst.x) / 2 + rnd(-120, 120);
                    var ctrlY = Math.min(sy, dst.y) - rnd(60, 200);
                    var born = Date.now();
                    spawn({ kind: 'swarm', emoji: emoji, fxKey: fxKey, imgUrl: opts.imgUrl || null, imgEl: imgEl, size: rnd(20, opts.big ? 40 : 32), life: flyMs / 1000 + 0.05, alpha: 1, rot: 0, rotv: rnd(-4, 4), ph: rnd(0, 6.28), wave: !!opts.wave,
                        update: function (p, dt) {
                            /* 实时追踪怪物：页面滚动/布局变化后依然命中，不做一次性快照 */
                            if (mEl) { try { var rr = mEl.getBoundingClientRect(); if (rr.width > 0) { dst.x = rr.left + rr.width / 2; dst.y = rr.top + rr.height / 2; } } catch (e) {} }
                            var t = Math.min(1, (Date.now() - born) / flyMs);
                            var tt = t;
                            var x = (1 - tt) * (1 - tt) * startX + 2 * (1 - tt) * tt * ctrlX + tt * tt * dst.x;
                            var y = (1 - tt) * (1 - tt) * startY + 2 * (1 - tt) * tt * ctrlY + tt * tt * dst.y;
                            if (p.wave) y += Math.sin(t * 14 + p.ph) * 26 * (1 - t);
                            p.x = x; p.y = y;
                            p.rot += p.rotv * dt;
                            p.scale = 1 - t * 0.35;
                            if (t >= 1) {
                                p.dead = true;
                                if (!hitDone) {
                                    hitDone = true;
                                    monsterHit(hitEl, opts.damage, opts);
                                    heroGain(mEl);
                                    if (opts.onHit) { try { opts.onHit(); } catch (e) {} }
                                }
                                // 命中小火花
                                for (var s = 0; s < 4; s++) spawn({ kind: 'imp', x: dst.x + rnd(-14, 14), y: dst.y + rnd(-14, 14), size: rnd(1.5, 3.4), color: pick(['#ffd04c', '#ffffff', '#ff8c42']), vx: rnd(-90, 90), vy: rnd(-110, -20), life: rnd(0.25, 0.5), alpha: 1, update: function (pp, dt2) { pp.x += pp.vx * dt2; pp.y += pp.vy * dt2; pp.vy += 340 * dt2; pp.alpha = pp.life * 2.4; }, draw: drawDot });
                            }
                        },
                        draw: (fxKey || imgEl) ? drawKeyImgOrEmoji : drawEmoji });
                    startLoop((flyMs + delay) / 1000 * 1000 + 700);
                }, delay);
            })(i);
        }
        startLoop(dur + 800);
        if (!opts.silent) {
            if (opts.sound) playSound(opts.sound, opts.lang);
            else SYNTH.whoosh();
        }
        if (!hitDone) {
            // 兜底：即使粒子被清理也要有受击表现
            setTimeout(function () { if (!hitDone && gen === myGen) { hitDone = true; monsterHit(hitEl, opts.damage, opts); heroGain(mEl); if (opts.onHit) { try { opts.onHit(); } catch (e) {} } } }, dur + 120);
        }
    }

    function playBurst(opts) {
        opts = opts || {};
        var src = opts.source || { x: window.innerWidth / 2, y: window.innerHeight / 2.6 };
        ensureCanvas();
        SYNTH.sparkle();
        if (opts.fxKey) loadKeyImg(opts.fxKey);
        for (var i = 0; i < 22; i++) {
            var ang = rnd(0, Math.PI * 2), sp = rnd(70, 260);
            spawn({ kind: 'burst', x: src.x, y: src.y, size: rnd(2, 5), color: pick(['#ffd04c', '#ff8c42', '#ffffff', '#ffe38a']), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40, life: rnd(0.5, 1.0), alpha: 1,
                update: function (p, dt) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 240 * dt; p.alpha = Math.min(1, p.life * 1.8); },
                draw: drawDot });
        }
        // 一个大 emoji 冲向收获对象（知识归主角）
        var mEl = opts.monsterEl || document.getElementById('m3-mouth');
        var myGen = gen;
        setTimeout(function () {
            if (gen !== myGen) return;
            playSwarm(opts.emoji || '⭐', { monsterEl: opts.heroEl || mEl, hitEl: mEl, source: src, big: false, silent: true, damage: opts.damage, lang: opts.lang, onHit: opts.onHit, fxKey: opts.fxKey, imgUrl: opts.imgUrl || null });
        }, 120);
        startLoop(1600);
    }

    /* ================= 词义解析 ================= */
    function stem(w) {
        w = String(w || '').toLowerCase();
        var sufs = ["'s", 'ing', 'ies', 'es', 'ed', 's'];
        for (var i = 0; i < sufs.length; i++) {
            var suf = sufs[i];
            if (w.length - suf.length >= 3 && w.slice(0 - suf.length) === suf) {
                var base = w.slice(0, 0 - suf.length);
                if (suf === 'ies') base = w.slice(0, -3) + 'y';
                return base;
            }
        }
        return w;
    }
    function resolve(word, lang, display) {
        var D = window.WORD_FX_DATA || {};
        var KEY = D.KEY || {}, EN = D.EN || {}, ZH = D.ZH || {}, RU = D.RU || {};
        var w = String(word || '').toLowerCase();
        var d = String(display || '');
        var key = null;
        if (lang === 'zh') {
            key = ZH[d] || ZH[w] || ZH[stem(w)] || null;
        } else if (lang === 'ru') {
            key = RU[w] || RU[stem(w)] || null;
        }
        if (!key) key = EN[w] || EN[stem(w)] || null;
        if (!key) {
            // 兜底规则：词内含场景词根
            var rules = [['fire', 'fire'], ['rain', 'rain'], ['snow', 'snow'], ['wind', 'wind'], ['dog', 'dog'], ['cat', 'cat'], ['fish', 'fish'], ['love', 'love'], ['magic', 'magic'], ['sun', 'sun'], ['star', 'night'], ['moon', 'night'], ['night', 'night'], ['storm', 'storm'], ['thunder', 'storm'], ['lightning', 'storm'], ['sea', 'sea'], ['ocean', 'sea'], ['wave', 'sea'], ['water', 'rain'], ['fog', 'fog'], ['cloud', 'fog'], ['frog', 'frog'], ['bird', 'bird'], ['pig', 'pig'], ['cow', 'cow'], ['horse', 'horse'], ['bear', 'bear'], ['lion', 'lion'], ['tiger', 'tiger'], ['wolf', 'wolf'], ['fox', 'fox'], ['duck', 'duck'], ['egg', 'egg'], ['cake', 'cake'], ['milk', 'milk'], ['tea', 'tea'], ['book', 'book'], ['car', 'car'], ['bus', 'bus'], ['ball', 'ball'], ['star2', 'night']];
            for (var i = 0; i < rules.length; i++) {
                if (w.indexOf(rules[i][0]) >= 0 && KEY[rules[i][1]]) { key = rules[i][1]; break; }
            }
        }
        if (!key || !KEY[key]) return null;
        var spec = KEY[key];
        spec.key = key;
        if (!spec.e && spec.t !== 'scene') spec.t = spec.t === 'swarm' ? 'burst' : spec.t;
        return spec;
    }

    /* ================= 对外 API ================= */
    var WORD_FX = {
        v: 1,
        /** 解析词 → 特效描述（供测试） */
        resolve: resolve,
        /** 词事件入口：完成单词时调用。heroEl=知识收获对象（粒子飞向它），monsterEl=受击对象 */
        wordEvent: function (word, opts) {
            opts = opts || {};
            var spec;
            try { spec = resolve(word, opts.lang, opts.display); } catch (e) {}
            if (opts.forceSpec) spec = opts.forceSpec;
            var monsterEl = opts.monsterEl || document.getElementById('m3-mouth');
            var flyEl = opts.heroEl || monsterEl;   // 知识归谁：粒子飞向谁（默认打怪物）
            var source = opts.source;
            if (!source && opts.cells) { try { source = rectOfCells(opts.cells); } catch (e) {} }
            if (!source) source = { x: window.innerWidth / 2, y: window.innerHeight / 2.6 };
            if (spec && spec.t === 'scene') {
                playScene(spec.sc || 'magic', opts);
                playSound(spec.s, opts.lang);
                monsterHit(monsterEl, opts.damage, opts);
                heroGain(flyEl);
                if (opts.onHit) { try { opts.onHit(); } catch (e) {} }
                return spec;
            }
            if ((spec && spec.t === 'swarm' && spec.e) || opts.imgUrl) {
                playSwarm((spec && spec.e) || '⭐', {
                    monsterEl: flyEl, hitEl: monsterEl, source: source, big: !!opts.big, damage: opts.damage,
                    lang: opts.lang, sound: spec && spec.s, wave: spec && spec.sc === 'wave', onHit: opts.onHit,
                    fxKey: spec ? spec.key : null,
                    imgUrl: opts.imgUrl || null
                });
                return spec;
            }
            // burst 兜底
            playBurst({
                emoji: opts.imgUrl ? null : ((spec && spec.e) || '✨'), fxKey: spec ? spec.key : null, monsterEl: monsterEl, heroEl: flyEl, source: source,
                damage: opts.damage, lang: opts.lang, onHit: opts.onHit, imgUrl: opts.imgUrl || null
            });
            return spec || { t: 'burst' };
        },
        /** 词义图片 URL（卡片/弹窗用）；无图片返回 null */
        imgFor: function (word, lang, display) {
            var spec = null;
            try { spec = resolve(word, lang, display); } catch (e) {}
            if (!spec) return null;
            var D = window.WORD_FX_DATA || {};
            if (!D.IMG || !D.IMG[spec.key]) return null;
            loadKeyImg(spec.key);
            return keyImgUrl(spec.key);
        },
        /** 空闲预加载全部词义图片（后台静默，不阻塞） */
        preload: function () {
            var D = window.WORD_FX_DATA || {};
            if (!D.IMG) return 0;
            var keys = Object.keys(D.IMG), i = 0, n = 0;
            var step = function () {
                var batch = 0;
                while (i < keys.length && batch < 12) { loadKeyImg(keys[i++]); batch++; }
                if (i < keys.length) setTimeout(step, 120);
            };
            step();
            return keys.length;
        },
        /** 直接播放场景（供测试/演示） */
        playScene: function (id) { playScene(id, {}); },
        playSwarm: function (emoji, opts) { playSwarm(emoji, opts || {}); },
        playBurst: function (opts) { playBurst(opts || {}); },
        playSound: playSound,
        monsterHit: function (damage) { monsterHit(document.getElementById('m3-mouth'), damage, {}); },
        stopAll: stopAll,
        scenes: Object.keys(SCENES)
    };
    window.WORD_FX = WORD_FX;
})();
