<?php
// KiosKita - Legacy Shipping & Invoice Document Handler
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

$action = $_GET['action'] ?? 'list';
// KK-15: identitas wajib ada & sah (fail closed).
$user = currentUser();

switch ($action) {
    case 'list':
        handleListShipments($pdo, $user);
        break;

    case 'invoice':
        handleGetInvoice($pdo, $user);
        break;

    case 'create':
        handleCreateShipment($pdo, $user);
        break;

    default:
        sendError('Aksi shipment tidak valid', 404);
}

// 1. Daftar resi dan dokumen pengiriman
function handleListShipments($pdo, array $user) {
    $query = "SELECT s.*, o.order_number, o.status as order_status, u.name as customer_name, t.name as tenant_name
              FROM shipments s
              JOIN orders o ON s.order_id = o.id
              JOIN users u ON o.customer_id = u.id
              JOIN tenants t ON o.tenant_id = t.id
              WHERE 1=1";
    $params = [];

    if ($user['role'] === 'customer') {
        $query .= " AND o.customer_id = ?";
        $params[] = $user['id'];
    } elseif ($user['role'] !== 'admin') {
        $query .= " AND o.tenant_id = ?";
        $params[] = $user['tenant_id'];
    }

    $query .= " ORDER BY s.id DESC";

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $shipments = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $shipments
    ]);
}

// 2. Akses Dokumen Invoice
// KK-04: faktur memuat nama, email, telepon, dan alamat — hanya untuk pihak yang berhak atas pesanannya.
function handleGetInvoice($pdo, array $user) {
    $orderId = $_GET['order_id'] ?? $_GET['id'] ?? null;
    if (!$orderId) {
        sendError('Parameter order_id wajib diisi', 400);
    }
    $milik = loadOrderForUser($pdo, $orderId, $user);

    $stmt = $pdo->prepare("SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                                  a.recipient_name, a.phone as shipping_phone, a.address_line, a.city, a.postal_code,
                                  t.name as tenant_name, t.code as tenant_code,
                                  s.tracking_number, s.courier, s.delivery_status, s.shipping_date
                           FROM orders o
                           JOIN users u ON o.customer_id = u.id
                           JOIN tenants t ON o.tenant_id = t.id
                           LEFT JOIN addresses a ON o.shipping_address_id = a.id
                           LEFT JOIN shipments s ON s.order_id = o.id
                           WHERE o.id = ?");
    $stmt->execute([$milik['id']]);
    $invoice = $stmt->fetch();

    $itemStmt = $pdo->prepare("SELECT oi.*, p.name as product_name, p.sku
                               FROM order_items oi
                               JOIN products p ON oi.product_id = p.id
                               WHERE oi.order_id = ?");
    $itemStmt->execute([$milik['id']]);
    $invoice['items'] = $itemStmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $invoice
    ]);
}

// 3. Buat entri pengiriman baru
// KK-10: hanya staf/manager/admin, hanya untuk pesanan tenant-nya, dan hanya dari status yang belum dikirim.
function handleCreateShipment($pdo, array $user) {
    requireRole($user, PERAN_STAF);

    $input = readJsonBody();
    $orderId = $input['order_id'] ?? null;
    $courier = preg_replace('/\s+/u', ' ', trim((string) ($input['courier'] ?? 'JNE Reguler')));
    $labelFormat = $input['label_format'] ?? 'standard';

    if (!$orderId) {
        sendError('Parameter order_id wajib diisi', 400);
    }
    if (!kurirValid($courier)) {
        sendError('Nama kurir tidak valid', 400);
    }
    if (!in_array($labelFormat, FORMAT_LABEL, true)) {
        sendError('Format label tidak dikenal', 400);
    }

    $trackingNumber = 'TRK-' . date('Ymd') . '-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 6));

    try {
        $pdo->beginTransaction();

        $order = loadOrderForUser($pdo, $orderId, $user, true);
        if (!in_array($order['status'], ['pending', 'confirmed', 'processing'], true)) {
            $pdo->rollBack();
            sendError("Pesanan berstatus '{$order['status']}' tidak dapat dikirim", 409);
        }

        $stmt = $pdo->prepare("INSERT INTO shipments (order_id, tracking_number, courier, delivery_status, label_format, shipping_date)
                               VALUES (?, ?, ?, 'manifested', ?, NOW())");
        $stmt->execute([$order['id'], $trackingNumber, $courier, $labelFormat]);
        $shipmentId = $pdo->lastInsertId();

        $updateOrder = $pdo->prepare("UPDATE orders SET status = 'shipped' WHERE id = ?");
        $updateOrder->execute([$order['id']]);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[shipments] create gagal: ' . $e->getMessage());
        sendError('Resi gagal dibuat', 500);
    }

    sendJson([
        'success' => true,
        'message' => 'Resi pengiriman berhasil dibuat',
        'tracking_number' => $trackingNumber,
        'shipment_id' => $shipmentId
    ]);
}
