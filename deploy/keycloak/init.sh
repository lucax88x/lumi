#!/bin/bash
set -euo pipefail
case "${SMTP_ENABLED:-false}" in
  true)
    if [[ -z ${SMTP_HOST:-} || -z ${SMTP_FROM:-} ]]; then
      echo 'SMTP_ENABLED=true requires SMTP_HOST and SMTP_FROM.' >&2
      exit 1
    fi
    ;;
  false) ;;
  *) echo 'SMTP_ENABLED must be true or false.' >&2; exit 1 ;;
esac
config=$(mktemp)
payload=$(mktemp)
trap 'rm -f "$config" "$payload"' EXIT
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
# Keep SMTP optional for fresh and existing realms. Email verification remains
# required by Lumi; without email, administrators provision verified accounts.
json_string() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  value=${value//$'\t'/\\t}
  value=${value//$'\b'/\\b}
  value=${value//$'\f'/\\f}
  printf '"%s"' "$value"
}
# Provision a separate service account with FGAP v2 permissions, never the
# coarse manage-users/realm-admin roles. All calls finish before master issuer changes.
if [[ -n ${KEYCLOAK_APPROVAL_CLIENT_SECRET:-} ]]; then
  approval_client=${KEYCLOAK_APPROVAL_CLIENT_ID:-lumi-access-approval}
  client_id=$("$kc" get clients -r lumi --config "$config" -q "clientId=$approval_client" --fields id --format csv --noquotes)
  cat > "$payload" <<JSON
{"clientId":$(json_string "$approval_client"),"name":"Lumi access approvals","enabled":true,"protocol":"openid-connect","publicClient":false,"secret":$(json_string "$KEYCLOAK_APPROVAL_CLIENT_SECRET"),"serviceAccountsEnabled":true,"standardFlowEnabled":false,"directAccessGrantsEnabled":false,"fullScopeAllowed":false,"defaultClientScopes":["basic","roles"]}
JSON
  if [[ -z $client_id ]]; then
    client_id=$("$kc" create clients -r lumi --config "$config" -f "$payload" -i)
  else
    "$kc" update "clients/$client_id" -r lumi --config "$config" -f "$payload"
  fi
  service_id=$("$kc" get "clients/$client_id/service-account-user" -r lumi --config "$config" --fields id --format csv --noquotes)
  "$kc" update realms/lumi --config "$config" -s adminPermissionsEnabled=true
  permissions_id=$("$kc" get clients -r lumi --config "$config" -q clientId=admin-permissions --fields id --format csv --noquotes)
  access_role_id=$("$kc" get roles/portal-access -r lumi --config "$config" --fields id --format csv --noquotes)
  if [[ -z $service_id || -z $permissions_id || -z $access_role_id ]]; then
    echo 'Keycloak access-approval permissions could not be initialized.' >&2
    exit 1
  fi
  permissions="clients/$permissions_id/authz/resource-server"
  policy_name=lumi-access-approval-service
  policy_id=$("$kc" get "$permissions/policy" -r lumi --config "$config" -q "name=$policy_name" --fields id --format csv --noquotes)
  cat > "$payload" <<JSON
{"name":"$policy_name","type":"user","logic":"POSITIVE","users":["$service_id"]}
JSON
  if [[ -z $policy_id ]]; then
    "$kc" create "$permissions/policy/user" -r lumi --config "$config" -f "$payload" >/dev/null
    policy_id=$("$kc" get "$permissions/policy" -r lumi --config "$config" -q "name=$policy_name" --fields id --format csv --noquotes)
  else
    "$kc" update "$permissions/policy/user/$policy_id" -r lumi --config "$config" -f "$payload"
  fi
  for permission_name in lumi-access-approval-users lumi-access-approval-role; do
    permission_id=$("$kc" get "$permissions/permission/scope" -r lumi --config "$config" -q "name=$permission_name" --fields id --format csv --noquotes)
    if [[ $permission_name == lumi-access-approval-users ]]; then
      cat > "$payload" <<JSON
{"name":"$permission_name","resourceType":"Users","scopes":["view","map-roles"],"policies":["$policy_id"]}
JSON
    else
      cat > "$payload" <<JSON
{"name":"$permission_name","resourceType":"Roles","resources":["$access_role_id"],"scopes":["map-role"],"policies":["$policy_id"]}
JSON
    fi
    if [[ -z $permission_id ]]; then
      "$kc" create "$permissions/permission/scope" -r lumi --config "$config" -f "$payload" >/dev/null
    else
      "$kc" update "$permissions/permission/scope/$permission_id" -r lumi --config "$config" -f "$payload"
    fi
  done
fi
if [[ ${SMTP_ENABLED:-false} == true ]]; then
  "$kc" update realms/lumi --config "$config" \
    -s registrationAllowed=true -s resetPasswordAllowed=true -s verifyEmail=true \
    -s "smtpServer.host=$(json_string "$SMTP_HOST")" \
    -s "smtpServer.port=$(json_string "${SMTP_PORT:-587}")" \
    -s "smtpServer.from=$(json_string "$SMTP_FROM")" \
    -s "smtpServer.auth=$(json_string "${SMTP_AUTH:-true}")" \
    -s "smtpServer.user=$(json_string "${SMTP_USER:-}")" \
    -s "smtpServer.password=$(json_string "${SMTP_PASSWORD:-}")" \
    -s "smtpServer.starttls=$(json_string "${SMTP_STARTTLS:-true}")" \
    -s "smtpServer.ssl=$(json_string "${SMTP_SSL:-false}")"
else
  "$kc" update realms/lumi --config "$config" \
    -s registrationAllowed=false -s resetPasswordAllowed=false -s verifyEmail=true -s 'smtpServer={}'
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
