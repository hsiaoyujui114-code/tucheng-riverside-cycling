// 土城學府公園・小騎士雙北河濱單車探索地圖 - Service Worker
// 提供 100% 離線使用、快速快取與無網路導航支援

const CACHE_NAME = 'tucheng-cycling-pwa-v2';

const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './routes-data.js',
  './game.js',
  './manifest.json',
  'https://cdn.tailwindcss.com',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.2/dist/confetti.browser.min.js'
];

// 安裝事件：快取核心靜態資產
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      console.log('[SW] 正在預載核心資產快取...');
      // 依序或併行快取，有 CDN 失敗也不阻斷整體快取
      for (const asset of CORE_ASSETS) {
        try {
          await cache.add(asset);
        } catch (err) {
          console.warn('[SW] 快取資產警告:', asset, err);
        }
      }
      return self.skipWaiting();
    })
  );
});

// 啟動事件：清除舊版本快取
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keyList) => {
      return Promise.all(
        keyList.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] 移除舊版快取:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 請求攔截：Stale-While-Revalidate / Cache First 策略
self.addEventListener('fetch', (event) => {
  // 僅處理 http/https 請求
  if (!event.request.url.startsWith('http')) return;

  // 地圖圖磚若有請求，快取成功的圖磚，失敗時優雅忽略
  const url = new URL(event.request.url);
  const isMapTile = url.hostname.includes('tile.openstreetmap.org') ||
                    url.hostname.includes('google.com') ||
                    url.hostname.includes('nlsc.gov.tw');

  if (isMapTile) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          return fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // 離線時圖磚若無快取，不噴紅字錯誤
            return new Response('', { status: 408, statusText: 'Tile Offline' });
          });
        });
      })
    );
    return;
  }

  // 對於核心應用程式檔案：Cache-First，背景更新
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // 背景嘗試網路更新快取 (Stale-While-Revalidate)
        fetch(event.request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, networkResponse);
            });
          }
        }).catch(() => {
          // 離線狀態正常運作
        });
        return cachedResponse;
      }

      // 未快取者走網路請求並加入快取
      return fetch(event.request).then((networkResponse) => {
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
          return networkResponse;
        }
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // 若請求導航頁面且離線，回傳 index.html
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
