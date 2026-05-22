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

  const APP_VERSION = 'v2.2.0';

  // === Kill switch : ?reset purge tout (SW, caches, localStorage) ===
  // Permet de débloquer un user coincé sur une ancienne version cachée.
  // Usage : https://edt.25nzo.eu/?reset
  (async () => {
    const u = new URL(location.href);
    if (!u.searchParams.has('reset') && !u.searchParams.has('fresh')) return;
    const keepProfiles = u.searchParams.has('fresh'); // ?fresh = soft, ?reset = hard
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
      if (!keepProfiles) {
        try { localStorage.clear(); } catch {}
      }
    } catch {}
    // Reload sans le param et sans cache
    u.searchParams.delete('reset');
    u.searchParams.delete('fresh');
    u.searchParams.set('_t', Date.now().toString()); // cache buster
    location.replace(u.toString());
  })();

  // ---------- État global ----------
  const STORAGE_KEYS = {
    // === Système de profils (multi-classes) ===
    profiles: 'edt.profiles.v1',  // [{id, name, type, url, events[], importedAt}]
    active:   'edt.active.v1',    // id du profil actif

    // === Anciennes clés (migration une fois puis ignorées) ===
    events:   'edt.events.v1',
    source:   'edt.source.v1',

    // === UI ===
    view:     'edt.view.v1',
    cursor:   'edt.cursor.v1',
    autoSync: 'edt.autoSync.v1'
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
  const versionInfo= $('#versionInfo');
  const forceUpdateBtn = $('#forceUpdateBtn');
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
  const copyDetailsBtn = $('#copyDetailsBtn');
  const syncBtn   = $('#syncBtn');
  const titleBtn  = $('#titleBtn');
  const datePicker= $('#datePicker');
  const weekPills = $('#weekPills');
  const pullIndicator = $('#pullIndicator');
  const pullLabel = $('#pullLabel');
  const profileBtn = $('#profileBtn');
  const profileName= $('#profileName');
  const profileDlg = $('#profileDlg');
  const crousDlg = $('#crousDlg');
  const crousDate = $('#crousDate');
  const crousContent = $('#crousContent');
  const profileList= $('#profileList');
  const addProfileDetails = $('#addProfileDetails');
  const newProfileName = $('#newProfileName');
  const newProfileUrl  = $('#newProfileUrl');
  const addProfileBtn  = $('#addProfileBtn');
  const presetsSection = $('#presetsSection');
  const presetsList    = $('#presetsList');

  let LAST_DETAILS_EV = null;
  let PRESETS = []; // [{name, url, tag?, filter?:{year,sub}}]

  // Fallback embarqué dans le bundle JS, utilisé si fetch('./presets.json') échoue
  // (ex : protocole file://, hébergement statique fermé, etc.)
  const CATALOG_URL_DEFAULT = 'https://ade-consult.univ-artois.fr/jsp/custom/modules/plannings/ZYjybX3B.shu';
  const FALLBACK_PRESETS = [
    { name: 'BUT INFO 1A — A1', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'A1' } },
    { name: 'BUT INFO 1A — A2', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'A2' } },
    { name: 'BUT INFO 1A — B1', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'B1' } },
    { name: 'BUT INFO 1A — B2', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'B2' } },
    { name: 'BUT INFO 1A — C1', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'C1' } },
    { name: 'BUT INFO 1A — C2', url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B1', sub: 'C2' } },
    { name: 'BUT INFO 2A — A',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B2', sub: 'A'  } },
    { name: 'BUT INFO 2A — B',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B2', sub: 'B'  } },
    { name: 'BUT INFO 2A — C',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B2', sub: 'C'  } },
    { name: 'BUT INFO 3A — A',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B3', sub: 'A'  } },
    { name: 'BUT INFO 3A — B',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B3', sub: 'B'  } },
    { name: 'BUT INFO 3A — C',  url: CATALOG_URL_DEFAULT, tag: 'Lens', filter: { year: 'B3', sub: 'C'  } }
  ];

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

  // ============================================================
  // PROFILS (multi-classes)
  // ============================================================
  function newProfileId() {
    return 'p_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
  }
  function loadProfilesRaw() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.profiles);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveProfilesRaw(arr) {
    try { localStorage.setItem(STORAGE_KEYS.profiles, JSON.stringify(arr)); } catch {}
  }
  function serializeEvents(evs) {
    return evs.map(e => ({ ...e, start: e.start.toISOString(), end: e.end.toISOString() }));
  }
  function deserializeEvents(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(e => ({ ...e, start: new Date(e.start), end: new Date(e.end) }))
              .filter(e => !isNaN(e.start) && !isNaN(e.end));
  }
  function getActiveProfile() {
    const profiles = loadProfilesRaw();
    if (!profiles.length) return null;
    const id = localStorage.getItem(STORAGE_KEYS.active);
    return profiles.find(p => p.id === id) || profiles[0];
  }
  function setActiveProfileId(id) {
    localStorage.setItem(STORAGE_KEYS.active, id);
  }
  function updateActiveProfile(patch) {
    const profiles = loadProfilesRaw();
    const id = (getActiveProfile() || {}).id;
    const idx = profiles.findIndex(p => p.id === id);
    if (idx < 0) return;
    profiles[idx] = { ...profiles[idx], ...patch };
    saveProfilesRaw(profiles);
  }
  function addProfile({ name, type = 'ics', url = null, filter = null }) {
    const profiles = loadProfilesRaw();
    const p = { id: newProfileId(), name: clean(name, 40) || 'Sans nom',
                type, url: url || null, events: [], importedAt: 0,
                filter: filter || null };
    profiles.push(p);
    saveProfilesRaw(profiles);
    setActiveProfileId(p.id);
    return p;
  }
  function removeProfile(id) {
    let profiles = loadProfilesRaw();
    profiles = profiles.filter(p => p.id !== id);
    saveProfilesRaw(profiles);
    if (localStorage.getItem(STORAGE_KEYS.active) === id) {
      if (profiles[0]) setActiveProfileId(profiles[0].id);
      else localStorage.removeItem(STORAGE_KEYS.active);
    }
  }
  function switchProfile(id) {
    setActiveProfileId(id);
    const p = getActiveProfile();
    EVENTS = deserializeEvents(p?.events || []);
    ensureModuleColors();
    refreshProfileChip();
    jumpToMostRelevantDate();
    render();
    // sync silencieux du nouveau profil en arrière-plan
    autoRefresh({ silent: true }).then(ok => { if (ok) { ensureModuleColors(); render(); } });
  }
  function refreshProfileChip() {
    const p = getActiveProfile();
    profileName.textContent = p ? p.name : 'Mon EDT';
  }

  // Migration : si on a des données dans les anciennes clés et aucun profil,
  // on crée un premier profil "Mon EDT" avec ces données.
  function migrateLegacyIfNeeded() {
    const profiles = loadProfilesRaw();
    if (profiles.length) return;
    let oldEvents = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.events);
      if (raw) oldEvents = deserializeEvents(JSON.parse(raw));
    } catch {}
    let oldSrc = null;
    try { oldSrc = JSON.parse(localStorage.getItem(STORAGE_KEYS.source) || 'null'); } catch {}
    if (!oldEvents.length && !oldSrc) return;
    const p = {
      id: newProfileId(),
      name: 'Mon EDT',
      type: oldSrc?.type || 'ics',
      url: oldSrc?.url || null,
      events: oldEvents.length ? serializeEvents(oldEvents) : [],
      importedAt: oldSrc?.importedAt || Date.now()
    };
    saveProfilesRaw([p]);
    setActiveProfileId(p.id);
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
    // EXAMENS
    if (/\b(EXAM|EXAMEN|PARTIEL|RATTRAPAGE|CONTROLE|EVALUATION|DS|DSC|CC|SOUTENANCE)\b/.test(norm)) return 'EX';
    // ADE Artois : type collé au code de groupe (B1INFOS1TPB1, B1INFOS2CM, B1INFOS1TDA...)
    // S\d+ = marqueur de semestre, suivi directement par TP/TD/CM
    const ade = /S\d+(TP|TD|CM)/.exec(norm);
    if (ade) return ade[1];
    // TP — formes longues, abrégées, suffixées (TP1, TP-A, TPA, TP_B...)
    if (/(?:^|[^A-Z])(TP|TRAVAUX\s+PRATIQUES?)(?:[\d\s\-_:.,]|$)/.test(norm)) return 'TP';
    if (/\b(GR(?:OUPE)?[\s_\-.]*TP)/.test(norm))                              return 'TP';
    // TD — idem
    if (/(?:^|[^A-Z])(TD|TRAVAUX\s+DIRIGES?)(?:[\d\s\-_:.,]|$)/.test(norm))   return 'TD';
    if (/\b(GR(?:OUPE)?[\s_\-.]*TD)/.test(norm))                              return 'TD';
    // CM
    if (/(?:^|[^A-Z])(CM|COURS\s+MAGISTRAL|MAGISTRAL|AMPHI)(?:[\d\s\-_:.,]|$)/.test(norm)) return 'CM';
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

  // ============================================================
  // CODE MODULE (R2.01, S1.04, M101, etc.) + couleur déterministe
  // ============================================================
  // Détecte des codes type ADE BUT/Licence en début de titre :
  //   "R2.01 : Développement orienté objet" → "R2.01"
  //   "S1.04 - Maths"                       → "S1.04"
  //   "M101 Algorithmique"                  → "M101"
  //   "UE5 Anglais"                         → "UE5"
  function extractModuleCode(title) {
    if (!title) return null;
    const m = String(title).match(/^\s*([A-Z]{1,5}\d+(?:\.\d+)?)\b/i);
    return m ? m[1].toUpperCase() : null;
  }

  // === Couleur par module : angle d'or → écart maximal sur le cercle chromatique ===
  // L'index de chaque code module est mémorisé (localStorage) pour garantir
  // qu'un module garde la même couleur d'une semaine / session à l'autre.
  // Un nouveau module ajouté reçoit le prochain index → nouvelle couleur unique.
  const MODULE_INDEX_KEY = 'edt.moduleIndex.v1';
  const GOLDEN_ANGLE = 137.50776405003785; // optimal pour répartir N couleurs
  let MODULE_INDEX = new Map(); // code → index entier
  let MODULE_COLOR = new Map(); // code → string hsl(...)

  function loadModuleIndex() {
    try {
      const raw = localStorage.getItem(MODULE_INDEX_KEY);
      if (!raw) return;
      const obj = JSON.parse(raw);
      MODULE_INDEX = new Map(Object.entries(obj).filter(([_, v]) => Number.isFinite(v)));
    } catch {}
  }
  function saveModuleIndex() {
    try { localStorage.setItem(MODULE_INDEX_KEY, JSON.stringify(Object.fromEntries(MODULE_INDEX))); } catch {}
  }
  function ensureModuleColors() {
    // Récupère tous les codes modules visibles, attribue un index à chaque nouveau
    let dirty = false;
    for (const ev of EVENTS) {
      const code = extractModuleCode(ev.title);
      if (code && !MODULE_INDEX.has(code)) {
        MODULE_INDEX.set(code, MODULE_INDEX.size);
        dirty = true;
      }
    }
    if (dirty) saveModuleIndex();
    rebuildModuleColors();
  }
  function rebuildModuleColors() {
    MODULE_COLOR = new Map();
    for (const [code, i] of MODULE_INDEX) {
      const hue = ((i * GOLDEN_ANGLE) + 18) % 360;
      // Légère variation de saturation/lumi pour diversité encore plus grande
      const sat = 68 + ((i * 13) % 18); // 68-85
      const lit = 54 + ((i * 7)  % 10); // 54-63
      MODULE_COLOR.set(code, `hsl(${hue.toFixed(1)}, ${sat}%, ${lit}%)`);
    }
  }
  function colorForModule(code) {
    if (!code) return null;
    return MODULE_COLOR.get(code) || 'var(--other)';
  }

  // Résout couleur + badges :
  //  - Couleur prioritaire : par MODULE (différencier les matières visuellement)
  //  - Badge principal     : code module (R1.12) si présent, sinon type, sinon "COURS"
  //  - Badge secondaire    : type (CM/TD/TP/EXAM) si détecté ET différent du principal
  function resolveBadge(ev) {
    const code = extractModuleCode(ev.title);
    const hasType = ev.type && ev.type !== 'OTHER';
    let color, label, secondary = null;
    if (code) {
      color = colorForModule(code);
      label = code;
      if (hasType) secondary = TYPE_LABEL[ev.type];
    } else if (hasType) {
      color = typeColorVar(ev.type);
      label = TYPE_LABEL[ev.type];
    } else {
      color = 'var(--other)';
      label = 'COURS';
    }
    return { color, label, secondary };
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
    'ade-consult.univ-artois.fr',
    'www.crous-lille.fr'
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
    // 1) "Enseignant : NOM" explicite (rare chez ADE Artois)
    const m1 = /(?:enseignant|prof(?:esseur)?)\s*[:\-]\s*([^\n]+)/i.exec(desc);
    if (m1) return clean(m1[1], 120);

    // 2) ADE Artois : nom du prof sur sa propre ligne entre "Groupe X-Y-Z" et "Transféré".
    // Format observé :
    //   B1INFOS1TPB1
    //   Groupe 1-B-1
    //   Lipowski Cyrielle        ← ce qu'on veut
    //   Transféré
    //   (Exporté le:20/05/2026 22:49)
    const SKIP = /^(transf[ée]r[ée]|annul[ée]|export[ée]|s[ée]ance|attention|cours\s+annul|groupe\b)/i;
    const META = /^[#(]|^https?:\/\//;
    const GROUP = /^([A-Z]+\d+)+[A-Z0-9]*$/; // codes du genre B1INFOS1TPC1
    const RX_NAME = /^[A-ZÀ-Ÿ][\p{L}'\-]+(\s+[A-ZÀ-Ÿ][\p{L}'\-]+){1,4}$/u;
    const names = [];
    for (let line of desc.split(/\r?\n/)) {
      line = line.trim();
      if (!line || line.length < 4 || line.length > 60) continue;
      if (SKIP.test(line))  continue;
      if (META.test(line))  continue;
      if (GROUP.test(line)) continue;
      if (RX_NAME.test(line)) names.push(line);
    }
    if (names.length) return clean(names.join(' · '), 120);
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
    const serial = serializeEvents(EVENTS);
    // Écriture dans le profil actif (source de vérité moderne)
    updateActiveProfile({ events: serial });
    // + ancienne clé pour rétro-compat
    try { localStorage.setItem(STORAGE_KEYS.events, JSON.stringify(serial)); } catch {}
    updateStorageInfo();
  }
  function loadEvents() {
    // Priorité au profil actif
    const p = getActiveProfile();
    if (p && Array.isArray(p.events) && p.events.length) {
      return deserializeEvents(p.events);
    }
    // Fallback ancienne clé (pré-migration)
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.events);
      if (!raw) return [];
      return deserializeEvents(JSON.parse(raw));
    } catch { return []; }
  }
  function updateStorageInfo() {
    const src = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.source) || 'null'); }
      catch { return null; }
    })();
    const n = EVENTS.length;
    if (n) {
      const when = src?.importedAt ? new Date(src.importedAt).toLocaleString('fr-FR') : '—';
      const type = src?.type === 'ics' ? '.ics' : (src?.type === 'json' ? 'JSON' : '?');
      storageInfo.textContent = `${n} événement(s) — source ${type} — importé le ${when}`;
    } else {
      storageInfo.textContent = 'Aucune donnée stockée.';
    }
    // Affiche la version JS courante (utile pour diagnostiquer les caches obstinés)
    if (versionInfo) {
      const swSet = (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ? '✓' : '–';
      versionInfo.textContent = `App ${APP_VERSION} · SW ${swSet}`;
    }
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

    const row = document.createElement('div'); row.className = 'stats-row';
    const mk = (val, label) => {
      const st = document.createElement('div'); st.className = 'stat';
      const b  = document.createElement('strong'); b.textContent = val;
      const sp = document.createElement('span'); sp.textContent = label;
      st.appendChild(b); st.appendChild(sp); return st;
    };
    row.appendChild(mk(String(s.count), s.count > 1 ? 'cours' : 'cours'));
    const dur = s.minutes ? `${s.hours}h${String(s.minutes).padStart(2,'0')}` : `${s.hours}h`;
    row.appendChild(mk(dur, 'de cours'));

    // 3e stat : nombre de matières uniques aujourd'hui
    const modules = new Set();
    for (const ev of list) {
      const c = extractModuleCode(ev.title);
      if (c) modules.add(c);
    }
    if (modules.size) row.appendChild(mk(String(modules.size), modules.size > 1 ? 'matières' : 'matière'));
    wrap.appendChild(row);

    // Mini-pills des modules du jour, dans l'ordre d'apparition, avec leur couleur
    if (modules.size) {
      const seen = new Set();
      const pills = document.createElement('div'); pills.className = 'module-pills';
      for (const ev of list) {
        const c = extractModuleCode(ev.title);
        if (!c || seen.has(c)) continue;
        seen.add(c);
        const pill = document.createElement('span');
        pill.className = 'module-pill';
        pill.style.setProperty('--type-color', colorForModule(c) || 'var(--other)');
        pill.textContent = c;
        pills.appendChild(pill);
      }
      wrap.appendChild(pills);
    }
    return wrap;
  }

  // === Hero "Prochain cours" — gros widget visuel avec countdown ===
  function buildNextCourseCard(ev, now = new Date()) {
    const diffMs = ev.start - now;
    const { color, label, secondary } = resolveBadge(ev);

    const wrap = document.createElement('article');
    wrap.className = 'hero-next glass';
    wrap.style.setProperty('--type-color', color);
    wrap.setAttribute('role', 'button');
    wrap.tabIndex = 0;
    wrap.addEventListener('click', () => openDetails(ev));

    // Bandeau supérieur : "PROCHAIN COURS · dans 2h35"
    const top = document.createElement('div'); top.className = 'hero-top';
    const tag = document.createElement('span'); tag.className = 'hero-tag';
    tag.textContent = 'Prochain cours';
    const dist = document.createElement('span'); dist.className = 'hero-dist';
    dist.textContent = `dans ${fmtDuration(diffMs)}`;
    top.appendChild(tag); top.appendChild(dist);
    wrap.appendChild(top);

    // Ligne badges (module + type)
    const badges = document.createElement('div'); badges.className = 'hero-badges';
    const b1 = document.createElement('span'); b1.className = 'badge'; b1.textContent = label;
    badges.appendChild(b1);
    if (secondary) {
      const b2 = document.createElement('span'); b2.className = 'badge-sub'; b2.textContent = secondary;
      badges.appendChild(b2);
    }
    wrap.appendChild(badges);

    // Titre cours (sans code module dupliqué)
    const cleanTitle = ev.title.replace(/^\s*[A-Z]{1,5}\d+(?:\.\d+)?\s*[:\-–—]?\s*/i, '').trim() || ev.title;
    const h = document.createElement('h2'); h.className = 'hero-title';
    h.textContent = cleanTitle;
    wrap.appendChild(h);

    // Ligne info : horaire, salle, prof
    const info = document.createElement('div'); info.className = 'hero-info';
    const time = document.createElement('span'); time.className = 'hero-time';
    time.textContent = `${fmtTime(ev.start)} — ${fmtTime(ev.end)}`;
    info.appendChild(time);
    if (ev.room) {
      const r = document.createElement('span'); r.className = 'hero-meta';
      r.textContent = '📍 ' + ev.room;
      info.appendChild(r);
    }
    if (ev.teacher) {
      const t = document.createElement('span'); t.className = 'hero-meta';
      t.textContent = '👤 ' + ev.teacher;
      info.appendChild(t);
    }
    wrap.appendChild(info);

    return wrap;
  }

  // ============================================================
  // MENU CROUS — R.U. de Lens
  // ============================================================
  const CROUS_URL = 'https://www.crous-lille.fr/restaurant/r-u-de-lens/';
  const CROUS_CACHE_KEY = 'edt.crous.v1';
  const CROUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 heures
  let CROUS_MENUS = {}; // { "YYYY-MM-DD": [{name:"ENTREES", dishes:[...]}, ...] }

  // Parse le var_dump PHP exposé dans la page HTML CROUS Lille pour extraire
  // un mapping date → catégories → plats. Structure observée :
  //   ["date"]=> string(10) "2026-05-26"
  //     ["meal"]=> array(...) { ... "midi" ... ["foodcategory"]=> array(...) {
  //       ["name"]=> "ENTREES"
  //       ["dishes"]=> array(N) { ["name"]=> "DISH1" ... }
  //       ["name"]=> "PLATS"
  //       ["dishes"]=> array(M) { ... }
  //     }}
  function parseCrousMenu(html) {
    const out = {};
    if (typeof html !== 'string') return out;
    const dateBlock = /\["date"\]=>\s*string\(\d+\)\s*"(\d{4}-\d{2}-\d{2})"([\s\S]*?)(?=\["date"\]=>|$)/g;
    const catRe  = /\["name"\]=>\s*string\(\d+\)\s*"([A-ZÉÈÊÀÂÎÏÔÛÇ][A-ZÉÈÊÀÂÎÏÔÛÇ\s'’-]*?)"\s*\["dishes"\]=>\s*array\(\d+\)\s*\{/g;
    const dishRe = /\["name"\]=>\s*string\(\d+\)\s*"([^"]+)"/g;
    let dm;
    while ((dm = dateBlock.exec(html))) {
      const date = dm[1];
      const section = dm[2];
      catRe.lastIndex = 0;
      const cats = [];
      const matches = [];
      let cm;
      while ((cm = catRe.exec(section))) {
        matches.push({ name: cm[1].trim(), bodyStart: cm.index + cm[0].length });
      }
      for (let i = 0; i < matches.length; i++) {
        const end = (i + 1 < matches.length) ? matches[i + 1].bodyStart : section.length;
        const body = section.slice(matches[i].bodyStart, end);
        const dishes = [];
        dishRe.lastIndex = 0;
        let dm2;
        while ((dm2 = dishRe.exec(body))) dishes.push(dm2[1].trim());
        if (dishes.length) cats.push({ name: matches[i].name, dishes });
      }
      if (cats.length) out[date] = cats;
    }
    return out;
  }

  // Charge le menu CROUS — depuis le cache si < 6h, sinon refetch via proxy
  async function loadCrousMenu({ force = false } = {}) {
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(CROUS_CACHE_KEY) || 'null'); } catch {}
    if (!force && cache && cache.fetchedAt && (Date.now() - cache.fetchedAt) < CROUS_CACHE_TTL_MS) {
      CROUS_MENUS = cache.menus || {};
      return;
    }
    try {
      const fetchUrl = resolveFetchUrl(CROUS_URL);
      const res = await fetch(fetchUrl, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) return;
      const html = await res.text();
      const menus = parseCrousMenu(html);
      if (Object.keys(menus).length) {
        CROUS_MENUS = menus;
        try { localStorage.setItem(CROUS_CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), menus })); } catch {}
      }
    } catch {/* silencieux : pas de menu, pas grave */}
  }

  function buildCrousCard(dateISO) {
    const cats = CROUS_MENUS[dateISO];
    if (!cats || !cats.length) return null;
    const wrap = document.createElement('section');
    wrap.className = 'crous-card glass';
    const head = document.createElement('div'); head.className = 'crous-head';
    const ttl = document.createElement('h3'); ttl.className = 'crous-title';
    ttl.textContent = '🍽 Menu R.U. Lens';
    const sub = document.createElement('span'); sub.className = 'crous-sub';
    sub.textContent = 'déjeuner';
    head.appendChild(ttl); head.appendChild(sub);
    wrap.appendChild(head);

    for (const cat of cats) {
      const sec = document.createElement('div'); sec.className = 'crous-cat';
      const cName = document.createElement('div'); cName.className = 'crous-cat-name';
      cName.textContent = cat.name;
      sec.appendChild(cName);
      const list = document.createElement('ul'); list.className = 'crous-dishes';
      for (const d of cat.dishes) {
        const li = document.createElement('li');
        // Capitalise joliment ("SALADE DE PATES" → "Salade de pâtes" approximatif)
        li.textContent = prettyDish(d);
        list.appendChild(li);
      }
      sec.appendChild(list);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  // Construit le contenu menu (catégories + plats) pour la modale
  function buildCrousContent(dateISO) {
    const wrap = document.createElement('div');
    const cats = CROUS_MENUS[dateISO];
    if (!cats || !cats.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.style.textAlign = 'center';
      p.style.padding = '20px';
      p.textContent = 'Menu non disponible pour ce jour.';
      wrap.appendChild(p);
      return wrap;
    }
    for (const cat of cats) {
      const sec = document.createElement('div'); sec.className = 'crous-cat';
      const cName = document.createElement('div'); cName.className = 'crous-cat-name';
      cName.textContent = cat.name;
      sec.appendChild(cName);
      const list = document.createElement('ul'); list.className = 'crous-dishes';
      for (const d of cat.dishes) {
        const li = document.createElement('li');
        li.textContent = prettyDish(d);
        list.appendChild(li);
      }
      sec.appendChild(list);
      wrap.appendChild(sec);
    }
    return wrap;
  }

  // Ouvre la modale du menu CROUS du jour
  async function openCrousModal(dateISO) {
    haptic(8);
    // Date lisible
    if (crousDate) {
      const d = parseISODate(dateISO);
      crousDate.textContent = d
        ? d.toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long' })
        : '';
    }
    // Charge si pas déjà en cache
    if (!Object.keys(CROUS_MENUS).length) {
      crousContent.replaceChildren(Object.assign(document.createElement('p'), {
        className: 'muted', textContent: 'Chargement du menu…',
        style: 'text-align:center;padding:20px'
      }));
      if (typeof crousDlg.showModal === 'function' && !crousDlg.open) crousDlg.showModal();
      await loadCrousMenu();
    }
    crousContent.replaceChildren(buildCrousContent(dateISO));
    if (!crousDlg.open) {
      try {
        if (typeof crousDlg.showModal === 'function') crousDlg.showModal();
        else crousDlg.setAttribute('open', '');
      } catch { crousDlg.setAttribute('open', ''); }
    }
  }

  function prettyDish(s) {
    if (!s) return '';
    const lower = s.toLocaleLowerCase('fr-FR');
    // Capitalise première lettre uniquement
    return lower.charAt(0).toLocaleUpperCase('fr-FR') + lower.slice(1);
  }

  // Détecte le type de pause selon l'heure de début et la durée
  function detectPauseType(prevEnd, nextStart) {
    const startH = prevEnd.getHours() + prevEnd.getMinutes() / 60;
    const durMin = (nextStart - prevEnd) / 60000;
    // Pause midi : commence 11h30-13h00 et dure ≥ 45 min
    if (startH >= 11.5 && startH <= 13 && durMin >= 45) return 'midi';
    // Pause après-midi : commence ≥ 14h, dure ≥ 30 min
    if (startH >= 14 && durMin >= 30) return 'after';
    // Pause longue
    if (durMin >= 30) return 'long';
    // Pause courte (15-30 min)
    if (durMin >= 15) return 'short';
    return null;
  }

  function buildPauseCard(prevEv, nextEv, dateISO) {
    const ms = nextEv.start - prevEv.end;
    const type = detectPauseType(prevEv.end, nextEv.start);
    if (!type) return null;

    const el = document.createElement('div');
    el.className = 'pause pause-' + type;

    let icon = '', label = 'Pause';
    if (type === 'midi')       { icon = '🍽'; label = 'Pause déjeuner'; }
    else if (type === 'after') { icon = '☕'; label = 'Pause'; }
    else if (type === 'short') { icon = '·';  label = 'Petite pause'; }
    else                       { icon = '·';  label = 'Pause'; }

    const txt = document.createElement('span');
    txt.className = 'pause-text';
    txt.textContent = `${icon} ${label} · ${fmtDuration(ms)}`;
    el.appendChild(txt);

    // Pause déjeuner → ouvre la modale CROUS au tap
    if (type === 'midi') {
      el.classList.add('clickable');
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      const hint = document.createElement('span');
      hint.className = 'pause-hint';
      hint.textContent = 'Voir menu RU →';
      el.appendChild(hint);
      const open = () => openCrousModal(dateISO);
      el.addEventListener('click', open);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    }
    return el;
  }

  // Indicateur "après-midi libre" en bas du jour
  function buildFreeAfternoonCard(endTime) {
    const el = document.createElement('div');
    el.className = 'free-afternoon glass';
    const icon = document.createElement('span'); icon.className = 'fa-icon'; icon.textContent = '🏖';
    const txt = document.createElement('div'); txt.className = 'fa-text';
    const t = document.createElement('strong'); t.textContent = 'Après-midi libre';
    const s = document.createElement('span'); s.textContent = `Fini à ${fmtTime(endTime)}, profite bien !`;
    txt.appendChild(t); txt.appendChild(s);
    el.appendChild(icon); el.appendChild(txt);
    return el;
  }

  function buildCourseCard(ev, compact = false, now = new Date()) {
    const card = document.createElement('article');
    card.className = 'course';
    const state = liveStateFor(ev, now);
    if (!compact) card.classList.add(state);
    const { color: tcolor, label: tlabel, secondary: tsec } = resolveBadge(ev);
    card.style.setProperty('--type-color', tcolor);

    const row1 = document.createElement('div');
    row1.className = 'row1';

    const head = document.createElement('div'); head.className = 'head';

    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = tlabel;
    head.appendChild(badge);

    if (tsec) {
      const sub = document.createElement('span');
      sub.className = 'badge-sub';
      sub.textContent = tsec;
      head.appendChild(sub);
    }

    // Titre nettoyé : enlève le code module et les ":" en début s'il est déjà dans le badge
    const cleanTitle = ev.title.replace(/^\s*[A-Z]{1,5}\d+(?:\.\d+)?\s*[:\-–—]?\s*/i, '').trim() || ev.title;
    const title = document.createElement('h3');
    title.className = 'title';
    title.textContent = cleanTitle;
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
    // === ONBOARDING : aucun profil configuré → on prend toute la place ===
    if (!getActiveProfile()) {
      content.appendChild(buildOnboardingPanel());
      return;
    }
    const list = eventsForDay(CURSOR);
    const now = new Date();
    const isToday = sameDay(CURSOR, now);
    const isWeekend = CURSOR.getDay() === 0 || CURSOR.getDay() === 6;

    if (!list.length) {
      const emoji = isWeekend ? '🏖' : (isToday ? '🌤' : '📅');
      const title = isWeekend ? 'Week-end' : (isToday ? 'Journée libre' : 'Pas de cours');
      const sub   = isWeekend ? 'Profite bien !' : (isToday ? "Rien au programme aujourd'hui." : 'Aucun cours prévu ce jour.');
      content.appendChild(buildEmpty(`${emoji} ${title}`, sub));

      // Empty state intelligent : si l'EDT a un prochain cours, montre-le bien visible
      if (EVENTS.length) {
        const upcoming = [...EVENTS].sort((a, b) => a.start - b.start).find(ev => ev.start >= now);
        if (upcoming && !sameDay(upcoming.start, CURSOR)) {
          // Mini hero card "Prochain cours" cliquable, mais marqué comme "à venir"
          const card = buildNextCourseCard(upcoming, now);
          card.classList.add('hero-distant');
          // Remplace le tag "Prochain cours" par "À venir · jour" pour clarifier
          const tag = card.querySelector('.hero-tag');
          const dist = card.querySelector('.hero-dist');
          if (tag) tag.textContent = 'À venir';
          if (dist) {
            const d = new Date(upcoming.start);
            dist.textContent = `${d.toLocaleDateString('fr-FR', {weekday:'long', day:'2-digit', month:'short'})} à ${fmtTime(upcoming.start)}`;
          }
          // Tap = navigate to that day
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            CURSOR = new Date(upcoming.start); CURSOR.setHours(0,0,0,0); render();
          }, true);
          content.appendChild(card);
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

    // Cours + pauses (≥ 15 min) avec type (midi / après-midi / courte / longue)
    const PAUSE_THRESHOLD = 15 * 60 * 1000;
    const dateISO = toISODate(CURSOR);
    for (let i = 0; i < list.length; i++) {
      const ev = list[i];
      content.appendChild(buildCourseCard(ev, false, now));
      if (i < list.length - 1) {
        const gap = list[i + 1].start - ev.end;
        if (gap >= PAUSE_THRESHOLD) {
          const pauseCard = buildPauseCard(ev, list[i + 1], dateISO);
          if (pauseCard) content.appendChild(pauseCard);
        }
      }
    }

    // « Après-midi libre » si le dernier cours finit avant 15h
    const last = list[list.length - 1];
    if (last && last.end.getHours() < 15 && !isWeekend) {
      content.appendChild(buildFreeAfternoonCard(last.end));
    }
  }

  // === Vue semaine en TIMELINE (style Google Calendar) ===
  function renderWeek() {
    clearNode(content);
    if (!getActiveProfile()) {
      content.appendChild(buildOnboardingPanel());
      return;
    }
    const start = startOfWeek(CURSOR);
    const today = new Date();
    const HOUR_PX = 56;
    const DAYS_COUNT = 6; // Lun → Sam

    // Détecte la plage horaire utile en scannant les événements de la semaine
    let minH = 24, maxH = 0;
    for (let i = 0; i < DAYS_COUNT; i++) {
      const d = addDays(start, i);
      for (const ev of EVENTS) {
        if (!sameDay(ev.start, d)) continue;
        const h1 = ev.start.getHours();
        const h2 = ev.end.getHours() + (ev.end.getMinutes() > 0 ? 1 : 0);
        if (h1 < minH) minH = h1;
        if (h2 > maxH) maxH = h2;
      }
    }
    // Aucun cours cette semaine → message
    if (minH >= maxH) {
      const e = buildEmpty('Semaine vide', 'Pas de cours cette semaine.');
      content.appendChild(e);
      return;
    }
    // Marges horaires confortables
    minH = Math.max(7, minH);
    maxH = Math.min(22, Math.max(maxH, minH + 2));
    const hoursCount = maxH - minH;

    const tl = document.createElement('section');
    tl.className = 'week-timeline glass';

    // Header sticky : jours
    const header = document.createElement('div');
    header.className = 'wt-header';
    const corner = document.createElement('div'); corner.className = 'wt-corner';
    header.appendChild(corner);
    const DOW = ['LUN','MAR','MER','JEU','VEN','SAM'];
    for (let i = 0; i < DAYS_COUNT; i++) {
      const day = addDays(start, i);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'wt-daycell';
      if (sameDay(day, today)) cell.classList.add('today');
      const dow = document.createElement('span'); dow.className = 'dow'; dow.textContent = DOW[i];
      const num = document.createElement('span'); num.className = 'dnum'; num.textContent = day.getDate();
      cell.appendChild(dow); cell.appendChild(num);
      cell.addEventListener('click', () => {
        haptic(8);
        CURSOR = new Date(day);
        VIEW = 'day';
        render();
      });
      header.appendChild(cell);
    }
    tl.appendChild(header);

    // Corps : col heures + 6 col jours, blocs positionnés en absolu
    const body = document.createElement('div');
    body.className = 'wt-body';
    body.style.setProperty('--hour-px', HOUR_PX + 'px');
    body.style.height = (hoursCount * HOUR_PX) + 'px';

    // Colonne des heures
    const hourCol = document.createElement('div');
    hourCol.className = 'wt-hourcol';
    for (let h = minH; h < maxH; h++) {
      const row = document.createElement('div');
      row.className = 'wt-hourrow';
      row.textContent = h + 'h';
      hourCol.appendChild(row);
    }
    body.appendChild(hourCol);

    // Colonnes des jours
    for (let i = 0; i < DAYS_COUNT; i++) {
      const day = addDays(start, i);
      const col = document.createElement('div');
      col.className = 'wt-daycol';
      if (sameDay(day, today)) col.classList.add('today');

      // Lignes horaires de fond
      for (let h = minH; h < maxH; h++) {
        const line = document.createElement('div');
        line.className = 'wt-hourline';
        col.appendChild(line);
      }

      // Cours du jour : blocs positionnés
      const dayEvs = eventsForDay(day);
      for (const ev of dayEvs) {
        const startMin = (ev.start.getHours() - minH) * 60 + ev.start.getMinutes();
        const durMin = Math.max(15, (ev.end - ev.start) / 60000);
        const top = (startMin / 60) * HOUR_PX;
        const height = Math.max(22, (durMin / 60) * HOUR_PX - 2);

        const block = document.createElement('button');
        block.type = 'button';
        block.className = 'wt-block';
        block.style.top = top + 'px';
        block.style.height = height + 'px';
        const { color: bcolor, label: blabel, secondary: bsec } = resolveBadge(ev);
        block.style.setProperty('--type-color', bcolor);

        const badge = document.createElement('span'); badge.className = 'wt-bbadge';
        badge.textContent = bsec ? `${blabel} · ${bsec}` : blabel;
        const ttl = document.createElement('span'); ttl.className = 'wt-btitle';
        ttl.textContent = ev.title.replace(/^\s*[A-Z]{1,5}\d+(?:\.\d+)?\s*[:\-–—]?\s*/i, '').trim() || ev.title;
        block.appendChild(badge);
        block.appendChild(ttl);
        if (ev.room && height >= 40) {
          const rm = document.createElement('span'); rm.className = 'wt-broom';
          rm.textContent = ev.room;
          block.appendChild(rm);
        }
        block.addEventListener('click', () => openDetails(ev));
        col.appendChild(block);
      }

      // Trait "maintenant" sur la colonne du jour courant
      if (sameDay(day, today)) {
        const curMin = (today.getHours() - minH) * 60 + today.getMinutes();
        if (curMin >= 0 && curMin <= hoursCount * 60) {
          const now = document.createElement('div');
          now.className = 'wt-now';
          now.style.top = (curMin / 60 * HOUR_PX) + 'px';
          col.appendChild(now);
        }
      }
      body.appendChild(col);
    }

    tl.appendChild(body);
    content.appendChild(tl);

    // Scroll auto sur l'heure courante (ou 8h par défaut)
    requestAnimationFrame(() => {
      const targetH = sameDay(today, addDays(start, 0)) || sameDay(today, addDays(start, 5))
        ? today.getHours() : minH;
      const offset = Math.max(0, (targetH - minH - 1) * HOUR_PX);
      window.scrollTo({ top: window.scrollY + offset, behavior: 'auto' });
    });
  }

  // === Panneau d'accueil inline : impossible à louper ===
  function buildOnboardingPanel() {
    const wrap = document.createElement('section');
    wrap.className = 'onboarding glass';

    const head = document.createElement('div');
    head.className = 'onboarding-head';
    const t = document.createElement('h2');
    t.textContent = '👋 Bienvenue !';
    const s = document.createElement('p');
    s.textContent = 'Choisis ta classe ci-dessous, ton emploi du temps se chargera automatiquement à chaque ouverture.';
    head.appendChild(t); head.appendChild(s);
    wrap.appendChild(head);

    const presetsAvailable = PRESETS.length ? PRESETS : FALLBACK_PRESETS;
    if (!presetsAvailable.length) {
      const note = document.createElement('p');
      note.className = 'muted';
      note.style.textAlign = 'center';
      note.style.padding = '20px';
      note.textContent = 'Aucune classe disponible. Configure une URL ADE dans ⚙ Réglages.';
      wrap.appendChild(note);
      return wrap;
    }

    const list = document.createElement('ul');
    list.className = 'onboarding-list';
    for (const preset of presetsAvailable) {
      const li = document.createElement('li');
      li.className = 'preset-row';

      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = preset.name;
      li.appendChild(name);
      if (preset.tag) {
        const tag = document.createElement('span');
        tag.className = 'ptag';
        tag.textContent = preset.tag;
        li.appendChild(tag);
      }
      li.addEventListener('click', async () => {
        haptic(10);
        let safeUrl;
        try { safeUrl = safeIcsUrl(preset.url); }
        catch (e) { toast('URL invalide : ' + e.message); return; }
        const p = addProfile({ name: preset.name, type: 'ics', url: safeUrl, filter: preset.filter || null });
        EVENTS = [];
        refreshProfileChip();
        render();
        toast(`Classe « ${p.name} » ajoutée`);
        const ok = await autoRefresh({ silent: false });
        if (ok) { ensureModuleColors(); jumpToMostRelevantDate(); render(); }
      });
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
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
    LAST_DETAILS_EV = ev;
    const fmtFull = (d) => d.toLocaleString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit'
    });
    const { color: dcolor, label: dlabel, secondary: dsec } = resolveBadge(ev);
    detailsContent.style.setProperty('--type-color', dcolor);
    detailsBadge.textContent = dsec ? `${dlabel} · ${dsec}` : dlabel;
    detailsBadge.style.setProperty('--type-color', dcolor);
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
    renderWeekPills();
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

  // === Bandeau de pills jour de la semaine ===
  function renderWeekPills() {
    clearNode(weekPills);
    const start = startOfWeek(CURSOR);
    const today = new Date();
    const DOW = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];
    for (let i = 0; i < 7; i++) {
      const d = addDays(start, i);
      const btn = document.createElement('button');
      btn.className = 'day-pill';
      if (sameDay(d, CURSOR)) btn.classList.add('active');
      if (sameDay(d, today))  btn.classList.add('today');
      if (i >= 5)              btn.classList.add('weekend');
      const hasEv = EVENTS.some(ev => sameDay(ev.start, d));
      if (hasEv) btn.classList.add('has-events');

      const dow = document.createElement('span'); dow.className = 'dow'; dow.textContent = DOW[i];
      const num = document.createElement('span'); num.className = 'dnum'; num.textContent = d.getDate();
      const dot = document.createElement('span'); dot.className = 'dot';
      btn.appendChild(dow); btn.appendChild(num); btn.appendChild(dot);

      btn.addEventListener('click', () => {
        CURSOR = new Date(d);
        haptic(8);
        render();
      });
      weekPills.appendChild(btn);
    }
    // scroll horizontal pour centrer l'actif sur mobile
    requestAnimationFrame(() => {
      const active = weekPills.querySelector('.day-pill.active');
      if (active && active.scrollIntoView) {
        active.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
      }
    });
  }

  // === Vibration tactile (no-op sur iOS Safari) ===
  function haptic(ms) {
    if (navigator.vibrate) { try { navigator.vibrate(ms); } catch {} }
  }

  // === Anti double-tap-zoom iOS (fallback JS) ===
  // touch-action: manipulation suffit en théorie mais iOS triche parfois.
  // On bloque le 2e tap rapide tant qu'il n'est pas sur un input texte.
  (() => {
    let lastTap = 0;
    document.addEventListener('touchend', (e) => {
      const now = Date.now();
      const target = e.target;
      const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (!isInput && now - lastTap < 320) {
        e.preventDefault();
      }
      lastTap = now;
    }, { passive: false });
    // Pincement à 2 doigts → bloque aussi
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  })();

  // === Dialogue "Mes classes" ===
  function renderProfileList() {
    clearNode(profileList);
    const profiles = loadProfilesRaw();
    const activeId = (getActiveProfile() || {}).id;
    if (!profiles.length) {
      const li = document.createElement('li');
      li.className = 'profile-empty';
      const t = document.createElement('strong');
      t.style.display = 'block';
      t.style.fontSize = '15px';
      t.style.color = 'var(--fg)';
      t.style.marginBottom = '6px';
      t.textContent = '👋 Bienvenue !';
      const s = document.createElement('span');
      s.textContent = 'Choisis ta classe ci-dessous pour charger ton emploi du temps automatiquement.';
      li.appendChild(t); li.appendChild(s);
      profileList.appendChild(li);
      return;
    }
    for (const p of profiles) {
      const li = document.createElement('li');
      li.className = 'profile-row' + (p.id === activeId ? ' active' : '');

      const sw = document.createElement('button');
      sw.type = 'button'; sw.className = 'switch';
      const name = document.createElement('span'); name.className = 'name'; name.textContent = p.name;
      const meta = document.createElement('span'); meta.className = 'meta';
      const count = Array.isArray(p.events) ? p.events.length : 0;
      const when = p.importedAt
        ? new Date(p.importedAt).toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit', year:'2-digit' })
        : '—';
      meta.textContent = `${count} cours · sync ${when}`;
      sw.appendChild(name); sw.appendChild(meta);
      sw.addEventListener('click', () => {
        if (p.id === activeId) { profileDlg.close(); return; }
        haptic(10);
        switchProfile(p.id);
        toast(`Classe : ${p.name}`);
        profileDlg.close();
      });

      const del = document.createElement('button');
      del.type = 'button'; del.className = 'del'; del.setAttribute('aria-label', 'Supprimer ' + p.name);
      del.textContent = '✕';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Supprimer la classe « ${p.name} » ?`)) return;
        removeProfile(p.id);
        const next = getActiveProfile();
        EVENTS = deserializeEvents(next?.events || []);
        refreshProfileChip();
        render();
        renderProfileList();
      });

      li.appendChild(sw);
      li.appendChild(del);
      profileList.appendChild(li);
    }
  }

  // === Chargement des classes préconfigurées (presets.json) ===
  // Les catalogues (URL contenant plusieurs groupes) sont auto-dépliés en
  // autant de presets que de groupes, chacun avec un filtre {year, sub}.
  async function loadPresets() {
    try {
      const res = await fetch('./presets.json', { cache: 'no-cache' });
      if (!res.ok) return;
      const data = await res.json();
      const list = [];
      if (Array.isArray(data?.classes)) {
        for (const c of data.classes) {
          if (c && c.name && c.url) list.push(c);
        }
      }
      if (Array.isArray(data?.catalogs)) {
        for (const cat of data.catalogs) {
          if (!cat || !cat.url || !Array.isArray(cat.groups)) continue;
          for (const g of cat.groups) {
            if (!g || !g.id || !g.label) continue;
            const [year, sub] = g.id.split('-');
            if (!year || !sub) continue;
            list.push({
              name: g.label,
              url: cat.url,
              tag: cat.tag,
              filter: { year, sub }
            });
          }
        }
      }
      PRESETS = list;
    } catch {/* silencieux : pas de presets, pas grave */}
  }

  // Construit la regex de filtre pour un groupe ADE Artois BUT INFO :
  //   year='B1', sub='C1'  →  /B1INFOS?\d*(?:CM|TDC|TPC1)\b/i
  // Matche les codes de cours (CM commun, TD par lettre, TP par sous-groupe complet)
  function filterRegexFor(year, sub) {
    if (!year || !sub) return null;
    const tdLetter = sub.charAt(0).toUpperCase();
    const tpSub = sub.toUpperCase();
    return new RegExp(`${year}INFOS?\\d*(?:CM|TD${tdLetter}|TP${tpSub})\\b`, 'i');
  }
  // Filtre une liste d'événements ICS selon le filtre d'un profil
  function applyProfileFilter(events, filter) {
    if (!filter || !filter.year || !filter.sub) return events;
    const re = filterRegexFor(filter.year, filter.sub);
    if (!re) return events;
    return events.filter(ev => re.test(ev.description || '') || re.test(ev.title || ''));
  }
  function renderPresetsList() {
    clearNode(presetsList);
    const existingUrls = new Set(loadProfilesRaw().map(p => p.url).filter(Boolean));
    const filtered = PRESETS.filter(p => !existingUrls.has(p.url));
    if (!filtered.length) { presetsSection.hidden = true; return; }
    presetsSection.hidden = false;
    for (const preset of filtered) {
      const li = document.createElement('li');
      li.className = 'preset-row';
      const name = document.createElement('span'); name.className = 'pname'; name.textContent = preset.name;
      li.appendChild(name);
      if (preset.tag) {
        const tag = document.createElement('span'); tag.className = 'ptag'; tag.textContent = preset.tag;
        li.appendChild(tag);
      }
      li.addEventListener('click', async () => {
        haptic(10);
        // Sécurise et valide l'URL avant de créer le profil
        let safeUrl;
        try { safeUrl = safeIcsUrl(preset.url); }
        catch (e) { toast('URL invalide : ' + e.message); return; }
        const p = addProfile({ name: preset.name, type: 'ics', url: safeUrl, filter: preset.filter || null });
        EVENTS = [];
        refreshProfileChip();
        render();
        renderProfileList();
        renderPresetsList();
        toast(`Classe « ${p.name} » ajoutée`);
        const ok = await autoRefresh({ silent: false });
        if (ok) { jumpToMostRelevantDate(); render(); renderProfileList(); }
      });
      presetsList.appendChild(li);
    }
  }

  function openProfileDialog() {
    haptic(8);
    renderProfileList();
    renderPresetsList();
    if (addProfileDetails) addProfileDetails.open = false;
    if (newProfileName) newProfileName.value = '';
    if (newProfileUrl)  newProfileUrl.value = '';
    if (!profileDlg) return;
    try {
      if (typeof profileDlg.showModal === 'function' && !profileDlg.open) {
        profileDlg.showModal();
      } else {
        profileDlg.setAttribute('open', '');
      }
    } catch (e) {
      // Fallback : forcer l'ouverture sans modal
      profileDlg.setAttribute('open', '');
    }
  }
  profileBtn.addEventListener('click', openProfileDialog);

  addProfileBtn.addEventListener('click', async () => {
    const name = newProfileName.value.trim();
    const url  = newProfileUrl.value.trim();
    if (!name) { toast('Donne un nom à cette classe'); return; }
    let safeUrl = null;
    if (url) {
      try { safeUrl = safeIcsUrl(url); }
      catch (e) { toast(e.message); return; }
    }
    addProfileBtn.disabled = true;
    try {
      const p = addProfile({ name, type: 'ics', url: safeUrl });
      EVENTS = [];
      refreshProfileChip();
      render();
      renderProfileList();
      toast(`Classe « ${p.name} » ajoutée`);
      // Si une URL est fournie, on tente une première sync tout de suite
      if (safeUrl) {
        const ok = await autoRefresh({ silent: false });
        if (ok) { jumpToMostRelevantDate(); render(); renderProfileList(); }
      }
      addProfileDetails.open = false;
      newProfileName.value = '';
      newProfileUrl.value  = '';
    } finally {
      addProfileBtn.disabled = false;
    }
  });

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
        haptic(8);
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
      // Met à jour le profil actif (ou en crée un s'il n'y en a aucun)
      if (!getActiveProfile()) addProfile({ name: 'Mon EDT', type: 'ics', url });
      else updateActiveProfile({ type: 'ics', url });
      persistEvents();
      updateActiveProfile({ importedAt: Date.now() });
      ensureModuleColors();
      refreshProfileChip();
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
      if (!getActiveProfile()) addProfile({ name: 'Mon EDT', type: 'ics', url: null });
      else updateActiveProfile({ type: 'ics' });
      persistEvents();
      updateActiveProfile({ importedAt: Date.now() });
      ensureModuleColors();
      refreshProfileChip();
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
      if (!getActiveProfile()) addProfile({ name: 'Mon EDT (JSON)', type: 'json' });
      else updateActiveProfile({ type: 'json', url: null });
      persistEvents();
      updateActiveProfile({ importedAt: Date.now() });
      ensureModuleColors();
      refreshProfileChip();
      jumpToMostRelevantDate();
      toast(`${evs.length} cours · ${importRangeLabel()}`, 4500);
      render();
    } catch (e) { toast(e.message); }
  });

  // Bouton "Forcer la mise à jour" : désinscrit le SW, vide les caches,
  // recharge avec un cache-buster. Garde les profils par défaut.
  if (forceUpdateBtn) forceUpdateBtn.addEventListener('click', async () => {
    forceUpdateBtn.disabled = true;
    forceUpdateBtn.textContent = '↻ Mise à jour…';
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      }
    } catch {}
    // Recharge en hard avec cache-buster pour bypasser tout cache HTTP
    const u = new URL(location.href);
    u.searchParams.set('_t', Date.now().toString());
    location.replace(u.toString());
  });

  clearBtn.addEventListener('click', () => {
    if (!confirm('Effacer toutes les classes et données locales ?')) return;
    Object.values(STORAGE_KEYS).forEach(k => { try { localStorage.removeItem(k); } catch {} });
    EVENTS = []; VIEW = 'day'; CURSOR = new Date();
    refreshProfileChip();
    render();
    updateStorageInfo();
    toast('Données effacées.');
  });

  // === Sync UI ===
  function setSyncState(state) { // 'idle' | 'syncing' | 'synced' | 'error'
    syncBtn.classList.remove('syncing', 'synced', 'error');
    if (state !== 'idle') syncBtn.classList.add(state);
  }

  // === Auto-refresh depuis la dernière URL ADE du profil actif ===
  async function autoRefresh({ silent = true } = {}) {
    const p = getActiveProfile();
    if (!p || p.type !== 'ics' || !p.url) return false;
    setSyncState('syncing');
    try {
      const url = safeIcsUrl(p.url);
      const fetchUrl = resolveFetchUrl(url);
      const res = await fetch(fetchUrl, { credentials: 'omit', redirect: 'follow' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const text = await res.text();
      const allEvs = parseICS(text);
      if (!allEvs.length) throw new Error('Vide');
      // Si le profil a un filtre (cas d'un catalogue multi-groupes), on
      // ne garde que les événements correspondant au sous-groupe choisi.
      const evs = applyProfileFilter(allEvs, p.filter);
      if (!evs.length) throw new Error('Aucun cours pour ce groupe');
      EVENTS = evs;
      persistEvents();
      updateActiveProfile({ importedAt: Date.now() });
      ensureModuleColors();
      setSyncState('synced');
      if (!silent) toast(`${evs.length} cours · à jour`, 2500);
      setTimeout(() => setSyncState('idle'), 2500);
      return true;
    } catch (e) {
      setSyncState('error');
      if (!silent) toast('Sync impossible : ' + e.message);
      setTimeout(() => setSyncState('idle'), 2500);
      return false;
    }
  }

  // Sync manuel via bouton ↻
  syncBtn.addEventListener('click', async () => {
    haptic(10);
    const ok = await autoRefresh({ silent: false });
    if (ok) render();
    else if (!localStorage.getItem(STORAGE_KEYS.source)) {
      toast('Configure ton URL ADE dans ⚙ Réglages');
    }
  });

  // === Sélecteur de date natif (tap sur le titre) ===
  titleBtn.addEventListener('click', () => {
    datePicker.value = toISODate(CURSOR);
    if (datePicker.showPicker) {
      try { datePicker.showPicker(); return; } catch {}
    }
    datePicker.click();
  });
  datePicker.addEventListener('change', () => {
    const d = parseISODate(datePicker.value);
    if (d) { CURSOR = d; haptic(8); render(); }
  });

  // === Bouton "Copier" dans la modale détails ===
  copyDetailsBtn.addEventListener('click', async () => {
    if (!LAST_DETAILS_EV) return;
    const ev = LAST_DETAILS_EV;
    const fmtFull = (d) => d.toLocaleString('fr-FR', {
      weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit'
    });
    const lines = [
      `${TYPE_LABEL[ev.type] || 'COURS'} · ${ev.title}`,
      `${fmtFull(ev.start)} → ${fmtFull(ev.end)}`,
      ev.room    ? `Salle : ${ev.room}`       : null,
      ev.teacher ? `Enseignant : ${ev.teacher}` : null
    ].filter(Boolean);
    const txt = lines.join('\n');
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(txt);
      else {
        // Fallback iOS PWA standalone
        const ta = document.createElement('textarea');
        ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy'); ta.remove();
      }
      toast('Copié dans le presse-papier');
    } catch {
      toast('Copie impossible');
    }
  });

  // === Pull-to-refresh ===
  (() => {
    let startY = null, dy = 0, pulling = false, ready = false;
    const THRESHOLD = 70;
    content.addEventListener('touchstart', (e) => {
      if (window.scrollY > 0 || e.touches.length !== 1) { startY = null; return; }
      startY = e.touches[0].clientY;
      dy = 0; ready = false;
    }, { passive: true });

    content.addEventListener('touchmove', (e) => {
      if (startY == null) return;
      dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pullIndicator.classList.remove('pulling', 'ready'); pulling = false; return; }
      if (!pulling) { pullIndicator.classList.add('pulling'); pulling = true; }
      const reached = dy >= THRESHOLD;
      if (reached !== ready) {
        ready = reached;
        pullIndicator.classList.toggle('ready', ready);
        pullLabel.textContent = ready ? 'Relâcher pour rafraîchir' : 'Tirer pour rafraîchir';
        if (ready) haptic(12);
      }
    }, { passive: true });

    content.addEventListener('touchend', async () => {
      if (startY == null) { return; }
      const wasReady = ready;
      startY = null; pulling = false; ready = false;
      if (wasReady) {
        pullIndicator.classList.add('loading');
        pullLabel.textContent = 'Synchronisation…';
        await autoRefresh({ silent: false });
        render();
        pullIndicator.classList.remove('loading');
      }
      pullIndicator.classList.remove('pulling', 'ready');
    }, { passive: true });
  })();

  // === Lien magique : ?addUrl=...&name=... pour pré-configurer une classe ===
  // Utile pour partager : "Voici mon EDT déjà prêt, clique sur ce lien"
  function handleMagicLink() {
    const params = new URLSearchParams(location.search);
    const addUrl = params.get('addUrl');
    const name = params.get('name') || 'Classe partagée';
    if (!addUrl) return false;
    try {
      const safe = safeIcsUrl(addUrl);
      // évite les doublons
      const existing = loadProfilesRaw().find(p => p.url === safe);
      if (existing) {
        setActiveProfileId(existing.id);
        toast(`Classe « ${existing.name} » activée`);
      } else {
        const p = addProfile({ name: clean(name, 40), type: 'ics', url: safe });
        toast(`Classe « ${p.name} » ajoutée`);
      }
      // Nettoie l'URL pour ne pas re-déclencher au refresh
      history.replaceState(null, '', location.pathname);
      return true;
    } catch (e) {
      toast('Lien invalide : ' + e.message);
      return false;
    }
  }

  // ---------- Démarrage ----------
  async function bootstrap() {
    migrateLegacyIfNeeded();
    loadModuleIndex();
    handleMagicLink();
    await loadPresets();
    EVENTS = loadEvents();
    const noProfile = !getActiveProfile();
    if (!EVENTS.length && noProfile) {
      // Démo : journée type si l'utilisateur n'a encore rien importé/configuré
      EVENTS = demoEvents();
    }
    ensureModuleColors();
    refreshProfileChip();
    render();
    updateStorageInfo();
    // Auto-refresh silencieux au démarrage si une URL ADE est configurée
    autoRefresh({ silent: true }).then(ok => { if (ok) { ensureModuleColors(); render(); } });

    // Charge le menu CROUS en arrière-plan (silencieux, ne bloque pas l'app)
    loadCrousMenu().then(() => { if (getActiveProfile()) render(); });

    // === Onboarding : si aucune classe configurée, ouvre auto le menu ===
    // (Geste utilisateur attendu pour showModal sur certains navigateurs,
    // mais Safari/Chrome modernes l'autorisent juste après load)
    if (noProfile && PRESETS.length) {
      setTimeout(() => openProfileDialog(), 350);
    }
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
      window.addEventListener('load', async () => {
        try {
          const reg = await navigator.serviceWorker.register('./service-worker.js');

          // Détecte une nouvelle version installée et prête à prendre le relais
          const onUpdate = (worker) => {
            worker.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                // Nouvelle version dispo, on l'active tout de suite
                worker.postMessage('SKIP_WAITING');
              }
            });
          };
          if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
          reg.addEventListener('updatefound', () => {
            if (reg.installing) onUpdate(reg.installing);
          });

          // Quand le contrôleur SW change (nouveau SW actif), on recharge une fois
          let refreshing = false;
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (refreshing) return;
            refreshing = true;
            location.reload();
          });

          // Vérifie une mise à jour à chaque retour en avant-plan
          document.addEventListener('visibilitychange', () => {
            if (!document.hidden) reg.update().catch(() => {});
          });
        } catch {/* silencieux */}
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
