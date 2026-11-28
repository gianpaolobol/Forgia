# F13 — verifica crittografica circoscritta APK v2 (28 novembre 2026)

Candidato applicativo #52 eb5f8b1f02fdbe50a9a56b11073b34b724a1b74c, run [46090576320](https://github.com/gianpaolobol/Forgia/actions/runs/46090576320), artifact 15241157446. APK riscaricato: 23.465.589 byte; SHA-256 `2620d02598ddad8cf3b01699b9d10e0e017d44e9c06852e705cf53e3dbf33b6f` coincide con la precedente evidenza. Nessuna esecuzione del pacchetto.

Autocontrollo mirato in Python con cryptography, secondo [specifica AOSP APK Signature Scheme v2](https://source.android.com/docs/security/features/apksigning/v2): controllati EOCD, offset/dimensione central directory, lunghezze e magic signing block; estratto blocco 0x7109871a, un signer, algoritmo 0x0103 RSA PKCS#1 v1.5 SHA-256, chiave 2048 bit. La chiave pubblica DER del signer coincide con quella del certificato X.509; verificata la firma su tutti i byte del signed data (inclusi quattro byte zero finali osservati dopo gli attributi); lista algoritmi digest/firma identica. Ricalcolato il digest dei 25 chunk da massimo 1 MiB delle tre sezioni protette, correggendo l'offset EOCD secondo la specifica. Digest firmato e calcolato coincidono: `4013acc50736d04f17cf81ffdb95da81ff753d7111a2755697ce5cef511496bf`.

Certificato: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US; SHA-256 certificato `fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c`. È una firma di debug, NON una firma di distribuzione autorizzata. Jarsigner non trova manifest JAR e riporta unsigned per v1; non verifica v2.

Controlli negativi in memoria: modifica di un byte a offset 1000 (digest mismatch), modifica di un byte nella directory centrale a offset 23465549 (digest mismatch), modifica di un byte della firma RSA (InvalidSignature). Tutte e tre respinte. L'APK originale è rimasto invariato.

Riproduzione con tool ufficiale su postazione Android SDK autorizzata:
```sh
apksigner verify --verbose --print-certs Forgia-android-arm64.apk
```
Il controllo mirato eseguito non è un sostituto di apksigner: non copre tutti gli algoritmi/versioni, parsing ZIP Android, stripping protection, source stamp (presente come blocco separato), né fiducia nella chiave di distribuzione. Apksigner/ADB non disponibili nella sessione. Non attestata installazione fisica, firma store, review RV-01 o verifica iOS. Non modificare né rifirmare il candidato per aggirare questo gate.

Main f8e64a98, backup iteration-30 3550c197 antenato (170 avanti/0 indietro); #52 e #61 CI success e review assenti. Node disponibile v22.16.0, nessun runtime llama.cpp/Ollama o SDK Android rilevato, DNS github.com non risolto in container; connettore GitHub funzionante. Nessun costo, chiamata provider, esposizione o merge. Rimangono gate reali locale/cloud, Windows/iPhone, installazioni native, verifica SDK e RV-01.
