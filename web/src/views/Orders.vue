<template>
  <div>
    <div class="page-header">
      <div>
        <h2 class="page-title">Riwayat &amp; Manajemen Pesanan</h2>
        <p class="page-subtitle">Pantau status distribusi barang dan riwayat pembelian</p>
      </div>
      <div>
        <router-link to="/catalog" class="btn btn-primary">
          <NavIcon name="plus" /> Buat Pesanan Baru
        </router-link>
      </div>
    </div>

    <!-- Filter & Pencarian Pesanan -->
    <div class="card filter-bar" style="margin-bottom: 16px;">
      <div class="filter-grow">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Cari berdasarkan No. Pesanan atau nama pelanggan..."
          @input="fetchOrders"
        />
      </div>
      <div class="filter-shrink">
        <select v-model="statusFilter" @change="fetchOrders">
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>
    </div>

    <!-- KK-07: kata kunci adalah input pengguna -> markup tetap di template, nilai lewat {{ }} (di-escape). -->
    <div v-if="searchQuery" class="alert alert-info">
      <span>Hasil pencarian pesanan untuk kata kunci: <b>{{ searchQuery }}</b></span>
    </div>

    <!-- Tabel Pesanan -->
    <div class="card">
      <div v-if="loading" class="loading-state">Memuat data pesanan...</div>
      <div v-else-if="orders.length > 0" class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>No. Pesanan</th>
              <th>Pelanggan</th>
              <th>Organisasi</th>
              <th>Status</th>
              <th>Total</th>
              <th>Waktu</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="ord in orders" :key="ord.id">
              <td>#{{ ord.id }}</td>
              <td><b>{{ ord.order_number }}</b></td>
              <td>{{ ord.customer_name }}</td>
              <td><span class="badge badge-secondary">{{ ord.tenant_name }}</span></td>
              <td><span class="badge" :class="statusBadge(ord.status)">{{ ord.status }}</span></td>
              <td>Rp {{ Number(ord.grand_total).toLocaleString('id-ID') }}</td>
              <td class="text-muted" style="font-size: 12px;">{{ ord.created_at }}</td>
              <td>
                <div style="display: flex; gap: 6px;">
                  <router-link :to="`/orders/${ord.id}`" class="btn btn-outline btn-sm">Detail</router-link>
                  <router-link :to="`/invoices/${ord.id}`" class="btn btn-outline btn-sm">Faktur</router-link>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div v-else class="empty-state">Tidak ada pesanan yang sesuai dengan filter.</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { apiFetch } from '../api';
import NavIcon from '../components/NavIcon.vue';

const route = useRoute();
const orders = ref<any[]>([]);
const searchQuery = ref((route.query.q as string) || '');
const statusFilter = ref('');
const loading = ref(true);

async function fetchOrders() {
  loading.value = true;
  try {
    const q = new URLSearchParams();
    if (searchQuery.value) q.set('search', searchQuery.value);
    if (statusFilter.value) q.set('status', statusFilter.value);

    const res = await apiFetch(`/orders?${q.toString()}`);
    if (res.success && res.data) {
      orders.value = res.data;
    }
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
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
  fetchOrders();
});
</script>
