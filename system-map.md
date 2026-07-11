# SYSTEM MAP: ARMBIAN MONITOR (MONYX)

## 1. STRUKTUR DIREKTORI & FILE UTAMA
```
/ (Root)
├── package.json
├── .env                      # Konfigurasi environment
├── .gitignore
├── server.js                 # Entry point Express.js
├── install.sh                # Script installer systemd service (Linux)
├── uninstall.sh              # Script uninstaller (Linux)
├── database.sqlite           # Database SQLite (auto-generated)
├── system-map.md             # Peta sistem (Berkas ini)
├── system-workflow.md        # Catatan workflow aktif
├── task.md                   # Tracker pengerjaan modul baru
│
├── /config
│   └── db.js                 # Inisialisasi SQLite & schema setup + seeder (users & app_settings)
│
├── /middleware
│   └── auth.js               # Verifikasi JWT
│
├── /services
│   ├── sysInfo.js            # Pembaca data Armbian (Temp, RAM, Disk, TX/RX, core stats)
│   ├── serviceManager.js     # Wrapper Systemctl (Start/Stop/Restart)
│   ├── cronManager.js        # Parser & writer crontab
│   ├── telegram.js           # Pengirim notifikasi bot Telegram
│   └── fileManager.js        # Service manajemen file di /mnt/ (keamanan traversal & mock support)
│
├── /routes
│   ├── authRoutes.js         # Route login & session
│   └── apiRoutes.js          # Route metrics, services, cron, logs, settings, modules, files
│
└── /public
    ├── index.html            # Single Page Application (SPA) Frontend
    ├── app.js                # Logika frontend & chart render & File Manager UI
    └── style.css             # Desain UI Compact & Responsive + File Manager Styles
```

## 2. ENDPOINT API MAP

### Auth (Tidak perlu JWT)
| Method | Path              | Deskripsi                     |
|--------|-------------------|-------------------------------|
| POST   | /api/auth/login   | Login admin, return JWT token |
| GET    | /api/auth/verify  | Verifikasi validitas token    |

### Metrics (JWT Required)
| Method | Path                | Deskripsi                       |
|--------|---------------------|---------------------------------|
| GET    | /api/metrics        | Data metrik sistem saat ini     |
| GET    | /api/metrics/history| Data historis metrik (Chart.js) |

### Processes (JWT Required)
| Method | Path            | Deskripsi                          |
|--------|-----------------|------------------------------------|
| GET    | /api/processes  | List proses teratas (CPU/RAM)      |

### Services (JWT Required)
| Method | Path                          | Deskripsi                |
|--------|-------------------------------|--------------------------|
| GET    | /api/services                 | List status semua service|
| POST   | /api/services/:name/:action   | Kontrol service          |

### Logs (JWT Required)
| Method | Path                          | Deskripsi                |
|--------|-------------------------------|--------------------------|
| GET    | /api/logs?service=xxx&lines=n | Baca log sistem/service  |

### Cron (JWT Required)
| Method | Path            | Deskripsi        |
|--------|-----------------|------------------|
| GET    | /api/cron       | List cron jobs   |
| POST   | /api/cron       | Tambah cron job  |
| PUT    | /api/cron/:id   | Edit cron job    |
| DELETE | /api/cron/:id   | Hapus cron job   |

### Settings & Modules (JWT Required)
| Method | Path                    | Deskripsi                             |
|--------|-------------------------|---------------------------------------|
| GET    | /api/settings/telegram  | Mengambil config Telegram             |
| PUT    | /api/settings/telegram  | Update config Telegram                |
| GET    | /api/modules            | List status modul tambahan (key-value)|
| PUT    | /api/modules/:key       | Mengaktifkan/menonaktifkan modul      |

### File Manager (JWT Required & Module Checked)
| Method | Path                    | Deskripsi                             |
|--------|-------------------------|---------------------------------------|
| GET    | /api/files?path=xxx     | List file & folder di bawah /mnt/*    |
| POST   | /api/files/mkdir        | Membuat folder baru di /mnt/*         |
| POST   | /api/files/rename       | Mengganti nama file/folder di /mnt/*  |
| DELETE | /api/files?path=xxx     | Hapus file/folder kosong di /mnt/*    |
| POST   | /api/files/upload       | Upload file ke path (Limit 100MB)     |
| GET    | /api/files/download?path| Mengunduh file dari path              |
| GET    | /api/files/preview?path | Preview file inline & range streaming |

## 3. DATABASE SCHEMA

### Tabel: users
| Kolom             | Tipe    | Keterangan              |
|-------------------|---------|-------------------------|
| id                | INTEGER | PRIMARY KEY AUTOINCREMENT|
| username          | TEXT    | UNIQUE NOT NULL          |
| password_hash     | TEXT    | NOT NULL                 |
| telegram_chat_id  | TEXT    | Nullable                 |
| telegram_token    | TEXT    | Nullable                 |

### Tabel: app_settings (Key-Value Config)
| Kolom             | Tipe    | Keterangan              |
|-------------------|---------|-------------------------|
| key               | TEXT    | PRIMARY KEY (Unique key)|
| value             | TEXT    | NOT NULL (Config value) |

*Default Seeded*: `module_filemanager` = `'0'` (disabled by default)

### Tabel: metrics_history
| Kolom       | Tipe    | Keterangan               |
|-------------|---------|---------------------------|
| id          | INTEGER | PRIMARY KEY AUTOINCREMENT |
| timestamp   | INTEGER | Unix timestamp            |
| cpu_temp    | REAL    | Derajat Celcius           |
| ram_percent | REAL    | Persentase penggunaan     |
| disk_percent| REAL    | Persentase penggunaan     |
| net_rx      | INTEGER | Bytes received/s          |
| net_tx      | INTEGER | Bytes transmitted/s       |
