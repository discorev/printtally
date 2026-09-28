# Print Tally

Print Tally keeps a permanent record of every print from a Canon imagePROGRAF
printer: the ink used on each channel, the paper, the size and when it was printed.
That record is the basis for working out what each print actually cost.

## Why it exists

Canon's own Accounting Manager does not run on macOS 27. Print Tally reads the same
job history directly from the printer over the network, so it needs no Canon
software. The printer only keeps a limited number of recent jobs (220 on the
PRO-1100); Print Tally keeps every job it has ever collected.

## Supported printers and systems

Tested on the imagePROGRAF PRO-1100 under macOS. See
[COMPATIBILITY.md](COMPATIBILITY.md) for tested printers, firmware and operating
systems, and how to report a new one.

## Getting started

You need [Bun](https://bun.sh) 1.3.9 or newer, the printer on your network
with a fixed IP address, and the printer's administrator password.

### 1. Install

```sh
git clone <repository-url> printtally
cd printtally
bun install
```

Print Tally keeps its settings and archive in a data folder:
`~/Library/Application Support/printtally` on macOS, `~/.printtally` on Linux and
`%APPDATA%\printtally` on Windows. The commands below use the macOS folder.

### 2. Trust the printer's certificate

Print Tally only talks to the printer over verified HTTPS. The printer signs its
connection with its own root certificate, which you download and check once.

1. Open the printer's Remote UI in a browser (`https://<printer-ip>`), go to
   **For secure communication** and download the root certificate.
2. On the printer's control panel, open **Printer information > System information
   > Root cert. thumbprint (SHA-256)**.
3. Convert the download and compare its fingerprint with the one on the printer:

   ```sh
   DATA="$HOME/Library/Application Support/printtally"
   mkdir -p "$DATA"
   openssl x509 -inform DER -in ~/Downloads/cert_root.der -out "$DATA/printer-root.pem"
   openssl x509 -in "$DATA/printer-root.pem" -noout -fingerprint -sha256
   ```

Only continue if the two fingerprints match. Canon's
[root certificate instructions](https://ij.manual.canon/ij/webmanual/Manual/All/PRO-1100%20series/EN/UG/ug_d106.html)
cover the printer side in more detail.

### 3. Describe your printer

Create `printer.json` in the data folder with your printer's address, its MAC address (shown in
the printer's network settings) and the certificate from step 2:

```json
{"host": "192.0.2.10", "mac": "02:00:00:00:00:01", "certificateFile": "printer-root.pem"}
```

On macOS the MAC can be left out when the printer is on the same network; Print Tally
looks it up. Including it keeps the stored password attached to the printer if its
IP address changes.

### 4. Check the connection and save the password

```sh
bun run cli probe
bun run cli password
```

`probe` confirms Print Tally can reach the printer and lists the job fields it
reports; it needs no password. `password` asks for the administrator password
without echoing it and stores it in your system's credential store (Keychain on
macOS). It is never written to a file.

### 5. Collect your print history

```sh
bun run cli collect --csv jobs.csv
bun run cli summary
```

Each collection adds any new jobs to the archive in the data folder, writes a JSON
export of what was collected alongside it and, with `--csv`, a CSV where you ask. Run it often enough that jobs are
collected before they drop out of the printer's limited log.

`bun run cli --help` lists the other commands, including `annotate` to correct a
job's paper name, hide a job or add notes, and `serve` to run the local API.

## Licence and disclaimer

Released under the [MIT License](LICENSE).

Print Tally is an independent project. It is not affiliated with, endorsed by or
sponsored by Canon Inc. or its subsidiaries. Canon, imagePROGRAF and related marks
are trademarks of Canon Inc., used here only to identify compatible printers.
Canon software is not included or required. The printer protocol was implemented
for interoperability. Use it at your own risk: it is provided without warranty,
and ink, paper and cost figures should be checked before billing or accounting
decisions rely on them.
