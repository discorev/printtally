# Compatibility

Combinations that have been tested end to end: certificate trust, authentication,
job collection and paper names.

| Printer | Cartridges | Firmware | Operating system | Bun | Tested |
|---|---|---|---|---|---|
| imagePROGRAF PRO-1100 | PFI-4100 | 2.050 | macOS 27.2 | 1.3.9 | 2026-09-28 |

Other imagePROGRAF models may use the same protocol but have not been tested.
They could differ in authentication, encryption or the job fields they report.
Print Tally stops with an error rather than guessing when a printer replies in an
unexpected way.

Windows and Linux have not been tested. Password storage uses the system credential
store (Windows Credential Manager, or a persistent Secret Service keyring on Linux).
Outside macOS, or when the printer is on a different network, Print Tally cannot look
up the printer's MAC address; enter it during printer setup.

## Reporting a new combination

Open an issue or pull request with the printer model, firmware version, operating
system, Bun version and whether printer setup and collection succeeded. Do not include
IP addresses, MAC addresses, certificates, job names or other details from your
network or print history.
