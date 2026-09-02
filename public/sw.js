// 自毁 Service Worker：安装后立即注销自己并清空缓存
// 用于清除旧版 PWA 缓存
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 清空所有缓存
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      // 注销自己
      await self.registration.unregister();
      // 接管所有页面，让下次刷新走网络
      await self.clients.claim();
    })()
  );
});
