#!/bin/bash
# ==========================================
# @file: uninstall.sh
# @description: Monyx Server Monitor Uninstaller
# @target: Armbian / Debian / Ubuntu (Linux)
# ==========================================

# Text colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${RED}==========================================${NC}"
echo -e "${RED}    Uninstalling Monyx Server Monitor     ${NC}"
echo -e "${RED}==========================================${NC}"

# 1. Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo -e "${RED}Error: Please run this script as root (sudo ./uninstall.sh).${NC}"
  exit 1
fi

# 2. Stop and disable systemd service
echo -e "\n${YELLOW}[1/4] Stopping and disabling monyx service...${NC}"
if systemctl is-active --quiet monyx; then
  systemctl stop monyx
  echo -e "${GREEN}Service stopped.${NC}"
fi

if systemctl is-enabled --quiet monyx &>/dev/null; then
  systemctl disable monyx
  echo -e "${GREEN}Service disabled.${NC}"
fi

# Remove systemd service file
if [ -f "/etc/systemd/system/monyx.service" ]; then
  rm -f /etc/systemd/system/monyx.service
  systemctl daemon-reload
  echo -e "${GREEN}Systemd service removed.${NC}"
fi

# 3. Remove sudoers configuration
echo -e "\n${YELLOW}[2/4] Removing sudoers configuration...${NC}"
if [ -f "/etc/sudoers.d/monyx" ]; then
  rm -f /etc/sudoers.d/monyx
  echo -e "${GREEN}Sudoers configuration removed.${NC}"
fi

# 4. Prompt to clean up database and app files
echo -e "\n${YELLOW}[3/4] Cleaning application directory...${NC}"
INSTALL_DIR="/opt/monyx"

if [ -d "$INSTALL_DIR" ]; then
  read -p "Do you want to delete all Monyx data (including DB history & configurations)? [y/N]: " CONFIRM
  CONFIRM=${CONFIRM:-n}
  
  if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    echo -e "${GREEN}Application folder $INSTALL_DIR removed completely.${NC}"
  else
    # Keep configurations and database, only remove core files
    echo -e "${YELLOW}Keeping database and environment files. Removing source files...${NC}"
    find "$INSTALL_DIR" -mindepth 1 -not -name 'database.sqlite*' -not -name '.env' -not -name 'backups' -delete 2>/dev/null
    echo -e "${GREEN}Cleaned codebase. SQLite database files and config are kept at $INSTALL_DIR.${NC}"
  fi
else
  echo -e "${GREEN}No application folder found at $INSTALL_DIR.${NC}"
fi

# 5. Finished
echo -e "\n${GREEN}[4/4] Uninstall completed!${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "Monyx Server Monitor has been removed."
echo -e "${GREEN}==========================================${NC}"
