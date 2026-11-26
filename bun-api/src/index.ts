import { extractAuthUser, handleGetMe, handleLogin } from './auth';
import { handleGetProfile, handleUpdateProfile } from './profile';
import { handleCreateAddress, handleGetAddressById, handleListAddresses, handleUpdateAddress } from './address';
import { handleGetProductById, handleListProducts } from './products';
import { proxyToPhp } from './proxy';
import pool from './db';

const PORT = parseInt(process.env.PORT || '3000', 10);

function setCorsHeaders(resHeaders: Headers): void {
  resHeaders.set('Access-Control-Allow-Origin', '*');
  resHeaders.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  resHeaders.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
}

const server = Bun.serve({
  port: PORT,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Handle preflight CORS
    if (method === 'OPTIONS') {
      const headers = new Headers();
      setCorsHeaders(headers);
      return new Response(null, { status: 204, headers });
    }

    try {
      let response: Response;

      // 1. Auth routes
      if (path === '/api/auth/login' && method === 'POST') {
        response = await handleLogin(req);
      } else if (path === '/api/auth/me' && method === 'GET') {
        response = await handleGetMe(req);
      } else if (path === '/api/auth/logout' && method === 'POST') {
        response = Response.json({ success: true, message: 'Logout berhasil' });
      }

      // 2. Profile routes (KK-01: role tidak dapat diubah lewat profil)
      else if (path === '/api/profile' && method === 'GET') {
        response = await handleGetProfile(req);
      } else if (path === '/api/profile' && method === 'PUT') {
        response = await handleUpdateProfile(req);
      }

      // 3. Address routes (KK-02: kepemilikan alamat di dalam query)
      else if (path === '/api/addresses' && method === 'GET') {
        response = await handleListAddresses(req);
      } else if (path === '/api/addresses' && method === 'POST') {
        response = await handleCreateAddress(req);
      } else if (path.startsWith('/api/addresses/') && method === 'GET') {
        const addressId = parseInt(path.split('/')[3], 10);
        response = await handleGetAddressById(req, addressId);
      } else if (path.startsWith('/api/addresses/') && method === 'PUT') {
        const addressId = parseInt(path.split('/')[3], 10);
        response = await handleUpdateAddress(req, addressId);
      }

      // 4. Products routes
      else if (path === '/api/products' && method === 'GET') {
        response = await handleListProducts(req);
      } else if (path.startsWith('/api/products/') && method === 'GET') {
        const productId = parseInt(path.split('/')[3], 10);
        response = await handleGetProductById(productId);
      }

      // 5. Checkout & Order placement
      else if (path === '/api/cart/checkout' && method === 'POST') {
        response = await handleCheckout(req);
      }

      // 6. Dashboard statistics
      else if (path === '/api/dashboard/stats' && method === 'GET') {
        response = await handleDashboardStats(req);
      }

      // 7. Admin user management
      else if (path === '/api/admin/users' && method === 'GET') {
        response = await handleListAdminUsers(req);
      } else if (path === '/api/admin/users' && method === 'POST') {
        response = await handleCreateAdminUser(req);
      }

      // 8. Legacy PHP API Proxy Routes
      // Orders proxy (KK-03/05/09: kepemilikan & status ditegakkan di orders.php)
      else if (path === '/api/orders' && method === 'GET') {
        response = await proxyToPhp(req, 'orders.php', 'list');
      } else if (path.startsWith('/api/orders/') && path.endsWith('/notes') && method === 'GET') {
        const orderId = path.split('/')[3];
        response = await proxyToPhp(req, 'orders.php', 'get_notes', { order_id: orderId });
      } else if (path === '/api/orders/notes' && method === 'POST') {
        response = await proxyToPhp(req, 'orders.php', 'add_note');
      } else if (path.startsWith('/api/orders/') && path.endsWith('/cancel') && method === 'POST') {
        const orderId = path.split('/')[3];
        response = await proxyToPhp(req, 'orders.php', 'cancel', { order_id: orderId });
      } else if (path.startsWith('/api/orders/') && method === 'GET') {
        const orderId = path.split('/')[3];
        response = await proxyToPhp(req, 'orders.php', 'detail', { id: orderId });
      }

      // Shipments & Invoices proxy (KK-04/10)
      else if (path === '/api/shipments' && method === 'GET') {
        response = await proxyToPhp(req, 'shipments.php', 'list');
      } else if (path === '/api/shipments' && method === 'POST') {
        response = await proxyToPhp(req, 'shipments.php', 'create');
      } else if (path.startsWith('/api/invoices/') && method === 'GET') {
        const orderId = path.split('/')[3];
        response = await proxyToPhp(req, 'shipments.php', 'invoice', { order_id: orderId, id: orderId });
      }

      // Shipping Label Generator preview (KK-08: tanpa shell)
      else if (path === '/api/labels/preview') {
        response = await proxyToPhp(req, 'label_generator.php');
      }

      // Coupons proxy (KK-12: batas pemakaian ditegakkan)
      else if (path === '/api/coupons' && method === 'GET') {
        response = await proxyToPhp(req, 'coupons.php', 'list');
      } else if (path === '/api/coupons/verify' && method === 'POST') {
        response = await proxyToPhp(req, 'coupons.php', 'verify');
      }

      // 404 Fallback
      else {
        response = Response.json({ success: false, error: 'Endpoint tidak ditemukan' }, { status: 404 });
      }

      const headers = new Headers(response.headers);
      setCorsHeaders(headers);

      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (err: any) {
      // KK-16: detail galat (SQL, stack, parser) hanya ke log server.
      console.error(`[bff] ${method} ${path} gagal:`, err);
      const headers = new Headers();
      setCorsHeaders(headers);
      return Response.json({ success: false, error: 'Terjadi kesalahan pada server' }, { status: 500, headers });
    }
  },
});

console.log(`[KiosKita BFF] Bun API Gateway berjalan di http://localhost:${PORT}`);

// Helper: Checkout
// Prinsip: klien hanya boleh mengirim PILIHAN (produk, jumlah, alamat, kode kupon).
// Semua ANGKA uang dan stok dihitung/diperiksa ulang di server, di dalam satu transaksi.
const ONGKIR_FLAT = 15000; // KK-11: tarif tetap server (UI pun selalu 15.000); shipping_cost klien diabaikan
const MAKS_QTY_PER_ITEM = 100;
const MAKS_BARIS_KERANJANG = 50;

/** Galat yang pesannya aman ditampilkan ke pengguna (400). Selainnya = 500 generik. */
class KesalahanBisnis extends Error {}

async function handleCheckout(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user) {
    return Response.json({ success: false, error: 'Akses ditolak: Harap login terlebih dahulu' }, { status: 401 });
  }
  // Keranjang hanya untuk pelanggan (sejalan dengan meta route /cart di web).
  if (user.role !== 'customer') {
    return Response.json({ success: false, error: 'Checkout hanya untuk akun pelanggan' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }
  const { items, shipping_address_id, coupon_code } = body ?? {};

  if (!Array.isArray(items) || items.length === 0) {
    return Response.json({ success: false, error: 'Keranjang belanja kosong' }, { status: 400 });
  }
  if (items.length > MAKS_BARIS_KERANJANG) {
    return Response.json({ success: false, error: 'Terlalu banyak baris dalam keranjang' }, { status: 400 });
  }

  // KK-11: kuantitas wajib bilangan bulat positif dengan batas atas (tolak negatif, nol, pecahan, NaN).
  const baris: { product_id: number; quantity: number }[] = [];
  const kebutuhan = new Map<number, number>();
  for (const item of items) {
    const pid = Number(item?.product_id);
    const qty = Number(item?.quantity);
    if (!Number.isInteger(pid) || pid <= 0 || !Number.isInteger(qty) || qty < 1 || qty > MAKS_QTY_PER_ITEM) {
      return Response.json({ success: false, error: 'Produk atau kuantitas tidak valid' }, { status: 400 });
    }
    baris.push({ product_id: pid, quantity: qty });
    kebutuhan.set(pid, (kebutuhan.get(pid) ?? 0) + qty);
  }

  // KK-11: alamat pengiriman (bila dipilih) wajib milik pemesan.
  let alamatId: number | null = null;
  if (shipping_address_id !== undefined && shipping_address_id !== null && shipping_address_id !== '') {
    alamatId = Number(shipping_address_id);
    if (!Number.isInteger(alamatId)) {
      return Response.json({ success: false, error: 'Alamat pengiriman tidak valid' }, { status: 400 });
    }
    const [aRows] = await pool.query<any[]>('SELECT id FROM addresses WHERE id = ? AND user_id = ?', [alamatId, user.id]);
    if (aRows.length === 0) {
      return Response.json({ success: false, error: 'Alamat pengiriman tidak valid' }, { status: 400 });
    }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // KK-13: kunci baris produk (urut id -> bebas deadlock) agar cek stok & pengurangan atomik.
    const ids = [...kebutuhan.keys()].sort((a, b) => a - b);
    const [pRows] = await conn.query<any[]>(
      'SELECT id, name, price, stock FROM products WHERE id IN (?) ORDER BY id FOR UPDATE',
      [ids]
    );
    const produk = new Map<number, any>(pRows.map((p: any) => [Number(p.id), p]));

    for (const [pid, butuh] of kebutuhan) {
      const p = produk.get(pid);
      if (!p) throw new KesalahanBisnis(`Produk dengan ID ${pid} tidak ditemukan`);
      if (Number(p.stock) < butuh) throw new KesalahanBisnis(`Stok "${p.name}" tidak mencukupi (tersisa ${p.stock})`);
    }

    let subtotal = 0;
    const validatedItems = baris.map((b) => {
      const price = parseFloat(produk.get(b.product_id).price);
      subtotal += price * b.quantity;
      return { product_id: b.product_id, quantity: b.quantity, unit_price: price, total_price: price * b.quantity };
    });

    // KK-12: kupon divalidasi penuh di server — aktif, minimum pembelian, dan batas pemakaian per pengguna.
    let discount = 0;
    let kupon: any = null;
    if (coupon_code) {
      const kode = String(coupon_code).trim().toUpperCase();
      // FOR UPDATE: dua checkout bersamaan dengan kupon yang sama diproses bergiliran.
      const [cRows] = await conn.query<any[]>('SELECT * FROM coupons WHERE code = ? AND is_active = 1 FOR UPDATE', [kode]);
      if (cRows.length === 0) throw new KesalahanBisnis('Kupon tidak valid atau sudah kedaluwarsa');
      kupon = cRows[0];

      if (subtotal < parseFloat(kupon.min_purchase)) {
        throw new KesalahanBisnis(`Minimum pembelian untuk kupon ini adalah Rp ${Number(kupon.min_purchase).toLocaleString('id-ID')}`);
      }
      const [uRows] = await conn.query<any[]>(
        'SELECT COUNT(*) AS n FROM coupon_usages WHERE coupon_id = ? AND user_id = ? FOR UPDATE',
        [kupon.id, user.id]
      );
      if (Number(uRows[0].n) >= Number(kupon.max_uses_per_user)) {
        throw new KesalahanBisnis('Kupon sudah mencapai batas pemakaian untuk akun Anda');
      }

      discount = kupon.discount_type === 'percentage'
        ? (subtotal * parseFloat(kupon.discount_value)) / 100
        : parseFloat(kupon.discount_value);
      discount = Math.min(discount, subtotal);
    }

    const grandTotal = subtotal - discount + ONGKIR_FLAT;
    const [countRows] = await conn.query<any[]>('SELECT COUNT(*) as total FROM orders');
    const nextOrderNum = `ORD-2026-${String(countRows[0].total + 1).padStart(4, '0')}`;

    const [orderRes] = await conn.query<any>(
      `INSERT INTO orders (order_number, tenant_id, customer_id, status, subtotal, discount, shipping_cost, grand_total, coupon_code, shipping_address_id)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
      [nextOrderNum, user.tenant_id, user.id, subtotal, discount, ONGKIR_FLAT, grandTotal, kupon ? kupon.code : null, alamatId]
    );

    const orderId = orderRes.insertId;

    for (const vItem of validatedItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, quantity, unit_price, total_price)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, vItem.product_id, vItem.quantity, vItem.unit_price, vItem.total_price]
      );
    }

    // KK-13: pengurangan bersyarat — tidak pernah menembus nol, tidak pernah "GREATEST(0, ...)" diam-diam.
    for (const [pid, butuh] of kebutuhan) {
      const [u] = await conn.query<any>('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', [butuh, pid, butuh]);
      if (u.affectedRows !== 1) throw new KesalahanBisnis('Stok berubah saat diproses, silakan coba lagi');
    }

    // KK-12: pemakaian kupon DICATAT, sehingga batas max_uses_per_user benar-benar berlaku.
    if (kupon) {
      await conn.query('INSERT INTO coupon_usages (coupon_id, user_id, order_id) VALUES (?, ?, ?)', [kupon.id, user.id, orderId]);
    }

    await conn.commit();

    return Response.json({
      success: true,
      message: 'Pesanan berhasil dibuat',
      order: {
        id: orderId,
        order_number: nextOrderNum,
        grand_total: grandTotal,
      },
    });
  } catch (err: any) {
    await conn.rollback();
    if (err instanceof KesalahanBisnis) {
      return Response.json({ success: false, error: err.message }, { status: 400 });
    }
    console.error('[checkout] gagal:', err);
    return Response.json({ success: false, error: 'Pesanan gagal diproses' }, { status: 500 });
  } finally {
    conn.release();
  }
}

// Helper: Dashboard Stats
async function handleDashboardStats(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  const [orderCount] = await pool.query<any[]>(
    user.role === 'customer'
      ? `SELECT COUNT(*) as count FROM orders WHERE customer_id = ?`
      : user.role === 'admin'
      ? `SELECT COUNT(*) as count FROM orders`
      : `SELECT COUNT(*) as count FROM orders WHERE tenant_id = ?`,
    user.role === 'customer' ? [user.id] : user.role === 'admin' ? [] : [user.tenant_id]
  );

  const [productCount] = await pool.query<any[]>(
    user.role === 'admin'
      ? `SELECT COUNT(*) as count FROM products`
      : `SELECT COUNT(*) as count FROM products WHERE tenant_id = ?`,
    user.role === 'admin' ? [] : [user.tenant_id]
  );

  const [lowStockCount] = await pool.query<any[]>(
    user.role === 'admin'
      ? `SELECT COUNT(*) as count FROM products WHERE stock < 25`
      : `SELECT COUNT(*) as count FROM products WHERE stock < 25 AND tenant_id = ?`,
    user.role === 'admin' ? [] : [user.tenant_id]
  );

  // KK-14: cakupan pesanan terbaru sama dengan cakupan angka di atasnya —
  // customer: miliknya; admin: semua; manager/staff: hanya tenant-nya (dulu: semua tenant).
  const [recentOrders] = await pool.query<any[]>(
    `SELECT o.id, o.order_number, o.status, o.grand_total, o.created_at, u.name as customer_name
     FROM orders o
     JOIN users u ON o.customer_id = u.id
     ${user.role === 'customer' ? 'WHERE o.customer_id = ?' : user.role === 'admin' ? '' : 'WHERE o.tenant_id = ?'}
     ORDER BY o.id DESC LIMIT 5`,
    user.role === 'customer' ? [user.id] : user.role === 'admin' ? [] : [user.tenant_id]
  );

  return Response.json({
    success: true,
    data: {
      total_orders: orderCount[0].count,
      total_products: productCount[0].count,
      low_stock_products: lowStockCount[0].count,
      recent_orders: recentOrders,
    },
  });
}

// Helper: Admin User Management
async function handleListAdminUsers(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user || user.role !== 'admin') {
    return Response.json({ success: false, error: 'Hanya administrator yang diizinkan mengakses data user' }, { status: 403 });
  }

  const [users] = await pool.query<any[]>(
    `SELECT u.id, u.name, u.email, u.role, u.phone, u.tenant_id, t.name as tenant_name, u.created_at
     FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     ORDER BY u.id ASC`
  );

  return Response.json({ success: true, data: users });
}

async function handleCreateAdminUser(req: Request): Promise<Response> {
  const user = extractAuthUser(req);
  if (!user || user.role !== 'admin') {
    return Response.json({ success: false, error: 'Hanya administrator yang diizinkan menambah user' }, { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }
  const { name, email, password, role = 'staff', tenant_id = 1, phone = '' } = body ?? {};

  if (!name || !email || !password) {
    return Response.json({ success: false, error: 'Nama, email, dan password wajib diisi' }, { status: 400 });
  }
  // Nilai peran & tenant divalidasi sebelum menyentuh DB (dulu galat ENUM/FK mentah bocor ke klien).
  if (!['admin', 'manager', 'staff', 'customer'].includes(role) || !Number.isInteger(Number(tenant_id))) {
    return Response.json({ success: false, error: 'Peran atau tenant tidak valid' }, { status: 400 });
  }

  const hashedPassword = await Bun.password.hash(password);

  const [res] = await pool.query<any>(
    `INSERT INTO users (tenant_id, name, email, password, role, phone)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [tenant_id, name, email, hashedPassword, role, phone]
  );

  return Response.json({
    success: true,
    message: 'User baru berhasil dibuat',
    user_id: res.insertId,
  });
}
