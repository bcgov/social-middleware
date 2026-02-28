#!/bin/bash
# MongoDB StatefulSet Debug Script

NAMESPACE="f6e00d-prod"

echo "=================================================="
echo "MongoDB StatefulSet Debug Information"
echo "=================================================="
echo ""

echo "=== 1. Pod Status ==="
oc get pods -n $NAMESPACE | grep mongodb
echo ""

echo "=== 2. StatefulSet Configuration ==="
echo "--- Environment Variables in StatefulSet ---"
oc get statefulset mongodb -n $NAMESPACE -o json | jq '.spec.template.spec.containers[0].env'
echo ""

echo "=== 3. MongoDB Pod Environment (mongodb-0) ==="
echo "--- Checking NAMESPACE variable ---"
oc exec mongodb-0 -n $NAMESPACE -- printenv | grep -E "NAMESPACE|REPLICA" || echo "Could not get env vars"
echo ""

echo "=== 4. MongoDB-0 Logs - Init Script Output ==="
oc logs mongodb-0 -n $NAMESPACE 2>&1 | head -50 | grep -E "===|PRODUCTION|DEVELOPMENT|Replica|pod-0|SUCCESS|Error"
echo ""

echo "=== 5. MongoDB Status Check ==="
echo "--- Checking if MongoDB is running with replica set ---"
oc exec mongodb-0 -n $NAMESPACE -- ps aux | grep mongod || echo "Could not get process list"
echo ""

echo "=== 6. MongoDB Connection Test from mongodb-0 ==="
oc exec mongodb-0 -n $NAMESPACE -- mongosh --tls --tlsAllowInvalidCertificates --eval "db.adminCommand('ping')" 2>&1 | tail -5
echo ""

echo "=== 7. Replica Set Status (if initialized) ==="
oc exec mongodb-0 -n $NAMESPACE -- mongosh --tls --tlsAllowInvalidCertificates --eval "rs.status()" 2>&1 | head -30 || echo "Replica set not initialized or auth required"
echo ""

echo "=== 8. Service Configuration ==="
oc get svc mongodb -n $NAMESPACE -o yaml | grep -A10 "spec:"
echo ""

echo "=== 9. DNS Resolution Test ==="
echo "--- Testing DNS from a temporary pod ---"
oc run dns-test --image=busybox:1.36 --rm -i --restart=Never -n $NAMESPACE -- nslookup mongodb-0.mongodb.$NAMESPACE.svc.cluster.local 2>&1 || echo "DNS test failed"
echo ""

echo "=== 10. Application Pod Status ==="
oc get pods -n $NAMESPACE | grep social-middleware
echo ""

echo "=== 11. Latest Application Logs ==="
APP_POD=$(oc get pods -n $NAMESPACE -l app=social-middleware -o jsonpath='{.items[0].metadata.name}' 2>/dev/null)
if [ ! -z "$APP_POD" ]; then
  echo "--- Logs from $APP_POD ---"
  oc logs $APP_POD -n $NAMESPACE --tail=100 2>&1 | head -50
else
  echo "No application pods found"
fi
echo ""

echo "=== 12. Current Helm Values for MongoDB ==="
echo "--- Checking if replica set config is in values ---"
cat social-middleware-helm/values.yaml | grep -A15 "mongodb:"
echo ""

echo "=================================================="
echo "Debug collection complete!"
echo "=================================================="
