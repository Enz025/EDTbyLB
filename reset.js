/* Kill switch standalone — fonctionne même si app.js est l'ancien cache.
   Chargé en premier dans index.html (avant app.js).
   Usage :
     https://edt.25nzo.eu/?reset   → purge SW + caches + localStorage, reload
     https://edt.25nzo.eu/?fresh   → purge SW + caches, garde les profils, reload */
(function () {
  try {
    var u = new URL(location.href);
    var hasReset = u.searchParams.has('reset');
    var hasFresh = u.searchParams.has('fresh');
    if (!hasReset && !hasFresh) return;

    var keep = hasFresh && !hasReset;
    var done = function () {
      u.searchParams.delete('reset');
      u.searchParams.delete('fresh');
      u.searchParams.set('_t', String(Date.now()));
      location.replace(u.toString());
    };

    var tasks = [];
    if ('serviceWorker' in navigator) {
      tasks.push(
        navigator.serviceWorker.getRegistrations()
          .then(function (rs) {
            return Promise.all(rs.map(function (r) { return r.unregister(); }));
          })
          .catch(function () {})
      );
    }
    if ('caches' in window) {
      tasks.push(
        caches.keys()
          .then(function (ks) {
            return Promise.all(ks.map(function (k) { return caches.delete(k); }));
          })
          .catch(function () {})
      );
    }
    if (!keep) {
      try { localStorage.clear(); } catch (e) {}
      try { sessionStorage.clear(); } catch (e) {}
    }
    Promise.all(tasks).then(done, done);
  } catch (e) { /* ignore */ }
})();
