# context-band

A Claude Code mod that keeps one dim line above the prompt:

```
context 14% · session 17% · weekly 31% · Fable 35%
```

- `context`: how full the session's context window is
- `session` / `weekly`: the plan's 5-hour and 7-day rate-limit windows
- one entry per model-scoped weekly window the account has (`Fable` here)

The figures refresh after every turn. With an API key, Bedrock, Vertex or a gateway there are no plan windows, and the line shows `context` alone.

## Install

In a terminal session of Claude Code:

```
/plugin install context-band --marketplace JiahaoXu10Arthur/context-band
```

Answer `y` to add the marketplace, then pick the user scope. The mod loads in every later session, including the ones Claude Code Desktop starts. The command is a terminal's: a Desktop session answers that it is not available there.

## Caveats

- Mods use the plugin hooks API, which is early access and may change between Claude Code releases.
- Per-model windows come from `api.anthropic.com/api/oauth/usage`, an endpoint Claude Code uses internally and does not document. The mod calls it with the session's own credential through `$.session.authorize()` and never sees the token. If the endpoint changes, the per-model entry disappears and the rest of the line keeps working.

## Develop

```
claude plugin validate .
claude plugin test .
```
