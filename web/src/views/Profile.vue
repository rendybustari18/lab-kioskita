<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">Profil Pengguna &amp; Buku Alamat</h2>
        <p class="page-subtitle">Kelola data akun dan alamat pengiriman Anda</p>
      </div>
    </div>

    <div class="two-col">
      <!-- Kartu Profil -->
      <div class="card">
        <div class="card-header">
          <h3 class="section-title">Informasi Akun</h3>
        </div>

        <div v-if="profileMsg" class="alert alert-success" style="padding: 10px 12px;">
          {{ profileMsg }}
        </div>

        <form @submit.prevent="saveProfile">
          <div class="form-group">
            <label class="form-label">Nama Lengkap:</label>
            <input v-model="profileForm.name" type="text" required />
          </div>

          <div class="form-group">
            <label class="form-label">Email (ID Akun):</label>
            <input v-model="profileForm.email" type="email" disabled />
          </div>

          <div class="form-group">
            <label class="form-label">Nomor Telepon / WA:</label>
            <input v-model="profileForm.phone" type="text" />
          </div>

          <div class="form-group">
            <label class="form-label">Unit Usaha / Tenant:</label>
            <input :value="profileForm.tenant_name" disabled />
          </div>

          <!-- KK-01: peran hanya ditampilkan; perubahan peran bukan wewenang pemilik akun
               (server pun kini mengabaikan field role pada PUT /api/profile). -->
          <div class="form-group">
            <label class="form-label">Role Akun (Hak Akses):</label>
            <input :value="profileForm.role" disabled />
          </div>

          <button type="submit" class="btn btn-primary" :disabled="savingProfile">
            {{ savingProfile ? 'Menyimpan...' : 'Simpan Perubahan Profil' }}
          </button>
        </form>
      </div>

      <!-- Buku Alamat & BOLA Test Section -->
      <div>
        <div class="card">
          <div class="card-header">
            <h3 class="section-title">Buku Alamat Pengiriman</h3>
            <button class="btn btn-outline btn-sm" @click="openAddAddressModal">+ Tambah</button>
          </div>

          <div v-if="addresses.length > 0">
            <div v-for="addr in addresses" :key="addr.id" class="address-card">
              <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 8px;">
                <b>{{ addr.recipient_name }}</b>
                <span class="text-soft" style="font-size: 11px;">(ID: {{ addr.id }})</span>
              </div>
              <div class="text-muted" style="font-size: 13px; margin: 4px 0;">
                {{ addr.address_line }}, {{ addr.city }} {{ addr.postal_code }}
              </div>
              <div class="text-muted" style="font-size: 12px;">Telp: {{ addr.phone }}</div>
              <div style="margin-top: 8px;">
                <button class="btn btn-outline btn-sm" @click="editAddress(addr)">Ubah Alamat</button>
              </div>
            </div>
          </div>
          <div v-else class="empty-state" style="padding: 24px 12px;">
            Belum ada alamat pengiriman terdaftar.
          </div>
        </div>

        <!-- Uji BOLA (Broken Object Level Authorization) -->
        <div class="card" style="border-left: 4px solid var(--color-danger);">
          <h3 class="section-title" style="color: #b91c1c; margin-bottom: 8px;">
            Simulasi Akses Objek (Uji BOLA)
          </h3>
          <p class="text-muted" style="font-size: 12px; margin-bottom: 10px;">
            Coba masukkan ID alamat milik pelanggan lain (misal ID: <code>4</code> milik Joko Widodo atau ID: <code>5</code> milik Dewi Lestari) untuk membaca atau memodifikasi objek tersebut tanpa otorisasi.
          </p>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            <input v-model.number="targetBolaId" type="number" placeholder="ID Alamat Target (e.g. 4)" style="width: 170px;" />
            <button class="btn btn-danger btn-sm" @click="fetchBolaAddress">Akses Objek Target</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Edit / Add Alamat -->
    <div v-if="showAddrModal" class="modal-overlay">
      <div class="modal" style="max-width: 500px;">
        <div class="modal-header">
          <h3 class="modal-title">
            {{ editingAddrId ? `Ubah Alamat (ID Objek: ${editingAddrId})` : 'Tambah Alamat Baru' }}
          </h3>
          <button class="icon-btn" type="button" aria-label="Tutup" @click="showAddrModal = false">
            <NavIcon name="close" />
          </button>
        </div>

        <form @submit.prevent="saveAddress">
          <div class="form-group">
            <label class="form-label">Nama Penerima:</label>
            <input v-model="addrForm.recipient_name" type="text" required />
          </div>

          <div class="form-group">
            <label class="form-label">Nomor Telepon:</label>
            <input v-model="addrForm.phone" type="text" required />
          </div>

          <div class="form-group">
            <label class="form-label">Alamat Lengkap:</label>
            <textarea v-model="addrForm.address_line" required rows="2"></textarea>
          </div>

          <div class="form-grid form-grid-2 form-group">
            <div>
              <label class="form-label">Kota:</label>
              <input v-model="addrForm.city" type="text" required />
            </div>
            <div>
              <label class="form-label">Kode Pos:</label>
              <input v-model="addrForm.postal_code" type="text" required />
            </div>
          </div>

          <div class="form-actions">
            <button type="button" class="btn btn-outline btn-sm" @click="showAddrModal = false">Batal</button>
            <button type="submit" class="btn btn-primary btn-sm">Simpan Alamat</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { apiFetch, setCurrentUser, setToken } from '../api';
import NavIcon from '../components/NavIcon.vue';

const profileForm = ref<any>({});
const addresses = ref<any[]>([]);
const profileMsg = ref('');
const savingProfile = ref(false);

const showAddrModal = ref(false);
const editingAddrId = ref<number | null>(null);
const addrForm = ref<any>({});
const targetBolaId = ref<number | null>(4);

async function loadProfile() {
  try {
    const res = await apiFetch('/profile');
    if (res.success && res.profile) {
      profileForm.value = { ...res.profile };
    }
  } catch (err) {
    console.error(err);
  }
}

async function loadAddresses() {
  try {
    const res = await apiFetch('/addresses');
    if (res.success && res.data) {
      addresses.value = res.data;
    }
  } catch (err) {
    console.error(err);
  }
}

async function saveProfile() {
  savingProfile.value = true;
  profileMsg.value = '';
  try {
    const res = await apiFetch('/profile', {
      method: 'PUT',
      body: JSON.stringify(profileForm.value),
    });

    if (res.success && res.profile) {
      profileMsg.value = `Profil berhasil diperbarui. Role Anda sekarang: ${res.profile.role}`;
      setCurrentUser(res.profile);
      if (res.token) setToken(res.token);
      window.dispatchEvent(new Event('user-updated'));
    } else {
      alert(`Gagal: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  } finally {
    savingProfile.value = false;
  }
}

function openAddAddressModal() {
  editingAddrId.value = null;
  addrForm.value = { recipient_name: '', phone: '', address_line: '', city: '', postal_code: '' };
  showAddrModal.value = true;
}

function editAddress(addr: any) {
  editingAddrId.value = addr.id;
  addrForm.value = { ...addr };
  showAddrModal.value = true;
}

async function fetchBolaAddress() {
  if (!targetBolaId.value) return;
  try {
    const res = await apiFetch(`/addresses/${targetBolaId.value}`);
    if (res.success && res.data) {
      alert(`[BOLA SUKSES] Data alamat ID #${targetBolaId.value} berhasil diakses:\nPenerima: ${res.data.recipient_name}\nAlamat: ${res.data.address_line}, ${res.data.city}`);
      editingAddrId.value = res.data.id;
      addrForm.value = { ...res.data };
      showAddrModal.value = true;
    } else {
      alert(`Gagal mengakses objek: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  }
}

async function saveAddress() {
  try {
    let res: any;
    if (editingAddrId.value) {
      res = await apiFetch(`/addresses/${editingAddrId.value}`, {
        method: 'PUT',
        body: JSON.stringify(addrForm.value),
      });
    } else {
      res = await apiFetch('/addresses', {
        method: 'POST',
        body: JSON.stringify(addrForm.value),
      });
    }

    if (res.success) {
      alert(res.message || 'Alamat berhasil disimpan');
      showAddrModal.value = false;
      await loadAddresses();
    } else {
      alert(`Gagal menyimpan: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  }
}

onMounted(() => {
  loadProfile();
  loadAddresses();
});
</script>
