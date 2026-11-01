# Changelog
## 2.0.1

### Bug Fixes 🐛

#### Scanner

- Separate coverage limits from scan warnings by @nsdeschenes in [#66](https://github.com/nsdeschenes/flightsim-things/pull/66)
- Recover from missing discovery metadata by @nsdeschenes in [#65](https://github.com/nsdeschenes/flightsim-things/pull/65)
- Explain invalid configuration lines safely by @nsdeschenes in [#64](https://github.com/nsdeschenes/flightsim-things/pull/64)
- Exclude model XML from airport discovery by @nsdeschenes in [#63](https://github.com/nsdeschenes/flightsim-things/pull/63)
- Ignore non-selectable AI liveries by @nsdeschenes in [#58](https://github.com/nsdeschenes/flightsim-things/pull/58)

## 2.0.0

### Breaking Changes 🛠

- (cli) Always include directory hyperlinks in tables by @nsdeschenes in [#37](https://github.com/nsdeschenes/flightsim-things/pull/37)

### New Features ✨

#### Cli

- Add practical command help examples by @nsdeschenes in [#56](https://github.com/nsdeschenes/flightsim-things/pull/56)
- Confirm interactive database clears by @nsdeschenes in [#55](https://github.com/nsdeschenes/flightsim-things/pull/55)
- Validate Sentry configuration during guided input by @nsdeschenes in [#53](https://github.com/nsdeschenes/flightsim-things/pull/53)
- Add a direct command wizard by @nsdeschenes in [#52](https://github.com/nsdeschenes/flightsim-things/pull/52)
- Add native shell completion scripts by @nsdeschenes in [#51](https://github.com/nsdeschenes/flightsim-things/pull/51)

#### Tui

- Add a Community directory picker by @nsdeschenes in [#50](https://github.com/nsdeschenes/flightsim-things/pull/50)
- Guide flight search with saved inventory by @nsdeschenes in [#49](https://github.com/nsdeschenes/flightsim-things/pull/49)
- Add autocomplete to saved inventory lists by @nsdeschenes in [#41](https://github.com/nsdeschenes/flightsim-things/pull/41)

#### Other

- (database) Add selective clear command by @nsdeschenes in [#38](https://github.com/nsdeschenes/flightsim-things/pull/38)

### Bug Fixes 🐛

- (scanner) Filter addon records by manifest content type by @nsdeschenes in [#39](https://github.com/nsdeschenes/flightsim-things/pull/39)
- (sentry) Keep configured telemetry active in the TUI by @nsdeschenes in [#40](https://github.com/nsdeschenes/flightsim-things/pull/40)

### Internal Changes 🔧

- (ci) Shard acceptance tests by duration by @nsdeschenes in [#54](https://github.com/nsdeschenes/flightsim-things/pull/54)

## 1.0.0

### Breaking Changes 🛠

- (cli) Remove the hello command by @nsdeschenes in [#35](https://github.com/nsdeschenes/flightsim-things/pull/35)

### New Features ✨

- (cli) Add an interactive menu and desktop launchers by @nsdeschenes in [#32](https://github.com/nsdeschenes/flightsim-things/pull/32)

### Bug Fixes 🐛

- (scan) Recover airports and report diagnostics as logs by @nsdeschenes in [#33](https://github.com/nsdeschenes/flightsim-things/pull/33)

### Documentation 📚

- (cli) Turn README into a command reference by @nsdeschenes in [#34](https://github.com/nsdeschenes/flightsim-things/pull/34)

## 0.1.0

### New Features ✨

#### Airports

- List installed airports with code filters and links by @nsdeschenes in [#24](https://github.com/nsdeschenes/flightsim-things/pull/24)
- Enrich installed airport metadata from OpenAIP by @nsdeschenes in [#16](https://github.com/nsdeschenes/flightsim-things/pull/16)

#### Cli

- Add OpenAIP API key configuration by @nsdeschenes in [#14](https://github.com/nsdeschenes/flightsim-things/pull/14)
- Add shared configuration and Sentry telemetry by @nsdeschenes in [#10](https://github.com/nsdeschenes/flightsim-things/pull/10)
- Persist the MSFS 2024 Community directory by @nsdeschenes in [#3](https://github.com/nsdeschenes/flightsim-things/pull/3)
- Bootstrap Stricli commands by @nsdeschenes in [#2](https://github.com/nsdeschenes/flightsim-things/pull/2)

#### Database

- Add airport elevation and coordinates by @nsdeschenes in [#15](https://github.com/nsdeschenes/flightsim-things/pull/15)
- Add addon metadata storage and RC relations by @nsdeschenes in [#11](https://github.com/nsdeschenes/flightsim-things/pull/11)

#### Flights

- Find routes by aircraft and airline by @nsdeschenes in [#29](https://github.com/nsdeschenes/flightsim-things/pull/29)
- Search by departure and arrival airports by @nsdeschenes in [#28](https://github.com/nsdeschenes/flightsim-things/pull/28)
- Add inventory-aware flight search by @nsdeschenes in [#27](https://github.com/nsdeschenes/flightsim-things/pull/27)

#### Other

- (ai) Add configurable AI SDK providers by @nsdeschenes in [#22](https://github.com/nsdeschenes/flightsim-things/pull/22)
- (aircraft) Add installed aircraft listing and ICAO filters by @nsdeschenes in [#25](https://github.com/nsdeschenes/flightsim-things/pull/25)
- (airlines) Add saved airline listing and ICAO filters by @nsdeschenes in [#26](https://github.com/nsdeschenes/flightsim-things/pull/26)
- (release) Prepare and publish standalone CLI executables by @nsdeschenes in [#9](https://github.com/nsdeschenes/flightsim-things/pull/9)
- (scan) Import Community addon metadata in batches by @nsdeschenes in [#13](https://github.com/nsdeschenes/flightsim-things/pull/13)

### Bug Fixes 🐛

- (cli) Print concise command failure messages by @nsdeschenes in [#17](https://github.com/nsdeschenes/flightsim-things/pull/17)

### Documentation 📚

- Simplify README and move release instructions by @nsdeschenes in [#19](https://github.com/nsdeschenes/flightsim-things/pull/19)

### Internal Changes 🔧

- (ci) Add parallel checks after shared dependency install by @nsdeschenes in [#4](https://github.com/nsdeschenes/flightsim-things/pull/4)
- (cli) Migrate commands and storage to Effect by @nsdeschenes in [#7](https://github.com/nsdeschenes/flightsim-things/pull/7)
- (config) Replace proper-lockfile with SQLite locking by @nsdeschenes in [#21](https://github.com/nsdeschenes/flightsim-things/pull/21)
- (effect) Enable native compiler diagnostics by @nsdeschenes in [#8](https://github.com/nsdeschenes/flightsim-things/pull/8)
- (http) Migrate request mocks to MSW by @nsdeschenes in [#20](https://github.com/nsdeschenes/flightsim-things/pull/20)
- (linter) Add stylistic lint rule by @nsdeschenes in [#18](https://github.com/nsdeschenes/flightsim-things/pull/18)
- (tests) Separate acceptance suites and gate parallel CI by @nsdeschenes in [#23](https://github.com/nsdeschenes/flightsim-things/pull/23)
- Run static checks as parallel workflow steps by @nsdeschenes in [#30](https://github.com/nsdeschenes/flightsim-things/pull/30)
- Add initial agents file by @nsdeschenes in [#6](https://github.com/nsdeschenes/flightsim-things/pull/6)
- Add scripts and vendor Effect TS by @nsdeschenes in [#5](https://github.com/nsdeschenes/flightsim-things/pull/5)
- Setup checkers by @nsdeschenes in [#1](https://github.com/nsdeschenes/flightsim-things/pull/1)

### Other

- Init bun app by @nsdeschenes in [948c6c55](https://github.com/nsdeschenes/flightsim-things/commit/948c6c5505d9db9bf680e8e0c2a7cfae795680ad)

