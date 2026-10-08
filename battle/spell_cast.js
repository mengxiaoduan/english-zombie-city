/* 丧尸英语城 - 施法系统（M2+M3 核心：喊词 + 画符 = 双倍）
 * 规则（用户定案）：
 *   只喊对 = 基础法伤；只写对符 = 基础法伤；
 *   6秒窗口内同一僵尸上喊+写都完成 = 第二击强化，合计双倍
 * 教学闭环：认字（僵尸头顶）→ 读音（拼音/语音）→ 书写（符纸笔顺）→ 学习卡复习
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';

  /* ---------- 法术表（字全部在 hanzi_data.js 笔顺库内） ---------- */
  var SPELLS = {
    '火': { py: 'huǒ',  pyPlain: 'huo',  en: 'fire',     color: '#ff7a3c', kind: 'fire',  dmg: 45 },
    '水': { py: 'shuǐ', pyPlain: 'shui', en: 'water',    color: '#7ec8ff', kind: 'water', dmg: 45 },
    '石': { py: 'shí',  pyPlain: 'shi',  en: 'stone',    color: '#c9c2b8', kind: 'stone', dmg: 45 },
    '山': { py: 'shān', pyPlain: 'shan', en: 'mountain', color: '#a8905c', kind: 'rock',  dmg: 55 }
  };
  var SPELL_KEYS = Object.keys(SPELLS);
  var PINYIN_POOL = ['huǒ', 'shuǐ', 'shí', 'shān', 'tǔ', 'tiān', 'yuè', 'rì', 'mù', 'kǒu', 'shǒu', 'shān'];

  var WINDOW_T = 6;          // 双倍组合窗口（秒）
  var castLock = 0;          // 施法冷却
  var learned = {};          // 本次会话已学字（学习卡只弹第一次）

  var E = null;              // 引擎引用（注入）

  function init(engine) { E = engine; }

  function pickSpellKey() { return SPELL_KEYS[Math.floor(Math.random() * SPELL_KEYS.length)]; }

  /* 找目标：同字僵尸中最近者；无同字 → 最近僵尸（错属性减半）。入场中也可先手打击 */
  function findTarget(ch) {
    if (!E) return null;
    var zs = E.zombies.filter(function (z) { return !z.dead; });
    if (!zs.length) return null;
    var same = zs.filter(function (z) { return z.spell === ch; });
    var pool = same.length ? same : zs;
    var best = pool[0], bd = 1e9;
    pool.forEach(function (z) {
      var d = Math.abs(z.x - E.hero.x) + Math.abs(z.y - E.hero.y) * 0.5;
      if (d < bd) { bd = d; best = z; }
    });
    return { z: best, matched: same.length > 0 };
  }

  /* ---------- 施法动作结算 ---------- */
  function resolveCast(ch, action /* 'voice' | 'rune' */) {
    if (!E || !E.canCast()) { return; }
    var sp = SPELLS[ch];
    if (!sp) return;
    var t = findTarget(ch);
    if (!t) { E.toast('附近没有僵尸'); return; }
    var z = t.z;
    var win = z.charWin || (z.charWin = { t: 0, voice: false, rune: false });
    var doubled = false;
    if (win.voice && action === 'rune') doubled = true;
    if (win.rune && action === 'voice') doubled = true;
    win[action] = true;
    win.t = WINDOW_T;

    var dmg = sp.dmg * (t.matched ? 1 : 0.5) * (doubled ? 1.55 : 1);
    dmg = Math.round(dmg);
    E.spellStrike(z, ch, sp, dmg, doubled, action);
    if (action === 'voice') castLock = 1.0;                // 冷却只防语音连点（画符有12s限时天然限频）
    if (!learned[ch]) {
      learned[ch] = true;
      setTimeout(function () { showLearnCard(ch, sp); }, 650);
    }
    if (doubled) E.banner('语音+画符 · 双倍施法！', '#ffb02e');
    if (!t.matched) E.toast('属性不符（' + ch + '），威力减半');
  }

  /* ---------- 学习卡（字·拼音·英文） ---------- */
  function showLearnCard(ch, sp) {
    var el = document.getElementById('learnCard');
    if (!el) return;
    el.innerHTML =
      '<div class="lc-char" style="color:' + sp.color + '">' + ch + '</div>' +
      '<div class="lc-py">' + sp.py + '</div>' +
      '<div class="lc-en">' + sp.en + '</div>';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    speak(ch);
  }
  function speak(text) {
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = 'zh-CN'; u.rate = 0.75;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) { }
  }

  /* ---------- 窗口倒计时（引擎每帧调用；rdt=真实时间用于冷却，冻结时也恢复） ---------- */
  function tick(dt, rdt) {
    if (castLock > 0) castLock -= (rdt != null ? rdt : dt);
    if (!E) return;
    E.zombies.forEach(function (z) {
      if (z.charWin) {
        z.charWin.t -= dt;                                 // 窗口走游戏时间：面板冻结时窗口不流失
        if (z.charWin.t <= 0 || z.dead) z.charWin = null;
      }
    });
  }

  /* ---------- 语音入口（voice_engine 成功后回调） ---------- */
  function onVoiceHit(ch) {
    if (castLock > 0) return;                              // 连点防护
    resolveCast(ch, 'voice');
  }

  /* ---------- 画符入口（rune_board 成功后回调） ---------- */
  function onRuneHit(ch) { resolveCast(ch, 'rune'); }

  /* 当前场上僵尸的字集合（供面板出题，入场中也算） */
  function fieldChars() {
    if (!E) return [];
    var s = {};
    E.zombies.forEach(function (z) { if (!z.dead) s[z.spell] = true; });
    return Object.keys(s);
  }
  /* 双倍状态查询（UI 提示用） */
  function pendingDouble(ch) {
    if (!E) return false;
    return E.zombies.some(function (z) {
      return z.charWin && z.spell === ch && (z.charWin.voice || z.charWin.rune) && !(z.charWin.voice && z.charWin.rune);
    });
  }

  ZCITY.Spells = {
    SPELLS: SPELLS,
    init: init,
    pickSpellKey: pickSpellKey,
    tick: tick,
    onVoiceHit: onVoiceHit,
    onRuneHit: onRuneHit,
    fieldChars: fieldChars,
    pendingDouble: pendingDouble,
    locked: function () { return castLock > 0; },
    showLearnCard: showLearnCard,
    speak: speak,
    /* 测试钩子 */
    _resolve: resolveCast,
    _resetLearned: function () { learned = {}; }
  };
})();
