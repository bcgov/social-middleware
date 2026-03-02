#!/bin/bash
# Create MongoDB keyfile for replica set internal authentication

NAMESPACE=${1:-f6e00d-prod}

echo "Creating MongoDB keyfile for namespace: $NAMESPACE"

# Generate a random keyfile (must be 1024 characters, base64 encoded)
openssl rand -base64 756 > /tmp/mongodb-keyfile

# Create the secret
oc create secret generic mongodb-keyfile \
  --from-file=mongodb-keyfile=/tmp/mongodb-keyfile \
  -n $NAMESPACE \
  --dry-run=client -o yaml | oc apply -f -

# Clean up
rm /tmp/mongodb-keyfile

echo "MongoDB keyfile secret created successfully!"
echo "You can now redeploy the MongoDB StatefulSet"
