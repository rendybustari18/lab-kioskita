<?php
// KiosKita - Database Connection Helper
// Legacy Database Configuration

$dbHost = getenv('DB_HOST') ?: 'mysql';
$dbPort = getenv('DB_PORT') ?: '3306';
$dbName = getenv('DB_NAME') ?: 'kioskita_db';
$dbUser = getenv('DB_USER') ?: 'kioskita_user';
$dbPass = getenv('DB_PASS') ?: 'kioskita_pass';

try {
    $dsn = "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4";
    $pdo = new PDO($dsn, $dbUser, $dbPass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
} catch (PDOException $e) {
    // KK-16: pesan PDO memuat host, user, dan nama DB — hanya ke log server.
    error_log('[db] koneksi gagal: ' . $e->getMessage());
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode([
        'status' => 'error',
        'message' => 'Layanan sedang tidak tersedia'
    ]);
    exit;
}

