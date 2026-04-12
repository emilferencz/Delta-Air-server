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
const stripe     = require('stripe')(process.env.STRIPE_SECRET_KEY);
const nodemailer = require('nodemailer');

/* ── Stocare sesiuni rezervare în memorie (TTL 2 ore) ── */
const sessions = new Map();
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
  .detail-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem}
  .detail-row:last-child{border-bottom:none}
  .detail-label{color:#8892a4}
  .detail-value{font-weight:600;color:#1a202c;text-align:right}
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
  .detail-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid rgba(26,47,94,.07);font-size:.9rem}
  .detail-row:last-child{border-bottom:none}
  .detail-label{color:#8892a4}
  .detail-value{font-weight:600;color:#1a202c;text-align:right}
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
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}${children>0?` + ${children} copil${children>1?'i':''}`:''}}</span></div>
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
      <div class="detail-row"><span class="detail-label">Pasageri</span><span class="detail-value">${adults} adult${adults>1?'ți':''}${children>0?` + ${children} copil${children>1?'i':''}`:''}}</span></div>
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
   POST /api/reserve-cash
   Rezervare fără plată online — trimite email
   clientului și intern la Delta Air
────────────────────────────────────────────── */
app.post('/api/reserve-cash', async (req, res) => {
  try {
    const { meta = {}, customerEmail } = req.body;
    if (!customerEmail) return res.status(400).json({ error: 'Email lipsă.' });

    const hasEmail = process.env.EMAIL_USER && process.env.EMAIL_PASS;
    if (hasEmail) {
      const transOpts = {
        from: process.env.EMAIL_FROM || `"Delta Air Shuttle" <${process.env.EMAIL_USER}>`,
        subject: `✈ Rezervare confirmată – ${meta.date || ''} ${meta.dirLabel || ''} (plată la îmbarcare)`,
        html: buildCashConfirmationEmail(meta),
      };
      // Email către client
      await transporter.sendMail({ ...transOpts, to: customerEmail });
      // Email intern către Delta Air cu toate detaliile
      await transporter.sendMail({
        from: transOpts.from,
        to: process.env.EMAIL_USER,
        subject: `🔔 Rezervare nouă – ${meta.date || ''} ${meta.dirLabel || ''} | ${meta.name || ''} | Plată la îmbarcare`,
        html: buildInternalNotificationEmail(meta),
      });
      console.log(`📧 Rezervare cash confirmată → client: ${customerEmail} | intern: ${process.env.EMAIL_USER}`);
    } else {
      console.warn('⚠️  EMAIL_USER / EMAIL_PASS lipsă — emailuri netrimise.');
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ Eroare reserve-cash:', err.message);
    res.status(500).json({ error: err.message });
  }
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
