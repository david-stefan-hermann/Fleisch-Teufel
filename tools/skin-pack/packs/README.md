# Figure packs

Manifests for packs that are not part of the app (their pictures may be used, but not passed on). Build
them into `skins/` (git-ignored) and upload the zip under Mehr → Aussehen → „Eigene Figur“:

```bash
node tools/skin-pack/build.mjs "/home/dev/fleisch-teufel-assistant-test/Elf Mage" tools/skin-pack/packs/elfenmagierin.json skins/elfenmagierin.zip
node tools/skin-pack/build.mjs "/home/dev/fleisch-teufel-assistant-test/Demon Girl" tools/skin-pack/packs/demon-girl.json skins/daemonin.zip
```
