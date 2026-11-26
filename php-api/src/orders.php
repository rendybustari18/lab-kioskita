<?php
// KiosKita - Legacy Order Management Handler
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
// KK-15: identitas wajib ada & sah untuk SEMUA aksi (fail closed).
$user = currentUser();

// Routing alur pesanan legacy
switch ($action) {
    case 'list':
        handleListOrders($pdo, $user);
        break;

    case 'detail':
        handleOrderDetail($pdo, $user);
        break;

    case 'add_note':
        handleAddNote($pdo, $user);
        break;

    case 'get_notes':
        handleGetNotes($pdo, $user);
        break;

    case 'cancel':
        handleCancelOrder($pdo, $user);
        break;

    default:
        sendError('Aksi tidak dikenal', 404);
}

// 1. Daftar pesanan
function handleListOrders($pdo, array $user) {
    $search = $_GET['search'] ?? '';
    $status = $_GET['status'] ?? '';

    $query = "SELECT o.*, u.name as customer_name, u.email as customer_email, t.name as tenant_name
              FROM orders o
              JOIN users u ON o.customer_id = u.id
              JOIN tenants t ON o.tenant_id = t.id
              WHERE 1=1";
    $params = [];

    // Filter role (cakupan sama dengan canAccessOrder)
    if ($user['role'] === 'customer') {
        $query .= " AND o.customer_id = ?";
        $params[] = $user['id'];
    } elseif ($user['role'] !== 'admin') {
        $query .= " AND o.tenant_id = ?";
        $params[] = $user['tenant_id'];
    }

    if (!empty($search)) {
        $query .= " AND (o.order_number LIKE ? OR u.name LIKE ?)";
        $params[] = "%$search%";
        $params[] = "%$search%";
    }

    if (!empty($status)) {
        $query .= " AND o.status = ?";
        $params[] = $status;
    }

    $query .= " ORDER BY o.id DESC";

    $stmt = $pdo->prepare($query);
    $stmt->execute($params);
    $orders = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $orders
    ]);
}

// 2. Detail pesanan
// KK-03: kepemilikan diperiksa di server SEBELUM data dikembalikan (bukan disembunyikan di UI).
function handleOrderDetail($pdo, array $user) {
    $orderId = $_GET['id'] ?? $_GET['order_id'] ?? null;
    if (!$orderId) {
        sendError('Parameter id pesanan diperlukan', 400);
    }
    $milik = loadOrderForUser($pdo, $orderId, $user);

    $stmt = $pdo->prepare("SELECT o.*, u.name as customer_name, u.email as customer_email, u.phone as customer_phone,
                                  a.recipient_name, a.phone as shipping_phone, a.address_line, a.city, a.postal_code,
                                  t.name as tenant_name
                           FROM orders o
                           JOIN users u ON o.customer_id = u.id
                           JOIN tenants t ON o.tenant_id = t.id
                           LEFT JOIN addresses a ON o.shipping_address_id = a.id
                           WHERE o.id = ?");
    $stmt->execute([$milik['id']]);
    $order = $stmt->fetch();

    // Ambil item produk dalam pesanan
    $itemStmt = $pdo->prepare("SELECT oi.*, p.name as product_name, p.sku, p.category
                               FROM order_items oi
                               JOIN products p ON oi.product_id = p.id
                               WHERE oi.order_id = ?");
    $itemStmt->execute([$milik['id']]);
    $order['items'] = $itemStmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $order
    ]);
}

// 3. Tambah catatan pesanan
// KK-05: hanya pihak yang berhak atas pesanan; penulis = pemanggil (bukan default admin #1);
//        pelanggan hanya dapat menulis catatan bertipe 'customer'.
// KK-06: konten disimpan apa adanya — pengamanan XSS dilakukan saat RENDER (encode on output).
function handleAddNote($pdo, array $user) {
    $input = readJsonBody();
    $orderId = $input['order_id'] ?? $_GET['order_id'] ?? null;
    $content = trim((string) ($input['content'] ?? ''));
    $noteType = $input['note_type'] ?? 'internal';

    if (!$orderId || $content === '') {
        sendError('Order ID dan isi catatan wajib diisi', 400);
    }
    if (mb_strlen($content) > 2000) {
        sendError('Isi catatan maksimal 2000 karakter', 400);
    }
    if (!in_array($noteType, ['internal', 'customer'], true)) {
        sendError('Tipe catatan tidak valid', 400);
    }
    if (!isStaf($user)) {
        $noteType = 'customer';
    }

    $order = loadOrderForUser($pdo, $orderId, $user);

    $stmt = $pdo->prepare("INSERT INTO order_notes (order_id, author_id, note_type, content) VALUES (?, ?, ?, ?)");
    $stmt->execute([$order['id'], $user['id'], $noteType, $content]);

    sendJson([
        'success' => true,
        'message' => 'Catatan pesanan berhasil ditambahkan',
        'note_id' => $pdo->lastInsertId()
    ]);
}

// 4. Daftar catatan pesanan
// KK-05: catatan 'internal' (instruksi gudang) hanya untuk staf; pelanggan melihat catatan 'customer'.
function handleGetNotes($pdo, array $user) {
    $orderId = $_GET['order_id'] ?? $_GET['id'] ?? null;
    if (!$orderId) {
        sendError('Parameter order_id wajib diisi', 400);
    }
    $order = loadOrderForUser($pdo, $orderId, $user);

    $sql = "SELECT n.*, u.name as author_name, u.role as author_role
            FROM order_notes n
            JOIN users u ON n.author_id = u.id
            WHERE n.order_id = ?";
    if (!isStaf($user)) {
        $sql .= " AND n.note_type = 'customer'";
    }
    $sql .= " ORDER BY n.id ASC";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([$order['id']]);
    $notes = $stmt->fetchAll();

    sendJson([
        'success' => true,
        'data' => $notes
    ]);
}

// 5. Pembatalan pesanan
// KK-09: (a) hanya pihak yang berhak, (b) hanya dari status yang masih boleh dibatalkan,
//        (c) dalam satu transaksi dengan kunci baris — stok dikembalikan TEPAT SEKALI.
function handleCancelOrder($pdo, array $user) {
    $input = readJsonBody();
    $orderId = $input['order_id'] ?? $_GET['order_id'] ?? null;

    if (!$orderId) {
        sendError('Parameter order_id wajib disertakan', 400);
    }

    // Pelanggan: sebelum diproses gudang. Staf: sampai sebelum dikirim.
    $bolehBatal = isStaf($user) ? ['pending', 'confirmed', 'processing'] : ['pending', 'confirmed'];

    try {
        $pdo->beginTransaction();

        $order = loadOrderForUser($pdo, $orderId, $user, true);

        if (!in_array($order['status'], $bolehBatal, true)) {
            $pdo->rollBack();
            sendError("Pesanan berstatus '{$order['status']}' tidak dapat dibatalkan", 409);
        }

        // Transisi bersyarat: bila status berubah di antara baca & tulis, tidak ada yang diubah.
        $updateStmt = $pdo->prepare("UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = ?");
        $updateStmt->execute([$order['id'], $order['status']]);
        if ($updateStmt->rowCount() !== 1) {
            $pdo->rollBack();
            sendError('Status pesanan berubah, silakan muat ulang', 409);
        }

        $itemsStmt = $pdo->prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?");
        $itemsStmt->execute([$order['id']]);
        $stockStmt = $pdo->prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
        foreach ($itemsStmt->fetchAll() as $item) {
            $stockStmt->execute([$item['quantity'], $item['product_id']]);
        }

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        error_log('[orders] cancel gagal: ' . $e->getMessage());
        sendError('Pembatalan gagal diproses', 500);
    }

    sendJson([
        'success' => true,
        'message' => "Pesanan #{$order['id']} berhasil dibatalkan dan stok dikembalikan",
        'previous_status' => $order['status'],
        'new_status' => 'cancelled'
    ]);
}
