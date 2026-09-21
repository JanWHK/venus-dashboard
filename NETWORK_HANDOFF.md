# Local VLAN 21 Network Handoff

Last updated: 2026-09-17 (Africa/Windhoek)

## Objective

Make the existing `192.168.21.0/24` Wi-Fi/device network a locally routed network behind pfSense at `192.168.100.1`, with direct access from the workstation at `192.168.100.10` to devices such as the Victron GX at `192.168.21.194`.

The Tenda O3 V2.0 had been factory-reset and initially returned to `192.168.2.1`. It is now an access point and VLAN bridge; pfSense owns routing, DHCP, firewalling, and NAT.

Do not put credentials in this file. The operator supplied pfSense, Tenda, Wi-Fi, and potentially GX credentials in chat/out-of-band. In particular, the restored Wi-Fi password is the **nine-character prior value**, not the incorrect ten-character value used during early testing.

## Intended topology

```text
Workstation/LAN clients
192.168.100.0/24
        |
        | untagged LAN
        v
pfSense 192.168.100.1
  vtnet1 (LAN)
  vtnet1.21 (LOCAL21) 192.168.21.1/24
        |
        | 802.1Q VLAN 21 trunk
        v
Tenda O3 AP
  management: 192.168.21.2/24, VLAN 21
  WLAN traffic: VLAN 21 tagged
  Ethernet/native PVID: VLAN 1
        |
        +-- Wi-Fi clients in 192.168.21.0/24
        +-- Victron GX 192.168.21.194
```

## Applied pfSense configuration

pfSense: `https://192.168.100.1/`

- Created VLAN tag `21` on parent interface `vtnet1`.
- VLAN description: `LOCAL_LAN_21`.
- Assigned the VLAN as pfSense interface `opt1`.
- Enabled and renamed the assigned interface to `LOCAL21`.
- Interface address: `192.168.21.1/24`.
- No upstream gateway is assigned to LOCAL21.
- Private-network and bogon blocking are disabled on LOCAL21 because it is an internal RFC1918 network.
- Enabled ISC DHCP on LOCAL21.
- DHCP pool: `192.168.21.100` through `192.168.21.250`.
- Default DHCP gateway/DNS behavior is used, so clients should receive `192.168.21.1`.
- Added firewall rule on LOCAL21:
  - Action: pass
  - Address family: IPv4
  - Protocol: any
  - Source: LOCAL21 subnets
  - Destination: any
  - Description: `Allow LOCAL21 to routed networks`
- pfSense outbound NAT is in hybrid mode. Its automatic rules include `192.168.21.0/24`.
- Existing LAN IPv4 rule is `LAN subnets -> any`, gateway `none`.
- DHCP was explicitly restarted and verified listening on both:
  - `vtnet1` for `192.168.100.0/24`
  - `vtnet1.21` for `192.168.21.0/24`

### pfSense backup

A pre-change configuration backup was downloaded to:

```text
/tmp/pfsense-pre-vlan21-20260916.xml
```

This is a sensitive, temporary file and may disappear after reboot or cleanup. Move it to an operator-approved secure location if it must be retained. Do not commit it.

## Applied Tenda O3 configuration

Model/title: `O3V2.0`

Observed firmware: `V1.0.0.12(3880)`; hardware V2.0.

- Operating mode: AP.
- Device name: `Tenda-O3-AP`.
- Management address: `192.168.21.2/24`.
- Default gateway: `192.168.21.1`.
- Primary DNS: `192.168.21.1`.
- VLAN enabled.
- PVID: `1`.
- Management VLAN: `21`.
- WLAN VLAN ID: `21`.
- LAN VLAN ID: `1`.
- Tenda API reports `trunkport: "1;0"`.
- SSID: `Tenda_875270`.
- Country/region: South Africa (`ZA`), the closest available regulatory profile for Namibia.
- Channel: `1`.
- Channel width: `20 MHz`.
- Wireless mode: `11b/g/n`.
- Current security compatibility mode: mixed WPA/WPA2-PSK with TKIP+AES.
- The correct prior Wi-Fi password is active. It is not stored in this file.

The compatibility security mode is intentional for the legacy TP-Link extender. Once that extender is reconfigured or replaced, upgrade the Tenda to WPA2-PSK/AES and retest every client.

### Important Tenda management behavior

When management VLAN was temporarily set to `1`, the Tenda tagged management traffic and became unreachable from the ordinary untagged LAN. Recovery via a tagged workstation VLAN proved this behavior.

The final configuration places both Tenda management and WLAN traffic in VLAN 21. Tenda management at `192.168.21.2` is reachable directly from a VLAN 21 host. It may intentionally reject management from a routed, non-management VLAN; do not use that as the sole forwarding test.

## Key discovery: original Wi-Fi password mismatch

Early restoration used an incorrect ten-character password copied from an older shared troubleshooting record. After the operator supplied the actual previous nine-character password, clients immediately re-associated.

After correction, the Tenda online-device list showed multiple clients. Significant entries included:

| IP | MAC | Meaning/status |
|---|---|---|
| `192.168.21.194` | `B8:4D:43:13:39:54` | Victron Venus GX; online and directly reachable on VLAN 21 |
| blank / formerly `.125` | `02:31:92:B4:3E:45` | Associated client that historically requested `192.168.21.125`; had not completed DHCP at the last check |
| `192.168.21.145` | `06:76:FD:C6:52:D9` | Associated client |
| `192.168.21.120` | `02:31:92:5F:A0:0F` | Associated client |
| `192.168.178.100` | `02:31:92:AB:99:20` | Associated client retaining an address from another subnet; likely stale configuration/lease |

Locally administered `02:*` MAC addresses are likely randomized/private client MACs and may change.

## Evidence and test results

### VLAN and pfSense infrastructure

- Direct tagged VLAN 21 from the workstation to pfSense `192.168.21.1`: success, 0% packet loss.
- Direct tagged VLAN 21 from the workstation to Tenda `192.168.21.2`: success, 0% packet loss.
- This proves the switch/path passes VLAN 21 tags in both directions.
- Workstation route without the temporary VLAN interface:

```text
192.168.21.194 via 192.168.100.1 dev enp4s0 src 192.168.100.10
```

### GX device at 192.168.21.194

- Direct tagged VLAN 21 ping from workstation: success, 4/4 replies.
- Direct Playwright HTTP request: HTTP 200.
- Page title: `Venus GX - SSL certifcate note` (spelling as returned by the device).
- HTTPS redirects to:

```text
https://192.168.21.194/auth/login.php?page=/
```

- Login username is prefilled as `remoteconsole`.
- A GX Remote Console password is required and was not available at handoff time.

### Source-specific pfSense diagnostics

Using pfSense Diagnostics > Ping:

- Source LOCAL21 (`192.168.21.1`) to `192.168.21.194`: success, 3/3 replies.
- Source LAN (`192.168.100.1`) to `192.168.21.194`: failure, 0/3 replies.
- Workstation `192.168.100.10` through pfSense to `192.168.21.194`: no reply and HTTP timeout.

This proves pfSense, VLAN tagging, Tenda bridging, and the GX's local connectivity are working. The remaining problem is the GX return path. The GX likely retained an old DHCP lease, a `/16` mask, or a stale/missing default gateway. A `/16` mask would cause it to ARP locally for `192.168.100.x` instead of returning traffic through `192.168.21.1`.

### Historical DHCP evidence

Before VLAN 21 existed, pfSense repeatedly logged:

```text
DHCPREQUEST for 192.168.21.125 from 02:31:92:b4:3e:45 via vtnet1: wrong network
DHCPNAK on 192.168.21.125 ... via vtnet1
```

The phone also historically requested `192.168.21.116` from MAC `02:31:92:16:91:32` and was rejected on untagged `vtnet1`.

This is the original failure the VLAN design corrects: those requests must arrive on `vtnet1.21`, where pfSense now has the matching DHCP scope.

## Current temporary workstation state

Main physical interface: `enp4s0`.

Observed addresses before handoff:

- `192.168.100.10/24` (normal workstation address)
- `192.168.2.10/24` (temporary address used for the factory-reset Tenda)

Temporary NetworkManager profiles created during recovery:

1. `tenda-recovery-vlan1`
   - VLAN ID 1 on `enp4s0`
   - Addresses `192.168.100.11/24` and `192.168.21.11/24`
   - Inactive at handoff
2. `tenda-recovery-vlan21`
   - VLAN ID 21 on `enp4s0`
   - Address `192.168.21.11/24`
   - **Active at handoff** so the next agent can reach the GX/Tenda directly

Do not remove `tenda-recovery-vlan21` until the GX return-path fix is complete and routed access has been independently verified.

## Playwright execution details

The in-app browser capability was unavailable, so the operator explicitly authorized standalone Playwright.

Playwright module:

```text
/home/janj/.npm-global/lib/node_modules/agent-browser/node_modules/playwright-core
```

Chrome executable:

```text
/usr/bin/google-chrome
```

Temporary authenticated browser states:

```text
/tmp/pfsense-state.json
/tmp/tenda-21-state.json
/tmp/tenda-100-state.json
/tmp/tenda-state.json
```

Sessions may expire after device reboot. Re-login using operator-supplied credentials; do not embed passwords in scripts, logs, or repository files.

## Next-agent completion checklist

### 1. Fix the GX network return path

Preferred approach:

1. Obtain the GX Remote Console password from the operator.
2. With `tenda-recovery-vlan21` active, use Playwright to open `https://192.168.21.194/` with HTTPS errors ignored.
3. Log in as `remoteconsole`.
4. In the GX network settings for the connected Wi-Fi interface, either:
   - select automatic/DHCP addressing, or
   - configure static `192.168.21.194/24`, gateway `192.168.21.1`, DNS `192.168.21.1`.
5. If DHCP is selected and `.194` must remain stable, add a pfSense DHCP static mapping for MAC `B8:4D:43:13:39:54` to `192.168.21.194` before renewing the GX lease.

Fallback if the GX password is unavailable:

1. Ask the operator to reboot the Venus GX cleanly.
2. Watch pfSense DHCP logs for a request on `vtnet1.21`.
3. Confirm it receives `/24`, gateway `192.168.21.1`, and DNS `192.168.21.1`.

Do not reset the GX.

### 2. Verify routed access

After fixing/renewing the GX configuration:

1. Confirm pfSense source `LOCAL21` to `.194` still succeeds.
2. Confirm pfSense source `LAN` to `.194` succeeds.
3. Deactivate the temporary direct VLAN profile:

```bash
nmcli connection down tenda-recovery-vlan21
```

4. Verify the host route:

```bash
ip route get 192.168.21.194
```

Expected result must use gateway `192.168.100.1`, device `enp4s0`, source `192.168.100.10`.

5. Verify ping and Playwright HTTP/HTTPS access to `.194` from the normal host path.

### 3. Verify the `.125` client

- Check the Tenda online list and pfSense DHCP leases/logs.
- Expected historical MAC: `02:31:92:B4:3E:45`.
- Its DHCP request must appear on `vtnet1.21`, not `vtnet1`.
- If necessary, reconnect or reboot only that client/extender; do not reset the Tenda.

### 4. Cleanup temporary workstation configuration

Only after routed `.194` access works:

```bash
nmcli connection down tenda-recovery-vlan21
nmcli connection delete tenda-recovery-vlan21
nmcli connection delete tenda-recovery-vlan1
```

Then remove the temporary `192.168.2.10/24` address from `enp4s0`, leaving only `192.168.100.10/24`. Determine whether the address was added through NetworkManager or directly with `ip` before removing it; do not bounce the primary LAN connection unnecessarily.

Recheck Internet access, pfSense access, and the route to `.194` after cleanup.

### 5. Security follow-up

These are follow-up items, not prerequisites for restoring routing:

- Change the Tenda's default administrator password.
- Reconfigure or replace the legacy TP-Link extender so the Tenda can use WPA2-PSK/AES instead of mixed WPA/WPA2 with TKIP+AES.
- Store network credentials in an approved secret manager, never in this repository.
- Move or securely delete the temporary pfSense backup and Playwright state files when no longer needed.

## Do not undo

- Do not remove pfSense VLAN 21 or LOCAL21 while troubleshooting the GX.
- Do not restore the broad `192.168.0.0/16` WireGuard route as the path for `192.168.21.0/24`; the directly connected `/24` must remain authoritative.
- Do not factory-reset the Tenda again.
- Do not change the workstation back to only `192.168.100.10` until routed access to `.194` is proven, because the active temporary VLAN 21 interface is currently the recovery path.

---

## Status update — 2026-09-21 (Helio dashboard integration)

The operator reports the VLAN 21 network is now fixed and working. Verified from this
workstation during Helio integration:

- The GX answers at `192.168.21.10` (not the `.194` recorded above — the device was
  re-addressed or replaced; `B8:4D:43:13:39:54` above may not match). CLAUDE.md has the
  current address.
- MQTT is enabled with authentication: TLS on port **8883** (username/password), broker
  certificate self-signed. Ports 1883/9001 refuse or fail auth; port 80
  `/websocket-mqtt` returns 302. Helio connects with `MQTT_TLS_INSECURE=true` for this
  reason (encrypted but unverified peer — LAN only).
- Helio reads live telemetry from the GX: 4 devices, ~1,100 live data points.

**Still open from the checklist above (do not skip):**

1. Routed-access verification (step 2) was never performed with the operator's fix —
   `tenda-recovery-vlan21` is **still active** on this workstation and may be masking
   the routed path. Confirm `ip route get 192.168.21.10` uses `192.168.100.1` before
   deleting anything.
2. The `.125` client check (step 3), temp-profile cleanup (step 4), and the security
   follow-ups (step 5) remain pending.
