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
  const detailsDlg = $('#detailsDlg');
  const detailsBadge   = $('#detailsBadge');
  const detailsTitle   = $('#detailsTitle');
  const detailsStart   = $('#detailsStart');
  const detailsEnd     = $('#detailsEnd');
  const detailsRoom    = $('#detailsRoom');
  const detailsTeacher = $('#detailsTeacher');
  const detailsDescWrap= $('#detailsDescWrap');
  const detailsDesc    = $('#detailsDesc');
  const detailsContent = $('#detailsContent');

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
  // Normalise les séparateurs ADE (_ - . :) + accents en espaces pour que \b fonctionne.
  function normalizeForType(s) {
    return String(s || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
      .replace(/[_\-.:|/]/g, ' ')
      .toUpperCase();
  }
  function detectType(rawText) {
    const norm = normalizeForType(rawText);
    if (/\b(EXAM|EXAMEN|PARTIEL|RATTRAPAGE|CONTROLE|EVALUATION|DS|DSC|CC)\b/.test(norm)) return 'EX';
    if (/\b(TP|TRAVAUX\s+PRATIQUES?)\b/.test(norm))                                       return 'TP';
    if (/\b(TD|TRAVAUX\s+DIRIGES?)\b/.test(norm))                                         return 'TD';
    if (/\b(CM|COURS\s+MAGISTRAL|MAGISTRAL|AMPHI)\b/.test(norm))                          return 'CM';
    return 'OTHER';
  }
  // Détection multi-champs : tente SUMMARY puis DESCRIPTION puis CATEGORIES
  function detectTypeMulti(title, description, categories) {
    let t = detectType(title);
    if (t === 'OTHER') t = detectType(description);
    if (t === 'OTHER') t = detectType(categories);
    return t;
  }
  const TYPE_LABEL = { CM: 'CM', TD: 'TD', TP: 'TP', EX: 'EXAM', OTHER: 'COURS' };
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
            const title       = unescapeIcs(cur.SUMMARY?.value || 'Sans titre');
            const description = unescapeIcs(cur.DESCRIPTION?.value || '');
            const categories  = unescapeIcs(cur.CATEGORIES?.value || '');
            events.push({
              id: clean(cur.UID?.value || `${start.getTime()}-${Math.random()}`, 200),
              title: clean(title, 200),
              type: detectTypeMulti(title, description, categories),
              start, end,
              room:        clean(unescapeIcs(cur.LOCATION?.value || ''), 200),
              teacher:     extractTeacher(description),
              description: clean(description, 1000)
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

  // État live d'un cours par rapport à "maintenant"
  function liveStateFor(ev, now = new Date()) {
    if (now >= ev.start && now < ev.end) return 'live';
    if (now < ev.start) return 'future';
    return 'past';
  }

  // Stats journalières
  function dayStats(list) {
    let totalMs = 0;
    for (const ev of list) totalMs += Math.max(0, ev.end - ev.start);
    const h = Math.floor(totalMs / 3600000);
    const m = Math.round((totalMs % 3600000) / 60000);
    return { count: list.length, hours: h, minutes: m };
  }
  function fmtDuration(ms) {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h <= 0) return `${m} min`;
    if (m <= 0) return `${h}h`;
    return `${h}h${String(m).padStart(2, '0')}`;
  }

  function buildSummaryCard(list) {
    const s = dayStats(list);
    const wrap = document.createElement('div');
    wrap.className = 'day-summary glass';
    const mk = (val, label) => {
      const st = document.createElement('div'); st.className = 'stat';
      const b  = document.createElement('strong'); b.textContent = val;
      const sp = document.createElement('span'); sp.textContent = label;
      st.appendChild(b); st.appendChild(sp); return st;
    };
    wrap.appendChild(mk(String(s.count), s.count > 1 ? 'cours' : 'cours'));
    const dur = s.minutes ? `${s.hours}h${String(s.minutes).padStart(2,'0')}` : `${s.hours}h`;
    wrap.appendChild(mk(dur, 'de cours'));
    return wrap;
  }

  function buildNextCourseCard(ev, now = new Date()) {
    const diffMs = ev.start - now;
    const wrap = document.createElement('div');
    wrap.className = 'next-course';
    const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '→';
    const txt = document.createElement('span');
    const strong = document.createElement('strong'); strong.textContent = 'Prochain : ';
    txt.appendChild(strong);
    txt.appendChild(document.createTextNode(`${ev.title} dans ${fmtDuration(diffMs)}`));
    if (ev.room) txt.appendChild(document.createTextNode(` · ${ev.room}`));
    wrap.appendChild(arrow); wrap.appendChild(txt);
    return wrap;
  }

  function buildPauseCard(ms) {
    const el = document.createElement('div');
    el.className = 'pause';
    const txt = document.createElement('span');
    txt.textContent = `Pause · ${fmtDuration(ms)}`;
    el.appendChild(txt);
    return el;
  }

  function buildCourseCard(ev, compact = false, now = new Date()) {
    const card = document.createElement('article');
    card.className = 'course';
    const state = liveStateFor(ev, now);
    if (!compact) card.classList.add(state);
    card.style.setProperty('--type-color', typeColorVar(ev.type));

    const row1 = document.createElement('div');
    row1.className = 'row1';

    const head = document.createElement('div'); head.className = 'head';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = TYPE_LABEL[ev.type] || ev.type || 'COURS';
    head.appendChild(badge);

    const title = document.createElement('h3');
    title.className = 'title';
    title.textContent = ev.title;
    head.appendChild(title);

    if (!compact && state === 'live') {
      const live = document.createElement('span');
      live.className = 'live-badge';
      live.textContent = 'EN COURS';
      head.appendChild(live);
    }

    const time = document.createElement('span');
    time.className = 'time';
    time.textContent = `${fmtTime(ev.start)}–${fmtTime(ev.end)}`;

    row1.appendChild(head);
    row1.appendChild(time);
    card.appendChild(row1);

    if (!compact) {
      const meta = document.createElement('div');
      meta.className = 'meta';
      if (ev.room)    { const s = document.createElement('span'); s.textContent = '📍 ' + ev.room;    meta.appendChild(s); }
      if (ev.teacher) { const s = document.createElement('span'); s.textContent = '👤 ' + ev.teacher; meta.appendChild(s); }
      if (meta.children.length) card.appendChild(meta);

      card.addEventListener('click', () => openDetails(ev));
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetails(ev); }
      });
    }
    return card;
  }

  function renderDay() {
    clearNode(content);
    const list = eventsForDay(CURSOR);
    const now = new Date();
    const isToday = sameDay(CURSOR, now);
    const isWeekend = CURSOR.getDay() === 0 || CURSOR.getDay() === 6;

    if (!list.length) {
      const title = isWeekend ? 'Week-end' : (isToday ? 'Journée libre' : 'Pas de cours');
      const sub   = isWeekend ? 'Profite bien !' : (isToday ? "Rien au programme aujourd'hui." : 'Aucun cours prévu ce jour.');
      content.appendChild(buildEmpty(title, sub));

      // Si on a quand même un EDT chargé, propose un raccourci vers le prochain cours
      if (EVENTS.length) {
        const upcoming = [...EVENTS].sort((a, b) => a.start - b.start).find(ev => ev.start >= now);
        const target = upcoming || [...EVENTS].sort((a, b) => b.start - a.start)[0];
        if (target && !sameDay(target.start, CURSOR)) {
          const btn = document.createElement('button');
          btn.className = 'btn primary';
          btn.style.alignSelf = 'center';
          btn.textContent = upcoming
            ? `→ Aller au prochain cours (${target.start.toLocaleDateString('fr-FR', {weekday:'short', day:'2-digit', month:'short'})})`
            : `→ Voir le dernier cours (${target.start.toLocaleDateString('fr-FR', {weekday:'short', day:'2-digit', month:'short'})})`;
          btn.addEventListener('click', () => {
            CURSOR = new Date(target.start); CURSOR.setHours(0,0,0,0); render();
          });
          content.appendChild(btn);
        }
      }
      return;
    }

    // Résumé du jour
    content.appendChild(buildSummaryCard(list));

    // Prochain cours (si aujourd'hui et qu'il y en a un à venir)
    if (isToday) {
      const next = list.find(ev => ev.start > now);
      if (next) content.appendChild(buildNextCourseCard(next, now));
    }

    // Cours + pauses ≥ 30 min
    const PAUSE_THRESHOLD = 30 * 60 * 1000;
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      content.appendChild(buildCourseCard(ev, false, now));
      if (i < list.length - 1) {
        const gap = list[i + 1].start - ev.end;
        if (gap >= PAUSE_THRESHOLD) content.appendChild(buildPauseCard(gap));
      }
    }
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

  function openDetails(ev) {
    const fmtFull = (d) => d.toLocaleString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit'
    });
    detailsContent.style.setProperty('--type-color', typeColorVar(ev.type));
    detailsBadge.textContent = TYPE_LABEL[ev.type] || ev.type || 'COURS';
    detailsBadge.style.setProperty('--type-color', typeColorVar(ev.type));
    detailsTitle.textContent   = ev.title;
    detailsStart.textContent   = fmtFull(ev.start);
    detailsEnd.textContent     = fmtFull(ev.end);
    detailsRoom.textContent    = ev.room    || '—';
    detailsTeacher.textContent = ev.teacher || '—';
    if (ev.description && ev.description.trim()) {
      detailsDesc.textContent = ev.description;
      detailsDescWrap.hidden = false;
    } else {
      detailsDescWrap.hidden = true;
    }
    if (typeof detailsDlg.showModal === 'function') detailsDlg.showModal();
    else detailsDlg.setAttribute('open', '');
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
      const usedProxy = fetchUrl.startsWith('./proxy.php');
      let res;
      try {
        res = await fetch(fetchUrl, { credentials: 'omit', redirect: 'follow' });
      } catch (netErr) {
        if (usedProxy) {
          throw new Error("Proxy indisponible : utilise plutôt « Importer fichier .ics ».");
        }
        throw netErr;
      }
      if (!res.ok) {
        if (usedProxy && (res.status === 404 || res.status === 405)) {
          throw new Error("proxy.php absent (hébergement statique) : utilise « Importer fichier .ics ».");
        }
        throw new Error('HTTP ' + res.status);
      }
      const ctype = (res.headers.get('content-type') || '').toLowerCase();
      if (usedProxy && ctype.includes('text/html')) {
        throw new Error("Réponse HTML inattendue : l'hébergement ne supporte pas PHP.");
      }
      const text = await res.text();
      const evs = parseICS(text);
      if (!evs.length) throw new Error('Aucun événement trouvé.');
      EVENTS = evs;
      persistEvents();
      localStorage.setItem(STORAGE_KEYS.source, JSON.stringify({ type: 'ics', url, importedAt: Date.now() }));
      jumpToMostRelevantDate();
      toast(`${evs.length} cours · ${importRangeLabel()}`, 4500);
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
      jumpToMostRelevantDate();
      toast(`${evs.length} cours · ${importRangeLabel()}`, 4500);
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
      jumpToMostRelevantDate();
      toast(`${evs.length} cours · ${importRangeLabel()}`, 4500);
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

  // Saute sur la date la plus pertinente parmi EVENTS :
  // - aujourd'hui si y a des cours
  // - sinon le prochain cours à venir
  // - sinon le dernier cours passé
  function jumpToMostRelevantDate() {
    if (!EVENTS.length) return;
    const now = new Date();
    const sorted = [...EVENTS].sort((a, b) => a.start - b.start);
    if (sorted.some(ev => sameDay(ev.start, now))) {
      CURSOR = new Date(now);
    } else {
      const upcoming = sorted.find(ev => ev.start >= now);
      CURSOR = new Date((upcoming || sorted[sorted.length - 1]).start);
    }
    CURSOR.setHours(0, 0, 0, 0);
  }

  function importRangeLabel() {
    if (!EVENTS.length) return '';
    const sorted = [...EVENTS].sort((a, b) => a.start - b.start);
    const a = sorted[0].start;
    const b = sorted[sorted.length - 1].end;
    const fmt = (d) => d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
    return `${fmt(a)} → ${fmt(b)}`;
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

  // Refresh des indicateurs "EN COURS" / "dans X min" toutes les minutes,
  // uniquement quand on affiche le jour courant en vue Jour.
  setInterval(() => {
    if (VIEW === 'day' && sameDay(CURSOR, new Date())) render();
  }, 60 * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && VIEW === 'day' && sameDay(CURSOR, new Date())) render();
  });
})();
