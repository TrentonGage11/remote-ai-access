# Passive SSH Source Analysis — `198.74.54.235`

**Assessment date:** 2026-08-30  
**Log period:** 2026-08-23 00:00 UTC through 2026-08-30 22:24 UTC  
**Method:** Read-only analysis of the owned server's SSH journal and Fail2ban logs, plus passive RDAP/ASN, reverse-DNS, and public reputation research.  
**Safety boundary:** No connections, probes, scans, pings, Netcat requests, or other packets were sent to any source address.

## Executive conclusion

The evidence overwhelmingly supports **automated, opportunistic Internet-wide SSH scanning and credential spraying**, not a person who was given access and not a clearly targeted attack against `ai.tg11.org`.

Confidence in that conclusion is **high** because:

- Approximately 11,768 failure-like SSH connections came from 1,138 source addresses.
- Scanners supplied 1,378 different usernames dominated by default accounts and commodity wordlists.
- No attempted username contained `gage`, `skitt`, `tg11`, `remote-ai`, `remoteai`, or `raia`.
- The few AI-themed names occurred inside broad unrelated dictionaries: `claude` 5, `gemini` 3, `ollama` 3, `codex` 1, `deepseek` 1, and `ai` 1.
- Traffic showed fixed timing, machine-speed bursts, and rotation across adjacent addresses.
- Every accepted SSH login used public-key authentication from the known administrator source and the same known RSA key fingerprint.
- No password or keyboard-interactive login was accepted, and no unknown source or key fingerprint authenticated.
- Public telemetry independently identifies many of the observed addresses as high-volume SSH scanners or brute-force sources.

An Internet-reachable IPv4 address and open TCP port 22 are sufficient for discovery. An attacker does not need the hostname, an invitation, or prior knowledge of the application.

## Server-side evidence

### Authentication outcome

| Observation | Result |
|---|---:|
| Watchdog-regex journal events | 9,270 |
| Approximate distinct SSH processes represented by those events | 4,502 |
| Broader failure-like SSH processes/connections | 11,768 |
| Distinct source addresses in broader view | 1,138 |
| Distinct attempted username tokens | 1,378 |
| Accepted password logins | 0 |
| Accepted keyboard-interactive logins | 0 |
| Accepted public-key logins from unknown sources/keys | 0 |
| Fail2ban ban actions | 355 |
| Unique Fail2ban-banned addresses | 235 |
| Repeat-offender ban escalations | 94 |

The accepted-key event count includes legitimate interactive administration, deployment automation, and the read-only commands used for this assessment. All accepted events resolved to the same known source, account, and key fingerprint.

### Username behavior

Top attempted usernames by approximate distinct SSH process:

| Username | Approximate connections |
|---|---:|
| `root` | 5,768 |
| `ubuntu` | 1,142 |
| `admin` | 455 |
| `user` | 108 |
| `test` | 62 |
| `postgres` | 39 |
| `ftpuser` | 36 |
| `support` | 33 |
| `deploy` | 25 |
| `guest` | 25 |

Other names included common operating-system, database, VPN, game-server, CI/CD, network-appliance, and personal-name dictionary entries. This breadth is characteristic of generic account spraying rather than knowledge of this server's actual accounts.

### Automation indicators

- The largest five-minute bucket contained approximately 108 SSH processes from 54 addresses.
- Some individual sources created dozens of connections in under three minutes.
- Several adjacent address ranges rotated sources while using similar timing and username dictionaries.
- `217.60.255.130` generated approximately 1,983 failure-like SSH processes across all eight days, alternating almost exclusively between `root` and `ubuntu`. Its median interval was approximately 5.23 minutes, which is a strong scheduled-automation signature.
- The same slow scanner commonly remains below the configured Fail2ban threshold of four matching failures within ten minutes. This demonstrates the limit of per-address threshold banning against slow or distributed automation.

### Full-log network clusters

| Address/range | Approximate SSH processes | Interpretation |
|---|---:|---|
| `217.60.255.130` | 1,983 | Persistent low-and-slow `root`/`ubuntu` automation |
| `45.148.10.0/24` | 885 across 6 IPs | Rotating hosting-range scanner cluster |
| `195.178.110.0/24` | 552 across 5 IPs | Rotating adjacent sources |
| `62.60.130.0/24` | 519 across 3 IPs | Rotating adjacent sources |
| `92.118.39.0/24` | 485 across 5 IPs | Rotating sources; repeated Fail2ban escalation |

Shared infrastructure does not prove a shared human operator. It can indicate one tenant, a common bot image, a proxy service, or multiple compromised workloads at the same provider.

## Passive source profiles

Registration country and geolocation describe infrastructure, not the operator's identity or nationality. Public reputation totals change over time and may contain duplicate reports. They are corroborating evidence rather than proof by themselves.

| Source | Passive infrastructure profile | Corroborating public evidence |
|---|---|---|
| `207.166.168.11` | BytePlus AS150436 cloud/datacenter | [GreyNoise](https://viz.greynoise.io/ip/207.166.168.11), [RDAP](https://rdap.org/ip/207.166.168.11) |
| `51.75.253.68` | OVH AS16276 VPS | [AbuseIPDB](https://www.abuseipdb.com/check/51.75.253.68), [RDAP](https://rdap.org/ip/51.75.253.68) |
| `197.156.83.94` | Ethio Telecom AS24757 | [AlienVault OTX](https://otx.alienvault.com/indicator/ip/197.156.83.94), [RDAP](https://rdap.org/ip/197.156.83.94) |
| `104.143.77.9` | Datacenter IP AS13739 hosting | [AbuseIPDB](https://www.abuseipdb.com/check/104.143.77.9), [RDAP](https://rdap.org/ip/104.143.77.9) |
| `217.60.255.130` | SepehrSabz/Atrin AS204203 IDC | [AbuseIPDB](https://www.abuseipdb.com/check/217.60.255.130), [SANS ISC port-22 telemetry](https://isc.sans.edu/data/port/22), [RIPE RDAP](https://rdap.db.ripe.net/ip/217.60.255.130) |
| `196.0.242.54` | Uganda Telecom AS21491 | [AbuseIPDB](https://www.abuseipdb.com/check/196.0.242.54), [RDAP](https://rdap.org/ip/196.0.242.54) |
| `148.216.28.11` | University allocation announced by Alestra AS11172 | [AbuseIPDB](https://www.abuseipdb.com/check/148.216.28.11), [LACNIC RDAP](https://rdap.lacnic.net/rdap/ip/148.216.28.11) |
| `161.49.89.39` | Converge ICT AS17639 broadband | [AbuseIPDB](https://www.abuseipdb.com/check/161.49.89.39), [RDAP](https://rdap.org/ip/161.49.89.39) |
| `98.70.48.241` | Microsoft AS8075 Azure VM | [RDAP](https://rdap.org/ip/98.70.48.241), [RIPEstat](https://stat.ripe.net/data/as-overview/data.json?resource=AS8075) |
| `213.91.234.180` | Vivacom AS8866 fixed-line ISP | [AlienVault OTX](https://otx.alienvault.com/indicator/ip/213.91.234.180), [RDAP](https://rdap.org/ip/213.91.234.180) |
| `2.57.121.112` | UNMANAGED LTD AS47890 hosting | [AbuseIPDB](https://www.abuseipdb.com/check/2.57.121.112), [RDAP](https://rdap.org/ip/2.57.121.112) |
| `168.144.28.166` | DigitalOcean AS14061 cloud VM | [AbuseIPDB](https://www.abuseipdb.com/check/168.144.28.166), [RDAP](https://rdap.org/ip/168.144.28.166) |
| `34.63.42.56` | Google Cloud AS396982 VM | [AlienVault OTX](https://otx.alienvault.com/indicator/ip/34.63.42.56), [RDAP](https://rdap.org/ip/34.63.42.56) |
| `1.222.42.237` | LG Uplus AS3786 ISP | [AbuseIPDB](https://www.abuseipdb.com/check/1.222.42.237), [RDAP](https://rdap.org/ip/1.222.42.237) |
| `40.83.182.122` | Microsoft AS8075 Azure VM | [AbuseIPDB](https://www.abuseipdb.com/check/40.83.182.122), [RDAP](https://rdap.org/ip/40.83.182.122) |
| `45.162.8.14` | Fibrativa AS268485 ISP | [AbuseIPDB](https://www.abuseipdb.com/check/45.162.8.14), [RDAP](https://rdap.org/ip/45.162.8.14) |
| `200.175.61.207` | Telefônica Brasil AS18881 ISP | [AbuseIPDB](https://www.abuseipdb.com/check/200.175.61.207), [LACNIC RDAP](https://rdap.lacnic.net/rdap/ip/200.175.61.207) |
| `41.204.82.238` | CAMTEL AS15964 access network | [GreyNoise](https://viz.greynoise.io/ip/41.204.82.238), [Blocklist.de](https://api.blocklist.de/api.php?ip=41.204.82.238&start=1&format=json) |
| `43.133.61.254` | Tencent/Aceville AS132203 cloud | [GreyNoise](https://viz.greynoise.io/ip/43.133.61.254), [APNIC RDAP](https://rdap.apnic.net/ip/43.133.61.254) |
| `43.160.246.215` | Tencent/Aceville AS132203 cloud | [GreyNoise](https://viz.greynoise.io/ip/43.160.246.215), [APNIC RDAP](https://rdap.apnic.net/ip/43.160.246.215) |
| `154.83.196.237` | UCloud HK AS135377 datacenter | [GreyNoise](https://viz.greynoise.io/ip/154.83.196.237), [AbuseIPDB](https://www.abuseipdb.com/check/154.83.196.237) |
| `69.5.7.218` | BytePlus AS150436 cloud/datacenter | [GreyNoise](https://viz.greynoise.io/ip/69.5.7.218), [APNIC RDAP](https://rdap.apnic.net/ip/69.5.7.218) |
| `43.163.6.201` | Tencent/Aceville AS132203 cloud | [GreyNoise](https://viz.greynoise.io/ip/43.163.6.201), [APNIC RDAP](https://rdap.apnic.net/ip/43.163.6.201) |
| `15.235.192.186` | OVH AS16276 VPS | [GreyNoise](https://viz.greynoise.io/ip/15.235.192.186), [RDAP](https://rdap.org/ip/15.235.192.186) |
| `45.135.162.81` | Hosteons AS142036 VPS on leased IPXO space | [GreyNoise](https://viz.greynoise.io/ip/45.135.162.81), [RDAP](https://rdap.org/ip/45.135.162.81) |
| `163.7.8.79` | BytePlus AS150436 cloud/datacenter | [GreyNoise](https://viz.greynoise.io/ip/163.7.8.79), [AbuseIPDB](https://www.abuseipdb.com/check/163.7.8.79) |
| `45.148.10.183` | TECHOFF/DMZHOST AS48090 hosting | [GreyNoise](https://viz.greynoise.io/ip/45.148.10.183), [Shodan InternetDB](https://internetdb.shodan.io/45.148.10.183) |
| `45.78.202.217` | BytePlus AS150436 cloud | [AbuseIPDB](https://www.abuseipdb.com/check/45.78.202.217), [APNIC RDAP](https://rdap.apnic.net/ip/45.78.202.217) |
| `163.7.6.41` | BytePlus AS150436 cloud | [Blocklist.de](https://api.blocklist.de/api.php?ip=163.7.6.41&start=1&format=json), [Shodan InternetDB](https://internetdb.shodan.io/163.7.6.41) |
| `45.78.194.242` | BytePlus AS150436 cloud | [AbuseIPDB](https://www.abuseipdb.com/check/45.78.194.242), [APNIC RDAP](https://rdap.apnic.net/ip/45.78.194.242) |
| `45.78.201.248` | BytePlus AS150436 cloud | [AbuseIPDB](https://www.abuseipdb.com/check/45.78.201.248), [APNIC RDAP](https://rdap.apnic.net/ip/45.78.201.248) |
| `45.78.207.244` | BytePlus AS150436 cloud | [AbuseIPDB](https://www.abuseipdb.com/check/45.78.207.244), [APNIC RDAP](https://rdap.apnic.net/ip/45.78.207.244) |
| `45.78.204.246` | BytePlus AS150436 cloud | [AbuseIPDB](https://www.abuseipdb.com/check/45.78.204.246), [APNIC RDAP](https://rdap.apnic.net/ip/45.78.204.246) |

### Infrastructure clusters

- Eight reviewed alert sources route through BytePlus AS150436. Five neighboring `45.78.*` nodes shared the same passive SSH-only Debian/OpenSSH fingerprint. This is a strong common-fleet or common-image indicator, but not proof of one operator.
- Three reviewed sources were Tencent/Aceville AS132203 cloud nodes. This is a weaker provider cluster because common cloud infrastructure alone does not establish common control.
- `45.148.10.183`, `154.83.196.237`, and `217.60.255.130` had especially strong agreement across independent public sensors identifying automated scanning or SSH credential attacks.
- Sources assigned to broadband, university, and telecom networks may be compromised customer systems rather than machines deliberately operated by the network owner.

## Monitoring findings

### Watchdog ban count is a confirmed false negative

The deployed watchdog obtains ban events from:

```python
fail2ban_lines = journal(['-u', 'fail2ban'], window)
```

This host's Fail2ban logging target is `/var/log/fail2ban.log`, not the systemd unit journal. Consequently the alert's `Fail2ban ban events: 0` field does not reflect actual bans.

### Watchdog SSH count is not a connection count

The case-insensitive `Invalid user` expression matches both an initial invalid-user line and the later disconnect line containing `invalid user`. A single connection is therefore often counted twice. Conversely, many `root` attempts that disconnect before a matching authentication failure are omitted.

The alert remains useful as a volume trigger, but its number should be labeled “matching SSH log events,” not “attempts” or “connections.”

### Valid stolen keys would not trigger the current success rule

The watchdog alerts on accepted password and keyboard-interactive logins but not accepted public keys. Because root public-key login remains enabled, it should also alert when an accepted key has an unfamiliar fingerprint, source, or both.

## Recommended response

### Highest value

1. Put SSH behind Tailscale, WireGuard, another private management VPN, or a tightly controlled bastion.
2. Alternatively, allow TCP 22 only from trusted administrator source ranges using the Linode Cloud Firewall and host firewall. Preserve tested console/recovery access before applying an allowlist, especially if the administrator's ISP address can change.
3. After creating and validating a named sudo administrator account in a separate session, set `PermitRootLogin no`.

These controls remove the scanner's ability to reach SSH at all. Fail2ban cannot fully solve distributed or low-and-slow scanning.

### Monitoring corrections

1. Read timestamped ban actions from `/var/log/fail2ban.log`, or deliberately configure Fail2ban to log to the journal and verify the resulting service behavior.
2. Count distinct SSH process IDs or connection tuples instead of raw matching lines.
3. Add broader pre-auth categories separately: root/authenticating-user disconnects, key-exchange errors, bad banners, and negotiation failures.
4. Alert on accepted public keys outside an allowlist of expected key fingerprints and optionally expected source networks.
5. Keep the accepted-login allowlist outside email bodies and logs that do not require the full key fingerprint.

### Operational hygiene

1. Apply the pending standard security updates and complete the required reboot during a maintenance window.
2. Review `/root/.ssh/authorized_keys`, remove obsolete keys, and retain an offline recovery method.
3. Do not probe or scan the source addresses. Report persistent sources to their network abuse contacts with timestamped log excerpts if desired.

## Bottom line

Nobody needed to be told about this server. The public SSH listener was found automatically. The observed systems appear to be rented VPSs, cloud instances, broadband endpoints, and potentially compromised machines participating in commodity scanning. The authentication controls prevented every observed unauthorized login, but network-level restriction would substantially reduce exposure, noise, and dependence on reactive banning.

