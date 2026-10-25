#!/bin/bash
set -euo pipefail
config=$(mktemp)
trap 'rm -f "$config"' EXIT
kc=/opt/keycloak/bin/kcadm.sh
# Keycloak may report readiness while asynchronous realm bootstrap is finishing.
ready=false
for _attempt in {1..30}; do
  if "$kc" config credentials --config "$config" --server http://keycloak:8080/keycloak --realm master --user "$KEYCLOAK_ADMIN_USER" --password "$KEYCLOAK_ADMIN_PASSWORD" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 2
done
if [ "$ready" != true ]; then
  echo 'Keycloak administrator initialization failed; check bootstrap credentials and required actions.' >&2
  exit 1
fi
# Existing realms are not reimported. Add the explicit global-admin role without
# assigning it to anyone or making it a default role.
if ! "$kc" get roles/portal-admin -r lumi --config "$config" >/dev/null 2>&1; then
  "$kc" create roles -r lumi --config "$config" -s name=portal-admin -s 'description=Manage shared Lumi connections and model'
fi
if [ -n "${GOOGLE_CLIENT_ID:-}" ] && [ -n "${GOOGLE_CLIENT_SECRET:-}" ]; then
  if "$kc" get identity-provider/instances/google -r lumi --config "$config" >/dev/null 2>&1; then
    action=update
    endpoint=identity-provider/instances/google
  else
    action=create
    endpoint=identity-provider/instances
  fi
  "$kc" "$action" "$endpoint" -r lumi --config "$config" \
    -s alias=google -s providerId=google -s enabled=true -s trustEmail=true \
    -s "config.clientId=$GOOGLE_CLIENT_ID" -s "config.clientSecret=$GOOGLE_CLIENT_SECRET" \
    -s config.defaultScope='openid profile email'
fi
# hostname-admin does not change the master realm's frontend login URL.
# Do this last: changing the issuer invalidates the token obtained above on a
# fresh install. All remaining admin calls must finish before that change.
"$kc" update realms/master --config "$config" -s "attributes.frontendUrl=$KEYCLOAK_ADMIN_ORIGIN/keycloak"
