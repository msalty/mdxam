// sw.js
const CACHE_NAME = 'exam-pwa-cache-v025';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './sw.js',
  './main.js',
  './style.css',
  './bootstrap.min.css',
  './bootstrap.min.css.map',
  './js/chartjs/chart.umd.js',
  './js/indexeddb/index-min.js',
  './icons/icon-512.png',
  './icons/icon-192.png',
  './icons/exams-64.png',
  './icons/results-64.png',
  './icons/upload-64.png',
  './icons/upload-file-64.png',
  './icons/settings-64.png'
  // icons from https://fonts.google.com/icons, color #F3F3F3
  // If you have CSS, images, etc., add them here
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached resource if available, else fetch from network
        return response || fetch(event.request);
      })
  );
});

self.addEventListener('activate', event => {
  // Clean up any old caches
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME)
                  .map(name => caches.delete(name))
      );
    })
  );
});