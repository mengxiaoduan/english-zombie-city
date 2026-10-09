/* 丧尸英语城 - 符纸画板（m12 连写版）
 * 黄纸朱砂符纸视觉（符头敕令 + 茅山印章 + 燃烧收符动画）；
 * 写完 → "符成·请念出"闭环：展示 汉字/拼音/英文，播中英读音，玩家自行跟念后收符。
 * 模式：
 *   战斗模式  Rune.open('main')                        → 随机场上字（返回是否成功），念完 onRuneHit 施法
 *   制作模式  Rune.open('make', {char, onDone})        → 单字制符
 *   永固加持  Rune.open('make', {sequence:['永','固'], meta, onDone, onAbandon})
 *             → 连写两字（永字八法练习），全部写完出合并念词；中途放弃触发 onAbandon（符纸作废）
 * 字不在笔顺库 → 四选一认字兜底；限时 12 秒只约束书写阶段。
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;
  var LIMIT = 12;              // 秒（书写阶段）
  var board = null, writer = null, timer = 0, t0 = 0, rafId = 0;
  var seq = [], seqIdx = 0, meta = null, boardTitle = '';
  var mode = 'battle', doneCb = null, abandonCb = null, finished = false;

  function dataAvailable(ch) {
    return !!(window.HANZI_DATA && window.HANZI_DATA[ch]);
  }
  function metaOf(ch) {
    return meta || S.SPELLS[ch];
  }
  function curChar() { return seq[seqIdx] || ''; }

  function open(reason, opts) {
    if (board) return true;
    opts = opts || {};
    mode = opts.char || opts.sequence ? 'make' : 'battle';
    doneCb = opts.onDone || null;
    abandonCb = opts.onAbandon || null;
    boardTitle = opts.title || '';
    finished = false;
    if (mode === 'make') {
      seq = opts.sequence ? opts.sequence.slice() : [opts.char];
      meta = opts.meta || null;
    } else {
      var chars = S.fieldChars();
      if (!chars.length) { ZCITY.Game.toast('附近没有僵尸，先前进！'); return false; }
      seq = [chars[Math.floor(Math.random() * chars.length)]];
      meta = null;
    }
    seqIdx = 0;
    var sp = metaOf(seq[0]);
    if (!sp) return false;

    board = document.createElement('div');
    board.id = 'runeBoard';
    board.innerHTML =
      '<div class="rb-card">' +
      '<div class="rb-title" id="rbTitle"></div>' +
      '<div class="rb-target"><span class="rb-char" id="rbChar" style="color:' + sp.color + '"></span>' +
      '<span class="rb-py" id="rbPy"></span></div>' +
      '<div class="rb-paper">' +
      '<div class="rb-fuhead">敕令</div>' +
      '<div id="rbWrite"></div>' +
      '<div class="rb-seal">茅山</div>' +
      '<svg class="rb-ring" viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="26"/><circle class="fg" id="rbRing" cx="30" cy="30" r="26"/></svg>' +
      '</div>' +
      '<div class="rb-hint" id="rbHint">按笔顺在符纸上书写</div>' +
      '<div class="rb-close" id="rbClose">放弃</div>' +
      '</div>';
    document.body.appendChild(board);
    board.querySelector('#rbClose').addEventListener('click', close);
    loadSeqChar();
    t0 = performance.now();
    rafId = requestAnimationFrame(tickTimer);
    return true;
  }

  /* 载入序列中的当前字（连写时复用同一面板） */
  function loadSeqChar() {
    var ch = curChar();
    var sp = metaOf(ch);
    var multi = seq.length > 1;
    var ttl = boardTitle || (multi ? '✍️ 连写 · 第' + (seqIdx + 1) + '/' + seq.length + ' 字' : '✍️ 画符 · 写出这个字');
    board.querySelector('#rbTitle').textContent = ttl;
    var chEl = board.querySelector('#rbChar');
    chEl.textContent = ch;
    chEl.style.color = sp.color;
    /* 永字八法提示（永 = 八法之宗，教学彩蛋） */
    board.querySelector('#rbPy').textContent = (multi && ch === '永'
      ? 'yǒng · 永字八法之宗'
      : sp.py + ' · ' + sp.en);
    var hint = board.querySelector('#rbHint');
    hint.textContent = ch === '永'
      ? '永字八法：点·横·竖·钩·提·撇·短撇·捺'
      : '按笔顺在符纸上书写';
    hint.classList.remove('warn');

    var host = board.querySelector('#rbWrite');
    host.innerHTML = '';
    if (window.HanziWriter && dataAvailable(ch)) {
      try {
        writer = HanziWriter.create(host, ch, {
          width: 180, height: 180, padding: 8,
          showOutline: true, showCharacter: false,
          strokeColor: '#b82820', outlineColor: '#d8c8a5',
          radicalColor: '#8a1a14',
          drawingColor: '#e84438', drawingWidth: 26,
          leniency: 1.15,
          charDataLoader: function (c, onComplete) { onComplete(HANZI_DATA[c]); },
          onLoadCharDataError: function () { fallbackQuiz(); }
        });
        writer.quiz({
          onMistake: function () {
            var h = board && board.querySelector('#rbHint');
            if (h) { h.textContent = '笔顺不对，再试这一笔'; h.classList.add('warn'); }
          },
          onCorrectStroke: function (d) {
            var h = board && board.querySelector('#rbHint');
            if (h) { h.textContent = '✓ 第 ' + d.strokeNum + '/' + d.totalStrokes + ' 笔'; h.classList.remove('warn'); }
          },
          onComplete: function () { succeed(); }
        });
      } catch (e) { fallbackQuiz(); }
    } else {
      fallbackQuiz();
    }
  }

  /* 兜底：四选一认字（无笔顺数据时） */
  function fallbackQuiz() {
    var host = board && board.querySelector('#rbWrite');
    if (!host) return;
    var ch = curChar();
    var sp = metaOf(ch);
    var pool2 = Object.keys(S.SPELLS).concat(seq.length > 1 ? ['永', '固'] : []);
    var opts = [ch];
    while (opts.length < Math.min(4, pool2.length)) {
      var k = pool2[Math.floor(Math.random() * pool2.length)];
      if (opts.indexOf(k) < 0) opts.push(k);
    }
    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    var h = board.querySelector('#rbHint');
    if (h) h.textContent = '（该字暂无笔顺数据）选出正确的字';
    host.innerHTML = '<div class="rb-fb">' + opts.map(function (o) {
      var m2 = S.SPELLS[o] || { color: '#ffd873' };
      return '<div class="rb-opt" data-ok="' + (o === ch ? 1 : 0) + '" style="color:' + m2.color + '">' + o + '</div>';
    }).join('') + '</div>';
    void sp;
    var els = host.querySelectorAll('.rb-opt');
    for (var n = 0; n < els.length; n++) {
      (function (el) {
        el.addEventListener('click', function () {
          if (el.getAttribute('data-ok') === '1') succeed();
          else { el.classList.add('wrong'); el.style.pointerEvents = 'none'; }
        });
      })(els[n]);
    }
  }

  function tickTimer() {
    if (!board || board.querySelector('.rb-chant')) return;      // 念词阶段不限时
    var left = Math.max(0, LIMIT - (performance.now() - t0) / 1000);
    var ring = board.querySelector('#rbRing');
    if (ring) {
      var c = 2 * Math.PI * 26;
      ring.style.strokeDashoffset = String(c * (1 - left / LIMIT));
      ring.classList.toggle('low', left < 4);
    }
    if (left <= 0) { close(); ZCITY.Game.toast('符纸灵气散了，再画一次'); return; }
    rafId = requestAnimationFrame(tickTimer);
  }

  /* ---------- 单字写完：连写则烧一下进下一字，末字出念词 ---------- */
  function succeed() {
    if (!board) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    var ch = curChar();
    var card = board.querySelector('.rb-card');
    var paper = board.querySelector('.rb-paper');
    if (seqIdx < seq.length - 1) {
      /* 连写中间字：短燃烧过渡 → 下一字 */
      if (paper) paper.classList.add('burn');
      var hint = board.querySelector('#rbHint');
      if (hint) { hint.textContent = '✓ ' + ch + ' 成！继续'; hint.classList.remove('warn'); }
      setTimeout(function () {
        if (!board) return;
        if (paper) paper.classList.remove('burn');
        seqIdx++;
        t0 = performance.now();                                  // 每字独立限时
        loadSeqChar();
        if (!rafId) rafId = requestAnimationFrame(tickTimer);
      }, 460);
      return;
    }
    var combined = seq.join('');
    if (card) card.classList.add('glow');
    if (paper) paper.classList.add('burn');
    var hint2 = board.querySelector('#rbHint');
    if (hint2) { hint2.textContent = '🔥 符成！'; hint2.classList.remove('warn'); }
    setTimeout(function () { showChant(combined); }, 520);
  }

  /* 念词闭环：自行念出中文与英文 → 收符 */
  function showChant(combined) {
    if (!board) return;
    var sp = metaOf(combined[0]);
    if (!sp) { close(); return; }
    var card = board.querySelector('.rb-card');
    if (card) card.classList.remove('glow');
    var paperEl = board.querySelector('.rb-paper');
    if (paperEl) paperEl.classList.remove('burn');   // 燃烧动画 forwards 会保持隐形，念词前复位
    var host = board.querySelector('#rbWrite');
    if (host) host.innerHTML =
      '<div class="rb-chant">' +
      '<div class="rc-z" style="color:' + sp.color + '">' + combined + '</div>' +
      '<div class="rc-py">' + sp.py + '</div>' +
      '<div class="rc-en">' + sp.en + '</div>' +
      '</div>';
    var seal = board.querySelector('.rb-seal');
    if (seal) seal.classList.add('lit');
    var oldClose = board.querySelector('#rbClose');
    if (oldClose) oldClose.remove();
    if (card) {
      var foot = document.createElement('div');
      foot.className = 'rb-chantbar';
      foot.innerHTML =
        '<div class="rc-snd" id="rcZh">🔊 中文</div>' +
        '<div class="rc-snd" id="rcEn">🔊 English</div>' +
        '<div class="rc-ok" id="rcOk">已念 · 收符 ✓</div>';
      card.appendChild(foot);
    }
    var hint2 = board.querySelector('#rbHint');
    if (hint2) hint2.textContent = '大声念出它的中文和英文，法力即成';
    board.querySelector('#rcZh').addEventListener('click', function () { speakZh(combined); });
    board.querySelector('#rcEn').addEventListener('click', function () { speakEn(sp.en); });
    board.querySelector('#rcOk').addEventListener('click', function () { finish(combined); });
    speakZh(combined);
    setTimeout(function () { speakEn(sp.en); }, 1400);
  }
  function speakZh(txt) {
    try {
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = 'zh-CN'; u.rate = 0.78;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }
  function speakEn(txt) {
    try {
      var u = new SpeechSynthesisUtterance(txt);
      u.lang = 'en-US'; u.rate = 0.85;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }

  function finish(combined) {
    finished = true;
    var cb = doneCb, mk = mode, ch0 = combined;      // 先缓存：close() 会清空回调（历史教训）
    close();
    if (mk === 'make' && cb) cb(ch0);
    else S.onRuneHit(combined);
  }

  function close() {
    var abandon = !finished && mode === 'make' && abandonCb;
    var cb = abandonCb;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (board) { board.remove(); board = null; }
    writer = null; seq = []; seqIdx = 0; meta = null;
    doneCb = null; abandonCb = null; mode = 'battle'; finished = false;
    if (abandon && cb) cb();
  }

  ZCITY.Rune = { open: open, close: close, isOpen: function () { return !!board; } };
  /* 测试钩子：_succeed 模拟当前字书写完成（连写自动推进），_confirm 直接念词确认 */
  ZCITY.Rune._succeed = function () { if (board && !board.querySelector('.rb-chant')) succeed(); };
  ZCITY.Rune._confirm = function () {
    if (board && board.querySelector('.rb-chant')) {
      var z = board.querySelector('.rc-z');
      finish(z ? z.textContent : curChar());
    }
  };
  ZCITY.Rune._seq = function () { return { seq: seq.slice(), idx: seqIdx, mode: mode }; };
})();
