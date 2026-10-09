/* 丧尸英语城 - 语音施法引擎 C（免按连续检测 · 声纹匹配）
 * 需求（用户 2026.10.9 真机反馈）：不再"按住说话"——进入战斗即持续监听环境音，
 * 说到法术字（如火）时与参考读音声纹比对，相似度达标自动施法。
 *
 * 原理：参考读音（sounds/spell/<拼音>_<变体>.wav，TTS 多音高变体）与麦克风实时音频
 * 都提取 MFCC 梅尔倒谱（对音色/信道鲁棒，比原始波形相似度更接近人耳），
 * 经 CMVN 归一化消除说话人差异后做 DTW 动态时间规整比对（容忍语速不同），
 * 相似度 = exp(-代价/τ)，达标且领先第二名足够多 → 判定命中。
 *
 * 兼容性：iOS Safari 没有 SpeechRecognition API——这是 iPhone 真机喊词无效的根因；
 * 本引擎只用 getUserMedia + WebAudio，iOS/Android/桌面全支持，全程离线无需网络。
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;

  /* ---------- 可调参数 ---------- */
  var CFG = {
    sr: 16000, frame: 512, hop: 256,            // 32ms 窗 / 16ms 步进
    melN: 24, cepsN: 13, fmin: 60, fmax: 7600,
    vadRise: 9, vadFall: 4.5,                   // dB（相对噪声底）
    hangEnd: 22, minFrames: 9, maxFrames: 170,  // 静音收尾 350ms；最短 144ms
    /* 校准依据（27 例全链路测试，含 ±18% 变调模拟异说话人）：
       正例相似度 0.822-0.967 / 领先幅度 ≥0.144；反例最高 0.836(甜→山) 但领先仅 0.068 */
    tau: 16, thresh: 0.80, margin: 0.07,
    band: 0.4,                                  // DTW 带宽约束
    durGuard: 1.9,                              // 时长比超过此值跳过模板
    refrac: 1500,                               // 命中冷却(ms)
    echoHold: 2800                              // 自身 TTS 播报的回声抑制(ms)
  };

  /* ---------- DSP 基建（FFT / 汉明窗 / 梅尔滤波器组 / DCT） ---------- */
  var N = 512, LOG = 9;
  var BR = new Int32Array(N), TWR = new Float32Array(N / 2), TWI = new Float32Array(N / 2);
  (function () {
    for (var i = 0; i < N; i++) { var r = 0, x = i; for (var b = 0; b < LOG; b++) { r = (r << 1) | (x & 1); x >>= 1; } BR[i] = r; }
    for (var k = 0; k < N / 2; k++) { var a = -2 * Math.PI * k / N; TWR[k] = Math.cos(a); TWI[k] = Math.sin(a); }
  })();
  function fft(re, im) {
    for (var i = 0; i < N; i++) { var j = BR[i]; if (j > i) { var t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (var size = 2; size <= N; size <<= 1) {
      var half = size >> 1, step = N / size;
      for (var i2 = 0; i2 < N; i2 += size) {
        for (var j2 = i2, k = 0; j2 < i2 + half; j2++, k += step) {
          var l = j2 + half;
          var tr = re[l] * TWR[k] - im[l] * TWI[k], ti = re[l] * TWI[k] + im[l] * TWR[k];
          re[l] = re[j2] - tr; im[l] = im[j2] - ti; re[j2] += tr; im[j2] += ti;
        }
      }
    }
  }
  var WIN = new Float32Array(N);
  for (var w0 = 0; w0 < N; w0++) WIN[w0] = 0.54 - 0.46 * Math.cos(2 * Math.PI * w0 / (N - 1));
  function hz2mel(f) { return 2595 * Math.log(1 + f / 700); }
  var melN = CFG.melN, TRI = [];                // 每滤波器 {s,e,w[]}
  (function () {
    var mlo = hz2mel(CFG.fmin), mhi = hz2mel(CFG.fmax), pts = [];
    for (var i = 0; i <= melN + 1; i++) pts.push(1 + Math.floor(N * (700 * (Math.exp(Math.log(10) * (mlo + (mhi - mlo) * i / (melN + 1)) / 2595) - 1)) / CFG.sr));
    for (var m = 1; m <= melN; m++) {
      var s = pts[m - 1], e = pts[m + 1], wv = new Float32Array(Math.max(1, e - s + 1));
      for (var b = s; b <= e; b++) {
        var v = b < pts[m] ? (b - s + 1) / (pts[m] - s + 1) : (e - b + 1) / (e - pts[m] + 1);
        wv[b - s] = Math.max(0, Math.min(1, v));
      }
      TRI.push({ s: s, e: e, w: wv });
    }
  })();
  var DCT = [];
  for (var k0 = 0; k0 < CFG.cepsN; k0++) {
    var row = new Float32Array(melN);
    for (var m0 = 0; m0 < melN; m0++) row[m0] = Math.cos(Math.PI * k0 * (m0 + 0.5) / melN) * (k0 === 0 ? Math.sqrt(1 / melN) : Math.sqrt(2 / melN));
    DCT.push(row);
  }

  var _re = new Float32Array(N), _im = new Float32Array(N);
  var _mel = new Float32Array(melN);
  /* 一帧 PCM → 13 维 MFCC + 能量 dB */
  function mfccFrame(pcm, off) {
    var e2 = 0;
    for (var i = 0; i < N; i++) { var v = pcm[off + i] * WIN[i]; _re[i] = v; _im[i] = 0; e2 += v * v; }
    fft(_re, _im);
    for (var m = 0; m < melN; m++) {
      var t = TRI[m], acc = 0;
      for (var b = t.s; b <= t.e; b++) { var p = _re[b] * _re[b] + _im[b] * _im[b]; acc += t.w[b - t.s] * p; }
      _mel[m] = Math.log(acc > 1e-10 ? acc : 1e-10);
    }
    var c = new Float32Array(CFG.cepsN);
    for (var k = 0; k < CFG.cepsN; k++) { var s = 0; for (var m2 = 0; m2 < melN; m2++) s += DCT[k][m2] * _mel[m2]; c[k] = s; }
    return { c: c, e: 10 * Math.log10(e2 + 1e-12) };
  }

  /* ---------- 重采样（任意采样率 → 16k；降采样走均值抗混叠） ---------- */
  function to16k(inPcm, srcRate) {
    if (Math.abs(srcRate - CFG.sr) < 1) return inPcm;
    var n = Math.floor(inPcm.length * CFG.sr / srcRate), out = new Float32Array(n);
    if (srcRate > CFG.sr) {
      var r = srcRate / CFG.sr;
      for (var i = 0; i < n; i++) {
        var a = Math.floor(i * r), b = Math.min(inPcm.length, Math.floor((i + 1) * r)), s = 0;
        for (var j = a; j < b; j++) s += inPcm[j];
        out[i] = b > a ? s / (b - a) : inPcm[a] || 0;
      }
    } else {
      var step = srcRate / CFG.sr;
      for (var i2 = 0; i2 < n; i2++) {
        var p = i2 * step, i0 = Math.floor(p), f = p - i0;
        out[i2] = (inPcm[i0] || 0) * (1 - f) + (inPcm[i0 + 1] || 0) * f;
      }
    }
    return out;
  }

  /* ---------- 特征序列：静音裁剪 + CMVN + 差分 ---------- */
  function framesOf(pcm16) {
    var fr = [];
    for (var off = 0; off + CFG.frame <= pcm16.length; off += CFG.hop) fr.push(mfccFrame(pcm16, off));
    return fr;
  }
  function trimSilence(pcm16) {
    var fr = [], i;
    for (var off = 0; off + CFG.frame <= pcm16.length; off += CFG.hop) {
      var e2 = 0;
      for (i = 0; i < CFG.frame; i += 4) { var v = pcm16[off + i]; e2 += v * v; }
      fr.push(10 * Math.log10(e2 * 4 + 1e-12));
    }
    if (!fr.length) return pcm16;
    var mx = -1e9; for (i = 0; i < fr.length; i++) if (fr[i] > mx) mx = fr[i];
    var th = mx - 30, a = 0, b = fr.length - 1;
    while (a < b && fr[a] < th) a++;
    while (b > a && fr[b] < th) b--;
    var pad = 3;
    a = Math.max(0, a - pad) * CFG.hop; b = Math.min(pcm16.length, (b + pad) * CFG.hop + CFG.frame);
    return pcm16.subarray ? pcm16.subarray(a, b) : pcm16.slice(a, b);
  }
  /* 帧 MFCC 数组 → CMVN(均值方差归一) + 一阶差分，输出 n×26 连续存储 */
  function cmvDelta(fr) {
    var n = fr.length, D = CFG.cepsN, f = new Float32Array(n * D * 2);
    if (!n) return { n: 0, f: f };
    var mean = new Float64Array(D), std = new Float64Array(D), i, k, t;
    for (k = 0; k < D; k++) { mean[k] = 0; std[k] = 0; }
    for (i = 0; i < n; i++) for (k = 0; k < D; k++) mean[k] += fr[i].c[k];
    for (k = 0; k < D; k++) mean[k] /= n;
    for (i = 0; i < n; i++) for (k = 0; k < D; k++) { var d = fr[i].c[k] - mean[k]; std[k] += d * d; }
    var stat = new Float32Array(n * D);
    for (k = 0; k < D; k++) {
      std[k] = Math.sqrt(std[k] / n);
      var sd = Math.max(std[k], 0.4);
      for (i = 0; i < n; i++) stat[i * D + k] = (fr[i].c[k] - mean[k]) / sd;
    }
    for (t = 0; t < n; t++) {
      for (k = 0; k < D; k++) f[t * D * 2 + k] = stat[t * D + k];
      for (k = 0; k < D; k++) {                                 // Δ = (x[t+1]-x[t-1] + 2(x[t+2]-x[t-2]))/10
        var d = 0;
        if (t > 0 && t + 1 < n) d += stat[(t + 1) * D + k] - stat[(t - 1) * D + k];
        if (t > 1 && t + 2 < n) d += 2 * (stat[(t + 2) * D + k] - stat[(t - 2) * D + k]);
        f[t * D * 2 + D + k] = d / 10;
      }
    }
    return { n: n, f: f, D2: D * 2 };
  }

  /* ---------- DTW（带宽约束，代价按路径长归一） ---------- */
  var INF = 1e15;
  function dtwCost(A, B) {
    var n = A.n, m = B.n, D = A.D2 || 26;
    if (n > m * CFG.durGuard || m > n * CFG.durGuard) return INF;
    var band = Math.max(10, Math.ceil(Math.max(n, m) * CFG.band));
    var prev = new Float64Array(m + 1), cur = new Float64Array(m + 1), i, j;
    for (j = 0; j <= m; j++) prev[j] = INF;
    prev[0] = 0;
    for (i = 1; i <= n; i++) {
      var ai = (i - 1) * D, j0 = Math.max(1, i - band), j1 = Math.min(m, i + band);
      for (j = 0; j <= m; j++) cur[j] = INF;
      for (j = j0; j <= j1; j++) {
        var bj = (j - 1) * D, c = 0;
        for (var k = 0; k < D; k++) { var dv = A.f[ai + k] - B.f[bj + k]; c += dv * dv; }
        var best = prev[j];
        if (cur[j - 1] < best) best = cur[j - 1];
        if (prev[j - 1] < best) best = prev[j - 1];
        cur[j] = c + best;
      }
      var tp = prev; prev = cur; cur = tp;
    }
    return prev[m] >= INF ? INF : prev[m] / (n + m);
  }
  function sim(cost) { return cost >= INF ? 0 : Math.exp(-cost / CFG.tau); }

  /* ---------- 模板（参考读音） ---------- */
  var tpl = {};
  function decodePcm(ab) {
    return new Promise(function (res) {
      var oc = null;
      try { oc = new OfflineAudioContext(1, 16000, 16000); } catch (e) { return res(null); }
      var settled = false;
      function done(buf) {
        if (settled) return; settled = true;
        res(buf ? to16k(buf.getChannelData(0), buf.sampleRate) : null);
      }
      try {
        var p = oc.decodeAudioData(ab, done, function () { done(null); });
        if (p && p.then) p.then(done, function () { done(null); });
      } catch (e) { done(null); }
    });
  }
  function makeTemplate(pcm16) {
    var t = trimSilence(pcm16);
    if (t.length < CFG.frame * 3) return null;
    return cmvDelta(framesOf(t));
  }
  /* 模板共振峰缩放增强：真人差异（男/女/童声）主要是声道长度→共振峰整体缩放，
   * TTS 音高变体只动基频覆盖不了；加载时按 0.88/1.14 重采样生成变体模板（DTW 时长无关） */
  var AUG_SCALES = [1.0, 0.88, 1.14];
  function loadPool(chars) {
    chars.forEach(function (ch) {
      if (tpl[ch] || !S.SPELLS[ch]) return;
      var sp = S.SPELLS[ch];
      for (var v = 0; v < 3; v++) {
        (function (ch2, url) {
          fetch(url).then(function (r) { return r.arrayBuffer(); })
            .then(function (ab) { return decodePcm(ab); })
            .then(function (pcm) {
              if (!pcm) return;
              AUG_SCALES.forEach(function (sc) {
                var p2 = sc === 1 ? pcm : to16k(pcm, Math.round(CFG.sr * sc));
                var t = makeTemplate(p2);
                if (t) { (tpl[ch2] = tpl[ch2] || []).push(t); }
              });
            })
            .catch(function () { });
        })(ch, 'sounds/spell/' + sp.pyPlain + '_' + v + '.wav');
      }
    });
  }

  /* ---------- 实时监听 ---------- */
  var live = {
    on: false, enabling: false, denied: false, noGum: false,
    ctx: null, stream: null, src: null, proc: null, gz: null, ratio: 3, pos: 0,
    ring: new Float32Array(1 << 15), rw: 0, rr: 0, seen: 0,
    inSpeech: false, fr: [], pre: [], hang: 0, noise: -75,
    lastHit: 0, holdUntil: 0, testResolve: null, lastClass: null
  };
  var MASK = (1 << 15) - 1, FR = new Float32Array(N);

  function onProc(ev) {
    var inp = ev.inputBuffer.getChannelData(0);
    /* 保险丝：正常每块最多输出 ≈ len/ratio 个采样；超限说明状态异常，重置防 CPU 冻结 */
    var guard = Math.ceil(inp.length / Math.max(0.25, live.ratio)) + 64, emitted = 0;
    for (var k = 0; k < inp.length; k++) {
      while (live.pos <= k) {
        if (++emitted > guard) { live.pos = k + 1; return; }
        var i0 = Math.floor(live.pos), f = live.pos - i0;
        var s = (inp[i0] || 0) * (1 - f) + (inp[i0 + 1] != null ? inp[i0 + 1] : inp[i0] || 0) * f;
        pushSample(s);
        live.pos += live.ratio;
      }
    }
    live.pos -= inp.length;
  }
  function pushSample(s) {
    live.ring[live.rw] = s; live.rw = (live.rw + 1) & MASK;
    if (((live.rw - live.rr + (1 << 15)) & MASK) >= N) {
      for (var i = 0; i < N; i++) FR[i] = live.ring[(live.rr + i) & MASK];
      live.rr = (live.rr + CFG.hop) & MASK;
      onFrame(mfccFrame(FR, 0));
    }
  }
  function onFrame(f) {
    live.seen++;
    if (!live.inSpeech) {
      live.pre.push(f); if (live.pre.length > 3) live.pre.shift();
      var a = live.seen < 60 ? 0.15 : 0.03;
      if (f.e < live.noise + 7) live.noise = live.noise * (1 - a) + f.e * a;
      if (f.e > live.noise + CFG.vadRise) {
        live.inSpeech = true; live.hang = 0;
        live.fr = live.pre.slice();
        dbg('🎤 检测到声音…');
      }
    } else {
      live.fr.push(f);
      if (f.e < live.noise + CFG.vadFall) { live.hang++; if (live.hang >= CFG.hangEnd) endUtter(); }
      else live.hang = 0;
      if (live.fr.length >= CFG.maxFrames) endUtter();
    }
  }
  function endUtter() {
    live.inSpeech = false;
    var fr = live.fr; live.fr = []; live.pre = [];
    if (fr.length >= CFG.minFrames) classify(fr);
  }

  /* ---------- 判定与路由 ---------- */
  /* 实时语音段裁掉首尾低能量帧（VAD 的 hang/pre 尾静音），与模板的裁剪口径对齐 */
  function trimFrames(fr) {
    if (fr.length < 4) return fr;
    var mx = -1e9, i;
    for (i = 0; i < fr.length; i++) if (fr[i].e > mx) mx = fr[i].e;
    var th = mx - 25, a = 0, b = fr.length - 1;
    while (a < b && fr[a].e < th) a++;
    while (b > a && fr[b].e < th) b--;
    return fr.slice(Math.max(0, a - 2), Math.min(fr.length, b + 3));
  }
  function classify(fr0) {
    var fr = trimFrames(fr0);
    if (fr.length < CFG.minFrames) return;
    var now = performance.now();
    var feats = cmvDelta(fr);
    var results = [];
    for (var ch in tpl) {
      var best = INF;
      for (var i = 0; i < tpl[ch].length; i++) {
        var c = dtwCost(feats, tpl[ch][i]);
        if (c < best) best = c;
      }
      results.push({ ch: ch, cost: best, sim: sim(best) });
    }
    results.sort(function (a, b) { return b.sim - a.sim; });
    var top = results[0], second = null;
    for (var r = 1; r < results.length; r++) if (results[r].ch !== top.ch) { second = results[r]; break; }
    var ok = !!top && top.sim >= CFG.thresh && (!second || top.sim - second.sim >= CFG.margin);
    var fired = false;
    if (ok && now >= live.holdUntil && now - live.lastHit > CFG.refrac && !S.locked()) {
      var sc = ZCITY.Debug && ZCITY.Debug.scene;
      if (!(sc && sc.indoor)) {
        live.lastHit = now; fired = true;
        route(top.ch, top.sim);
      }
    }
    live.lastClass = { top: top, second: second, frames: fr.length, fired: fired };
    dbg(pickDbgText(top, second, ok, fired));
    if (live.testResolve) { var tr = live.testResolve; live.testResolve = null; tr(live.lastClass); }
  }
  function pickDbgText(top, second, ok, fired) {
    if (!top) return '';
    var s = top.ch + ' ' + top.sim.toFixed(2);
    if (second) s += ' | ' + second.ch + ' ' + second.sim.toFixed(2);
    return s + (fired ? ' →施法' : ok ? ' (冷却/被抑制)' : '');
  }
  function route(ch, simVal) {
    var pt = ZCITY.Voice && ZCITY.Voice.panelTarget && ZCITY.Voice.panelTarget();
    if (pt && pt.ch === ch) {
      ZCITY.Voice.closePanel();
      if (pt.cb) pt.cb(ch); else S.onVoiceHit(ch);
    } else {
      S.onVoiceHit(ch);
    }
    var b = document.getElementById('micBubble');
    if (b) {
      b.textContent = '🎙 ' + ch + ' ' + Math.round(simVal * 100) + '%';
      b.classList.add('show');
      setTimeout(function () { b.classList.remove('show'); }, 1300);
    }
  }

  /* ---------- 调试条（?dev=1） ---------- */
  var dbgEl = null;
  function dbg(txt) {
    if (!dbgEl) return;
    dbgEl.textContent = txt;
  }
  function ensureDbg() {
    if (dbgEl || !(new URLSearchParams(location.search).get('dev') === '1')) return;
    dbgEl = document.createElement('div');
    dbgEl.id = 'voiceDbg';
    dbgEl.style.cssText = 'position:fixed;top:6px;left:8px;z-index:99;background:rgba(0,0,0,.55);color:#7fff9c;' +
      'font:12px/1.5 monospace;padding:2px 8px;border-radius:6px;pointer-events:none;max-width:60vw';
    document.body.appendChild(dbgEl);
    dbg('声纹引擎待开启');
  }

  /* ---------- 生命周期 ---------- */
  function enable() {
    ensureDbg();
    if (live.on) return Promise.resolve(true);
    if (live.enabling) return live.enablingP;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { live.noGum = true; return Promise.resolve(false); }
    live.enablingP = new Promise(function (res) {
      navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
      }).then(function (stream) {
        var ok = attach(stream);
        res(ok);
        if (ok) dbg('监听中 · ' + (live.ctx ? live.ctx.sampleRate : 0) + 'Hz · 噪声底自适应');
      }, function (err) {
        if (err && /NotAllowed|Security|Permission/i.test(err.name || '')) live.denied = true;
        live.enabling = false; live.enablingP = null;
        res(false);
      });
    });
    live.enabling = true;
    return live.enablingP;
  }
  function attach(stream, useCtx) {
    detach();
    var ctx = useCtx;
    if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
    if (!ctx || !ctx.createScriptProcessor) return false;
    live.ctx = ctx; live.stream = stream;
    live.ratio = ctx.sampleRate / CFG.sr; live.pos = 0;
    live.rw = 0; live.rr = 0; live.seen = 0; live.noise = -75;
    live.inSpeech = false; live.fr = []; live.pre = []; live.hang = 0;
    try {
      live.src = ctx.createMediaStreamSource(stream);
      live.proc = ctx.createScriptProcessor(2048, 1, 1);
      live.proc.onaudioprocess = onProc;
      live.gz = ctx.createGain(); live.gz.gain.value = 0;   // 必须连 destination 才能在 iOS 上驱动处理，0 增益防回声
      live.src.connect(live.proc);
      live.proc.connect(live.gz);
      live.gz.connect(ctx.destination);
      if (ctx.state === 'suspended') ctx.resume();
    } catch (e) { detach(); return false; }
    live.on = true; live.enabling = false; live.enablingP = null;
    if (ZCITY.Game && ZCITY.Game.micState) ZCITY.Game.micState(true);
    try { localStorage.setItem('elc_wake_ok', '1'); } catch (e) { }
    return true;
  }
  function detach() {
    try { if (live.proc) live.proc.onaudioprocess = null; } catch (e) { }
    try { if (live.src) live.src.disconnect(); } catch (e) { }
    try { if (live.proc) live.proc.disconnect(); } catch (e) { }
    try { if (live.gz) live.gz.disconnect(); } catch (e) { }
    if (live.stream && !live.testKeepStream) { try { live.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { } }
    live.stream = null; live.src = null; live.proc = null; live.gz = null; live.on = false;
    if (ZCITY.Game && ZCITY.Game.micState) ZCITY.Game.micState(false);
  }
  function boot() {
    ensureDbg();
    loadPool(S.pool ? S.pool() : Object.keys(S.SPELLS));
    var hinted = false;
    try { hinted = localStorage.getItem('elc_wake_hint') === '1'; } catch (e) { }
    if (!hinted) {
      try { localStorage.setItem('elc_wake_hint', '1'); } catch (e) { }
      ZCITY.Game.toast('🎤 点麦克风按钮开启免按喊词：喊「火/水/石/山」直接施法');
    }
    /* Chrome/Android：已授权过则静默自动开启；iOS Safari 不支持查询，首次仍需点一下 */
    if (navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(function (st) {
        if (st.state === 'granted') enable();
      }).catch(function () { });
    }
  }
  function pause() { if (live.on && live.ctx && live.ctx.state === 'running') { try { live.ctx.suspend(); } catch (e) { } } }
  function resume() { if (live.on && live.ctx && live.ctx.state === 'suspended') { try { live.ctx.resume(); } catch (e) { } } }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) pause(); else resume();
  });
  document.addEventListener('pointerdown', function () { if (live.on && live.ctx && live.ctx.state === 'suspended') { try { live.ctx.resume(); } catch (e) { } } }, true);

  /* ---------- 测试钩子 ---------- */
  function scorePcm(pcm, srcRate) {
    var p = to16k(pcm, srcRate || CFG.sr);
    var feats = cmvDelta(framesOf(trimSilence(p)));
    var out = [];
    for (var ch in tpl) {
      var best = INF;
      for (var i = 0; i < tpl[ch].length; i++) { var c = dtwCost(feats, tpl[ch][i]); if (c < best) best = c; }
      out.push({ ch: ch, cost: best });
    }
    out.sort(function (a, b) { return a.cost - b.cost; });
    return { frames: feats.n, costs: out };
  }
  function scoreUrl(url) {
    return fetch(url).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return decodePcm(ab); })
      .then(function (pcm) { return pcm ? scorePcm(pcm, CFG.sr) : null; });
  }
  /* 全链路测试：wav →（可选变速率变调模拟不同说话人/加噪声）→ 假媒体流 → VAD→MFCC→DTW→命中 */
  function testLive(url, rate, snrDb) {
    rate = rate || 1;
    return fetch(url).then(function (r) { return r.arrayBuffer(); })
      .then(function (ab) { return decodePcm(ab); })
      .then(function (pcm) {
        if (!pcm) return { error: 'decode fail' };
        var ac = new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        var base = ac.createBuffer(1, pcm.length, CFG.sr);
        base.copyToChannel(pcm, 0);
        function play(p) {
          if (snrDb != null) {
            var sig = 0; for (var i = 0; i < p.length; i++) sig += p[i] * p[i];
            sig = Math.sqrt(sig / p.length);
            var nz = sig / Math.pow(10, snrDb / 20);
            for (var i2 = 0; i2 < p.length; i2++) p[i2] += (Math.random() * 2 - 1) * nz;
          }
          var buf = ac.createBuffer(1, p.length, CFG.sr);
          buf.copyToChannel(p, 0);
          var msd = ac.createMediaStreamDestination();
          var src = ac.createBufferSource(); src.buffer = buf; src.connect(msd);
          var prm = new Promise(function (res) {
            live.testResolve = res;
            setTimeout(function () { if (live.testResolve === res) { live.testResolve = null; res({ timeout: true, last: live.lastClass }); } }, 6000);
          });
          live.testKeepStream = true;
          attach(msd.stream, ac);
          live.testKeepStream = false;
          src.start();
          return prm;
        }
        if (rate !== 1) {
          var oc = new OfflineAudioContext(1, Math.ceil(pcm.length / rate) + CFG.sr, CFG.sr);
          var s0 = oc.createBufferSource(); s0.buffer = base; s0.playbackRate.value = rate;
          s0.connect(oc.destination); s0.start();
          return oc.startRendering().then(function (rb) { return play(rb.getChannelData(0).slice()); });
        }
        return play(pcm.slice());
      });
  }

  ZCITY.VoiceWake = {
    cfg: CFG,
    boot: boot, enable: enable,
    loadPool: loadPool,
    pause: pause, resume: resume,
    isOn: function () { return live.on; },
    denied: function () { return live.denied; },
    hold: function (ms) { live.holdUntil = Math.max(live.holdUntil, performance.now() + ms); },
    poolLoaded: function () { return Object.keys(tpl); },
    tplCount: function (ch) { return tpl[ch] ? tpl[ch].length : 0; },
    noiseDb: function () { return live.noise; },
    lastClass: function () { return live.lastClass; },
    _scorePcm: scorePcm,
    _scoreUrl: scoreUrl,
    _testLive: testLive
  };
})();
