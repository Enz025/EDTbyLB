<?php
/* ============================================================
   proxy.php — mini-relais CORS pour récupérer le .ics ADE
   Sécurité :
   - Whitelist STRICTE de l'hôte ADE (sinon open-proxy = mauvais).
   - HTTPS forcé.
   - Pas de cookies / pas de credentials forwardés.
   - Réponse en text/calendar, jamais en HTML/JS.
   - Cache léger côté serveur (5 min) pour soulager ADE.
   ============================================================ */

declare(strict_types=1);

const ALLOWED_HOSTS = [
    'ade-consult.univ-artois.fr',
    // ajoute ici d'autres instances si besoin (ex : vtiutb.univ-artois.fr)
];

const CACHE_TTL = 300;          // 5 minutes
const MAX_BYTES = 5 * 1024 * 1024; // 5 Mio
const USER_AGENT = 'EDT-PWA-Proxy/1.0';

// --------- En-têtes CORS minimaux (même-origine attendu, mais on tolère) ---------
header('Vary: Origin');
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: no-referrer');

// Comme le proxy est appelé en same-origin par la PWA, on n'a pas vraiment besoin
// d'ouvrir CORS. On restreint à same-origin pour éviter qu'un site tiers s'en serve.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$host   = $_SERVER['HTTP_HOST']   ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== $host) {
    http_response_code(403);
    exit('Forbidden: cross-origin not allowed.');
}

// --------- Validation de l'URL cible ---------
$raw = $_GET['u'] ?? '';
if ($raw === '' || strlen($raw) > 2048) {
    http_response_code(400);
    exit('Missing or oversized "u" parameter.');
}

$parts = parse_url($raw);
if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
    http_response_code(400);
    exit('Invalid URL.');
}
if ($parts['scheme'] !== 'https') {
    http_response_code(400);
    exit('Only HTTPS targets are allowed.');
}
if (!in_array(strtolower($parts['host']), ALLOWED_HOSTS, true)) {
    http_response_code(403);
    exit('Host not allowed.');
}
if (!empty($parts['user']) || !empty($parts['pass'])) {
    http_response_code(400);
    exit('URL with credentials is not allowed.');
}

$targetUrl = $raw;

// --------- Cache disque ---------
$cacheDir  = sys_get_temp_dir() . '/edt-proxy-cache';
if (!is_dir($cacheDir)) @mkdir($cacheDir, 0700, true);
$cacheFile = $cacheDir . '/' . hash('sha256', $targetUrl) . '.ics';

if (is_file($cacheFile) && (time() - filemtime($cacheFile)) < CACHE_TTL) {
    header('Content-Type: text/calendar; charset=utf-8');
    header('Cache-Control: private, max-age=' . CACHE_TTL);
    header('X-Cache: HIT');
    readfile($cacheFile);
    exit;
}

// --------- Fetch côté serveur ---------
if (!function_exists('curl_init')) {
    http_response_code(500);
    exit('cURL extension is required.');
}

$ch = curl_init($targetUrl);
$body = '';
$bytes = 0;
$ok = curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => false,  // on stream via WRITEFUNCTION pour borner la taille
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_MAXREDIRS      => 3,
    CURLOPT_PROTOCOLS      => CURLPROTO_HTTPS,
    CURLOPT_REDIR_PROTOCOLS=> CURLPROTO_HTTPS,
    CURLOPT_CONNECTTIMEOUT => 10,
    CURLOPT_TIMEOUT        => 25,
    CURLOPT_SSL_VERIFYPEER => true,
    CURLOPT_SSL_VERIFYHOST => 2,
    CURLOPT_USERAGENT      => USER_AGENT,
    CURLOPT_HTTPHEADER     => ['Accept: text/calendar, text/plain, */*'],
    CURLOPT_WRITEFUNCTION  => function ($_ch, $chunk) use (&$body, &$bytes) {
        $len = strlen($chunk);
        $bytes += $len;
        if ($bytes > MAX_BYTES) return 0; // abort
        $body .= $chunk;
        return $len;
    },
]);
if (!$ok) {
    http_response_code(500);
    exit('cURL setup failed.');
}

curl_exec($ch);
$err  = curl_error($ch);
$code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
$ctype = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
curl_close($ch);

if ($err !== '' || $code < 200 || $code >= 400) {
    http_response_code($code >= 400 ? 502 : 500);
    exit('Upstream error.');
}

// On vérifie que le contenu ressemble bien à de l'iCalendar
if (strpos($body, 'BEGIN:VCALENDAR') === false) {
    http_response_code(502);
    exit('Upstream did not return iCalendar data.');
}

// --------- Réponse ---------
header('Content-Type: text/calendar; charset=utf-8');
header('Cache-Control: private, max-age=' . CACHE_TTL);
header('X-Cache: MISS');

// Écriture cache (best-effort)
@file_put_contents($cacheFile, $body, LOCK_EX);

echo $body;
