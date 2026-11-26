import jwt from 'jsonwebtoken';
import pool from './db';

// KK-16: tidak ada secret cadangan di kode. Nilai lama ikut ter-commit di repo, sehingga siapa pun
// bisa menandatangani token sah. Tanpa JWT_SECRET yang memadai, layanan menolak start (fail closed).
const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET wajib di-set lewat environment (minimal 32 karakter)');
}

const PERAN_SAH = ['admin', 'manager', 'staff', 'customer'] as const;

export interface UserPayload {
  id: number;
  tenant_id: number;
  name: string;
  email: string;
  role: 'admin' | 'manager' | 'staff' | 'customer';
  phone?: string;
  tenant_name?: string;
}

export function generateToken(user: UserPayload): string {
  return jwt.sign(
    {
      id: user.id,
      tenant_id: user.tenant_id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      tenant_name: user.tenant_name,
    },
    JWT_SECRET,
    { expiresIn: '24h', algorithm: 'HS256' }
  );
}

export function verifyToken(token: string): UserPayload | null {
  try {
    // Algoritma dipin: token dengan alg lain ditolak walau tanda tangannya "cocok".
    const p = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] }) as UserPayload;
    // Bentuk klaim divalidasi sebelum dipakai sebagai identitas (diteruskan ke PHP lewat X-User-*).
    if (!Number.isInteger(p?.id) || !Number.isInteger(p?.tenant_id) || !PERAN_SAH.includes(p?.role as any)) {
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function extractAuthUser(req: Request): UserPayload | null {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyToken(token);
}

export async function handleLogin(req: Request): Promise<Response> {
  let body: any;
  try {
    body = await req.json();
  } catch {
    // KK-16: galat parser tidak diteruskan ke klien.
    return Response.json({ success: false, error: 'Format permintaan tidak valid' }, { status: 400 });
  }

  try {
    const { email, password } = body ?? {};

    if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
      return Response.json({ success: false, error: 'Email dan password wajib diisi' }, { status: 400 });
    }

    const [rows] = await pool.query<any[]>(
      `SELECT u.*, t.name as tenant_name
       FROM users u
       JOIN tenants t ON u.tenant_id = t.id
       WHERE u.email = ?`,
      [email]
    );

    if (rows.length === 0) {
      return Response.json({ success: false, error: 'Kredensial login tidak valid' }, { status: 401 });
    }

    const user = rows[0];
    const isPasswordValid = await Bun.password.verify(password, user.password);

    if (!isPasswordValid) {
      return Response.json({ success: false, error: 'Kredensial login tidak valid' }, { status: 401 });
    }

    const payload: UserPayload = {
      id: user.id,
      tenant_id: user.tenant_id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      tenant_name: user.tenant_name,
    };

    const token = generateToken(payload);

    return Response.json({
      success: true,
      message: 'Login berhasil',
      token,
      user: payload,
    });
  } catch (error: any) {
    console.error('[auth] login gagal:', error);
    return Response.json({ success: false, error: 'Terjadi kesalahan pada server' }, { status: 500 });
  }
}

export async function handleGetMe(req: Request): Promise<Response> {
  const currentUser = extractAuthUser(req);
  if (!currentUser) {
    return Response.json({ success: false, error: 'Sesi tidak valid atau telah berakhir' }, { status: 401 });
  }

  const [rows] = await pool.query<any[]>(
    `SELECT u.id, u.tenant_id, u.name, u.email, u.role, u.phone, t.name as tenant_name
     FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE u.id = ?`,
    [currentUser.id]
  );

  if (rows.length === 0) {
    return Response.json({ success: false, error: 'Pengguna tidak ditemukan' }, { status: 404 });
  }

  return Response.json({ success: true, user: rows[0] });
}
