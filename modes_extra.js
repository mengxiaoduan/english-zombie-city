/* ============================================================
 * 世界语言方块 · 通用玩法扩展包 v6
 * ------------------------------------------------------------
 * 基于 window.ELC 扩展 API。
 * v6: 词源选择与填词/闯关同构（日常/四级/六级/自定义 + 📤上传关卡）；
 *     听力 5 词一关（按配置顺序出题，自动干扰项）；
 *     记忆 6 词一轮、整关学完才通关、配对同色关联；
 *     学习卡复用全局 wordPopup（与填词/闯关一致，含自定义图片/音标）。
 * ============================================================ */
(function () {
    'use strict';

    function boot() {
        if (!window.ELC) { setTimeout(boot, 60); return; }
        main();
    }

    function main() {
        /* ================= 样式 ================= */
        var CSS = ''
            + '#extra-mode-view { justify-content: flex-start; gap: 12px; }'
            + '.ex-top { width: 100%; max-width: 640px; display: flex; align-items: center; flex-wrap: wrap; gap: 8px; position: relative; }'
            + '.ex-spacer { flex: 1 1 auto; min-width: 0; }'
            + '.ex-title { flex: 1 1 100%; order: 10; font-size: 1.1rem; font-weight: 900; background: linear-gradient(to right,#e94560,#f1c40f); -webkit-background-clip: text; background-clip: text; color: transparent; text-align: center; min-width: 0; }'
            + '.ex-chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(15,52,96,.7); border: 1px solid rgba(255,255,255,.14); border-radius: 999px; padding: 5px 10px; color: #eee; font-size: .9rem; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; flex: 0 0 auto; }'
            + '.ex-btn { background: rgba(15,52,96,.8); color: #eee; border: 1px solid rgba(255,255,255,.18); border-radius: 999px; padding: 6px 12px; cursor: pointer; font-size: .9rem; white-space: nowrap; flex: 0 0 auto; }'
            + '.ex-btn:active { transform: scale(.95); }'
            + '@media (max-width: 430px) { .ex-btn { padding: 6px 9px; font-size: .84rem; } .ex-chip { padding: 4px 8px; font-size: .84rem; } .ex-title { font-size: 1rem; } }'
            + '.lis-speaker { width: 130px; height: 130px; border-radius: 50%; border: 3px solid #f1c40f; background: radial-gradient(circle at 35% 30%, #2a3f6e, #16213e); color: #f1c40f; font-size: 3.2rem; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 0 26px rgba(241,196,15,.35); margin: 6px 0; }'
            + '.lis-speaker:active { transform: scale(.94); }'
            + '.lis-tip { color: rgba(255,255,255,.65); font-size: .9rem; }'
            + '.lis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; width: 100%; max-width: 640px; }'
            + '.lis-opt { background: linear-gradient(160deg,#0f3460,#16213e); border: 2px solid rgba(255,255,255,.18); border-radius: 14px; color: #eee; padding: 18px 10px; font-size: 1.25rem; font-weight: 700; cursor: pointer; min-height: 64px; }'
            + '.lis-opt.ok { border-color: #53d769; background: rgba(83,215,105,.18); }'
            + '.lis-opt.bad { border-color: #e94560; background: rgba(233,69,96,.18); animation: exshake .3s; }'
            + '@keyframes exshake { 0%,100% { transform: translateX(0); } 25% { transform: translateX(-7px); } 75% { transform: translateX(7px); } }'
            + '.lis-mean { min-height: 26px; color: #f1c40f; font-size: 1rem; text-align: center; }'
            + '.ex-modal { position: fixed; inset: 0; z-index: 1500; display: flex; align-items: center; justify-content: center; background: rgba(6,10,24,.9); padding: 18px; box-sizing: border-box; }'
            + '.ex-panel { background: linear-gradient(160deg,#0f3460,#16213e); border: 2px solid rgba(255,255,255,.18); border-radius: 18px; padding: 22px 20px; text-align: center; max-width: 92vw; width: 460px; max-height: 82vh; display: flex; flex-direction: column; gap: 12px; margin: auto; }'
            + '.ex-panel h2 { margin: 0; color: #f1c40f; font-size: 1.3rem; flex-shrink: 0; }'
            + '.ex-panel .sub { margin: 0; color: rgba(255,255,255,.75); font-size: .95rem; }'
            + '.ex-panel .big { font-size: 2rem; font-weight: 900; color: #eee; }'
            + '.ex-col { display: flex; flex-direction: column; gap: 10px; }'
            + '.ex-scroll { overflow-y: auto; flex: 1; min-height: 0; }'
            + '.ex-rules { margin: 0; text-align: left; color: rgba(255,255,255,.72); font-size: .85rem; line-height: 1.7; }'
            + '.ex-up-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-radius: 10px; background: rgba(15,52,96,.6); border: 1px solid rgba(255,255,255,.12); color: #eee; cursor: pointer; text-align: left; }'
            + '.ex-up-item:hover { border-color: #f1c40f; }'
            + '.ex-up-item .n { font-weight: 700; font-size: .9rem; word-break: break-all; }'
            + '.ex-up-item .c { color: rgba(255,255,255,.55); font-size: .78rem; white-space: nowrap; }'
            + '.ex-map { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; width: 100%; }'
            + '.ex-map-item { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 12px; border-radius: 12px; border: 2px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: #eee; cursor: pointer; text-align: left; }'
            + '.ex-map-item.locked { opacity: .45; cursor: not-allowed; }'
            + '.ex-map-item:active { transform: scale(.96); }'
            + '.ex-map-item .n { font-weight: 700; font-size: .95rem; }'
            + '.ex-map-item .s { color: #f1c40f; font-size: .85rem; white-space: nowrap; }'
            + '.mem-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; width: 100%; max-width: 640px; }'
            + '.mem-card { aspect-ratio: 3/3.4; perspective: 600px; cursor: pointer; background: none; border: none; padding: 0; }'
            + '.mem-inner { position: relative; width: 100%; height: 100%; transition: transform .35s; transform-style: preserve-3d; }'
            + '.mem-card.flip .mem-inner { transform: rotateY(180deg); }'
            + '.mem-face { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; border-radius: 12px; backface-visibility: hidden; -webkit-backface-visibility: hidden; font-weight: 700; padding: 4px; box-sizing: border-box; text-align: center; }'
            + '.mem-back { background: linear-gradient(160deg,#e94560,#b03060); color: #fff; font-size: 1.6rem; }'
            + '.mem-front { background: linear-gradient(160deg,#0f3460,#16213e); border: 2px solid rgba(255,255,255,.2); color: #eee; transform: rotateY(180deg); font-size: 1rem; word-break: break-word; }'
            + '.mem-card.done .mem-front { border-color: #53d769; }'
            + '.mem-word { font-size: 1.1rem; font-weight: 900; }'
            + '.mem-text { font-size: .85rem; opacity: .92; }'
            + '.ex-round-tip { color: #f1c40f; font-size: 1rem; text-align: center; min-height: 24px; }'
            + '#ex-review { position: fixed; inset: 0; z-index: 1500; display: none; align-items: center; justify-content: center; background: rgba(6,10,24,.88); padding: 18px; box-sizing: border-box; }'
            + '#ex-review .ex-words { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; max-width: 420px; }';
        var style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        var byId = function (id) { return document.getElementById(id); };
        function click(el) { try { el && el.click(); } catch (e) {} }
        function shuffle(arr) { for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; }
        function chunk(arr, n) { var out = []; for (var i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; }
        function sortS(s) { return String(s).split('').sort().join(''); }
        function starStr(n) { return n > 0 ? '★★★'.slice(0, n) + '☆☆☆'.slice(0, 3 - n) : '☆☆☆'; }
        function dw(word) { try { return (ELC.dw && ELC.dw(word)) || word; } catch (e) { return word; } }
        function normWord(w) {
            /* 统一词对象：{word, display, mean, img, audio, tts}
               tts 保留 ELC.words() 给出的目标语言读法（中文=汉字，避免 TTS 把拼音读成 ni-ha-o） */
            return {
                word: w.word, display: w.display || dw(w.word) || w.word,
                mean: w.mean || '', img: w.img || '📝', audio: w.audio || null,
                tts: w.tts || w.word
            };
        }
        /* 朗读词对象：优先自定义音频，其次游戏内 speakWord（离线 mp3/wav→TTS 回退链，
           中文自动用汉字读音），保证「你好」读 ni-hao 而不是把拼音拆成 ni-ha-o */
        function speakWordObj(w, cb) {
            if (w && w.audio) {
                try {
                    var a = new Audio(w.audio); a.volume = 1;
                    if (cb) a.onended = function () { setTimeout(cb, 120); };
                    var p = a.play(); if (p && p.catch) p.catch(function () { speakFall(w, cb); });
                    return;
                } catch (e) { /* 落入回退 */ }
            }
            speakFall(w, cb);
        }
        function speakFall(w, cb) {
            var t = (w && w.tts) || (w && w.word) || '';
            if (!t) { if (cb) setTimeout(cb, 200); return; }
            if (ELC.speak) { try { ELC.speak(t, cb); return; } catch (e) {} }
            ELC.tts(t);
            if (cb) setTimeout(cb, 1400);
        }
        function sampleOthers(pool, not, n) { var o = pool.filter(function (x) { return x.word !== not.word; }); shuffle(o); return o.slice(0, n); }
        function loadProg(key) { try { var p = JSON.parse(localStorage.getItem(key)); if (p && p.unlocked) return p; } catch (e) {} return { unlocked: 1, stars: {} }; }
        function saveProg(key, p) { try { localStorage.setItem(key, JSON.stringify(p)); } catch (e) {} }
        function parseCustomText(text) {
            var list = [];
            (text || '').split(/[;\n]/).forEach(function (line) {
                if (!line.trim()) return;
                var m = line.split(/[,，]/);
                if (m.length >= 2 && m[0].trim() && m[1].trim()) list.push({ word: m[0].trim(), mean: m.slice(1).join(',').trim() });
            });
            return list;
        }
        function openEndPanel(endId, titleText, stars, scoreText, buttons) {
            var oldEl = byId(endId); if (oldEl) oldEl.remove();
            var el = document.createElement('div');
            el.id = endId; el.className = 'ex-modal';
            var btnHtml = buttons.map(function (b, i) {
                return '<button class="btn-action' + (b.secondary ? ' btn-secondary' : '') + '" data-bidx="' + i + '">' + b.label + '</button>';
            }).join('');
            el.innerHTML = '<div class="ex-panel">'
                + '<h2>' + titleText + '</h2>'
                + (stars ? '<div style="color:#f1c40f;font-size:1.7rem;letter-spacing:6px;">' + stars + '</div>' : '')
                + '<div class="big">' + scoreText + '</div>'
                + '<div class="ex-col" id="' + endId + '-btns">' + btnHtml + '</div>'
                + '</div>';
            document.body.appendChild(el);
            buttons.forEach(function (b, i) {
                var btn = el.querySelector('[data-bidx="' + i + '"]');
                if (btn) btn.addEventListener('click', function () { el.remove(); ELC.click(); b.fn(); });
            });
        }

        /* ================= 学习卡（复用全局 wordPopup，与填词/闯关一致） ================= */
        var learnTimer = null, learnTtsTimer = null;
        function showLearnCard(word) {
            var pop = byId('wordPopup');
            if (!pop) return;
            try {
                var isUrl = word.img && /^(blob:|data:|https?:)/.test(word.img);
                var emojiEl = byId('popupEmoji');
                if (emojiEl) emojiEl.innerHTML = isUrl
                    ? '<img src="' + word.img + '" style="width:110px;height:110px;object-fit:contain;border-radius:14px;background:rgba(255,255,255,.25);">'
                    : (word.img || '📝');
                var wEl = byId('popupWord');
                if (wEl) wEl.innerText = word.display;
                var ipa = ELC.ipa ? (ELC.ipa(word.word) || '') : '';
                var mEl = byId('popupMeaning');
                if (mEl) mEl.innerText = (word.mean || '') + (ipa ? '　' + ipa : '');
                var sEl = byId('popupScore');
                if (sEl) { sEl.innerText = ''; sEl.classList.add('hidden'); }
                pop.style.background = 'linear-gradient(135deg,#f1c40f,#e94560)';
                pop.classList.remove('hidden');
                setTimeout(function () { pop.classList.add('show'); }, 10);
                if (learnTtsTimer) clearTimeout(learnTtsTimer);
                speakWordObj(word, function () {
                    /* 词读完再读释义，不与词音重叠 */
                    if (word.mean) learnTtsTimer = setTimeout(function () { try { ELC.tts(word.mean); } catch (e) {} }, 250);
                });
            } catch (e) {}
            if (learnTimer) clearTimeout(learnTimer);
            learnTimer = setTimeout(function () {
                pop.classList.remove('show');
                setTimeout(function () { pop.classList.add('hidden'); }, 300);
            }, 1700);
        }

        /* ================= 居中弹窗 ================= */
        function closeModal() { var el = byId('ex-modal-overlay'); if (el) el.remove(); }
        function openModal(html) {
            closeModal();
            var el = document.createElement('div');
            el.id = 'ex-modal-overlay';
            el.className = 'ex-modal';
            el.innerHTML = html;
            document.body.appendChild(el);
            return el;
        }
        function openPause(titleText, onResume, onReplay, onMap, onExit) {
            var old = byId('ex-pause'); if (old) old.remove();
            var el = document.createElement('div');
            el.id = 'ex-pause'; el.className = 'ex-modal';
            el.innerHTML = '<div class="ex-panel">'
                + '<h2>' + titleText + '</h2>'
                + '<div class="ex-col">'
                + '<button class="btn-action" id="ex-p-resume">' + ELC.t('m3Resume') + '</button>'
                + '<button class="btn-action btn-secondary" id="ex-p-replay">' + ELC.t('m3Restart') + '</button>'
                + '<button class="btn-action btn-secondary" id="ex-p-map">' + ELC.t('m3Map') + '</button>'
                + '<button class="btn-action btn-secondary" id="ex-p-exit">' + ELC.t('qHome') + '</button>'
                + '</div></div>';
            document.body.appendChild(el);
            byId('ex-p-resume').addEventListener('click', function () { el.remove(); onResume(); });
            byId('ex-p-replay').addEventListener('click', function () { el.remove(); onReplay(); });
            byId('ex-p-map').addEventListener('click', function () { el.remove(); onMap(); });
            byId('ex-p-exit').addEventListener('click', function () { el.remove(); onExit(); });
        }
        function openMap(title, levels, prog, onPick) {
            var html = '<div class="ex-panel">'
                + '<h2>' + title + ' · ' + ELC.t('m3Map') + '</h2>'
                + '<div class="ex-scroll"><div class="ex-map" id="ex-map-list"></div></div>'
                + '<button class="btn-action btn-secondary" id="ex-map-back">' + ELC.t('back') + '</button>'
                + '</div>';
            openModal(html);
            var list = byId('ex-map-list');
            list.innerHTML = '';
            levels.forEach(function (words, i) {
                var locked = i + 1 > prog.unlocked;
                var st = prog.stars[i + 1] || 0;
                var b = document.createElement('button');
                b.className = 'ex-map-item' + (locked ? ' locked' : '');
                b.innerHTML = '<span class="n">' + ELC.t('qStage', { n: i + 1 }) + ' · ' + words[0].display + '…</span><span class="s">' + (locked ? '🔒' : starStr(st)) + '</span>';
                if (!locked) b.addEventListener('click', function () { closeModal(); ELC.click(); onPick(i); });
                list.appendChild(b);
            });
            byId('ex-map-back').addEventListener('click', function () { closeModal(); ELC.click(); ELC.closeExtraView(); });
        }

        /* ================= 词源选择（与填词/闯关同构） ================= */
        var LIS_PER = 5;    // 听力 5 词一关
        var MEM_PER = 6;    // 记忆 6 词一轮
        var currentPick = { mode: 'listen', onPick: function () {} };

        function openPackModal(mode, onPick) {
            currentPick = { mode: mode, onPick: onPick };
            var isListen = mode === 'listen';
            var icon = isListen ? '🎧' : '🃏';
            var title = isListen ? ELC.t('mcListenName') : ELC.t('mcMemName');
            var sub = isListen ? ELC.t('mcListenDesc') : ELC.t('mcMemDesc');
            var rules = isListen
                ? ['✅ 5 词一关：按配置顺序听音，选出对应词语', '✅ 干扰选项自动生成，越练越准', '✅ 答对即弹学习卡：单词 · 释义 · 发音']
                : ['✅ 6 词一屏：词语与释义打乱翻牌', '✅ 配对成功同色关联，弹出学习卡', '✅ 超过 6 词自动分组，学完整关才通关'];
            var html = '<div class="ex-panel">'
                + '<h2>' + icon + ' ' + title + '</h2>'
                + '<div class="sub">' + sub + '</div>'
                + '<div class="ex-col">'
                + '<button class="btn-action" data-pack="daily">' + ELC.t('packDaily') + '</button>'
                + '<button class="btn-action" data-pack="cet4">' + ELC.t('packCet4') + '</button>'
                + '<button class="btn-action" data-pack="cet6">' + ELC.t('packCet6') + '</button>'
                + '<button class="btn-action btn-secondary" data-pack="custom">' + ELC.t('packCustom') + '</button>'
                + '</div>'
                + '<div class="ex-rules">' + rules.join('<br>') + '</div>'
                + '<button class="btn-action btn-secondary" id="ex-pack-back">' + ELC.t('back') + '</button>'
                + '</div>';
            var overlay = openModal(html);
            overlay.querySelectorAll('[data-pack]').forEach(function (b) {
                b.addEventListener('click', function () {
                    ELC.click();
                    closeModal();
                    var pk = b.getAttribute('data-pack');
                    if (pk === 'custom') openCustomScreen(mode, onPick);
                    else onPick(ELC.packWords(pk).map(normWord), pk);
                });
            });
            byId('ex-pack-back').addEventListener('click', function () { closeModal(); ELC.click(); ELC.closeExtraView(); });
        }

        /* ================= 自定义关卡（词表 + 上传） ================= */
        function openCustomScreen(mode, onPick) {
            currentPick = { mode: mode, onPick: onPick };
            var isListen = mode === 'listen';
            var startLabel = isListen ? '▶ ' + ELC.t('mcListenName') : '▶ ' + ELC.t('mcMemName');
            var html = '<div class="ex-panel">'
                + '<h2>' + ELC.t('packCustom') + '</h2>'
                + '<textarea id="ex-custom-text" style="width:100%;min-height:120px;border-radius:10px;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.3);color:#eee;padding:10px;box-sizing:border-box;font-family:inherit;"></textarea>'
                + '<div style="color:rgba(255,255,255,.55);font-size:.8rem;text-align:left;margin-top:4px;">' + ELC.t('customTip') + '</div>'
                + '<button class="btn-action" id="ex-custom-start">' + startLabel + '</button>'
                + '<button class="btn-action" id="ex-open-upload">📤 ' + ELC.t('uploadLevel') + '</button>'
                + '<div id="ex-up-list" class="ex-col" style="margin-top:2px;"></div>'
                + '<button class="btn-action btn-secondary" id="ex-custom-back">' + ELC.t('back') + '</button>'
                + '</div>';
            var overlay = openModal(html);
            var custom = ELC.customPack();
            var ta = byId('ex-custom-text');
            if (custom && custom.length && ta && !ta.value) {
                ta.value = custom.map(function (x) { return x.word + ',' + x.mean; }).join('\n');
            }
            function renderUpList() {
                var box = byId('ex-up-list');
                if (!box) return;
                var ups = ELC.uploadedLevelList();
                box.innerHTML = ups.length ? '<div style="color:rgba(255,255,255,.55);font-size:.8rem;text-align:left;">📦 已上传关卡（点击开始）</div>' : '';
                ups.forEach(function (l, i) {
                (window.__m3log = window.__m3log || []).push('renderUpListItem: ' + l.name + ' words=' + l.words.map(w => w.word).join(','));
                    var b = document.createElement('button');
                    b.className = 'ex-up-item';
                    b.innerHTML = '<span class="n">' + (i + 1) + '. ' + l.name + '</span><span class="c">' + l.words.length + ' 词</span>';
                    b.addEventListener('click', function () {
                        ELC.click();
                        var words = l.words.map(normWord);
                        closeModal();
                        onPick(words, 'up:' + l.name);
                    });
                    box.appendChild(b);
                });
            }
            renderUpList();
            byId('ex-custom-start').addEventListener('click', function () {
                ELC.click();
                var raw = (byId('ex-custom-text').value || '').trim();
                var list = parseCustomText(raw);
                if (list.length < 4) { ELC.toast(ELC.t('errEmpty')); return; }
                ELC.setCustomPack(list);
                var words = list.map(function (x) { return normWord({ word: x.word, mean: x.mean, img: '📝' }); });
                closeModal();
                onPick(words, 'custom');
            });
            byId('ex-open-upload').addEventListener('click', function () {
                ELC.click();
                closeModal();   // 关闭自定义界面，避免开始游戏后残留在最上层
                if (ELC.setUploadContext) ELC.setUploadContext(mode);
                if (ELC.openUploadModal) ELC.openUploadModal();
                var closeBtn = byId('btnCloseUploadModal');
                if (closeBtn) closeBtn.addEventListener('click', function () {
                    setTimeout(function () {
                        var ev = byId('extra-mode-view');
                        if (ev && ev.style.display === 'flex') {
                            var ov = byId('overlay');
                            if (ov) ov.style.display = 'none';
                            openCustomScreen(mode, onPick);   // 回到本界面并刷新已上传列表
                        }
                    }, 80);
                }, { once: true });
            });
            byId('ex-custom-back').addEventListener('click', function () { closeModal(); ELC.click(); openPackModal(mode, onPick); });
        }

        /* ================= 🎧 听力挑战（5 词一关，顺序出题） ================= */
        function startListenLevels(levels, srcTag) {
            (window.__m3log = window.__m3log || []).push('startListenLevels: ' + levels.map(l => l.map(w => w.word).join(',')).join(' ;; '));
            if (!levels.length) { ELC.toast(ELC.t('errNoWords')); ELC.closeExtraView(); return; }
            var progKey = 'elc_listen_prog_' + ELC.learningLang + '_' + srcTag;
            var prog = loadProg(progKey);
            playListenLevel(levels, 0, prog, progKey, srcTag);   // 直接进入第一关
        }
        function openListenMap(levels, srcTag) {
            var progKey = 'elc_listen_prog_' + ELC.learningLang + '_' + srcTag;
            var prog = loadProg(progKey);
            openMap(ELC.t('mcListenName'), levels, prog, function (idx) {
                playListenLevel(levels, idx, prog, progKey, srcTag);
            });
        }
        function playListenLevel(levels, idx, prog, progKey, srcTag) {
            try { if (window.HERO && window.HERO.markCoins) window.HERO.markCoins(); } catch (e) {}   /* 本局金币记账 */
            var words = levels[idx];
            var state = { score: 0, streak: 0, hearts: 3, asked: 0, order: words.slice(), cur: null, lock: false, paused: false, pendingNext: false };
            var highKey = 'elc_listen_high_' + ELC.learningLang;
            var high = parseInt(localStorage.getItem(highKey) || '0', 10);

            ELC.openExtraView(
                '<div class="ex-top">'
                + '<button class="ex-btn" id="lis-pause">' + ELC.t('qPauseBtn') + '</button>'
                + '<button class="ex-btn" id="lis-map">' + ELC.t('mapBtn') + '</button>'
                + '<div class="ex-spacer"></div>'
                + '<span class="ex-chip">⭐ <span id="lis-score">0</span></span>'
                + '<span class="ex-chip">❤️ <span id="lis-hearts">3</span></span>'
                + '<span class="ex-chip">🔥 <span id="lis-streak">0</span></span>'
                + '<button class="ex-btn" id="lis-exit">' + ELC.t('qHome') + '</button>'
                + '<div class="ex-title">' + ELC.t('mcListenName') + '</div>'
                + '</div>'
                + '<div class="lis-mean" id="lis-mean"></div>'
                + '<button class="lis-speaker" id="lis-play">🔊</button>'
                + '<div class="lis-tip">' + ELC.t('wListen') + '</div>'
                + '<div class="lis-grid" id="lis-grid"></div>');

            function updateHUD() {
                byId('lis-score').textContent = state.score;
                byId('lis-hearts').textContent = state.hearts;
                byId('lis-streak').textContent = state.streak;
            }
            function question() {
                if (state.paused) { state.pendingNext = true; return; }
                if (state.hearts <= 0 || state.asked >= words.length) { end(); return; }
                state.cur = state.order[state.asked];
                state.asked++;
                state.lock = false;
                var nOpts = state.streak >= 6 ? 5 : 4;
                var others = sampleOthers(words, state.cur, Math.min(nOpts - 1, Math.max(0, words.length - 1)));
                if (others.length < nOpts - 1) others = others.concat(sampleOthers(ELC.words(), state.cur, nOpts - 1 - others.length));
                var opts = shuffle(others.slice(0, nOpts - 1).concat([state.cur]));
                var grid = byId('lis-grid');
                grid.innerHTML = '';
                opts.forEach(function (o) {
                    var b = document.createElement('button');
                    b.className = 'lis-opt';
                    b.textContent = o.display;
                    b.addEventListener('click', function () { answer(o, b); });
                    grid.appendChild(b);
                });
                var meanEl = byId('lis-mean'); if (meanEl) meanEl.textContent = '';
                setTimeout(function () { if (!state.paused && state.cur) speakWordObj(state.cur); }, 250);
            }
            function answer(o, btn) {
                if (state.lock) return;
                state.lock = true;
                var ok = o.word === state.cur.word;
                if (ok) {
                    btn.classList.add('ok');
                    state.streak++;
                    state.score += 50 + Math.min(state.streak, 10) * 10;
                    ELC.tone(880, 0.08, 'sine', 0.1);
                    try { ELC.rewardCoins && ELC.rewardCoins(2); } catch (e) {}   /* 听对得金币 */
                } else {
                    btn.classList.add('bad');
                    state.hearts--; state.streak = 0;
                    ELC.tone(160, 0.2, 'sawtooth', 0.12);
                    [...document.querySelectorAll('#lis-grid .lis-opt')].forEach(function (el) {
                        if (el.textContent === state.cur.display) el.classList.add('ok');
                    });
                }
                var meanEl = byId('lis-mean'); if (meanEl) meanEl.textContent = state.cur.display + ' · ' + state.cur.mean;
                showLearnCard(state.cur);
                ELC.trackLearned(state.cur.display, state.cur.mean, state.cur.img);
                updateHUD();
                setTimeout(function () { if (!state.paused) question(); else state.pendingNext = true; }, ok ? 1500 : 2100);
            }
            function end() {
                var pass = state.hearts > 0;
                var stars = !pass ? 0 : (state.hearts >= 3 ? 3 : (state.hearts === 2 ? 2 : 1));
                if (pass) { prog.stars[idx + 1] = Math.max(prog.stars[idx + 1] || 0, stars); prog.unlocked = Math.max(prog.unlocked, Math.min(idx + 2, levels.length)); saveProg(progKey, prog); }
                var isHigh = state.score > high;
                if (isHigh) { localStorage.setItem(highKey, String(state.score)); high = state.score; }
                var btns = [
                    { label: ELC.t('m3Again'), fn: function () { playListenLevel(levels, idx, prog, progKey, srcTag); } }
                ];
                if (pass && idx + 1 < levels.length) {
                    btns.unshift({ label: ELC.t('qNextStage'), fn: function () { playListenLevel(levels, idx + 1, prog, progKey, srcTag); } });
                }
                btns.push({ label: ELC.t('m3Map'), secondary: true, fn: function () { openListenMap(levels, srcTag); } });
                btns.push({ label: ELC.t('qHome'), secondary: true, fn: function () { ELC.closeExtraView(); } });
                var dcoin = 0; try { if (window.HERO) dcoin = window.HERO.deltaCoins(); } catch (e) {}
                openEndPanel('lis-end', pass ? ELC.t('qWin') : ELC.t('qFail'), stars ? starStr(stars) : '', String(state.score) + (dcoin > 0 ? '　·　' + (window.HERO.coinIcon ? window.HERO.coinIcon() : '') + ' +' + dcoin : ''), btns);
            }
            byId('lis-play').addEventListener('click', function () { if (state.cur) speakWordObj(state.cur); });
            byId('lis-map').addEventListener('click', function () { openListenMap(levels, srcTag); });
            byId('lis-exit').addEventListener('click', function () { ELC.closeExtraView(); });
            byId('lis-pause').addEventListener('click', function () {
                state.paused = true;
                openPause(ELC.t('mcListenName'),
                    function () { state.paused = false; if (state.pendingNext) { state.pendingNext = false; question(); } },
                    function () { state.paused = false; playListenLevel(levels, idx, prog, progKey, srcTag); },
                    function () { openListenMap(levels, srcTag); },
                    function () { ELC.closeExtraView(); });
            });
            updateHUD();
            question();
        }

        /* ================= 🃏 记忆配对（6 词一轮，整关学完才通关） ================= */
        function startMemoryLevels(levels, srcTag) {
            (window.__m3log = window.__m3log || []).push('startMemoryLevels: ' + levels.map(l => l.map(w => w.word).join(',')).join(' ;; '));
            if (!levels.length) { ELC.toast(ELC.t('errNoWords')); ELC.closeExtraView(); return; }
            var progKey = 'elc_mem_prog_' + ELC.learningLang + '_' + srcTag;
            var prog = loadProg(progKey);
            playMemoryLevel(levels, 0, prog, progKey, srcTag);   // 直接进入第一关
        }
        function openMemoryMap(levels, srcTag) {
            var progKey = 'elc_mem_prog_' + ELC.learningLang + '_' + srcTag;
            var prog = loadProg(progKey);
            openMap(ELC.t('mcMemName'), levels, prog, function (idx) {
                playMemoryLevel(levels, idx, prog, progKey, srcTag);
            });
        }
        function playMemoryLevel(levels, idx, prog, progKey, srcTag) {
            try { if (window.HERO && window.HERO.markCoins) window.HERO.markCoins(); } catch (e) {}   /* 本局金币记账 */
            var words = levels[idx];
            var CH = 6;   // 每屏 6 词
            var state = { round: idx + 1, offset: 0, moves: 0, score: 0, first: null, lock: false, matched: 0, roundTotal: Math.min(CH, words.length), paused: false };
            var bestKey = 'elc_mem_best_' + ELC.learningLang;
            var bestRound = parseInt(localStorage.getItem(bestKey) || '1', 10);

            ELC.openExtraView(
                '<div class="ex-top">'
                + '<button class="ex-btn" id="mem-pause">' + ELC.t('qPauseBtn') + '</button>'
                + '<button class="ex-btn" id="mem-map">' + ELC.t('mapBtn') + '</button>'
                + '<div class="ex-spacer"></div>'
                + '<span class="ex-chip">📌 <span id="mem-stage"></span></span>'
                + '<span class="ex-chip">🔄 <span id="mem-moves">0</span></span>'
                + '<span class="ex-chip">⭐ <span id="mem-score">0</span></span>'
                + '<button class="ex-btn" id="mem-exit">' + ELC.t('qHome') + '</button>'
                + '<div class="ex-title">' + ELC.t('mcMemName') + '</div>'
                + '</div>'
                + '<div class="ex-round-tip" id="mem-round"></div>'
                + '<div class="mem-grid" id="mem-grid"></div>');

            function updateHUD() {
                var st = byId('mem-stage'), mv = byId('mem-moves'), sc = byId('mem-score');
                if (st) st.textContent = ELC.t('qStage', { n: state.round });
                if (mv) mv.textContent = state.moves;
                if (sc) sc.textContent = state.score;
                var rt = byId('mem-round');
                if (rt) {
                    var groups = Math.ceil(words.length / CH);
                    rt.innerText = groups > 1 ? ('第 ' + (state.offset / CH + 1) + ' / ' + groups + ' 组') : '';
                }
            }
            function buildGrid() {
                var slice = words.slice(state.offset, state.offset + CH);
                state.matched = 0; state.roundTotal = slice.length; state.first = null; state.lock = false;
                var cards = [];
                slice.forEach(function (w, i) {
                    cards.push({ pair: state.offset + i, type: 'word', text: w.display, word: w });
                    cards.push({ pair: state.offset + i, type: 'mean', text: w.mean, word: w });
                });
                shuffle(cards);
                var grid = byId('mem-grid');
                grid.innerHTML = '';
                cards.forEach(function (c) {
                    var b = document.createElement('button');
                    b.className = 'mem-card';
                    b.dataset.pair = c.pair;
                    b.dataset.type = c.type;
                    b.innerHTML = '<div class="mem-inner"><div class="mem-face mem-back">❓</div>'
                        + '<div class="mem-face mem-front ' + (c.type === 'word' ? 'mem-word' : 'mem-text') + '">' + c.text + '</div></div>';
                    b.addEventListener('click', function () { flip(b, c); });
                    grid.appendChild(b);
                });
                updateHUD();
            }
            function flip(btn, card) {
                if (state.paused || state.lock || btn.classList.contains('flip') || btn.classList.contains('done')) return;
                btn.classList.add('flip');
                if (!state.first) { state.first = { btn: btn, card: card }; return; }
                var a = state.first; state.first = null;
                state.moves++;
                updateHUD();
                if (a.card.pair === card.pair && a.card.type !== card.type) {
                    a.btn.classList.add('done'); btn.classList.add('done');
                    /* 同一对卡片统一背景色，词与释义的关联一目了然 */
                    var hue = (a.card.pair * 47 + 195) % 360;
                    var pairBg = 'hsl(' + hue + ', 45%, 40%)';
                    [a.btn, btn].forEach(function (cc) {
                        cc.style.borderColor = pairBg;
                        var front = cc.querySelector('.mem-front');
                        if (front) front.style.background = pairBg;
                    });
                    state.matched++; state.score += 100;
                    ELC.tone(660, 0.1, 'sine', 0.1);
                    try { ELC.rewardCoins && ELC.rewardCoins(2); } catch (e) {}   /* 配对成功得金币 */
                    showLearnCard(card.word);
                    speakWordObj(card.word);
                    updateHUD();
                    if (state.matched >= state.roundTotal) {
                        if (state.offset + CH < words.length) {
                            state.offset += CH;
                            setTimeout(function () { if (!state.paused) buildGrid(); }, 600);
                        } else {
                            setTimeout(levelDone, 1000);
                        }
                    }
                } else {
                    state.lock = true;
                    setTimeout(function () { a.btn.classList.remove('flip'); btn.classList.remove('flip'); state.lock = false; }, 850);
                }
            }
            function levelDone() {
                var stars = state.moves <= 9 ? 3 : (state.moves <= 16 ? 2 : 1);
                prog.stars[idx + 1] = Math.max(prog.stars[idx + 1] || 0, stars);
                prog.unlocked = Math.max(prog.unlocked, Math.min(idx + 2, levels.length));
                saveProg(progKey, prog);
                if (state.round > bestRound) { localStorage.setItem(bestKey, String(state.round)); }
                var btns = [];
                if (idx + 1 < levels.length) btns.push({ label: ELC.t('qNextStage'), fn: function () { playMemoryLevel(levels, idx + 1, prog, progKey, srcTag); } });
                btns.push({ label: ELC.t('qReplay'), secondary: true, fn: function () { playMemoryLevel(levels, idx, prog, progKey, srcTag); } });
                btns.push({ label: ELC.t('m3Map'), secondary: true, fn: function () { openMemoryMap(levels, srcTag); } });
                var mcoin = 0; try { if (window.HERO) mcoin = window.HERO.deltaCoins(); } catch (e) {}
                openEndPanel('mem-end', ELC.t('qWin'), starStr(stars), String(state.score) + (mcoin > 0 ? '　·　' + (window.HERO.coinIcon ? window.HERO.coinIcon() : '') + ' +' + mcoin : ''), btns);
            }
            byId('mem-map').addEventListener('click', function () { openMemoryMap(levels, srcTag); });
            byId('mem-exit').addEventListener('click', function () { ELC.closeExtraView(); });
            byId('mem-pause').addEventListener('click', function () {
                state.paused = true;
                openPause(ELC.t('mcMemName'),
                    function () { state.paused = false; },
                    function () { playMemoryLevel(levels, idx, prog, progKey, srcTag); },
                    function () { openMemoryMap(levels, srcTag); },
                    function () { ELC.closeExtraView(); });
            });
            buildGrid();
        }

        /* ================= 模式注册与启动 ================= */
        function startListen(words, srcTag) {
            /* words: 词对象数组；srcTag: 进度存档标签。始终 5 词一关（顺序分关） */
            startListenLevels(chunk(words, LIS_PER), srcTag);
        }
        function startMemory(words, srcTag) {
            /* words: 词对象数组；srcTag: 进度存档标签。
               自定义/上传（up: / custom）＝整关一词组，内部 6 词分轮；常规词库＝6 词一关 */
            var levels = (String(srcTag).indexOf('up:') === 0 || srcTag === 'custom') ? [words] : chunk(words, MEM_PER);
            startMemoryLevels(levels, srcTag);
        }
        ELC.registerMode({ id: 'listen', icon: '🎧', nameKey: 'mcListenName', descKey: 'mcListenDesc', start: function () { openPackModal('listen', startListen); } });
        ELC.registerMode({ id: 'memory', icon: '🃏', nameKey: 'mcMemName', descKey: 'mcMemDesc', start: function () { openPackModal('memory', startMemory); } });
        window.ELC.__rt = function (mode) {
            openCustomScreen(mode, currentPick.onPick);
        };
        ELC.startUploaded = function (mode) {
            /* 无论从哪个入口开始，先收起所有上传相关弹窗 */
            ['uploadLevelModal', 'uploadModeModal', 'levelSelectModal'].forEach(function (id) {
                var m = byId(id); if (m) m.style.display = 'none';
            });
            var ov = byId('overlay'); if (ov) ov.style.display = 'none';
            var ups = ELC.uploadedLevelList();
            if (!ups.length) { ELC.toast(ELC.t('errNoWords')); return; }
            if (mode === 'listen') {
                var all = [];
                ups.forEach(function (l) { l.words.forEach(function (w) { all.push(normWord(w)); }); });
                startListen(all, 'up');
            } else {
                var lv = ups.map(function (l) { return l.words.map(normWord); });
                startMemoryLevels(lv, 'up');
            }
        };

        /* ================= 复习提醒（暂时屏蔽） =================
         * 复习弹窗会在对局中突然弹出打断玩家，且进入复习后原模式仍在后台运行、
         * 音效叠加。在重新设计好嵌入方式之前整体关闭（REVIEW_ENABLED=false），
         * 相关逻辑保留以便日后恢复。 */
        var REVIEW_ENABLED = false;
        var REVIEW_HOURS = [6, 12, 18, 22];
        function todayStr() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
        function currentSlot() { var h = new Date().getHours(); var s = -1; for (var i = 0; i < REVIEW_HOURS.length; i++) { if (h >= REVIEW_HOURS[i]) s = i; } return s; }
        function startReviewTimer() {
            var check = function () {
                try {
                    if (!window.ELC) return;
                    if (localStorage.getItem('elc_review_off') === todayStr()) return;
                    var slot = currentSlot(); if (slot < 0) return;
                    var learned = ELC.learnedWords();
                    if (!learned.length) return;
                    var last = localStorage.getItem('elc_review_slot');
                    if (last === slot + '-' + todayStr()) return;
                    localStorage.setItem('elc_review_slot', slot + '-' + todayStr());
                    showReview(learned);
                    notifyReview(learned.length);
                } catch (e) {}
            };
            check();
            setInterval(check, 5 * 60 * 1000);
        }
        function showReview(learned) {
            if (byId('ex-review')) return;
            var picked = shuffle(learned.slice(0, 10)).slice(0, 6);
            var el = document.createElement('div');
            el.id = 'ex-review';
            el.innerHTML = '<div class="ex-panel">'
                + '<h2>🔁 ' + (ELC.t('reviewTitle') || '复习时间') + '</h2>'
                + '<div style="color:#eee;">' + picked.length + ' 个学过的词，来复习一下吧！</div>'
                + '<div class="ex-words">' + picked.map(function (x) { return '<button class="ex-btn" data-w="' + x.w + '">🔊 ' + x.w + '</button>'; }).join('') + '</div>'
                + '<div class="ex-col">'
                + '<button class="btn-action" id="ex-r-start">' + (ELC.t('reviewStart') || '开始复习') + '</button>'
                + '<button class="btn-action btn-secondary" id="ex-r-off">' + (ELC.t('reviewOff') || '今天不再提醒') + '</button>'
                + '<button class="btn-action btn-secondary" id="ex-r-ok">' + (ELC.t('reviewLater') || '稍后') + '</button>'
                + '</div></div>';
            document.body.appendChild(el);
            el.style.display = 'flex';
            el.querySelectorAll('.ex-btn[data-w]').forEach(function (chip) { chip.addEventListener('click', function () { ELC.tts(chip.dataset.w); }); });
            byId('ex-r-start').addEventListener('click', function () { ELC.click(); el.remove(); var c0 = [...document.querySelectorAll('#modeExtraCards .mode-card')][0]; if (c0) c0.click(); });
            byId('ex-r-off').addEventListener('click', function () { ELC.click(); localStorage.setItem('elc_review_off', todayStr()); el.remove(); });
            byId('ex-r-ok').addEventListener('click', function () { ELC.click(); el.remove(); });
        }
        function notifyReview(n) {
            if (!('Notification' in window) || Notification.permission !== 'granted') return;
            try { new Notification('复习时间', { body: n + ' 个学过的词等你复习', tag: 'elc-review' }); } catch (e) {}
        }

        /* ================= 启动 ================= */
        if (ELC.renderModes) ELC.renderModes();
        if (REVIEW_ENABLED) startReviewTimer();
    }

    boot();
})();
