#!/bin/bash
# Executed only inside: machinectl shell serviceman@.host /bin/bash
set -Eeuo pipefail
umask 077

fail() { printf 'Deploy: %s\n' "$*" >&2; exit 1; }
[[ $(id -un) == serviceman ]] || fail 'Expected the authenticated serviceman shell.'
[[ ${HOME:-} == /* && $HOME != / ]] || fail 'Serviceman HOME is unavailable.'
root="$HOME/lumi"
mode=${1:-}
argument=${2:-}
[[ $mode == setup || $mode == check || $mode == deploy || $mode == rollback ]] || fail 'Unknown operation.'
for tool in docker flock curl python3 systemctl loginctl; do
    command -v "$tool" >/dev/null || fail "Missing prerequisite: $tool (no packages were installed)."
done
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail 'Publications require Linux amd64.'

if [[ $mode == setup ]]; then
    install -d -m 700 "$root" "$root/config" "$root/releases"
else
    [[ -d $root/config && -d $root/releases ]] || fail 'Run just deploy-setup first.'
fi
python3 -I - "$root" <<'PY'
import os, pathlib, stat, sys
for p in (pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[1]) / 'config', pathlib.Path(sys.argv[1]) / 'releases'):
    s = p.lstat()
    if not stat.S_ISDIR(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
        sys.exit('Deployment directories must be owned by serviceman with mode 0700.')
PY
exec 9>"$root/.deployment.lock"
flock -n 9 || fail 'Another deployment is running.'

stage=''
container=''
model=''
activating=0
preceding=''
cleanup() {
    status=$?
    trap - EXIT HUP INT TERM
    set +e
    # A failed configuration validation may have left a private rendered model.
    # Remove it before restoration allocates another one.
    [[ -z $model ]] || rm -f -- "$model"
    model=''
    if (( status != 0 && activating )); then
        if [[ -n $preceding ]]; then
            printf 'Activation failed; restoring %s. Database migrations are not reversed.\n' "$preceding" >&2
            if activate "$root/$preceding" && atomic_link "$preceding" current; then
                printf 'Preceding release restored; deployment still failed.\n' >&2
            else
                printf 'RESTORATION FAILED. Inspect services and restore a compatible backup if needed.\n' >&2
            fi
        else
            printf 'Activation failed; no preceding release exists. Inspect partially started services.\n' >&2
        fi
    fi
    [[ -z $container ]] || docker rm "$container" >/dev/null 2>&1
    [[ -z $stage ]] || rm -rf -- "$stage"
    [[ -z $model ]] || rm -f -- "$model"
    exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

docker_prerequisites() {
    local endpoint context security architecture
    context=$(docker context show) || return
    endpoint=$(docker context inspect "$context" --format '{{.Endpoints.docker.Host}}') || return
    # DOCKER_HOST overrides a context unless DOCKER_CONTEXT is supplied.
    if [[ -n ${DOCKER_HOST:-} && -z ${DOCKER_CONTEXT:-} ]]; then endpoint=$DOCKER_HOST; fi
    [[ $endpoint == unix:///* ]] || { printf 'Docker must use a local Unix socket.\n' >&2; return 1; }
    printf 'Serviceman Docker context: %s (%s)\n' "$context" "$endpoint"
    if ! docker info >/dev/null 2>&1; then
        if [[ $mode == setup && $endpoint == "unix:///run/user/$(id -u)/docker.sock" ]]; then
            systemctl --user cat docker.service >/dev/null || return
            systemctl --user start docker.service || return
        else
            printf 'Docker is unavailable for serviceman; verify its existing context/service.\n' >&2
            return 1
        fi
    fi
    architecture=$(docker info --format '{{.Architecture}}') || return
    [[ $architecture == x86_64 || $architecture == amd64 ]] || { printf 'Docker must run amd64.\n' >&2; return 1; }
    security=$(docker info --format '{{json .SecurityOptions}}') || return
    if [[ $security == *rootless* ]]; then
        systemctl --user is-active --quiet docker.service || return
        systemctl --user is-enabled --quiet docker.service || { printf 'Existing user Docker service must be enabled for boot.\n' >&2; return 1; }
        [[ $(loginctl show-user serviceman --property=Linger --value) == yes ]] || { printf 'Serviceman needs existing login lingering for Docker persistence.\n' >&2; return 1; }
    else
        systemctl is-active --quiet docker.service || return
        systemctl is-enabled --quiet docker.service || return
    fi
    docker compose version || return
    docker compose up --help | grep -q -- '--wait-timeout' || { printf 'Compose needs --wait and --wait-timeout support.\n' >&2; return 1; }
}

if [[ $mode == setup ]]; then
    # Public template only. Never overwrite server configuration.
    if [[ ! -e $root/config/.env ]]; then
        (set -o noclobber; cat >"$root/config/.env" <<'ENV'
# Production: copy to .env and fill private values. No trailing slash.
PUBLIC_ORIGIN=https://lumi.example.com
LUMI_PORT=18080
KEYCLOAK_ADMIN_PORT=19090
KEYCLOAK_ADMIN_ORIGIN=http://localhost:19090
KEYCLOAK_ADMIN_USER=admin
KEYCLOAK_ADMIN_PASSWORD=
KEYCLOAK_DB_PASSWORD=
OIDC_CLIENT_SECRET=
SMTP_HOST=
SMTP_PORT=587
SMTP_FROM=
SMTP_AUTH=true
SMTP_USER=
SMTP_PASSWORD=
SMTP_STARTTLS=true
SMTP_SSL=false
OPENAI_API_KEY=
# Optional Google identity broker; both values are required to show the button.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ENV
        )
    fi
    docker_prerequisites
    printf 'Setup ready at %s. Fill config/.env and log in to ghcr.io inside this shell.\n' "$root"
    exit 0
fi

docker_prerequisites
[[ -f $root/config/.env ]] || fail 'Missing config/.env; run setup and configure production first.'
python3 -I - "$root/config/.env" <<'PY'
import os, stat, sys
s = os.lstat(sys.argv[1])
if not stat.S_ISREG(s.st_mode) or s.st_uid != os.getuid() or s.st_mode & 0o077:
    sys.exit('config/.env must be a private regular file owned by serviceman (0600).')
PY

if [[ $mode == rollback ]]; then
    [[ $argument =~ ^[1-9][0-9]*-[1-9][0-9]*$ ]] || fail 'Invalid release ID.'
    [[ -d $root/releases/$argument && ! -L $root/releases/$argument ]] || fail 'Unknown retained release.'
    metadata=$(cat "$root/releases/$argument/release.json")
else
    metadata=$argument
fi
fields=$(python3 -I - "$metadata" <<'PY'
import json, re, sys
r = json.loads(sys.argv[1])
assert r['schema'] == 1 and r['repository'] == 'lucax88x/lumi', 'Invalid repository/schema'
assert type(r['run_id']) is int and r['run_id'] > 0, 'Invalid run ID'
assert type(r['run_attempt']) is int and r['run_attempt'] > 0, 'Invalid run attempt'
assert r['release_id'] == f"{r['run_id']}-{r['run_attempt']}", 'Invalid release ID'
assert re.fullmatch(r'sha256:[0-9a-f]{64}', r['digest']), 'Invalid digest'
assert r['image'] == 'ghcr.io/lucax88x/lumi@' + r['digest'], 'Invalid image'
assert re.fullmatch(r'[0-9a-f]{40}', r['commit']), 'Invalid source commit'
print(r['release_id']); print(r['image']); print(r['commit'])
PY
)
release_fields=()
while IFS= read -r value; do release_fields+=("$value"); done <<<"$fields"
release_id=${release_fields[0]}
image=${release_fields[1]}
commit=${release_fields[2]}
[[ $mode != rollback || $release_id == "$argument" ]] || fail 'Retained release metadata mismatch.'

compose() {
    local directory=$1
    shift
    LUMI_IMAGE="$selected_image" docker compose --project-name lumi --project-directory "$directory" \
        --env-file "$root/config/.env" -f "$directory/compose.yaml" -f "$directory/compose.prod.yaml" "$@"
}

validate_configuration() {
    local directory=$1 values
    selected_image=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["image"])' "$directory/release.json") || return
    [[ $selected_image =~ ^ghcr\.io/lucax88x/lumi@sha256:[0-9a-f]{64}$ ]] || return 1
    model=$(mktemp "$root/.compose.XXXXXXXX") || return
    # Resolved configuration contains secrets: keep it private and never print it.
    compose "$directory" config --format json >"$model" || return
    values=$(python3 -I - "$model" "$selected_image" <<'PY'
import json, sys, urllib.parse
c = json.load(open(sys.argv[1])); services = c['services']
assert c['name'] == 'lumi'
assert all('build' not in s for s in services.values()), 'Production cannot build'
assert services['lumi']['image'] == sys.argv[2], 'Unexpected application image'
assert c['volumes']['lumi-data']['name'] == 'lumi_lumi-data'
assert c['volumes']['keycloak-db']['name'] == 'lumi_keycloak-db'
assert not services['keycloak-db'].get('ports'), 'Database must stay private'
ports = []
for name in ('lumi', 'keycloak'):
    p = services[name]['ports']
    assert len(p) == 1 and p[0]['host_ip'] == '127.0.0.1' and p[0]['target'] == 8080
    port = int(p[0]['published']); assert 1024 <= port <= 65535
    ports.append(str(port))
origin = services['lumi']['environment']['PUBLIC_ORIGIN']
url = urllib.parse.urlsplit(origin)
assert url.scheme == 'https' and url.hostname and not url.username and not url.password
assert not url.path and not url.query and not url.fragment and '\n' not in origin and '\r' not in origin
assert url.hostname != 'lumi.example.com', 'Configure a real production origin'
print(origin); print('\n'.join(ports))
PY
    ) || return
    rm -f -- "$model" || return
    model=''
    connection=()
    while IFS= read -r value; do connection+=("$value"); done <<<"$values"
}

verify_health() {
    local origin=${connection[0]} lumi_port=${connection[1]} keycloak_port=${connection[2]} code body path headers
    curl --fail --silent --show-error --max-time 15 "http://127.0.0.1:$lumi_port/healthz" >/dev/null || return
    for path in "http://127.0.0.1:$keycloak_port" "$origin"; do
        body=$(curl --fail --silent --show-error --max-time 15 "$path/keycloak/realms/lumi/.well-known/openid-configuration") || return
        python3 -I -c 'import json,sys; assert json.loads(sys.argv[1])["issuer"] == sys.argv[2]+"/keycloak/realms/lumi"' "$body" "$origin" || return
    done
    for path in "http://127.0.0.1:$lumi_port" "$origin"; do
        code=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$path/api/v1/session") || return
        [[ $code == 401 ]] || { printf 'Authentication gate failed (%s).\n' "$code" >&2; return 1; }
    done
    headers=$(curl --silent --show-error --max-time 15 --dump-header - --output /dev/null "$origin/auth/login") || return
    # Login state cookies stay on stdin, never in process arguments or output.
    printf '%s' "$headers" | python3 -I -c '
import sys
lines = sys.stdin.read().splitlines()
assert lines and lines[0].split()[1] in ("302", "303"), "Login redirect failed"
locations = [line.split(":", 1)[1].strip() for line in lines if line.lower().startswith("location:")]
assert len(locations) == 1 and locations[0].startswith(sys.argv[1] + "/keycloak/realms/lumi/protocol/openid-connect/auth?"), "Unexpected identity redirect"
' "$origin" || return
    for path in /healthz /keycloak/admin/ /keycloak/realms/master/.well-known/openid-configuration; do
        code=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$origin$path") || return
        [[ $code == 404 ]] || { printf 'Private route exposed through the gateway: %s (%s).\n' "$path" "$code" >&2; return 1; }
    done
}

activate() {
    local directory=$1
    validate_configuration "$directory" || return
    compose "$directory" up --no-build --pull never --wait --wait-timeout 300 || return
    verify_health || return
}

atomic_link() {
    local target=$1 name=$2
    python3 -I - "$root" "$target" "$name" <<'PY'
import os, pathlib, sys, uuid
root, target, name = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
temporary = root / ('.' + name + '.next-' + uuid.uuid4().hex)
try:
    os.symlink(target, temporary)
    os.replace(temporary, root / name)
finally:
    if temporary.is_symlink():
        temporary.unlink()
PY
}

for link in current previous; do
    if [[ -e $root/$link || -L $root/$link ]]; then
        [[ -L $root/$link ]] || fail "$link must be a release symlink."
        target=$(readlink "$root/$link")
        [[ $target =~ ^releases/[1-9][0-9]*-[1-9][0-9]*$ && -d $root/$target && ! -L $root/$target ]] || fail "Invalid $link release link."
    fi
    # An interrupted rename may leave only this temporary link behind.
    [[ ! -L $root/.$link.next ]] || rm -- "$root/.$link.next"
done
[[ ! -L $root/current ]] || preceding=$(readlink "$root/current")

directory="$root/releases/$release_id"
if [[ $mode != rollback ]]; then
    docker pull --platform linux/amd64 "$image"
    actual_commit=$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')
    [[ $actual_commit == "$commit" ]] || fail 'Pulled image source label does not match publication metadata.'
    stage=$(mktemp -d "$root/releases/.extract.XXXXXXXX")
    container=$(docker create --platform linux/amd64 --entrypoint /bin/true "$image")
    docker cp "$container:/opt/lumi-deploy/." "$stage/"
    chmod 700 "$stage"
    docker rm "$container" >/dev/null
    container=''
    for file in compose.yaml compose.prod.yaml .env.example deploy/keycloak/init.sh deploy/keycloak/lumi-realm.json; do
        [[ -f $stage/$file && ! -L $stage/$file ]] || fail "Missing deployment file in image: $file"
    done
    [[ -d $stage/deploy/keycloak/themes/lumi ]] || fail 'Image is missing Keycloak theme.'
    printf '%s\n' "$metadata" >"$stage/release.json"
    if [[ $mode == check ]]; then
        directory=$stage
    elif [[ -e $directory || -L $directory ]]; then
        [[ -d $directory && ! -L $directory ]] || fail 'Release path is not a directory.'
        # A run/attempt is immutable even if an artifact was replaced.
        diff -qr "$directory" "$stage" >/dev/null || fail 'Retained release differs from this publication.'
    else
        mv -- "$stage" "$directory"
        stage=''
    fi
fi

validate_configuration "$directory"
if [[ $mode == check ]]; then
    compose "$directory" pull
    printf 'Release %s and prerequisites checked; services and current release were not changed.\n' "$release_id"
    exit 0
fi
if [[ $mode != rollback ]]; then compose "$directory" pull; fi
activating=1
activate "$directory"
if [[ -n $preceding && $preceding != "releases/$release_id" ]]; then atomic_link "$preceding" previous; fi
atomic_link "releases/$release_id" current
activating=0
printf 'Active release: %s\n' "$release_id"
