# flightsim-things

To install dependencies:

```bash
bun install
```

To list commands:

```bash
bun run start -h
```

To print a greeting:

```bash
bun run start hello
```

To save your MSFS 2024 Community directory:

```bash
bun run start community-path set '/Games/MSFS 2024/Community'
```

To print the saved directory in a later session:

```bash
bun run start community-path get
```

To replace the saved directory:

```bash
bun run start community-path update '~/Games/MSFS 2024/Community'
```

`set` and `update` require an existing directory and print its absolute path.
Relative paths resolve against your current directory. Quote paths that contain spaces.
Both commands expand `~` and `~/` to your home directory, including inside quotes.
The CLI saves the path in `~/.flightsim-things/config.json`.
`get` prints the saved path even if you later remove that directory.
If no path is saved or the configuration is invalid, run `community-path set <path>`.

This project was created using `bun init` in bun v1.4.2. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
