#!/usr/bin/env bash
# Read-only host inventory. Run on the intended server; this does not deploy.
# No sudo, installation, network probes, config dumps or credential reads.
set -u
set -o pipefail

printf 'EchoClass showcase: read-only host checks\n'
printf 'Deployment performed: no\n\n'

printf 'Operating system\n'
if [[ -r /etc/os-release ]]; then
    awk -F= '/^PRETTY_NAME=/{value=substr($0,index($0,"=")+1); gsub(/^"|"$/,"",value); print "  " value}' /etc/os-release
else
    printf '  /etc/os-release unavailable\n'
fi
printf '  Kernel / architecture: '
uname -srm
printf '  Online logical CPUs: '
getconf _NPROCESSORS_ONLN 2>/dev/null || printf 'unknown\n'

printf '\nResources (current host, not a capacity acceptance)\n'
if [[ -r /proc/meminfo ]]; then
    awk '/^MemTotal:/{total=$2} /^MemAvailable:/{available=$2} END {if(total) printf "  Memory total: %.0f MiB; available: %.0f MiB\n",total/1024,available/1024; else print "  Memory information unavailable"}' /proc/meminfo
else
    printf '  Memory information unavailable\n'
fi
if command -v df >/dev/null 2>&1; then
    df -Pm . 2>/dev/null | awk 'NR==2 {printf "  Current filesystem total: %s MiB; available: %s MiB; used: %s\n",$2,$4,$5}'
fi
if [[ -r /proc/loadavg ]]; then
    awk '{print "  Load averages (1/5/15 min): " $1 " / " $2 " / " $3}' /proc/loadavg
fi

printf '\nKnown TCP listeners (no process details)\n'
if command -v ss >/dev/null 2>&1; then
    if listener_rows=$(ss -H -ltn 2>/dev/null); then
        for listener_port in 22 80 443 3000 3001 3002 8080; do
            if awk -v port="$listener_port" '$4 ~ (":" port "$") {found=1} END {exit !found}' <<< "$listener_rows"; then
                printf '  %s: listening\n' "$listener_port"
            else
                printf '  %s: not observed listening\n' "$listener_port"
            fi
        done
    else
        printf '  Listener inspection unavailable\n'
    fi
else
    printf '  ss is not installed; no listener inspection performed\n'
fi

printf '\nAvailable programs\n'
if command -v docker >/dev/null 2>&1; then
    docker --version
    if ! docker compose version --short 2>/dev/null; then
        printf '  Docker Compose v2 unavailable\n'
    fi
else
    printf '  Docker CLI unavailable\n'
fi
if command -v nginx >/dev/null 2>&1; then
    nginx -v 2>&1
else
    printf '  Nginx unavailable on the current PATH\n'
fi
if command -v node >/dev/null 2>&1; then
    printf '  Host Node: '
    node --version
else
    printf '  Host Node unavailable (not needed by the Docker runtime)\n'
fi

printf '\nNot checked: Docker daemon access, existing Nginx config, DNS, TLS, cloud firewall, public reachability or application health.\n'
printf 'No .env files, private keys, process command lines or application data were read.\n'
