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
