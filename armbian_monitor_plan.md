RENCANA PEMBANGUNAN PROYEK: ARMBIAN SERVER MONITOR (FULL-STACK JS + SQLITE)Dioptimalkan untuk Agen AI / Vibe Coding (Hemat Token & Presisi Tinggi)

BAGIAN 1: ATURAN UTAMA AGEN (TOKEN-SAVING RULES)Semua Agen AI wajib mematuhi aturan di bawah ini sebelum membaca atau memodifikasi kode.
- Model Respons RingkasAgen dilarang menulis ulang seluruh file jika hanya melakukan perubahan kecil.
- Gunakan format pencarian-dan-ganti (Search & Replace) atau tunjukkan segmen yang berubah saja dalam blok kode yang ringkas.Hindari penjelasan teori yang panjang lebar.
- Berikan penjelasan maksimal 2 kalimat mengenai apa yang diubah dan mengapa.
- Struktur Head Comment pada Setiap BerkasSetiap berkas kode wajib diawali dengan deskripsi kepala (Head Comment) dengan format standar berikut:
/**
 * @file: [Nama Berkas]
 * @description: [Deskripsi singkat fungsi berkas]
 * @dependencies: [Daftar package utama yang diimpor]
 * @state: [Stable / Under Construction / Refactoring]
 * @last_updated: [Tanggal & Versi]
 */
3. Segmentasi Kode & Pembatas Fungsi (Code Wrapping)Untuk memudahkan Agen menargetkan fungsi tertentu tanpa membaca seluruh isi berkas, gunakan pembatas komentar visual yang tegas. Contoh:
/* ==========================================
   SEGMENT: AUTHENTICATION & SECURITY
   ========================================== */
function loginUser() { ... }

/* ==========================================
   SEGMENT: METRICS GATHERING
   ========================================== */
function getCpuTemp() { ... } 

Saat melakukan update, Agen hanya boleh merujuk ke segment tertentu, misalnya: "Memperbarui fungsi getCpuTemp di dalam SEGMENT: METRICS GATHERING".

4. Alur Kerja Berbasis Dokumen Peta (System-Map & System-Workflow)system-map.md: Peta arsitektur proyek. Agen wajib memperbarui file ini setiap kali ada penambahan file atau rute baru. Agen dilarang melakukan pemindaian folder secara luas jika peta ini sudah tersedia.system-workflow.md: Buku harian proyek. Mencatat pekerjaan saat ini (Active Task), masalah yang dihadapi, solusi, dan apa yang harus dikerjakan selanjutnya. Agen wajib memperbarui file ini sebelum menutup sesi kerja.

BAGIAN 2: TEMPLATE DOKUMEN MANAJEMEN SISTEMA. TEMPLATE: system-map.md(Buat file ini di root folder proyek Anda untuk dibaca pertama kali oleh Agen)# SYSTEM MAP: ARMBIAN MONITOR

## 1. STRUKTUR DIREKTORI & FILE UTAMA
- / (Root)
  ├── package.json
  ├── server.js               # Entry point Express.js
  ├── database.sqlite         # Database SQLite (Single file)
  ├── system-map.md           # Peta sistem (Berkas ini)
  ├── system-workflow.md      # Catatan workflow aktif
  ├── /config
  │   └── db.js               # Inisialisasi SQLite & schema setup
  ├── /middleware
  │   └── auth.js             # Verifikasi JWT
  ├── /services
  │   ├── sysInfo.js          # Pembaca data Armbian (Temp, RAM, Disk, TX/RX)
  │   ├── serviceManager.js   # Wrapper Systemctl (Start/Stop/Restart)
  │   ├── cronManager.js      # Parser & writer crontab
  │   └── telegram.js         # Pengirim notifikasi bot Telegram
  ├── /routes
  │   ├── authRoutes.js       # Route login & session
  │   ├── apiRoutes.js        # Route metrics, services, cron, logs
  └── /public
      ├── index.html          # Single Page Application (SPA) Frontend
      ├── app.js              # Logika frontend & chart render
      └── style.css           # Desain UI Compact & Responsive
B. TEMPLATE: system-workflow.md(Buat file ini di root folder untuk melacak tugas aktif)# SYSTEM WORKFLOW TRACKER

## status Proyek Saat Ini: [Inisiasi / Pengembangan / Stabil]
- **Tugas Aktif**: Membuat struktur boilerplate & setup DB SQLite.
- **Tugas Selanjutnya**: Implementasi JWT Auth & API Login.

## LOG PERUBAHAN & REVISI TERAKHIR
1. [YYYY-MM-DD]: Inisiasi struktur proyek awal (v0.1.0).
2. [Sebutkan perubahan berikutnya di sini secara ringkas].

## DETEKSI ANOMALI / BUG AKTIF
* (Belum ada bug yang tercatat)

BAGIAN 3: ALUR IMPLEMENTASI TEKNIS (ROADMAP 10 LANGKAH)Gunakan daftar bernomor ini untuk memerintahkan Agen bekerja selangkah demi selangkah.
Langkah 1: Setup Proyek & Database SQLite (Backend Boilerplate)Inisialisasi proyek Node.js dengan npm init -y dan install dependensi minimal: express, jsonwebtoken, bcryptjs, sqlite3, dotenv.Buat file server.js dan /config/db.js.Di dalam db.js, buat tabel users untuk menyimpan admin tunggal (berisi: id, username, password_hash, telegram_chat_id, telegram_token).Buat script seeder sederhana untuk mendaftarkan akun admin pertama jika tabel kosong.
Langkah 2: Middleware Keamanan (JWT Auth)Buat skema otentikasi JWT satu akun tanpa multi-role di /middleware/auth.js.Implementasikan rute /api/auth/login yang memverifikasi password terenkripsi (bcrypt) dari SQLite database.Buat rute /api/auth/verify untuk memeriksa validitas token JWT saat aplikasi frontend pertama kali dimuat.
Langkah 3: Modul Pengumpul Metrik Armbian (Sistem & Hardware)Catatan khusus Armbian OS: Hindari dependensi npm eksternal yang berat. Gunakan pembacaan file sistem bawaan Linux atau child_process.exec.Temperatur CPU: Ambil nilai dari /sys/class/thermal/thermal_zone0/temp (bagi dengan 1000). Jika tidak ada, gunakan pembacaan dari perintah sensors atau /sys/devices/virtual/thermal/thermal_zone0/temp.Memory (RAM): Baca /proc/meminfo untuk performa terbaik, lalu kalkulasi: MemTotal, MemAvailable atau MemFree untuk mendapatkan persentase penggunaan.Storage (Disk): Jalankan perintah shell df -h / dan parse baris hasil untuk mendapatkan total kapasitas dan ruang yang digunakan.Network TX/RX: Baca /proc/net/dev secara berkala (selisih byte per detik) untuk melacak lalu lintas bandwidth aktif pada interface utama (seperti eth0 atau wlan0).
Langkah 4: Modul Manajemen Service (Systemctl Wrapper)Buat fungsi eksekusi aman sudo systemctl [action] [service] pada /services/serviceManager.js.Tindakan yang harus didukung: start, stop, restart, enable, disable, dan status.Batasi service mana saja yang boleh dikontrol melalui daftar putih (whitelist) di konfigurasi backend (misal: nginx, docker, mariadb, ssh, dll.) guna mencegah sabotase service sistem kritis.Catatan Keamanan: Pastikan user yang menjalankan backend node dibolehkan menjalankan perintah systemctl tertentu via /etc/sudoers tanpa password.
Langkah 5: Modul Pembaca Log Sistem (Log Viewer)Buat sistem pembacaan log di /api/logs yang membaca file log terstruktur di Armbian seperti /var/log/syslog atau menggunakan perintah journalctl -n 100 --no-pager.Tambahkan filter parameter query untuk mencari log berdasarkan nama service tertentu (contoh: journalctl -u nginx -n 50).Batasi jumlah baris maksimum yang dikirim ke frontend untuk mencegah konsumsi memori tinggi.
Langkah 6: Modul Manajemen Cron (Crontab Parser)Implementasikan fungsi membaca daftar cron user aktif menggunakan shell command crontab -l.Buat parser sederhana untuk memisahkan baris cron menjadi struktur objek JSON: { id, schedule: "* * * * *", command: "/path/to/script" }.Buat fungsi untuk menulis ulang crontab melalui perintah echo "new_cron_data" | crontab - dengan aman (selalu lakukan backup ke file sementara sebelum melakukan overwrite).Sediakan endpoint API lengkap: GET (List Cron), POST (Tambah), PUT (Edit), dan DELETE (Hapus).
Langkah 7: Modul Notifikasi Telegram BotBuat skema deteksi anomali di backend: jalankan pemeriksaan berkala (misalnya setiap 5 menit) untuk status layanan penting di whitelist dan penggunaan sumber daya ekstrem (RAM > 90%, Temp > 80°C).Jika ada perubahan status layanan dari active ke inactive, atau resource melewati batas aman, kirim notifikasi instan via API Telegram Bot.Kirim pesan "Server Online 🟢" setiap kali backend Node.js berhasil melakukan booting (indikasi server baru saja menyala/reboot).
Langkah 8: Desain UI Frontend Compact (index.html SPA)Gunakan model SPA (Single Page Application) dalam satu file /public/index.html dengan framework CSS Tailwind via CDN untuk performa tinggi tanpa langkah build yang rumit.Rancang tata letak dasbor modern dengan gaya gelap (Dark Mode Theme) sebagai standar default:Grid Atas: Kartu metrik melingkar/grafik mini (Temp, RAM, Disk, Jaringan TX/RX).Panel Kiri: Manajemen Layanan (Status badge hijau/merah, tombol aksi ringkas).Panel Kanan: Log Viewer (Terminal-style dengan font monospaced) & Manajemen Cron.Bagian Bawah: Daftar anomali sistem dan konfigurasi Telegram Bot.
Langkah 9: Interaksi Grafik & Real-time Update (app.js)Gunakan library Chart.js atau lightweight-charts untuk menampilkan grafik tren historis real-time (Temp, RAM, Jaringan) dengan interval update data setiap 3–5 detik.Gunakan fetch API standar dengan otentikasi Bearer JWT Token pada header di setiap permintaan API.Buat polling data otomatis untuk metrik sistem agar UI selalu menyajikan data terbaru secara dinamis.
Langkah 10: Finetuning, Keamanan & Pengujian AkhirTinjau kembali seluruh jalur API di backend untuk memastikan semua rute (kecuali rute login) terlindungi oleh middleware verifikasi JWT.Pastikan file database SQLite (database.sqlite) diamankan di folder yang tidak bisa diakses secara publik oleh web server.Jalankan skenario uji: mematikan service secara manual lewat SSH untuk melihat apakah bot Telegram mendeteksi anomali dan mengirim pesan dengan benar.

BAGIAN 4: PROMPT UNTUK MEMULAI KODE (COPY-PASTE READY)Gunakan petunjuk di bawah ini sebagai perintah pertama Anda ke Agen:Halo Agen! Kita akan membangun proyek "Armbian Server Monitor". 
Silakan baca terlebih dahulu file 'armbian_monitor_plan.md' di atas.

Sebagai langkah pertama:
1. Buat file 'system-map.md' dan 'system-workflow.md' di root folder proyek kita sesuai template yang telah disediakan.
2. Buat struktur folder proyek yang bersih.
3. Lakukan inisiasi database SQLite di file '/config/db.js'. Pastikan struktur tabel user admin tunggal terbuat, dan buat seeder otomatis jika belum ada admin yang terdaftar.
4. Ingat! Selalu patuhi Aturan Hemat Token (Token-Saving Rules): Terapkan "Head Comments" dan "Code Segmenting" pada file db.js Anda. Berikan respons yang ringkas dan padat.
