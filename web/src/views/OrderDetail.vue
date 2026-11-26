<template>
  <div>
    <div class="page-header">
      <div>
        <router-link to="/orders" class="text-muted" style="font-size: 13px;">
          &larr; Kembali ke Daftar Pesanan
        </router-link>
        <h2 class="page-title" style="margin-top: 6px;">
          Detail Pesanan: {{ order?.order_number }}
        </h2>
      </div>
      <div class="no-print" style="display: flex; gap: 8px; flex-wrap: wrap;">
        <router-link :to="`/invoices/${orderId}`" class="btn btn-outline btn-sm">Lihat Faktur</router-link>
        <button class="btn btn-outline btn-sm" @click="showLabelModal = true">Preview Label Kirim</button>
        <button
          v-if="order && order.status !== 'cancelled'"
          class="btn btn-danger btn-sm"
          @click="cancelOrder"
        >
          Batalkan Pesanan
        </button>
      </div>
    </div>

    <div v-if="loading" class="loading-state">Memuat data pesanan...</div>
    <div v-else-if="order">
      <!-- Status & Metadata Card -->
      <div class="card">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 18px;">
          <div>
            <span class="stat-label">Status Saat Ini</span>
            <div style="margin-top: 6px;">
              <span class="badge" :class="statusBadge(order.status)">{{ order.status }}</span>
            </div>
          </div>
          <div>
            <span class="stat-label">Pelanggan Pemilik</span>
            <div style="font-weight: 600; margin-top: 6px;">{{ order.customer_name }}</div>
            <div class="text-muted" style="font-size: 12px;">{{ order.customer_email }}</div>
          </div>
          <div>
            <span class="stat-label">Unit Usaha / Tenant</span>
            <div style="font-weight: 600; margin-top: 6px;">{{ order.tenant_name }}</div>
          </div>
          <div>
            <span class="stat-label">Waktu Pemesanan</span>
            <div style="font-size: 13px; margin-top: 6px;">{{ order.created_at }}</div>
          </div>
        </div>
      </div>

      <!-- Item Produk -->
      <div class="card">
        <div class="card-header">
          <h3 class="section-title">Rincian Barang yang Dipesan</h3>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>SKU</th>
                <th>Nama Produk</th>
                <th>Kategori</th>
                <th>Harga Satuan</th>
                <th>Jumlah</th>
                <th>Subtotal</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in order.items" :key="item.id">
                <td class="mono">{{ item.sku }}</td>
                <td><b>{{ item.product_name }}</b></td>
                <td><span class="badge badge-secondary">{{ item.category }}</span></td>
                <td>Rp {{ Number(item.unit_price).toLocaleString('id-ID') }}</td>
                <td>{{ item.quantity }}</td>
                <td>Rp {{ Number(item.total_price).toLocaleString('id-ID') }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Ringkasan Biaya -->
        <div style="max-width: 350px; margin-left: auto; margin-top: 16px; border-top: 1px solid var(--color-border); padding-top: 12px;">
          <div class="summary-row" style="font-size: 13px;">
            <span class="label">Subtotal:</span>
            <span>Rp {{ Number(order.subtotal).toLocaleString('id-ID') }}</span>
          </div>
          <div v-if="order.discount > 0" class="summary-row" style="font-size: 13px; color: var(--color-success);">
            <span>Diskon ({{ order.coupon_code }}):</span>
            <span>- Rp {{ Number(order.discount).toLocaleString('id-ID') }}</span>
          </div>
          <div class="summary-row" style="font-size: 13px;">
            <span class="label">Ongkos Kirim:</span>
            <span>Rp {{ Number(order.shipping_cost).toLocaleString('id-ID') }}</span>
          </div>
          <div class="summary-total" style="font-size: 16px;">
            <span>Total Akhir:</span>
            <span class="amount">Rp {{ Number(order.grand_total).toLocaleString('id-ID') }}</span>
          </div>
        </div>
      </div>

      <!-- Alamat Pengiriman -->
      <div class="card">
        <div class="card-header">
          <h3 class="section-title">Tujuan Pengiriman</h3>
        </div>
        <p style="margin: 0; font-size: 14px;">
          Penerima: <b>{{ order.recipient_name }}</b> (Telp: {{ order.shipping_phone }})<br />
          <span class="text-muted">
            Alamat: {{ order.address_line }}, {{ order.city }} {{ order.postal_code }}
          </span>
        </p>
      </div>

      <!-- Catatan Pesanan (KK-05/06: dirender sebagai teks; pelanggan hanya melihat catatan 'customer') -->
      <div class="card">
        <div class="card-header">
          <h3 class="section-title">Catatan Internal Gudang &amp; Operasional</h3>
        </div>

        <div v-if="notes.length > 0">
          <div v-for="n in notes" :key="n.id" class="note-box">
            <div class="text-muted" style="display: flex; justify-content: space-between; gap: 10px; font-size: 12px; margin-bottom: 4px;">
              <span><b>{{ n.author_name }}</b> ({{ n.author_role }})</span>
              <span>{{ n.created_at }}</span>
            </div>
            <!-- KK-06: konten catatan adalah data pengguna -> dirender sebagai TEKS ({{ }} di-escape Vue).
                 pre-wrap menjaga baris baru yang dulu bergantung pada HTML mentah. -->
            <div class="note-content" style="white-space: pre-wrap;">{{ n.content }}</div>
          </div>
        </div>
        <div v-else class="text-soft" style="font-size: 13px; margin-bottom: 14px;">
          Belum ada catatan internal untuk pesanan ini.
        </div>

        <form @submit.prevent="submitNote" style="margin-top: 16px; border-top: 1px solid var(--color-border); padding-top: 14px;">
          <label class="form-label">Tambah Catatan Baru:</label>
          <textarea
            v-model="newNoteContent"
            placeholder="Masukkan catatan penanganan barang atau instruksi gudang..."
            required
            rows="2"
            style="margin-bottom: 10px;"
          ></textarea>
          <button type="submit" class="btn btn-outline btn-sm" :disabled="submittingNote">
            Simpan Catatan
          </button>
        </form>
      </div>
    </div>

    <!-- Modal Preview Label Pengiriman (KK-08: format & kurir divalidasi server, tanpa shell) -->
    <div v-if="showLabelModal" class="modal-overlay">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Preview Label Pengiriman (CLI Engine)</h3>
          <button class="icon-btn" type="button" aria-label="Tutup" @click="showLabelModal = false">
            <NavIcon name="close" />
          </button>
        </div>

        <div class="form-group">
          <label class="form-label">Kurir:</label>
          <select v-model="labelCourier">
            <option value="JNE Reguler">JNE Reguler</option>
            <option value="SiCepat BEST">SiCepat BEST</option>
            <option value="J&amp;T Express">J&amp;T Express</option>
            <option value="AnterAja Reguler">AnterAja Reguler</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Format / Template Label:</label>
          <input v-model="labelFormat" type="text" placeholder="standard / thermal_100x150" />
          <div class="form-hint">Parameter ini diproses oleh shell engine pengirim label.</div>
        </div>

        <button class="btn btn-primary btn-sm" @click="generateLabelPreview" :disabled="generatingLabel">
          {{ generatingLabel ? 'Memproses di Server...' : 'Generate Preview' }}
        </button>

        <div v-if="labelOutput" style="margin-top: 16px;">
          <label class="form-label">Output Hasil Label CLI:</label>
          <pre style="background: #0f172a; color: #7dd3fc; padding: 12px; border-radius: 8px; font-size: 12px; overflow-x: auto; max-height: 200px; margin: 0;">{{ labelOutput }}</pre>
        </div>

        <div class="modal-footer">
          <button class="btn btn-outline btn-sm" @click="showLabelModal = false">Tutup</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../api';
import NavIcon from '../components/NavIcon.vue';

const route = useRoute();
const orderId = ref(route.params.id);
const order = ref<any>(null);
const notes = ref<any[]>([]);
const newNoteContent = ref('');
const loading = ref(true);
const submittingNote = ref(false);

const showLabelModal = ref(false);
const labelCourier = ref('JNE Reguler');
const labelFormat = ref('standard');
const generatingLabel = ref(false);
const labelOutput = ref('');

async function fetchOrderDetail() {
  loading.value = true;
  try {
    const res = await apiFetch(`/orders/${orderId.value}`);
    if (res.success && res.data) {
      order.value = res.data;
    }
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

async function fetchNotes() {
  try {
    const res = await apiFetch(`/orders/${orderId.value}/notes`);
    if (res.success && res.data) {
      notes.value = res.data;
    }
  } catch (err) {
    console.error(err);
  }
}

async function submitNote() {
  if (!newNoteContent.value.trim()) return;
  submittingNote.value = true;
  try {
    const res = await apiFetch('/orders/notes', {
      method: 'POST',
      body: JSON.stringify({
        order_id: orderId.value,
        content: newNoteContent.value,
        note_type: 'internal',
      }),
    });

    if (res.success) {
      newNoteContent.value = '';
      await fetchNotes();
    } else {
      alert(`Gagal menambah catatan: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  } finally {
    submittingNote.value = false;
  }
}

async function cancelOrder() {
  if (!confirm(`Apakah Anda yakin ingin membatalkan pesanan #${orderId.value}?`)) return;
  try {
    const res = await apiFetch(`/orders/${orderId.value}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ order_id: orderId.value }),
    });

    if (res.success) {
      alert(res.message);
      await fetchOrderDetail();
    } else {
      alert(`Gagal membatalkan pesanan: ${res.error}`);
    }
  } catch (err: any) {
    alert(`Error: ${err.message}`);
  }
}

async function generateLabelPreview() {
  generatingLabel.value = true;
  labelOutput.value = '';
  try {
    const res = await apiFetch('/labels/preview', {
      method: 'POST',
      body: JSON.stringify({
        order_id: orderId.value,
        courier: labelCourier.value,
        format: labelFormat.value,
      }),
    });

    if (res.success) {
      labelOutput.value = res.preview || 'Berhasil diproses, tidak ada output.';
    } else {
      labelOutput.value = `Gagal: ${res.error}`;
    }
  } catch (err: any) {
    labelOutput.value = `Exception: ${err.message}`;
  } finally {
    generatingLabel.value = false;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case 'delivered': return 'badge-primary';
    case 'shipped': return 'badge-info';
    case 'processing': return 'badge-warning';
    case 'cancelled': return 'badge-danger';
    default: return 'badge-secondary';
  }
}

onMounted(() => {
  fetchOrderDetail();
  fetchNotes();
});
</script>
