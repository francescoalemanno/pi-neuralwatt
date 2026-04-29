# pi-neuralwatt

A global [Pi](https://github.com/badlogic/pi-mono) package that integrates NeuralWatt models into Pi.

When `NEURALWATT_API_KEY` is set, the extension:

- registers the `/nw-update` command;
- fetches `GET https://api.neuralwatt.com/v1/models` when `/nw-update` is run;
- persists the raw models response to `~/.pi/agent/neuralwatt-models.json`;
- loads model configuration from that cached JSON on Pi startup;
- registers the models under the Pi provider name `neuralwatt`.

If `NEURALWATT_API_KEY` is not set, the extension does not register `/nw-update` and does not register the provider.

## Install

```bash
pi install git:github.com/francescoalemanno/pi-neuralwatt
```

Or try it for one run:

```bash
pi -e git:github.com/francescoalemanno/pi-neuralwatt
```

## Setup

Export your NeuralWatt API key before starting Pi:

```bash
export NEURALWATT_API_KEY="your-api-key"
```

Then start Pi and refresh the model cache:

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

Pi startup reads this file to register models without hitting the network every time. Run `/nw-update` again to refresh it.

## License

MIT
