# context-band

A Claude Code mod that keeps one dim line above the prompt:

![context 27% · session 25% · weekly 33% · Fable 36% above the prompt in Claude Code Desktop](docs/band.png)

- `context`: how full the session's context window is
- `session` / `weekly`: the plan's 5-hour and 7-day rate-limit windows
- one entry per model-scoped weekly window the account has (`Fable` here)

The figures refresh after every turn. With an API key, Bedrock, Vertex or a gateway there are no plan windows, and the line shows `context` alone.

## Install

Either way the mod is installed at user scope and loads in every later session, including the ones Claude Code Desktop starts.

1. In a terminal session of Claude Code (the command is not available inside a Desktop session):

   ```
   /plugin install context-band --marketplace JiahaoXu10Arthur/context-band
   ```

   Answer `y` to add the marketplace, then pick the user scope.

2. Or paste this repo's link into any Claude Code session, Desktop included, and ask Claude to install it. It runs:

   ```
   claude plugin marketplace add JiahaoXu10Arthur/context-band
   claude plugin install context-band@jiahaoxu-mods
   ```

## Caveats

- Mods use the plugin hooks API, which is early access and may change between Claude Code releases.
- Per-model windows come from `api.anthropic.com/api/oauth/usage`, an endpoint Claude Code uses internally and does not document. The mod calls it with the session's own credential through `$.session.authorize()` and never sees the token. If the endpoint changes, the per-model entry disappears and the rest of the line keeps working.

## Develop

```
claude plugin validate .
claude plugin test .
```
