<p><img src="brand/logo.svg" alt="Planer kuhinje" height="64"></p>

# KitchenPlanner

Drag & drop planer kuhinja iz elemenata za web prodavnice. Kupac bira liniju (Aria, Una, Tisa…), prevlači elemente na zidove (I, L ili U raspored), gleda kuhinju u 2D i 3D i preuzima PDF sa 3D slikom, crtežima zidova i spiskom elemenata.

- Jedan fajl, bez zavisnosti: `src/kitchen-planner.js`. Za 3D se three.js, a za PDF jsPDF i font Roboto učitavaju tek kad zatrebaju.
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
    pdf: { company: 'Naziv prodavnice', footer: 'Tel. 033 000 000 · www.prodavnica.ba' },
    // Opcionalno dugme "Pošalji upit":
    // onCheckout(order) { fetch('/api/upit', { method: 'POST', body: JSON.stringify(order) }); },
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
| `defaultDesign` | Primjer kuhinje (iz `getDesign()` ili upita) koji vidi posjetilac koji još nema svoju sačuvanu. Njegove izmjene se dalje čuvaju. |
| `design` | Kuhinja koja se učita svaki put, bez obzira na sačuvanu. |
| `defaultSeries` | Linija koja je izabrana na početku. |
| `theme` | Boje, npr. `{ accent: '#a33', bg: '#fff', wall: '#eee' }` (postaje `--kp-accent`…). |
| `labels` | Prevod ili izmjena bilo kojeg teksta u sučelju. |
| `storageKey`, `autosave` | Kuhinja se sama čuva u pregledniku kupca. |
| `pdf` | Zaglavlje i podnožje PDF-a: `{ title, company, logo, footer }` (naslov, naziv prodavnice, URL loga sa istog domena, kontakt dolje). |
| `three` / `threeUrl` | Ako sajt već ima three.js, ili ga hostuje sam (zadano: jsDelivr, three@0.160.0). |
| `jspdf` / `jspdfUrl`, `pdfFonts` | Isto za jsPDF (zadano jspdf@2.5.2) i TTF fontove `{ normal, bold }` (zadano Roboto). |
| `onCheckout`, `onChange`, `onReady` | Callback funkcije. `onCheckout(order)` dodaje dugme "Pošalji upit"; `order.lines` = `[{ id, sku, name, qty, unitPrice, total }]`, plus `order.total` i `order.design`. |

API instance: `getOrder()`, `getDesign()`, `loadDesign(d)`, `addElement(id)`, `setSeries(s)`, `setView('2d'|'3d')`, `exportPdf()`, `exportCsv()`, `getSpecification()`, `importSpecification(fajl ili tekst)`, `undo()`, `redo()`, `clear()`, `destroy()`, `ready` (Promise).

## PDF, specifikacija (CSV) i ponovno učitavanje

"Preuzmi PDF" pravi `kuhinja-GGGG-MM-DD.pdf`. Na prvoj strani su naslov, 3D slika, spisak elemenata (količina, šifra, naziv, dimenzije, cijena) i ukupno, na drugoj crteži svih zidova sa mjerama. Tekst je pravi tekst (šifre se mogu kopirati), a projekat je sakriven u svojstvima PDF-a, pa se i PDF može ponovo učitati.

"Preuzmi specifikaciju" pravi `kuhinja-GGGG-MM-DD.csv` koji se otvara u Excelu: stavke sa cijenama, radna ploča i cokla, zatim zidovi i raspored (zid, pozicija od lijevog ruba, šifra, naziv, dimenzije). Zadnji red (`kitchen-planner`) nosi cijeli projekat.

"Učitaj specifikaciju" vraća tu kuhinju u planer, i u praznom pregledniku. Ako je zadnji red obrisan, kuhinja se vraća iz redova "Zidovi" i "Raspored" po šifri. Radi i kad Excel fajl snimi sa zarezima umjesto tačke-zareza. Prima i JSON (`getDesign()` ili cijeli `order` iz `onCheckout`), pa prodavnica može kupcu vratiti kuhinju iz upita. Elementi kojih više nema u katalogu se preskoče i to se prijavi. Učitavanje se poništava sa Ctrl+Z.

## Kako radi raspored

- Svaki zid ima donji red (donji elementi, 82 cm), gornji red (gornji elementi, gornja ivica na 212 cm) i visoke elemente koji zauzimaju oba reda. Elementi se lijepe za susjede i ne mogu se preklopiti.
- Zidovi su lanac: desni kraj zida A je ugao s lijevim krajem zida B (L), a desni kraj zida B je ugao sa zidom C (U). Element u uglu zauzima i početak susjednog zida u svojoj dubini. To se provjerava u tlocrtu, a na susjednom zidu se vidi kako taj element izgleda iz tog pogleda.
- Ugaoni elementi su nacrtani kao na fotografijama: donji 90×90 kao L sa vratima na oba kraka, Una/Tisa D UG kao slijepi ugao, gornji 60×60 kao kosi (petougaoni) ugao. Spušten blizu ugla, ugaoni element ide u ugao i odmakne elemente drugog zida koji mu smetaju.
- Sažetak računa potrebnu dužinu radne ploče i cokle; za Una/Tisa predlaže komade cokle (4 m, 2 m, 0,6 m) uz najmanje otpada.
- "Prebaci cijelu kuhinju na liniju X" mijenja svaki element odgovarajućim (isti tip i širina) iz druge linije.

## Katalog iz `elementi.json`

```
node scripts/build-catalog.js [putanja/do/elementi.json]
```

Pravi `katalog.json` (format planera), `katalog.csv` (za provjeru u Excelu) i `demo/katalog.js`, i ispisuje upozorenja o podacima. Tip elementa (donji, ladičar, sudoper, napa, visoki, ugaoni…), broj vrata i ladica te boje korpusa i fronte izvlače se iz `naziv`, `opis` i `boja`.

---

<p><img src="brand/plan-mark.svg" alt="" height="48"></p>

# FloorPlanner (planer tlocrta)

Druga aplikacija u ovom repou: crtanje tlocrta stanova i kuća u pregledniku. Demo: https://mirhat.github.io/elements/plan/

- **Zidovi:** klik za svaki ugao. Lijepe se za uglove, postojeće zidove (T-spoj), poravnanja i mrežu od 5 cm, a smjer se poravnava na 0/45/90°. Dok crtaš, upiši broj i Enter za tačnu dužinu. Zid koji presiječe drugi zid ga podijeli.
- **Prostorije:** prevuci pravougaonik (zidovi + prostorija) ili klikni unutar zatvorenih zidova. Kad zatvoriš zidove, prostorija se pravi sama. Površina se računa unutar zidova i prati pomjeranje zidova.
- **Vrata i prozori:** klik na zid. Vrsta vrata: obična, dvokrilna, klizna, balkonska ili prolaz. Strana otvaranja i šarke se mijenjaju, a otvor se pomjera duž zida.
- **Namještaj i sanitarije:** 19 komada (kreveti, sofa, sto, ormar, kuhinja, kada, tuš, WC, umivaonik, veš mašina, stepenice…). Prevlače se, rotiraju (R) i mijenja im se veličina.
- **Uređivanje:** pomjeranje uglova i cijelih zidova, mjere na zidovima, tekst, poništi/ponovi, automatsko čuvanje, zum i pomjeranje mišem ili prstima.
- **3D prikaz:** zidovi sa prozorima (okvir, pregrada, staklo, daska) i vratima (štok, krilo, kvaka), parket u sobama i pločice u kupatilu, kuhinji i hodniku, te namještaj kao pravi modeli (sofa sa jastucima, krevet sa posteljinom, sto sa stolicama, kuhinja sa sudoperom i pločom, kada, tuš, WC, umivaonik sa ogledalom…).
- **Šetnja u prvom licu:** dugme "Šetnja" u 3D. Hoda se sa W A S D ili strelicama (Shift brže), a gleda povlačenjem mišem. Na telefonu je džojstik lijevo i povlačenje prstom za pogled. Kroz zidove i namještaj se ne može, kroz vrata može. Mala mapa pokazuje gdje si, a klik na nju te prebaci. Esc izlazi.
- **PDF** sa planom i spiskom prostorija, **PNG** i **JSON**. PDF i JSON se mogu ponovo učitati.

```html
<div id="tlocrt"></div>
<script src="https://cdn.jsdelivr.net/gh/mirhat/elements@main/src/floor-planner.min.js"></script>
<script>
  FloorPlanner.create({
    container: '#tlocrt',
    pdf: { company: 'Naziv firme', logo: '/logo.png', footer: 'Tel. 033 000 000' },
  });
</script>
```

Za stalni link umjesto `@main` koristi tag verzije (npr. `@v0.1.2`) kad bude napravljen.

| Opcija | Opis |
|---|---|
| `container` | Element ili CSS selektor. |
| `defaultDesign` / `design` | Primjer plana za nove posjetioce / plan koji se učita svaki put. `FloorPlanner.sketch({...})` pravi plan iz kratkog opisa (zidovi kao `[x1, y1, x2, y2, debljina]`, otvori, prostorije, namještaj), pogledaj `plan/index.html`. |
| `storageKey`, `autosave` | Plan se sam čuva u pregledniku. |
| `pdf` | `{ title, company, logo, footer }` za zaglavlje i podnožje PDF-a. |
| `theme`, `labels` | Boje (`--fp-accent`…) i svi tekstovi sučelja. |
| `three`/`threeUrl`, `jspdf`/`jspdfUrl`, `pdfFonts` | Isto kao kod planera kuhinje. |
| `onChange` | `(plan) => {}` nakon svake promjene. |

API: `getDesign()`, `loadDesign(plan)`, `areas()` (prostorije sa m²), `setTool('select'|'wall'|'room'|'door'|'window'|'furniture'|'text')`, `setView('2d'|'3d')`, `walk()` (šetnja), `walkTo(x, y, smjer)` (šetnja od tačke plana u cm, smjer u stepenima), `fit()`, `undo()`, `redo()`, `clear()`, `exportPdf()`, `exportPng()`, `exportJson()`, `importText(tekst)`, `destroy()`.

Prečice: S odaberi, Z zid, P prostorija, V vrata, O prozor, N namještaj, T tekst, R rotacija, Delete briše, Esc završava ili poništava, Ctrl+Z / Ctrl+Shift+Z, razmak + prevlačenje za pomjeranje plana.

