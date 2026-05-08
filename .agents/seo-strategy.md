# SEO Strategy — Delta Air Shuttle
**Agent 3 SEO | KronAds | Actualizat: 2026-04-30**

---

## AUDIT ON-PAGE — STATUS ACTUAL

### Pagini audiate

| Pagină | Title | Description | Canonical | OG Tags | Schema |
|---|---|---|---|---|---|
| / (homepage) | ✅ | ✅ | ❌ LIPSĂ | ✅ parțial | ❌ LIPSĂ |
| /rezervari | ✅ | ✅ | ✅ | ✅ | ❌ LIPSĂ |
| /blog | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/transfer-brasov-otopeni-ghid | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/economy-vs-privat-transfer-aeroport | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/greseli-rezervare-transfer-aeroport | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/transfer-corporate-brasov-aeroport | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/transfer-aeroport-poiana-brasov-sinaia | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |
| /blog/retur-otopeni-brasov-noapte | ✅ | ✅ | ✅ | ❌ | ❌ LIPSĂ |

### Probleme critice găsite
1. ❌ **Homepage fără canonical** — risc duplicate content (www vs non-www)
2. ❌ **Schema markup 0%** — nicio pagină nu are JSON-LD (LocalBusiness, Article, BreadcrumbList)
3. ❌ **sitemap.xml inexistent** — Google nu știe ce pagini să indexeze
4. ❌ **robots.txt inexistent** — crawling necontrolat
5. ⚠️ **Blog-urile fără OG tags** — preview urât pe Facebook/WhatsApp
6. ⚠️ **Title ghid 2025** → trebuie actualizat la 2026

### Ce e bine
- Toate paginile au title + description unice
- Canonicals prezente pe toate paginile (mai puțin homepage)
- URL-uri curate și semantice
- Blog cu 6 articole relevante deja publicate

---

## FIȘIERE CREATE (vezi cod mai jos)

1. `sitemap.xml` — creat ✅
2. `robots.txt` — creat ✅
3. Schema LocalBusiness — de adăugat în `<head>` homepage ✅ (cod mai jos)
4. Schema Article — de adăugat în fiecare articol blog ✅ (cod mai jos)

---

## SCHEMA MARKUP — COD DE ADĂUGAT

### 1. Homepage — LocalBusiness + Service (în `<head>`)

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Delta Air Shuttle",
  "description": "Transfer privat și economic Brașov–Aeroport Henri Coandă (Otopeni). Curse fixe zilnice, rezervare online.",
  "url": "https://delta-air.ro",
  "telephone": "+40761617606",
  "email": "rezervari@delta-air.ro",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "Str. 13 Decembrie nr. 129A",
    "addressLocality": "Brașov",
    "addressCountry": "RO"
  },
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 45.6579,
    "longitude": 25.6012
  },
  "openingHoursSpecification": [
    {
      "@type": "OpeningHoursSpecification",
      "dayOfWeek": ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"],
      "opens": "00:00",
      "closes": "23:59"
    }
  ],
  "priceRange": "$$",
  "hasOfferCatalog": {
    "@type": "OfferCatalog",
    "name": "Tipuri de transfer",
    "itemListElement": [
      {
        "@type": "Offer",
        "name": "Transfer Economy",
        "description": "Loc individual în vehicul comun. Brașov–Otopeni.",
        "priceCurrency": "RON",
        "price": "120",
        "url": "https://delta-air.ro/rezervari"
      },
      {
        "@type": "Offer",
        "name": "Transfer Privat",
        "description": "Vehicul dedicat exclusiv. Brașov–Otopeni.",
        "priceCurrency": "RON",
        "price": "800",
        "url": "https://delta-air.ro/rezervari"
      }
    ]
  },
  "sameAs": [
    "https://www.facebook.com/deltaairshuttle",
    "https://www.instagram.com/deltaairshuttle"
  ]
}
</script>
```

### 2. Canonical lipsă — adaugă în `<head>` homepage

```html
<link rel="canonical" href="https://delta-air.ro/">
```

### 3. Articole Blog — Article Schema (template)

Adaugă în `<head>` fiecărui articol (înlocuiește valorile):

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "TITLUL ARTICOLULUI",
  "description": "DESCRIEREA META",
  "url": "https://delta-air.ro/blog/SLUG",
  "datePublished": "2026-04-01",
  "dateModified": "2026-04-30",
  "author": {
    "@type": "Organization",
    "name": "Delta Air Shuttle",
    "url": "https://delta-air.ro"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Delta Air Shuttle",
    "logo": {
      "@type": "ImageObject",
      "url": "https://delta-air.ro/img/logo.png"
    }
  },
  "breadcrumb": {
    "@type": "BreadcrumbList",
    "itemListElement": [
      {"@type": "ListItem", "position": 1, "name": "Acasă", "item": "https://delta-air.ro"},
      {"@type": "ListItem", "position": 2, "name": "Blog", "item": "https://delta-air.ro/blog"},
      {"@type": "ListItem", "position": 3, "name": "TITLUL ARTICOLULUI", "item": "https://delta-air.ro/blog/SLUG"}
    ]
  }
}
</script>
```

---

## PLAN CONȚINUT BLOG — Q2–Q3 2026

### Articole existente (6) — stare bună, de actualizat anual
1. `/blog/transfer-brasov-otopeni-ghid` — ⚠️ titlul spune „2025", actualizează la 2026
2. `/blog/economy-vs-privat-transfer-aeroport` ✅
3. `/blog/greseli-rezervare-transfer-aeroport` ✅
4. `/blog/transfer-corporate-brasov-aeroport` ✅
5. `/blog/transfer-aeroport-poiana-brasov-sinaia` ✅
6. `/blog/retur-otopeni-brasov-noapte` ✅

### Articole noi recomandate (prioritizate după volum căutare)

| Prioritate | Slug | Titlu | Cuvânt cheie țintă |
|---|---|---|---|
| 🔴 P1 | `/blog/pret-transfer-brasov-otopeni` | Cât costă un transfer Brașov–Otopeni în 2026 | pret transfer brasov aeroport |
| 🔴 P1 | `/blog/transfer-brasov-aeroport-ora-4-dimineata` | Transfer la aeroport la 4 dimineața din Brașov | transfer brasov aeroport noapte |
| 🟡 P2 | `/blog/sfantu-gheorghe-miercurea-ciuc-aeroport` | Transfer la aeroport din Sf. Gheorghe și Miercurea Ciuc | transfer sfantu gheorghe aeroport |
| 🟡 P2 | `/blog/bagaje-mari-transfer-aeroport` | Transfer cu bagaje mari sau schi: ce trebuie să știi | transfer cu schi aeroport |
| 🟢 P3 | `/blog/check-in-online-sfaturi` | Check-in online: ghidul complet pentru brașoveni | check in online zbor |
| 🟢 P3 | `/blog/zboruri-ieftine-brasov` | De unde zboară brașovenii: OTP, BCM, CLJ comparate | zboruri brasov aeroport |

### Format recomandat pentru fiecare articol
- 800–1200 cuvinte
- H1 = cuvântul cheie principal
- H2-uri = întrebări pe care le pune utilizatorul
- Tabel sau listă în primele 300 cuvinte (pentru featured snippets)
- CTA la rezervare în mijloc și la final
- Link intern spre `/rezervari`

---

## STRUCTURĂ URL — VALIDARE

Structura actuală e corectă:
```
delta-air.ro/                          ✅ homepage
delta-air.ro/rezervari/                ✅ rezervare
delta-air.ro/blog/                     ✅ index blog
delta-air.ro/blog/[slug]/             ✅ articole
delta-air.ro/lista-de-preturi/         ✅ prețuri
delta-air.ro/despre-noi/              ✅ about
delta-air.ro/contact/                 ✅ contact
```

Recomandare adăugare:
```
delta-air.ro/faq/                      → pagină FAQ cu schema FAQPage
delta-air.ro/recenzii/                 → pagină recenzii cu schema Review
```

---

## QUICK WINS — DE IMPLEMENTAT ACEASTĂ SĂPTĂMÂNĂ

| # | Task | Impact | Efort |
|---|---|---|---|
| 1 | Adaugă `sitemap.xml` și trimite în Google Search Console | 🔴 Critic | 15 min |
| 2 | Adaugă `robots.txt` | 🔴 Critic | 5 min |
| 3 | Adaugă LocalBusiness schema pe homepage | 🔴 Critic | 20 min |
| 4 | Adaugă canonical pe homepage | 🟡 Important | 2 min |
| 5 | Actualizează titlul ghid 2025 → 2026 | 🟡 Important | 2 min |
| 6 | Creează Google Business Profile | 🔴 Critic | 30 min |
| 7 | Adaugă Article schema pe toate articolele blog | 🟡 Important | 45 min |
| 8 | Adaugă OG tags pe articolele blog | 🟡 Important | 30 min |

---

## AI SEARCH (AEO) — OPTIMIZARE PENTRU CHATGPT/PERPLEXITY/GEMINI

Când cineva întreabă „cum ajung la aeroport din Brașov?", vrem să apărem.

**Tactici:**
1. Adaugă o secțiune FAQ structurată pe homepage cu întrebări directe:
   - „Cât durează drumul Brașov–Otopeni?" → „~2.5 ore pe A3"
   - „La ce oră pleacă shuttle-ul?" → „01:30 și 14:00 din Brașov"
   - „Cât costă transferul?" → „Economy 120 lei/adult, Privat 800 lei/cursă"
2. Asigură-te că numele companiei apare consistent: **Delta Air Shuttle** (nu Delta Air, nu Delta)
3. Adaugă schema FAQPage pe homepage

---

## GOOGLE SEARCH CONSOLE — DE CONFIGURAT

1. Mergi la search.google.com/search-console
2. Adaugă proprietate: `https://delta-air.ro`
3. Verifică prin DNS (Cloudflare) — adaugi un TXT record
4. Submit sitemap: `https://delta-air.ro/sitemap.xml`
5. Monitorizează săptămânal: impresii, clicuri, poziție medie

**Target în 90 de zile:**
- Poziție 1–3 pentru „transfer brașov aeroport otopeni"
- Indexare completă: 10+ pagini
- Featured snippet pentru „cât costă transfer brașov otopeni"
