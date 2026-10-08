/* 丧尸英语城 - 符纸画板（M3：手写汉字施法）
 * HanziWriter quiz 模式逐笔校验（离线 hanzi_data.js）；
 * 字不在笔顺库 → 兜底"认字"模式（四选一挑字）；
 * 限时 12 秒（入门宽松），成功回调 ZCITY.Spells.onRuneHit(ch)
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;
  var LIMIT = 12;              // 秒
  var board = null, writer = null, timer = 0, t0 = 0, rafId = 0, curChar = '';

  function dataAvailable(ch) {
    return !!(window.HANZI_DATA && window.HANZI_DATA[ch]);
  }

  function open(reason) {
    if (board) return;
    var chars = S.fieldChars();
    if (!chars.length) { ZCITY.Game.toast('附近没有僵尸，先前进！'); return; }
    curChar = chars[Math.floor(Math.random() * chars.length)];
    var sp = S.SPELLS[curChar];

    board = document.createElement('div');
    board.id = 'runeBoard';
    board.innerHTML =
      '<div class="rb-card">' +
      '<div class="rb-title">✍️ 画符 · ' + (reason === 'double' ? '配合语音可双倍！' : '写出这个字') + '</div>' +
      '<div class="rb-target"><span class="rb-char" style="color:' + sp.color + '">' + curChar + '</span>' +
      '<span class="rb-py">' + sp.py + ' · ' + sp.en + '</span></div>' +
      '<div class="rb-paper"><div id="rbWrite"></div>' +
      '<svg class="rb-ring" viewBox="0 0 60 60"><circle class="bg" cx="30" cy="30" r="26"/><circle class="fg" id="rbRing" cx="30" cy="30" r="26"/></svg></div>' +
      '<div class="rb-hint" id="rbHint">按笔顺在黄纸上书写</div>' +
      '<div class="rb-close" id="rbClose">放弃</div>' +
      '</div>';
    document.body.appendChild(board);
    board.querySelector('#rbClose').addEventListener('click', close);

    var host = board.querySelector('#rbWrite');
    if (window.HanziWriter && dataAvailable(curChar)) {
      try {
        writer = HanziWriter.create(host, curChar, {
          width: 190, height: 190, padding: 6,
          showOutline: true, showCharacter: false,
          strokeColor: '#c03028', outlineColor: '#d8c8a5',
          radicalColor: '#c03028',
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
    var sp = S.SPELLS[curChar];
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
    void sp;
  }

  function tickTimer() {
    if (!board) return;
    var left = Math.max(0, LIMIT - (performance.now() - t0) / 1000);
    var ring = board.querySelector('#rbRing');
    if (ring) {
      var c = 2 * Math.PI * 26;
      ring.style.strokeDashoffset = String(c * (1 - left / LIMIT));
      ring.classList.toggle('low', left < 4);
    }
    if (left <= 0) { close(); ZCITY.Game.toast('符纸过期了，再画一次'); return; }
    rafId = requestAnimationFrame(tickTimer);
  }

  function succeed() {
    if (!board) return;
    var ch = curChar;                                        // 先缓存：close() 会清空 curChar
    var card = board.querySelector('.rb-card');
    if (card) card.classList.add('glow');
    setTimeout(function () {
      close();
      S.onRuneHit(ch);
    }, 420);
  }

  function close() {
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
    if (board) { board.remove(); board = null; }
    writer = null; curChar = '';
  }

  ZCITY.Rune = { open: open, close: close, isOpen: function () { return !!board; } };
  ZCITY.Rune._succeed = function () { if (board) succeed(); };   // 测试钩子：模拟书写完成
})();
