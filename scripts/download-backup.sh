#!/bin/bash

# MongoDB Backup Download Script
# Downloads MongoDB backups from OpenShift to local machine

set -e

# Configuration
NAMESPACE="${1:-f6e00d-dev}"
BACKUP_NAME="${2:-latest}"
LOCAL_DIR="${3:-./backups}"

echo "======================================"
echo "MongoDB Backup Download"
echo "======================================"
echo "Namespace: $NAMESPACE"
echo "Backup: $BACKUP_NAME"
echo "Local directory: $LOCAL_DIR"
echo ""

# Create local backup directory
mkdir -p "$LOCAL_DIR"

# Get MongoDB pod name
echo "Finding MongoDB pod..."
POD=$(oc get pods -n "$NAMESPACE" -l app=mongodb -o jsonpath='{.items[0].metadata.name}')

if [ -z "$POD" ]; then
  echo "Error: No MongoDB pod found in namespace $NAMESPACE"
  exit 1
fi

echo "Using pod: $POD"
echo ""

# List available backups if 'latest' or 'list' is specified
if [ "$BACKUP_NAME" == "latest" ] || [ "$BACKUP_NAME" == "list" ]; then
  echo "Available backups:"
  oc exec "$POD" -n "$NAMESPACE" -- ls -lht /backup 2>/dev/null || {
    echo "No backups found. Has the backup CronJob run yet?"
    exit 1
  }
  echo ""

  if [ "$BACKUP_NAME" == "list" ]; then
    echo "Usage: $0 <namespace> <backup-name> [local-dir]"
    echo "Example: $0 f6e00d-dev 20260221-020000 ./backups"
    exit 0
  fi

  # Get latest backup
  BACKUP_NAME=$(oc exec "$POD" -n "$NAMESPACE" -- ls -1t /backup 2>/dev/null | head -1)
  echo "Latest backup: $BACKUP_NAME"
  echo ""
fi

# Verify backup exists
echo "Verifying backup exists..."
oc exec "$POD" -n "$NAMESPACE" -- ls -ld "/backup/$BACKUP_NAME" > /dev/null 2>&1 || {
  echo "Error: Backup $BACKUP_NAME not found"
  echo "Run: $0 $NAMESPACE list"
  exit 1
}

# Get backup size
BACKUP_SIZE=$(oc exec "$POD" -n "$NAMESPACE" -- du -sh "/backup/$BACKUP_NAME" | cut -f1)
echo "Backup size: $BACKUP_SIZE"
echo ""

# Create tarball in pod
echo "Creating tarball..."
TARBALL="/tmp/mongodb-backup-$BACKUP_NAME.tar.gz"
oc exec "$POD" -n "$NAMESPACE" -- tar -czf "$TARBALL" -C /backup "$BACKUP_NAME"

echo "Downloading backup to local machine..."
oc cp "$NAMESPACE/$POD:$TARBALL" "$LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz"

echo "Cleaning up tarball in pod..."
oc exec "$POD" -n "$NAMESPACE" -- rm -f "$TARBALL"

echo ""
echo "======================================"
echo "Download Complete!"
echo "======================================"
echo "Location: $LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz"
echo ""
echo "To extract:"
echo "  tar -xzf $LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz -C $LOCAL_DIR"
echo ""
echo "To restore locally (requires MongoDB installed):"
echo "  mongorestore --gzip --dir=$LOCAL_DIR/$BACKUP_NAME"
