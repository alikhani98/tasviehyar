<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
umask(077);
$parentPid = getmypid();
$cleaned = false;
$cleanupOk = false;
$children = [];
$childStates = [];
$childExitStatuses = [];
$reapOk = true;
$barrier = '';
$requested = '';

$fail = static function (string $message): never { throw new RuntimeException($message); };
$options = getopt('', ['path:']);
$requested = is_string($options['path'] ?? null) ? $options['path'] : '';
$base = '/home/jtphyqur/.private';
$baseReal = realpath($base);
if ($baseReal === false || $requested === '' || str_contains($requested, "\0")) $fail('An exact private qualification path is required');
$parent = realpath(dirname($requested));
$name = basename($requested);
if ($parent !== $baseReal || !preg_match('/^tasviehyar-qual-[a-z0-9-]{8,48}$/', $name) || file_exists($requested)) $fail('Qualification path must be a new direct child of the approved private base');
if (!mkdir($requested, 0700)) $fail('Could not create qualification directory');
$barrier = $requested . '/.barrier';
if (!mkdir($barrier, 0700)) $fail('Could not create barrier directory');
$manifest = $requested . '/.manifest.json';

$reap = static function (bool $requestShutdown) use (&$children, &$childStates, &$childExitStatuses, &$reapOk, $requested): bool {
    $deadline = microtime(true) + ($requestShutdown ? 3.0 : 20.0);
    if ($requestShutdown) @file_put_contents($requested . '/.shutdown', 'cooperative-shutdown', LOCK_EX);
    while ($childStates !== [] && microtime(true) < $deadline) {
        foreach (array_keys($childStates) as $pid) {
            $status = 0; $result = pcntl_waitpid((int)$pid, $status, WNOHANG);
            if ($result === (int)$pid) { $childExitStatuses[$pid] = $status; unset($childStates[$pid]); continue; }
            if ($result === -1) { $reapOk = false; return false; }
        }
        if ($childStates !== []) usleep(10000);
    }
    if ($childStates !== []) $reapOk = false;
    return $childStates === [] && $reapOk;
};
$cleanup = static function () use (&$cleaned, &$cleanupOk, &$childStates, &$reapOk, $reap, $parentPid, $requested, $barrier, $manifest): void {
    if ($cleaned || getmypid() !== $parentPid) return;
    $cleaned = true;
    if ($childStates !== [] && !$reap(true)) { fwrite(STDERR, "CLEANUP BLOCKED: child reaping incomplete\n"); return; }
    if (!$reapOk) { fwrite(STDERR, "CLEANUP BLOCKED: waitpid evidence incomplete\n"); return; }
    $ok = true;
    foreach (glob($barrier . '/*') ?: [] as $file) $ok = (!is_file($file) || @unlink($file)) && $ok;
    $ok = (!is_dir($barrier) || @rmdir($barrier)) && $ok;
    foreach (glob($requested . '/.stage-*') ?: [] as $file) $ok = (!is_file($file) || @unlink($file)) && $ok;
    foreach (glob($requested . '/*.backup') ?: [] as $file) $ok = (!is_file($file) && !is_link($file) || @unlink($file)) && $ok;
    foreach (glob($requested . '/*.meta.json') ?: [] as $file) $ok = (!is_file($file) && !is_link($file) || @unlink($file)) && $ok;
    foreach (glob($requested . '/*.meta.json.stage-*') ?: [] as $file) $ok = (!is_file($file) && !is_link($file) || @unlink($file)) && $ok;
    foreach (glob($requested . '/*.corrupt') ?: [] as $file) $ok = (!is_file($file) && !is_link($file) || @unlink($file)) && $ok;
    $ok = (!is_file($requested . '/.shutdown') || @unlink($requested . '/.shutdown')) && $ok;
    $ok = (!is_file($requested . '/.storage.lock') || @unlink($requested . '/.storage.lock')) && $ok;
    $ok = (!is_file($manifest) || @unlink($manifest)) && $ok;
    $remaining = array_diff(scandir($requested) ?: [], ['.', '..']);
    $ok = $remaining === [] && $ok;
    $ok = @rmdir($requested) && $ok;
    $cleanupOk = $ok;
    if (!$ok) fwrite(STDERR, "CLEANUP FAILED: residual test files remain\n");
};
register_shutdown_function(static function () use ($cleanup, $parentPid): void { if (getmypid() === $parentPid) $cleanup(); });

if (function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    $handler = static function (int $signal) use ($parentPid, $reap): void { if (getmypid() !== $parentPid) exit(128 + $signal); $reap(true); throw new RuntimeException('Interrupted by signal ' . $signal); };
    pcntl_signal(SIGTERM, $handler); pcntl_signal(SIGINT, $handler); pcntl_signal(SIGALRM, $handler);
}

putenv('TASVIEHYAR_CLI_LIBRARY=1');
putenv('TASVIEHYAR_BACKUP_PRIVATE_DIR=' . $requested);
putenv('TASVIEHYAR_BACKUP_QUOTA_BYTES=65536');
$api = realpath(__DIR__ . '/../../api/backup-v1.php');
if ($api === false) $fail('API file not found');
require $api;

$b64 = static fn(int $bytes): string => rtrim(strtr(base64_encode(str_repeat('A', $bytes)), '+/', '-_'), '=');
$raw = json_encode(['containerIdentifier' => CONTAINER_ID, 'containerVersion' => 1, 'algorithm' => 'AES-256-GCM', 'keyId' => $b64(16), 'createdAt' => gmdate('c'), 'innerBackupFormat' => 'tasviehyar', 'innerBackupFormatVersion' => 1, 'innerDatabaseSchemaVersion' => 3, 'payloadNonce' => $b64(12), 'wrappedKeyNonce' => $b64(12), 'wrappedDataEncryptionKey' => $b64(48), 'ciphertext' => $b64(1024)], JSON_UNESCAPED_SLASHES);
$quota = strlen($raw);
file_put_contents($manifest, json_encode(['path' => $requested, 'workers' => 2, 'maxBytes' => 65536, 'parentPid' => $parentPid], JSON_UNESCAPED_SLASHES));

for ($worker = 1; $worker <= 2; $worker++) {
    $pid = pcntl_fork();
    if ($pid === -1) $fail('pcntl_fork failed');
    if ($pid === 0) {
        $outcome = ['worker' => $worker, 'pid' => getmypid(), 'status' => 'unknown', 'preLockAt' => null, 'lockAcquiredAt' => null, 'lockReleasedAt' => null, 'waitSeconds' => null, 'objectId' => null, 'error' => null];
        try {
            if (is_file($requested . '/.shutdown')) throw new RuntimeException('cooperative_shutdown');
            file_put_contents($barrier . '/ready-' . $worker, json_encode(['pid' => getmypid(), 'at' => microtime(true)]));
            $deadline = microtime(true) + 10;
            while (!file_exists($barrier . '/go')) { if (is_file($requested . '/.shutdown')) throw new RuntimeException('cooperative_shutdown'); if (microtime(true) > $deadline) throw new RuntimeException('barrier_timeout'); usleep(1000); }
            if ($worker === 2) { while (!file_exists($barrier . '/worker2-go')) { if (is_file($requested . '/.shutdown')) throw new RuntimeException('cooperative_shutdown'); if (microtime(true) > $deadline) throw new RuntimeException('worker2_permission_timeout'); usleep(1000); } }
            $outcome['preLockAt'] = microtime(true);
            if ($worker === 2) file_put_contents($barrier . '/worker2-attempt', json_encode(['pid' => getmypid(), 'at' => $outcome['preLockAt']]));
            $meta = storage_lock($requested, true, static function () use ($requested, $raw, $worker, $quota, $barrier, &$outcome): array {
                $outcome['lockAcquiredAt'] = microtime(true);
                $outcome['waitSeconds'] = $outcome['lockAcquiredAt'] - $outcome['preLockAt'];
                if ($worker === 1) file_put_contents($barrier . '/worker1-held', json_encode(['pid' => getmypid(), 'at' => $outcome['lockAcquiredAt']]));
                if ($worker === 1) { $holdDeadline = microtime(true) + 10; while (!file_exists($barrier . '/worker2-attempt')) { if (is_file($requested . '/.shutdown')) throw new RuntimeException('cooperative_shutdown'); if (microtime(true) > $holdDeadline) throw new RuntimeException('worker2_attempt_timeout'); usleep(1000); } usleep(250000); }
                if (usage($requested) + strlen($raw) > $quota) { $outcome['status'] = 'quota_rejected'; return []; }
                $id = str_repeat((string)$worker, 32); $stage = $requested . '/.stage-' . $worker;
                publish_stage($stage, object_path($requested, $id), $raw);
                $meta = ['id' => $id, 'receivedAt' => gmdate('c'), 'createdAt' => gmdate('c'), 'keyId' => str_repeat('A', 22), 'sizeBytes' => strlen($raw), 'sha256' => hash('sha256', $raw), 'operationId' => 'cli-' . $worker];
                publish_metadata(metadata_path($requested, $id), json_encode($meta, JSON_UNESCAPED_SLASHES));
                $outcome['status'] = 'success'; $outcome['objectId'] = $id; return $meta;
            });
            $outcome['lockReleasedAt'] = microtime(true);
        } catch (Throwable $e) { $outcome['status'] = 'exception'; $outcome['error'] = $e->getMessage(); $outcome['lockReleasedAt'] = microtime(true); }
        file_put_contents($barrier . '/result-' . $worker . '.json', json_encode($outcome, JSON_UNESCAPED_SLASHES));
        exit($outcome['status'] === 'success' || $outcome['status'] === 'quota_rejected' ? 0 : 1);
    }
    $children[$worker] = $pid;
    $childStates[$pid] = 'alive';
}
$deadline = microtime(true) + 10;
while (!is_file($barrier . '/ready-1') || !is_file($barrier . '/ready-2')) { if (microtime(true) > $deadline) $fail('worker_barrier_timeout'); usleep(1000); }
file_put_contents($barrier . '/go', json_encode(['parentPid' => $parentPid, 'releasedAt' => microtime(true)]));
 $eventDeadline = microtime(true) + 10;
 while (!is_file($barrier . '/worker1-held')) { if (microtime(true) > $eventDeadline) $fail('worker1_lock_event_timeout'); usleep(1000); }
 file_put_contents($barrier . '/worker2-go', json_encode(['parentPid' => $parentPid, 'releasedAt' => microtime(true)]));
 while (!is_file($barrier . '/worker2-attempt')) { if (microtime(true) > $eventDeadline) $fail('worker2_attempt_event_timeout'); usleep(1000); }
if (!$reap(false)) $fail('worker_reaping_failed');
$exitCodes = [];
foreach ($children as $worker => $pid) { $exitCodes[$worker] = $childExitStatuses[$pid] ?? null; if (!is_int($exitCodes[$worker]) || !pcntl_wifexited($exitCodes[$worker]) || pcntl_wexitstatus($exitCodes[$worker]) !== 0) $fail('worker_exit_code_failed'); }

$outcomes = [];
for ($worker = 1; $worker <= 2; $worker++) { $file = $barrier . '/result-' . $worker . '.json'; if (!is_file($file)) $fail('missing_worker_result'); $decoded = json_decode((string)file_get_contents($file), true); if (!is_array($decoded) || !isset($decoded['status'], $decoded['preLockAt'], $decoded['lockAcquiredAt'], $decoded['lockReleasedAt'], $decoded['waitSeconds'], $decoded['pid'])) $fail('ambiguous_worker_result'); $outcomes[] = $decoded; }
$successes = array_values(array_filter($outcomes, static fn(array $outcome): bool => $outcome['status'] === 'success'));
$quotas = array_values(array_filter($outcomes, static fn(array $outcome): bool => $outcome['status'] === 'quota_rejected'));
if (count($successes) !== 1 || count($quotas) !== 1) $fail('concurrency_assertion_failed');
$waited = array_values(array_filter($outcomes, static fn(array $outcome): bool => is_numeric($outcome['waitSeconds'] ?? null) && (float)$outcome['waitSeconds'] > 0.05));
if (count($waited) !== 1) $fail('contention_not_proven');
$heldEvent = json_decode((string)file_get_contents($barrier . '/worker1-held'), true);
$attemptEvent = json_decode((string)file_get_contents($barrier . '/worker2-attempt'), true);
if (!is_array($heldEvent) || !is_array($attemptEvent) || !is_numeric($heldEvent['at'] ?? null) || !is_numeric($attemptEvent['at'] ?? null) || (float)$heldEvent['at'] > (float)$attemptEvent['at']) $fail('contention_event_order_failed');
$winner = $successes[0]; $id = (string)$winner['objectId']; $cipher = object_path($requested, $id); $metaPath = metadata_path($requested, $id); $meta = json_decode((string)file_get_contents($metaPath), true); if (!is_array($meta) || $meta['sizeBytes'] !== filesize($cipher) || !hash_equals((string)$meta['sha256'], hash_file('sha256', $cipher))) $fail('published_object_integrity_failed');
$corrupt = $metaPath . '.corrupt'; rename($metaPath, $corrupt); file_put_contents($metaPath, '{broken'); $listed = storage_lock($requested, false, static function () use ($requested): array { $items = []; foreach (glob($requested . '/*.meta.json') ?: [] as $file) { $decoded = json_decode((string)file_get_contents($file), true); if (is_array($decoded)) $items[] = $decoded; } return $items; }); if ($listed !== []) $fail('corrupt_metadata_listed'); @unlink($metaPath); rename($corrupt, $metaPath);
$cleanup();
if (!$cleanupOk) exit(1);
echo json_encode(['status' => 'PASS', 'outcomes' => $outcomes, 'exitCodes' => array_map(static fn(int $status): int => pcntl_wexitstatus($status), $exitCodes), 'winner' => $id, 'integrity' => true, 'contention' => true, 'cleanup' => 'verified', 'httpContract' => 'not-tested'], JSON_UNESCAPED_SLASHES) . "\n";
