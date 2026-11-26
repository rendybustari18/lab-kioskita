# Laporan Patch Keamanan KiosKita

**Kelompok 2 · Tugas Akhir Secure Coding in the Age of AI · Dadi Mulyadi**
Basis: `main @ eed6011` · Paket: `paket-kioskita-aman-r1` (13 berkas diubah, 5 berkas baru)

| Dokumen | Isi |
|---|---|
| [`threat_model_kioskita.md`](threat_model_kioskita.md) · [`kioskita-mindmap.png`](kioskita-mindmap.png) | Threat model per fitur → ancaman → mitigasi |
| [`../../tests/keamanan/harness-keamanan.ts`](../../tests/keamanan/harness-keamanan.ts) | Harness uji: 12 alur sah, 16 serangan, 2 uji konkurensi |
| [`bukti/`](bukti/) | Log harness sebelum/sesudah, tangkapan layar & JSON uji XSS di Chrome |

## Hasil

| | Regresi (alur sah) | Serangan | Konkurensi |
|---|---|---|---|
| **Sebelum** (`main`) | 12/12 LULUS | **0/16 AMAN** | 2/2 — *kebetulan*, lihat catatan |
| **Sesudah** (patch) | 12/12 LULUS | **16/16 AMAN** | 2/2 TAHAN |

Catatan konkurensi: pada kode lama, nomor pesanan `COUNT(*)+1` bertabrakan saat request paralel,
sehingga sebagian checkout gagal acak dengan `Duplicate entry 'ORD-…'` (pesan SQL ikut bocor ke klien).
Uji [K] karena itu membuktikan patch tahan request paralel, bukan membandingkan sebelum/sesudah.

## Temuan

| ID | Temuan | OWASP 2025 | Tingkat | Berkas |
|---|---|---|---|---|
| KK-01 | Eskalasi peran: `role` dari payload `PUT /api/profile` | A01 | Kritis | `bun-api/src/profile.ts` |
| KK-02 | BOLA: baca & ubah alamat pelanggan lain | A01 | Tinggi | `bun-api/src/address.ts` |
| KK-03 | IDOR detail pesanan — termasuk tanpa login | A01 | Kritis | `php-api/src/orders.php` |
| KK-04 | IDOR faktur (nama, email, telepon, alamat) | A01 | Kritis | `php-api/src/shipments.php` |
| KK-05 | Catatan: baca/tulis lintas pesanan, penyamaran admin, catatan internal bocor | A01 | Tinggi | `php-api/src/orders.php` |
| KK-06 | Stored XSS catatan pesanan (`v-html`) | A05 | Tinggi | `web/src/views/OrderDetail.vue` |
| KK-07 | XSS lewat tautan `/orders?q=` (`v-html`) | A05 | Tinggi | `web/src/views/Orders.vue` |
| KK-08 | Command injection preview label → RCE tanpa login | A05 | Kritis | `php-api/src/label_generator.php` |
| KK-09 | Pembatalan: milik orang lain, sudah terkirim, stok bertambah tiap pembatalan ulang | A06 / A01 | Kritis | `php-api/src/orders.php` |
| KK-10 | Pelanggan membuat resi / menandai "shipped" | A01 | Tinggi | `php-api/src/shipments.php` |
| KK-11 | Checkout: ongkir dari klien, kuantitas negatif, alamat orang lain | A06 | Kritis | `bun-api/src/index.ts` |
| KK-12 | Kupon: batas pemakaian & minimum pembelian tidak ditegakkan | A06 | Tinggi | `index.ts`, `coupons.php` |
| KK-13 | Overselling melebihi stok | A06 | Tinggi | `bun-api/src/index.ts` |
| KK-14 | Dashboard: pesanan terbaru lintas tenant | A01 | Sedang | `bun-api/src/index.ts` |
| KK-15 | Gerbang meneruskan request anonim; PHP fail-open | A01 / A07 | Tinggi | `proxy.ts`, `helpers/auth.php` |
| KK-16 | Galat mentah ke klien; secret JWT cadangan di kode | A02 / A10 | Sedang | `auth.ts`, `index.ts`, `config/db.php` |

Satu pola akar untuk 7 temuan (KK-03/04/05/08/09/10/15): layanan PHP **tidak pernah memeriksa siapa
pemanggilnya** dan mengisi kekosongan identitas dengan tebakan (`role ?? 'customer'`, `author ?: 1`).
Perbaikannya satu gerbang bersama — `php-api/src/helpers/auth.php` — bukan tambalan per endpoint.

## Cara memasang & memverifikasi

```bash
bash paket-kioskita-aman-r1/pasang-kioskita-aman-r1.sh cek    /path/ke/lab-kioskita
bash paket-kioskita-aman-r1/pasang-kioskita-aman-r1.sh pasang /path/ke/lab-kioskita
cd /path/ke/lab-kioskita
docker compose down -v && docker compose up -d --build
bun tests/keamanan/harness-keamanan.ts http://localhost:3000      # exit 0 = PASS
```
`pulihkan` mengembalikan seluruh berkas ke kondisi `main`, diverifikasi dengan SHA-256.

## Perubahan perilaku yang disengaja (Lapis 3 — Regression)

Semua alur sah pada harness tetap lulus. Yang berubah, dan **perlu dikonfirmasi pemilik aturan bisnis**:

1. Pelanggan hanya melihat catatan bertipe `customer`; catatan yang ditulis pelanggan disimpan sebagai `customer`.
2. Checkout hanya untuk peran `customer` (sejalan dengan route `/cart` di web). Ongkir selalu Rp15.000.
3. Kupon yang tidak sah / sudah habis kuotanya **menggagalkan** checkout (dulu diabaikan diam-diam).
4. Pelanggan membatalkan hanya dari `pending`/`confirmed`; staf sampai `processing`. `shipped`/`delivered`/`cancelled` ditolak (409).
5. Pembuatan resi hanya staf/manager/admin, untuk pesanan yang belum dikirim.
6. `GET /api/coupons` hanya admin & manager (endpoint tidak dipakai UI).
7. Preview label: format dari allowlist (`standard`, `thermal_100x150`, `pdf`); `order_id` wajib.
8. `bun-api` menolak start bila `JWT_SECRET` < 32 karakter (nilai di `docker-compose.yml` memenuhi).
9. Dropdown role di halaman Profil menjadi tampilan read-only.

## Risiko tersisa & rekomendasi (di luar cakupan patch)

- **Rotasi `JWT_SECRET`** — nilai di `docker-compose.yml` sudah ter-commit; siapa pun yang membaca repo dapat menandatangani token.
- **Audit data** — peran, stok, dan status yang diubah lewat eksploitasi sebelum patch tidak dipulihkan otomatis.
- Token rahasia antar-layanan Bun → PHP; saat ini kepercayaan `X-User-*` bergantung isolasi jaringan Docker.
- Rate limit login; token di cookie HttpOnly alih-alih `localStorage`; Content-Security-Policy di nginx.
- Nomor pesanan `COUNT(*)+1` bertabrakan pada checkout paralel untuk produk berbeda — masalah ketersediaan, bukan keamanan; usul: nomor dari `id`.
- Panel "Simulasi Akses Objek (Uji BOLA)" di `Profile.vue` — alat lab, kini hanya menghasilkan 404.

## Review tiga lapis

| Lapis | Pertanyaan | Hasil |
|---|---|---|
| Correctness | Akar masalah diperbaiki? Pemilik sah tetap bisa bekerja? | Ya — kepemilikan di server/query; [R] 12/12 |
| Security | Jalur lain (method, endpoint saudara, role) menuju sink yang sama? Fail closed? | Gerbang + `helpers/auth.php` dipakai semua aksi PHP; shell dihapus, bukan di-escape; [S] 16/16, [K] 2/2 |
| Regression | Test baru? Perilaku lain berubah? Dependency naik? | Harness baru; perubahan perilaku didaftar di atas; **tanpa dependency baru** |

**Keputusan: Accept**, dengan catatan bahwa butir 1–5 pada "Perubahan perilaku" adalah aturan bisnis
yang ditetapkan dari perilaku UI dan wajib dikonfirmasi manusia sebelum dianggap final.
