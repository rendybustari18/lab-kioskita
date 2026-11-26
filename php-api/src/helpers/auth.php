<?php
// KiosKita - Identitas & otorisasi untuk layanan legacy (KK-15)
//
// Layanan ini hanya dicapai lewat gerbang Bun, yang memverifikasi JWT lalu mengisi
// X-User-Id / X-User-Role / X-Tenant-Id. Prinsipnya FAIL CLOSED:
//   header hilang atau tidak sah  -> 401
//   (dulu: peran dianggap "customer" dan penulis catatan dianggap admin #1)
//
// Satu tempat untuk aturan kepemilikan pesanan, supaya orders.php, shipments.php,
// dan label_generator.php tidak masing-masing menulis versinya sendiri.

require_once __DIR__ . '/response.php';

const PERAN_SAH  = ['admin', 'manager', 'staff', 'customer'];
const PERAN_STAF = ['admin', 'manager', 'staff'];

// Allowlist bersama shipments.php & label_generator.php (nilai yang memang dipakai seed & UI).
const FORMAT_LABEL = ['standard', 'thermal_100x150', 'pdf'];

/** Nama kurir: huruf, angka, spasi, dan . & - / ( ) — cukup untuk "J&T Express", tanpa metakarakter shell. */
function kurirValid(string $courier): bool
{
    return $courier !== '' && mb_strlen($courier) <= 100 && preg_match('/^[\p{L}\p{N} .&\-\/()]+$/u', $courier) === 1;
}

/** Identitas pemanggil dari gerbang. Tidak pernah dari query/body. */
function currentUser(): array
{
    $opsi   = ['options' => ['min_range' => 1]];
    $id     = filter_var($_SERVER['HTTP_X_USER_ID'] ?? null, FILTER_VALIDATE_INT, $opsi);
    $tenant = filter_var($_SERVER['HTTP_X_TENANT_ID'] ?? null, FILTER_VALIDATE_INT, $opsi);
    $role   = $_SERVER['HTTP_X_USER_ROLE'] ?? '';

    if ($id === false || $tenant === false || !in_array($role, PERAN_SAH, true)) {
        sendError('Akses ditolak: sesi tidak valid', 401);
    }
    return ['id' => $id, 'role' => $role, 'tenant_id' => $tenant];
}

function isStaf(array $user): bool
{
    return in_array($user['role'], PERAN_STAF, true);
}

function requireRole(array $user, array $roles): void
{
    if (!in_array($user['role'], $roles, true)) {
        sendError('Akses ditolak: peran Anda tidak diizinkan untuk aksi ini', 403);
    }
}

/**
 * Aturan kepemilikan pesanan:
 *   admin           -> semua pesanan
 *   manager / staff -> pesanan tenant-nya
 *   customer        -> pesanannya sendiri
 */
function canAccessOrder(array $order, array $user): bool
{
    switch ($user['role']) {
        case 'admin':
            return true;
        case 'manager':
        case 'staff':
            return (int) $order['tenant_id'] === $user['tenant_id'];
        case 'customer':
            return (int) $order['customer_id'] === $user['id'];
    }
    return false;
}

/**
 * Ambil pesanan HANYA bila pemanggil berhak. Pesanan orang lain dijawab sama persis
 * dengan pesanan yang tidak ada (404), agar keberadaan ID tidak terkonfirmasi.
 * $forUpdate = true dipakai di dalam transaksi (cegah dua pembatalan bersamaan).
 */
function loadOrderForUser(PDO $pdo, $orderId, array $user, bool $forUpdate = false): array
{
    $id = filter_var($orderId, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
    if ($id === false) {
        sendError('Pesanan tidak ditemukan', 404);
    }

    $sql  = 'SELECT id, order_number, tenant_id, customer_id, status FROM orders WHERE id = ?';
    $stmt = $pdo->prepare($forUpdate ? $sql . ' FOR UPDATE' : $sql);
    $stmt->execute([$id]);
    $order = $stmt->fetch();

    if (!$order || !canAccessOrder($order, $user)) {
        sendError('Pesanan tidak ditemukan', 404);
    }
    return $order;
}

/** Body JSON; kompatibel dengan form-encoded seperti perilaku lama (?: $_POST). */
function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === '' || $raw === false) {
        return $_POST ?: [];
    }
    $data = json_decode($raw, true);
    if (is_array($data)) {
        return $data;
    }
    if (!empty($_POST)) {
        return $_POST;
    }
    sendError('Format permintaan tidak valid', 400);
}
