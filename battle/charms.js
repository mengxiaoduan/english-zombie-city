/* 丧尸英语城 - 符纸背包与快捷栏（m11）
 * 闭环：战斗赚金币 → 符纸铺买空白符纸 → 画符台写字制符 → 背包 → 战斗点快捷栏激发
 * 规则（用户定案）：符纸激发=全额技能伤害，无需僵尸头上带同字——
 * 提前画好的符蕴含完整法力；有同字弱点僵尸时优先打它。
 */
window.ZCITY = window.ZCITY || {};
(function () {
  'use strict';
  var S = ZCITY.Spells;

  var K_CHARMS = 'elc_charms';        // { 字: 数量 }
  var K_BLANK = 'elc_charm_blank';    // 空白符纸数
  var USE_CD = 800;                   // 符纸激发冷却(ms)
  var MAX_SLOTS = 6;                  // 快捷栏槽数

  var bar = null, lastUse = 0;

  function load() {
    try { return JSON.parse(localStorage.getItem(K_CHARMS) || '{}') || {}; } catch (e) { return {}; }
  }
  function save(m) { try { localStorage.setItem(K_CHARMS, JSON.stringify(m)); } catch (e) { } }
  function charms() { return load(); }
  function blank() { return parseInt(localStorage.getItem(K_BLANK) || '0', 10) || 0; }
  function setBlank(n) { try { localStorage.setItem(K_BLANK, String(Math.max(0, n))); } catch (e) { } }

  function add(ch, n) {
    var m = load(); m[ch] = (m[ch] || 0) + (n || 1);
    if (m[ch] <= 0) delete m[ch];
    save(m); render();
  }
  function count(ch) { return load()[ch] || 0; }
  function total() { var m = load(), t = 0; for (var k in m) t += m[k]; return t; }

  /* ---------- 快捷栏渲染 ---------- */
  function render() {
    if (!bar) return;
    var m = load();
    var keys = Object.keys(m).filter(function (k) { return m[k] > 0 && S.SPELLS[k]; })
      .sort(function (a, b) { return m[b] ? 0 : 0; })      // 保持插入序（对象键序）
      .slice(0, MAX_SLOTS);
    var html = keys.map(function (k) {
      var sp = S.SPELLS[k];
      return '<div class="charm-slot" data-ch="' + k + '" style="--c:' + sp.color + '">' +
        '<span class="ch-z" style="color:' + sp.color + '">' + k + '</span>' +
        '<span class="ch-n">×' + m[k] + '</span></div>';
    }).join('');
    if (!keys.length) {
      bar.innerHTML = '<div class="charm-empty">📜 在安全屋画符，制成后此处快捷施放</div>';
      bar.classList.add('empty');
      return;
    }
    bar.classList.remove('empty');
    bar.innerHTML = html;
    var els = bar.querySelectorAll('.charm-slot');
    for (var i = 0; i < els.length; i++) {
      (function (el) {
        el.addEventListener('click', function () { use(el.getAttribute('data-ch')); });
      })(els[i]);
    }
  }

  /* ---------- 激发 ---------- */
  function use(ch) {
    var C = ZCITY.Combat;
    if (!C) return;
    if (!C.canCast() || (C.scene && C.scene.indoor)) { ZCITY.Game.toast('屋内灵气平和，符纸留待战斗'); return; }
    var now = performance.now();
    if (now - lastUse < USE_CD) return;
    if (!count(ch)) { render(); return; }
    var sp = S.SPELLS[ch];
    if (!sp) return;
    /* 光明词『爱』= 治疗（无需目标） */
    if (sp.heal && !sp.dmg) {
      lastUse = now; add(ch, -1);
      ZCITY.Game.toast('💜 ' + ch + '符 · 回复 ' + sp.heal);
      if (C.healHero) C.healHero(sp.heal);
      return;
    }
    /* 找目标：同字弱点优先，否则最近僵尸 —— 全额伤害（用户定案） */
    var zs = C.zombies.filter(function (z) { return !z.dead; });
    if (!zs.length) { ZCITY.Game.toast('附近没有僵尸'); return; }
    var same = zs.filter(function (z) { return z.spell === ch; });
    var pool = same.length ? same : zs;
    var best = pool[0], bd = 1e9;
    pool.forEach(function (z) {
      var d = Math.abs(z.x - C.hero.x) + Math.abs(z.y - C.hero.y) * 0.5;
      if (d < bd) { bd = d; best = z; }
    });
    lastUse = now;
    add(ch, -1);
    /* 直接走引擎 spellStrike（全额，不与双倍窗口联动） */
    C.spellStrike(best, ch, sp, sp.dmg, false, 'charm');
    var b = document.getElementById('micBubble');
    if (b) {
      b.textContent = '📜 ' + ch + '符激发！' + sp.dmg + ' 点' + (same.length ? '（弱点命中）' : '');
      b.classList.add('show');
      setTimeout(function () { b.classList.remove('show'); }, 1100);
    }
  }

  /* ---------- 生命周期 ---------- */
  function boot() {
    bar = document.getElementById('charmBar');
    if (bar) render();
  }

  ZCITY.Charms = {
    boot: boot, render: render,
    add: add, count: count, total: total,
    blank: blank, setBlank: setBlank,
    addBlank: function (n) { setBlank(blank() + (n || 1)); },
    use: use,
    _cfg: { USE_CD: USE_CD, MAX_SLOTS: MAX_SLOTS }
  };
})();
