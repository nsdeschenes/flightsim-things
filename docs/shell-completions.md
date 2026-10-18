# Set up shell completion

Install the executable on `PATH` as `flightsim-things`. Rename or link a downloaded
versioned executable to that name. Generated scripts register completion for
`flightsim-things`, regardless of the executable's filename during generation.

Generate and load the script for your shell below. These commands print scripts
without running a command handler, changing settings, or opening the addon database.
You do not need a Community directory, API keys, or saved inventory.

## Bash

To load completion for the current session:

```bash
flightsim-things --completions bash > flightsim-things.bash
source ./flightsim-things.bash
```

To keep a saved script:

```bash
mkdir -p ~/.config/flightsim-things
flightsim-things --completions bash > ~/.config/flightsim-things/completion.bash
source ~/.config/flightsim-things/completion.bash
```

Add the `source` line to your `~/.bashrc` to load it in new interactive sessions.
The `sh` shell value generates the same Bash script. It does not provide portable
POSIX shell completion.

## Zsh

To load completion for the current session:

```zsh
flightsim-things --completions zsh > _flightsim-things
autoload -Uz compinit
compinit
source ./_flightsim-things
```

To install an autoload file:

```zsh
mkdir -p ~/.zsh/completions
flightsim-things --completions zsh > ~/.zsh/completions/_flightsim-things
```

Add these lines to `~/.zshrc`. Put the `fpath` line before any existing `compinit` call:

```zsh
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit
compinit
```

Open a new Zsh session to load the saved file.

## Fish

To load completion for the current session:

```fish
flightsim-things --completions fish > flightsim-things.fish
source ./flightsim-things.fish
```

To install the script for future sessions:

```fish
mkdir -p ~/.config/fish/completions
flightsim-things --completions fish > ~/.config/fish/completions/flightsim-things.fish
source ~/.config/fish/completions/flightsim-things.fish
```

## Refresh after an upgrade

Repeat the generation command for your saved file after upgrading the executable
or changing command definitions. Reload that file, or open a new shell session.
The script completes commands, subcommands, flags, and declared choices such as AI
providers and database targets. Try `flightsim-things sc<Tab>` or
`flightsim-things scan --v<Tab>`.

Scripts contain static command metadata. They do not query saved airports,
aircraft, airlines, or other inventory. Community directory arguments use string
metadata and do not request directory completion from the generator.

PowerShell and `pwsh` generation are unsupported by the current Effect dependency.

## Generate from source

From a checkout with dependencies installed:

```sh
bun run start --completions bash > flightsim-things.bash
```

The script still registers `flightsim-things`. It does not complete the arguments
after `bun run start` or `bun src/index.ts`. Use the installed executable under
the stable name, or provide a shell wrapper named `flightsim-things` that runs
Bun with the absolute source entrypoint and forwards its arguments.
