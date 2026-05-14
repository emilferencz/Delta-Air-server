# Fleet Management — Delta Air Shuttle
**Data:** 2026-05-15  
**Status:** Aprobat

## Rezumat
Sistem de gestionare flotă vehicule integrat în admin-ul Delta Air Shuttle. Fiecare vehicul are ore de curse proprii, capacitate proprie și rezervările sunt alocate per vehicul. Include alerte pentru documente expirate/care expiră.

---

## 1. Schema bazei de date

### Tabel nou: `vehicles`
```sql
CREATE TABLE vehicles (
  id              SERIAL PRIMARY KEY,
  plate           VARCHAR(20)  NOT NULL UNIQUE,
  make            VARCHAR(50),
  model           VARCHAR(50),
  year            INTEGER,
  capacity        INTEGER      NOT NULL DEFAULT 7,
  tur_c1          VARCHAR(5),
  tur_c2          VARCHAR(5),
  retur_c1        VARCHAR(5),
  retur_c2        VARCHAR(5),
  status          VARCHAR(10)  DEFAULT 'activ',
  km              INTEGER      DEFAULT 0,
  itp_date        DATE,
  insurance_date  DATE,
  service_date    DATE,
  service_km      INTEGER      DEFAULT 0,
  driver_name     VARCHAR(100),
  notes           TEXT,
  created_at      TIMESTAMPTZ  DEFAULT NOW()
)
```

### Modificare: `bookings`
```sql
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id);
```

### Migrare automată în `initDB()`
1. Creează tabelul `vehicles` dacă nu există
2. Dacă tabelul e gol → inserează vehiculul implicit (plate='VB-01', capacity=7, orele standard 01:30/14:00/07:00/19:30)
3. `UPDATE bookings SET vehicle_id=1 WHERE vehicle_id IS NULL`

---

## 2. Backend API

### Endpoint-uri noi (protejate cu auth admin)
| Metodă | Cale | Descriere |
|--------|------|-----------|
| GET | `/api/admin/vehicles` | Lista tuturor vehiculelor |
| POST | `/api/admin/vehicles` | Adaugă vehicul nou |
| PUT | `/api/admin/vehicles/:id` | Editează vehicul |
| DELETE | `/api/admin/vehicles/:id` | Dezactivează vehicul (status='inactiv') |

### Modificări endpoint-uri existente

**`GET /api/availability`**
- Returnează disponibilitate per vehicul activ
- Response grupat pe `plate`: `{ "VB-01": { c1: { time, disponibile }, c2: {...} } }`
- Capacitate per vehicul din coloana `vehicles.capacity`

**`POST /api/book`**
- Primește opțional `vehicle_id`
- Dacă lipsește: alocă automat primul vehicul activ cu loc disponibil la ora selectată
- Validare capacitate per vehicul (nu global)

**`GET /api/admin/bookings`**
- JOIN cu `vehicles` → include `vehicle_plate` în răspuns

---

## 3. UI Admin

### 3.1 Secțiunea Flotă
- Plasare: între header și stats-bar
- Card per vehicul cu: nr. înmatriculare, marcă/model/an, capacitate, ore curse, șofer, status (badge colorat)
- Badge alerte pe card (🔴 expirat / 🟡 expiră curând)
- Buton `+ Adaugă vehicul`
- Click pe card → modal editare

### 3.2 Modal Adaugă/Editează vehicul
Trei secțiuni:
1. **Identificare**: număr înmatriculare, marcă, model, an fabricație, capacitate locuri
2. **Curse**: tur c1, tur c2, retur c1, retur c2
3. **Operațional**: km actuali, dată ITP, dată asigurare, dată ultimă revizie, km ultimă revizie, șofer, note, status (activ/inactiv)

### 3.3 Banner alerte
- Apare imediat după login dacă există documente problematice
- 🔴 Roșu: document expirat (data < azi)
- 🟡 Galben: expiră în ≤ 30 zile
- Tipuri urmărite: ITP, asigurare RCA, revizie (>15.000 km sau >12 luni de la ultima)

### 3.4 Integrare calendar lunar
- Pill-urile de rezervare afișează plăcuța vehiculului (ex: `01:30 ↑ Popescu · VB-01`)

### 3.5 Integrare calendar anual
- Tooltip arată detaliere per vehicul

### 3.6 Statistici KPI
- Dropdown selector vehicul în header KPI: "Toată flota" / vehicul individual

---

## 4. Formular public rezervare
- Clientul nu selectează vehiculul
- Disponibilitatea afișată = suma locurilor libere din toate vehiculele active la ora respectivă
- La confirmare: `vehicle_id` ales automat (primul vehicul activ cu loc)

---

## 5. Reguli de business
- Un vehicul dezactivat nu apare în disponibilitate publică
- Rezervările existente pe vehiculul dezactivat rămân valide
- Ștergerea fizică a unui vehicul nu e permisă dacă are rezervări asociate
- Capacitatea `CAPACITY = 7` din server.js devine dinamică, citită din DB per vehicul
