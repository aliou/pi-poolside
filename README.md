# @aliou/pi-poolside

Pi extension package for the [Poolside](https://poolside.ai) inference API.

Provides the `poolside` provider with OpenAI-compatible completions endpoint.

## Models

| Model | Reasoning | Context | Max Output |
|-------|-----------|---------|------------|
| `poolside/laguna-m.1` | yes | 131072 | 8192 |
| `poolside/laguna-xs.2` | yes | 131072 | 8192 |

## Setup

1. Install the package:

   ```bash
   pi install github:aliou/pi-poolside
   ```

2. Configure your API key. Either:

   - Set the `POOLSIDE_API_KEY` environment variable
   - Add the key to `~/.pi/agent/auth.json`:
     ```json
     { "poolside": { "type": "api_key", "key": "your-api-key" } }
     ```
   - Add the key via `models.json` (see [Custom Models docs](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models.md) for full configuration reference):
     ```json
     {
       "providers": {
         "poolside": {
           "apiKey": "your-api-key"
         }
       }
     }
     ```

3. Select a poolside model in Pi.

## Auth resolution order

1. CLI `--api-key` flag
2. `auth.json` entry for `poolside`
3. Environment variable `POOLSIDE_API_KEY`
