# Changelog

## [0.2.0](https://github.com/eventail-scheduling/eventail/compare/v0.1.0...v0.2.0) (2026-10-02)


### ⚠ BREAKING CHANGES

* creating or updating a location now requires a venue relationship, so a client written against contract version 1 is refused with a 422. The contract version is raised to 2.

### Features

* **editions:** show the edition's id where it can be copied ([ed39b5f](https://github.com/eventail-scheduling/eventail/commit/ed39b5f503d1b4967f4ef73086a112a4b3d7d42e))
* give an edition venues its locations belong to ([5f7b94c](https://github.com/eventail-scheduling/eventail/commit/5f7b94ce2571502e30f8a85e29b86a530462891b))
* tell a client which HTTP contract it is talking to ([4c13c04](https://github.com/eventail-scheduling/eventail/commit/4c13c0403bcf176a3a2dd4f69217e6a89d241246))


### Bug Fixes

* refuse a caller that accepts only plain JSON ([2c77b02](https://github.com/eventail-scheduling/eventail/commit/2c77b02df2e61d3f609ac946690651ec80e7607c))
* **ui:** give the hosts pages the container every other one has ([7500299](https://github.com/eventail-scheduling/eventail/commit/75002991e6830a657257e324e3115f6899f3a15d))

## 0.1.0 (2026-10-02)

First release of Eventail as one repository holding the API, its background
worker and the web client. They are versioned and released together.

The API was previously released up to 0.1.2 from `eventail-api`. That version
line is not continued and its releases are gone. Until 1.0.0, no release here
promises compatibility with the one before it.
