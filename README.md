# router

> Collects messages from chat connectors, parses commands, and emits command executions — the central nervous system of eevee.

## Overview

The router is the core message-routing module in the eevee ecosystem. It sits between **connectors** (which receive messages from chat platforms like IRC and Discord) and **command modules** (which handle specific bot commands like `!weather` or `!dice`). When a chat message arrives, the router decides whether it matches a registered command or broadcast, enforces rate limits, and dispatches the message to the appropriate handler.

Without the router, every eevee module would need to listen to all chat traffic and do its own command matching. The router centralizes that responsibility: modules register their command patterns, and the router handles the rest — matching, filtering, blocking, rate limiting, and delivery.

The router communicates entirely over **NATS**, making it language-agnostic and deployable independently. It exposes an HTTP metrics endpoint for Prometheus scraping and responds to admin and stats requests over NATS.

## Features

- **Command routing** — Modules register command regex patterns; the router matches incoming messages and publishes to `command.execute.<uuid>` subjects
- **Broadcast routing** — Modules register broadcast filters; the router forwards matching messages to `broadcast.message.<uuid>` subjects
- **Prefix handling** — Supports both platform-specific prefixes (e.g., `!`) and nick-based addressing (e.g., `eevee: weather`)
- **Configurable blocklist** — Drop messages matching regex patterns, scoped by platform, network, instance, channel, or user
- **Rate limiting** — Per-command rate limits with configurable level (global, platform, instance, channel, user), interval, and overflow behavior (drop or enqueue)
- **Admin API** — NATS-based admin endpoints for inspecting the command registry and rate-limit statistics
- **Prometheus metrics** — Counters for messages, commands, broadcasts, registrations, rate limits, and processing times
- **Stats reporting** — Responds to `stats.emit.request` and `stats.uptime` with module health data
- **Graceful shutdown** — Drains NATS connections and cleans up registries on SIGINT/SIGTERM

## Install

This module is part of the eevee ecosystem and is not published independently. Install via the workspace:

```bash
cd /path/to/eevee/router
npm install
```

## Configuration

### Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `NATS_HOST` | Yes | — | NATS server hostname (e.g. `nats://localhost:4222`) |
| `NATS_TOKEN` | Yes | — | NATS authentication token |
| `MODULE_CONFIG_PATH` | Yes | — | Path to the router YAML config file |
| `HTTP_API_PORT` | No | `9000` | Port for the Prometheus metrics HTTP server |

### Router Config File (`router.yaml`)

Specified via `MODULE_CONFIG_PATH`. The config file controls the message blocklist.

```yaml
blocklist:
  # Block messages matching a pattern on all platforms
  - pattern: ".*spam.*"
    enabled: true
    description: "Block messages containing the word spam"
    platform: ".*"

  # Block only on a specific platform
  - pattern: ".*buy now.*"
    enabled: true
    description: "Block 'buy now' phrases on IRC"
    platform: "irc"

  # Target a specific network and channel
  - pattern: ".*test spam.*"
    enabled: true
    description: "Block test spam in a specific IRC channel"
    platform: "irc"
    network: "libera"
    channel: "#bots"

  # Ignore all messages from a specific user
  - pattern: ".*"
    enabled: true
    description: "Ignore all messages from a specific Discord user"
    platform: "discord"
    user: "annoying-user.*"

  # Disabled entries are skipped
  # - pattern: ".*test.*"
  #   enabled: false
  #   description: "Disabled blocklist entry"
  #   platform: ".*"
```

#### Blocklist Entry Fields

| Field | Required | Description |
|---|---|---|
| `pattern` | Yes | Regex matched against the message text |
| `enabled` | No | Set to `false` to disable the entry (defaults to `true`) |
| `description` | No | Human-readable description |
| `platform` | No | Regex matched against the message platform (e.g. `irc`, `discord`) |
| `network` | No | Regex matched against the network name |
| `instance` | No | Regex matched against the instance identifier |
| `channel` | No | Regex matched against the channel name |
| `user` | No | Regex matched against the user identifier |

All regex fields are matched case-sensitively. Omitted scope fields default to matching everything.

Blocklist patterns are pre-compiled at config load time using the safe `compileRegex` helper (500 character limit, fallback to `/.^/` on failure). Malformed patterns are logged and skipped rather than crashing the router.

## Usage / Commands

### Running

```bash
npm run dev    # Build and run locally
npm run build  # Build only
```

### NATS Subjects

The router subscribes to and publishes on the following NATS subjects:

#### Inbound (subscribed)

| Subject | Purpose |
|---|---|
| `chat.message.incoming.>` | Incoming chat messages from connectors |
| `command.register` | Command registration requests from modules |
| `broadcast.register` | Broadcast registration requests from modules |
| `command.unregister` | Command unregistration requests from modules |
| `broadcast.unregister` | Broadcast unregistration requests from modules |
| `admin.request.router` | Admin queries (rate-limit stats, command registry) |
| `stats.emit.request` | Stats collection requests |
| `stats.uptime` | Uptime queries |

#### Outbound (published)

| Subject | Purpose |
|---|---|
| `command.execute.<uuid>` | Dispatch a matched command to its handler module |
| `broadcast.message.<uuid>` | Forward a message to a broadcast subscriber |
| `control.registerCommands` | Prompt all modules to re-register commands |
| `control.registerBroadcasts` | Prompt all modules to re-register broadcasts |
| `control.registerCommands.<name>` | Prompt a specific module to re-register |
| `chat.notice.outgoing.irc.<instance>` | Send an IRC NOTICE (rate-limit notifications, 15s cooldown per user) |
| `help.remove` | Remove help entries for a module |
| `admin.response.router.ratelimit-stats` | Admin response with rate-limit data |
| `admin.response.router.command-registry` | Admin response with command registry data |

### Command Registration

Modules register commands by publishing to `command.register`:

```json
{
  "type": "command.register",
  "commandUUID": "weather-irc-libera",
  "commandDisplayName": "weather",
  "platform": "irc",
  "network": "libera",
  "channel": ".*",
  "regex": "^!weather\\s+(.*)",
  "platformPrefixAllowed": true,
  "nickPrefixAllowed": true,
  "ratelimit": {
    "mode": "drop",
    "level": "user",
    "limit": 5,
    "interval": "30s"
  }
}
```

#### Command Registration Fields

| Field | Required | Description |
|---|---|---|
| `type` | Yes | Must be `"command.register"` |
| `commandUUID` | Yes | Unique identifier for this command registration |
| `commandDisplayName` | No | Human-readable name for logs and admin UI |
| `platform` | No | Regex for platform matching (default `".*"`) |
| `network` | No | Regex for network matching (default `".*"`) |
| `instance` | No | Regex for instance matching (default `".*"`) |
| `channel` | No | Regex for channel matching (default `".*"`) |
| `user` | No | Regex for user matching (default `".*"`) |
| `nick` | No | Regex for nick matching (default `".*"`) |
| `regex` | Yes | Regex pattern to match against the command text |
| `platformPrefixAllowed` | Yes | Whether the platform's common prefix (e.g. `!`) is accepted |
| `nickPrefixAllowed` | No | Whether the bot's nick can prefix the command |
| `ratelimit` | Yes | Rate limiting configuration (see below) |

#### Rate Limit Configuration

| Field | Required | Description |
|---|---|---|
| `mode` | Yes | `"drop"` (discard excess) or `"enqueue"` (queue for later execution) |
| `level` | Yes | Granularity: `"global"`, `"platform"`, `"instance"`, `"channel"`, or `"user"` |
| `notificationCooldown` | No | Seconds between rate-limit notices to the same user (default: 15) |
| `limit` | Yes | Max allowed executions per interval (`0` disables rate limiting) |
| `interval` | Yes | Time window, e.g. `"30s"`, `"5m"`, `"1h"` |

### Broadcast Registration

Modules register broadcasts by publishing to `broadcast.register`:

```json
{
  "type": "broadcast.register",
  "broadcastUUID": "logger-all",
  "broadcastDisplayName": "logger",
  "platform": ".*",
  "channel": ".*",
  "messageFilterRegex": ".*"
}
```

#### Broadcast Registration Fields

| Field | Required | Description |
|---|---|---|
| `type` | Yes | Must be `"broadcast.register"` |
| `broadcastUUID` | Yes | Unique identifier for this broadcast registration |
| `broadcastDisplayName` | No | Human-readable name for logs |
| `platform` | No | Regex for platform matching (default `".*"`) |
| `network` | No | Regex for network matching (default `".*"`) |
| `instance` | No | Regex for instance matching (default `".*"`) |
| `channel` | No | Regex for channel matching (default `".*"`) |
| `user` | No | Regex for user matching (default `".*"`) |
| `nick` | No | Regex for nick matching (default `".*"`) |
| `messageFilterRegex` | No | Additional regex filter on message text |

## Architecture

```
                          ┌─────────────┐
   Connectors ──────────►│             │
  (IRC, Discord, ...)    │   Router    │────► command.execute.<uuid>
                          │             │────► broadcast.message.<uuid>
                          │             │
  Modules ──────────────►│             │◄──── admin.request.router
  (register commands)    │             │
                          └──────┬──────┘
                                 │
                    ┌────────────┼────────────┐
                    ▼            ▼            ▼
             CommandRegistry  Broadcast   RateLimiter
                              Registry    (queue + cleanup)
```

### Message Flow

1. A **connector** receives a chat message and publishes it to `chat.message.incoming.<platform>.<network>.<instance>.<channel>`
2. The router parses the message and checks the **blocklist** — blocked messages are dropped
3. The router checks the **command registry** for matching commands, handling prefix stripping (platform prefix or nick addressing)
4. The router checks the **broadcast registry** for matching broadcasts
5. If no commands or broadcasts match, the message is dropped
6. For each matching command, the **rate limiter** is consulted:
   - If allowed: publish to `command.execute.<uuid>`
   - If rate-limited in `drop` mode: silently discard
   - If rate-limited in `enqueue` mode: queue for later processing
7. For each matching broadcast: publish to `broadcast.message.<uuid>`

### Internal Components

| Component | File | Purpose |
|---|---|---|
| `main.mts` | Entry point | NATS setup, subscription wiring, startup |
| `CommandRegistry` | `lib/command-registry.mts` | Stores registered commands, matches incoming text against command regexes |
| `BroadcastRegistry` | `lib/broadcast-registry.mts` | Stores registered broadcasts, matches incoming messages against scope + filter regexes |
| `RateLimiter` | `lib/rate-limiter.mts` | Tracks execution counts per key, enforces limits, processes queued commands |
| `PlatformNotifier` | `lib/notifier.mts` | Sends rate-limit notices to users (IRC NOTICE support) |
| `message-handler` | `lib/message-handler.mts` | Core routing logic — blocklist check, command/broadcast matching, dispatch |
| `registration-handler` | `lib/registration-handler.mts` | Processes `command.register` and `broadcast.register` messages |
| `admin-handler` | `lib/admin-handler.mts` | Handles admin queries for rate-limit stats and command registry inspection |
| `stats-handler` | `lib/stats-handler.mts` | Responds to stats/uptime requests |
| `router-config` | `lib/router-config.mts` | Loads and validates the YAML config file |
| `compile-regex` | `lib/compile-regex.mts` | Safe regex compilation with ReDoS protection (500 char limit, fallback to `/.^/`) |
| `nats-setup` | `lib/nats-setup.mts` | Establishes NATS connection from environment variables |

### Prometheus Metrics

The router exposes both shared libeevee metrics and router-specific ones at `http://localhost:<HTTP_API_PORT>/metrics`:

| Metric | Type | Labels | Description |
|---|---|---|---|
| `broadcasts_total` | Counter | module, broadcast_uuid, platform, network, channel | Broadcasts processed |
| `registrations_total` | Counter | module, type, result | Registration events |
| `rate_limits_total` | Counter | module, command_uuid, action, mode | Rate limit events |
| `messages_total` | Counter | module, direction, result | Messages received (from libeevee) |
| `commands_total` | Counter | module, result | Commands dispatched (from libeevee) |

## Development

```bash
# Install dependencies
npm install

# Lint
npm test

# Build
npm run build

# Run locally (build + execute)
npm run dev

# Update libeevee
npm run update-libraries
```

### Requirements

- Node.js ≥ 24.0.0
- A running NATS server with token auth

## Contributing

Contributions are welcome! Open an issue, fork, branch, PR. Run `npm run build` before submitting — it lints and compiles.

## License

[CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) — see [LICENSE](./LICENSE) for the full text.
