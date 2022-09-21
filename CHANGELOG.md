# Changelog

All notable changes to this project will be documented in this file.
See [our coding standards][commit-messages] for commit guidelines.

## 1.13.0 (2022-09-21)


### Features

* Add support for livestreams ([9a4710b](https://github.com/guaclive/videojs-chromecast/commit/9a4710b3dcc7afa0ec16dabe4893d6d302d9abe6))
* added tracks support, added session restoring support ([157b067](https://github.com/guaclive/videojs-chromecast/commit/157b067da97e2b3dcff8adc61666d3c5bd899cb2)), closes [/github.com/silvermine/videojs-chromecast/pull/89#pullrequestreview-645475948](https://github.com/guaclive//github.com/silvermine/videojs-chromecast/pull/89/issues/pullrequestreview-645475948)
* Allow modifying the load request ([85fc983](https://github.com/guaclive/videojs-chromecast/commit/85fc983acfa8ed961166879630b4d372b5f1c00b))
* customizable content URL ([f7f8437](https://github.com/guaclive/videojs-chromecast/commit/f7f84379ef75cfa1553b112b5e2782458a218861))


### Bug Fixes

* clean event listeners on player.dispose() ([#97](https://github.com/guaclive/videojs-chromecast/issues/97)) ([328c141](https://github.com/guaclive/videojs-chromecast/commit/328c141f4cf3ce65492b6beb511b0592585aefcd))
* correctly fire ended event ([fbcda9b](https://github.com/guaclive/videojs-chromecast/commit/fbcda9bee7774d1d62236d59c34ecb8f1d8cdf1e))
* downgrade class.extend to avoid unsafe-eval ([#52](https://github.com/guaclive/videojs-chromecast/issues/52)) ([4aaec89](https://github.com/guaclive/videojs-chromecast/commit/4aaec8900a865cb19f6e7df51a507b12bb6a48d7))
* error because tech.seeking was not defined ([3bb0698](https://github.com/guaclive/videojs-chromecast/commit/3bb06984edee57997436ac89f714274779d11731))
* missing `preload` function ([#30](https://github.com/guaclive/videojs-chromecast/issues/30)) ([c1bda1b](https://github.com/guaclive/videojs-chromecast/commit/c1bda1b59d93958f5b51fc3f857cdabf70e03a3e))
* scrubbing workaround ([4cbf71f](https://github.com/guaclive/videojs-chromecast/commit/4cbf71f0a05958df2a8f8d95540350caac1b15e7))
* scss deprecation warning ([e345639](https://github.com/guaclive/videojs-chromecast/commit/e34563986162b66955a0ce8147387755f49e40b3))
* update package name ([ef678bb](https://github.com/guaclive/videojs-chromecast/commit/ef678bb40eaf0b0af504df5bc184c6eae048619f))


### Reverts

* Revert "1.12.0" ([53258b3](https://github.com/guaclive/videojs-chromecast/commit/53258b34f8c9c35c814c0c06a5cf655f38f9f323))


[commit-messages]: https://github.com/silvermine/silvermine-info/blob/master/commit-history.md#commit-messages
