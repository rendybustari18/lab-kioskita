# Threat Model: KiosKita — Sistem Manajemen Pesanan & Gudang Distribusi

> Kelompok 2 · Tugas Akhir Secure Coding in the Age of AI · disusun oleh Dadi Mulyadi
> Penanda mitigasi: **[DITERAPKAN]** = ada di patch dan dibuktikan harness;
> **[REKOMENDASI]** = di luar cakupan patch ini, dicatat untuk tindak lanjut.
> ID **KK-xx** merujuk ke daftar temuan pada laporan dan `tests/keamanan/harness-keamanan.ts`.

## 1. Login / Autentikasi (Bun BFF · `auth.ts`)
### Kebocoran informasi lewat pesan galat (KK-16)
#### [DITERAPKAN] Pesan galat generik ke klien, detail hanya ke log server
#### [DITERAPKAN] Body JSON rusak dijawab 400, bukan 500 berisi pesan parser
### Secret JWT cadangan tertulis di kode (KK-16)
#### [DITERAPKAN] Tanpa fallback — layanan menolak start bila JWT_SECRET < 32 karakter
#### [DITERAPKAN] Algoritma dipin ke HS256 dan bentuk klaim token divalidasi
#### [REKOMENDASI] Rotasi JWT_SECRET; nilai di docker-compose.yml sudah ter-commit ke repo
### Brute force / password guessing
#### [REKOMENDASI] Rate limit per akun & per IP, penguncian sementara
#### [REKOMENDASI] MFA untuk peran admin dan manager
### Token tersimpan di localStorage
#### [REKOMENDASI] Cookie HttpOnly + SameSite; sampai saat itu, XSS = pencurian token (lihat 7 & 10)

## 2. Profil (`PUT /api/profile`)
### Privilege escalation: peran diambil dari payload klien (KK-01)
#### [DITERAPKAN] Allowlist field — hanya name & phone yang ditulis; role/tenant_id/email diabaikan
#### [DITERAPKAN] Dropdown role di halaman Profil diganti tampilan read-only
#### [REKOMENDASI] Audit tabel users: peran hasil eksploitasi sebelum patch tidak ikut dipulihkan

## 3. Buku Alamat (`/api/addresses/:id`)
### BOLA: membaca alamat pelanggan lain (KK-02)
#### [DITERAPKAN] Kepemilikan di dalam query — `WHERE id = ? AND user_id = ?`
### BOLA: mengubah alamat pelanggan lain (KK-02)
#### [DITERAPKAN] UPDATE dan baca-balik disaring pemilik; milik orang lain = 404

## 4. Keranjang & Checkout (`POST /api/cart/checkout`)
### Ganti harga: ongkir dikirim klien (KK-11)
#### [DITERAPKAN] Ongkir tarif tetap server (Rp15.000); `shipping_cost` dari klien diabaikan
### Kuantitas negatif / nol / pecahan (KK-11)
#### [DITERAPKAN] Kuantitas wajib bilangan bulat 1–100
### Alamat pengiriman milik orang lain (KK-11)
#### [DITERAPKAN] Alamat wajib milik pemesan
### Overselling melebihi stok (KK-13)
#### [DITERAPKAN] Cek stok + pengurangan bersyarat `WHERE stock >= ?` di dalam transaksi
### Race condition — "kalo stok tinggal 1"
#### [DITERAPKAN] `SELECT … FOR UPDATE` urut id (bebas deadlock); dibuktikan uji paralel K-01

## 5. Kupon (`/api/coupons/*` + checkout)
### Kupon sekali-pakai dipakai berulang (KK-12)
#### [DITERAPKAN] Batas `max_uses_per_user` diperiksa di verifikasi DAN checkout
#### [DITERAPKAN] Pemakaian dicatat ke `coupon_usages` (dulu tidak pernah ditulis)
### Minimum pembelian dilewati (KK-12)
#### [DITERAPKAN] Minimum diperiksa atas subtotal hitungan server saat checkout
### Race condition — double claim
#### [DITERAPKAN] Baris kupon dikunci `FOR UPDATE`; dibuktikan uji paralel K-02
### Daftar seluruh kupon terbuka tanpa login (KK-15)
#### [DITERAPKAN] Hanya admin & manager (endpoint tidak dipakai UI)

## 6. Pesanan (`/api/orders/*` → `orders.php`)
### IDOR: melihat pesanan pelanggan/tenant lain, bahkan tanpa login (KK-03)
#### [DITERAPKAN] Cek kepemilikan di server sebelum data dikembalikan (`loadOrderForUser`)
#### [DITERAPKAN] Milik orang lain dijawab 404, bukan 403 — ID tidak terkonfirmasi
### Membatalkan pesanan orang lain (KK-09)
#### [DITERAPKAN] Pembatalan melewati gerbang kepemilikan yang sama
### Membatalkan pesanan yang sudah dikirim / diterima (KK-09)
#### [DITERAPKAN] Hanya dari status pending/confirmed (pelanggan) atau s.d. processing (staf)
### Pembatalan berulang menggelembungkan stok (KK-09)
#### [DITERAPKAN] Transisi bersyarat dalam transaksi — stok dikembalikan tepat sekali

## 7. Catatan Pesanan (`/api/orders/notes`)
### Stored XSS — konten dirender `v-html` (KK-06)
#### [DITERAPKAN] Encode on output: `{{ n.content }}`, bukan `v-html`
#### [REKOMENDASI] Content-Security-Policy di nginx sebagai lapis kedua
### Menulis catatan tanpa login, atas nama admin #1 (KK-05)
#### [DITERAPKAN] Penulis = pemanggil terautentikasi; tanpa identitas = 401
### Catatan internal gudang terbaca pelanggan (KK-05)
#### [DITERAPKAN] Pelanggan hanya melihat & menulis catatan bertipe `customer`

## 8. Pengiriman, Faktur & Label (`shipments.php`, `label_generator.php`)
### IDOR faktur — nama, email, telepon, alamat (KK-04)
#### [DITERAPKAN] Gerbang kepemilikan yang sama dengan detail pesanan
### Pelanggan membuat resi / menandai "shipped" (KK-10)
#### [DITERAPKAN] Hanya staf/manager/admin, untuk pesanan tenant-nya, dari status belum dikirim
### Command injection pada preview label → RCE (KK-08)
#### [DITERAPKAN] `shell_exec` dihapus — teks label dirangkai di PHP
#### [DITERAPKAN] Allowlist format (standard, thermal_100x150, pdf) dan karakter nama kurir
#### [DITERAPKAN] Wajib login + kepemilikan pesanan (label memuat alamat pelanggan)

## 9. Dashboard (`/api/dashboard/stats`)
### Pesanan terbaru lintas tenant terlihat staf/manager (KK-14)
#### [DITERAPKAN] Cakupan recent_orders disamakan dengan cakupan angka statistik

## 10. Pencarian Pesanan (`Orders.vue`)
### XSS lewat tautan `/orders?q=<payload>` (KK-07)
#### [DITERAPKAN] Markup di template, nilai lewat `{{ searchQuery }}`

## 11. Arsitektur: Gerbang Bun ↔ Layanan PHP Legacy
### Request anonim diteruskan ke PHP (KK-15)
#### [DITERAPKAN] Gerbang menolak 401 sebelum meneruskan
### PHP fail-open — peran dianggap "customer", penulis dianggap admin (KK-15)
#### [DITERAPKAN] Identitas wajib & tervalidasi; hilang/tidak sah = 401 (fail closed)
### PHP mempercayai header X-User-* dari siapa pun yang menjangkaunya
#### [DITERAPKAN] Header dibangun ulang oleh gerbang; header kiriman klien tidak diteruskan
#### [REKOMENDASI] Token rahasia antar-layanan; saat ini bergantung isolasi jaringan Docker

## 12. Source Code
### Apakah ada komentar sensitif?
#### Ya — komentar menjelaskan letak celah ("Celah IDOR…", "tanpa escapeshellarg"); seed menyebut kata sandi dummy
#### [DITERAPKAN] Komentar penunjuk celah di kode backend & OrderDetail.vue diganti penjelasan mitigasi
#### [REKOMENDASI] Hapus panel "Simulasi Akses Objek (Uji BOLA)" di Profile.vue — alat lab, kini hanya menghasilkan 404
#### [REKOMENDASI] Seed & kredensial dummy tidak ikut ke lingkungan non-lab
