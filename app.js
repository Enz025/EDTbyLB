/* =========================================================
   EDT — Vanilla JS
   Sécurité :
   - 100 % côté client. Aucune télémétrie. Aucune dépendance.
   - Injection dans le DOM via textContent/setAttribute uniquement.
   - Aucune utilisation d'innerHTML, eval, new Function, document.write.
   - URL .ics validée (HTTPS only) avant fetch.
   ========================================================= */

(() => {
  'use strict';

  // ---------- État global ----------
  const STORAGE_KEYS = {
    events: 'edt.events.v1',
    source: 'edt.source.v1', // { type:'ics'|'json', url?:string, importedAt:number }
    view:   'edt.view.v1',   // 'day' | 'week'
    cursor: 'edt.cursor.v1'  // ISO date (YYYY-MM-DD) du jour/semaine affiché
  };

  /** @type {Array<{id:string, title:string, type:string, start:Date, end:Date, room:string, teacher:string, description:string}>} */
  let EVENTS = [];
  let VIEW = loadStr(STORAGE_KEYS.view, 'day');
  let CURSOR = parseISODate(loadStr(STORAGE_KEYS.cursor, toISODate(new Date()))) || new Date();

  // ---------- DOM refs ----------
  const $ = (sel) => document.querySelector(sel);
  const content    = $('#content');
  const dayTitle   = $('#dayTitle');
  const dateSub    = $('#dateSub');
  const prevBtn    = $('#prevBtn');
  const nextBtn    = $('#nextBtn');
  const todayBtn   = $('#todayBtn');
  const settingsBtn= $('#settingsBtn');
  const segBtns    = document.querySelectorAll('.seg[data-view]');
  const dlg        = $('#settingsDlg');
  const icsUrl     = $('#icsUrl');
  const fetchIcsBtn= $('#fetchIcsBtn');
  const importFileBtn = $('#importFileBtn');
  const icsFile    = $('#icsFile');
  const jsonInput  = $('#jsonInput');
  const loadJsonBtn= $('#loadJsonBtn');
  const clearBtn   = $('#clearBtn');
  const storageInfo= $('#storageInfo');
  const toastEl    = $('#toast');

  // ---------- Utilitaires ----------
  function toast(msg, ms = 2200) {
    toastEl.textContent = String(msg);
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  function loadStr(k, fb) { try { return localStorage.getItem(k) ?? fb; } catch { return fb; } }
  function saveStr(k, v) { try { localStorage.setItem(k, v); } catch {} }

  function toISODate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  function parseISODate(s) {
    if (!s || typeof s !== 'string') return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return null;
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    return isNaN(d) ? null : d;
  }

  const FR_DAYS   = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
  const FR_MONTHS = ['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];

  function startOfWeek(d) {
    // Semaine commence lundi (ISO)
    const x = new Date(d);
    const day = (x.getDay() + 6) % 7; // 0=lundi
    x.setDate(x.getDate() - day);
    x.setHours(0, 0, 0, 0);
    return x;
  }
  function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sameDay(a, b) {
    return a.getFullYear() === b.getFullYear()
        && a.getMonth() === b.getMonth()
        && a.getDate() === b.getDate();
  }
  function fmtTime(d) {
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Détection du type de cours ----------
  function detectType(rawTitle) {
    const t = String(rawTitle || '').toUpperCase();
    if (/\bEXAM|PARTIEL|DS\b/.test(t)) return 'EX';
    if (/\bTP\b/.test(t)) return 'TP';
    if (/\bTD\b/.test(t)) return 'TD';
    if (/\bCM\b|MAGISTRAL/.test(t)) return 'CM';
    return 'OTHER';
  }
  function typeColorVar(type) {
    switch (type) {
      case 'CM': return 'var(--cm)';
      case 'TD': return 'var(--td)';
      case 'TP': return 'var(--tp)';
      case 'EX': return 'var(--ex)';
      default:   return 'var(--other)';
    }
  }

  // ---------- Sanitization ----------
  // Nettoie une chaîne avant affichage. textContent gère déjà l'échappement HTML,
  // mais on supprime les caractères de contrôle / null bytes par prudence.
  function clean(str, maxLen = 500) {
    if (str == null) return '';
    let s = String(str);
    // Supprime null bytes + caractères de contrôle (sauf \n \t)
    s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
    if (s.length > maxLen) s = s.slice(0, maxLen) + '…';
    return s.trim();
  }

  // Hôtes ADE connus qui doivent être acheminés via le proxy PHP (./proxy.php)
  // pour éviter les blocages CORS depuis le navigateur. Doit rester synchronisé
  // avec la whitelist ALLOWED_HOSTS de proxy.php.
  const PROXIED_HOSTS = new Set([
    'ade-consult.univ-artois.fr'
  ]);

  // Validation stricte d'URL .ics : HTTPS uniquement, pas de credentials
  function safeIcsUrl(input) {
    try {
      const u = new URL(input);
      if (u.protocol !== 'https:') throw new Error('URL non-HTTPS refusée');
      if (u.username || u.password) throw new Error('URL avec credentials refusée');
      return u.toString();
    } catch (e) {
      throw new Error('URL invalide : ' + e.message);
    }
  }

  // Retourne l'URL à fetcher : directe si CORS OK, sinon via proxy local
  function resolveFetchUrl(safeUrl) {
    const u = new URL(safeUrl);
    if (PROXIED_HOSTS.has(u.host.toLowerCase())) {
      return './proxy.php?u=' + encodeURIComponent(safeUrl);
    }
    return safeUrl;
  }

  // ---------- Parser ICS ----------
  // Implémentation minimale et tolérante de RFC 5545 (VEVENT only).
  function parseICS(text) {
    if (typeof text !== 'string') return [];
    // Unfold : une ligne qui commence par espace/tab est la continuation de la précédente
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const unfolded = [];
    for (const line of lines) {
      if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length) {
        unfolded[unfolded.length - 1] += line.slice(1);
      } else {
        unfolded.push(line);
      }
    }

    const events = [];
    let cur = null;
    for (const raw of unfolded) {
      if (raw === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (raw === 'END:VEVENT') {
        if (cur && cur.DTSTART && cur.DTEND) {
          const start = parseIcsDate(cur.DTSTART.value, cur.DTSTART.params);
          const end   = parseIcsDate(cur.DTEND.value,   cur.DTEND.params);
          if (start && end) {
            const title = unescapeIcs(cur.SUMMARY?.value || 'Sans titre');
            events.push({
              id: clean(cur.UID?.value || `${start.getTime()}-${Math.random()}`, 200),
              title: clean(title, 200),
              type: detectType(title),
              start, end,
              room:        clean(unescapeIcs(cur.LOCATION?.value || ''), 200),
              teacher:     extractTeacher(unescapeIcs(cur.DESCRIPTION?.value || '')),
              description: clean(unescapeIcs(cur.DESCRIPTION?.value || ''), 1000)
            });
          }
        }
        cur = null;
        continue;
      }
      if (!cur) continue;

      // Sépare "KEY;PARAM=VAL:VALUE"
      const colon = raw.indexOf(':');
      if (colon < 0) continue;
      const left = raw.slice(0, colon);
      const value = raw.slice(colon + 1);
      const [key, ...paramParts] = left.split(';');
      const params = {};
      for (const p of paramParts) {
        const eq = p.indexOf('=');
        if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1);
      }
      cur[key.toUpperCase()] = { value, params };
    }
    return events;
  }

  function parseIcsDate(value, params) {
    // Formats supportés :
    //  - 20260520T080000Z        (UTC)
    //  - 20260520T080000         (local / floating)
    //  - 20260520T080000 + TZID  (on traite comme local — suffisant pour affichage perso)
    //  - 20260520                (DATE, journée entière)
    if (!value) return null;
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value);
    if (!m) return null;
    const [, y, mo, d, h, mi, s, z] = m;
    if (h == null) return new Date(+y, +mo - 1, +d);
    if (z === 'Z') return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s));
    return new Date(+y, +mo - 1, +d, +h, +mi, +s);
  }

  function unescapeIcs(s) {
    if (!s) return '';
    return String(s)
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  }

  function extractTeacher(desc) {
    if (!desc) return '';
    // Heuristique : ADE met souvent "Enseignant : NOM" ou listes capitalisées
    const m = /(?:enseignant|prof(?:esseur)?)\s*[:\-]\s*([^\n]+)/i.exec(desc);
    if (m) return clean(m[1], 120);
    return '';
  }

  // ---------- Parser JSON manuel ----------
  function parseManualJSON(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('JSON invalide : ' + e.message); }
    if (!Array.isArray(data)) throw new Error('Le JSON doit être un tableau d\'événements.');
    const out = [];
    for (const ev of data) {
      if (!ev || typeof ev !== 'object') continue;
      const start = new Date(ev.start);
      const end   = new Date(ev.end);
      if (isNaN(start) || isNaN(end)) continue;
      const title = clean(ev.title || ev.summary || 'Sans titre', 200);
      out.push({
        id: clean(ev.id || `${start.getTime()}-${Math.random()}`, 200),
        title,
        type: clean(ev.type, 12).toUpperCase() || detectType(title),
        start, end,
        room: clean(ev.room || ev.location || '', 200),
        teacher: clean(ev.teacher || '', 120),
        description: clean(ev.description || '', 1000)
      });
    }
    return out;
  }

  // ---------- Persistance ----------
  function persistEvents() {
    const serial = EVENTS.map(e => ({
      ...e,
      start: e.start.toISOString(),
      end:   e.end.toISOString()
    }));
    try {
      localStorage.setItem(STORAGE_KEYS.events, JSON.stringify(serial));
    } catch (e) {
      toast('Stockage local saturé.');
    }
    updateStorageInfo();
  }
  function loadEvents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.events);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(e => ({
        ...e,
        start: new Date(e.start),
        end:   new Date(e.end)
      })).filter(e => !isNaN(e.start) && !isNaN(e.end));
    } catch { return []; }
  }
  function updateStorageInfo() {
    const src = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.source) || 'null'); }
      catch { return null; }
    })();
    const n = EVENTS.length;
    if (!n) { storageInfo.textContent = 'Aucune donnée stockée.'; return; }
    const when = src?.importedAt ? new Date(src.importedAt).toLocaleString('fr-FR') : '—';
    const type = src?.type === 'ics' ? '.ics' : (src?.type === 'json' ? 'JSON' : '?');
    storageInfo.textContent = `${n} événement(s) — source ${type} — importé le ${when}`;
  }

  // ---------- Rendu (SANS innerHTML) ----------
  function clearNode(n) { while (n.firstChild) n.removeChild(n.firstChild); }

  function renderHeader() {
    const day = FR_DAYS[CURSOR.getDay()];
    const dn  = CURSOR.getDate();
    const mn  = FR_MONTHS[CURSOR.getMonth()];
    const yr  = CURSOR.getFullYear();

    if (VIEW === 'day') {
      dayTitle.textContent = `${day} ${dn} ${mn}`;
      dateSub.textContent  = sameDay(CURSOR, new Date()) ? "Aujourd'hui" : String(yr);
    } else {
      const s = startOfWeek(CURSOR);
      const e = addDays(s, 6);
      dayTitle.textContent = `Semaine du ${s.getDate()} ${FR_MONTHS[s.getMonth()]}`;
      dateSub.textContent  = `${s.getDate()}/${s.getMonth()+1} – ${e.getDate()}/${e.getMonth()+1}`;
    }
  }

  function eventsForDay(d) {
    return EVENTS
      .filter(ev => sameDay(ev.start, d))
      .sort((a, b) => a.start - b.start);
  }

  function buildCourseCard(ev, compact = false) {
    const card = document.createElement('article');
    card.className = 'course';
    card.style.setProperty('--type-color', typeColorVar(ev.type));

    const row1 = document.createElement('div');
    row1.className = 'row1';

    const titleWrap = document.createElement('div');
    const title = document.createElement('h3');
    title.className = 'title';
    title.textContent = ev.title; // sécurisé
    titleWrap.appendChild(title);

    if (!compact && ev.type) {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.style.setProperty('--type-color', typeColorVar(ev.type));
      badge.textContent = ev.type;
      titleWrap.appendChild(document.createTextNode(' '));
      titleWrap.appendChild(badge);
    }

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${fmtTime(ev.start)} – ${fmtTime(ev.end)}`;

    row1.appendChild(titleWrap);
    row1.appendChild(time);
    card.appendChild(row1);

    if (!compact) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      if (ev.room)    { const s = document.createElement('span'); s.textContent = '📍 ' + ev.room;    meta.appendChild(s); }
      if (ev.teacher) { const s = document.createElement('span'); s.textContent = '👤 ' + ev.teacher; meta.appendChild(s); }
      if (meta.children.length) card.appendChild(meta);
    }
    return card;
  }

  function renderDay() {
    clearNode(content);
    const list = eventsForDay(CURSOR);
    if (!list.length) {
      content.appendChild(buildEmpty('Pas de cours', 'Profite bien de ta journée libre.'));
      return;
    }
    for (const ev of list) content.appendChild(buildCourseCard(ev));
  }

  function renderWeek() {
    clearNode(content);
    const start = startOfWeek(CURSOR);
    const grid = document.createElement('div');
    grid.className = 'week-grid';
    for (let i = 0; i < 6; i++) { // lun → sam
      const day = addDays(start, i);
      const col = document.createElement('section');
      col.className = 'day-col';
      const h = document.createElement('h3');
      h.textContent = `${FR_DAYS[day.getDay()]} ${day.getDate()}`;
      col.appendChild(h);
      const list = eventsForDay(day);
      if (!list.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = '—';
        col.appendChild(p);
      } else {
        for (const ev of list) col.appendChild(buildCourseCard(ev, true));
      }
      grid.appendChild(col);
    }
    content.appendChild(grid);
  }

  function buildEmpty(title, sub) {
    const wrap = document.createElement('div');
    wrap.className = 'empty glass';
    const t = document.createElement('strong'); t.textContent = title;
    const s = document.createElement('span');   s.textContent = sub;
    wrap.appendChild(t); wrap.appendChild(s);
    return wrap;
  }

  function render() {
    renderHeader();
    if (VIEW === 'day') renderDay(); else renderWeek();
    saveStr(STORAGE_KEYS.view, VIEW);
    saveStr(STORAGE_KEYS.cursor, toISODate(CURSOR));
    // segment actif
    segBtns.forEach(b => {
      const active = b.dataset.view === VIEW;
      b.classList.toggle('active', active);
      b.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  // ---------- Navigation ----------
  function step(delta) {
    if (VIEW === 'day') CURSOR = addDays(CURSOR, delta);
    else CURSOR = addDays(CURSOR, delta * 7);
    render();
  }
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(+1));
  todayBtn.addEventListener('click', () => { CURSOR = new Date(); render(); });
  segBtns.forEach(b => b.addEventListener('click', () => {
    VIEW = b.dataset.view; render();
  }));

  // Swipe horizontal sur le contenu
  (() => {
    let x0 = null, y0 = null, t0 = 0;
    content.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      x0 = t.clientX; y0 = t.clientY; t0 = Date.now();
    }, { passive: true });
    content.addEventListener('touchend', (e) => {
      if (x0 == null) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - x0;
      const dy = t.clientY - y0;
      const dt = Date.now() - t0;
      x0 = y0 = null;
      if (dt < 500 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        step(dx < 0 ? +1 : -1);
      }
    }, { passive: true });
  })();

  // ---------- Settings ----------
  settingsBtn.addEventListener('click', () => {
    try {
      const src = JSON.parse(localStorage.getItem(STORAGE_KEYS.source) || 'null');
      if (src?.url) icsUrl.value = src.url;
    } catch {}
    updateStorageInfo();
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  });

  fetchIcsBtn.addEventListener('click', async () => {
    const raw = icsUrl.value.trim();
    if (!raw) { toast('Saisis une URL .ics'); return; }
    let url;
    try { url = safeIcsUrl(raw); } catch (e) { toast(e.message); return; }
    fetchIcsBtn.disabled = true;
    try {
      const fetchUrl = resolveFetchUrl(url);
      const res = await fetch(fetchUrl, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const evs = parseICS(text);
      if (!evs.length) throw new Error('Aucun événement trouvé.');
      EVENTS = evs;
      persistEvents();
      localStorage.setItem(STORAGE_KEYS.source, JSON.stringify({ type: 'ics', url, importedAt: Date.now() }));
      toast(`${evs.length} cours importé(s)`);
      render();
    } catch (e) {
      toast('Import impossible : ' + e.message);
    } finally {
      fetchIcsBtn.disabled = false;
    }
  });

  importFileBtn.addEventListener('click', () => icsFile.click());
  icsFile.addEventListener('change', async () => {
    const f = icsFile.files?.[0]; if (!f) return;
    try {
      const text = await f.text();
      const evs = parseICS(text);
      if (!evs.length) throw new Error('Aucun événement trouvé.');
      EVENTS = evs;
      persistEvents();
      localStorage.setItem(STORAGE_KEYS.source, JSON.stringify({ type: 'ics', importedAt: Date.now() }));
      toast(`${evs.length} cours importé(s)`);
      render();
    } catch (e) {
      toast('Fichier invalide : ' + e.message);
    } finally {
      icsFile.value = '';
    }
  });

  loadJsonBtn.addEventListener('click', () => {
    const txt = jsonInput.value.trim();
    if (!txt) { toast('Colle du JSON ci-dessus'); return; }
    try {
      const evs = parseManualJSON(txt);
      if (!evs.length) throw new Error('Aucun événement valide.');
      EVENTS = evs;
      persistEvents();
      localStorage.setItem(STORAGE_KEYS.source, JSON.stringify({ type: 'json', importedAt: Date.now() }));
      toast(`${evs.length} cours chargé(s)`);
      render();
    } catch (e) { toast(e.message); }
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Effacer toutes les données locales ?')) return;
    Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch {} });
    EVENTS = []; VIEW = 'day'; CURSOR = new Date();
    render();
    updateStorageInfo();
    toast('Données effacées.');
  });

  // ---------- Démarrage ----------
  function bootstrap() {
    EVENTS = loadEvents();
    if (!EVENTS.length) {
      // Démo : journée type si l'utilisateur n'a encore rien importé
      EVENTS = demoEvents();
    }
    render();
    updateStorageInfo();
  }

  function demoEvents() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const at = (h, m = 0) => { const d = new Date(today); d.setHours(h, m, 0, 0); return d; };
    return [
      { id: 'demo-1', title: 'Algorithmique CM', type: 'CM', start: at(8, 0),  end: at(10, 0), room: 'Amphi A', teacher: 'M. Dupont', description: '' },
      { id: 'demo-2', title: 'Anglais TD',       type: 'TD', start: at(10,15), end: at(12, 0), room: 'B204',    teacher: 'Mme Lee',   description: '' },
      { id: 'demo-3', title: 'Programmation TP', type: 'TP', start: at(13,30), end: at(16, 30), room: 'Lab 3',   teacher: 'M. Martin', description: '' }
    ];
  }

  // Service worker — uniquement en HTTPS ou localhost
  if ('serviceWorker' in navigator) {
    const ok = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
    if (ok) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./service-worker.js').catch(() => {/* silencieux */});
      });
    }
  }

  bootstrap();
})();
