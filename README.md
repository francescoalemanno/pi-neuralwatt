# pi-neuralwatt

A global [Pi](https://github.com/badlogic/pi-mono) package that integrates NeuralWatt models into Pi.

The extension:

- registers the NeuralWatt provider under the Pi provider name `neuralwatt`;
- supports credentials via `/login neuralwatt` or `NEURALWATT_API_KEY`;
- registers the `/nw-update` command;
- fetches `GET https://api.neuralwatt.com/v1/models` when `/nw-update` is run;
- persists the raw models response to `~/.pi/agent/neuralwatt-models.json`;
- loads model configuration from that cached JSON on Pi startup.

## Install

```bash
pi install git:github.com/francescoalemanno/pi-neuralwatt
```

Or try it for one run:

```bash
pi -e git:github.com/francescoalemanno/pi-neuralwatt
```

## Setup

Authenticate with either Pi's standard login flow:

```text
/login neuralwatt
```

or an environment variable:

```bash
export NEURALWATT_API_KEY="your-api-key"
```

On first authenticated run, the extension will try to fetch the model cache automatically once. You can also refresh it manually anytime with:

```text
/nw-update
```

After that, open:

```text
/model
```

and select a model from provider `neuralwatt`.

## Cache

The raw `/models` response is stored at:

```text
~/.pi/agent/neuralwatt-models.json
```

Pi startup reads this file to register models without hitting the network every time. On a first install, run `/login neuralwatt` (or set `NEURALWATT_API_KEY`) and the extension will try to populate it automatically once. Run `/nw-update` anytime to refresh it.

## License

MIT
