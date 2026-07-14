# Delta Air Agent — Lista de Priorități

## 1. Checklist Preflight (ÎNAINTE de orice modificare)

- [ ] **Confirmă fișierul activ**: `rezervare.html` (RO, live pe `/rezervari`) este formularul principal. NU modifica `booking.html` decât pentru varianta EN Stripe direct.
- [ ] **Verifică prețurile în DOUĂ locuri**: `server.js` (VOUCHERS, calcul preț) + HTML (afișare client). Trebuie sincronizate.
- [ ] **Testează diferențierea Otopeni vs Băneasa** — Economy are prețuri diferite (150 vs 170 lei adult). Bug istoric.
- [ ] **Confirmă mediul Stripe**: LIVE activ. Nu comuta pe TEST fără confirmare explicită de la Emil.
- [ ] **Verifică pickup point** înainte să aplici voucher MAURER-20 (restricție hard-coded).
- [ ] **Deploy dual**: Frontend → Vercel, Backend → Railway via GitHub push.

## 2. Priorități IMEDIATE (urgent)

1. **Consent Mode v2 pe GTM** (GTM-5N4NP4CN) — rezolvă avertismentul "rată consimțământ 0%". Adaugă banner cookies + `gtag('consent', 'default')` înainte de GA4 Config.
2. **Șterge/arhivează `booking.html`** sau redirect 301 către `rezervare.html` — sursă de confuzie și dublă mentenanță.
3. **Test end-to-end MAURER-20**: rezervare Penny Avantgarden → aplică voucher → factură PDF corectă → email Brevo trimis.
4. **Verifică webhook Stripe LIVE** activ pe Railway (endpoint + secret în env vars).

## 3. Priorități pe TERMEN MEDIU (optimizări)

- **Unificare surse de adevăr preț**: mutare prețuri într-un singur `pricing.json` consumat de `server.js` + injectat în HTML la build.
- **Enhanced Conversions Google Ads** (cont 868-486-6566) — trimite email/telefon hashuit din formular.
- **Google Ads Conversion Tracking** pentru evenimentul `purchase` din GA4.
- **A/B test preț Privat** (900 vs 950 lei Otopeni) — margine mare, testabil.
- **SEO blog**: pagini blog existente + interlink către `/lista-de-preturi` și `/rezervari`.
- **Serie facturi**: la deploy nou verifică numărul curent (continuitate contabilă — regulă KronAds Imperium).

## 4. Reguli de business CRITICE (never break)

| Regulă | Detaliu |
|---|---|
| **MAURER-20** | -20 lei, VALID DOAR la pickup Penny Avantgarden Bartolomeu. Backend validează, nu doar frontend. |
| **DELTA200** | -200 lei, general, aplicabil oricând. |
| **Copil < 12 ani** | Preț redus automat (105 Otopeni / 115 Băneasa). |
| **Bagaj suplimentar** | 25 lei/buc, calculat backend. |
| **Orare fixe** | Dus 01:30 & 14:00, Retur 07:00 & 19:30. Nu inventa curse suplimentare. |
| **Primul pickup** | Penny Avantgarden la 01:00 / 13:30 (cu 30 min înainte de Sala Sporturilor). |
| **Stripe LIVE** | Niciodată nu comuta pe test în producție. Cheile în Railway env vars. |
| **GA4 & Google Ads** | Proprietăți SEPARATE Delta Air (G-LSB7150J68 + 868-486-6566). NU folosi conturile KronAds. |

## 5. Surse de adevăr

| Nevoie | Fișier |
|---|---|
| Prețuri, vouchere, calcul comandă | `server.js` (VOUCHERS array) |
| Webhook Stripe, PDF factură, email Brevo | `server.js` |
| Formular RO live | `rezervare.html` |
| Formular EN + Stripe direct | `booking.html` (candidat deprecare) |
| Listă publică prețuri | `lista-de-preturi/index.html` |
| Homepage | `index.html` |
| DNS delta-air.ro | Cloudflare dashboard |
| Analytics | GTM-5N4NP4CN → GA4 G-LSB7150J68 |
| Deploy frontend | Vercel (git push automat) |
| Deploy backend | Railway (git push automat) |

## Comportament implicit

- Comunicare: română, direct, fără emoji în cod.
- Înainte de deploy: recap scurt al modificărilor + confirmare Emil.
- La dubii preț/voucher: citește `server.js` FIRST, apoi HTML.
- La modificări de prețuri: actualizează ÎNTOTDEAUNA `server.js` + `rezervare.html` + `lista-de-preturi/index.html` + `index.html` simultan.
