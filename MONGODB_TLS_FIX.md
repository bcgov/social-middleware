# MongoDB TLS Fix — Replica Set Internal Communication

## Problem

MongoDB replica set members (mongodb-1, mongodb-2) were unreachable from the PRIMARY (mongodb-0) in both **test** and **prod** namespaces.

**Root cause**: OpenShift's service CA (`service.beta.openshift.io/serving-cert-secret-name`) only issues TLS certificates with `serverAuth` Extended Key Usage. MongoDB requires `clientAuth` as well for internal replica set connections (the `--tlsAllowConnectionsWithoutCertificates` flag only applies to application clients, not intra-cluster member communication).

Original error in logs:
```
SSL peer certificate validation failed: unsupported certificate purpose
```

## What Was Fixed (test namespace — f6e00d-test)

### Changes Made

1. **Generated a custom self-signed CA and wildcard cert** with both `serverAuth` and `clientAuth` EKU:
   - Files saved at `/tmp/mongodb-certs/` on the dev machine (`ca.key`, `ca.crt`, `tls.key`, `tls.crt`)
   - Valid for 10 years
   - SANs: `*.mongodb.f6e00d-test.svc`, `*.mongodb.f6e00d-test.svc.cluster.local`, etc.

2. **Replaced `mongodb-tls` secret** in `f6e00d-test` with the new cert. Secret now contains three keys: `tls.crt`, `tls.key`, `ca.crt`.

3. **Removed OpenShift service CA annotation** from the MongoDB service (`service.beta.openshift.io/serving-cert-secret-name: mongodb-tls`). This prevents OpenShift from overwriting the secret with a serverAuth-only cert on the next reconciliation.

4. **Updated Helm chart** (`social-middleware-helm`):
   - `templates/mongodb-service.yaml`: Removed the service CA annotation
   - `templates/mongodb-statefulset.yaml`: Updated init container to use `ca.crt` from the TLS secret when present, falling back to the OpenShift CA bundle (for dev environments without the custom cert)

5. **Deployed via `helm upgrade`** — revision 2 in f6e00d-test.

### Verified Result
```
mongodb-0  PRIMARY    health=1
mongodb-1  SECONDARY  health=1
mongodb-2  SECONDARY  health=1
```

---

## TODO: Apply Fix to Prod (f6e00d-prod)

**Prod is currently broken the same way** — mongodb-1 and mongodb-2 are unreachable. Prod is running as effectively a single-node primary (no redundancy). Fix outside active hours.

### Data Safety Notes

- **PVCs survive pod restarts** — data on `mongodb-data-mongodb-0/1/2` (netapp-file-standard) is not touched during a rolling restart. There is no data loss risk from the restart itself.
- **Journaling protects in-flight writes** — MongoDB's WiredTiger journal ensures data isn't lost even on abrupt shutdown. Pods are gracefully terminated (SIGTERM → clean shutdown).
- **The only risk is a brief write failure window** (~30-60 seconds) when mongodb-0 restarts last. By that point, mongodb-1 and mongodb-2 should have rejoined and elected a new primary. During the election (~2-5 seconds), the app will get write errors — but no data is lost, the app just needs to retry.
- **Daily backup runs at 2am** — runs nightly to the `mongodb-backup` PVC (netapp-file-backup). Trigger a manual backup immediately before starting the fix.

### Pre-flight Checklist

```bash
# 1. Verify you are on the right branch and it is up to date
git status
git log --oneline -5

# 2. Confirm current prod rs state (should show mongodb-1 and -2 as unreachable)
ADMIN_PASS=$(oc get secret mongodb -n f6e00d-prod -o jsonpath='{.data.database-admin-password}' | base64 -d)
oc exec -n f6e00d-prod mongodb-0 -- mongosh \
  "mongodb://127.0.0.1:27017/admin?tls=true&tlsAllowInvalidCertificates=true" \
  -u admin --password="$ADMIN_PASS" \
  --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))"

# 3. Trigger a manual backup NOW before touching anything
oc create job --from=cronjob/mongodb-backup mongodb-backup-pre-tls-fix -n f6e00d-prod

# 4. Wait for the backup job to complete (should be ~30 seconds)
oc wait --for=condition=complete job/mongodb-backup-pre-tls-fix -n f6e00d-prod --timeout=120s
oc logs job/mongodb-backup-pre-tls-fix -n f6e00d-prod | tail -5
# Should end with "Backup completed successfully"
```

### Steps to Fix Prod

**Step 1 — Generate prod cert** (different SANs for f6e00d-prod):
```bash
mkdir -p /tmp/mongodb-certs-prod && cd /tmp/mongodb-certs-prod

# Generate CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days 3650 \
  -out ca.crt \
  -subj "/CN=mongodb-internal-ca/O=Social Middleware"

# Generate TLS key
openssl genrsa -out tls.key 4096

# Create SAN config with prod namespace
cat > san.cnf << 'EOF'
[req]
req_extensions = v3_req
distinguished_name = req_distinguished_name
[req_distinguished_name]
[v3_req]
subjectAltName = @alt_names
extendedKeyUsage = serverAuth,clientAuth
keyUsage = critical,digitalSignature,keyEncipherment
[alt_names]
DNS.1 = *.mongodb.f6e00d-prod.svc
DNS.2 = *.mongodb.f6e00d-prod.svc.cluster.local
DNS.3 = mongodb.f6e00d-prod.svc
DNS.4 = mongodb.f6e00d-prod.svc.cluster.local
EOF

# Generate CSR and sign
openssl req -new -key tls.key -out tls.csr \
  -subj "/CN=*.mongodb.f6e00d-prod.svc" -config san.cnf
openssl x509 -req -in tls.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out tls.crt -days 3650 -sha256 -extfile san.cnf -extensions v3_req

# Verify both EKU are present
openssl x509 -text -noout -in tls.crt | grep -A 3 "Extended Key Usage"
```

**Step 2 — Remove service annotation from prod**:
```bash
oc annotate service mongodb -n f6e00d-prod service.beta.openshift.io/serving-cert-secret-name-
```

**Step 3 — Replace the secret in prod**:
```bash
cd /tmp/mongodb-certs-prod
oc create secret generic mongodb-tls \
  --from-file=tls.crt=tls.crt \
  --from-file=tls.key=tls.key \
  --from-file=ca.crt=ca.crt \
  -n f6e00d-prod \
  --dry-run=client -o yaml | oc apply -f -
```

**Step 4 — Deploy the updated Helm chart to prod**:
```bash
helm upgrade social-middleware ./social-middleware-helm \
  -n f6e00d-prod \
  --reuse-values \
  --atomic \
  --timeout 5m
```

**Step 5 — Verify**:
```bash
ADMIN_PASS=$(oc get secret mongodb -n f6e00d-prod -o jsonpath='{.data.database-admin-password}' | base64 -d)
oc exec -n f6e00d-prod mongodb-0 -- mongosh \
  "mongodb://127.0.0.1:27017/admin?tls=true&tlsAllowInvalidCertificates=true" \
  -u admin --password="$ADMIN_PASS" \
  --quiet --eval "rs.status().members.forEach(m => print(m.name, m.stateStr, m.health))"
# Expected: all three members showing SECONDARY/PRIMARY with health=1
```

---

## Important: mongodb-tls is a Manually Managed Secret

The `mongodb-tls` secret is **not created or managed by the CI/CD pipeline or Helm**. It must exist in the namespace before deployment.

Previously, OpenShift auto-generated this secret via a service annotation (`service.beta.openshift.io/serving-cert-secret-name`). That annotation has been removed because OpenShift's CA only issues `serverAuth` certificates — MongoDB replica sets also require `clientAuth` for internal communication.

**If this secret is missing, pods will fail to start** (the StatefulSet volume mount requires it).

This secret is a one-time setup per namespace, similar to `mongodb-keyfile`. If it is ever accidentally deleted, re-run Steps 1–3 above for the affected namespace and restart the StatefulSet.

Store the generated `ca.key`, `ca.crt`, `tls.key`, and `tls.crt` files somewhere secure (password manager, vault) so they can be reused if needed.

## Notes

- Both certs are valid 10 years. No urgency on renewal.
- Cert files for test are at `/tmp/mongodb-certs/` on the dev machine — will be lost on reboot. Secret is already in the cluster so test is fine.
- Cert files for prod will be at `/tmp/mongodb-certs-prod/` after tonight's fix — store securely before rebooting.
