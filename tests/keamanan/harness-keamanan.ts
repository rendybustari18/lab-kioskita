/**
 * =============================================================================
 * harness-keamanan.ts — KiosKita · Tugas Akhir Secure Coding (Kelompok 2)
 * -----------------------------------------------------------------------------
 * Uji HTTP black-box lewat gerbang Bun (satu-satunya pintu yang dibuka ke luar),
 * ditambah pemindai statis untuk sink yang hanya hidup di browser (v-html).
 *
 * Urutan sengaja: [R] ALUR SAH dulu, baru [S] SERANGAN — serangan yang berhasil
 * pada kode lama mengubah data (status pesanan, stok, peran), jadi tidak boleh
 * mendahului uji regresi.
 *
 * [R] Regresi  : pemilik sah tetap bisa bekerja (Correctness + Regression).
 * [S] Serangan : satu uji per temuan KK-xx; RENTAN = serangan berhasil, AMAN = ditolak.
 * [K] Ketahanan: request paralel (stok & kupon). Pada kode lama hasilnya tidak deterministik —
 *                nomor pesanan COUNT(*)+1 bertabrakan sehingga sebagian request gagal acak —
 *                maka [K] membuktikan patch, bukan membandingkan sebelum/sesudah.
 *
 * Jalankan dari ROOT repo, terhadap stack yang baru di-reset:
 *   docker compose down -v && docker compose up -d --build
 *   bun tests/keamanan/harness-keamanan.ts http://localhost:3000
 *
 * Exit 0 = semua [R] LULUS, [S] AMAN, dan [K] TAHAN. Exit 1 = selainnya.
 * Payload uji tidak merusak: RCE hanya mencetak penanda KKRCE42 (hasil 6*7).
 * =============================================================================
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const REPO = process.argv.includes('--repo') ? process.argv[process.argv.indexOf('--repo') + 1] : '.';

type Hasil = { id: string; judul: string; ok: boolean; rincian: string };
const hasilR: Hasil[] = [];
const hasilS: Hasil[] = [];
const hasilK: Hasil[] = [];

// ---------------------------------------------------------------------------
// Utilitas HTTP
// ---------------------------------------------------------------------------
async function api(path: string, opt: { token?: string; method?: string; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opt.token) headers.Authorization = `Bearer ${opt.token}`;
  const res = await fetch(`${BASE}/api${path}`, {
    method: opt.method || (opt.body !== undefined || opt.raw !== undefined ? 'POST' : 'GET'),
    headers,
    body: opt.raw !== undefined ? opt.raw : opt.body !== undefined ? JSON.stringify(opt.body) : undefined,
  });
  const teks = await res.text();
  let json: any = null;
  try { json = JSON.parse(teks); } catch { /* bukan JSON */ }
  return { status: res.status, json, teks };
}

const AKUN = {
  admin: 'admin@kioskita.local', manager: 'manager@kioskita.local',
  staff1: 'staff1@kioskita.local', staff2: 'staff2@kioskita.local',
  budi: 'budi@customer.local', siti: 'siti@customer.local',
  joko: 'joko@customer.local', dewi: 'dewi@customer.local',
} as const;
type NamaAkun = keyof typeof AKUN;
const T = {} as Record<NamaAkun, string>;

async function login(nama: NamaAkun): Promise<string> {
  const r = await api('/auth/login', { body: { email: AKUN[nama], password: 'password123' } });
  if (!r.json?.token) throw new Error(`login ${nama} gagal: ${r.status} ${r.teks.slice(0, 120)}`);
  return r.json.token;
}

async function stok(productId: number): Promise<number> {
  const r = await api(`/products/${productId}`);
  return Number(r.json?.data?.stock);
}

async function checkout(token: string, body: Record<string, unknown>) {
  return api('/cart/checkout', { token, body });
}

// ---------------------------------------------------------------------------
// Pencatat
// ---------------------------------------------------------------------------
async function regresi(id: string, judul: string, fn: () => Promise<string>) {
  try {
    const rincian = await fn();
    hasilR.push({ id, judul, ok: true, rincian });
  } catch (e: any) {
    hasilR.push({ id, judul, ok: false, rincian: e.message });
  }
}

/** fn mengembalikan [seranganBerhasil, rincian]. AMAN bila serangan TIDAK berhasil. */
async function serangan(id: string, judul: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [berhasil, rincian] = await fn();
    hasilS.push({ id, judul, ok: !berhasil, rincian });
  } catch (e: any) {
    hasilS.push({ id, judul, ok: false, rincian: `galat harness: ${e.message}` });
  }
}

/** [K] sama dengan serangan, tetapi khusus uji konkurensi — bukti patch tahan request paralel. */
async function ketahanan(id: string, judul: string, fn: () => Promise<[boolean, string]>) {
  try {
    const [gagal, rincian] = await fn();
    hasilK.push({ id, judul, ok: !gagal, rincian });
  } catch (e: any) {
    hasilK.push({ id, judul, ok: false, rincian: `galat harness: ${e.message}` });
  }
}

/** Ringkas alasan penolakan per pesan galat, mis. "Stok ... tidak mencukupi x6". */
function alasan(hasil: { json: any; status: number }[]): string {
  const hitung = new Map<string, number>();
  for (const r of hasil) {
    if (r.json?.success) continue;
    const k = String(r.json?.error ?? r.status).replace(/ORD-\d{4}-\d{4}/, 'ORD-…').slice(0, 70);
    hitung.set(k, (hitung.get(k) ?? 0) + 1);
  }
  return hitung.size ? [...hitung].map(([k, n]) => `"${k}" x${n}`).join('; ') : '-';
}

function pastikan(kondisi: unknown, pesan: string): asserts kondisi {
  if (!kondisi) throw new Error(pesan);
}

function baca(rel: string): string {
  const p = join(REPO, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : '';
}

// ===========================================================================
// [R] ALUR SAH — harus LULUS sebelum dan sesudah patch
// ===========================================================================
async function ujiRegresi() {
  await regresi('R-01', 'Semua akun dummy bisa login dan /auth/me sesuai', async () => {
    for (const n of Object.keys(AKUN) as NamaAkun[]) T[n] = await login(n);
    const me = await api('/auth/me', { token: T.budi });
    pastikan(me.json?.user?.email === AKUN.budi, `me salah: ${me.teks.slice(0, 80)}`);
    return '8 akun login, /auth/me = budi';
  });

  await regresi('R-02', 'Katalog produk dapat dibaca', async () => {
    const r = await api('/products');
    pastikan(r.status === 200 && r.json?.data?.length === 12, `produk: ${r.status}`);
    return '12 produk';
  });

  await regresi('R-03', 'Pelanggan melihat pesanan, detail, faktur, dan catatan miliknya sendiri', async () => {
    const daftar = await api('/orders', { token: T.budi });
    const ids = (daftar.json?.data || []).map((o: any) => o.id).sort();
    pastikan(JSON.stringify(ids) === '[1,2]', `daftar budi = ${JSON.stringify(ids)}`);
    const d = await api('/orders/1', { token: T.budi });
    pastikan(d.status === 200 && d.json?.data?.order_number === 'ORD-2026-0001', `detail 1: ${d.status}`);
    const f = await api('/invoices/1', { token: T.budi });
    pastikan(f.status === 200 && f.json?.data?.order_number === 'ORD-2026-0001', `faktur 1: ${f.status}`);
    const c = await api('/orders/1/notes', { token: T.budi });
    pastikan(c.status === 200 && Array.isArray(c.json?.data), `catatan 1: ${c.status}`);
    return 'daftar [1,2], detail/faktur/catatan pesanan 1 = 200';
  });

  await regresi('R-04', 'Staf membaca pesanan tenant-nya dan menulis + membaca catatan internal', async () => {
    const d = await api('/orders/1', { token: T.staff1 });
    pastikan(d.status === 200, `staff1 detail 1: ${d.status}`);
    const add = await api('/orders/notes', { token: T.staff1, body: { order_id: 1, content: 'Cek ulang segel kardus.', note_type: 'internal' } });
    pastikan(add.json?.success === true, `tambah catatan: ${add.status} ${add.teks.slice(0, 80)}`);
    const c = await api('/orders/1/notes', { token: T.staff1 });
    const ada = (c.json?.data || []).some((n: any) => n.content === 'Cek ulang segel kardus.' && n.note_type === 'internal');
    pastikan(ada, 'catatan internal baru tidak terbaca staf');
    return 'staff1: detail 200, catatan internal tersimpan & terbaca';
  });

  await regresi('R-05', 'Admin membaca pesanan lintas tenant dan mengelola user', async () => {
    const d = await api('/orders/5', { token: T.admin });
    pastikan(d.status === 200, `admin detail 5: ${d.status}`);
    const u = await api('/admin/users', { token: T.admin });
    pastikan(u.status === 200 && u.json?.data?.length >= 8, `list users: ${u.status}`);
    const c = await api('/admin/users', { token: T.admin, body: { name: 'Staf Uji', email: `staf.uji.${Date.now()}@kioskita.local`, password: 'Password-Uji-123', role: 'staff', tenant_id: 1 } });
    pastikan(c.json?.success === true, `buat user: ${c.status} ${c.teks.slice(0, 80)}`);
    return 'admin: detail tenant 2 = 200, list & buat user OK';
  });

  await regresi('R-06', 'Checkout sah: harga, ongkir, kupon, dan stok dihitung benar', async () => {
    const sebelum = await stok(1);
    const r = await checkout(T.budi, { items: [{ product_id: 1, quantity: 2 }], shipping_address_id: 1, coupon_code: 'GRATISONGKIR', shipping_cost: 15000 });
    pastikan(r.json?.success === true, `checkout: ${r.status} ${r.teks.slice(0, 120)}`);
    // 2 x 150.000 - 20.000 + 15.000 = 295.000
    pastikan(Number(r.json.order.grand_total) === 295000, `grand_total = ${r.json.order.grand_total}`);
    const sesudah = await stok(1);
    pastikan(sesudah === sebelum - 2, `stok ${sebelum} -> ${sesudah}`);
    return `grand_total 295.000, stok produk 1: ${sebelum} -> ${sesudah}`;
  });

  await regresi('R-07', 'Pelanggan membatalkan pesanan pending miliknya, stok kembali', async () => {
    const baru = await checkout(T.siti, { items: [{ product_id: 4, quantity: 1 }], shipping_address_id: 3 });
    pastikan(baru.json?.success, `checkout siti: ${baru.teks.slice(0, 100)}`);
    const s0 = await stok(4);
    const b = await api(`/orders/${baru.json.order.id}/cancel`, { token: T.siti, body: {} });
    pastikan(b.json?.success === true, `batal: ${b.status} ${b.teks.slice(0, 100)}`);
    const s1 = await stok(4);
    pastikan(s1 === s0 + 1, `stok ${s0} -> ${s1}`);
    return `pesanan #${baru.json.order.id} dibatalkan, stok produk 4: ${s0} -> ${s1}`;
  });

  await regresi('R-08', 'Profil & alamat milik sendiri dapat diubah; alamat baru dapat ditambah', async () => {
    const p = await api('/profile', { token: T.budi, method: 'PUT', body: { name: 'Budi Santoso', phone: '0815000005' } });
    pastikan(p.json?.success === true, `profil: ${p.status}`);
    const a = await api('/addresses/1', { token: T.budi, method: 'PUT', body: { city: 'Jakarta Selatan' } });
    pastikan(a.json?.success === true && a.json?.data?.city === 'Jakarta Selatan', `alamat: ${a.status}`);
    const n = await api('/addresses', { token: T.budi, body: { recipient_name: 'Gudang Budi', phone: '0815000005', address_line: 'Jl. Uji No. 1', city: 'Depok', postal_code: '16424', is_default: false } });
    pastikan(n.json?.success === true, `alamat baru: ${n.status}`);
    return 'profil, alamat 1, alamat baru = OK';
  });

  await regresi('R-09', 'Preview label pesanan milik sendiri tetap menghasilkan teks yang sama', async () => {
    const r = await api('/labels/preview', { token: T.budi, body: { order_id: 1, courier: 'JNE Reguler', format: 'standard' } });
    const harap = '[LABEL PREVIEW] Order: ORD-2026-0001 Kurir: JNE Reguler Format: standard';
    pastikan(r.json?.preview === harap, `preview = ${JSON.stringify(r.json?.preview)}`);
    return harap;
  });

  await regresi('R-10', 'Staf membuat resi untuk pesanan tenant-nya yang siap kirim', async () => {
    const baru = await checkout(T.siti, { items: [{ product_id: 6, quantity: 1 }], shipping_address_id: 3 });
    pastikan(baru.json?.success, 'checkout siti gagal');
    const r = await api('/shipments', { token: T.staff1, body: { order_id: baru.json.order.id, courier: 'JNE Reguler', label_format: 'standard' } });
    pastikan(r.json?.success === true && /^TRK-/.test(r.json?.tracking_number), `resi: ${r.status} ${r.teks.slice(0, 100)}`);
    const d = await api(`/orders/${baru.json.order.id}`, { token: T.staff1 });
    pastikan(d.json?.data?.status === 'shipped', `status = ${d.json?.data?.status}`);
    return `resi ${r.json.tracking_number}, pesanan #${baru.json.order.id} -> shipped`;
  });

  await regresi('R-11', 'Kupon valid untuk pengguna yang belum memakainya', async () => {
    const r = await api('/coupons/verify', { token: T.siti, body: { code: 'HEMAT10', subtotal: 200000 } });
    pastikan(r.json?.success === true && Number(r.json?.coupon?.discount_amount) === 20000, `verify: ${r.status} ${r.teks.slice(0, 100)}`);
    return 'siti: HEMAT10 atas 200.000 -> diskon 20.000';
  });

  await regresi('R-12', 'Dashboard menampilkan angka sesuai cakupan peran', async () => {
    const b = await api('/dashboard/stats', { token: T.budi });
    pastikan(b.status === 200 && (b.json?.data?.recent_orders || []).every((o: any) => o.customer_name === 'Budi Santoso'), 'budi melihat pesanan orang lain');
    const a = await api('/dashboard/stats', { token: T.admin });
    pastikan(a.status === 200 && a.json?.data?.recent_orders?.length > 0, 'admin tanpa recent_orders');
    return 'budi: hanya miliknya; admin: semua';
  });
}

// ===========================================================================
// [S] SERANGAN — harus AMAN sesudah patch
// ===========================================================================
async function ujiSerangan() {
  // ---- KK-01 ---------------------------------------------------------------
  await serangan('KK-01', 'Eskalasi peran lewat PUT /api/profile {"role":"admin"}', async () => {
    const r = await api('/profile', { token: T.dewi, method: 'PUT', body: { role: 'admin' } });
    const me = await api('/auth/me', { token: T.dewi });
    const jadiAdmin = me.json?.user?.role === 'admin';
    if (jadiAdmin) await api('/profile', { token: T.dewi, method: 'PUT', body: { role: 'customer' } }); // kembalikan
    return [jadiAdmin, `PUT ${r.status}; peran dewi sesudahnya = ${me.json?.user?.role}`];
  });

  // ---- KK-02 ---------------------------------------------------------------
  await serangan('KK-02', 'BOLA alamat: baca & ubah alamat pelanggan lain', async () => {
    const baca = await api('/addresses/4', { token: T.budi }); // milik joko
    const bacaBerhasil = baca.status === 200 && baca.json?.data?.city === 'Surabaya';
    const ubah = await api('/addresses/5', { token: T.budi, method: 'PUT', body: { city: 'KOTA-PENYERANG' } }); // milik dewi
    const milikDewi = await api('/addresses', { token: T.dewi });
    const ubahBerhasil = (milikDewi.json?.data || []).some((a: any) => a.city === 'KOTA-PENYERANG');
    if (ubahBerhasil) await api('/addresses/5', { token: T.dewi, method: 'PUT', body: { city: 'Semarang' } });
    return [bacaBerhasil || ubahBerhasil, `GET /addresses/4 -> ${baca.status}; PUT /addresses/5 -> ${ubah.status}, tersimpan=${ubahBerhasil}`];
  });

  // ---- KK-03 ---------------------------------------------------------------
  await serangan('KK-03', 'IDOR detail pesanan (tanpa login, lintas pelanggan, lintas tenant)', async () => {
    const tanpa = await api('/orders/5');
    const lintasUser = await api('/orders/5', { token: T.budi });
    const lintasTenant = await api('/orders/1', { token: T.staff2 });
    const bocor = [tanpa, lintasUser, lintasTenant].filter((x) => x.status === 200 && x.json?.data?.customer_email);
    return [bocor.length > 0, `tanpa login ${tanpa.status}; budi->#5 ${lintasUser.status}; staff2->#1 ${lintasTenant.status}`];
  });

  // ---- KK-04 ---------------------------------------------------------------
  await serangan('KK-04', 'IDOR faktur: faktur pelanggan lain beserta alamat & telepon', async () => {
    const tanpa = await api('/invoices/7');
    const lintas = await api('/invoices/7', { token: T.budi });
    const bocor = [tanpa, lintas].filter((x) => x.status === 200 && x.json?.data?.customer_phone);
    return [bocor.length > 0, `tanpa login ${tanpa.status}; budi->faktur #7 ${lintas.status}`];
  });

  // ---- KK-05 ---------------------------------------------------------------
  await serangan('KK-05', 'Catatan pesanan: baca/tulis lintas pesanan, penyamaran admin, catatan internal bocor', async () => {
    const bacaLain = await api('/orders/5/notes', { token: T.budi });
    const a = (bacaLain.json?.data || []).length > 0;
    const tulisAnonim = await api('/orders/notes', { body: { order_id: 5, content: 'catatan anonim', note_type: 'internal' } });
    const b = tulisAnonim.json?.success === true;
    const milikSendiri = await api('/orders/2/notes', { token: T.budi });
    const c = (milikSendiri.json?.data || []).some((n: any) => n.note_type === 'internal');
    const tulisInternal = await api('/orders/notes', { token: T.budi, body: { order_id: 2, content: 'mengaku staf', note_type: 'internal' } });
    const cek = await api('/orders/2/notes', { token: T.staff1 });
    const d = (cek.json?.data || []).some((n: any) => n.content === 'mengaku staf' && n.note_type === 'internal');
    return [a || b || c || d,
      `budi baca catatan #5: ${a}; tulis tanpa login: ${b} (${tulisAnonim.status}); budi lihat catatan internal: ${c}; budi tulis 'internal': ${d}`];
  });

  // ---- KK-06 ---------------------------------------------------------------
  await serangan('KK-06', 'Stored XSS: konten catatan dirender v-html (OrderDetail.vue)', async () => {
    const src = baca('web/src/views/OrderDetail.vue');
    if (!src) return [false, '(lewati: berkas tidak ditemukan; jalankan dari root repo)'];
    const rentan = /v-html\s*=\s*"n\.content"/.test(src);
    return [rentan, rentan ? 'ditemukan v-html="n.content"' : 'konten catatan dirender sebagai teks ({{ }})'];
  });

  // ---- KK-07 ---------------------------------------------------------------
  await serangan('KK-07', 'DOM XSS: kata kunci pencarian dirender v-html (Orders.vue)', async () => {
    const src = baca('web/src/views/Orders.vue');
    if (!src) return [false, '(lewati: berkas tidak ditemukan)'];
    const rentan = /v-html="[^"]*searchQuery/.test(src);
    return [rentan, rentan ? 'ditemukan v-html berisi searchQuery' : 'kata kunci dirender sebagai teks'];
  });

  // ---- KK-08 ---------------------------------------------------------------
  await serangan('KK-08', 'Command injection pada preview label -> eksekusi perintah di server', async () => {
    const payload = 'standard; echo KKRCE$((6*7))';
    const tanpa = await api('/labels/preview', { body: { order_id: 1, format: payload } });
    const login = await api('/labels/preview', { token: T.budi, body: { order_id: 1, courier: 'JNE Reguler', format: payload } });
    const rce = [tanpa, login].some((x) => String(x.json?.preview || '').includes('KKRCE42'));
    // Akar masalah: fungsi shell di layanan PHP. Allowlist saja tidak cukup bila shell masih ada.
    const php = ['label_generator.php', 'orders.php', 'shipments.php', 'coupons.php', 'index.php']
      .map((f) => baca(`php-api/src/${f}`)).join('\n');
    const shell = /\b(shell_exec|exec|system|passthru|popen|proc_open)\s*\(|`[^`\n]*\$[^`\n]*`/.test(php);
    return [rce || shell, `tanpa login ${tanpa.status}, preview=${JSON.stringify(tanpa.json?.preview ?? null)}; budi ${login.status}; fungsi shell di php-api/src: ${shell}`];
  });

  // ---- KK-09 ---------------------------------------------------------------
  await serangan('KK-09', 'Pembatalan: pesanan orang lain, pesanan terkirim, dan pembatalan berulang menggelembungkan stok', async () => {
    const baru = await checkout(T.budi, { items: [{ product_id: 7, quantity: 1 }], shipping_address_id: 1 });
    const lintas = await api(`/orders/${baru.json?.order?.id}/cancel`, { token: T.joko, body: {} });
    const a = lintas.json?.success === true;
    const terkirim = await api('/orders/7/cancel', { token: T.dewi, body: {} }); // status delivered
    const b = terkirim.json?.success === true;
    const s0 = await stok(3);
    await api('/orders/8/cancel', { token: T.dewi, body: {} }); // sudah cancelled
    await api('/orders/8/cancel', { token: T.dewi, body: {} });
    const s1 = await stok(3);
    const c = s1 > s0;
    return [a || b || c, `joko batalkan milik budi: ${a} (${lintas.status}); batalkan 'delivered': ${b} (${terkirim.status}); stok produk 3 ${s0} -> ${s1}`];
  });

  // ---- KK-10 ---------------------------------------------------------------
  await serangan('KK-10', 'Pelanggan membuat resi (menandai "shipped") untuk pesanan orang lain', async () => {
    const baru = await checkout(T.budi, { items: [{ product_id: 5, quantity: 1 }], shipping_address_id: 1 });
    const r = await api('/shipments', { token: T.joko, body: { order_id: baru.json?.order?.id, courier: 'Kurir Palsu' } });
    const d = await api(`/orders/${baru.json?.order?.id}`, { token: T.budi });
    const berhasil = r.json?.success === true || d.json?.data?.status === 'shipped';
    return [berhasil, `POST /shipments oleh joko -> ${r.status}; status pesanan budi = ${d.json?.data?.status}`];
  });

  // ---- KK-11 ---------------------------------------------------------------
  await serangan('KK-11', 'Checkout: ongkir negatif, kuantitas negatif, alamat milik orang lain', async () => {
    const ongkir = await checkout(T.budi, { items: [{ product_id: 8, quantity: 1 }], shipping_address_id: 1, shipping_cost: -310000 });
    const a = ongkir.json?.success === true && Number(ongkir.json.order.grand_total) < 310000;
    const s0 = await stok(10);
    const negatif = await checkout(T.budi, { items: [{ product_id: 10, quantity: -5 }], shipping_address_id: 1 });
    const s1 = await stok(10);
    const b = negatif.json?.success === true || s1 > s0;
    const alamat = await checkout(T.budi, { items: [{ product_id: 4, quantity: 1 }], shipping_address_id: 4 }); // milik joko
    let c = false;
    if (alamat.json?.success) {
      const d = await api(`/orders/${alamat.json.order.id}`, { token: T.budi });
      c = d.json?.data?.city === 'Surabaya';
    }
    return [a || b || c,
      `ongkir -310.000 -> grand_total ${ongkir.json?.order?.grand_total ?? ongkir.status}; qty -5 -> ${negatif.status}, stok ${s0}->${s1}; alamat joko -> ${alamat.status}, alamat joko bocor=${c}`];
  });

  // ---- KK-12 ---------------------------------------------------------------
  await serangan('KK-12', 'Kupon: dipakai ulang melebihi batas dan di bawah minimum pembelian', async () => {
    const ulang = await api('/coupons/verify', { token: T.budi, body: { code: 'HEMAT10', subtotal: 200000 } }); // budi sudah pakai 1x
    const a = ulang.json?.success === true;
    const minim = await checkout(T.joko, { items: [{ product_id: 10, quantity: 1 }], shipping_address_id: 4, coupon_code: 'DISKON50K' }); // 65.000 < 250.000
    const b = minim.json?.success === true && Number(minim.json.order.grand_total) < 65000 + 15000;
    const pertama = await checkout(T.dewi, { items: [{ product_id: 11, quantity: 2 }], shipping_address_id: 5, coupon_code: 'HEMAT10' });
    const kedua = await checkout(T.dewi, { items: [{ product_id: 11, quantity: 2 }], shipping_address_id: 5, coupon_code: 'HEMAT10' });
    // 2 x 110.000 = 220.000; tanpa diskon = 235.000
    const c = kedua.json?.success === true && Number(kedua.json.order.grand_total) < 235000;
    return [a || b || c,
      `verify ulang HEMAT10 (budi): ${a}; DISKON50K di bawah minimum: ${b}; HEMAT10 ke-2 (dewi): total ${kedua.json?.order?.grand_total ?? kedua.status} (pertama ${pertama.json?.order?.grand_total ?? pertama.status})`];
  });

  // ---- KK-13 ---------------------------------------------------------------
  await serangan('KK-13', 'Overselling: memesan melebihi stok', async () => {
    const s0 = await stok(9);
    const r = await checkout(T.budi, { items: [{ product_id: 9, quantity: s0 + 50 }], shipping_address_id: 1 });
    return [r.json?.success === true, `stok produk 9 = ${s0}, pesan ${s0 + 50} -> ${r.status} ${r.json?.success ? 'DITERIMA' : 'ditolak'}`];
  });

  // ---- KK-14 ---------------------------------------------------------------
  await serangan('KK-14', 'Dashboard: staf tenant 2 melihat pesanan terbaru tenant 1', async () => {
    const r = await api('/dashboard/stats', { token: T.staff2 });
    const pelangganT1 = ['Budi Santoso', 'Siti Rahma'];
    const bocor = (r.json?.data?.recent_orders || []).filter((o: any) => pelangganT1.includes(o.customer_name));
    return [bocor.length > 0, `recent_orders staff2: ${bocor.length} pesanan milik pelanggan tenant 1`];
  });

  // ---- KK-15 ---------------------------------------------------------------
  await serangan('KK-15', 'Gerbang meneruskan request tanpa token; layanan PHP fail-open', async () => {
    const titik = ['/orders', '/shipments', '/coupons'];
    const lolos: string[] = [];
    for (const p of titik) {
      const r = await api(p);
      if (r.status === 200 && r.json?.success === true) lolos.push(`${p}=200`);
    }
    return [lolos.length > 0, lolos.length ? `tanpa token: ${lolos.join(', ')}` : 'semua titik PHP menolak tanpa token (401)'];
  });

  // ---- KK-16 ---------------------------------------------------------------
  await serangan('KK-16', 'Kebocoran informasi: pesan galat mentah & secret JWT cadangan di kode', async () => {
    const r = await api('/auth/login', { raw: '{"email":' });
    const bocor = r.status >= 500 && /JSON|Parse|Unexpected|SyntaxError|at position/i.test(String(r.json?.error || r.teks));
    const auth = baca('bun-api/src/auth.ts');
    const secret = /process\.env\.JWT_SECRET\s*\|\|\s*['"]/.test(auth);
    return [bocor || secret, `JSON rusak -> ${r.status} ${JSON.stringify(r.json?.error ?? '').slice(0, 60)}; secret cadangan di auth.ts: ${secret}`];
  });
}

// ===========================================================================
// [K] KETAHANAN — patch harus tahan request paralel (cabang "Race Condition" di threat model)
// ===========================================================================
async function ujiKetahanan() {
  // ---- [K] KETAHANAN KONKURENSI ---------------------------------------------
  await ketahanan('K-01', '10 checkout BERSAMAAN memperebutkan stok terbatas: tidak ada overselling', async () => {
    const s0 = await stok(5);
    const qty = 5;
    const hasil = await Promise.all(Array.from({ length: 10 }, () =>
      checkout(T.budi, { items: [{ product_id: 5, quantity: qty }], shipping_address_id: 1 })));
    const diterima = hasil.filter((r) => r.json?.success === true).length;
    const s1 = await stok(5);
    const oversell = diterima * qty > s0 || s1 !== s0 - diterima * qty;
    return [oversell, `stok awal ${s0}; 10 x ${qty} unit paralel -> diterima ${diterima} (${diterima * qty} unit); stok akhir ${s1}; alasan tolak: ${alasan(hasil)}`];
  });

  await ketahanan('K-02', 'Kupon sekali-pakai dipakai 5 checkout BERSAMAAN: diskon tepat sekali', async () => {
    const hasil = await Promise.all(Array.from({ length: 5 }, () =>
      checkout(T.siti, { items: [{ product_id: 6, quantity: 2 }], shipping_address_id: 3, coupon_code: 'GRATISONGKIR' })));
    // 2 x 135.000 = 270.000; dengan kupon 250.000 + 15.000 = 265.000
    const berdiskon = hasil.filter((r) => r.json?.success === true && Number(r.json.order.grand_total) === 265000).length;
    return [berdiskon > 1, `GRATISONGKIR (maks 1x/pengguna), 5 checkout paralel -> ${berdiskon} pesanan mendapat diskon; alasan tolak: ${alasan(hasil)}`];
  });

}

// ===========================================================================
async function main() {
  console.log(`\nKiosKita · harness keamanan · ${BASE} · repo=${REPO}\n`);
  await ujiRegresi();
  if (hasilR[0] && !hasilR[0].ok) {
    console.log(`✗ R-01 gagal (${hasilR[0].rincian}) — stack tidak bisa diuji.`);
    process.exit(1);
  }
  await ujiSerangan();
  await ujiKetahanan();

  console.log('── [R] ALUR SAH ─────────────────────────────────────────────');
  for (const h of hasilR) console.log(`  ${h.ok ? '✔ LULUS ' : '✗ GAGAL '} ${h.id}  ${h.judul}\n            ${h.rincian}`);
  console.log('\n── [S] SERANGAN ─────────────────────────────────────────────');
  for (const h of hasilS) console.log(`  ${h.ok ? '✔ AMAN  ' : '✗ RENTAN'} ${h.id}  ${h.judul}\n            ${h.rincian}`);

  console.log('\n── [K] KETAHANAN KONKURENSI ─────────────────────────────────');
  for (const h of hasilK) console.log(`  ${h.ok ? '✔ TAHAN ' : '✗ BOCOR '} ${h.id}  ${h.judul}\n            ${h.rincian}`);

  const rLulus = hasilR.filter((h) => h.ok).length;
  const sAman = hasilS.filter((h) => h.ok).length;
  const kTahan = hasilK.filter((h) => h.ok).length;
  console.log(`\nRINGKASAN: regresi ${rLulus}/${hasilR.length} LULUS · serangan ${sAman}/${hasilS.length} AMAN · konkurensi ${kTahan}/${hasilK.length} TAHAN`);
  const pass = rLulus === hasilR.length && sAman === hasilS.length && kTahan === hasilK.length;
  console.log(pass ? '✔ PASS' : '✗ FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
