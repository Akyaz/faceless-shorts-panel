// Uygulama kabuğunu saklar ki panel ana ekrandan anında açılsın. GitHub'a giden istekler hiçbir zaman saklanmaz.
const CACHE = "panel-v15";
const SHELL = ["./", "index.html", "styles.css", "app.js", "api.js", "zip.js", "manifest.webmanifest", "icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL.map((url) => new Request(url, { cache: "reload" })))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Önce ağ: yeni sürüm yayınlandığında eski dosyada takılı kalınmasın; ağ yoksa saklanan kopya.
  // "no-cache": tarayıcının HTTP önbelleği de sunucuya sorulur. GitHub Pages dosyaları 10 dakika önbellekte
  // tutturuyor; önizleme yayınlandığında ana ekrandaki uygulama eski app.js ile açıldı (14 Kasım 2026)
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
