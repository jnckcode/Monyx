#!/bin/bash
# ==========================================
# @file: install.sh
# @description: Monyx Server Monitor Auto-Installer
# @target: Armbian / Debian / Ubuntu (Linux)
# ==========================================

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==========================================${NC}"
echo -e "${BLUE}     Installing Monyx Server Monitor      ${NC}"
echo -e "${BLUE}==========================================${NC}"

# 1. Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run this script as root (sudo ./install.sh).${NC}"
  exit 1
fi

# 2. Check and Install Node.js & dependencies
echo -e "\n${YELLOW}[1/6] Checking system dependencies...${NC}"
if ! command -v node &> /dev/null; then
  echo -e "${YELLOW}Node.js not found. Installing Node.js LTS...${NC}"
  # Check if curl is installed
  if ! command -v curl &> /dev/null; then
    apt-get update && apt-get install -y curl
  fi
  # Install NodeSource Node.js LTS (v20)
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs build-essential sqlite3
else
  NODE_VER=$(node -v)
  echo -e "${GREEN}Node.js is already installed (${NODE_VER}).${NC}"
fi

# Install build tools if they aren't present (for compiling native better-sqlite3 if needed)
if ! command -v make &> /dev/null || ! command -v g++ &> /dev/null; then
  echo -e "${YELLOW}Installing build-essential for SQLite module compilation...${NC}"
  apt-get install -y build-essential
fi

# 3. Create install directory and copy files
INSTALL_DIR="/opt/monyx"
echo -e "\n${YELLOW}[2/6] Copying files to ${INSTALL_DIR}...${NC}"

# Backup old installation if exists
if [ -d "$INSTALL_DIR" ]; then
  echo -e "${YELLOW}Old installation found. backing up to ${INSTALL_DIR}_backup...${NC}"
  rm -rf "${INSTALL_DIR}_backup"
  mv "$INSTALL_DIR" "${INSTALL_DIR}_backup"
fi

mkdir -p "$INSTALL_DIR"

# Copy project files (excluding node_modules, .git, etc.)
cp -r config middleware public routes services server.json package.json package-lock.json server.js "$INSTALL_DIR/" 2>/dev/null || {
  # If file copy fails or some files are missing, copy everything except specific dirs
  rsync -aq --exclude='node_modules' --exclude='.git' --exclude='database.sqlite*' --exclude='backups' ./ "$INSTALL_DIR/"
}

# Ensure database directory and permissions
cd "$INSTALL_DIR"

# 4. Generate .env file if it doesn't exist
echo -e "\n${YELLOW}[3/6] Setting up environment configuration...${NC}"
if [ ! -f "$INSTALL_DIR/.env" ]; then
  # Check if there is an existing .env in the installation source
  if [ -f "/opt/monyx_backup/.env" ]; then
    echo -e "${GREEN}Restoring previous .env configuration.${NC}"
    cp "/opt/monyx_backup/.env" "$INSTALL_DIR/.env"
  elif [ -f "$OLDPWD/.env" ]; then
    echo -e "${GREEN}Copying .env from installation source.${NC}"
    cp "$OLDPWD/.env" "$INSTALL_DIR/.env"
  else
    # Generate secure values
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    
    # Prompt for admin credentials with defaults
    read -p "Enter admin username [default: admin]: " ADMIN_USER
    ADMIN_USER=${ADMIN_USER:-admin}
    
    read -p "Enter admin password [default: root]: " ADMIN_PASS
    ADMIN_PASS=${ADMIN_PASS:-root}
    
    read -p "Enter server port [default: 3000]: " PORT
    PORT=${PORT:-3000}

    cat > "$INSTALL_DIR/.env" <<EOF
PORT=$PORT
JWT_SECRET=$JWT_SECRET
ADMIN_USERNAME=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASS
EOF
    echo -e "${GREEN}Generated default .env configuration.${NC}"
  fi
else
  echo -e "${GREEN}.env already exists. Skipping generation.${NC}"
fi

# 5. Install npm dependencies
echo -e "\n${YELLOW}[4/6] Installing Node.js packages (production)...${NC}"
npm install --omit=dev --no-audit --no-fund

# 6. Configure systemd service
echo -e "\n${YELLOW}[5/6] Registering systemd service...${NC}"
NODE_PATH=$(which node)

cat > /etc/systemd/system/monyx.service <<EOF
[Unit]
Description=Monyx Armbian Server Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$NODE_PATH server.js
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

# Reload daemon and enable service
systemctl daemon-reload
systemctl enable monyx
systemctl restart monyx

# 7. Sudoers permissions for systemctl and power controls
echo -e "\n${YELLOW}[6/6] Setting up security and service permissions...${NC}"
# In case Monyx needs to be run under a different user in the future, we set up sudoers.
# Also allows root to execute commands through standard paths.
cat > /etc/sudoers.d/monyx <<EOF
# Sudoers permissions for Monyx whitelisted services and power actions
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * nginx
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * docker
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * mariadb
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * mysql
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * ssh
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * sshd
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * zerotier-one
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * smbd
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * nmbd
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * apache2
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * postgresql
ALL ALL=(ALL) NOPASSWD: /usr/bin/systemctl * monyx
ALL ALL=(ALL) NOPASSWD: /sbin/reboot, /sbin/poweroff, /sbin/shutdown
ALL ALL=(ALL) NOPASSWD: /usr/sbin/reboot, /usr/sbin/poweroff, /usr/sbin/shutdown

ALL ALL=(ALL) NOPASSWD: /bin/systemctl * nginx
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * docker
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * mariadb
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * mysql
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * ssh
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * sshd
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * zerotier-one
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * smbd
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * nmbd
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * apache2
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * postgresql
ALL ALL=(ALL) NOPASSWD: /bin/systemctl * monyx
ALL ALL=(ALL) NOPASSWD: /usr/bin/reboot, /usr/bin/poweroff, /usr/bin/shutdown
EOF

chmod 0440 /etc/sudoers.d/monyx

# Configure Journald Max Log Size to 50M to prevent storage bloating
if [ -f "/etc/systemd/journald.conf" ]; then
  echo -e "\n${YELLOW}Configuring journald max log size to 50M...${NC}"
  if grep -q "SystemMaxUse=" /etc/systemd/journald.conf; then
    sed -i 's/.*SystemMaxUse=.*/SystemMaxUse=50M/' /etc/systemd/journald.conf
  else
    echo "SystemMaxUse=50M" >> /etc/systemd/journald.conf
  fi
  systemctl restart systemd-journald
  echo -e "${GREEN}Journald log rotation limit set to 50M.${NC}"
fi

# Verify running state
sleep 2
if systemctl is-active --quiet monyx; then
  echo -e "\n${GREEN}==========================================${NC}"
  echo -e "${GREEN}Monyx installed and running successfully!${NC}"
  
  # Read port from .env
  PORT_NUM=$(grep PORT "$INSTALL_DIR/.env" | cut -d= -f2)
  echo -e "You can access the monitor at: ${BLUE}http://$(hostname -I | awk '{print $1}'):${PORT_NUM}${NC}"
  echo -e "${GREEN}==========================================${NC}"
else
  echo -e "\n${RED}Warning: Monyx service started but is not running actively.${NC}"
  echo -e "Check logs using: ${YELLOW}journalctl -u monyx -n 50 --no-pager${NC}"
fi
