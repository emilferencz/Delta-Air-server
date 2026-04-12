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
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');

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

/* ── Înlocuire diacritice pentru PDF (Helvetica nu suportă UTF-8) ── */
function ro(str) {
  if (!str) return '';
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
  } = meta;

  const isFirma = !!(firma && cui);

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
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${date}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${arrTime}</span></div>
      ${pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults > 1 ? 'ți' : ''}${children > 0 ? ` + ${children} copil${children > 1 ? 'i' : ''}` : ''}</span></div>
      ${bags > 0 ? `<div class="detail-row"><span class="detail-label">Bagaje extra</span><span class="detail-value">${bags} bagaj${bags > 1 ? 'e' : ''}</span></div>` : ''}
      ${obs ? `<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>` : ''}
    </div>

    <div class="section-title">Date de contact</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
      ${isFirma ? `<div class="detail-row"><span class="detail-label">Firmă</span><span class="detail-value">${firma} (${cui})</span></div>` : ''}
    </div>

    <div class="total-box">
      <span class="total-label">Total achitat</span>
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
      bcc:     process.env.EMAIL_USER,          // copie internă
      subject: `✈ Confirmare rezervare Delta Air Shuttle — ${meta.date || ''} ${meta.dirLabel || ''}`,
      html:    buildConfirmationEmail(meta),
    });
    console.log(`📧 Email confirmare trimis → ${customerEmail}`);
  } catch (err) {
    console.error('❌ Eroare trimitere email:', err.message);
  }
}

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
      const session  = event.data.object;
      const email    = session.customer_email || session.customer_details?.email;
      const metaRaw  = session.metadata?.rezervare_info;

      let meta = {};
      try { meta = metaRaw ? JSON.parse(metaRaw) : {}; } catch (_) {}

      console.log(`✅ Plată confirmată | ${email} | ${meta.dirLabel || ''} | ${meta.date || ''}`);

      if (email) {
        await sendConfirmationEmail(email, meta);
      }
    }

    res.json({ received: true });
  }
);

/* ── Rest middleware (după webhook!) ── */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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
  } = meta;
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
      <p>Ai optat pentru plata în numerar la îmbarcare. Pregătește suma de <strong>${total} lei</strong> pentru șofer.</p>
    </div>
    <div class="section-title">Detalii cursă</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Direcție</span><span class="detail-value">${dirLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Tip transfer</span><span class="detail-value">${trLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Aeroport</span><span class="detail-value">${aptLabel}</span></div>
      <div class="detail-row"><span class="detail-label">Data</span><span class="detail-value">${date}</span></div>
      <div class="detail-row"><span class="detail-label">Ora plecare</span><span class="detail-value">${depTime}</span></div>
      <div class="detail-row"><span class="detail-label">Sosire estimată</span><span class="detail-value">${arrTime}</span></div>
      ${pickupLabel ? `<div class="detail-row"><span class="detail-label">Punct îmbarcare</span><span class="detail-value">${pickupLabel}</span></div>` : ''}
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}${children>0?` + ${children} copil${children>1?'i':''}`:''}</span></div>
      ${bags>0?`<div class="detail-row"><span class="detail-label">Bagaje extra</span><span class="detail-value">${bags} bagaj${bags>1?'e':''}</span></div>`:''}
      ${paxList}
      ${obs?`<div class="detail-row"><span class="detail-label">Observații</span><span class="detail-value">${obs}</span></div>`:''}
    </div>
    <div class="section-title">Date de contact</div>
    <div class="detail-box">
      <div class="detail-row"><span class="detail-label">Nume</span><span class="detail-value">${name}</span></div>
      <div class="detail-row"><span class="detail-label">Telefon</span><span class="detail-value">${phone}</span></div>
      <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${email}</span></div>
      ${isFirma?`<div class="detail-row"><span class="detail-label">Firmă</span><span class="detail-value">${firma} (${cui})</span></div>`:''}
    </div>
    <div class="total-box">
      <span class="total-label">Total de achitat la îmbarcare</span>
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
    } = meta;

    // Aplică ro() pe toate câmpurile variabile
    const rDirLabel    = ro(dirLabel);
    const rTrLabel     = ro(trLabel);
    const rAptLabel    = ro(aptLabel);
    const rDate        = ro(date);
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

    const fReg  = 'Helvetica';
    const fBold = 'Helvetica-Bold';

    const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width;
    const L = 50, R = W - 50, INNER = R - L;
    const navy = '#1a2f5e', gold = '#c9a84c', gray = '#555555', lgray = '#888888';
    // Foloseste data/ora de pe dispozitivul clientului la momentul confirmarii
    const now = meta.confirmedAt ? new Date(meta.confirmedAt) : new Date();
    const today = now.toLocaleDateString('ro-RO', { day:'2-digit', month:'2-digit', year:'numeric' });
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
       PRET SI PLATA
    ══════════════════════════════════════════ */
    section('Pret si plata');

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
    bullet('Virament bancar: ING BANK  RO57 INGB 0000 9999 0870 0688  (minim 3 zile inainte)');
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
    doc.moveTo(col2, sigY+62).lineTo(col2+160, sigY+62).strokeColor(navy).lineWidth(0.5).stroke();
    doc.fillColor(lgray).fontSize(7).font(fReg).text('Semnatura beneficiar', col2, sigY+65);

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
   POST /api/reserve-cash
   Rezervare fără plată online — trimite email
   clientului și intern la Delta Air
────────────────────────────────────────────── */
app.post('/api/reserve-cash', async (req, res) => {
  try {
    const { meta = {}, customerEmail } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email lipsă.' });

    // Generează PDF contract
    const pdfBuffer = await generateContractPDF(meta);
    const fileName = `contract-delta-air-${(meta.date||'').replace(/-/g,'')}-${(meta.name||'client').replace(/\s+/g,'-').toLowerCase()}.pdf`;

    // Salvează în store cu token unic (TTL 2 ore)
    const token = crypto.randomBytes(16).toString('hex');
    contractStore.set(token, { buffer: pdfBuffer, fileName, createdAt: Date.now() });

    const hasEmail = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    if (hasEmail) {
      const from = process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`;
      const attachment = { filename: fileName, content: pdfBuffer, contentType: 'application/pdf' };

      // Email către client cu contract atașat
      await transporter.sendMail({
        from,
        to: customerEmail,
        subject: `✈ Rezervare confirmată – ${meta.date || ''} ${meta.dirLabel || ''} (plată la îmbarcare)`,
        html: buildCashConfirmationEmail(meta),
        attachments: [attachment],
      });

      // Email intern cu contract atașat
      const internalTo = process.env.EMAIL_INTERNAL || 'office@delta-air.ro';
      await transporter.sendMail({
        from,
        to: internalTo,
        subject: `🔔 Rezervare nouă – ${meta.date || ''} ${meta.dirLabel || ''} | ${meta.name || ''} | Plată la îmbarcare`,
        html: buildInternalNotificationEmail(meta),
        attachments: [attachment],
      });
      console.log(`📧 Rezervare cash confirmată → client: ${customerEmail} | intern: ${internalTo}`);
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
   GET /api/download-contract?token=xxx
────────────────────────────────────────────── */
app.get('/api/download-contract', (req, res) => {
  const { token } = req.query;
  const entry = contractStore.get(token);
  if (!entry) return res.status(404).json({ error: 'Contractul nu mai este disponibil sau a expirat.' });
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
  };
  try {
    await transporter.verify();
    res.json({ ok: true, smtp: 'conectat', config: cfg });
  } catch (err) {
    res.json({ ok: false, smtp: err.message, config: cfg });
  }
});

/* ──────────────────────────────────────────────
   POST /api/create-checkout-session
────────────────────────────────────────────── */
app.post('/api/create-checkout-session', async (req, res) => {
  try {
    const { lineItems = [], meta = {}, customerEmail } = req.body;
    if (!lineItems.length) {
      return res.status(400).json({ error: 'Nu există produse în coș.' });
    }
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
      metadata: {
        sursa:          'Delta Air Shuttle Booking Form',
        rezervare_info: JSON.stringify(meta).substring(0, 500),
      },
      success_url: process.env.STRIPE_SUCCESS_URL || 'https://delta-air.ro/rezervare-confirmata',
      cancel_url:  process.env.STRIPE_CANCEL_URL  || 'https://delta-air.ro/rezervari',
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ──────────────────────────────────────────────
   GET /health
────────────────────────────────────────────── */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    mode:   process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST',
    email:  process.env.EMAIL_USER ? 'configured' : 'NOT configured',
    webhook: process.env.STRIPE_WEBHOOK_SECRET ? 'configured' : 'NOT configured',
  });
});

app.listen(PORT, () => {
  console.log(`\n✅ Delta Air Shuttle server pornit pe http://localhost:${PORT}`);
  console.log(`   Mod Stripe:  ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? '🔴 LIVE' : '🟡 TEST'}`);
  console.log(`   Email:       ${process.env.EMAIL_USER || '⚠️  neconfigurat'}`);
  console.log(`   Webhook:     ${process.env.STRIPE_WEBHOOK_SECRET ? '✅ configurat' : '⚠️  neconfigurat'}`);
  console.log(`   Health:      http://localhost:${PORT}/health\n`);
});
