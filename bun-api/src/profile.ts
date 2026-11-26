import { extractAuthUser, generateToken } from './auth';
import pool from './db';

// Handler Profil Pengguna
export async function handleGetProfile(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak: belum terautentikasi' }, { status: 401 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.phone, t.name as tenant_name
     FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE u.id = ?`,
    [currentUser.id]
  );

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Profil tidak ditemukan' }, { status: 404 });
  }

  return Response.json({ success: true, profile: rows[0] });
}

// KK-01: update profil hanya menulis field yang ada di allowlist (name, phone).
// Field lain dari payload — role, tenant_id, email — diabaikan secara desain, bukan divalidasi:
// peran hanya boleh diubah administrator lewat endpoint administratif.
export async function handleUpdateProfile(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Akses ditolak: belum terautentikasi' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }

  // String kosong = "tidak diubah" (perilaku lama dipertahankan lewat COALESCE).
  const name = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : null;
  const phone = typeof body?.phone === 'string' && body.phone.trim() !== '' ? body.phone.trim() : null;

  if (name !== null && name.length > 150) {
    return Response.json({ success: false, error: 'Nama maksimal 150 karakter' }, { status: 400 });
  }
  if (phone !== null && !/^[0-9+\-\s]{6,30}$/.test(phone)) {
    return Response.json({ success: false, error: 'Format nomor telepon tidak valid' }, { status: 400 });
  }

  try {
    await pool.query(
      `UPDATE users
       SET name = COALESCE(?, name),
           phone = COALESCE(?, phone)
       WHERE id = ?`,
      [name, phone, currentUser.id]
    );

    // Ambil data terbaru setelah pembaruan
    const [rows] = await pool.query<any[]>(
      `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.phone, t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.id = ?`,
      [currentUser.id]
    );

    const updatedUser = rows[0];
    const newToken = generateToken(updatedUser);

    return Response.json({
      success: true,
      message: 'Profil berhasil diperbarui',
      profile: updatedUser,
      token: newToken,
    });
  } catch (error: any) {
    console.error('[profile] update gagal:', error);
    return Response.json({ success: false, error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}
