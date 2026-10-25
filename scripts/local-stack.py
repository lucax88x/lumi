#!/usr/bin/env python3
"""Create isolated local configuration; never read or overwrite production secrets."""
from pathlib import Path
import secrets
import os
p = Path('.env.stack.local')
if p.exists():
    print('Keeping existing .env.stack.local')
else:
    values = {
        'PUBLIC_ORIGIN': 'http://localhost:15183', 'NATIVE_ORIGIN': 'http://localhost:15173',
        'LUMI_LOCAL_PORT': '15183',
        'KEYCLOAK_ADMIN_PORT': '19090', 'KEYCLOAK_ADMIN_ORIGIN': 'http://localhost:19090',
        'KEYCLOAK_ADMIN_USER': 'admin', 'KEYCLOAK_ADMIN_PASSWORD': secrets.token_urlsafe(32),
        'KEYCLOAK_DB_PASSWORD': secrets.token_urlsafe(32), 'OIDC_CLIENT_SECRET': secrets.token_urlsafe(32),
        'SMTP_ENABLED': 'true', 'SMTP_HOST': 'mailpit', 'SMTP_PORT': '1025', 'SMTP_FROM': 'lumi@example.test',
        'SMTP_AUTH': 'false', 'SMTP_USER': '', 'SMTP_PASSWORD': '',
        'SMTP_STARTTLS': 'false', 'SMTP_SSL': 'false', 'MAILPIT_PORT': '18025',
    }
    fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as out:
        out.write(''.join(f'{k}={v}\n' for k, v in values.items()))
    print('Created .env.stack.local (private; not tracked).')
print('Run just dev for Lumi at http://localhost:15173; admin: http://localhost:19090/keycloak/admin/; mail: http://localhost:18025')

# Fill only missing native-development OIDC settings, preserving existing preferences.
p=Path('.env.local')
existing=p.read_text() if p.exists() else Path('.env.local.example').read_text()
stack=dict(line.split('=',1) for line in Path('.env.stack.local').read_text().splitlines() if line and not line.startswith('#'))
keys={line.split('=',1)[0] for line in existing.splitlines() if '=' in line and not line.startswith('#')}
defaults={'PUBLIC_ORIGIN':stack.get('NATIVE_ORIGIN','http://localhost:15173'),'OIDC_ISSUER_URL':stack['PUBLIC_ORIGIN']+'/keycloak/realms/lumi','OIDC_INTERNAL_URL':'http://localhost:19090/keycloak/realms/lumi','OIDC_CLIENT_ID':'lumi','OIDC_CLIENT_SECRET':stack['OIDC_CLIENT_SECRET']}
for key,val in defaults.items():
 if key not in keys:existing+='\n'+key+'='+val
 elif key=='OIDC_CLIENT_SECRET' and any(line==key+'=' for line in existing.splitlines()):existing=existing.replace(key+'=\n',key+'='+val+'\n')
p.write_text(existing.rstrip()+'\n');p.chmod(0o600)
