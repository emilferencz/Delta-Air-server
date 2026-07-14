/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║   DELTA AIR SHUTTLE — Backend Stripe (Node.js)             ║
 * ║                                                            ║
 * ║   Pornire:  node server.js                                 ║
 * ║   Cerinte:  npm install express stripe cors dotenv         ║
 * ║             nodemailer                                     ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const crypto     = require('crypto');
const https      = require('https');
const fs         = require('fs');
const path       = require('path');
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
const { Pool }   = require('pg');
const { Netopia, rawTextBodyParser } = require('netopia-card');

/* ── PostgreSQL — disponibilitate curse ── */
const db = process.env.DATABASE_URL ? new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
}) : null;

const CAPACITY   = 7;
const TRIP_TIMES = {
  tur:   { c1: '01:30', c2: '14:00' },
  retur: { c1: '07:00', c2: '19:30' }
};

/* ── Vouchere de reducere ── */
const VOUCHERS = {
  'DELTA200':  { discount: 200, label: 'Voucher reducere DELTA200', stripeCouponId: 'DELTA200' },
  'MAURER-20': { discount: 20, perPerson: true, label: 'Reducere parteneri Avantgarden Maurer', pickupRequired: 'avantgarden', stripeCouponId: null },
};

async function initDB() {
  if (!db) { console.warn('⚠️  DATABASE_URL lipsă — disponibilitate dezactivată'); return; }
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id            SERIAL PRIMARY KEY,
      trip_date     DATE         NOT NULL,
      trip_time     VARCHAR(5)   NOT NULL,
      direction     VARCHAR(10)  NOT NULL,
      passengers    INTEGER      NOT NULL DEFAULT 1,
      transfer_type VARCHAR(20)  DEFAULT 'economy',
      booking_ref   VARCHAR(100),
      status        VARCHAR(20)  DEFAULT 'confirmed',
      created_at    TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bookings_trip
    ON bookings(trip_date, trip_time, direction, status)
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pending_payments (
      token      VARCHAR(64)  PRIMARY KEY,
      meta_json  TEXT         NOT NULL,
      created_at TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id          SERIAL PRIMARY KEY,
      year        INT          NOT NULL,
      booking_token VARCHAR(100),
      client_name VARCHAR(200),
      created_at  TIMESTAMPTZ  DEFAULT NOW()
    )
  `);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS meta_json TEXT`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS billing_token VARCHAR(64)`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS reminded_at TIMESTAMPTZ`);

  /* ── Tabel vehicule ── */
  await db.query(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id              SERIAL PRIMARY KEY,
      plate           VARCHAR(20)  NOT NULL UNIQUE,
      make            VARCHAR(50),
      model           VARCHAR(50),
      year            INTEGER,
      capacity        INTEGER      NOT NULL DEFAULT 7,
      tur_c1          VARCHAR(5)   DEFAULT '01:30',
      tur_c2          VARCHAR(5)   DEFAULT '14:00',
      retur_c1        VARCHAR(5)   DEFAULT '07:00',
      retur_c2        VARCHAR(5)   DEFAULT '19:30',
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
  `);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS vehicle_id INTEGER REFERENCES vehicles(id)`);
  /* Vehicul implicit la prima pornire */
  await db.query(`
    INSERT INTO vehicles (plate, make, model, capacity, tur_c1, tur_c2, retur_c1, retur_c2)
    SELECT 'VB-01', 'Delta Air', 'Shuttle', 7, '01:30', '14:00', '07:00', '19:30'
    WHERE NOT EXISTS (SELECT 1 FROM vehicles)
  `);
  /* Migrare rezervări existente → vehicul implicit */
  await db.query(`UPDATE bookings SET vehicle_id = (SELECT id FROM vehicles ORDER BY id LIMIT 1) WHERE vehicle_id IS NULL`);
  console.log('✅ DB bookings + vehicles gata');
}

async function savePendingPayment(token, meta) {
  if (!db) return;
  await db.query(
    `INSERT INTO pending_payments (token, meta_json) VALUES ($1, $2)
     ON CONFLICT (token) DO UPDATE SET meta_json = $2`,
    [token, JSON.stringify(meta)]
  );
}

async function getPendingPayment(token) {
  if (!db) return null;
  const { rows } = await db.query(
    'SELECT meta_json FROM pending_payments WHERE token = $1',
    [token]
  );
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].meta_json); } catch (_) { return null; }
}

async function deletePendingPayment(token) {
  if (!db) return;
  await db.query('DELETE FROM pending_payments WHERE token = $1', [token]);
}
initDB().catch(e => console.error('❌ DB init error:', e.message));

/* Găsește vehiculul activ cu cel mai mult spațiu liber la ora/data/direcția dată */
async function findVehicleForTrip(dir, tripTime, date, passengers) {
  if (!db) return null;
  const { rows } = await db.query(
    `SELECT id, capacity, ocupate FROM (
       SELECT v.id, v.capacity,
              COALESCE((SELECT SUM(b.passengers) FROM bookings b
                WHERE b.vehicle_id = v.id AND b.trip_date = $3
                AND b.trip_time = $2 AND b.direction = $1 AND b.status = 'confirmed'), 0)::int AS ocupate
       FROM vehicles v
       WHERE v.status = 'activ'
         AND ($2 IN (v.tur_c1, v.tur_c2, v.retur_c1, v.retur_c2))
     ) sub
     ORDER BY (capacity - ocupate) DESC LIMIT 1`,
    [dir, tripTime, date]
  );
  if (rows.length && (rows[0].capacity - rows[0].ocupate) >= passengers) return rows[0].id;
  /* Fallback: primul vehicul activ */
  const { rows: fb } = await db.query(`SELECT id FROM vehicles WHERE status='activ' ORDER BY id LIMIT 1`);
  return fb[0]?.id || null;
}

async function recordBooking(meta) {
  if (!db) throw new Error('Conexiune DB indisponibilă (DATABASE_URL lipsă)');
  const { dir, tr, trip, date } = meta || {};
  if (!dir) throw new Error('Câmp lipsă: dir');
  if (!date) throw new Error('Câmp lipsă: date');
  const tripTime = TRIP_TIMES[dir]?.[trip];
  if (!tripTime) throw new Error(`Orar negăsit pentru dir="${dir}" trip="${trip}"`);
  const passengers = tr === 'privat'
    ? CAPACITY
    : (parseInt(meta.adults || 1) + parseInt(meta.children || 0));
  const _metaClean = (m) => { const c={...m}; delete c.signatureDataUrl; return c; };
  const vehicleId = await findVehicleForTrip(dir, tripTime, date, passengers);
  await db.query(
    `INSERT INTO bookings (trip_date, trip_time, direction, passengers, transfer_type, booking_ref, meta_json, vehicle_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [date, tripTime, dir, passengers, tr || 'economy', meta.name || '', JSON.stringify(_metaClean(meta)), vehicleId]
  );
  console.log(`📋 Booking înregistrat: ${date} ${tripTime} ${dir} — ${passengers} loc(uri) [vehicul: ${vehicleId}]`);

  const rt = meta.returnTrip;
  if (rt?.date && rt?.dir && rt?.trip) {
    const rtTime = TRIP_TIMES[rt.dir]?.[rt.trip];
    if (rtTime) {
      const rtVehicleId = await findVehicleForTrip(rt.dir, rtTime, rt.date, passengers);
      await db.query(
        `INSERT INTO bookings (trip_date, trip_time, direction, passengers, transfer_type, booking_ref, meta_json, vehicle_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [rt.date, rtTime, rt.dir, passengers, tr || 'economy', meta.name || '', JSON.stringify({..._metaClean(meta), _isReturnTrip: true}), rtVehicleId]
      );
      console.log(`📋 Booking retur înregistrat: ${rt.date} ${rtTime} ${rt.dir} — ${passengers} loc(uri) [vehicul: ${rtVehicleId}]`);
    }
  }
}

/* ── Cache logo Delta Air pentru PDF ── */
let LOGO_BUFFER = null;
https.get('https://delta-air.ro/img/logo-p3.png', res => {
  const chunks = [];
  res.on('data', c => chunks.push(c));
  res.on('end', () => {
    LOGO_BUFFER = Buffer.concat(chunks);
    console.log('✅ Logo PDF incarcat:', LOGO_BUFFER.length, 'bytes');
  });
}).on('error', e => console.warn('⚠️ Logo PDF indisponibil:', e.message));

/* ── Font Unicode pentru PDF (suport diacritice românești) ── */
let PDF_FONT_REG  = null;
let PDF_FONT_BOLD = null;
try {
  PDF_FONT_REG  = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSans-Regular.ttf'));
  PDF_FONT_BOLD = fs.readFileSync(path.join(__dirname, 'fonts', 'NotoSans-Bold.ttf'));
  console.log('✅ Fonturi Unicode PDF încărcate (NotoSans)');
} catch (e) {
  console.warn('⚠️ Fonturi Unicode PDF indisponibile — se folosește Helvetica fără diacritice:', e.message);
}

/* ── ro() — transliterare diacritice (folosit doar dacă fontul Unicode lipsește) ── */
function ro(str) {
  if (!str) return '';
  if (PDF_FONT_REG) return String(str);
  return String(str)
    .replace(/ă/g,'a').replace(/Ă/g,'A')
    .replace(/â/g,'a').replace(/Â/g,'A')
    .replace(/î/g,'i').replace(/Î/g,'I')
    .replace(/ș/g,'s').replace(/Ș/g,'S')
    .replace(/ț/g,'t').replace(/Ț/g,'T')
    .replace(/ş/g,'s').replace(/Ş/g,'S')
    .replace(/ţ/g,'t').replace(/Ţ/g,'T')
    .replace(/→/g,'->').replace(/↔/g,'<->').replace(/·/g,'-');
}

/* ── Adresă email internă (notificări rezervări) ── */
const OFFICE_EMAIL = process.env.EMAIL_INTERNAL || 'office@delta-air.ro';

/* ── Stocare sesiuni rezervare în memorie (TTL 2 ore) ── */
const sessions = new Map();

/* ── Stocare contracte PDF în memorie (TTL 2 ore) ── */
const contractStore = new Map();
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [token, c] of contractStore) {
    if (c.createdAt < cutoff) contractStore.delete(token);
  }
}, 15 * 60 * 1000);
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (s.createdAt < cutoff) sessions.delete(id);
  }
}, 15 * 60 * 1000);

const app  = express();
const PORT = process.env.PORT || 3001;

/* ──────────────────────────────────────────────
   Nodemailer transporter
   Env vars necesare:
     EMAIL_HOST  (ex: smtp.gmail.com)
     EMAIL_PORT  (ex: 465)
     EMAIL_USER  (ex: office@delta-air.ro)
     EMAIL_PASS  (parola aplicatie Gmail / SMTP)
     EMAIL_FROM  (ex: "Delta Air Shuttle <office@delta-air.ro>")
────────────────────────────────────────────── */
const transporter = nodemailer.createTransport({
  host:   process.env.EMAIL_HOST || 'smtp.gmail.com',
  port:   parseInt(process.env.EMAIL_PORT || '465'),
  secure: parseInt(process.env.EMAIL_PORT || '465') === 465,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/* ── Template email confirmare rezervare ── */
function buildConfirmationEmail(meta) {
  const {
    dirLabel = '—', trLabel = '—', aptLabel = '—',
    date = '—', depTime = '—', arrTime = '—',
    name = '—', phone = '—', email = '—',
    adults = 1, children = 0, bags = 0,
    total = '—', pickupLabel, obs,
    firma, cui,
    voucherCode, voucherDiscount,
    returnTrip = null,
  } = meta;

  const isFirma = !!(firma && cui);
  const fmtD = s => (s && s.length===10) ? s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4) : (s||'—');

  return `<!DOCTYPE html>
<html lang="ro">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Confirmare rezervare – Delta Air Shuttle</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(26,47,94,.12)}
  .header{background:linear-gradient(135deg,#0f1e3d,#243d75);padding:40px 40px 32px;text-align:center}
  .header img{height:56px;margin-bottom:16px}
  .header h1{color:#fff;font-size:1.4rem;font-weight:700;margin:0}
  .header p{color:rgba(255,255,255,.75);font-size:.9rem;margin:8px 0 0}
  .body{padding:36px 40px}
  .success-badge{display:flex;align-items:center;gap:12px;background:#f0fff4;border:1.5px solid #9ae6b4;border-radius:12px;padding:16px 20px;margin-bottom:28px}
  .success-badge .icon{font-size:1.8rem}
  .success-badge p{margin:0;font-size:.95rem;color:#276749;font-weight:600}
  .section-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8892a4;margin:0 0 12px}
  .detail-box{background:#f4f6fb;border-radius:10px;padding:20px 24px;margin-bottom:20px}
  .detail-row{display:table;width:100%;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem;box-sizing:border-box}
  .detail-row:last-child{border-bottom:none}
  .detail-label{display:table-cell;width:45%;color:#8892a4;vertical-align:top;padding-right:8px}
  .detail-value{display:table-cell;font-weight:600;color:#1a202c;vertical-align:top}
  .total-box{background:linear-gradient(135deg,#0f1e3d,#243d75);border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
  .total-label{color:rgba(255,255,255,.75);font-size:.9rem}
  .total-value{color:#e8c96a;font-size:2rem;font-weight:900}
  .steps{margin-bottom:28px}
  .step{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
  .step-num{width:28px;height:28px;background:#c9a84c;color:#0f1e3d;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;flex-shrink:0;margin-top:2px}
  .step-text h4{font-size:.88rem;font-weight:700;color:#1a2f5e;margin:0 0 3px}
  .step-text p{font-size:.82rem;color:#8892a4;margin:0;line-height:1.6}
  .footer{background:#f4f6fb;padding:24px 40px;text-align:center;border-top:1px solid rgba(26,47,94,.08)}
  .footer p{font-size:.78rem;color:#8892a4;margin:4px 0;line-height:1.6}
  .footer a{color:#1a2f5e;text-decoration:none;font-weight:600}
  @media(max-width:600px){.body,.header,.footer{padding:24px 20px}.detail-row{flex-direction:column;gap:4px}.detail-value{text-align:left}}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>✈ Rezervare confirmată!</h1>
    <p>Plata a fost procesată cu succes. Mulțumim că ai ales Delta Air Shuttle.</p>
  </div>
  <div class="body">
    <div class="success-badge">
      <div class="icon">✅</div>
      <p>Rezervarea ta este confirmată și locul asigurat.</p>
    </div>

    <div class="section-title">Detalii cursă</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Tip transfer</span><span class="detail-value">${trLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${fmtD(date)}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${arrTime}</span></div>
      ${pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults > 1 ? 'ți' : ''}${children > 0 ? ` + ${children} copil${children > 1 ? 'i' : ''}` : ''}</span></div>
      ${bags > 0 ? `<div class="detail-row"><span class="detail-label">Bagaje extra</span><span class="detail-value">${bags} bagaj${bags > 1 ? 'e' : ''}</span></div>` : ''}
      ${obs ? `<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>` : ''}
    </div>

    ${returnTrip ? `
    <div class="section-title" style="margin-top:4px">↩ Cursă retur · −20%</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție retur</span><span class="detail-value">${returnTrip.dirLabel||'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Data retur</span><span class="detail-value">${fmtD(returnTrip.date)}</span></div>
      ${returnTrip.depTime ? `<div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${returnTrip.depTime}</span></div>` : ''}
      ${returnTrip.arrTime ? `<div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${returnTrip.arrTime}</span></div>` : ''}
      ${returnTrip.pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${returnTrip.pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Reducere retur</span><span class="detail-value" style="color:#276749;font-weight:700">−20% aplicat</span></div>
    </div>` : ''}

    <div class="section-title">Date de contact</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
      ${isFirma ? `<div class="detail-row"><span class="detail-label">Firmă</span><span class="detail-value">${firma} (${cui})</span></div>` : ''}
    </div>

    ${voucherCode ? `
    <div class="detail-box" style="margin-bottom:12px">
      <div class="detail-row"><span class="detail-label">Preț inițial</span><span class="detail-value">${parseFloat(total) + parseFloat(voucherDiscount || 0)} lei</span></div>
      <div class="detail-row"><span class="detail-label" style="color:#276749">Voucher ${voucherCode}</span><span class="detail-value" style="color:#276749">-${voucherDiscount} lei</span></div>
    </div>` : ''}
    <div class="total-box">
      <span class="total-label">Total achitat${returnTrip ? ' (tur + retur)' : ''}</span>
      <span class="total-value">${total} lei</span>
    </div>

    <div class="section-title">Ce urmează</div>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-text"><h4>Fii la punctul de îmbarcare cu 5 min. înainte</h4><p>Locul de plecare: ${pickupLabel || 'conform rezervării'}. Ora exactă: ${depTime}.</p></div></div>
      <div class="step"><div class="step-num">2</div><div class="step-text"><h4>Șoferul te contactează înainte de plecare</h4><p>Vei primi un SMS sau apel de confirmare cu 30 de minute înainte.</p></div></div>
      <div class="step"><div class="step-num">3</div><div class="step-text"><h4>Călătorești confortabil și prinzi zborul</h4><p>Sosire estimată la ${aptLabel}: ora ${arrTime}.</p></div></div>
    </div>
  </div>
  <div class="footer">
    <p><strong>Delta Air Shuttle</strong> · Transfer premium Brașov–Otopeni–Băneasa</p>
    <p>📞 <a href="tel:+40761617606">+40 761 617 606</a> &nbsp;·&nbsp; 💬 <a href="https://wa.me/40761617606">WhatsApp</a> &nbsp;·&nbsp; 🌐 <a href="https://delta-air.ro">delta-air.ro</a></p>
    <p style="margin-top:12px;font-size:.72rem;color:#a0aec0">Ai primit acest email deoarece ai efectuat o rezervare pe delta-air.ro. Dacă ai întrebări, contactează-ne oricând.</p>
  </div>
</div>
</body>
</html>`;
}

/* ── Trimite email confirmare ── */
async function sendConfirmationEmail(customerEmail, meta) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️  EMAIL_USER / EMAIL_PASS lipsă — email netrimitit.');
    return;
  }
  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`,
      to:      customerEmail,
      bcc:     OFFICE_EMAIL,                     // copie internă → rezervari@delta-air.ro
      subject: `✈ Confirmare rezervare Delta Air Shuttle — ${meta.date || ''} ${meta.dirLabel || ''}`,
      html:    buildConfirmationEmail(meta),
    });
    console.log(`📧 Email confirmare trimis → ${customerEmail}`);
  } catch (err) {
    console.error('❌ Eroare trimitere email:', err.message);
  }
}

/* ──────────────────────────────────────────────
   POST /api/validate-voucher
────────────────────────────────────────────── */
app.post('/api/validate-voucher', cors(), express.json(), (req, res) => {
  const code    = (req.body?.code   || '').trim().toUpperCase();
  const pickup  = (req.body?.pickup || '').toLowerCase();
  const voucher = VOUCHERS[code];
  if (!voucher) return res.json({ valid: false });
  if (voucher.pickupRequired && !pickup.includes(voucher.pickupRequired)) {
    return res.json({ valid: false, reason: 'pickup' });
  }
  res.json({ valid: true, discount: voucher.discount, perPerson: voucher.perPerson || false, label: voucher.label });
});

/* ──────────────────────────────────────────────
   IMPORTANT: webhook-ul Stripe TREBUIE să primească
   body-ul RAW (Buffer), deci îl montăm ÎNAINTE de
   express.json() și express.urlencoded()
────────────────────────────────────────────── */
app.use(cors());

/* ──────────────────────────────────────────────
   POST /api/stripe-webhook
   Stripe apelează acest endpoint după fiecare plată.
   Configurează în Stripe Dashboard:
     Endpoint URL: https://delta-air-server-production.up.railway.app/api/stripe-webhook
     Events:       checkout.session.completed
────────────────────────────────────────────── */
app.post('/api/stripe-webhook',
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const sig    = req.headers['stripe-signature'];
    const secret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;
    try {
      if (secret) {
        event = stripe.webhooks.constructEvent(req.body, sig, secret);
      } else {
        // Fără secret configurat — parsăm direct (doar pentru test)
        event = JSON.parse(req.body.toString());
        console.warn('⚠️  STRIPE_WEBHOOK_SECRET lipsă — semnătura nu e verificată!');
      }
    } catch (err) {
      console.error('Webhook signature error:', err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
      const session       = event.data.object;
      const email         = session.customer_email || session.customer_details?.email;
      const contractToken = session.metadata?.contract_token;

      // Preia meta COMPLET din contractStore (evită trunchierile din Stripe metadata)
      let meta = {};
      if (contractToken && contractStore.has(contractToken)) {
        meta = contractStore.get(contractToken).meta || {};
      } else {
        // Fallback 1: DB (funcționează și după restart server)
        if (contractToken) {
          try { meta = (await getPendingPayment(contractToken)) || {}; } catch (_) {}
        }
        // Fallback 2: metadata Stripe (poate fi trunchiat la 500 chars)
        if (!meta || !meta.name) {
          try { meta = JSON.parse(session.metadata?.rezervare_info || '{}'); } catch (_) {}
          const confirmedAt = session.metadata?.confirmed_at;
          if (confirmedAt) meta.confirmedAt = confirmedAt;
        }
      }
      meta.payMethod = 'card';

      console.log(`✅ Plată card confirmată | ${email} | ${meta.dirLabel || ''} | ${meta.date || ''}`);

      // Înregistrează în baza de date
      try {
        await recordBooking(meta);
      } catch (dbErr) {
        console.error('❌ recordBooking (card):', dbErr.message, '| meta:', JSON.stringify({ dir: meta.dir, trip: meta.trip, date: meta.date, name: meta.name }));
      }

      const hasEmail = !!(process.env.EMAIL_USER && process.env.EMAIL_PASS);
      if (email && hasEmail) {
        // Preia PDF din store (generat la crearea sesiunii) sau regenerează
        let attachment = null;
        try {
          let pdfBuffer, fileName;
          if (contractToken && contractStore.has(contractToken)) {
            const stored = contractStore.get(contractToken);
            pdfBuffer = stored.buffer;
            fileName  = stored.fileName;
          } else {
            pdfBuffer = await generateContractPDF(meta);
            fileName  = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;
          }
          attachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };
        } catch (pdfErr) {
          console.warn('⚠️ PDF webhook failed:', pdfErr.message);
        }

        const from        = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
        const invoiceAtt  = await buildInvoiceAttachment(meta, contractToken);
        const attachments = [attachment, invoiceAtt].filter(Boolean);

        const internalTo = OFFICE_EMAIL;

        // Email confirmare → client (+ BCC office ca copie garantată)
        try {
          await transporter.sendMail({
            from,
            to:  email,
            bcc: internalTo,
            subject: `✈ Confirmare rezervare Delta Air Shuttle — ${meta.date || ''} ${meta.dirLabel || ''}`,
            html:    buildConfirmationEmail(meta),
            attachments,
          });
          console.log(`📧 Email client (card) → ${email} | BCC → ${internalTo}`);
        } catch (err) { console.error('❌ Email client (card):', err.message); }

        // Notificarea internă la plata card vine prin BCC-ul de mai sus (evită duplicat)
      }
    }

    res.json({ received: true });
  }
);

/* ──────────────────────────────────────────────
   GET /api/availability?date=YYYY-MM-DD&direction=tur|retur
   Returnează locuri disponibile per cursă
────────────────────────────────────────────── */
app.get('/api/availability', async (req, res) => {
  if (!db) return res.json({ c1: null, c2: null, error: 'DB indisponibil' });
  const { date, direction } = req.query;
  if (!date || !direction) return res.status(400).json({ error: 'Parametri lipsă: date, direction' });
  const times = TRIP_TIMES[direction];
  if (!times) return res.status(400).json({ error: 'direction invalid' });
  try {
    /* Capacitate totală = suma vehiculelor active per slot orar */
    const { rows: vehicles } = await db.query(`SELECT id, capacity, tur_c1, tur_c2, retur_c1, retur_c2 FROM vehicles WHERE status='activ'`);
    const capPerTime = {};
    for (const v of vehicles) {
      const c1 = direction === 'tur' ? v.tur_c1 : v.retur_c1;
      const c2 = direction === 'tur' ? v.tur_c2 : v.retur_c2;
      if (c1) capPerTime[c1] = (capPerTime[c1] || 0) + v.capacity;
      if (c2) capPerTime[c2] = (capPerTime[c2] || 0) + v.capacity;
    }
    const result = {};
    for (const [key, time] of Object.entries(times)) {
      const { rows } = await db.query(
        `SELECT COALESCE(SUM(passengers), 0)::int AS ocupate
         FROM bookings
         WHERE trip_date = $1 AND trip_time = $2 AND direction = $3 AND status = 'confirmed'`,
        [date, time, direction]
      );
      const ocupate = rows[0].ocupate;
      const cap = capPerTime[time] || CAPACITY;
      result[key] = { time, ocupate, disponibile: Math.max(0, cap - ocupate) };
    }
    res.json(result);
  } catch (err) {
    console.error('❌ /api/availability error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   POST /api/netopia-notify
   IPN callback de la Netopia (trimis cu Content-Type: text/plain)
   Trebuie să răspundă cu { errorCode: 0 } pentru confirmare
────────────────────────────────────────────── */
app.post('/api/netopia-notify',
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('application/json')) {
      express.json()(req, res, next);
    } else {
      rawTextBodyParser(req, res, next);
    }
  },
  async (req, res) => {
    try {
      const { token } = req.query;
      let body = req.body;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (_) {}
      }

      console.log(`📬 Netopia IPN raw body type: ${typeof body}`);
      console.log(`📬 Netopia IPN body: ${JSON.stringify(body).substring(0, 400)}`);
      console.log(`📬 Netopia IPN token: ${token}`);

      const errorCode = body?.payment?.status?.errorCode
        ?? body?.payment?.errorCode
        ?? body?.errorCode
        ?? body?.status?.errorCode;
      const isSuccess = errorCode === '00' || errorCode === 0 || errorCode === '0' || String(errorCode) === '0';
      console.log(`📬 Netopia IPN: errorCode=${errorCode}, success=${isSuccess}`);

      if (isSuccess) {
        const orderIDFromBody = body?.order?.id || body?.orderID || body?.order?.orderID;
        const stored = (token && contractStore.get(`netopia-${token}`))
          || (orderIDFromBody && contractStore.get(`netopia-order-${orderIDFromBody}`));
        let meta = stored?.meta || null;
        if (!meta && token) {
          meta = await getPendingPayment(token);
          console.log(`📦 Meta din DB (token): ${meta ? 'găsit' : 'negăsit'}`);
        }
        if (!meta && orderIDFromBody) {
          meta = await getPendingPayment(orderIDFromBody);
          console.log(`📦 Meta din DB (orderID ${orderIDFromBody}): ${meta ? 'găsit' : 'negăsit'}`);
        }
        meta = meta || {};
        const customerEmail = meta.email || body?.order?.billing?.email;
        console.log(`📬 Netopia IPN: token=${token}, orderID=${orderIDFromBody}, email=${customerEmail}`);

        try { await recordBooking(meta); } catch (dbErr) { console.error('❌ recordBooking (netopia):', dbErr.message); }

        if (customerEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
          let attachment = null;
          try {
            const pdfBuffer = await generateContractPDF(meta);
            const fileName  = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;
            attachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };
          } catch (pdfErr) { console.warn('⚠️ PDF netopia notify failed:', pdfErr.message); }

          const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
          const invoiceAtt = await buildInvoiceAttachment(meta, token);
          try {
            await transporter.sendMail({
              from,
              to:  customerEmail,
              bcc: OFFICE_EMAIL,
              subject: `✈ Confirmare rezervare Delta Air Shuttle — ${meta.date || ''} ${meta.dirLabel || ''}`,
              html: buildConfirmationEmail({ ...meta, payMethod: 'card' }),
              attachments: [attachment, invoiceAtt].filter(Boolean),
            });
            console.log(`📧 Email client (netopia) → ${customerEmail}`);
          } catch (mailErr) { console.error('❌ Email netopia:', mailErr.message); }
        }

        if (token) contractStore.delete(`netopia-${token}`);
        if (orderIDFromBody) contractStore.delete(`netopia-order-${orderIDFromBody}`);
        // Nu ștergem pending_payments — documentele rămân disponibile pentru descărcare (2 ore)
      }

      res.json({ errorCode: 0 });
    } catch (err) {
      console.error('❌ Netopia notify error:', err.message);
      res.json({ errorCode: 99 });
    }
  }
);

/* ── Redirect transfer-brasov-aeroport.ro → delta-air.ro ── */
app.use((req, res, next) => {
  const h = req.hostname;
  if (h === 'transfer-brasov-aeroport.ro' || h === 'www.transfer-brasov-aeroport.ro') {
    return res.redirect(301, `https://delta-air.ro${req.originalUrl}`);
  }
  next();
});

/* ── Rest middleware (după webhook!) ── */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('.'));

/* ──────────────────────────────────────────────
   POST /api/create-payment-intent
────────────────────────────────────────────── */
app.post('/api/create-payment-intent', async (req, res) => {
  try {
    const { amount, currency = 'ron', meta = {} } = req.body;
    if (!amount || amount < 100) {
      return res.status(400).json({ error: 'Suma invalida (minim 1 RON).' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount:   Math.round(amount),
      currency,
      metadata: {
        sursa:          'Delta Air Shuttle Booking Form',
        rezervare_info: JSON.stringify(meta).substring(0, 500),
      },
      automatic_payment_methods: { enabled: true },
    });
    res.json({ clientSecret: paymentIntent.client_secret });
  } catch (err) {
    console.error('Stripe error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   POST /api/create-session
────────────────────────────────────────────── */
app.post('/api/create-session', (req, res) => {
  const { bookingData } = req.body;
  if (!bookingData) return res.status(400).json({ error: 'bookingData lipsă.' });
  const sessionId = crypto.randomBytes(16).toString('hex');
  sessions.set(sessionId, { data: bookingData, createdAt: Date.now() });
  res.json({ sessionId });
});

/* ──────────────────────────────────────────────
   GET /api/get-session/:id
────────────────────────────────────────────── */
app.get('/api/get-session/:id', (req, res) => {
  const session = sessions.get(req.params.id);
  if (!session) return res.status(404).json({ error: 'Sesiune inexistentă sau expirată.' });
  res.json({ bookingData: session.data });
});

/* ──────────────────────────────────────────────
   Template email plată la îmbarcare (client)
────────────────────────────────────────────── */
function buildCashConfirmationEmail(meta) {
  const {
    dirLabel='—', trLabel='—', aptLabel='—',
    date='—', depTime='—', arrTime='—',
    name='—', phone='—', email='—',
    adults=1, children=0, bags=0,
    total='—', pickupLabel, obs,
    firma, cui, paxNames=[],
    voucherCode: voucherCodeC, voucherDiscount: voucherDiscountC,
    returnTrip = null,
  } = meta;
  const fmtD = s => (s && s.length===10) ? s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4) : (s||'—');
  const isFirma = !!(firma && cui);
  const paxList = paxNames.length ? paxNames.map((n,i)=>`<div class="detail-row"><span class="detail-label">Pasager ${i+1}</span><span class="detail-value">${n}</span></div>`).join('') : '';

  return `<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<title>Rezervare confirmată – Delta Air Shuttle</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(26,47,94,.12)}
  .header{background:linear-gradient(135deg,#0f1e3d,#243d75);padding:40px 40px 32px;text-align:center}
  .header h1{color:#fff;font-size:1.4rem;font-weight:700;margin:0}
  .header p{color:rgba(255,255,255,.75);font-size:.9rem;margin:8px 0 0}
  .body{padding:36px 40px}
  .cash-badge{display:flex;align-items:center;gap:12px;background:#fffbeb;border:1.5px solid #f6d860;border-radius:12px;padding:16px 20px;margin-bottom:28px}
  .cash-badge .icon{font-size:1.8rem}
  .cash-badge p{margin:0;font-size:.95rem;color:#92400e;font-weight:600}
  .section-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8892a4;margin:0 0 12px}
  .detail-box{background:#f4f6fb;border-radius:10px;padding:20px 24px;margin-bottom:20px}
  .detail-row{display:table;width:100%;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem;box-sizing:border-box}
  .detail-row:last-child{border-bottom:none}
  .detail-label{display:table-cell;width:45%;color:#8892a4;vertical-align:top;padding-right:8px}
  .detail-value{display:table-cell;font-weight:600;color:#1a202c;vertical-align:top}
  .total-box{background:linear-gradient(135deg,#0f1e3d,#243d75);border-radius:12px;padding:20px 24px;display:flex;justify-content:space-between;align-items:center;margin-bottom:28px}
  .total-label{color:rgba(255,255,255,.75);font-size:.9rem}
  .total-value{color:#e8c96a;font-size:2rem;font-weight:900}
  .step{display:flex;gap:14px;margin-bottom:16px;align-items:flex-start}
  .step-num{width:28px;height:28px;background:#c9a84c;color:#0f1e3d;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;flex-shrink:0;margin-top:2px}
  .step-text h4{font-size:.88rem;font-weight:700;color:#1a2f5e;margin:0 0 3px}
  .step-text p{font-size:.82rem;color:#8892a4;margin:0;line-height:1.6}
  .footer{background:#f4f6fb;padding:24px 40px;text-align:center;border-top:1px solid rgba(26,47,94,.08)}
  .footer p{font-size:.78rem;color:#8892a4;margin:4px 0;line-height:1.6}
  .footer a{color:#1a2f5e;text-decoration:none;font-weight:600}
  @media(max-width:600px){.body,.header,.footer{padding:24px 20px}.detail-row{flex-direction:column;gap:4px}.detail-value{text-align:left}}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>✈ Rezervare confirmată!</h1>
    <p>Locul tău este rezervat. Mulțumim că ai ales Delta Air Shuttle.</p>
  </div>
  <div class="body">
    <div class="cash-badge">
      <div class="icon">💵</div>
      <p>Ai optat pentru plata în numerar la îmbarcare. Pregătește suma de <strong>${total} lei</strong> pentru șofer.${voucherCodeC ? ` (include reducere voucher ${voucherCodeC}: -${voucherDiscountC} lei)` : ''}</p>
    </div>
    <div class="section-title">Detalii cursă</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Tip transfer</span><span class="detail-value">${trLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${fmtD(date)}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${arrTime}</span></div>
      ${pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}${children>0?` + ${children} copil${children>1?'i':''}`:''}</span></div>
      ${bags>0?`<div class="detail-row"><span class="detail-label">Bagaje extra</span><span class="detail-value">${bags} bagaj${bags>1?'e':''}</span></div>`:''}
      ${paxList}
      ${obs?`<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>`:''}
    </div>
    ${returnTrip ? `
    <div class="section-title" style="margin-top:4px">↩ Cursă retur · −20%</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție retur</span><span class="detail-value">${returnTrip.dirLabel||'—'}</span></div>
      <div class="detail-row"><span class="detail-label">Data retur</span><span class="detail-value">${fmtD(returnTrip.date)}</span></div>
      ${returnTrip.depTime ? `<div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${returnTrip.depTime}</span></div>` : ''}
      ${returnTrip.arrTime ? `<div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${returnTrip.arrTime}</span></div>` : ''}
      ${returnTrip.pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${returnTrip.pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Reducere retur</span><span class="detail-value" style="color:#276749;font-weight:700">−20% aplicat</span></div>
    </div>` : ''}
    <div class="section-title">Date de contact</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
      ${isFirma?`<div class="detail-row"><span class="detail-label">Firmă</span><span class="detail-value">${firma} (${cui})</span></div>`:''}
    </div>
    ${voucherCodeC ? `
    <div class="detail-box" style="margin-bottom:12px">
      <div class="detail-row"><span class="detail-label">Preț inițial</span><span class="detail-value">${parseFloat(total) + parseFloat(voucherDiscountC || 0)} lei</span></div>
      <div class="detail-row"><span class="detail-label" style="color:#276749">Voucher ${voucherCodeC}</span><span class="detail-value" style="color:#276749">-${voucherDiscountC} lei</span></div>
    </div>` : ''}
    <div class="total-box">
      <span class="total-label">Total de achitat la îmbarcare${returnTrip ? ' (tur + retur)' : ''}</span>
      <span class="total-value">${total} lei</span>
    </div>
    <div class="section-title">Ce urmează</div>
    <div class="step"><div class="step-num">1</div><div class="step-text"><h4>Fii la punctul de îmbarcare cu 5 min. înainte</h4><p>${pickupLabel||'Punct conform rezervării'}, ora ${depTime}.</p></div></div>
    <div class="step"><div class="step-num">2</div><div class="step-text"><h4>Pregătește suma în numerar</h4><p>Plătești direct șoferului: <strong>${total} lei</strong>. Nu este necesară altă confirmare.</p></div></div>
    <div class="step"><div class="step-num">3</div><div class="step-text"><h4>Călătorești confortabil și prinzi zborul</h4><p>Sosire estimată la ${aptLabel}: ora ${arrTime}.</p></div></div>
  </div>
  <div class="footer">
    <p><strong>Delta Air Shuttle</strong> · Transfer premium Brașov–Otopeni–Băneasa</p>
    <p>📞 <a href="tel:+40761617606">+40 761 617 606</a> &nbsp;·&nbsp; 💬 <a href="https://wa.me/40761617606">WhatsApp</a> &nbsp;·&nbsp; 🌐 <a href="https://delta-air.ro">delta-air.ro</a></p>
    <p style="margin-top:12px;font-size:.72rem;color:#a0aec0">Ai primit acest email deoarece ai efectuat o rezervare pe delta-air.ro.</p>
  </div>
</div></body></html>`;
}

/* ──────────────────────────────────────────────
   Template email notificare internă Delta Air
────────────────────────────────────────────── */
function buildInternalNotificationEmail(meta) {
  const {
    dirLabel='—', trLabel='—', aptLabel='—',
    date='—', depTime='—', arrTime='—',
    name='—', phone='—', email='—',
    adults=1, children=0, bags=0,
    total='—', pickupLabel, obs,
    firma, cui, paxNames=[], payMethod='online',
  } = meta;
  const isCash = payMethod === 'cash';
  const paxList = paxNames.length ? paxNames.map((n,i)=>`<div class="detail-row"><span class="detail-label">Pasager ${i+1}</span><span class="detail-value">${n}</span></div>`).join('') : '';

  return `<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<title>🔔 Rezervare nouă – Delta Air Shuttle</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(26,47,94,.12)}
  .header{background:linear-gradient(135deg,#0f1e3d,#243d75);padding:32px 40px;text-align:center}
  .header h1{color:#fff;font-size:1.3rem;font-weight:700;margin:0}
  .header p{color:rgba(255,255,255,.75);font-size:.88rem;margin:8px 0 0}
  .body{padding:32px 40px}
  .pay-badge{padding:12px 20px;border-radius:10px;margin-bottom:24px;font-weight:700;font-size:.95rem;text-align:center}
  .pay-badge.cash{background:#fffbeb;border:1.5px solid #f6d860;color:#92400e}
  .pay-badge.online{background:#f0fff4;border:1.5px solid #9ae6b4;color:#276749}
  .section-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8892a4;margin:0 0 10px}
  .detail-box{background:#f4f6fb;border-radius:10px;padding:18px 22px;margin-bottom:18px}
  .detail-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.88rem}
  .detail-row:last-child{border-bottom:none}
  .detail-label{color:#8892a4}
  .detail-value{font-weight:600;color:#1a202c;text-align:right}
  .total-box{background:linear-gradient(135deg,#0f1e3d,#243d75);border-radius:12px;padding:18px 22px;display:flex;justify-content:space-between;align-items:center}
  .total-label{color:rgba(255,255,255,.75);font-size:.88rem}
  .total-value{color:#e8c96a;font-size:1.8rem;font-weight:900}
  .footer{background:#f4f6fb;padding:20px 40px;text-align:center;border-top:1px solid rgba(26,47,94,.08);font-size:.76rem;color:#8892a4}
  @media(max-width:600px){.body,.header,.footer{padding:20px}.detail-row{flex-direction:column;gap:4px}.detail-value{text-align:left}}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>🔔 Rezervare nouă primită!</h1>
    <p>${date} · ${dirLabel}</p>
  </div>
  <div class="body">
    <div class="pay-badge ${isCash?'cash':'online'}">${isCash?'💵 Plată la îmbarcare — client achită numerar la șofer':'💳 Plată online — confirmată prin Stripe'}</div>
    <div class="section-title">Detalii cursă</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Tip transfer</span><span class="detail-value">${trLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${date}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${arrTime}</span></div>
      ${pickupLabel?`<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${pickupLabel}</span></div>`:''}
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}${children>0?` + ${children} copil${children>1?'i':''}`:''}</span></div>
      ${bags>0?`<div class="detail-row"><span class="detail-label">Bagaje extra</span><span class="detail-value">${bags}</span></div>`:''}
      ${paxList}
      ${obs?`<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>`:''}
    </div>
    <div class="section-title">Date client</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value"><a href="tel:${phone}">${phone}</a></span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
      ${firma?`<div class="detail-row"><span class="detail-label">Firmă</span><span class="detail-value">${firma} ${cui?'('+cui+')':''}</span></div>`:''}
    </div>
    <div class="total-box">
      <span class="total-label">Total ${isCash?'de încasat la bord':'achitat online'}</span>
      <span class="total-value">${total} lei</span>
    </div>
  </div>
  <div class="footer">Email generat automat de sistemul de rezervări delta-air.ro</div>
</div></body></html>`;
}

/* ──────────────────────────────────────────────
   Email confirmare rezervare manuală admin (client)
────────────────────────────────────────────── */
function buildAdminBookingConfirmationEmail(meta, billingUrl) {
  const {
    dirLabel='—', trLabel='—', aptLabel='—',
    date='—', depTime='—',
    name='—', phone='—', email='—',
    adults=1, total='—', obs,
    paxNames=[],
  } = meta;
  const fmtD = s => (s&&s.length===10) ? s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4) : (s||'—');
  const paxList = paxNames.filter(Boolean).map((n,i)=>`<div class="detail-row"><span class="detail-label">Pasager ${i+1}</span><span class="detail-value">${n}</span></div>`).join('');
  return `<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<title>Rezervare confirmată – Delta Air Shuttle</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(26,47,94,.12)}
  .header{background:linear-gradient(135deg,#0f1e3d,#243d75);padding:40px 40px 32px;text-align:center}
  .header h1{color:#fff;font-size:1.4rem;font-weight:700;margin:0}
  .header p{color:rgba(255,255,255,.75);font-size:.9rem;margin:8px 0 0}
  .body{padding:36px 40px}
  .section-title{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#8892a4;margin:0 0 12px}
  .detail-box{background:#f4f6fb;border-radius:10px;padding:20px 24px;margin-bottom:20px}
  .detail-row{display:table;width:100%;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem;box-sizing:border-box}
  .detail-row:last-child{border-bottom:none}
  .detail-label{display:table-cell;width:45%;color:#8892a4;vertical-align:top;padding-right:8px}
  .detail-value{display:table-cell;font-weight:600;color:#1a202c;vertical-align:top}
  .billing-box{background:#fffbeb;border:1.5px solid #f6d860;border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center}
  .billing-box p{margin:0 0 14px;color:#92400e;font-size:.95rem;font-weight:600}
  .billing-btn{display:inline-block;background:#0f1e3d;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:.95rem}
  .footer{background:#f4f6fb;padding:24px 40px;text-align:center;border-top:1px solid rgba(26,47,94,.08)}
  .footer p{font-size:.78rem;color:#8892a4;margin:4px 0;line-height:1.6}
  .footer a{color:#1a2f5e;text-decoration:none;font-weight:600}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>✈ Rezervare confirmată!</h1>
    <p>Locul tău este rezervat. Mulțumim că ai ales Delta Air Shuttle.</p>
  </div>
  <div class="body">
    <div class="section-title">Detalii cursă</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Tip transfer</span><span class="detail-value">${trLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${fmtD(date)}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}</span></div>
      ${paxList}
      ${obs?`<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>`:''}
    </div>
    ${total && total !== '—' && total !== 0 ? `<div class="detail-box" style="margin-bottom:20px"><div class="detail-row"><span class="detail-label">Total</span><span class="detail-value" style="color:#0f1e3d;font-size:1.1rem">${total} lei</span></div></div>` : ''}
    ${billingUrl ? `<div class="billing-box">
      <p>Pentru a primi contractul și factura, completează datele de facturare:</p>
      <a class="billing-btn" href="${billingUrl}">Completează datele de facturare →</a>
    </div>` : ''}
    <div class="section-title">Date de contact</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
    </div>
  </div>
  <div class="footer">
    <p><strong>Delta Air Shuttle</strong> · Transfer premium Brașov–Otopeni–Băneasa</p>
    <p>📞 <a href="tel:+40761617606">+40 761 617 606</a> &nbsp;·&nbsp; 💬 <a href="https://wa.me/40761617606">WhatsApp</a> &nbsp;·&nbsp; 🌐 <a href="https://delta-air.ro">delta-air.ro</a></p>
  </div>
</div></body></html>`;
}

/* ──────────────────────────────────────────────
   Email reminder 12h înainte îmbarcare (client + admin)
────────────────────────────────────────────── */
function buildReminderEmail(meta, billingUrl) {
  const {
    dirLabel='—', aptLabel='—',
    date='—', depTime='—',
    name='—', phone='—', email='—',
  } = meta;
  const fmtD = s => (s&&s.length===10) ? s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4) : (s||'—');
  return `<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<title>Reminder îmbarcare – Delta Air Shuttle</title>
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:0}
  .wrap{max-width:600px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 32px rgba(26,47,94,.12)}
  .header{background:linear-gradient(135deg,#0f1e3d,#243d75);padding:36px 40px;text-align:center}
  .header h1{color:#fff;font-size:1.3rem;font-weight:700;margin:0}
  .header p{color:rgba(255,255,255,.75);font-size:.9rem;margin:8px 0 0}
  .body{padding:32px 40px}
  .alert-box{background:#fef3c7;border:1.5px solid #f59e0b;border-radius:12px;padding:18px 22px;margin-bottom:24px;font-size:.95rem;color:#92400e;font-weight:600;text-align:center}
  .detail-box{background:#f4f6fb;border-radius:10px;padding:18px 22px;margin-bottom:20px}
  .detail-row{display:table;width:100%;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem;box-sizing:border-box}
  .detail-row:last-child{border-bottom:none}
  .detail-label{display:table-cell;width:45%;color:#8892a4;vertical-align:top}
  .detail-value{display:table-cell;font-weight:600;color:#1a202c;vertical-align:top}
  .billing-box{background:#fffbeb;border:1.5px solid #f6d860;border-radius:12px;padding:20px 24px;margin-bottom:24px;text-align:center}
  .billing-box p{margin:0 0 14px;color:#92400e;font-size:.95rem;font-weight:600}
  .billing-btn{display:inline-block;background:#0f1e3d;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:.95rem}
  .footer{background:#f4f6fb;padding:22px 40px;text-align:center;border-top:1px solid rgba(26,47,94,.08)}
  .footer p{font-size:.78rem;color:#8892a4;margin:4px 0}
  .footer a{color:#1a2f5e;text-decoration:none;font-weight:600}
</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>⏰ Îmbarcare în ~12 ore</h1>
    <p>${fmtD(date)} · ${depTime} · ${dirLabel}</p>
  </div>
  <div class="body">
    <div class="alert-box">Cursa ta pleacă în aproximativ 12 ore. Te rugăm să fii pregătit!</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Pasager</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${fmtD(date)}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
    </div>
    ${billingUrl ? `<div class="billing-box">
      <p>Nu ai completat încă datele de facturare. Completează acum pentru a primi contractul și factura:</p>
      <a class="billing-btn" href="${billingUrl}">Completează datele de facturare →</a>
    </div>` : ''}
  </div>
  <div class="footer">
    <p><strong>Delta Air Shuttle</strong> · Transfer premium Brașov–Otopeni–Băneasa</p>
    <p>📞 <a href="tel:+40761617606">+40 761 617 606</a> &nbsp;·&nbsp; 🌐 <a href="https://delta-air.ro">delta-air.ro</a></p>
  </div>
</div></body></html>`;
}

/* ──────────────────────────────────────────────
   generateContractPDF(meta) → Promise<Buffer>
   Structură conform Model contract transport PF
────────────────────────────────────────────── */
function generateContractPDF(meta) {
  return new Promise((resolve, reject) => {
    const {
      dirLabel='—', trLabel='—', aptLabel='—',
      date='—', depTime='', arrTime='',
      name='—', phone='—', email='—',
      adults=1, children=0, bags=0,
      total='—', pickupLabel='', obs='',
      firma='', cui='', paxNames=[],
      returnTrip = null,
    } = meta;
    const fmtD = s => (s && s.length===10) ? s.slice(8,10)+'-'+s.slice(5,7)+'-'+s.slice(0,4) : (s||'—');

    // Aplică ro() pe toate câmpurile variabile
    const rDirLabel    = ro(dirLabel);
    const rTrLabel     = ro(trLabel);
    const rAptLabel    = ro(aptLabel);
    const rDate        = ro(fmtD(date));
    const rDepTime     = ro(depTime);
    const rArrTime     = ro(arrTime);
    const rName        = ro(name);
    const rPhone       = ro(phone);
    const rEmail       = ro(email);
    const rPickup      = ro(pickupLabel);
    const rObs         = ro(obs);
    const rFirma       = ro(firma);
    const rCui         = ro(cui);
    const rPaxNames    = paxNames.map(ro);

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    if (PDF_FONT_REG)  doc.registerFont('DASReg',  PDF_FONT_REG);
    if (PDF_FONT_BOLD) doc.registerFont('DASBold', PDF_FONT_BOLD);
    const fReg  = PDF_FONT_REG  ? 'DASReg'  : 'Helvetica';
    const fBold = PDF_FONT_BOLD ? 'DASBold' : 'Helvetica-Bold';
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const L = 50, R = W - 50, INNER = R - L;
    const navy = '#1a2f5e', gold = '#c9a84c', gray = '#555555', lgray = '#888888';
    // Foloseste data/ora de pe dispozitivul clientului la momentul confirmarii
    const now = meta.confirmedAt ? new Date(meta.confirmedAt) : new Date();
    const _d = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Bucharest' }));
    const today = `${String(_d.getDate()).padStart(2,'0')}-${String(_d.getMonth()+1).padStart(2,'0')}-${_d.getFullYear()}`;
    const nowTime = now.toLocaleTimeString('ro-RO', { hour:'2-digit', minute:'2-digit', timeZone:'Europe/Bucharest' });
    const nrContract = `DAS-${Date.now().toString(36).toUpperCase()}`;
    const pasageriStr = `${adults} adult${adults>1?'i':''}${children>0?` + ${children} copil${children>1?'i':''}` : ''}`;

    /* ─── helpers ─── */
    const bottomLimit = doc.page.height - 65; // margine de siguranta
    const ensureSpace = (needed) => {
      if (doc.y + needed > bottomLimit) doc.addPage();
    };
    const line = (y, color='#cccccc', w=0.5) => {
      doc.moveTo(L, y||doc.y).lineTo(R, y||doc.y).strokeColor(color).lineWidth(w).stroke();
    };
    const section = (title, needed=80) => {
      ensureSpace(needed);
      doc.moveDown(0.6);
      const rectY = doc.y;
      doc.rect(L, rectY, INNER, 20).fill('#e8ecf5');
      doc.fillColor(navy).fontSize(9).font(fBold)
         .text(title.toUpperCase(), L+6, rectY + 5, { width: INNER });
      doc.moveDown(0.3);
    };
    const twoCol = (left, right, bold=false) => {
      ensureSpace(18);
      const y = doc.y;
      doc.fillColor(lgray).fontSize(8.5).font(fReg).text(left, L, y, { width: 175, lineBreak:false });
      doc.fillColor(bold ? navy : '#222222').fontSize(8.5).font(bold ? fBold : fReg)
         .text(right, L+185, y, { width: INNER-185 });
      doc.moveDown(0.55);
      line(doc.y - 2, '#eeeeee');
    };
    const bullet = (txt) => {
      ensureSpace(16);
      const y = doc.y;
      doc.fillColor(gold).fontSize(8).font(fBold).text('•', L, y, { width:12, lineBreak:false });
      doc.fillColor(gray).fontSize(8).font(fReg).text(txt, L+14, y, { width: INNER-14 });
      doc.moveDown(0.4);
    };

    /* ══════════════════════════════════════════
       HEADER
    ══════════════════════════════════════════ */
    doc.rect(0, 0, W, 80).fill(navy);

    // Logo badge in coltul dreapta-sus (background alb rotunjit)
    const logoSize = 68;
    const logoX = R - logoSize;
    const logoY = 6;
    doc.roundedRect(logoX, logoY, logoSize, logoSize, 6).fill('#ffffff');
    if (LOGO_BUFFER) {
      try {
        doc.image(LOGO_BUFFER, logoX + 2, logoY + 2, { width: logoSize - 4, height: logoSize - 4 });
      } catch(e) { console.warn('Logo insert skipped:', e.message); }
    }

    // Text companie — latime limitata sa nu se suprapuna cu logo
    const hTextW = INNER - logoSize - 10;
    doc.fillColor('#ffffff').fontSize(17).font(fBold)
       .text('DELTA AIR SHUTTLE S.R.L.', L, 18, { width: hTextW });
    doc.fillColor('rgba(255,255,255,0.6)').fontSize(8).font(fReg)
       .text('Brasov, str. 13 Decembrie nr. 129A, bl. 7, apt. 55  |  CUI: 53035921  |  J08/2025/...', L, 40, { width: hTextW });
    doc.fillColor(gold).fontSize(8)
       .text('Tel: +40 761 617 606  |  office@delta-air.ro  |  delta-air.ro', L, 54, { width: hTextW });

    /* titlu */
    doc.moveDown(2.8);
    doc.fillColor(navy).fontSize(15).font(fBold)
       .text('CONTRACT DE PRESTARI SERVICII', { align:'center' });
    doc.fillColor(navy).fontSize(12).font(fBold)
       .text('TRANSPORT RUTIER DE PERSOANE', { align:'center' });
    doc.moveDown(0.3);
    doc.fillColor(lgray).fontSize(8.5).font(fReg)
       .text(`Nr. ${nrContract}   |   Data: ${today}, ora ${nowTime}`, { align:'center' });
    doc.moveDown(0.8);
    line(doc.y, navy, 1.5);

    /* ══════════════════════════════════════════
       PARTI CONTRACTANTE
    ══════════════════════════════════════════ */
    section('Parti contractante');

    // Prestator (stânga) / Beneficiar (dreapta)
    const colW = (INNER - 20) / 2;
    const col2 = L + colW + 20;
    const partiY = doc.y + 4;

    doc.rect(L, partiY, colW, 72).fillAndStroke('#f0f4fb', '#d0d8ea');
    doc.fillColor(navy).fontSize(8.5).font(fBold).text('PRESTATOR', L+8, partiY+6, { width: colW-16 });
    doc.fillColor(gray).fontSize(7.8).font(fReg)
       .text('DELTA AIR SHUTTLE S.R.L.\nBrasov, str. 13 Decembrie nr. 129A\nCUI: 53035921\nReprezentant: Paul Balint\nTel: +40 761 617 606', L+8, partiY+18, { width: colW-16 });

    doc.rect(col2, partiY, colW, 72).fillAndStroke('#fffbeb', '#f6d860');
    doc.fillColor(navy).fontSize(8.5).font(fBold).text('BENEFICIAR', col2+8, partiY+6, { width: colW-16 });
    doc.fillColor(gray).fontSize(7.8).font(fReg)
       .text(`${rName}\nTel: ${rPhone}\nEmail: ${rEmail}${rFirma ? `\nFirma: ${rFirma}\nCUI: ${rCui}` : ''}`, col2+8, partiY+18, { width: colW-16 });

    doc.y = partiY + 82;

    /* ══════════════════════════════════════════
       OBIECTUL CONTRACTULUI
    ══════════════════════════════════════════ */
    section('Obiectul contractului');
    doc.fillColor(gray).fontSize(8.5).font(fReg)
       .text('Serviciu: Transport rutier de persoane pe ruta Brasov <-> Aeroportul International Bucuresti', L, doc.y+2, { width: INNER });
    doc.moveDown(0.5);
    twoCol('Ruta / Directie', rDirLabel, true);
    twoCol('Tip transfer', rTrLabel, false);
    twoCol('Aeroport', rAptLabel, false);
    twoCol('Data calatoriei', rDate, true);
    if (rDepTime) twoCol('Ora plecare', rDepTime, true);
    if (rArrTime) twoCol('Sosire estimata', rArrTime, false);
    if (rPickup) twoCol('Punct imbarcare', rPickup, false);
    twoCol('Numar pasageri', pasageriStr, false);
    twoCol('Vehicul', 'BV 61 DAS (asigurat si inspectat tehnic)', false);
    if (bags > 0) twoCol(`Bagaje extra (${bags})`, '20 RON / bagaj', false);
    if (rPaxNames.length) rPaxNames.forEach((n,i) => twoCol(`Pasager ${i+1}`, n, false));
    if (rObs) twoCol('Observatii', rObs, false);

    /* ══════════════════════════════════════════
       CURSA RETUR (dacă există)
    ══════════════════════════════════════════ */
    if (returnTrip) {
      section('Cursa retur (inclusa · reducere -20%)');
      const rrt = returnTrip;
      twoCol('Ruta retur', ro(rrt.dirLabel||'—'), true);
      twoCol('Data retur', ro(fmtD(rrt.date)), true);
      if (rrt.depTime) twoCol('Ora plecare retur', ro(rrt.depTime), true);
      if (rrt.arrTime) twoCol('Sosire estimata', ro(rrt.arrTime), false);
      if (rrt.pickupLabel) twoCol('Punct imbarcare retur', ro(rrt.pickupLabel), false);
      twoCol('Reducere retur', '-20% aplicat', false);
    }

    /* ══════════════════════════════════════════
       PRET SI PLATA
    ══════════════════════════════════════════ */
    section('Pret si plata');

    /* Rând voucher dacă există */
    if (meta.voucherCode && meta.voucherDiscount) {
      const vDisc = parseFloat(meta.voucherDiscount) || 0;
      const origTotal = parseFloat(total) + vDisc;
      twoCol('Pret initial', `${origTotal} RON`, false);
      twoCol(`Voucher ${meta.voucherCode}`, `-${vDisc} RON`, false);
    }

    // Bloc total — bara navy cu pret centrat vertical
    const barH = 40;
    const barY = doc.y + 4;
    doc.rect(L, barY, INNER, barH).fill(navy);
    // Label "Total de achitat:" centrat vertical stanga (9pt ≈ 11px)
    const labelY = barY + Math.round((barH - 11) / 2);
    doc.fillColor('rgba(255,255,255,0.55)').fontSize(9).font(fReg)
       .text('Total de achitat:', L+12, labelY, {lineBreak:false});
    // Pret centrat vertical dreapta (16pt ≈ 19px)
    const priceY = barY + Math.round((barH - 19) / 2);
    doc.fillColor(gold).fontSize(16).font(fBold)
       .text(`${total} RON`, L, priceY, { width: INNER-12, align:'right' });
    doc.y = barY + barH + 6;
    doc.moveDown(0.4);

    doc.fillColor(gray).fontSize(8.5).font(fReg).text('Modalitate de plata:', L, doc.y, { continued:false });
    doc.moveDown(0.2);
    bullet('Numerar direct soferului, inainte de pornirea cursei (chitanta eliberata)');
    bullet('Virament bancar: Banca Transilvania  RO35 BTRL RONC RT0D B938 0701  (minim 3 zile inainte)');
    bullet('Card online — prin platforma securizata Stripe de pe delta-air.ro');
    doc.moveDown(0.3);
    doc.fillColor(gray).fontSize(8.5).font(fReg).text('Politica de anulare:', L, doc.y);
    doc.moveDown(0.2);
    bullet('Peste 7 zile inainte de plecare: rambursare 100%');
    bullet('Intre 3-7 zile: taxa anulare 20%');
    bullet('Sub 3 zile: taxa anulare 50%');
    bullet('Sub 24 ore: nerambursabil (100%)');

    /* ══════════════════════════════════════════
       OBLIGATII
    ══════════════════════════════════════════ */
    section('Obligatii si conditii', 140);

    const oblY = doc.y + 4;
    doc.rect(L, oblY, colW, 120).fillAndStroke('#f0f4fb', '#d0d8ea');
    doc.fillColor(navy).fontSize(8).font(fBold).text('PRESTATOR se obliga:', L+6, oblY+6, {width:colW-12});
    const oblPrest = [
      'Prezenta la ora exacta stabilita (toleranta max. 15 min.)',
      'Vehicul curat, in perfecta stare tehnica',
      'Conducere sigura, respectare norme circulatie',
      'Raspundere civila asigurata',
      'Notificare beneficiar la orice intemperii',
    ];
    let oblPY = oblY + 20;
    oblPrest.forEach(o => {
      doc.fillColor(gray).fontSize(7.5).font(fReg).text(`• ${o}`, L+6, oblPY, {width:colW-12});
      oblPY += 18;
    });

    doc.rect(col2, oblY, colW, 120).fillAndStroke('#fffbeb', '#f6d860');
    doc.fillColor(navy).fontSize(8).font(fBold).text('BENEFICIAR se obliga:', col2+6, oblY+6, {width:colW-12});
    const oblBenef = [
      'Plata INAINTE de plecare',
      'Prezenta la ora stabilita (dupa 01:15 contractul se considera anulat)',
      'Comportament civilizat; fumatul interzis',
      'Purtare centura obligatorie',
      'Nu deteriora vehiculul; pagubele vor fi despagubite integral',
    ];
    let oblBY = oblY + 20;
    oblBenef.forEach(o => {
      doc.fillColor(gray).fontSize(7.5).font(fReg).text(`• ${o}`, col2+6, oblBY, {width:colW-12});
      oblBY += 18;
    });
    doc.y = oblY + 128;

    /* ══════════════════════════════════════════
       RASPUNDERI
    ══════════════════════════════════════════ */
    section('Raspunderi si sanctiuni', 130);
    const rasp = [
      ['Intarziere prestator (>30 min)', '50 RON taxa'],
      ['Deteriorare vehicul (beneficiar)', 'Reparatii la cheltuiala beneficiarului'],
      ['Comportament agresiv', 'Refuz transport + 200 RON taxa'],
      ['Forta majora (vreme, trafic)', 'Fara penalitate; continuare contract'],
      ['Defectare vehicul (prestator)', 'Inlocuire vehicul sau rambursare 100%'],
    ];
    rasp.forEach(([sit, cons]) => twoCol(sit, cons, false));

    /* ══════════════════════════════════════════
       GDPR
    ══════════════════════════════════════════ */
    section('Protectia datelor (RGPD)');
    doc.fillColor(gray).fontSize(7.8).font(fReg)
       .text('Datele personale sunt prelucrate conform RGPD (Reg. UE 2016/679) exclusiv pentru executarea prezentului contract si obligatii legale. Datele vor fi retinute minim 3 ani pentru conformitate fiscala. Beneficiarul poate exercita drepturile de acces, rectificare si stergere la: office@delta-air.ro', L, doc.y+2, { width: INNER });
    doc.moveDown(0.6);

    /* ══════════════════════════════════════════
       CLAUZE FINALE
    ══════════════════════════════════════════ */
    section('Clauze finale');
    const clauze = [
      'Lege aplicabila: Legea romana',
      'Solutionare litigii: Instantele din Brasov',
      'Comunicari: Email (office@delta-air.ro) sau scrisoare recomandata',
      'Modificari: Numai in scris cu acordul ambelor parti',
      'Bunuri personale: Beneficiarul este responsabil; prestatorul nu raspunde pentru pierderi',
      'Contract incheiat in 2 exemplare (prestator si beneficiar)',
    ];
    clauze.forEach(c => bullet(c));

    /* ══════════════════════════════════════════
       SEMNATURI
    ══════════════════════════════════════════ */
    ensureSpace(220);
    doc.moveDown(0.8);
    line(doc.y, navy, 1);
    doc.moveDown(0.5);

    const sigY = doc.y;
    // Prestator
    doc.fillColor(navy).fontSize(9).font(fBold).text('PRESTATOR', L, sigY);
    doc.fillColor(gray).fontSize(8).font(fReg)
       .text('DELTA AIR SHUTTLE S.R.L.\nReprezentant: Paul Balint', L, sigY+14, {width: colW});
    doc.moveTo(L, sigY+62).lineTo(L+160, sigY+62).strokeColor(navy).lineWidth(0.5).stroke();
    doc.fillColor(lgray).fontSize(7).font(fReg).text('Semnatura si stampila', L, sigY+65);

    // Beneficiar
    doc.fillColor(navy).fontSize(9).font(fBold).text('BENEFICIAR', col2, sigY);
    doc.fillColor(gray).fontSize(8).font(fReg)
       .text(`${rName}\nData: ${today}, ora ${nowTime}`, col2, sigY+14, {width: colW});

    // Inserează semnătura electronică dacă există
    if (meta.signatureDataUrl && meta.signatureDataUrl.startsWith('data:image/png;base64,')) {
      try {
        const sigBuffer = Buffer.from(meta.signatureDataUrl.replace('data:image/png;base64,', ''), 'base64');
        doc.image(sigBuffer, col2, sigY+32, { width: 160, height: 30, fit: [160, 30] });
      } catch (_) {}
    }

    doc.moveTo(col2, sigY+62).lineTo(col2+160, sigY+62).strokeColor(navy).lineWidth(0.5).stroke();
    const sigLabel = meta.signedAt
      ? `Semnat electronic: ${new Date(meta.signedAt).toLocaleString('ro-RO', {timeZone:'Europe/Bucharest'})}`
      : 'Semnatura beneficiar';
    doc.fillColor(lgray).fontSize(7).font(fReg).text(sigLabel, col2, sigY+65, {width: colW});

    /* ══════════════════════════════════════════
       INFORMATII CONTACT URGENTA
    ══════════════════════════════════════════ */
    doc.y = sigY + 85;
    doc.rect(L, doc.y, INNER, 28).fill('#f0f4fb');
    const ctY = doc.y + 8;
    doc.fillColor(navy).fontSize(8).font(fBold)
       .text('Contact urgenta Delta Air: Paul Balint  +40 761 617 606', L+8, ctY, {lineBreak:false});
    doc.fillColor(lgray).fontSize(8).font(fReg)
       .text(`   |   Ruta: ${rDirLabel}   |   Plecare: ${rDepTime||rDate}`, {lineBreak:false});
    doc.y = ctY + 34;

    /* footer — imediat sub bara de contact, fara pagina noua */
    doc.fillColor(lgray).fontSize(7).font(fReg)
       .text(`Document generat automat · delta-air.ro · ${nrContract}`, L, doc.y, { align:'center', width: INNER });

    doc.end();
  });
}

/* ──────────────────────────────────────────────
   generateInvoicePDF(meta, invoiceNum) → Promise<Buffer>
────────────────────────────────────────────── */
let INVOICE_LOGO_BUFFER = null;
try {
  INVOICE_LOGO_BUFFER = fs.readFileSync(path.join(__dirname, 'invoice-logo.png'));
  console.log('✅ Logo factură încărcat:', INVOICE_LOGO_BUFFER.length, 'bytes');
} catch (e) { console.warn('⚠️ Logo factură indisponibil:', e.message); }

async function nextInvoiceNumber() {
  if (!db) throw new Error('DB indisponibil');
  const year = new Date().getFullYear();
  const r = await db.query(
    'INSERT INTO invoices (year) VALUES ($1) RETURNING id', [year]
  );
  return { year, num: r.rows[0].id };
}

async function saveInvoiceMeta(invoiceId, token, clientName) {
  if (!db) return;
  await db.query(
    'UPDATE invoices SET booking_token=$1, client_name=$2 WHERE id=$3',
    [token, clientName, invoiceId]
  );
}

async function buildInvoiceAttachment(meta, token) {
  try {
    const { year, num } = await nextInvoiceNumber();
    await saveInvoiceMeta(num, token || null, meta.firma || meta.name || '-');
    const invoiceNo = `DAS-${year}-${String(num).padStart(4, '0')}`;
    const pdfBuffer = await generateInvoicePDF(meta, num, year);
    return {
      filename: `factura-${invoiceNo}-delta-air.pdf`,
      content:  pdfBuffer,
      contentType: 'application/pdf',
    };
  } catch (e) {
    console.warn('⚠️ Factura nu s-a putut genera:', e.message);
    return null;
  }
}

function generateInvoicePDF(meta, invoiceNum, invoiceYear) {
  return new Promise((resolve, reject) => {
    try {
      const TVA = 0.21;
      const totalCuTVA    = parseFloat(meta.total) || 0;
      const voucherDisc   = parseFloat(meta.voucherDiscount) || 0;
      const pretInitial   = voucherDisc > 0 ? +(totalCuTVA + voucherDisc).toFixed(2) : 0;
      const totalFaraTVA  = +(totalCuTVA / (1 + TVA)).toFixed(2);
      const tvaAmount     = +(totalCuTVA - totalFaraTVA).toFixed(2);

      const invoiceNo = `DAS-${invoiceYear}-${String(invoiceNum).padStart(4, '0')}`;
      const today = new Date().toLocaleDateString('ro-RO', { timeZone: 'Europe/Bucharest' });
      const isFirma = !!(meta.firma && meta.cui);
      const clientName = isFirma ? meta.firma : (meta.name || '-');

      const doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true });
      if (PDF_FONT_REG)  doc.registerFont('DASReg',  PDF_FONT_REG);
      if (PDF_FONT_BOLD) doc.registerFont('DASBold', PDF_FONT_BOLD);
      const chunks = [];
      doc.on('data', c => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const W = 595.28, H = 841.89;
      const M = 50;
      const navy = '#0f1e3d', gold = '#c9a84c', gray = '#4a5568', lgray = '#718096', light = '#f7f9fc';
      const fBold = PDF_FONT_BOLD ? 'DASBold' : 'Helvetica-Bold';
      const fReg  = PDF_FONT_REG  ? 'DASReg'  : 'Helvetica';

      // ── Fundal alb ──
      doc.rect(0, 0, W, H).fill('#ffffff');

      // ── Watermark logo — 60% pagina, centrat, opacitate 0.0875 (25% mai vizibil) ──
      if (INVOICE_LOGO_BUFFER) {
        const logoW = W * 0.60;
        const logoH = logoW * (2500 / 3000);
        const logoX = (W - logoW) / 2;
        const logoY = (H - logoH) / 2;
        const gsRef = doc.ref({ Type: 'ExtGState', ca: 0.0875, CA: 0.0875 });
        gsRef.end();
        if (!doc.page.resources.data.ExtGState) doc.page.resources.data.ExtGState = {};
        doc.page.resources.data.ExtGState.GSWatermark = gsRef;
        doc.save();
        doc.addContent('/GSWatermark gs');
        doc.image(INVOICE_LOGO_BUFFER, logoX, logoY, { width: logoW, height: logoH });
        doc.restore();
      }

      // ── Header ──
      const headerH = 95;
      doc.rect(0, 0, W, headerH).fill(navy);

      // Titlu stanga
      doc.fillColor('#ffffff').fontSize(24).font(fBold)
         .text('FACTURA FISCALA', M, 18);
      doc.fillColor(gold).fontSize(10.5).font(fBold)
         .text(`Seria DAS - Nr. ${invoiceNo}`, M, 48);
      doc.fillColor('rgba(255,255,255,0.65)').fontSize(8.5).font(fReg)
         .text(`Data emiterii: ${today}`, M, 64);
      doc.fillColor('rgba(255,255,255,0.45)').fontSize(7.5).font(fReg)
         .text(`Scadenta: ${today} (factura de servicii prestate)`, M, 78);

      // Nr factură dreapta — dimensiune controlată, fără overlap
      doc.fillColor('rgba(255,255,255,0.18)').fontSize(28).font(fBold)
         .text(invoiceNo, 0, 34, { align: 'right', width: W - M });

      let y = headerH + 14;

      // ── Furnizor / Cumparator ──
      const col1 = M, col2 = W / 2 + 8, colW = W / 2 - M - 8;

      const sectionLabel = (txt, x, yy) => {
        doc.rect(x, yy, colW, 14).fill('#e8edf5');
        doc.fillColor(navy).fontSize(7.5).font(fBold).text(txt, x + 6, yy + 3, { width: colW });
        return yy + 18;
      };

      // FURNIZOR
      let yF = sectionLabel('FURNIZOR', col1, y);
      doc.fillColor(gray).fontSize(9).font(fBold)
         .text('DELTA AIR SHUTTLE S.R.L.', col1, yF, { width: colW }); yF += 13;
      doc.fillColor(gray).fontSize(8).font(fReg);
      doc.text('CUI: RO53035921', col1, yF, { width: colW }); yF += 11;
      doc.text('Reg. Com.: J08/000/2024', col1, yF, { width: colW }); yF += 11;
      doc.text('Sediu: Brasov, Romania', col1, yF, { width: colW }); yF += 11;
      doc.text('IBAN: RO35 BTRL RONC RT0D B938 0701', col1, yF, { width: colW }); yF += 11;
      doc.text('Banca: Banca Transilvania', col1, yF, { width: colW }); yF += 11;
      doc.text('Tel: +40 761 617 606', col1, yF, { width: colW }); yF += 11;
      doc.text('Email: office@delta-air.ro', col1, yF, { width: colW });

      // CUMPARATOR
      let yC = sectionLabel('CUMPARATOR', col2, y);
      doc.fillColor(gray).fontSize(9).font(fBold)
         .text(ro(clientName), col2, yC, { width: colW }); yC += 13;
      doc.fillColor(gray).fontSize(8).font(fReg);
      if (isFirma) {
        doc.text(`CUI: ${meta.cui || '-'}`, col2, yC, { width: colW }); yC += 11;
        if (meta.adresa) { doc.text(ro(meta.adresa), col2, yC, { width: colW }); yC += 11; }
      } else {
        doc.text('Persoana fizica', col2, yC, { width: colW }); yC += 11;
      }
      if (meta.name && isFirma) { doc.text(`Contact: ${ro(meta.name)}`, col2, yC, { width: colW }); yC += 11; }
      if (meta.phone) { doc.text(`Tel: ${meta.phone}`, col2, yC, { width: colW }); yC += 11; }
      if (meta.email) { doc.text(`Email: ${meta.email}`, col2, yC, { width: colW }); yC += 11; }
      const payMethodLabel = { cash: 'Numerar la imbarcare', card: 'Card online (Stripe)', netopia: 'Card online (Netopia)' }[meta.payMethod] || (meta.payMethod || '-');
      doc.text(`Mod plata: ${payMethodLabel}`, col2, yC, { width: colW });

      // Separator
      y = Math.max(yF, yC) + 18;
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor(navy).lineWidth(1).stroke();
      y += 14;

      // ── Tabel servicii ──
      const tH = 26;
      doc.rect(M, y, W - 2 * M, tH).fill(navy);
      const cols = [
        { label: 'Descriere serviciu',  x: M + 6,   w: 198 },
        { label: 'Data cursa',          x: M + 208, w: 62  },
        { label: 'U.M.',                x: M + 274, w: 28  },
        { label: 'Cant.',               x: M + 306, w: 26  },
        { label: 'Pret fara TVA',       x: M + 336, w: 64  },
        { label: 'TVA 21%',             x: M + 404, w: 54  },
        { label: 'Total RON',           x: M + 462, w: 73  },
      ];
      cols.forEach(c =>
        doc.fillColor('#ffffff').fontSize(7.5).font(fBold)
           .text(c.label, c.x, y + 9, { width: c.w })
      );
      y += tH;

      const serviceDesc = `Transfer aeroport ${ro(meta.dirLabel || '-')} - ${ro(meta.trLabel || '-')}`;
      const rowH = serviceDesc.length > 55 ? 32 : 22;
      doc.rect(M, y, W - 2 * M, rowH).fill(light);
      doc.fillColor(gray).fontSize(8).font(fReg);
      doc.text(ro(serviceDesc),                     M + 6,   y + (rowH - 16) / 2, { width: 198 });
      doc.text(meta.date || '-',                    M + 208, y + (rowH - 8) / 2,  { width: 62  });
      doc.text('buc',                               M + 274, y + (rowH - 8) / 2,  { width: 28  });
      doc.text('1',                                 M + 306, y + (rowH - 8) / 2,  { width: 26  });
      doc.text(`${totalFaraTVA.toFixed(2)} RON`,   M + 336, y + (rowH - 8) / 2,  { width: 64  });
      doc.text(`${tvaAmount.toFixed(2)} RON`,       M + 404, y + (rowH - 8) / 2,  { width: 54  });
      doc.fillColor(navy).font(fBold)
         .text(`${totalCuTVA.toFixed(2)} RON`,      M + 462, y + (rowH - 8) / 2,  { width: 73  });
      y += rowH;

      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d0d7e8').lineWidth(0.5).stroke();
      y += 14;

      // ── Sumar TVA ──
      const sumX = W - M - 210;
      const row = (lbl, val, bold = false) => {
        doc.fillColor(bold ? navy : gray).fontSize(bold ? 10 : 8.5)
           .font(bold ? fBold : fReg)
           .text(lbl, sumX, y, { width: 130 })
           .text(val,  sumX + 130, y, { width: 80, align: 'right' });
        y += bold ? 17 : 13;
      };
      if (voucherDisc > 0) {
        row('Pret initial:', `${pretInitial.toFixed(2)} RON`);
        row(`Voucher ${meta.voucherCode}:`, `-${voucherDisc.toFixed(2)} RON`);
      }
      row('Total fara TVA:', `${totalFaraTVA.toFixed(2)} RON`);
      row('TVA 21%:', `${tvaAmount.toFixed(2)} RON`);
      doc.moveTo(sumX, y).lineTo(W - M, y).strokeColor(navy).lineWidth(0.7).stroke();
      y += 5;
      row('TOTAL DE PLATA:', `${totalCuTVA.toFixed(2)} RON`, true);
      y += 12;

      // ── Detalii cursa — doua coloane ──
      doc.moveTo(M, y).lineTo(W - M, y).strokeColor('#d0d7e8').lineWidth(0.5).stroke();
      y += 10;
      doc.rect(M, y, W - 2 * M, 14).fill('#e8edf5');
      doc.fillColor(navy).fontSize(7.5).font(fBold)
         .text('DETALII CURSA', M + 6, y + 3); y += 18;

      const d1x = M, d2x = W / 2 + 8, dLW = 110, dVW = colW - dLW - 4;
      let yd1 = y, yd2 = y;

      const det = (col, k, v) => {
        const x = col === 1 ? d1x : d2x;
        let yd = col === 1 ? yd1 : yd2;
        doc.fillColor(lgray).fontSize(7.8).font(fBold).text(`${k}:`, x, yd, { width: dLW });
        doc.fillColor(gray).fontSize(7.8).font(fReg).text(ro(String(v || '-')), x + dLW + 4, yd, { width: dVW });
        if (col === 1) yd1 += 12; else yd2 += 12;
      };

      // Coloana stanga
      det(1, 'Ruta',                ro(meta.dirLabel));
      det(1, 'Tip transfer',        ro(meta.trLabel));
      det(1, 'Aeroport',            ro(meta.aptLabel));
      det(1, 'Data calatoriei',     meta.date);
      det(1, 'Ora plecare',         meta.depTime);
      if (meta.arrTime) det(1, 'Ora sosire est.', meta.arrTime);
      det(1, 'Punct imbarcare',     ro(meta.pickup));

      // Coloana dreapta
      det(2, 'Pasageri adulti',     String(meta.adults || 1));
      if (parseInt(meta.children) > 0) det(2, 'Copii (sub 12 ani)', String(meta.children));
      const totalPax = parseInt(meta.adults || 1) + parseInt(meta.children || 0);
      det(2, 'Total pasageri',      String(totalPax));
      if (parseInt(meta.bags) > 0) det(2, 'Bagaje supli.', String(meta.bags));
      det(2, 'Mod plata',           payMethodLabel);
      if (meta.confirmedAt) {
        const confDate = new Date(meta.confirmedAt).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
        det(2, 'Data confirmare', confDate);
      }
      if (meta.signedAt) {
        const sigDate = new Date(meta.signedAt).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' });
        det(2, 'Semnat electronic', sigDate);
      }

      y = Math.max(yd1, yd2) + 8;

      // Nume pasageri
      if (Array.isArray(meta.paxNames) && meta.paxNames.length > 0) {
        doc.fillColor(lgray).fontSize(7.8).font(fBold).text('Nume pasageri:', M, y, { width: dLW });
        doc.fillColor(gray).fontSize(7.8).font(fReg)
           .text(meta.paxNames.map(p => ro(p)).join(', '), M + dLW + 4, y, { width: W - 2 * M - dLW - 4 });
        y += 14;
      }

      // Observatii
      if (meta.obs && meta.obs.trim()) {
        doc.fillColor(lgray).fontSize(7.8).font(fBold).text('Observatii:', M, y, { width: dLW });
        doc.fillColor(gray).fontSize(7.8).font(fReg)
           .text(ro(meta.obs.trim()), M + dLW + 4, y, { width: W - 2 * M - dLW - 4 });
        y += 14;
      }

      y += 8;
      // Nota legala
      doc.rect(M, y, W - 2 * M, 22).fill('#fff8e8');
      doc.fillColor('#7a5c00').fontSize(7.5).font(fReg)
         .text('Factura emisa electronic, valabila fara semnatura si stampila conform art. 319 alin. (29) Cod Fiscal (L. 227/2015). TVA colectat conform regimului normal de taxare.', M + 8, y + 6, { width: W - 2 * M - 16 });

      // ── Footer ──
      const footY = H - 52;
      doc.rect(0, footY, W, 52).fill(navy);
      doc.fillColor(gold).fontSize(8).font(fBold)
         .text('DELTA AIR SHUTTLE S.R.L.  -  CUI RO53035921  -  office@delta-air.ro  -  +40 761 617 606', M, footY + 10, { width: W - 2 * M, align: 'center' });
      doc.fillColor('rgba(255,255,255,0.5)').fontSize(7.5).font(fReg)
         .text('Brasov, Romania  |  www.delta-air.ro', M, footY + 26, { width: W - 2 * M, align: 'center' });
      doc.fillColor('rgba(255,255,255,0.3)').fontSize(6.5).font(fReg)
         .text(`Factura nr. ${invoiceNo} - emisa pe data de ${today}`, M, footY + 40, { width: W - 2 * M, align: 'center' });

      doc.end();
    } catch (e) { reject(e); }
  });
}

/* ──────────────────────────────────────────────
   GET /api/invoice?token=X
   Generează și descarcă factura fiscală PDF
────────────────────────────────────────────── */
app.get('/api/invoice', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token lipsă.' });

  try {
    const meta = contractStore.get(token)?.meta || await getPendingPayment(token);
    if (!meta) return res.status(404).json({ error: 'Rezervarea nu a fost găsită sau a expirat.' });

    const { year, num } = await nextInvoiceNumber();
    await saveInvoiceMeta(num, token, meta.firma || meta.name || '—');

    const pdfBuffer = await generateInvoicePDF(meta, num, year);
    const invoiceNo = `DAS-${year}-${String(num).padStart(4, '0')}`;
    const fileName = `factura-${invoiceNo}-delta-air.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('❌ invoice error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   POST /api/reserve-cash
   Rezervare fără plată online — trimite email
   clientului și intern la Delta Air
────────────────────────────────────────────── */
app.post('/api/reserve-cash', async (req, res) => {
  try {
    const { meta = {}, customerEmail } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email lipsă.' });

    // Înregistrează în baza de date
    try {
      await recordBooking(meta);
    } catch (dbErr) {
      console.error('❌ recordBooking (cash):', dbErr.message, '| meta:', JSON.stringify({ dir: meta.dir, trip: meta.trip, date: meta.date, name: meta.name }));
      return res.status(500).json({ error: 'Rezervarea nu a putut fi salvată în baza de date: ' + dbErr.message });
    }

    // Generează PDF contract
    const pdfBuffer = await generateContractPDF(meta);
    const fileName = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;

    // Salvează în store cu token unic (TTL 2 ore)
    const token = crypto.randomBytes(16).toString('hex');
    contractStore.set(token, { buffer: pdfBuffer, fileName, meta, createdAt: Date.now() });
    try { await savePendingPayment(token, meta); } catch (_) {}

    const hasEmail = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    if (hasEmail) {
      const from       = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
      const internalTo = OFFICE_EMAIL;
      const attachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };

      // Email → client (+ BCC office ca copie garantată)
      const invoiceAtt = await buildInvoiceAttachment(meta, token);
      try {
        await transporter.sendMail({
          from,
          to:  customerEmail,
          bcc: internalTo,
          subject: `✈ Rezervare confirmată – ${meta.date || ''} ${meta.dirLabel || ''} (plată la îmbarcare)`,
          html: buildCashConfirmationEmail(meta),
          attachments: [attachment, invoiceAtt].filter(Boolean),
        });
        console.log(`📧 Email client (cash) → ${customerEmail} | BCC → ${internalTo}`);
      } catch (e) { console.error('❌ Email client (cash):', e.message); }

      // Notificarea internă la plata la îmbarcare vine prin BCC-ul de mai sus (evită duplicat)
    } else {
      console.warn('⚠️  EMAIL_USER / EMAIL_PASS lipsă — emailuri netrimise.');
    }

    res.json({ ok: true, token });
  } catch (err) {
    console.error('❌ Eroare reserve-cash:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   POST /api/netopia-initiate
   Inițiază o plată Netopia — returnează paymentURL
────────────────────────────────────────────── */
app.post('/api/netopia-initiate', async (req, res) => {
  try {
    const { meta = {}, customerEmail } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email lipsă.' });
    if (!meta.total || parseFloat(meta.total) <= 0) return res.status(400).json({ error: 'Sumă invalidă.' });

    const token = crypto.randomBytes(16).toString('hex');
    const orderID = `DAS-${Date.now()}`;
    if (!meta.confirmedAt) meta.confirmedAt = new Date().toISOString();
    meta.payMethod = 'netopia';
    meta._netopiaOrderID = orderID;
    contractStore.set(`netopia-${token}`, { meta, createdAt: Date.now() });
    contractStore.set(`netopia-order-${orderID}`, { meta, createdAt: Date.now() });
    try { await savePendingPayment(token, meta); } catch (dbErr) { console.warn('⚠️ savePendingPayment token:', dbErr.message); }
    try { await savePendingPayment(orderID, meta); } catch (dbErr) { console.warn('⚠️ savePendingPayment orderID:', dbErr.message); }

    const isSandbox = process.env.NETOPIA_SANDBOX !== 'false';
    const netopia = new Netopia({
      apiKey:       process.env.NETOPIA_API_KEY,
      posSignature: process.env.NETOPIA_SIGNATURE,
      notifyUrl:    `https://delta-air-server-production.up.railway.app/api/netopia-notify?token=${token}`,
      redirectUrl:  `https://www.delta-air.ro/rezervare-confirmata?netopia=pending&token=${token}&email=${encodeURIComponent(customerEmail)}`,
      sandbox:      isSandbox,
    });

    const nameParts = (meta.name || 'Client Delta').trim().split(/\s+/);
    netopia.setOrderData({
      orderID,
      amount:      parseFloat(meta.total),
      currency:    'RON',
      dateTime:    meta.confirmedAt,
      description: `Transfer Delta Air Shuttle ${meta.dirLabel || ''} ${meta.date || ''}`,
      billing: {
        email:       customerEmail,
        phone:       meta.phone || '0000000000',
        firstName:   nameParts[0] || 'Client',
        lastName:    nameParts.slice(1).join(' ') || 'Delta',
        city:        'Brasov',
        country:     642,
        countryName: 'Romania',
        state:       'Brasov',
        postalCode:  '500000',
        details:     '',
      },
    });

    const response = await netopia.startPayment();
    const paymentURL = response?.payment?.paymentURL || response?.paymentURL || response?.payment?.redirectURL;
    if (!paymentURL) {
      console.error('Netopia response fara URL:', JSON.stringify(response));
      return res.status(500).json({ error: 'Nu s-a obținut URL-ul de plată Netopia.' });
    }
    console.log(`💳 Netopia payment inițiat: ${paymentURL.substring(0, 60)}...`);
    res.json({ url: paymentURL });
  } catch (err) {
    console.error('❌ Netopia initiate error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   GET /api/download-contract?token=xxx
────────────────────────────────────────────── */
app.get('/api/download-contract', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token lipsă.' });

  let entry = contractStore.get(token);

  // Dacă nu e în memorie (ex: după redeploy), regenerează din DB
  if (!entry) {
    const meta = await getPendingPayment(token).catch(() => null);
    if (!meta) return res.status(404).json({ error: 'Contractul nu mai este disponibil sau a expirat.' });
    try {
      const buffer = await generateContractPDF(meta);
      const fileName = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;
      entry = { buffer, fileName };
    } catch (e) {
      return res.status(500).json({ error: 'Eroare la generarea contractului.' });
    }
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${entry.fileName}"`);
  res.send(entry.buffer);
});

/* ──────────────────────────────────────────────
   GET /api/email-status — diagnostic SMTP
────────────────────────────────────────────── */
app.get('/api/email-status', async (req, res) => {
  const cfg = {
    host: process.env.EMAIL_HOST || '(lipsă)',
    port: process.env.EMAIL_PORT || '(lipsă)',
    user: process.env.EMAIL_USER ? process.env.EMAIL_USER.slice(0,6) + '***' : '(lipsă)',
    pass: process.env.EMAIL_PASS ? '***setat***' : '(lipsă)',
    from: process.env.EMAIL_FROM || '(lipsă)',
    internal: OFFICE_EMAIL,
  };
  try {
    await transporter.verify();
    res.json({ ok: true, smtp: 'conectat', config: cfg });
  } catch (err) {
    res.json({ ok: false, smtp: err.message, config: cfg });
  }
});

/* ──────────────────────────────────────────────
   GET /api/test-internal-email
   Trimite un email de test direct la OFFICE_EMAIL.
   Apelează din browser: /api/test-internal-email
────────────────────────────────────────────── */
app.get('/api/test-internal-email', async (req, res) => {
  const from      = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
  const internalTo = OFFICE_EMAIL;
  const ts = new Date().toISOString();
  const result    = { from, to: internalTo, ts, steps: [] };

  // Pas 1: Verifică conexiunea SMTP
  try {
    await transporter.verify();
    result.steps.push({ step: 'smtp_verify', ok: true });
  } catch (err) {
    result.steps.push({ step: 'smtp_verify', ok: false, error: err.message });
    return res.status(500).json({ ok: false, result });
  }

  // Pas 2: Trimite email test direct (fara BCC, fara atasament)
  try {
    const info = await transporter.sendMail({
      from,
      to: internalTo,
      subject: `[TEST] Delta Air – email intern ${ts}`,
      text: `Acesta este un email de test trimis la ${ts}.\nDaca primesti acest mesaj, livrarea la ${internalTo} functioneaza corect.`,
      html: `<p><strong>TEST email intern Delta Air</strong></p><p>Timestamp: <code>${ts}</code></p><p>Daca ai primit acest mesaj, livrarea la <strong>${internalTo}</strong> functioneaza corect.</p>`,
    });
    result.steps.push({ step: 'send_direct', ok: true, messageId: info.messageId, response: info.response });
  } catch (err) {
    result.steps.push({ step: 'send_direct', ok: false, error: err.message, code: err.code, responseCode: err.responseCode });
    return res.status(500).json({ ok: false, result });
  }

  // Pas 3: Trimite al doilea email cu BCC la acelasi destinatar (simulare BCC reala)
  try {
    const info2 = await transporter.sendMail({
      from,
      to: `"Test BCC target" <test-dummy-${Date.now()}@delta-air.ro>`,
      bcc: internalTo,
      subject: `[TEST BCC] Delta Air – email intern ${ts}`,
      text: `Test BCC catre ${internalTo}. Daca primesti asta, BCC functioneaza.`,
    });
    result.steps.push({ step: 'send_bcc', ok: true, messageId: info2.messageId });
  } catch (err) {
    result.steps.push({ step: 'send_bcc', ok: false, error: err.message });
  }

  res.json({ ok: true, result });
});

/* ──────────────────────────────────────────────
   POST /api/create-checkout-session
────────────────────────────────────────────── */
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { lineItems = [], meta = {}, customerEmail, voucherCode } = req.body;
    if (!lineItems.length) {
      return res.status(400).json({ error: 'Nu există produse în coș.' });
    }

    /* Validare și aplicare voucher */
    let discounts = [];
    if (voucherCode) {
      const vc = VOUCHERS[(voucherCode || '').toUpperCase()];
      if (vc) {
        if (vc.stripeCouponId) discounts = [{ coupon: vc.stripeCouponId }];
        if (!meta.voucherCode) { meta.voucherCode = voucherCode.toUpperCase(); meta.voucherDiscount = vc.discount; }
      }
    }

    // Setează timestamp confirmare dacă nu vine de la client
    if (!meta.confirmedAt) meta.confirmedAt = new Date().toISOString();
    meta.payMethod = 'card';

    // Generează PDF și stochează cu token — înainte de a crea sesiunea Stripe
    let token = '';
    let fileName = '';
    try {
      const pdfBuffer = await generateContractPDF(meta);
      fileName = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;
      token = crypto.randomBytes(16).toString('hex');
      // Stochează PDF + meta complet (pentru email în webhook, fără limitele Stripe metadata)
      contractStore.set(token, { buffer: pdfBuffer, fileName, meta, createdAt: Date.now() });
      try { await savePendingPayment(token, meta); } catch (_) {}
      console.log(`📄 PDF card generat, token: ${token.slice(0,8)}...`);
    } catch (pdfErr) {
      console.warn('⚠️ PDF pre-checkout failed (continua fara):', pdfErr.message);
    }

    // success_url include email + token pentru pagina de confirmare
    const successBase = process.env.STRIPE_SUCCESS_URL || 'https://www.delta-air.ro/rezervare-confirmata';
    const successUrl  = `${successBase}?email=${encodeURIComponent(customerEmail || '')}${token ? `&token=${token}` : ''}`;

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      currency: 'ron',
      line_items: lineItems.map(item => ({
        price_data: {
          currency: 'ron',
          unit_amount: Math.round(item.amount),
          product_data: {
            name:        item.name,
            description: item.description || undefined,
          },
        },
        quantity: item.quantity,
      })),
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      ...(discounts.length ? { discounts } : {}),
      metadata: {
        sursa:          'Delta Air Shuttle Booking Form',
        rezervare_info: JSON.stringify(meta).substring(0, 490),
        contract_token: token,
        confirmed_at:   meta.confirmedAt,
      },
      success_url: successUrl,
      cancel_url:  process.env.STRIPE_CANCEL_URL || 'https://www.delta-air.ro/rezervari',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   GET /api/netopia-confirm?token=X
   Apelat de pagina de confirmare după redirect Netopia.
   Trimite email + înregistrează rezervarea (fallback față de IPN).
────────────────────────────────────────────── */
app.get('/api/netopia-confirm', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Token lipsă.' });

  try {
    let meta = contractStore.get(`netopia-${token}`)?.meta || await getPendingPayment(token);
    if (!meta) return res.status(404).json({ error: 'Rezervare negăsită sau expirată.' });

    const customerEmail = meta.email;
    if (!customerEmail) return res.status(400).json({ error: 'Email lipsă în rezervare.' });

    try { await recordBooking(meta); } catch (dbErr) { console.error('❌ recordBooking (netopia-confirm):', dbErr.message); }

    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      let attachment = null;
      try {
        const pdfBuffer = await generateContractPDF(meta);
        const fileName  = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;
        attachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };
      } catch (pdfErr) { console.warn('⚠️ PDF netopia-confirm failed:', pdfErr.message); }

      const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
      const invoiceAtt = await buildInvoiceAttachment(meta, token);
      try {
        await transporter.sendMail({
          from,
          to:  customerEmail,
          bcc: OFFICE_EMAIL,
          subject: `✈ Confirmare rezervare Delta Air Shuttle — ${meta.date || ''} ${meta.dirLabel || ''}`,
          html: buildConfirmationEmail({ ...meta, payMethod: 'card' }),
          attachments: [attachment, invoiceAtt].filter(Boolean),
        });
        console.log(`📧 Email netopia-confirm → ${customerEmail}`);
      } catch (mailErr) { console.error('❌ Email netopia-confirm:', mailErr.message); }
    }

    contractStore.delete(`netopia-${token}`);
    // Nu ștergem pending_payments — documentele rămân disponibile pentru descărcare (2 ore)

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ netopia-confirm error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ══════════════════════════════════════════════════════════════
   ADMIN API — Vehicule / Flotă
══════════════════════════════════════════════════════════════ */

/* GET /api/admin/vehicles */
app.get('/api/admin/vehicles', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    const { rows } = await db.query(`SELECT * FROM vehicles ORDER BY id`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/admin/vehicles */
app.post('/api/admin/vehicles', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { plate, make, model, year, capacity, tur_c1, tur_c2, retur_c1, retur_c2,
          status, km, itp_date, insurance_date, service_date, service_km, driver_name, notes } = req.body || {};
  if (!plate) return res.status(400).json({ error: 'Numărul de înmatriculare este obligatoriu.' });
  try {
    const { rows } = await db.query(
      `INSERT INTO vehicles (plate, make, model, year, capacity, tur_c1, tur_c2, retur_c1, retur_c2,
        status, km, itp_date, insurance_date, service_date, service_km, driver_name, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
      [plate.toUpperCase(), make||null, model||null, year||null, capacity||7,
       tur_c1||null, tur_c2||null, retur_c1||null, retur_c2||null,
       status||'activ', km||0, itp_date||null, insurance_date||null,
       service_date||null, service_km||0, driver_name||null, notes||null]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Număr înmatriculare deja există.' });
    res.status(500).json({ error: e.message });
  }
});

/* PUT /api/admin/vehicles/:id */
app.put('/api/admin/vehicles/:id', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { id } = req.params;
  const { plate, make, model, year, capacity, tur_c1, tur_c2, retur_c1, retur_c2,
          status, km, itp_date, insurance_date, service_date, service_km, driver_name, notes } = req.body || {};
  try {
    const { rows } = await db.query(
      `UPDATE vehicles SET plate=$1, make=$2, model=$3, year=$4, capacity=$5,
        tur_c1=$6, tur_c2=$7, retur_c1=$8, retur_c2=$9, status=$10,
        km=$11, itp_date=$12, insurance_date=$13, service_date=$14, service_km=$15,
        driver_name=$16, notes=$17 WHERE id=$18 RETURNING *`,
      [plate?.toUpperCase(), make||null, model||null, year||null, capacity||7,
       tur_c1||null, tur_c2||null, retur_c1||null, retur_c2||null,
       status||'activ', km||0, itp_date||null, insurance_date||null,
       service_date||null, service_km||0, driver_name||null, notes||null, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Vehicul negăsit.' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/admin/vehicles/:id — dezactivare, nu ștergere fizică */
app.delete('/api/admin/vehicles/:id', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { id } = req.params;
  try {
    const { rows: bk } = await db.query(
      `SELECT COUNT(*)::int AS cnt FROM bookings WHERE vehicle_id=$1 AND status='confirmed'`, [id]
    );
    const { rows } = await db.query(`UPDATE vehicles SET status='inactiv' WHERE id=$1 RETURNING *`, [id]);
    if (!rows.length) return res.status(404).json({ error: 'Vehicul negăsit.' });
    res.json({ ok: true, rezervari_active: bk[0].cnt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ──────────────────────────────────────────────
   GET /health
────────────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status:          'ok',
    mode:            process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST',
    email:           process.env.EMAIL_USER ? 'configured' : 'NOT configured',
    emailInternal:   process.env.EMAIL_INTERNAL || 'office@delta-air.ro (default)',
    webhook:         process.env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'NOT configured',
    database:        db ? 'configured' : 'NOT configured',
    netopiaApiKey:   process.env.NETOPIA_API_KEY ? `set (${process.env.NETOPIA_API_KEY.slice(0,6)}...)` : 'NOT SET',
    netopiaSignature:process.env.NETOPIA_SIGNATURE ? `set (${process.env.NETOPIA_SIGNATURE.slice(0,4)}...)` : 'NOT SET',
  });
});

/* ══════════════════════════════════════════════════════════════
   ADMIN API — autentificare simplă + CRUD rezervări
   Env vars: ADMIN_USER, ADMIN_PASS, ADMIN_SECRET
══════════════════════════════════════════════════════════════ */
const ADMIN_USER   = process.env.ADMIN_USER   || 'admin';
const ADMIN_PASS   = process.env.ADMIN_PASS   || 'deltaair2026';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'das-admin-secret-2026';
const ADMIN_TTL    = 12 * 60 * 60 * 1000; // 12 ore

function genAdminToken() {
  const ts = Date.now().toString();
  const sig = crypto.createHmac('sha256', ADMIN_SECRET).update(ts).digest('hex');
  return `${ts}.${sig}`;
}
function checkAdminToken(token) {
  try {
    const [ts, sig] = (token || '').split('.');
    if (!ts || !sig) return false;
    if (Date.now() - parseInt(ts) > ADMIN_TTL) return false;
    const exp = crypto.createHmac('sha256', ADMIN_SECRET).update(ts).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(exp, 'hex'));
  } catch { return false; }
}
function adminAuth(req, res, next) {
  const tok = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!checkAdminToken(tok)) return res.status(401).json({ error: 'Neautorizat.' });
  next();
}

/* POST /api/admin/login */
app.post('/api/admin/login', express.json(), (req, res) => {
  const { user, pass } = req.body || {};
  if (user !== ADMIN_USER || pass !== ADMIN_PASS)
    return res.status(401).json({ error: 'Credențiale incorecte.' });
  res.json({ token: genAdminToken() });
});

/* GET /api/admin/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD */
app.get('/api/admin/bookings', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { from = '2020-01-01', to = '2030-12-31' } = req.query;
  try {
    const { rows } = await db.query(
      `SELECT b.id, b.trip_date::text AS trip_date, b.trip_time, b.direction, b.passengers, b.transfer_type,
              b.booking_ref, b.status, b.created_at, b.meta_json, b.vehicle_id,
              v.plate AS vehicle_plate
       FROM bookings b
       LEFT JOIN vehicles v ON v.id = b.vehicle_id
       WHERE b.trip_date BETWEEN $1 AND $2
       ORDER BY b.trip_date ASC, b.trip_time ASC`,
      [from, to]
    );
    res.json(rows.map(r => {
      let meta = {};
      try { if (r.meta_json) meta = JSON.parse(r.meta_json); } catch {}
      return { id: r.id, trip_date: r.trip_date, trip_time: r.trip_time,
               direction: r.direction, passengers: r.passengers,
               transfer_type: r.transfer_type, booking_ref: r.booking_ref,
               status: r.status, created_at: r.created_at, meta,
               vehicle_id: r.vehicle_id, vehicle_plate: r.vehicle_plate };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* PUT /api/admin/booking/:id */
app.put('/api/admin/booking/:id', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { id } = req.params;
  const { trip_date, trip_time, direction, passengers, transfer_type,
          booking_ref, status, meta } = req.body || {};
  try {
    await db.query(
      `UPDATE bookings SET trip_date=$1, trip_time=$2, direction=$3, passengers=$4,
         transfer_type=$5, booking_ref=$6, status=$7, meta_json=$8
       WHERE id=$9`,
      [trip_date, trip_time, direction, parseInt(passengers) || 1,
       transfer_type, booking_ref, status,
       meta ? JSON.stringify(meta) : null, id]
    );
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* POST /api/admin/bookings — creare rezervare manuală de admin */
app.post('/api/admin/bookings', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { trip_date, trip_time, direction, passengers, transfer_type,
          booking_ref, status, meta: rawMeta } = req.body || {};
  if (!trip_date || !trip_time || !direction)
    return res.status(400).json({ error: 'Câmpuri obligatorii: trip_date, trip_time, direction.' });
  try {
    const pax = parseInt(passengers) || 1;
    const vehicleId = await findVehicleForTrip(direction, trip_time, trip_date, pax);
    const billingToken = crypto.randomBytes(32).toString('hex');
    const DIR_LABELS = { tur: 'Brașov → București', retur: 'București → Brașov' };
    const TR_LABELS  = { economy: 'Economy', privat: 'Transfer privat' };
    const meta = {
      ...(rawMeta || {}),
      dirLabel: DIR_LABELS[direction] || direction,
      trLabel:  TR_LABELS[transfer_type] || transfer_type || 'Economy',
      date:     trip_date,
      depTime:  trip_time,
      adults:   pax,
    };
    const { rows } = await db.query(
      `INSERT INTO bookings (trip_date, trip_time, direction, passengers, transfer_type, booking_ref, meta_json, vehicle_id, status, billing_token)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [trip_date, trip_time, direction, pax,
       transfer_type || 'economy', booking_ref || meta.name || '',
       JSON.stringify(meta), vehicleId,
       status || 'confirmed', billingToken]
    );
    const newId = rows[0].id;
    console.log(`📋 Rezervare manuală admin: ${trip_date} ${trip_time} ${direction} — ${pax} loc(uri) [id: ${newId}]`);

    /* Trimite email confirmare + internal dacă există adresă email */
    if (meta.email) {
      try {
        const SERVER_URL = process.env.SERVER_URL || 'https://delta-air-server-production.up.railway.app';
        const billingUrl = `${SERVER_URL}/date-facturare?token=${billingToken}`;
        const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
        const transporter = nodemailer.createTransport({
          host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT || '587'),
          secure: process.env.EMAIL_PORT === '465',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });
        await transporter.sendMail({
          from, to: meta.email,
          subject: `✈ Rezervare confirmată Delta Air Shuttle — ${trip_date} ${meta.dirLabel}`,
          html: buildAdminBookingConfirmationEmail(meta, billingUrl),
        });
        await transporter.sendMail({
          from, to: OFFICE_EMAIL,
          subject: `🔔 Rezervare manuală admin #${newId} — ${trip_date} ${trip_time} ${direction} — ${meta.name || ''}`,
          html: buildInternalNotificationEmail({ ...meta, payMethod: 'cash' }),
        });
      } catch (emailErr) {
        console.error('⚠️  Email confirmare admin booking:', emailErr.message);
      }
    }

    res.json({ ok: true, id: newId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/admin/booking/:id  (soft delete — status = 'cancelled') */
app.delete('/api/admin/booking/:id', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    await db.query(`UPDATE bookings SET status='cancelled' WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/admin/bookings/all — master reset: șterge toate rezervările */
app.delete('/api/admin/bookings/all', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    const { rowCount } = await db.query('DELETE FROM bookings');
    await db.query('DELETE FROM pending_payments');
    res.json({ ok: true, deleted: rowCount });
  } catch (e) {
    console.error('❌ master reset:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* GET /api/admin/booking/:id/contract */
app.get('/api/admin/booking/:id/contract', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    const { rows } = await db.query('SELECT meta_json FROM bookings WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Rezervare negăsită.' });
    let meta = {};
    try { meta = JSON.parse(rows[0].meta_json || '{}'); } catch {}
    const pdfBuffer = await generateContractPDF(meta);
    const name = (meta.name || 'client').replace(/\s+/g, '-').toLowerCase();
    const date = (meta.date || '').replace(/-/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="contract-delta-air-${date}-${name}.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('❌ admin/contract:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* GET /api/admin/booking/:id/invoice */
app.get('/api/admin/booking/:id/invoice', adminAuth, async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    const { rows } = await db.query('SELECT meta_json FROM bookings WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Rezervare negăsită.' });
    let meta = {};
    try { meta = JSON.parse(rows[0].meta_json || '{}'); } catch {}

    // Caută factura existentă prin pending_payments (evită duplicarea numerotării)
    let invoiceNum, invoiceYear;
    try {
      const inv = await db.query(
        `SELECT i.id, i.year FROM invoices i
         INNER JOIN pending_payments pp ON pp.token = i.booking_token
         WHERE pp.meta_json::jsonb->>'email' = $1
           AND pp.meta_json::jsonb->>'date'  = $2
         LIMIT 1`,
        [meta.email || '', meta.date || '']
      );
      if (inv.rows.length) { invoiceNum = inv.rows[0].id; invoiceYear = inv.rows[0].year; }
    } catch (_) {}

    if (!invoiceNum) {
      const r = await nextInvoiceNumber();
      invoiceNum = r.num; invoiceYear = r.year;
      await saveInvoiceMeta(invoiceNum, null, meta.firma || meta.name || '—');
    }

    const pdfBuffer = await generateInvoicePDF(meta, invoiceNum, invoiceYear);
    const invoiceNo = `DAS-${invoiceYear}-${String(invoiceNum).padStart(4, '0')}`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="factura-${invoiceNo}-delta-air.pdf"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('❌ admin/invoice:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Formular date facturare ─────────────────────────────────────── */

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* GET /date-facturare?token=XXX — formular HTML */
app.get('/date-facturare', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).send('<h2>Token lipsă.</h2>');
  if (!db) return res.status(503).send('<h2>DB indisponibil.</h2>');
  try {
    const { rows } = await db.query(
      `SELECT id, meta_json, trip_date, trip_time, direction, status FROM bookings WHERE billing_token=$1 LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).send('<h2>Link invalid sau expirat.</h2>');
    const bk = rows[0];
    let meta = {};
    try { meta = JSON.parse(bk.meta_json || '{}'); } catch {}
    const name = escHtml(meta.name || '');
    const email = escHtml(meta.email || '');
    const date = escHtml(bk.trip_date?.toString().slice(0,10) || '');
    const time = escHtml(bk.trip_time || '');
    const dir  = escHtml(meta.dirLabel || bk.direction || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html><html lang="ro"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Date facturare – Delta Air Shuttle</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Segoe UI',Arial,sans-serif;background:#f4f6fb;margin:0;padding:20px}
  .card{max-width:540px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;box-shadow:0 4px 24px rgba(26,47,94,.1)}
  h1{color:#0f1e3d;font-size:1.3rem;margin:0 0 4px}
  .sub{color:#8892a4;font-size:.88rem;margin:0 0 24px}
  .trip-info{background:#f4f6fb;border-radius:10px;padding:14px 18px;margin-bottom:24px;font-size:.88rem;color:#374151}
  .trip-info strong{color:#0f1e3d}
  label{display:block;font-size:.82rem;font-weight:600;color:#374151;margin-bottom:4px}
  input,select{width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.93rem;margin-bottom:14px;outline:none;transition:border .2s}
  input:focus,select:focus{border-color:#0f1e3d}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  button{width:100%;background:#0f1e3d;color:#fff;border:none;border-radius:10px;padding:14px;font-size:1rem;font-weight:700;cursor:pointer;margin-top:4px}
  button:hover{background:#243d75}
  .msg{margin-top:14px;padding:12px 16px;border-radius:8px;font-size:.9rem;display:none}
  .msg.ok{background:#f0fff4;color:#276749;border:1px solid #9ae6b4}
  .msg.err{background:#fff5f5;color:#c53030;border:1px solid #fc8181}
</style></head><body>
<div class="card">
  <h1>Date de facturare</h1>
  <p class="sub">Completează pentru a primi contractul și factura.</p>
  <div class="trip-info">
    <strong>${dir}</strong> &nbsp;·&nbsp; ${date} ${time}<br>Pasager: ${name}
  </div>
  <form id="form">
    <div class="row">
      <div><label>Nume / Prenume *</label><input name="clientName" required value="${name}"></div>
      <div><label>Email *</label><input name="clientEmail" type="email" required value="${email}"></div>
    </div>
    <label>Adresă *</label><input name="address" required placeholder="Str. Exemplu nr. 1, Cluj">
    <div class="row">
      <div><label>Localitate *</label><input name="city" required placeholder="Cluj-Napoca"></div>
      <div><label>Județ *</label><input name="county" required placeholder="Cluj"></div>
    </div>
    <div class="row">
      <div><label>CNP / CUI</label><input name="cnp" placeholder="CNP sau CUI firmă"></div>
      <div><label>Cod poștal</label><input name="postalCode" placeholder="400001"></div>
    </div>
    <label>Denumire firmă (dacă e cazul)</label><input name="firma" placeholder="S.C. Exemplu S.R.L.">
    <button type="submit">Trimite și generează documentele →</button>
  </form>
  <div class="msg" id="msg"></div>
</div>
<script>
document.getElementById('form').addEventListener('submit', async function(e) {
  e.preventDefault();
  const btn = this.querySelector('button');
  btn.disabled = true; btn.textContent = 'Se trimite...';
  const data = Object.fromEntries(new FormData(this));
  try {
    const r = await fetch('/api/date-facturare', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ token: '${escHtml(token)}', ...data })
    });
    const d = await r.json();
    const msg = document.getElementById('msg');
    msg.style.display = 'block';
    if (r.ok) {
      msg.className = 'msg ok';
      msg.textContent = '✓ Date salvate! Vei primi contractul și factura pe email în câteva minute.';
      btn.textContent = '✓ Trimis';
    } else {
      msg.className = 'msg err';
      msg.textContent = 'Eroare: ' + (d.error || 'necunoscut');
      btn.disabled = false; btn.textContent = 'Trimite și generează documentele →';
    }
  } catch(err) {
    const msg = document.getElementById('msg');
    msg.style.display='block'; msg.className='msg err';
    msg.textContent = 'Eroare de rețea: ' + err.message;
    btn.disabled=false; btn.textContent='Trimite și generează documentele →';
  }
});
</script>
</body></html>`);
  } catch (e) { res.status(500).send('<h2>Eroare server.</h2>'); }
});

/* POST /api/date-facturare — salvează date + trimite PDF-uri */
app.post('/api/date-facturare', express.json(), async (req, res) => {
  const { token, clientName, clientEmail, address, city, county, cnp, postalCode, firma } = req.body || {};
  if (!token) return res.status(400).json({ error: 'Token lipsă.' });
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  try {
    const { rows } = await db.query(
      `SELECT id, meta_json FROM bookings WHERE billing_token=$1 AND status != 'cancelled' LIMIT 1`,
      [token]
    );
    if (!rows.length) return res.status(404).json({ error: 'Link invalid sau expirat.' });
    const bk = rows[0];
    let meta = {};
    try { meta = JSON.parse(bk.meta_json || '{}'); } catch {}

    const billingData = { clientName, clientEmail, address, city, county, cnp, postalCode, firma };
    const enrichedMeta = { ...meta, ...billingData,
      name:  clientName || meta.name,
      email: clientEmail || meta.email,
    };

    await db.query(
      `UPDATE bookings SET meta_json=$1, reminded_at=NOW() WHERE id=$2`,
      [JSON.stringify(enrichedMeta), bk.id]
    );

    /* Generează și trimite PDF-uri */
    try {
      const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
      const toEmail = clientEmail || meta.email;
      const transporter = nodemailer.createTransport({
        host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT || '587'),
        secure: process.env.EMAIL_PORT === '465',
        auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
      });

      const contractBuf = await generateContractPDF(enrichedMeta);
      const { year, num } = await nextInvoiceNumber();
      await saveInvoiceMeta(num, token, enrichedMeta.firma || enrichedMeta.name || '—');
      const invoiceNo  = `DAS-${year}-${String(num).padStart(4,'0')}`;
      const invoiceBuf = await generateInvoicePDF(enrichedMeta, num, year);

      const attachments = [
        { filename: `contract-delta-air-${enrichedMeta.date||''}-${(enrichedMeta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`, content: contractBuf, contentType: 'application/pdf' },
        { filename: `factura-${invoiceNo}-delta-air.pdf`, content: invoiceBuf, contentType: 'application/pdf' },
      ];

      if (toEmail) {
        await transporter.sendMail({
          from, to: toEmail,
          subject: `✈ Contract și factură Delta Air Shuttle — ${enrichedMeta.date||''} ${enrichedMeta.dirLabel||''}`,
          html: `<p>Bună ziua, ${escHtml(enrichedMeta.name||'')},</p><p>Atașăm contractul și factura pentru rezervarea dumneavoastră Delta Air Shuttle din <strong>${enrichedMeta.date||''}</strong>.</p><p>Mulțumim!</p>`,
          attachments,
        });
      }
      await transporter.sendMail({
        from, to: OFFICE_EMAIL,
        subject: `📄 Date facturare completate #${bk.id} — ${enrichedMeta.name||''} — ${enrichedMeta.date||''}`,
        html: `<p>Clientul <strong>${escHtml(enrichedMeta.name||'')}</strong> a completat datele de facturare pentru rezervarea #${bk.id}.<br>CUI/CNP: ${escHtml(cnp||'')} &nbsp;·&nbsp; Firmă: ${escHtml(firma||'—')}<br>Adresă: ${escHtml(address||'')} ${escHtml(city||'')} ${escHtml(county||'')}</p>`,
        attachments,
      });
    } catch (emailErr) {
      console.error('⚠️  Email PDF date-facturare:', emailErr.message);
    }

    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Block / unblock zi ──────────────────────────────────────────── */

/* POST /api/admin/block-day */
app.post('/api/admin/block-day', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Câmp obligatoriu: date.' });
  try {
    /* Calculează capacitatea totală per slot (suma vehiculelor active pe fiecare orar) */
    const slots = [
      { direction: 'tur',   trip_time: TRIP_TIMES.tur.c1 },
      { direction: 'tur',   trip_time: TRIP_TIMES.tur.c2 },
      { direction: 'retur', trip_time: TRIP_TIMES.retur.c1 },
      { direction: 'retur', trip_time: TRIP_TIMES.retur.c2 },
    ];
    for (const slot of slots) {
      /* Verifică dacă există deja un blocat activ pentru slotul acesta */
      const { rows: existing } = await db.query(
        `SELECT id FROM bookings WHERE trip_date=$1 AND trip_time=$2 AND direction=$3
         AND transfer_type='blocat' AND status='confirmed' LIMIT 1`,
        [date, slot.trip_time, slot.direction]
      );
      if (existing.length) continue;
      /* Sumă capacități vehicule active pe slotul acesta */
      const { rows: veh } = await db.query(
        `SELECT COALESCE(SUM(capacity), ${CAPACITY}) AS total_cap
         FROM vehicles WHERE status='activ' AND $1 IN (tur_c1, tur_c2, retur_c1, retur_c2)`,
        [slot.trip_time]
      );
      const slotCap = parseInt(veh[0]?.total_cap) || CAPACITY;
      const firstVeh = await db.query(`SELECT id FROM vehicles WHERE status='activ' ORDER BY id LIMIT 1`);
      const vehicleId = firstVeh.rows[0]?.id || null;
      await db.query(
        `INSERT INTO bookings (trip_date, trip_time, direction, passengers, transfer_type, booking_ref, status, vehicle_id)
         VALUES ($1, $2, $3, $4, 'blocat', 'BLOCAT', 'confirmed', $5)`,
        [date, slot.trip_time, slot.direction, slotCap, vehicleId]
      );
    }
    console.log(`🔒 Zi blocată: ${date}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* DELETE /api/admin/block-day */
app.delete('/api/admin/block-day', adminAuth, express.json(), async (req, res) => {
  if (!db) return res.status(503).json({ error: 'DB indisponibil.' });
  const { date } = req.body || {};
  if (!date) return res.status(400).json({ error: 'Câmp obligatoriu: date.' });
  try {
    await db.query(
      `UPDATE bookings SET status='cancelled' WHERE trip_date=$1 AND transfer_type='blocat' AND status='confirmed'`,
      [date]
    );
    console.log(`🔓 Zi deblocată: ${date}`);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ── Reminder cron — 12h înainte îmbarcare ───────────────────────── */
setInterval(async () => {
  if (!db) return;
  try {
    const SERVER_URL = process.env.SERVER_URL || 'https://delta-air-server-production.up.railway.app';
    const { rows } = await db.query(
      `SELECT id, meta_json, trip_date, trip_time, billing_token
       FROM bookings
       WHERE status = 'confirmed'
         AND transfer_type != 'blocat'
         AND billing_token IS NOT NULL
         AND reminded_at IS NULL
         AND (trip_date::date + trip_time::time) AT TIME ZONE 'Europe/Bucharest'
             BETWEEN NOW() AND NOW() + INTERVAL '12 hours 30 minutes'`
    );
    for (const bk of rows) {
      /* Marchează idempotent — dacă altă instanță deja trimis, skip */
      const { rowCount } = await db.query(
        `UPDATE bookings SET reminded_at = NOW() WHERE id = $1 AND reminded_at IS NULL`,
        [bk.id]
      );
      if (rowCount === 0) continue;
      let meta = {};
      try { meta = JSON.parse(bk.meta_json || '{}'); } catch {}
      const billingUrl = `${SERVER_URL}/date-facturare?token=${bk.billing_token}`;
      const toEmail = meta.email;
      if (!toEmail) continue;
      try {
        const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
        const transporter = nodemailer.createTransport({
          host: process.env.EMAIL_HOST, port: parseInt(process.env.EMAIL_PORT || '587'),
          secure: process.env.EMAIL_PORT === '465',
          auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
        });
        const html = buildReminderEmail(meta, billingUrl);
        const subject = `⏰ Reminder îmbarcare Delta Air — ${bk.trip_date?.toString().slice(0,10)||''} ${bk.trip_time}`;
        await transporter.sendMail({ from, to: toEmail, subject, html });
        await transporter.sendMail({ from, to: OFFICE_EMAIL,
          subject: `⏰ Reminder trimis #${bk.id} — ${meta.name||''} — ${bk.trip_date?.toString().slice(0,10)||''} ${bk.trip_time}`,
          html: `<p>Reminder automat trimis clientului <strong>${escHtml(meta.name||'')}</strong> (${escHtml(toEmail)}) pentru cursa #${bk.id} din ${bk.trip_date?.toString().slice(0,10)||''} ${bk.trip_time}.<br>Link facturare: <a href="${billingUrl}">${billingUrl}</a></p>`,
        });
        console.log(`⏰ Reminder trimis booking #${bk.id} → ${toEmail}`);
      } catch (err) { console.error(`⚠️  Reminder email #${bk.id}:`, err.message); }
    }
  } catch (e) { console.error('⚠️  Reminder cron error:', e.message); }
}, 60 * 60 * 1000); /* rulează la fiecare 60 de minute */

/* ── POST /api/kronads-contact — formular lead KronAds ── */
app.post('/api/kronads-contact', express.json(), async (req, res) => {
  const { name, company, email, phone, description } = req.body || {};
  if (!name || !email || !description) {
    return res.status(400).json({ error: 'Câmpurile obligatorii lipsesc.' });
  }
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#1a2f5e">🤖 Lead nou — KronAds AI Automations</h2>
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:8px;font-weight:600;width:140px">Nume</td><td style="padding:8px">${escHtml(name)}</td></tr>
        <tr style="background:#f4f6fb"><td style="padding:8px;font-weight:600">Companie</td><td style="padding:8px">${escHtml(company || '—')}</td></tr>
        <tr><td style="padding:8px;font-weight:600">Email</td><td style="padding:8px"><a href="mailto:${escHtml(email)}">${escHtml(email)}</a></td></tr>
        <tr style="background:#f4f6fb"><td style="padding:8px;font-weight:600">Telefon</td><td style="padding:8px">${escHtml(phone || '—')}</td></tr>
        <tr><td style="padding:8px;font-weight:600;vertical-align:top">Nevoia</td><td style="padding:8px;white-space:pre-wrap">${escHtml(description)}</td></tr>
      </table>
    </div>`;
  try {
    await transporter.sendMail({
      from:    process.env.EMAIL_FROM || `"KronAds" <${process.env.EMAIL_USER}>`,
      to:      'contact@kronads.ro',
      replyTo: email,
      subject: `🤖 Lead nou KronAds — ${escHtml(name)} (${escHtml(company || email)})`,
      html,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('KronAds contact email error:', err.message);
    res.status(500).json({ error: 'Eroare la trimiterea emailului.' });
  }
});

app.listen(PORT, () => {
  console.log(`\n✅ Delta Air Shuttle server pornit pe http://localhost:${PORT}`);
  console.log(`   Mod Stripe:     ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🔴 LIVE' : '🟡 TEST'}`);
  console.log(`   Email SMTP:     ${process.env.EMAIL_USER || '⚠️  neconfigurat'}`);
  console.log(`   Email intern:   ${OFFICE_EMAIL}`);
  console.log(`   Webhook:        ${process.env.STRIPE_WEBHOOK_SECRET ? '✅ configurat' : '⚠️  neconfigurat'}`);
  console.log(`   Health:         http://localhost:${PORT}/health\n`);
});
