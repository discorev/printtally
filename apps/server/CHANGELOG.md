# Changelog

## [0.5.0](https://github.com/discorev/printtally/compare/backend-v0.4.0...backend-v0.5.0) (2026-10-06)


### Features

* cost ink per printer from cartridges, swaps and fittings ([0d9dc89](https://github.com/discorev/printtally/commit/0d9dc89c94fc196595281327a9f01b43beffbb77))
* **ink:** archive reported printer cartridge status ([79893b0](https://github.com/discorev/printtally/commit/79893b00a22dffa237f00687cef9490524955ec5))
* **ink:** cost ink per printer from cartridge units, swaps and fittings ([65ff6d9](https://github.com/discorev/printtally/commit/65ff6d91654365e5b3b934c0156c2466ac514b84))
* read ink levels and cartridge types from each printer ([65dd97e](https://github.com/discorev/printtally/commit/65dd97e4012a8be8e9a3079c18149daf5216d797))
* see and allocate cartridges per printer ([cd88922](https://github.com/discorev/printtally/commit/cd88922ec0e34bc8ce7ec29b36dbc840d2a9003f))
* **server:** list archived printers by name and rename known printers ([e0b4795](https://github.com/discorev/printtally/commit/e0b47956f006bb100d9a39d795528444f5091282))
* several printers in Settings and a Jobs printer filter ([6cb6862](https://github.com/discorev/printtally/commit/6cb6862f3ed1593cb3ed2c58e6da9a3dc5ef934d))
* **web:** filter jobs by printer and name the printer on rows and the docket ([e3d2dfb](https://github.com/discorev/printtally/commit/e3d2dfbbcc5227920607eb8b8ecdf5b283316afd))
* **web:** list and rename printers in Settings, and add a printer from setup ([37f7d7c](https://github.com/discorev/printtally/commit/37f7d7c7761151f17fdb095bd28fd207641e2e2e))
* **web:** see and allocate cartridges per printer ([c2b8499](https://github.com/discorev/printtally/commit/c2b8499997461dc09552ba6e71fef484226202d7))
* **web:** show printer ink levels and choose stock by type ([cdc6c03](https://github.com/discorev/printtally/commit/cdc6c03d813a3e3f99a1bd128a54007a23857486))


### Bug Fixes

* correct multi-printer job filtering and display ([d735cae](https://github.com/discorev/printtally/commit/d735cae5b69a102bcf229c23b9a0386b1fecbf88))
* **ink:** date candidate fittings, consume swap overrides once, keep intermediates ([937d84a](https://github.com/discorev/printtally/commit/937d84a104aaae42ac6b883fe85f228f953f6fc5))
* **ink:** fit a cartridge when a reading shows one is in ([4366adc](https://github.com/discorev/printtally/commit/4366adc70a2e208f92075f54f9b8ff1dd103c07d))
* **ink:** keep write-offs behind unprocessed jobs, recheck printer edits, choose the write-off type ([e9a2cfd](https://github.com/discorev/printtally/commit/e9a2cfd4f6aa46ee88b237ffe362c9019fd44e8a))
* **ink:** match legacy write-offs, apply pending events and check fittings as a set ([3e0a7f6](https://github.com/discorev/printtally/commit/3e0a7f6620843a83feb86df9333697b0d4ac2ac6))
* **ink:** match printer series and backfill missing device details ([ee3590a](https://github.com/discorev/printtally/commit/ee3590a57f934051bd5805c066d2e45b18f23285))
* **ink:** order readings with write-offs, date swaps by observation, index units ([ce18ac5](https://github.com/discorev/printtally/commit/ce18ac5cb5b7981f7332522b8a5c3bb6f73a36a5))
* **ink:** pin fittings to a cartridge, mark the next cartridge, label shelf write-offs ([027df3a](https://github.com/discorev/printtally/commit/027df3a67549bcc34a39cae9e4af0201af9bf2ac))
* **ink:** preserve partial printer readings through imports ([12cbf1c](https://github.com/discorev/printtally/commit/12cbf1cdfd9fa6d8dcd914c796de6faf9ef0741b))
* keep an unknown printer filter selected, and seed an empty history ([b795c84](https://github.com/discorev/printtally/commit/b795c84b74923ab0f1452c69f5f51b807c46f4cd))
* name the PRO-1100's cartridges PFI-4100, not PFI-1100 ([59e79d5](https://github.com/discorev/printtally/commit/59e79d50b0f3c79547ee06a95fdec8a1c8821038))
* name the PRO-1100's cartridges PFI-4100, not PFI-1100 ([703cf6f](https://github.com/discorev/printtally/commit/703cf6f2578d38878034cd785cab0f07f043658b))
* **web:** distinguish pooled ink estimates from printer series ([334979b](https://github.com/discorev/printtally/commit/334979b848a1ba47f67ba9c86732465c2265f17e))
* **web:** keep cartridge dates and the 'set by you' tag on one line ([e2c2d47](https://github.com/discorev/printtally/commit/e2c2d4713f29cf46217cfd50e94b4a269d6a6608))
* **web:** keep the cartridge docket in step with the list and tidy fitting forms ([b9a238b](https://github.com/discorev/printtally/commit/b9a238b90de919e7e62e8d0c5a699259e589520d))
* **web:** show printed and waste on cartridges written off from the shelf ([0c7abb5](https://github.com/discorev/printtally/commit/0c7abb562be1c02a9987733055c1ad1074de8611))

## [0.4.0](https://github.com/discorev/printtally/compare/backend-v0.3.0...backend-v0.4.0) (2026-10-03)


### Features

* **desktop:** download and install updates from inside the app ([d08dc61](https://github.com/discorev/printtally/commit/d08dc6148bc25952b109cec284d65244f553de2e))
* **marketing:** static marketing site for printtally.ink ([113e603](https://github.com/discorev/printtally/commit/113e6037b189141b0d51fedc2bc98603d2d408a6))
* **marketing:** static marketing site for printtally.ink ([f38209f](https://github.com/discorev/printtally/commit/f38209f8e14385122433dafbc950ba62723adc07))
* self-updating desktop app ([d8eb6cf](https://github.com/discorev/printtally/commit/d8eb6cf0780e95d4f3ccc93c1ce36d25868f056f))
* **web:** show desktop updates as an ink splat with a receipt of changes ([160928d](https://github.com/discorev/printtally/commit/160928d19ffc26b7129a807fb106ee235cfc980f))


### Bug Fixes

* keep update state and notes accurate across load and download ([984e619](https://github.com/discorev/printtally/commit/984e61962204b00bbefa74f491efecfdc5bf0b90))
* **web:** accept a printer MAC typed with hyphens ([d6b59b4](https://github.com/discorev/printtally/commit/d6b59b46e1cf87e8480e0210db7859bce0d85c14))

## [0.3.0](https://github.com/discorev/printtally/compare/backend-v0.2.1...backend-v0.3.0) (2026-10-01)


### Features

* **web:** default a new paper's name to its printer media ([3573c6a](https://github.com/discorev/printtally/commit/3573c6a1d845f68f1917e29ebd8b851483f7ec82))
* **web:** default a new paper's name to its printer media ([688bfa2](https://github.com/discorev/printtally/commit/688bfa28ed47124687c830f3c418ff734c8997e8))

## [0.2.1](https://github.com/discorev/printtally/compare/backend-v0.2.0...backend-v0.2.1) (2026-09-30)


### Bug Fixes

* **web:** accept a zero price for stock that came free ([3fdcc74](https://github.com/discorev/printtally/commit/3fdcc7464a136646ddfa78f93a56a48a5387b21d))
* **web:** accept a zero price for stock that came free ([397fb4c](https://github.com/discorev/printtally/commit/397fb4c27a7f0d7b0c993754f9778c0aea67033a))

## [0.2.0](https://github.com/discorev/printtally/compare/backend-v0.1.1...backend-v0.2.0) (2026-09-30)


### Features

* **desktop:** app icon ([fd76164](https://github.com/discorev/printtally/commit/fd7616469ae6301b6043fb33365a1dd90785276f))
* **desktop:** app icon ([01ab1d8](https://github.com/discorev/printtally/commit/01ab1d83157182d57fbe1b275298fa92f377ac48))
* **web:** add a whole ink set in one go ([ea02225](https://github.com/discorev/printtally/commit/ea022257549d00d162dd8f3610d7b9708194c29b))
* **web:** add a whole ink set in one go ([1175895](https://github.com/discorev/printtally/commit/1175895a638b7d6d8ed72ffb601a9e7e2a52a318))


### Bug Fixes

* **desktop:** hide the server chip when the app runs its own server ([e839b9c](https://github.com/discorev/printtally/commit/e839b9c7d4b26a7c0fde832a6d052352e44033b3))
* **desktop:** hide the server chip when the app runs its own server ([5c36da9](https://github.com/discorev/printtally/commit/5c36da93a0e04fb66295faffb577b6db757ba0e4))
* **web:** say whether a job is missing its paper or its ink cost ([6a63666](https://github.com/discorev/printtally/commit/6a6366639add835dcbed960b48d09b8da17c356b))
* **web:** say whether a job is missing its paper or its ink cost ([cd77ad6](https://github.com/discorev/printtally/commit/cd77ad6015da222685ec5943caf302db9680850e))

## [0.1.1](https://github.com/discorev/printtally/compare/backend-v0.1.0...backend-v0.1.1) (2026-09-30)


### Bug Fixes

* explain when macOS blocks local network access ([8ddd59a](https://github.com/discorev/printtally/commit/8ddd59a765af2653e91d965a9a72bf282af778a5))
* explain when macOS blocks local network access ([56b0c96](https://github.com/discorev/printtally/commit/56b0c9617ba150dd3d01e1cccb1b5556f1cfbc4c))
* **web:** lay out the fingerprint as the printer's screen does ([100b73a](https://github.com/discorev/printtally/commit/100b73a120a3a51b9f36938cc5a2ace78c978b0e))
* **web:** lay out the fingerprint as the printer's screen does ([d2e9bf2](https://github.com/discorev/printtally/commit/d2e9bf2222c06252ff2c4673be01bb81f1633b11))

## 0.1.0 (2026-09-30)


### Features

* ledger costing, local access and pairing, web and desktop scaffolds ([77895f1](https://github.com/discorev/printtally/commit/77895f1b9098dff79c5a1d095984670c24e6a339))
* Print Tally print history and cost accounting for Canon imagePROGRAF printers ([173ab55](https://github.com/discorev/printtally/commit/173ab55b4fd28023bc15ee84945d7ad7de08af1b))
* **server:** accept DNS names that resolve to the host for remote access ([eed12c6](https://github.com/discorev/printtally/commit/eed12c62f2fbc4c87fe2bd5b7070492f2207afaa))
* warn before correcting a job to a paper without stock ([54d7cf0](https://github.com/discorev/printtally/commit/54d7cf066268a9878d409317b72d6b0c7958a235))
* web and desktop apps with ledger costing ([861f92d](https://github.com/discorev/printtally/commit/861f92d88cd5277faf5075415bb25127223abafd))
* **web:** Docket design system, shared components and all screens ([c3dc43e](https://github.com/discorev/printtally/commit/c3dc43e521efe94f773d1d1e39aebdb82fe19eda))


### Bug Fixes

* **core:** fall back only to a same-size deckle sheet when stock runs out ([7bf9e61](https://github.com/discorev/printtally/commit/7bf9e61100e7ae73f584197db03421dd4f5649a0))
* pre-release review findings ([82eb473](https://github.com/discorev/printtally/commit/82eb4731d1338a0054a5199c3c079b1177b9c9ed))
* **web:** keep data through outages, atomic stock setup, review fixes ([267ba02](https://github.com/discorev/printtally/commit/267ba02aca97d846ba467b8969ab9128298d9a70))
