/* 丧尸英语城 - 符纸画板（m11 符纸化改版）
 * 黄纸朱砂符纸视觉（符头敕令 + 茅山印章 + 燃烧收符动画）；
 * 写完 → "符成·请念出"闭环：展示 汉字/拼音/英文，播中英读音，玩家自行跟念后收符。
 * 两种模式：
 *   战斗模式  Rune.open(reason)                 → 随机场上字，念完 onRuneHit 施法
 *   制作模式  Rune.open('make', {char, onDone}) → 安全屋画符台，念完 onDone(ch) 入背包
 * 字不在笔顺库 → 四选一认字兜底；限时 12 秒只约束书写阶段。
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;
  var LIMIT = 12;              // 秒（书写阶段）
  var board = null, writer = null, timer = 0, t0 = 0, rafId = 0, curChar = '';
  var mode = 'battle', doneCb = null;

  function dataAvailable(ch) {
    return !!(window.HANZI_DATA && window.HANZI_DATA[ch]);
  }

  function open(reason, opts) {
    if (board) return;
    opts = opts || {};
    mode = opts.char ? 'make' : 'battle';
    doneCb = opts.onDone || null;
    var chars;
    if (mode === 'make') {
      curChar = opts.char;
    } else {
      chars = S.fieldChars();
      if (!chars.length) { ZCITY.Game.toast('附近没有僵尸，先前进！'); return; }
      curChar = chars[Math.floor(Math.random() * chars.length)];
    }
    var sp = S.SPELLS[curChar];
    if (!sp) return;

    board = document.createElement('div');
    board.id = 'runeBoard';
    board.innerHTML =
      '<div class="rb-card">' +
      '<div class="rb-title">✍️ 画符 · ' + (mode === 'make' ? '为符纸注入法力' : '写出这个字') + '</div>' +
      '<div class="rb-target"><span class="rb-char" style="color:' + sp.color + '">' + curChar + '</span>' +
      '<span class="rb-py">' + sp.py + ' · ' + sp.en + '</span></div>' +
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

    var host = board.querySelector('#rbWrite');
    if (window.HanziWriter && dataAvailable(curChar)) {
      try {
        writer = HanziWriter.create(host, curChar, {
          width: 180, height: 180, padding: 8,
          showOutline: true, showCharacter: false,
          strokeColor: '#b82820', outlineColor: '#d8c8a5',
          radicalColor: '#8a1a14',
          drawingColor: '#e84438', drawingWidth: 26,
          leniency: 1.15,                    // 入门宽松判定
          charDataLoader: function (ch, onComplete) { onComplete(HANZI_DATA[ch]); },
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

    t0 = performance.now();
    rafId = requestAnimationFrame(tickTimer);
  }

  /* 兜底：四选一认字（无笔顺数据时） */
  function fallbackQuiz() {
    var host = board && board.querySelector('#rbWrite');
    if (!host) return;
    var keys = Object.keys(S.SPELLS);
    var opts = [curChar];
    while (opts.length < Math.min(4, keys.length)) {
      var k = keys[Math.floor(Math.random() * keys.length)];
      if (opts.indexOf(k) < 0) opts.push(k);
    }
    for (var i = opts.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = opts[i]; opts[i] = opts[j]; opts[j] = t;
    }
    var h = board.querySelector('#rbHint');
    if (h) h.textContent = '（该字暂无笔顺数据）选出正确的字';
    host.innerHTML = '<div class="rb-fb">' + opts.map(function (o) {
      return '<div class="rb-opt" data-ok="' + (o === curChar ? 1 : 0) + '" style="color:' +
        S.SPELLS[o].color + '">' + o + '</div>';
    }).join('') + '</div>';
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

  /* ---------- 书写完成 → 燃烧动画 → 念词闭环 ---------- */
  function succeed() {
    if (!board) return;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    var ch = curChar;                                        // 先缓存：close() 会清空 curChar
    var card = board.querySelector('.rb-card');
    var paper = board.querySelector('.rb-paper');
    if (card) card.classList.add('glow');
    if (paper) paper.classList.add('burn');
    var hint = board.querySelector('#rbHint');
    if (hint) { hint.textContent = '🔥 符成！'; hint.classList.remove('warn'); }
    if (ZCITY.Game && ZCITY.Game.magicSnd) ZCITY.Game.magicSnd();
    setTimeout(function () { showChant(ch); }, 520);
  }

  /* 念词闭环：自行念出中文与英文 → 收符 */
  function showChant(ch) {
    if (!board) return;
    var sp = S.SPELLS[ch];
    if (!sp) { close(); return; }
    var card = board.querySelector('.rb-card');
    if (card) card.classList.remove('glow');
    var paperEl = board.querySelector('.rb-paper');
    if (paperEl) paperEl.classList.remove('burn');   // 燃烧动画 forwards 会保持隐形，念词前复位
    var host = board.querySelector('#rbWrite');
    if (host) host.innerHTML =
      '<div class="rb-chant">' +
      '<div class="rc-z" style="color:' + sp.color + '">' + ch + '</div>' +
      '<div class="rc-py">' + sp.py + '</div>' +
      '<div class="rc-en">' + sp.en + '</div>' +
      '</div>';
    var seal = board.querySelector('.rb-seal');
    if (seal) seal.classList.add('lit');
    var hint = board.querySelector('#rbHint');
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
    board.querySelector('#rcZh').addEventListener('click', function () { speakZh(ch); });
    board.querySelector('#rcEn').addEventListener('click', function () { speakEn(sp.en); });
    board.querySelector('#rcOk').addEventListener('click', function () { finish(ch); });
    speakZh(ch);
    setTimeout(function () { speakEn(sp.en); }, 1400);
  }
  function speakZh(ch) {
    try {
      var u = new SpeechSynthesisUtterance(ch);
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

  function finish(ch) {
    var cb = doneCb, mk = mode;        // 先缓存：close() 会清空 doneCb/mode（历史教训：先清理再回调=回调静默丢失）
    close();
    if (mk === 'make' && cb) cb(ch);
    else S.onRuneHit(ch);
  }

  function close() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (board) { board.remove(); board = null; }
    writer = null; curChar = ''; doneCb = null; mode = 'battle';
  }

  ZCITY.Rune = { open: open, close: close, isOpen: function () { return !!board; } };
  /* 测试钩子：_succeed 模拟书写完成（进入念词），_confirm 直接念词确认 */
  ZCITY.Rune._succeed = function () { if (board && !board.querySelector('.rb-chant')) succeed(); };
  ZCITY.Rune._confirm = function () {
    if (board && board.querySelector('.rb-chant')) finish(curChar || (board.querySelector('.rc-z') || {}).textContent);
  };
})();
