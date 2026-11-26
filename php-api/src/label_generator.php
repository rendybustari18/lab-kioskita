<?php
// KiosKita - Shipping Label Processing & Generator Utility
require_once __DIR__ . '/config/db.php';
require_once __DIR__ . '/helpers/response.php';
require_once __DIR__ . '/helpers/auth.php';

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id, X-User-Role, X-Tenant-Id');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// KK-15: identitas wajib ada & sah (fail closed).
$user = currentUser();

$jsonInput = readJsonBody();
$orderIdRaw = $jsonInput['order_id'] ?? $_GET['order_id'] ?? null;   // tanpa default "1"
$format = $jsonInput['format'] ?? $_GET['format'] ?? 'standard';
$courier = preg_replace('/\s+/u', ' ', trim((string) ($jsonInput['courier'] ?? $_GET['courier'] ?? 'JNE Reguler')));

if (!$orderIdRaw) {
    sendError('Parameter order_id wajib diisi', 400);
}
// KK-08: nilai bebas dari klien tidak pernah sampai ke mana pun tanpa allowlist.
if (!is_string($format) || !in_array($format, FORMAT_LABEL, true)) {
    sendError('Format label tidak dikenal. Pilihan: ' . implode(', ', FORMAT_LABEL), 400);
}
if (!kurirValid($courier)) {
    sendError('Nama kurir tidak valid', 400);
}

// Kepemilikan: label memuat nama & alamat pelanggan.
$milik = loadOrderForUser($pdo, $orderIdRaw, $user);

// Mengambil detail pesanan dan pengiriman
$stmt = $pdo->prepare("SELECT o.order_number, o.grand_total, u.name as customer_name, a.address_line, a.city, s.tracking_number
                       FROM orders o
                       JOIN users u ON o.customer_id = u.id
                       LEFT JOIN addresses a ON o.shipping_address_id = a.id
                       LEFT JOIN shipments s ON s.order_id = o.id
                       WHERE o.id = ?");
$stmt->execute([$milik['id']]);
$order = $stmt->fetch();

// KK-08: "engine CLI" lama hanya menjalankan `echo` untuk merangkai teks. Shell dihapus seluruhnya —
// teks yang sama dirangkai langsung di PHP, sehingga tidak ada lagi jalur menuju eksekusi perintah.
// (escapeshellarg() hanya menambal gejala; selama shell_exec ada, satu kelalaian = RCE.)
$rawOutput = "[LABEL PREVIEW] Order: {$order['order_number']} Kurir: {$courier} Format: {$format}";

sendJson([
    'success' => true,
    'order_id' => (int) $milik['id'],
    'order_number' => $order['order_number'],
    'tracking_number' => $order['tracking_number'] ?? 'BELUM_TERBIT',
    'courier' => $courier,
    'format' => $format,
    'preview' => $rawOutput,
    'customer' => $order['customer_name'],
    'destination' => ($order['address_line'] ?? '') . ', ' . ($order['city'] ?? '')
]);
