# KitchenPlanner

Drag & drop planer kuhinja iz elemenata za web prodavnice. Kupac bira liniju (Aria, Una, Tisa…), prevlači elemente na zidove (I, L ili U raspored), gleda kuhinju u 2D i 3D i šalje upit ili specifikaciju.

- Jedan fajl, bez zavisnosti: `src/kitchen-planner.js`. Za 3D se three.js učitava tek kad kupac otvori 3D prikaz.
- Radi u Shadow DOM-u, pa CSS prodavnice ne može pokvariti planer (a ni planer prodavnicu).
- Radi na desktopu, tabletu i mobitelu (mišem, prstom i tastaturom).

## Ugradnja

Skripta je javno dostupna preko jsDelivr CDN-a (direktno iz ovog repoa):

```html
<script src="https://cdn.jsdelivr.net/gh/mirhat/elements@v0.1.1/src/kitchen-planner.min.js"></script>
```

`@v0.1.1` je fiksna verzija i nikad se ne mijenja. Za novu verziju napravi novi tag (npr. `v0.1.2`) i promijeni broj u linku. `@main` uvijek daje zadnju verziju, ali je CDN kešira do 12 sati.

```html
<div id="planer"></div>
<script src="https://cdn.jsdelivr.net/gh/mirhat/elements@v0.1.1/src/kitchen-planner.min.js"></script>
<script>
  KitchenPlanner.create({
    container: '#planer',
    elementsUrl: '/api/elementi',              // ili elements: [...]
    prices: { '10019723': 176, '10019733': 266 }, // ili getPrice: el => ...
    onCheckout(order) {
      // order.lines = [{ id, sku, name, qty, unitPrice, total }], order.total, order.design
      fetch('/api/upit', { method: 'POST', body: JSON.stringify(order) });
    },
  });
</script>
```

Demo: https://mirhat.github.io/elements/ (ili lokalno `demo/index.html`, radi i bez servera; 3D treba internet zbog three.js sa CDN-a).

Demo se objavljuje iz grane `gh-pages`. Nakon izmjena: `git push origin main:gh-pages`.

## Opcije

| Opcija | Opis |
|---|---|
| `container` | Element ili CSS selektor u koji se planer ubacuje. |
| `elements` / `elementsUrl` | Niz elemenata ili URL koji ga vraća. Prima format iz `elementi.json` (naziv, sirina, opis…) ili već normalizovan `katalog.json`. |
| `adapter` | `(sirovi) => element` za prodavnice s drugačijim formatom podataka. |
| `prices` / `getPrice` | Cijene po šifri ili id-u, ili funkcija. Bez cijene piše "Cijena na upit". |
| `currency`, `locale` | Zadano `BAM` i `hr-HR` (`1.332,50 KM`). |
| `walls` | Početni zidovi, npr. `[{ width: 300 }, { width: 240 }]` za L. |
| `defaultSeries` | Linija koja je izabrana na početku. |
| `theme` | Boje, npr. `{ accent: '#a33', bg: '#fff', wall: '#eee' }` (postaje `--kp-accent`…). |
| `labels` | Prevod ili izmjena bilo kojeg teksta u sučelju. |
| `storageKey`, `autosave` | Kuhinja se sama čuva u pregledniku kupca. |
| `three` / `threeUrl` | Ako sajt već ima three.js, ili ga hostuje sam (zadano: jsDelivr, three@0.160.0). |
| `onCheckout`, `onChange`, `onReady` | Callback funkcije. Dugme "Pošalji upit" se pojavi samo ako postoji `onCheckout`. |

API instance: `getOrder()`, `getDesign()`, `loadDesign(d)`, `addElement(id)`, `setSeries(s)`, `setView('2d'|'3d')`, `exportCsv()`, `getSpecification()`, `importSpecification(fajl ili tekst)`, `undo()`, `redo()`, `clear()`, `destroy()`, `ready` (Promise).

## Specifikacija (CSV) i ponovno učitavanje

"Preuzmi specifikaciju" pravi `kuhinja-GGGG-MM-DD.csv` koji se otvara u Excelu: stavke sa cijenama, radna ploča i cokla, zatim zidovi i raspored (zid, pozicija od lijevog ruba, šifra, naziv, dimenzije). Zadnji red (`kitchen-planner`) nosi cijeli projekat.

"Učitaj specifikaciju" vraća tu kuhinju u planer, i u praznom pregledniku. Ako je zadnji red obrisan, kuhinja se vraća iz redova "Zidovi" i "Raspored" po šifri. Radi i kad Excel fajl snimi sa zarezima umjesto tačke-zareza. Prima i JSON (`getDesign()` ili cijeli `order` iz `onCheckout`), pa prodavnica može kupcu vratiti kuhinju iz upita. Elementi kojih više nema u katalogu se preskoče i to se prijavi. Učitavanje se poništava sa Ctrl+Z.

## Kako radi raspored

- Svaki zid ima donji red (donji elementi, 82 cm), gornji red (gornji elementi, gornja ivica na 212 cm) i visoke elemente koji zauzimaju oba reda. Elementi se lijepe za susjede i ne mogu se preklopiti.
- Zidovi su lanac: desni kraj zida A je ugao s lijevim krajem zida B (L), a desni kraj zida B je ugao sa zidom C (U). Element u uglu zauzima i početak susjednog zida u svojoj dubini. To se provjerava u tlocrtu, a na susjednom zidu se iscrtava šrafurom "UGAO".
- Sažetak računa potrebnu dužinu radne ploče i cokle; za Una/Tisa predlaže komade cokle (4 m, 2 m, 0,6 m) uz najmanje otpada.
- "Prebaci cijelu kuhinju na liniju X" mijenja svaki element odgovarajućim (isti tip i širina) iz druge linije.

## Katalog iz `elementi.json`

```
node scripts/build-catalog.js [putanja/do/elementi.json]
```

Pravi `katalog.json` (format planera), `katalog.csv` (za provjeru u Excelu) i `demo/katalog.js`, i ispisuje upozorenja o podacima. Tip elementa (donji, ladičar, sudoper, napa, visoki, ugaoni…), broj vrata i ladica te boje korpusa i fronte izvlače se iz `naziv`, `opis` i `boja`.
