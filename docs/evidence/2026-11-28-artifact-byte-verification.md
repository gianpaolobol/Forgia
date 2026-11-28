# F13 — verifica dei byte degli artefatti nativi (28 novembre 2026)

Candidato applicativo #52: eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c. [Run CI 46090576320](https://github.com/gianpaolobol/Forgia/actions/runs/46090576320). Quattro ZIP scaricati tramite endpoint GitHub Actions; SHA-256 calcolato localmente sui byte, confrontato con digest dichiarato dall'API. Per ogni ZIP, controllo CRC di tutte le entry, SHA-256 del pacchetto interno confrontato con SHA256SUMS.txt, controllo CRC di tutte le entry del pacchetto interno (Python zipfile.testzip). Nessun eseguibile avviato.

| Artifact ID | ZIP esterno SHA-256 osservato | Pacchetto interno SHA-256 osservato | Esito |
| --- | --- | --- | --- |
| 15241157446 | 88d4a38474e0ebdcc91cac830a5b99a14ce50de5295870c2b9f587b578cc4532 | 2620d02598ddad8cf3b01699b9d10e0e017d44e9c06852e705cf53e3dbf33b6f | PASS |
| 15241631841 | 015249cee7113d327966c263f777675cce2a6bfa9690f7309d6271efc07ccc04 | fe9ae991b89dfd9ba373eea456775c6afc82ce9e57d6aeb95b588127f21dd44b | PASS |
| 15241431174 | 9979fdb3a544f34958b63d9bd80f2c0f9cf66e79e9d649f711192b82462b8fa1 | daa266a048a6089327061f8fe2c3d4db3c19129e99e6def138e01fe25037f7ea | PASS |
| 15241746386 | 864c9ec175e743075c7cda1c92d572b34f18f1937c89e67027639515e370c0b7 | e3c8c1a445f08a2463d6e0c0d414d4b80ca4dea594475962933913e8ebdb19d6 | PASS |

Struttura osservata:
- APK: 605 entry, AndroidManifest.xml, classes.dex, ABI arm64-v8a; magic APK Sig Block 42 presente prima della central directory. La presenza del blocco NON equivale a validazione crittografica della firma; apksigner non disponibile. Nessuna installazione.
- AAB: 698 entry, BundleConfig.pb, base/manifest/AndroidManifest.xml; librerie native arm64-v8a, armeabi-v7a, x86 e x86_64; nessuna entry di firma JAR .RSA/.DSA/.EC/.SF osservata. Artefatto unsigned, non installabile direttamente.
- Simulatore iOS: 237 entry, Forgia.app/Info.plist: bundle it.gianpaolofranceschini.forgia, versione 0.1.0 build 2, iPhoneSimulator, minimum iOS 16.4.
- XCArchive iOS: 271 entry, Forgia.xcarchive/Products/Applications/Forgia.app/Info.plist: stesso bundle, versione 0.1.0 build 2, iPhoneOS, minimum iOS 16.4. Non è IPA firmato.
- 4/4 ZIP esterni e 4/4 pacchetti interni: digest corrispondenti; CRC integri su tutti. Provenienza dichiarata dal run, non attestazione indipendente della build toolchain, non review RV-01.

Riproduzione locale (scaricare i quattro ZIP dalla pagina del run senza rinominarne i contenuti):

```python
import hashlib, io, pathlib, zipfile
expected = {
    "Forgia-android-arm64.zip": "88d4a38474e0ebdcc91cac830a5b99a14ce50de5295870c2b9f587b578cc4532",
    "Forgia-android-unsigned-aab.zip": "015249cee7113d327966c263f777675cce2a6bfa9690f7309d6271efc07ccc04",
    "Forgia-ios-simulator.zip": "9979fdb3a544f34958b63d9bd80f2c0f9cf66e79e9d649f711192b82462b8fa1",
    "Forgia-ios-unsigned-xcarchive.zip": "864c9ec175e743075c7cda1c92d572b34f18f1937c89e67027639515e370c0b7",
}
for name, digest in expected.items():
    data = pathlib.Path(name).read_bytes()
    assert hashlib.sha256(data).hexdigest() == digest, name
    with zipfile.ZipFile(io.BytesIO(data)) as outer:
        assert outer.testzip() is None, name
        inner_digest, inner_name = outer.read("SHA256SUMS.txt").decode().split()
        payload = outer.read(inner_name)
        assert hashlib.sha256(payload).hexdigest() == inner_digest, name
        with zipfile.ZipFile(io.BytesIO(payload)) as inner:
            assert inner.testzip() is None, name
    print("PASS", name)
```

Prossimi controlli F13: verificare firma APK con Android SDK, installare su dispositivo autorizzato, usare Xcode e profilo autorizzato per firma iOS senza pubblicare. Aggiornare versione/build di rilascio a V1.0 solo dopo accettazione e review, con nuova CI. Nessun nuovo costo, modifica applicativa, esposizione o merge. I gate locali/cloud reali, Windows, dispositivi fisici, RV-01 e consegna Notification Hub esterna restano aperti.
