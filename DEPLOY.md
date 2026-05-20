# Déploiement — EDT Université d'Artois (Lens)

## Arborescence finale

```
EDTbyLB/
├── index.html
├── style.css
├── app.js
├── manifest.json
├── service-worker.js
├── proxy.php           ← relais CORS (whitelist ade-consult.univ-artois.fr)
├── .htaccess           ← sécurité, HTTPS, cache, MIME
├── sample-edt.json     ← exemple JSON manuel
└── icons/
    ├── icon-192.png    ← À FOURNIR (carré, opaque, 192×192)
    └── icon-512.png    ← À FOURNIR (carré, opaque, 512×512)
```

## 1. Icônes (obligatoire pour iOS)

iOS refuse les icônes transparentes. Génère deux PNG carrés **opaques** :

- `icons/icon-192.png` (192×192)
- `icons/icon-512.png` (512×512)

Outils : <https://realfavicongenerator.net/> ou <https://www.pwabuilder.com/imageGenerator>.

## 2. Déploiement sur Hostinger via GitHub

### Option A — Git auto-deploy (recommandé)

1. Crée un repo GitHub public ou privé.
2. Pousse l'ensemble des fichiers (sauf `DEPLOY.md` qui sera bloqué par `.htaccess`).
3. Dans le panneau **Hostinger → hPanel → Sites → Avancé → Git** :
   - Repository : `https://github.com/<toi>/<repo>.git`
   - Branch : `main`
   - Install path : `public_html`
4. Active l'auto-déploiement (webhook GitHub).

### Option B — FTP

1. Ouvre **Hostinger → Gestionnaire de fichiers** ou FileZilla.
2. Upload tout le contenu du dossier dans `public_html/`.

## 3. HTTPS

Sur Hostinger, **active le SSL gratuit Let's Encrypt** dans :
hPanel → Sécurité → SSL → Installer.

Sans HTTPS, le Service Worker ne s'enregistre pas et iOS refuse l'installation.

## 4. Vérifier que `proxy.php` fonctionne

Test rapide depuis ton navigateur :
```
https://ton-domaine.tld/proxy.php?u=https%3A%2F%2Fade-consult.univ-artois.fr%2Fjsp%2Fcustom%2Fmodules%2Fplannings%2Fanonymous_cal.jsp%3Fresources%3D1234%26projectId%3D2%26calType%3Dical%26firstDate%3D2025-09-01%26lastDate%3D2026-07-31
```

Réponse attendue : du texte commençant par `BEGIN:VCALENDAR`.
Codes d'erreur :
- `403 Host not allowed` → l'URL n'est pas dans la whitelist `ALLOWED_HOSTS` de `proxy.php`.
- `502 Upstream did not return iCalendar data` → ADE a renvoyé du HTML (URL invalide / non publique).

## 5. Récupérer ton URL ADE personnelle (Lens)

1. <https://ade-consult.univ-artois.fr/> → login SSO Artois.
2. Ouvre l'arborescence des ressources → ton groupe / promo.
3. Onglet **Mon planning** → en bas à gauche, icône **Exporter mon agenda** (📅).
4. Plage de dates large (ex. `01/09/2025 → 31/08/2026`).
5. Choix : **« Générer URL »** (PAS « Télécharger »).
6. Copie l'URL `.ics` → ouvre ta PWA → **⚙︎ Réglages** → colle dans le champ → **Importer le lien**.

L'URL reste valide toute l'année tant que ton groupe ne change pas. La PWA la réutilise au prochain démarrage et met à jour les cours en arrière-plan.

## 6. Installation sur iPhone

1. Ouvre `https://ton-domaine.tld/` dans **Safari** (pas Chrome).
2. Bouton **Partager** → **Sur l'écran d'accueil**.
3. L'app s'ouvre désormais en plein écran, fonctionne hors-ligne.

## 7. Mise à jour du code

À chaque déploiement, incrémente `VERSION` dans `service-worker.js`
(ex. `'edt-v1.0.0' → 'edt-v1.0.1'`) pour forcer le rafraîchissement du cache.

## 8. Hardening optionnel

- Limite l'accès à `proxy.php` aux requêtes provenant de ton domaine (déjà en place via le check `Origin`).
- Pour rate-limiter, Hostinger ne propose pas de middleware ; ajoute si besoin un compteur via session ou fichier dans `proxy.php`.
- Garde `proxy.php` à jour : ajoute uniquement les hôtes que TU utilises dans `ALLOWED_HOSTS`.
