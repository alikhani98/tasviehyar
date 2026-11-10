<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
umask(077);

$parentPid = getmypid();
$fail = static function (string $message): never { throw new RuntimeException($message); };
$api = realpath(__DIR__ . '/../../api/backup-v1.php');
if ($api === false) $fail('API file not found');
$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tasviehyar-security-' . bin2hex(random_bytes(8));
if (!mkdir($root, 0700)) $fail('Could not create disposable storage');
$children = [];
$resultFiles = [];
$cleaned = false;
$cleanup = static function () use (&$cleaned, $parentPid, $root, &$children): void {
    if ($cleaned || getmypid() !== $parentPid) return;
    $cleaned = true;
    if ($children !== []) @file_put_contents($root . DIRECTORY_SEPARATOR . '.shutdown', 'cooperative-shutdown', LOCK_EX);
    $deadline = microtime(true) + 2.0;
    while ($children !== [] && microtime(true) < $deadline) {
        foreach (array_keys($children) as $pid) { $status = 0; $result = pcntl_waitpid((int)$pid, $status, WNOHANG); if ($result === (int)$pid) unset($children[$pid]); elseif ($result === -1) return; }
        if ($children !== []) usleep(10000);
    }
    if ($children !== []) return;
    foreach (@scandir($root) ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $root . DIRECTORY_SEPARATOR . $entry;
        if (is_link($path) || is_file($path)) @unlink($path);
    }
    if (is_dir($root)) @rmdir($root);
};
register_shutdown_function(static function () use ($cleanup, $parentPid): void { if (getmypid() === $parentPid) $cleanup(); });

putenv('TASVIEHYAR_CLI_LIBRARY=1');
putenv('TASVIEHYAR_BACKUP_PRIVATE_DIR=' . $root);
putenv('TASVIEHYAR_BACKUP_QUOTA_BYTES=65536');
require $api;

$spawn = static function (string $mode, int $index) use (&$children, &$resultFiles, $root, $fail): int {
    $result = $root . DIRECTORY_SEPARATOR . '.security-result-' . $mode . '-' . $index . '.json';
    $pid = pcntl_fork();
    if ($pid === -1) $fail('pcntl_fork failed');
    if ($pid === 0) {
        $written = false;
        ob_start();
        register_shutdown_function(static function () use (&$written, $result, $mode, $index): void {
            if ($written) return;
            $output = ob_get_contents();
            @ob_end_clean();
            @file_put_contents($result, json_encode(['mode' => $mode, 'index' => $index, 'output' => $output], JSON_UNESCAPED_SLASHES), LOCK_EX);
        });
        try {
            if (is_file($root . DIRECTORY_SEPARATOR . '.shutdown')) exit(2);
            if ($mode === 'invalid-container') {
                $invalid = ['containerIdentifier' => CONTAINER_ID, 'containerVersion' => 1, 'algorithm' => 'AES-256-GCM', 'keyId' => str_repeat('A', 22), 'createdAt' => gmdate('c'), 'innerBackupFormat' => 'tasviehyar', 'innerBackupFormatVersion' => 1, 'innerDatabaseSchemaVersion' => 3, 'payloadNonce' => [], 'wrappedKeyNonce' => str_repeat('A', 16), 'wrappedDataEncryptionKey' => str_repeat('A', 64), 'ciphertext' => str_repeat('A', 22)];
                validate_container(json_encode($invalid, JSON_UNESCAPED_SLASHES));
            } elseif ($mode === 'invalid-quota') {
                putenv('TASVIEHYAR_BACKUP_QUOTA_BYTES=not-a-number');
                backup_quota_bytes();
            } elseif ($mode === 'auth') {
                $_SERVER['REMOTE_ADDR'] = '198.51.100.7';
                enforce_login_rate_limit($root, login_client_key());
                echo 'OK';
            } else {
                throw new RuntimeException('unknown child mode');
            }
            $output = ob_get_contents();
            ob_end_clean();
            $written = true;
            file_put_contents($result, json_encode(['mode' => $mode, 'index' => $index, 'output' => $output], JSON_UNESCAPED_SLASHES), LOCK_EX);
            exit(0);
        } catch (Throwable $error) {
            $output = ob_get_contents();
            ob_end_clean();
            $written = true;
            file_put_contents($result, json_encode(['mode' => $mode, 'index' => $index, 'exception' => $error->getMessage(), 'output' => $output], JSON_UNESCAPED_SLASHES), LOCK_EX);
            exit(1);
        }
    }
    $children[$pid] = 'alive';
    $resultFiles[$pid] = $result;
    return $pid;
};

$spawn('invalid-container', 1);
$spawn('invalid-quota', 1);
for ($index = 0; $index < 10; $index++) $spawn('auth', $index);

$deadline = microtime(true) + 15.0;
$statuses = [];
while ($children !== [] && microtime(true) < $deadline) {
    foreach (array_keys($children) as $pid) {
        $status = 0;
        $result = pcntl_waitpid((int)$pid, $status, WNOHANG);
        if ($result === (int)$pid) { $statuses[$pid] = $status; unset($children[$pid]); }
        elseif ($result === -1) $fail('waitpid failed');
    }
    if ($children !== []) usleep(10000);
}
if ($children !== []) {
    file_put_contents($root . DIRECTORY_SEPARATOR . '.shutdown', 'cooperative-shutdown', LOCK_EX);
    $killDeadline = microtime(true) + 2.0;
    while ($children !== [] && microtime(true) < $killDeadline) {
        foreach (array_keys($children) as $pid) { $status = 0; $result = pcntl_waitpid((int)$pid, $status, WNOHANG); if ($result === (int)$pid) { $statuses[$pid] = $status; unset($children[$pid]); } elseif ($result === -1) $fail('waitpid failed during termination'); }
        if ($children !== []) usleep(10000);
    }
}
if ($children !== []) $fail('child reaping timeout; cooperative shutdown could not prove termination');

$invalidContainer = null; $invalidQuota = null; $accepted = 0; $limited = 0;
foreach ($resultFiles as $pid => $file) {
    if (!is_file($file)) $fail('missing child result');
    $decoded = json_decode((string)file_get_contents($file), true);
    $status = $statuses[$pid] ?? null;
    if (!is_array($decoded) || !is_int($status) || !pcntl_wifexited($status) || pcntl_wexitstatus($status) !== 0) $fail('child failed or crashed');
    $output = json_decode((string)($decoded['output'] ?? ''), true);
    if ($decoded['mode'] === 'invalid-container' && is_array($output) && ($output['error'] ?? null) === 'invalid_container_structure') $invalidContainer = true;
    elseif ($decoded['mode'] === 'invalid-quota' && is_array($output) && ($output['error'] ?? null) === 'server_misconfigured') $invalidQuota = true;
    elseif ($decoded['mode'] === 'auth' && $decoded['output'] === 'OK') $accepted++;
    elseif ($decoded['mode'] === 'auth' && is_array($output) && ($output['error'] ?? null) === 'rate_limited') $limited++;
    else $fail('unexpected child result');
}
if ($invalidContainer !== true || $invalidQuota !== true || $accepted !== 8 || $limited !== 2) $fail('security regression assertion failed');
$state = json_decode((string)file_get_contents($root . DIRECTORY_SEPARATOR . '.login-rate.json'), true);
if (!is_array($state) || count($state) !== 1 || (int)array_values($state)[0]['count'] !== 8) $fail('rate state was not bounded or atomic');
$cleanup();
if (is_dir($root)) $fail('cleanup failed');
echo json_encode(['status' => 'PASS', 'wrongTypeContainer' => true, 'invalidQuota' => true, 'concurrentAttempts' => 10, 'accepted' => 8, 'rateLimited' => 2, 'cleanup' => 'verified'], JSON_UNESCAPED_SLASHES) . "\n";
