#!/bin/bash

# MongoDB Backup Download Script
# Downloads MongoDB backups from OpenShift backup PVC to local machine

set -e

# Configuration
NAMESPACE="${1:-f6e00d-dev}"
BACKUP_NAME="${2:-latest}"
LOCAL_DIR="${3:-./backups}"
TEMP_POD="backup-download-$$"

echo "======================================"
echo "MongoDB Backup Download"
echo "======================================"
echo "Namespace: $NAMESPACE"
echo "Backup: $BACKUP_NAME"
echo "Local directory: $LOCAL_DIR"
echo ""

# Cleanup function
cleanup() {
  echo ""
  echo "Cleaning up temporary pod..."
  oc delete pod "$TEMP_POD" -n "$NAMESPACE" --ignore-not-found=true 2>/dev/null || true
}
trap cleanup EXIT

# Create local backup directory
mkdir -p "$LOCAL_DIR"

# Check if backup PVC exists
echo "Checking for backup PVC..."
oc get pvc mongodb-backup -n "$NAMESPACE" > /dev/null 2>&1 || {
  echo "Error: mongodb-backup PVC not found in namespace $NAMESPACE"
  echo "Has the backup infrastructure been deployed?"
  exit 1
}

echo "Creating temporary pod to access backup PVC..."
cat <<EOF | oc apply -f - -n "$NAMESPACE"
apiVersion: v1
kind: Pod
metadata:
  name: $TEMP_POD
spec:
  containers:
  - name: backup-access
    image: busybox
    command: ["sleep", "300"]
    volumeMounts:
    - name: backup
      mountPath: /backup
  volumes:
  - name: backup
    persistentVolumeClaim:
      claimName: mongodb-backup
  restartPolicy: Never
EOF

# Wait for pod to be ready
echo "Waiting for pod to start..."
oc wait --for=condition=Ready pod/"$TEMP_POD" -n "$NAMESPACE" --timeout=60s || {
  echo "Error: Pod failed to start"
  exit 1
}

echo "Pod ready!"
echo ""

# List available backups if 'latest' or 'list' is specified
if [ "$BACKUP_NAME" == "latest" ] || [ "$BACKUP_NAME" == "list" ]; then
  echo "Available backups:"
  oc exec "$TEMP_POD" -n "$NAMESPACE" -- ls -lht /backup 2>/dev/null || {
    echo "No backups found. Has the backup CronJob run yet?"
    exit 1
  }
  echo ""

  if [ "$BACKUP_NAME" == "list" ]; then
    echo "Usage: $0 <namespace> <backup-name> [local-dir]"
    echo "Example: $0 f6e00d-prod 20260221-020000 ./backups"
    exit 0
  fi

  # Get latest backup
  BACKUP_NAME=$(oc exec "$TEMP_POD" -n "$NAMESPACE" -- ls -1t /backup 2>/dev/null | head -1)
  echo "Selected latest backup: $BACKUP_NAME"
  echo ""
fi

# Verify backup exists
echo "Verifying backup exists..."
oc exec "$TEMP_POD" -n "$NAMESPACE" -- ls -ld "/backup/$BACKUP_NAME" > /dev/null 2>&1 || {
  echo "Error: Backup $BACKUP_NAME not found"
  echo "Run: $0 $NAMESPACE list"
  exit 1
}

# Get backup size
BACKUP_SIZE=$(oc exec "$TEMP_POD" -n "$NAMESPACE" -- du -sh "/backup/$BACKUP_NAME" | cut -f1)
echo "Backup found!"
echo "Backup size: $BACKUP_SIZE"
echo ""

# Create tarball in pod
echo "Creating tarball..."
TARBALL="/tmp/mongodb-backup-$BACKUP_NAME.tar.gz"
oc exec "$TEMP_POD" -n "$NAMESPACE" -- tar -czf "$TARBALL" -C /backup "$BACKUP_NAME"

echo "Downloading backup to local machine..."
oc cp "$NAMESPACE/$TEMP_POD:$TARBALL" "$LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz"

echo "Cleaning up tarball in pod..."
oc exec "$TEMP_POD" -n "$NAMESPACE" -- rm -f "$TARBALL"

echo ""
echo "======================================"
echo "Download Complete!"
echo "======================================"
echo "Location: $LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz"
echo "Size: $(du -sh "$LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz" | cut -f1)"
echo ""
echo "To extract:"
echo "  tar -xzf $LOCAL_DIR/mongodb-backup-$BACKUP_NAME.tar.gz -C $LOCAL_DIR"
echo ""
echo "To restore (requires mongorestore):"
echo "  mongorestore --gzip --dir=$LOCAL_DIR/$BACKUP_NAME"
echo ""
