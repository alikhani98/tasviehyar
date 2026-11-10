<?php
declare(strict_types=1);

ini_set('display_errors', '0');
putenv('TASVIEHYAR_CLI_LIBRARY=1');
$api = realpath(__DIR__ . '/../../api/backup-v1.php');
if ($api === false) throw new RuntimeException('API file not found');
require $api;
if (!defined('API_VERSION') || API_VERSION !== 'backup-v1' || !function_exists('storage_lock')) throw new RuntimeException('CLI library symbols missing');
echo "PASS cli-library-require-returned\n";
