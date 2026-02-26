#!/bin/bash

# Daily MongoDB Backup Download Script
# Downloads the latest MongoDB backup from OpenShift to local machine
# Organizes backups by download date for easy archival

set -e

# Configuration
NAMESPACE="${1:-f6e00d-prod}"
BACKUP_BASE_DIR="${2:-./prod-backups}"
DATE=$(date +%Y-%m-%d)
BACKUP_DIR="$BACKUP_BASE_DIR/$DATE"

echo "======================================"
echo "Daily MongoDB Backup Download"
echo "======================================"
echo "Namespace: $NAMESPACE"
echo "Local directory: $BACKUP_DIR"
echo "Date: $DATE"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Get the script directory (in case called from elsewhere)
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Download latest backup
"$SCRIPT_DIR/download-backup.sh" "$NAMESPACE" latest "$BACKUP_DIR"

echo ""
echo "======================================"
echo "Daily Backup Download Complete!"
echo "======================================"
echo "Backup saved to: $BACKUP_DIR"
echo ""
echo "To schedule this daily (at 3 AM, after backup completes at 2 AM):"
echo "  Add to crontab (run: crontab -e):"
echo "  0 3 * * * cd $(pwd) && $SCRIPT_DIR/download-daily-backup.sh $NAMESPACE $BACKUP_BASE_DIR >> /tmp/mongodb-backup.log 2>&1"
echo ""
