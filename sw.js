// service worker：cache-first 策略 + 版號管理（階段 3 PWA）
// 命名慣例仿照 PocketMon 專案：<專案>-toolbox-v<版號>；日後有變動就把版號 +1，
// activate 事件會自動清掉不符合目前版號的舊快取。
'use strict';

var CACHE_NAME = 'image-stitcher-toolbox-v1';

// precache：首頁本體與 PWA 必要資源，安裝時就先存進快取
var PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      console.log('[SW] install：precache 開始 →', PRECACHE_URLS);
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      // 新版 SW 立即取代舊版，不用等所有分頁關閉
      return self.skipWaiting();
    })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys
          .filter(function (key) { return key !== CACHE_NAME; })
          .map(function (key) {
            console.log('[SW] activate：清除舊版快取 →', key);
            return caches.delete(key);
          })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// cache-first：先查快取，有就直接回傳；沒有才發網路請求，成功的話存回快取供下次使用
self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) {
        console.log('[SW] cache hit: ' + event.request.url);
        return cached;
      }
      console.log('[SW] cache miss, fetching: ' + event.request.url);
      return fetch(event.request).then(function (response) {
        // 只快取同源、成功的一般回應（避免快取到不透明的跨源回應或錯誤頁）
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        var responseClone = response.clone();
        caches.open(CACHE_NAME).then(function (cache) {
          cache.put(event.request, responseClone);
        });
        return response;
      }).catch(function () {
        // 離線且快取沒有時，就只能回傳失敗（沒有額外的離線後備頁面，維持單檔極簡架構）
        return cached;
      });
    })
  );
});
