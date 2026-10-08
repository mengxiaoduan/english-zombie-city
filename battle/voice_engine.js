/* 丧尸英语城 - 语音施法引擎（可插拔双模式）
 * 模式A：webkitSpeechRecognition（zh-CN）——按住说话，能连上时可用
 * 模式B：拼音点选面板——听音选读音，任何设备可靠可用（国内网络/无麦克风兜底）
 * 两种模式命中同一回调 ZCITY.Spells.onVoiceHit(ch)
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;

  var panel = null, rec = null, listening = false, holdTimer = 0;
  var srAvailable = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

  /* ---------- 拼音点选面板 ----------
   * opts: { forcedChar: 强制出题字（拾取模式）， onPickup: 拾取回调， mode: 'pickup' } */
  function openPanel(reason, opts) {
    if (panel) return;
    opts = opts || {};
    var chars = opts.forcedChar ? [opts.forcedChar] : S.fieldChars();
    if (!chars.length) { ZCITY.Game.toast('附近没有僵尸，先前进！'); return; }
    var target = chars[Math.floor(Math.random() * chars.length)];
    var sp = S.SPELLS[target] || (ZCITY.Debug && ZCITY.Debug.ITEMS ? ZCITY.Debug.ITEMS[target] : null);
    if (!sp) return;

    panel = document.createElement('div');
    panel.id = 'voicePanel';
    var opts2 = [sp.py];
    var pool = ['huǒ', 'shuǐ', 'shí', 'shān', 'yào', 'bàng', 'gùn', 'dāo', 'fàn', 'tǔ', 'tiān', 'yuè', 'rì', 'kǒu'];
    while (opts2.length < 4) {
      var p = pool[Math.floor(Math.random() * pool.length)];
      if (opts2.indexOf(p) < 0) opts2.push(p);
    }
    for (var i = opts2.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = opts2[i]; opts2[i] = opts2[j]; opts2[j] = tmp;
    }
    var pend = !opts.mode && S.pendingDouble(target);
    panel.innerHTML =
      '<div class="vp-card">' +
      '<div class="vp-title">' + (reason || '读出这个字') + '</div>' +
      '<div class="vp-char" id="vpChar">' + target + '</div>' +
      '<div class="vp-sub">' + (opts.mode === 'pickup'
          ? sp.py + ' · ' + sp.en + ' —— 念对即可获得'
          : (pend ? '✍️ 已画符——选对读音即双倍！' : '听发音，选出它的拼音')) + '</div>' +
      '<div class="vp-opts">' + opts2.map(function (o) {
        return '<div class="vp-opt" data-ok="' + (o === sp.py ? 1 : 0) + '">' + o + '</div>';
      }).join('') + '</div>' +
      '<div class="vp-hear" id="vpHear">🔊 再听一次</div>' +
      '<div class="vp-close" id="vpClose">关闭</div>' +
      '</div>';
    document.body.appendChild(panel);

    panel.querySelector('#vpClose').addEventListener('click', closePanel);
    panel.querySelector('#vpHear').addEventListener('click', function () { S.speak(target); });
    var els = panel.querySelectorAll('.vp-opt');
    for (var k = 0; k < els.length; k++) {
      (function (el) {
        el.addEventListener('click', function () {
          if (el.getAttribute('data-ok') === '1') {
            el.classList.add('right');
            S.speak(target);
            var cb = opts.onPickup;
            setTimeout(function () {
              closePanel();
              if (cb) cb(target); else S.onVoiceHit(target);
            }, 380);
          } else {
            el.classList.add('wrong');
            el.style.pointerEvents = 'none';
          }
        });
      })(els[k]);
    }
    setTimeout(function () { S.speak(target); }, 250);
  }
  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
  }

  /* ---------- 真实语音识别 ---------- */
  function startListen() {
    if (!srAvailable || listening) return false;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    try {
      rec = new SR();
      rec.lang = 'zh-CN';
      rec.continuous = false;
      rec.interimResults = true;
      rec.maxAlternatives = 3;
    } catch (e) { return false; }
    var finalText = '';
    rec.onresult = function (ev) {
      var txt = '';
      for (var i = 0; i < ev.results.length; i++) txt += ev.results[i][0].transcript;
      finalText = txt;
      var hit = matchText(txt);
      if (hit) { stopListen(); S.onVoiceHit(hit); showBubble('🎙 ' + hit + '！'); }
    };
    rec.onerror = function () { stopListen(); };
    rec.onend = function () {
      listening = false;
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
      ZCITY.Game.micState(false);
    };
    try { rec.start(); listening = true; ZCITY.Game.micState(true); return true; }
    catch (e) { return false; }
  }
  function stopListen() {
    if (rec && listening) { try { rec.stop(); } catch (e) { } }
    listening = false;
    ZCITY.Game.micState(false);
  }
  /* 文本 → 法术字（汉字直配 / 去调拼音 / 常见中文词） */
  function matchText(txt) {
    if (!txt) return null;
    var t = txt.trim();
    Object.keys(S.SPELLS).forEach(function (ch) {
      if (t.indexOf(ch) >= 0) { t = ch; }
    });
    if (S.SPELLS[t]) return t;
    var plain = t.toLowerCase().replace(/[^a-z]/g, '');
    var keys = Object.keys(S.SPELLS);
    for (var i = 0; i < keys.length; i++) {
      if (plain && plain.indexOf(S.SPELLS[keys[i]].pyPlain) >= 0) return keys[i];
    }
    return null;
  }
  function showBubble(msg) {
    var b = document.getElementById('micBubble');
    if (!b) return;
    b.textContent = msg;
    b.classList.add('show');
    setTimeout(function () { b.classList.remove('show'); }, 1300);
  }

  /* ---------- 入口：按住说话 / 点击面板 ---------- */
  function onMicDown(ev) {
    ev.preventDefault && ev.preventDefault();
    if (ZCITY.Spells.locked()) { ZCITY.Game.toast('法力恢复中…'); return; }
    var started = startListen();
    if (!started) {
      // 语音服务不可用（国内网络常见）→ 拼音面板
      openPanel(srAvailable ? '语音没听到，改用拼音' : '语音服务不可用 · 拼音施法');
      return;
    }
    holdTimer = setTimeout(function () { stopListen(); }, 6000);
  }
  function onMicUp() { if (listening) stopListen(); }

  ZCITY.Voice = {
    openPanel: openPanel,
    closePanel: closePanel,
    onMicDown: onMicDown,
    onMicUp: onMicUp,
    srAvailable: function () { return srAvailable; },
    _matchText: matchText
  };
})();
