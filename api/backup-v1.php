<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');

const API_VERSION = 'backup-v1';
const CONTAINER_ID = 'tasviehyar-encrypted-backup-v1';
const MAX_BYTES = 33554432;
const MAX_RATE_ENTRIES = 256;
const RATE_WINDOW_SECONDS = 900;

function json_response(int $status, array $body): never {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, no-cache, must-revalidate');
    header('Pragma: no-cache');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $id): never { json_response($status, ['ok' => false, 'error' => $id]); }

function config_value(string $name): string {
    $value = getenv($name);
    if (!is_string($value) || $value === '') fail(500, 'server_misconfigured');
    return $value;
}

function private_root(): string {
    $root = config_value('TASVIEHYAR_BACKUP_PRIVATE_DIR');
    if (is_link($root)) fail(500, 'private_storage_unavailable');
    $doc = realpath($_SERVER['DOCUMENT_ROOT'] ?? '') ?: '';
    $rootReal = realpath($root);
    if ($rootReal === false || $rootReal === '' || ($doc !== '' && str_starts_with($rootReal . DIRECTORY_SEPARATOR, $doc . DIRECTORY_SEPARATOR))) fail(500, 'private_storage_unavailable');
    if (!is_dir($rootReal) || !is_writable($rootReal)) fail(500, 'private_storage_unavailable');
    return $rootReal;
}

function backup_quota_bytes(): int {
    $value = config_value('TASVIEHYAR_BACKUP_QUOTA_BYTES');
    if (!preg_match('/^[1-9][0-9]*$/', $value)) fail(500, 'server_misconfigured');
    $quota = filter_var($value, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1, 'max_range' => 4294967296]]);
    if ($quota === false) fail(500, 'server_misconfigured');
    return (int)$quota;
}

function password_hash_config(): string {
    $hash = config_value('TASVIEHYAR_PASSWORD_HASH');
    $info = password_get_info($hash);
    if (($info['algo'] ?? 0) === 0) fail(500, 'server_misconfigured');
    return $hash;
}

function read_request_body(int $maximumBytes): string {
    $stream = fopen('php://input', 'rb');
    if ($stream === false) fail(400, 'request_unreadable');
    $body = '';
    while (!feof($stream)) {
        $chunk = fread($stream, min(8192, $maximumBytes + 1 - strlen($body)));
        if ($chunk === false) fail(400, 'request_unreadable');
        $body .= $chunk;
        if (strlen($body) > $maximumBytes) fail(413, 'request_too_large');
        if ($chunk === '') break;
    }
    return $body;
}

function request_json(): array {
    $raw = read_request_body(1048576);
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) fail(400, 'malformed_json');
    return $decoded;
}

function same_origin_check(): void {
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin === '') return;
    $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
    $expected = $scheme . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    if (!hash_equals($expected, $origin)) fail(403, 'invalid_origin');
}

function require_https(): void {
    $https = $_SERVER['HTTPS'] ?? '';
    $host = strtolower((string)($_SERVER['HTTP_HOST'] ?? ''));
    $hostName = explode(':', $host, 2)[0];
    if ($https === 'off' || $https === '' ) {
        $isLocal = in_array($hostName, ['localhost', '127.0.0.1', '[::1]'], true);
        if (!$isLocal) fail(400, 'https_required');
    }
}

function start_session(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_name('tasviehyar_api');
        $hostName = explode(':', strtolower((string)($_SERVER['HTTP_HOST'] ?? '')), 2)[0];
        $localDev = getenv('TASVIEHYAR_DEV_INSECURE') === '1' && in_array($hostName, ['localhost', '127.0.0.1', '[::1]'], true);
        session_set_cookie_params(['secure' => !$localDev, 'httponly' => true, 'samesite' => 'Strict', 'path' => '/api/']);
        session_start();
    }
}

function csrf_token(): string {
    start_session();
    if (!isset($_SESSION['csrf']) || !is_string($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(32));
    return $_SESSION['csrf'];
}

function require_auth(bool $csrf = false): void {
    start_session();
    if (empty($_SESSION['authenticated'])) fail(401, 'unauthorized');
    if ($csrf) {
        same_origin_check();
        $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        if (!is_string($provided) || !hash_equals(csrf_token(), $provided)) fail(403, 'csrf_failed');
    }
}

function strict_b64url(mixed $value, int $minBytes = 1, ?int $exactBytes = null): bool {
    if (!is_string($value) || $value === '' || !preg_match('/^[A-Za-z0-9_-]+$/', $value)) return false;
    $decoded = base64_decode(strtr($value, '-_', '+/'), true);
    if ($decoded === false || rtrim(strtr(base64_encode($decoded), '+/', '-_'), '=') !== $value) return false;
    return strlen($decoded) >= $minBytes && ($exactBytes === null || strlen($decoded) === $exactBytes);
}

function validate_container(string $raw): array {
    if (strlen($raw) > MAX_BYTES) fail(413, 'backup_too_large');
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) fail(400, 'malformed_container');
    $required = ['containerIdentifier','containerVersion','algorithm','keyId','createdAt','innerBackupFormat','innerBackupFormatVersion','innerDatabaseSchemaVersion','payloadNonce','wrappedKeyNonce','wrappedDataEncryptionKey','ciphertext'];
    if (array_diff(array_keys($decoded), $required) || array_diff($required, array_keys($decoded))) fail(400, 'invalid_container_structure');
    if (!is_string($decoded['containerIdentifier']) || !is_int($decoded['containerVersion']) || !is_string($decoded['algorithm']) || !is_string($decoded['keyId']) || !is_string($decoded['createdAt']) || !is_string($decoded['innerBackupFormat']) || !is_int($decoded['innerBackupFormatVersion']) || !is_int($decoded['innerDatabaseSchemaVersion']) || !is_string($decoded['payloadNonce']) || !is_string($decoded['wrappedKeyNonce']) || !is_string($decoded['wrappedDataEncryptionKey']) || !is_string($decoded['ciphertext'])) fail(400, 'invalid_container_structure');
    if (!preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/', $decoded['createdAt'])) fail(400, 'invalid_container_timestamp');
    try { new DateTimeImmutable($decoded['createdAt']); } catch (Throwable) { fail(400, 'invalid_container_timestamp'); }
    if ($decoded['containerIdentifier'] !== CONTAINER_ID || $decoded['containerVersion'] !== 1 || $decoded['algorithm'] !== 'AES-256-GCM' || $decoded['innerBackupFormat'] !== 'tasviehyar' || $decoded['innerBackupFormatVersion'] !== 1 || $decoded['innerDatabaseSchemaVersion'] !== 3) fail(400, 'unsupported_container');
    if (!strict_b64url($decoded['keyId'], 16, 16) || !strict_b64url($decoded['payloadNonce'], 12, 12) || !strict_b64url($decoded['wrappedKeyNonce'], 12, 12) || !strict_b64url($decoded['wrappedDataEncryptionKey'], 48, 48) || !strict_b64url($decoded['ciphertext'], 16, null)) fail(400, 'invalid_container_encoding');
    return $decoded;
}

function object_path(string $root, string $id): string {
    if (!preg_match('/^[a-f0-9]{32}$/', $id)) fail(400, 'invalid_backup_id');
    $path = $root . DIRECTORY_SEPARATOR . $id . '.backup';
    if (is_link($path)) fail(400, 'invalid_backup_id');
    return $path;
}

function metadata_path(string $root, string $id): string { return object_path($root, $id) . '.meta.json'; }

function usage(string $root): int {
    $total = 0;
    foreach (glob($root . DIRECTORY_SEPARATOR . '*.backup') ?: [] as $file) if (!is_link($file) && is_file($file)) $total += (int) filesize($file);
    return $total;
}

function storage_lock(string $root, bool $exclusive, callable $operation): mixed {
    $handle = fopen($root . DIRECTORY_SEPARATOR . '.storage.lock', 'c+b');
    if ($handle === false || !flock($handle, $exclusive ? LOCK_EX : LOCK_SH)) fail(503, 'storage_unavailable');
    try { return $operation(); } finally { flock($handle, LOCK_UN); fclose($handle); }
}

function login_client_key(): string {
    $address = (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
    if ($address === '' || filter_var($address, FILTER_VALIDATE_IP) === false) $address = 'unknown';
    return hash('sha256', $address);
}

function enforce_login_rate_limit(string $root, string $clientKey): void {
    storage_lock($root, true, static function() use ($root, $clientKey): void {
        $path = $root . DIRECTORY_SEPARATOR . '.login-rate.json';
        $now = time(); $state = [];
        if (is_link($path)) fail(503, 'storage_unavailable');
        if (is_file($path)) {
            $decoded = json_decode((string)file_get_contents($path), true);
            if (!is_array($decoded)) fail(503, 'storage_unavailable');
            $state = $decoded;
        }
        foreach ($state as $key => $entry) {
            if (!is_string($key) || !is_array($entry) || !is_int($entry['count'] ?? null) || !is_int($entry['windowStart'] ?? null) || $entry['windowStart'] + RATE_WINDOW_SECONDS <= $now) unset($state[$key]);
        }
        if (count($state) > MAX_RATE_ENTRIES) { uasort($state, static fn(array $a, array $b): int => ($a['windowStart'] ?? 0) <=> ($b['windowStart'] ?? 0)); $state = array_slice($state, -MAX_RATE_ENTRIES, null, true); }
        $entry = $state[$clientKey] ?? ['count' => 0, 'windowStart' => $now];
        if ($entry['count'] >= 8 && $entry['windowStart'] + RATE_WINDOW_SECONDS > $now) fail(429, 'rate_limited');
        if ($entry['windowStart'] + RATE_WINDOW_SECONDS <= $now) $entry = ['count' => 0, 'windowStart' => $now];
        $entry['count']++;
        $state[$clientKey] = $entry;
        $temporary = $path . '.stage-' . bin2hex(random_bytes(8));
        $json = json_encode($state, JSON_UNESCAPED_SLASHES);
        if (!is_string($json) || file_put_contents($temporary, $json, LOCK_EX) !== strlen($json) || !rename($temporary, $path)) { @unlink($temporary); fail(503, 'storage_unavailable'); }
    });
}

function test_fault(string $name): bool {
    return getenv('TASVIEHYAR_TEST_FAULT') === $name;
}

final class StoragePublicationException extends RuntimeException {
    public function __construct(public readonly int $status, public readonly string $errorId) {
        parent::__construct($errorId, $status);
    }
}

function publish_stage(string $stage, string $destination, string $raw): void {
    if (test_fault('stage')) throw new StoragePublicationException(507, 'storage_failed');
    $handle = fopen($stage, 'wb');
    if ($handle === false) throw new StoragePublicationException(507, 'storage_failed');
    $offset = 0; $length = strlen($raw);
    while ($offset < $length) { $written = fwrite($handle, substr($raw, $offset, 8192)); if ($written === false || $written === 0) { fclose($handle); @unlink($stage); throw new StoragePublicationException(507, 'storage_failed'); } $offset += $written; }
    fflush($handle); fclose($handle);
    if (test_fault('rename') || !rename($stage, $destination)) { @unlink($stage); throw new StoragePublicationException(507, 'storage_failed'); }
}

function publish_metadata(string $destination, string $json): void {
    $temporary = $destination . '.stage-' . bin2hex(random_bytes(8));
    if (test_fault('metadata') || test_fault('metadata_write')) { @unlink($temporary); throw new StoragePublicationException(507, 'storage_failed'); }
    if (file_put_contents($temporary, $json, LOCK_EX) !== strlen($json) || test_fault('metadata_rename') || !rename($temporary, $destination)) { @unlink($temporary); throw new StoragePublicationException(507, 'storage_failed'); }
}

function publish_backup_transaction(string $root, string $raw, array $container, string $digest, string $operation): array {
    return storage_lock($root, true, function() use ($root, $raw, $digest, $container, $operation): array {
        $quota = backup_quota_bytes();
        if (usage($root) + strlen($raw) > $quota) fail(507, 'quota_exhausted');
        $id = bin2hex(random_bytes(16));
        $cipherPath = object_path($root, $id);
        $metaPath = metadata_path($root, $id);
        $stage = $root . DIRECTORY_SEPARATOR . '.stage-' . bin2hex(random_bytes(16));
        $cipherPublished = false;
        $metaPublished = false;
        try {
            if (file_exists($cipherPath) || is_link($cipherPath) || file_exists($metaPath) || is_link($metaPath)) throw new StoragePublicationException(507, 'storage_failed');
            publish_stage($stage, $cipherPath, $raw);
            $cipherPublished = true;
            $meta = ['id' => $id, 'receivedAt' => gmdate('c'), 'createdAt' => $container['createdAt'], 'keyId' => $container['keyId'], 'sizeBytes' => strlen($raw), 'sha256' => $digest, 'operationId' => substr($operation, 0, 128)];
            publish_metadata($metaPath, json_encode($meta, JSON_UNESCAPED_SLASHES));
            $metaPublished = true;
            return $meta;
        } catch (StoragePublicationException $error) {
            $cleanupOk = true;
            if ($metaPublished && (is_link($metaPath) || (is_file($metaPath) && !@unlink($metaPath)))) $cleanupOk = false;
            if ($cipherPublished && (is_link($cipherPath) || (is_file($cipherPath) && !@unlink($cipherPath)))) $cleanupOk = false;
            if (is_file($stage) && !@unlink($stage)) $cleanupOk = false;
            if (!$cleanupOk) throw new StoragePublicationException(507, 'storage_failed');
            throw $error;
        }
    });
}

if (PHP_SAPI === 'cli' && getenv('TASVIEHYAR_CLI_LIBRARY') === '1') return;

start_session();
require_https();
$action = $_GET['action'] ?? 'status';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($action === 'status' && $method === 'GET') json_response(200, ['ok' => true, 'apiVersion' => API_VERSION, 'serverTime' => gmdate('c')]);
if ($action === 'login' && $method === 'POST') {
    $body = request_json();
    $password = is_string($body['password'] ?? null) ? $body['password'] : '';
    $now = time();
    $root = private_root(); enforce_login_rate_limit($root, login_client_key());
    if (($now - (int)($_SESSION['login_window'] ?? 0)) > RATE_WINDOW_SECONDS) { $_SESSION['login_window'] = $now; $_SESSION['login_attempts'] = 0; }
    if ((int)($_SESSION['login_attempts'] ?? 0) >= 8) fail(429, 'rate_limited');
    $_SESSION['login_attempts'] = (int)($_SESSION['login_attempts'] ?? 0) + 1;
    if (!password_verify($password, password_hash_config())) fail(401, 'authentication_failed');
    session_regenerate_id(true); $_SESSION['authenticated'] = true; $_SESSION['csrf'] = bin2hex(random_bytes(32));
    json_response(200, ['ok' => true, 'csrfToken' => $_SESSION['csrf']]);
}
if ($action === 'csrf' && $method === 'GET') { require_auth(); json_response(200, ['ok' => true, 'csrfToken' => csrf_token()]); }
if ($action === 'logout' && $method === 'POST') { require_auth(true); $_SESSION = []; session_destroy(); json_response(200, ['ok' => true]); }

if ($action === 'list' && $method === 'GET') {
    require_auth(); $root = private_root(); $items = storage_lock($root, false, function() use ($root): array { $items = []; foreach (glob($root . DIRECTORY_SEPARATOR . '*.meta.json') ?: [] as $metaFile) { if (is_link($metaFile)) continue; $meta = json_decode((string)file_get_contents($metaFile), true); if (is_array($meta)) $items[] = $meta; } usort($items, fn(array $a, array $b): int => strcmp((string)($b['receivedAt'] ?? ''), (string)($a['receivedAt'] ?? ''))); return $items; });
    json_response(200, ['ok' => true, 'items' => $items]);
}
if ($action === 'usage' && $method === 'GET') { require_auth(); $root = private_root(); json_response(200, ['ok' => true, 'usedBytes' => usage($root), 'quotaBytes' => backup_quota_bytes()]); }
if ($action === 'upload' && $method === 'POST') {
    require_auth(true); $root = private_root(); $contentType = strtolower((string)($_SERVER['CONTENT_TYPE'] ?? '')); if ($contentType !== '' && !str_starts_with($contentType, 'application/json') && !str_starts_with($contentType, 'application/octet-stream')) fail(415, 'unsupported_content_type');
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0); if ($length > MAX_BYTES) fail(413, 'backup_too_large');
    $raw = read_request_body(MAX_BYTES);
    $container = validate_container($raw); $digest = hash('sha256', $raw); $operation = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
    try { $meta = publish_backup_transaction($root, $raw, $container, $digest, is_string($operation) ? $operation : ''); }
    catch (StoragePublicationException $error) { fail($error->status, $error->errorId); }
    json_response(201, ['ok' => true, 'item' => $meta]);
}
if ($action === 'download' && $method === 'GET') { require_auth(); $root = private_root(); $id = (string)($_GET['id'] ?? ''); storage_lock($root, false, function() use ($root, $id): void { $path = object_path($root, $id); $metaPath = metadata_path($root, $id); if (!is_file($path) || !is_file($metaPath)) fail(404, 'backup_not_found'); $meta = json_decode((string)file_get_contents($metaPath), true); if (!is_array($meta) || !is_string($meta['sha256'] ?? null) || !hash_equals($meta['sha256'], hash_file('sha256', $path))) fail(409, 'backup_corrupt'); header('Content-Type: application/octet-stream'); header('Content-Disposition: attachment; filename="' . $id . '.backup"'); header('Cache-Control: no-store'); header('X-Content-Type-Options: nosniff'); readfile($path); }); exit; }
if ($action === 'delete' && $method === 'POST') { require_auth(true); $root = private_root(); $id = (string)($_GET['id'] ?? ''); storage_lock($root, true, function() use ($root, $id): void { $path = object_path($root, $id); if (!is_file($path)) fail(404, 'backup_not_found'); if (!unlink($path) || (is_file(metadata_path($root, $id)) && !unlink(metadata_path($root, $id)))) fail(500, 'delete_failed'); }); json_response(200, ['ok' => true]); }
fail(404, 'unknown_action');
