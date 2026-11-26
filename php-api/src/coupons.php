<?php
// KiosKita - Coupon & Promotion Service
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

$action = $_GET['action'] ?? 'verify';
// KK-15: identitas wajib ada & sah (fail closed).
$user = currentUser();

switch ($action) {
    case 'verify':
    case 'apply':
        handleProcessCoupon($pdo, $user);
        break;

    case 'list':
        handleListCoupons($pdo, $user);
        break;

    default:
        sendError('Aksi kupon tidak valid', 404);
}

// KK-12: verifikasi memeriksa riwayat pemakaian (coupon_usages vs max_uses_per_user).
// Catatan: endpoint ini hanya PRATINJAU di keranjang. Penegakan final — termasuk minimum
// pembelian atas subtotal hitungan server dan pencatatan pemakaian — ada di checkout (bun-api).
function handleProcessCoupon($pdo, array $user) {
    $input = readJsonBody();
    $code = strtoupper(trim((string) ($input['code'] ?? '')));
    $subtotal = floatval($input['subtotal'] ?? 0);

    if (empty($code)) {
        sendError('Kode kupon wajib diisi', 400);
    }

    $stmt = $pdo->prepare("SELECT * FROM coupons WHERE code = ? AND is_active = 1");
    $stmt->execute([$code]);
    $coupon = $stmt->fetch();

    if (!$coupon) {
        sendError('Kupon tidak valid atau sudah kedaluwarsa', 404);
    }

    $pakai = $pdo->prepare("SELECT COUNT(*) FROM coupon_usages WHERE coupon_id = ? AND user_id = ?");
    $pakai->execute([$coupon['id'], $user['id']]);
    if ((int) $pakai->fetchColumn() >= (int) $coupon['max_uses_per_user']) {
        sendError('Kupon sudah mencapai batas pemakaian untuk akun Anda', 409);
    }

    if ($subtotal < floatval($coupon['min_purchase'])) {
        $minFormatted = number_format($coupon['min_purchase'], 0, ',', '.');
        sendError("Minimum pembelian untuk kupon ini adalah Rp {$minFormatted}", 400);
    }

    // Perhitungan diskon
    $discount = 0;
    if ($coupon['discount_type'] === 'percentage') {
        $discount = ($subtotal * floatval($coupon['discount_value'])) / 100;
    } else {
        $discount = floatval($coupon['discount_value']);
    }

    if ($discount > $subtotal) {
        $discount = $subtotal;
    }

    sendJson([
        'success' => true,
        'message' => "Kupon {$code} berhasil diterapkan!",
        'coupon' => [
            'id' => $coupon['id'],
            'code' => $coupon['code'],
            'type' => $coupon['discount_type'],
            'value' => floatval($coupon['discount_value']),
            'discount_amount' => $discount,
            'final_subtotal' => max(0, $subtotal - $discount)
        ]
    ]);
}

// KK-15: daftar seluruh kupon (termasuk nonaktif) tidak dipakai UI — hanya untuk pengelola.
function handleListCoupons($pdo, array $user) {
    requireRole($user, ['admin', 'manager']);

    $stmt = $pdo->query("SELECT id, code, discount_type, discount_value, min_purchase, is_active FROM coupons");
    $coupons = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $coupons
    ]);
}
