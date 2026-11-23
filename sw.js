/* 量化工作台离线壳：network-first，保证每次打开拿到最新前端 */
var CACHE = 'qw-shell-v50';
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.map(function (k) { if (k !== CACHE) return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.pathname.indexOf('/api/') === 0) return;
  e.respondWith(
    fetch(e.request).then(function (r) {
      if (r && r.ok) { var c = r.clone(); caches.open(CACHE).then(function (ca) { ca.put(e.request, c); }); }
      return r;
    }).catch(function () { return caches.match(e.request); })
  );
});