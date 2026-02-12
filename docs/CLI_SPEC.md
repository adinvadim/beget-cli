# Beget CLI MVP Spec (create-cli based)

## 1) Name
`beget`

## 2) One-liner
Practical command-line client for Beget API with local profile management.

## 3) Usage
- `beget [global flags] <group> <command> [args]`
- `beget auth add <name> [--login <login>] [--dry-run] [--no-input]`
- `beget auth list`
- `beget auth use <name> [--dry-run]`
- `beget auth remove <name> [--dry-run]`
- `beget account info`
- `beget domains list [--all] [--expiring-days <days>]`
- `beget domains expiring [--days <days>] [--all]`
- `beget dns list <domain>`
- `beget dns ns-get <domain>`
- `beget dns ns-set <domain> <ns1> <ns2> [--ip1 <ip> --ip2 <ip>]`

## 4) Global flags
- `-h, --help` Show help.
- `--version` Print CLI version.
- `--config <path>` Custom config file path.
- `--profile <name>` Profile to use for this run.
- `--login <login>` Override login for this run.
- `--base-url <url>` Override Beget API base URL (default: `https://api.beget.com/api`).
- `--timeout <ms>` Request timeout in ms (default: `20000`).
- `--json` JSON output for machine use.

## 5) Output contract
- **stdout**: successful result, human text by default or JSON with `--json`.
- **stderr**: all errors and diagnostics.
- Human output is concise and workflow-friendly.

## 6) Subcommand behavior
- `auth add <name>`: prompts for login + API password (masked), stores profile securely. Supports `--dry-run`.
- `auth list`: shows saved profiles and active marker.
- `auth use <name>`: marks profile active. Supports `--dry-run`.
- `auth remove <name>`: deletes profile and reassigns active profile if needed. Supports `--dry-run`.
- `account info`: calls `user/getAccountInfo`.
- `domains list`: calls `domain/getList`; by default returns only active/managed domains (`is_under_control=1`), use `--all` to include everything. Adds `days_to_expire` and `expires_soon` fields (`--expiring-days`, default 30).
- `domains expiring`: same source, but returns only `expires_soon=true` rows (`--days`, default 30), sorted by nearest expiration.
- `dns list <domain>`: calls `dns/getData` with JSON input.

## 7) Env/config precedence
For credentials/runtime settings:
1. **Flags** (`--profile`, `--login`, `--base-url`, `--config`, `--timeout`)
2. **Environment** (`BEGET_PROFILE`, `BEGET_LOGIN`, `BEGET_API_PASSWORD` or `BEGET_API_KEY`, `BEGET_API_BASE_URL`, `BEGET_CONFIG`)
3. **User config** active profile at XDG path.

Notes:
- API password is intentionally not accepted as CLI flag (to avoid shell history leaks).
- `auth add` reads API password from interactive prompt or `BEGET_API_PASSWORD` (fallback: `BEGET_API_KEY`) in `--no-input` mode.

## 8) Config storage
- Default path:
  - `$XDG_CONFIG_HOME/beget-cli/config.json` if `XDG_CONFIG_HOME` exists;
  - else `~/.config/beget-cli/config.json`.
- JSON format:
```json
{
  "version": 1,
  "activeProfile": "main",
  "profiles": {
    "main": { "login": "user123", "apiKey": "***" }
  }
}
```
- Permissions enforced:
  - directory: `0700`
  - config file: `0600`

## 9) Exit codes
- `0` success
- `1` generic/unexpected error
- `2` usage/validation error
- `3` auth error (missing/invalid credentials)
- `4` Beget API method/protocol error
- `5` config read/write/profile error
- `6` network/timeout/HTTP error

## 10) Safety rules
- `--dry-run` for all state-changing auth commands.
- No destructive server actions in MVP.
- No secrets in command args.

## 11) Examples
- `beget auth add personal`
- `beget auth add personal --dry-run --login mylogin`
- `BEGET_API_PASSWORD=... beget auth add personal --login mylogin --no-input`
- `beget auth list`
- `beget auth use personal`
- `beget account info --json`
- `beget domains list --json`
- `beget dns list example.com --json`
