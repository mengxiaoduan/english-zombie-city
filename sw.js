/* 世界语言方块 PWA Service Worker：离线缓存 */
const CACHE = 'eng-tetris-v53';
/* sounds/ 下约 6300 个单词读音 mp3 体积较大，不预缓存；
   下面的 fetch 监听会按需缓存听过的读音（首次在线播放后离线可用） */
const ASSETS = [
  './index.html',
  './game.html',
  './i18n.js',
  './manifest.webmanifest',
  './jszip.min.js',
  './wordbank_daily.js',
  './wordbank_cet4.js',
  './wordbank_cet6.js',
  './wordbank_phon.js',
  './wordbank_zh.js',
  './wordbank_ru.js',
  './word_fx_data.js',
  './word_fx.js',
  './modes_extra.js',
  './hero_system.js',
  './peerjs.min.js',
  './meanings.js',
  './hanzi-writer.min.js',
  './hanzi_data.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit;
      return fetch(e.request).then((resp) => {
        if (resp.ok && new URL(e.request.url).origin === location.origin) {
          const clone = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
