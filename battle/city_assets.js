/* 丧尸英语城 - 素材清单/预加载/帧切分
 * 全局命名空间 window.ZCITY，风格与现有 ELC/HERO/WORD_FX 一致
 * 支持三种素材形态：
 *   src          单图（frames:'auto' 按透明列自动切帧）
 *   seq          逐帧 PNG 序列，运行时拼成一张横向精灵表（Warped City 的主角/特效）
 *   tile:true    可平铺视差背景层
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';

  var MANIFEST = {
    zombie: {
      A_walk:   { src: 'assets/zombies/zombie_typeA_walk_spritesheet.png',   frames: 'auto', fps: 7 },
      A_attack: { src: 'assets/zombies/zombie_typeA_attack_spritesheet.png', frames: 'auto', fps: 8 },
      B_walk:   { src: 'assets/zombies/zombie_typeB_walk_spritesheet.png',   frames: 'auto', fps: 9 },
      B_attack: { src: 'assets/zombies/zombie_typeB_attack_spritesheet.png', frames: 'auto', fps: 10 },
      C_walk:   { src: 'assets/zombies/zombie_typeC_walk_spritesheet.png',   frames: 'auto', fps: 6 },
      C_attack: { src: 'assets/zombies/zombie_typeC_attack_spritesheet.png', frames: 'auto', fps: 8 }
    },
    hero: {
      run:  { seq: ['assets/warped_city/player/run-%d.png', 1, 8], fps: 13 },
      idle: { seq: ['assets/warped_city/player/idle-%d.png', 1, 4], fps: 6 },
      hurt: { src: 'assets/warped_city/player/hurt.png', fps: 1 }
    },
    fx: {
      explosion: { seq: ['assets/warped_city/fx/enemy-explosion-%d.png', 1, 6], fps: 14 }
    },
    bg: {
      skyline:  { src: 'assets/warped_city/bg/skyline-a.png',        tile: true },
      buildings:{ src: 'assets/warped_city/bg/buildings-bg.png',     tile: true },
      near:     { src: 'assets/warped_city/bg/near-buildings-bg.png', tile: true }
    }
  };

  var store = {};   // key -> { img(Canvas|Image), frames:[{sx,sy,sw,sh}], fw, fh, fps, ok }

  function loadImage(src) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = src;
    });
  }

  function expandSeq(meta) {
    var p = meta.seq[0], a = meta.seq[1], b = meta.seq[2], out = [];
    for (var i = a; i <= b; i++) out.push(p.replace('%d', String(i)));
    return out;
  }

  /* 逐帧图序列 → 拼成一张横向精灵表 canvas（帧rect精确已知，无需再切） */
  function composeSeq(imgs) {
    var fh = 0, tw = 0;
    imgs.forEach(function (im) { fh = Math.max(fh, im.naturalHeight); tw += im.naturalWidth; });
    var cv = document.createElement('canvas');
    cv.width = tw; cv.height = fh;
    var cx = cv.getContext('2d');
    var frames = [], x = 0;
    imgs.forEach(function (im) {
      var y = fh - im.naturalHeight;                       // 底对齐
      cx.drawImage(im, x, y);
      frames.push({ sx: x, sy: y, sw: im.naturalWidth, sh: im.naturalHeight });
      x += im.naturalWidth;
    });
    return { img: cv, frames: frames };
  }

  /* 按整列 alpha 采样把精灵图切成帧：连续非空列组为一帧（僵尸表用） */
  function sliceAuto(img) {
    var w = img.naturalWidth, h = img.naturalHeight;
    var cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    var cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    var data;
    try { data = cx.getImageData(0, 0, w, h).data; } catch (e) { return null; }
    var step = Math.max(1, Math.floor(h / 64));
    var cols = new Array(w);
    for (var x = 0; x < w; x++) {
      cols[x] = false;
      for (var y = 0; y < h; y += step) {
        if (data[(y * w + x) * 4 + 3] > 24) { cols[x] = true; break; }
      }
    }
    var frames = [], run = null, gap = 0;
    for (var c = 0; c < w; c++) {
      if (cols[c]) {
        if (run === null) run = c;
        gap = 0;
      } else if (run !== null) {
        gap++;
        if (gap > 1) { frames.push({ sx: run, sy: 0, sw: c - gap + 1, sh: h }); run = null; gap = 0; }
      }
    }
    if (run !== null) frames.push({ sx: run, sy: 0, sw: w - run, sh: h });
    return frames.length ? frames : null;
  }

  function buildEntry(meta, img) {
    var entry = { img: img, frames: null, fw: 0, fh: 0, fps: meta.fps || 8, ok: !!img };
    if (!img) return entry;
    if (meta.seq) {
      // seq 已在 load() 里合成，见下
    } else if (meta.frames === 'auto') {
      var f = sliceAuto(img);
      if (f && f.length) { entry.frames = f; entry.fw = f[0].sw; entry.fh = f[0].sh; }
      else { entry.fw = img.naturalWidth; entry.fh = img.naturalHeight; }
    } else {
      entry.fw = img.naturalWidth; entry.fh = img.naturalHeight;
    }
    return entry;
  }

  function load(onProgress) {
    var keys = [], jobs = [], metas = {};
    Object.keys(MANIFEST).forEach(function (group) {
      Object.keys(MANIFEST[group]).forEach(function (name) {
        var key = group + '.' + name;
        var meta = MANIFEST[group][name];
        keys.push(key); metas[key] = meta;
        if (meta.seq) {
          jobs.push(Promise.all(expandSeq(meta).map(loadImage)).then(function (imgs) {
            if (imgs.some(function (im) { return !im; })) return null;
            var c = composeSeq(imgs);
            var e = buildEntry({ fps: meta.fps }, c.img);
            e.frames = c.frames; e.fw = c.frames[0].sw; e.fh = c.frames[0].sh;
            return e;
          }));
        } else {
          jobs.push(loadImage(meta.src).then(function (img) { return buildEntry(meta, img); }));
        }
      });
    });
    var done = 0;
    return Promise.all(jobs.map(function (p, i) {
      return p.then(function (e) {
        store[keys[i]] = e || { ok: false, frames: null, fw: 0, fh: 0, fps: 8 };
        done++;
        if (onProgress) onProgress(done, keys.length);
      });
    })).then(function () { return store; });
  }

  function get(key) { return store[key] || null; }

  /* 画一帧动画（自动水平翻转）。e=store条目, idx=帧序, x,y=脚底中心, dispH=显示高, face=1右/-1左 */
  function drawFrame(ctx, e, idx, x, y, dispH, face) {
    if (!e || !e.ok) return false;
    var f = e.frames ? e.frames[((idx % e.frames.length) + e.frames.length) % e.frames.length]
                     : { sx: 0, sy: 0, sw: e.fw, sh: e.fh };
    var scale = dispH / f.sh;
    var dispW = f.sw * scale;
    ctx.save();
    ctx.translate(x, y);
    if (face === -1) ctx.scale(-1, 1);
    ctx.drawImage(e.img, f.sx, f.sy, f.sw, f.sh, -dispW / 2, -dispH, dispW, dispH);
    ctx.restore();
    return true;
  }

  ZCITY.Assets = { MANIFEST: MANIFEST, load: load, get: get, drawFrame: drawFrame };
})();
