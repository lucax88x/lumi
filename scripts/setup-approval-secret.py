#!/usr/bin/env python3
"""Generate the approval secret on lumi-server without copying local credentials."""

import sys

from deploy import DeployError, run_remote


if __name__ == '__main__':
    try:
        run_remote('approval-secret', '')
    except (DeployError, OSError) as error:
        print(f'Approval secret: {error}', file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Operazione interrotta. Puoi rieseguire il comando: un secret esistente viene conservato.', file=sys.stderr)
        sys.exit(130)
