# @aliou/pi-poolside

Pi extension package for the [Poolside](https://poolside.ai) inference API.

Provides the `poolside` provider with OpenAI-compatible completions endpoint.

## Models

| Model | Reasoning | Context | Max Output |
|-------|-----------|---------|------------|
| `poolside/laguna-m.1` | yes | 131072 | 8192 |
| `poolside/laguna-xs.2` | yes | 131072 | 8192 |

## Setup

1. Set your API key via Pi auth storage:

   ```bash
   pi auth set poolside
   ```

   Or set the `POOLSIDE_API_KEY` environment variable.

2. Install the package:

   ```bash
   pi add @aliou/pi-poolside
   ```

3. Select a poolside model in Pi.

## Auth resolution order

1. Pi auth storage (`auth.json` entry for `poolside`)
2. Environment variable `POOLSIDE_API_KEY`
