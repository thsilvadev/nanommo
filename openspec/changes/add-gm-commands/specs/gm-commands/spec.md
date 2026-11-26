# GM commands

## ADDED Requirements

### Requirement: GM role

An account SHALL be a GM when its `users.role` is `gm`. The role SHALL be read from the database for every command, so revoking it takes effect immediately. When the role cannot be read (column missing before the migration), the account SHALL be treated as a player.

#### Scenario: Player types a GM command
- WHEN an account with role `player` sends `/start-event smashing-spree 5`
- THEN the server answers `UNKNOWN_COMMAND`, exactly as for any unknown command
- AND nothing is scheduled.

### Requirement: GM commands from chat

The chat SHALL send every slash command other than `/sleep`, `/dance` and `/sit` to the server as `gm:command { line }`, never to global chat. Arguments SHALL be separated by spaces, with double quotes keeping a name with spaces together. A successful command SHALL answer with a message shown as a System line; a rejected one SHALL answer with the reason and the command's usage. Every executed GM command SHALL be logged with the GM's character name and arguments.

#### Scenario: Help
- WHEN a GM sends `/gm-help`
- THEN the answer lists every GM command with its usage.

### Requirement: Start an event on demand

`/start-event <event-code> <minutesToEvent>` SHALL schedule the named event to start in `minutesToEvent` whole minutes (0 to 1440), sending the event's configured countdown announcements whose minutes are at most the lead time, then the start announcement. The Smashing Spree's code SHALL be `smashing-spree`. Starting a Smashing Spree immediately while one is live SHALL be refused.

#### Scenario: Twenty minutes ahead
- WHEN a GM sends `/start-event smashing-spree 20`
- THEN "starts in 15/5/1 minutes" announcements are sent 5, 15 and 19 minutes later
- AND the event starts 20 minutes later with its vases and lasts the configured duration.

#### Scenario: Three minutes ahead
- WHEN a GM sends `/start-event smashing-spree 3`
- THEN only the 1-minute announcement is sent before the start.

### Requirement: Readable speech bubbles

A town speech bubble SHALL keep the same on-screen size at every camera zoom level.

#### Scenario: Maximum zoom-out
- WHEN the camera zooms out as far as it goes while a bubble is up
- THEN the bubble's on-screen height stays within 15% of its height at the closest top-down zoom.
