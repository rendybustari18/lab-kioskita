import { extractAuthUser } from './auth';
import pool from './db';

const MAKS = { recipient_name: 150, phone: 30, address_line: 500, city: 100, postal_code: 20 } as const;

/** null = field tidak dikirim / kosong; undefined tidak pernah sampai ke query. */
function teks(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function cekPanjang(data: Record<string, string | null>): string | null {
  for (const [k, maks] of Object.entries(MAKS)) {
    const v = data[k];
    if (v !== null && v !== undefined && v.length > maks) return `${k} maksimal ${maks} karakter`;
  }
  return null;
}

// Handler Manajemen Alamat Pengiriman
export async function handleListAddresses(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC`,
    [currentUser.id]
  );

  return Response.json({ success: true, data: rows });
}

// KK-02: kepemilikan ditegakkan DI DALAM query (id + user_id). Alamat orang lain
// diperlakukan sama dengan alamat yang tidak ada (404), agar keberadaan ID tidak terkonfirmasi.
export async function handleGetAddressById(req: Request, addressId: number): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT * FROM addresses WHERE id = ? AND user_id = ?`,
    [addressId, currentUser.id]
  );

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Alamat tidak ditemukan' }, { status: 404 });
  }

  return Response.json({ success: true, data: rows[0] });
}

// KK-02: UPDATE hanya mengenai baris milik pemanggil; baca-balik juga disaring pemilik.
export async function handleUpdateAddress(req: Request, addressId: number): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }

  const data = {
    recipient_name: teks(body?.recipient_name),
    phone: teks(body?.phone),
    address_line: teks(body?.address_line),
    city: teks(body?.city),
    postal_code: teks(body?.postal_code),
  };
  const salah = cekPanjang(data);
  if (salah) return Response.json({ success: false, error: salah }, { status: 400 });
  const isDefault = typeof body?.is_default === 'boolean' || typeof body?.is_default === 'number'
    ? (body.is_default ? 1 : 0) : null;

  try {
    const [milik] = await pool.query<any[]>(
      `SELECT id FROM addresses WHERE id = ? AND user_id = ?`,
      [addressId, currentUser.id]
    );
    if (milik.length === 0) {
      return Response.json({ success: false, error: 'Alamat tidak ditemukan' }, { status: 404 });
    }

    await pool.query(
      `UPDATE addresses
       SET recipient_name = COALESCE(?, recipient_name),
           phone = COALESCE(?, phone),
           address_line = COALESCE(?, address_line),
           city = COALESCE(?, city),
           postal_code = COALESCE(?, postal_code),
           is_default = COALESCE(?, is_default)
       WHERE id = ? AND user_id = ?`,
      [data.recipient_name, data.phone, data.address_line, data.city, data.postal_code, isDefault, addressId, currentUser.id]
    );

    const [rows] = await pool.query<any[]>(
      `SELECT * FROM addresses WHERE id = ? AND user_id = ?`,
      [addressId, currentUser.id]
    );

    return Response.json({
      success: true,
      message: 'Alamat berhasil diperbarui',
      data: rows[0],
    });
  } catch (error: any) {
    console.error('[address] update gagal:', error);
    return Response.json({ success: false, error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

export async function handleCreateAddress(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }

  const data = {
    recipient_name: teks(body?.recipient_name),
    phone: teks(body?.phone),
    address_line: teks(body?.address_line),
    city: teks(body?.city),
    postal_code: teks(body?.postal_code),
  };
  if (Object.values(data).some((v) => v === null)) {
    return Response.json({ success: false, error: 'Seluruh field alamat wajib diisi' }, { status: 400 });
  }
  const salah = cekPanjang(data);
  if (salah) return Response.json({ success: false, error: salah }, { status: 400 });

  try {
    const [result] = await pool.query<any>(
      `INSERT INTO addresses (user_id, recipient_name, phone, address_line, city, postal_code, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [currentUser.id, data.recipient_name, data.phone, data.address_line, data.city, data.postal_code, body?.is_default ? 1 : 0]
    );

    return Response.json({
      success: true,
      message: 'Alamat berhasil ditambahkan',
      address_id: result.insertId,
    });
  } catch (error: any) {
    console.error('[address] create gagal:', error);
    return Response.json({ success: false, error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
