#!/bin/bash
# Backup script for Deployer
BACKUP_DIR="/opt/deployer/data/backups"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p $BACKUP_DIR

# Backup SQLite DB
cp /opt/deployer/data/deployer.db $BACKUP_DIR/deployer_$TIMESTAMP.db

# Keep only last 7 days
find $BACKUP_DIR -type f -mtime +7 -name "*.db" -delete

echo "Backup completed: deployer_$TIMESTAMP.db"
