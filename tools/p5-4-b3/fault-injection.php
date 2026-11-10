<?php
declare(strict_types=1);

ini_set('display_errors', '0');
ini_set('log_errors', '1');
umask(077);

$fail = static function (string $message): never { throw new RuntimeException($message); };
$api = realpath(__DIR__ . '/../../api/backup-v1.php');
if ($api === false) $fail('API file not found');
$root = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'tasviehyar-fault-' . bin2hex(random_bytes(8));
if (!mkdir($root, 0700)) $fail('Could not create disposable storage');
$clean = static function () use ($root): void {
    $ok = true;
    $entries = @scandir($root);
    if ($entries === false) $ok = false;
    foreach ($entries ?: [] as $entry) {
        if ($entry === '.' || $entry === '..') continue;
        $path = $root . DIRECTORY_SEPARATOR . $entry;
        if (is_link($path) || is_file($path)) { if (!@unlink($path)) $ok = false; }
        else $ok = false;
    }
    if ($ok && is_dir($root) && !@rmdir($root)) $ok = false;
    if (!$ok && is_dir($root)) throw new RuntimeException('cleanup failed');
};
register_shutdown_function(static function () use ($clean): void { $clean(); });

putenv('TASVIEHYAR_CLI_LIBRARY=1');
putenv('TASVIEHYAR_BACKUP_PRIVATE_DIR=' . $root);
putenv('TASVIEHYAR_BACKUP_QUOTA_BYTES=65536');
require $api;

$raw = json_encode(['synthetic' => true, 'containerIdentifier' => CONTAINER_ID, 'containerVersion' => 1, 'algorithm' => 'AES-256-GCM', 'payload' => str_repeat('A', 1024)], JSON_UNESCAPED_SLASHES);
$container = ['createdAt' => gmdate('c'), 'keyId' => str_repeat('A', 22)];
$digest = hash('sha256', $raw);
$faults = ['stage', 'rename', 'metadata_write', 'metadata_rename'];
$results = [];

$baseline = publish_backup_transaction($root, $raw, $container, $digest, 'baseline');
$baselinePath = object_path($root, $baseline['id']);
$baselineMetaPath = metadata_path($root, $baseline['id']);
$baselineHash = hash_file('sha256', $baselinePath);
$baselineMetaHash = hash_file('sha256', $baselineMetaPath);
$baselineUsage = usage($root);
$snapshot = static function () use ($root): array {
    $entries = @scandir($root);
    if ($entries === false) throw new RuntimeException('storage listing failed');
    return array_values(array_diff($entries, ['.', '..']));
};
$expectedFiles = $snapshot();
$expectedBackups = array_values(array_filter($expectedFiles, static fn(string $file): bool => str_ends_with($file, '.backup')));
$expectedMetadata = array_values(array_filter($expectedFiles, static fn(string $file): bool => str_ends_with($file, '.backup.meta.json')));
$assertBaseline = static function (string $fault, array $expectedFiles, array $expectedBackups, array $expectedMetadata) use ($snapshot, $root, $baselinePath, $baselineMetaPath, $baselineHash, $baselineMetaHash, $baselineUsage, $fail): void {
    $actualFiles = $snapshot();
    sort($actualFiles); $files = $expectedFiles; sort($files);
    if ($actualFiles !== $files) $fail($fault . ': exact disposable file set changed');
    $actualBackups = array_values(array_filter($actualFiles, static fn(string $file): bool => str_ends_with($file, '.backup')));
    $backups = $expectedBackups; sort($actualBackups); sort($backups);
    if ($actualBackups !== $backups) $fail($fault . ': backup file set changed');
    $actualMetadata = array_values(array_filter($actualFiles, static fn(string $file): bool => str_ends_with($file, '.backup.meta.json')));
    $metadata = $expectedMetadata; sort($actualMetadata); sort($metadata);
    if ($actualMetadata !== $metadata) $fail($fault . ': metadata file set changed');
    if (usage($root) !== $baselineUsage || !is_file($baselinePath) || hash_file('sha256', $baselinePath) !== $baselineHash || !is_file($baselineMetaPath) || hash_file('sha256', $baselineMetaPath) !== $baselineMetaHash) $fail($fault . ': baseline object changed');
};

foreach ($faults as $fault) {
    $assertBaseline($fault . ':before', $expectedFiles, $expectedBackups, $expectedMetadata);
    putenv('TASVIEHYAR_TEST_FAULT=' . $fault);
    $caught = null;
    try { publish_backup_transaction($root, $raw, $container, $digest, 'fault-' . $fault); } catch (StoragePublicationException $error) { $caught = $error; }
    putenv('TASVIEHYAR_TEST_FAULT=');
    if (!$caught || $caught->status !== 507 || $caught->errorId !== 'storage_failed') $fail($fault . ': wrong failure response');
    $assertBaseline($fault . ':after', $expectedFiles, $expectedBackups, $expectedMetadata);
    storage_lock($root, true, static fn(): bool => true);
    $valid = publish_backup_transaction($root, $raw, $container, $digest, 'after-' . $fault);
    $validPath = object_path($root, $valid['id']);
    $validMetaPath = metadata_path($root, $valid['id']);
    if (!is_file($validPath) || !is_file($validMetaPath) || hash_file('sha256', $validPath) !== $valid['sha256']) $fail($fault . ': subsequent valid publication failed');
    if (is_link($validPath) || is_link($validMetaPath) || !@unlink($validPath) || !@unlink($validMetaPath)) $fail($fault . ': valid test object cleanup failed');
    $assertBaseline($fault . ':post-success', $expectedFiles, $expectedBackups, $expectedMetadata);
    $results[$fault] = ['status' => 'verified', 'httpStatus' => 507, 'error' => 'storage_failed'];
}

if (is_link($baselinePath) || is_link($baselineMetaPath) || !@unlink($baselinePath) || !@unlink($baselineMetaPath)) $fail('baseline cleanup failed');
$clean();
if (is_dir($root)) $fail('cleanup failed');
echo json_encode(['status' => 'PASS', 'cases' => $results, 'cleanup' => 'verified'], JSON_UNESCAPED_SLASHES) . "\n";
