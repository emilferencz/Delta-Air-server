(function () {
  const TARGET_ID = 'kronads-widget';
  const API = 'https://delta-air-server-production.up.railway.app/api/kronads-contact';
  const WA  = 'https://wa.me/40723644418?text=Buna%20ziua%2C%20as%20vrea%20sa%20discut%20despre%20automatizarea%20afacerii%20mele%20cu%20KronAds.';

  const CSS = `
    :host { display: block; font-family: 'Poppins', 'Segoe UI', sans-serif; }
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .kw-wrap {
      background: linear-gradient(135deg, #0f1e3d 0%, #1a2f5e 100%);
      border-radius: 20px;
      padding: 48px 40px;
      color: #fff;
      max-width: 680px;
    }
    .kw-badge {
      display: inline-block;
      background: rgba(201,168,76,.15);
      border: 1px solid rgba(201,168,76,.3);
      color: #c9a84c;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .08em;
      text-transform: uppercase;
      padding: 4px 14px;
      border-radius: 20px;
      margin-bottom: 18px;
    }
    .kw-title {
      font-size: clamp(1.4rem, 4vw, 2rem);
      font-weight: 900;
      line-height: 1.2;
      margin-bottom: 10px;
    }
    .kw-title span { color: #c9a84c; }
    .kw-sub {
      font-size: .95rem;
      color: rgba(255,255,255,.6);
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .kw-form { display: flex; flex-direction: column; gap: 14px; }
    .kw-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .kw-label {
      display: block;
      font-size: .72rem;
      font-weight: 700;
      letter-spacing: .06em;
      text-transform: uppercase;
      color: rgba(255,255,255,.45);
      margin-bottom: 6px;
    }
    .kw-input, .kw-textarea {
      width: 100%;
      background: rgba(255,255,255,.07);
      border: 1.5px solid rgba(255,255,255,.15);
      border-radius: 10px;
      padding: 11px 15px;
      font-size: .92rem;
      font-family: inherit;
      color: #fff;
      outline: none;
      transition: border-color .2s;
    }
    .kw-input:focus, .kw-textarea:focus { border-color: #c9a84c; }
    .kw-input::placeholder, .kw-textarea::placeholder { color: rgba(255,255,255,.28); }
    .kw-textarea { resize: vertical; min-height: 100px; }
    .kw-btn {
      width: 100%;
      padding: 14px;
      background: #c9a84c;
      color: #0f1e3d;
      border: none;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      transition: background .2s, transform .2s;
      margin-top: 4px;
    }
    .kw-btn:hover { background: #b8943e; transform: translateY(-1px); }
    .kw-btn:disabled { opacity: .6; transform: none; cursor: not-allowed; }
    .kw-msg { text-align: center; font-size: .88rem; font-weight: 600; min-height: 22px; margin-top: 6px; }
    .kw-msg.ok  { color: #4ade80; }
    .kw-msg.err { color: #f87171; }
    .kw-divider {
      display: flex; align-items: center; gap: 12px;
      margin: 22px 0 18px;
    }
    .kw-divider::before, .kw-divider::after {
      content: ''; flex: 1; height: 1px; background: rgba(255,255,255,.12);
    }
    .kw-divider span { font-size: .75rem; color: rgba(255,255,255,.35); white-space: nowrap; }
    .kw-wa {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 13px;
      background: #25d366; color: #fff;
      border: none; border-radius: 12px;
      font-size: .95rem; font-weight: 700; font-family: inherit;
      text-decoration: none;
      cursor: pointer;
      transition: background .2s, transform .2s;
      box-shadow: 0 4px 18px rgba(37,211,102,.3);
    }
    .kw-wa:hover { background: #1db954; transform: translateY(-1px); }
    .kw-footer {
      text-align: center;
      margin-top: 20px;
      font-size: .7rem;
      color: rgba(255,255,255,.2);
    }
    .kw-footer a { color: rgba(201,168,76,.5); text-decoration: none; }
    @media (max-width: 520px) {
      .kw-wrap { padding: 32px 20px; }
      .kw-cols { grid-template-columns: 1fr; }
    }
  `;

  const HTML = `
    <div class="kw-wrap">
      <div class="kw-badge">KronAds MKT LLC · AI Automations</div>
      <h2 class="kw-title">Automatizează <span>ce faci manual</span></h2>
      <p class="kw-sub">Spune-ne despre fluxurile tale de lucru și îți arătăm în 30 de minute ce poate fi automatizat.</p>

      <form class="kw-form" id="kw-form">
        <div class="kw-cols">
          <div>
            <label class="kw-label" for="kw-name">Nume *</label>
            <input class="kw-input" id="kw-name" type="text" placeholder="Ion Popescu" required>
          </div>
          <div>
            <label class="kw-label" for="kw-company">Companie / Domeniu</label>
            <input class="kw-input" id="kw-company" type="text" placeholder="E-commerce, Clinică...">
          </div>
        </div>
        <div class="kw-cols">
          <div>
            <label class="kw-label" for="kw-email">Email *</label>
            <input class="kw-input" id="kw-email" type="email" placeholder="email@firma.ro" required>
          </div>
          <div>
            <label class="kw-label" for="kw-phone">Telefon</label>
            <input class="kw-input" id="kw-phone" type="tel" placeholder="+40 7xx xxx xxx">
          </div>
        </div>
        <div>
          <label class="kw-label" for="kw-desc">Ce vrei să automatizezi? *</label>
          <textarea class="kw-textarea" id="kw-desc" placeholder="Ex: trimit manual facturi, procesez comenzi din mai multe surse, completez rapoarte zilnic..." required></textarea>
        </div>
        <button class="kw-btn" type="submit" id="kw-btn">Trimite cererea →</button>
        <div class="kw-msg" id="kw-msg"></div>
      </form>

      <div class="kw-divider"><span>sau contactează-ne direct</span></div>
      <a class="kw-wa" href="${WA}" target="_blank" rel="noopener">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        WhatsApp — răspundem imediat
      </a>
      <div class="kw-footer">Powered by <a href="https://delta-air.ro/kronads-ai/" target="_blank">KronAds MKT LLC</a></div>
    </div>
  `;

  function init() {
    const host = document.getElementById(TARGET_ID);
    if (!host) return;

    const shadow = host.attachShadow({ mode: 'open' });
    const style  = document.createElement('style');
    style.textContent = CSS;
    shadow.appendChild(style);

    const link = document.createElement('link');
    link.rel  = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;900&display=swap';
    shadow.appendChild(link);

    const div = document.createElement('div');
    div.innerHTML = HTML;
    shadow.appendChild(div);

    shadow.getElementById('kw-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      const btn = shadow.getElementById('kw-btn');
      const msg = shadow.getElementById('kw-msg');
      btn.disabled = true;
      btn.textContent = 'Se trimite...';
      msg.className = 'kw-msg';
      msg.textContent = '';
      try {
        const res = await fetch(API, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name:        shadow.getElementById('kw-name').value.trim(),
            company:     shadow.getElementById('kw-company').value.trim(),
            email:       shadow.getElementById('kw-email').value.trim(),
            phone:       shadow.getElementById('kw-phone').value.trim(),
            description: shadow.getElementById('kw-desc').value.trim(),
          })
        });
        if (res.ok) {
          msg.className = 'kw-msg ok';
          msg.textContent = '✅ Mesaj trimis! Te contactăm în maxim 24 de ore.';
          shadow.getElementById('kw-form').reset();
        } else { throw new Error(); }
      } catch {
        msg.className = 'kw-msg err';
        msg.textContent = '⚠️ Eroare. Încearcă pe WhatsApp sau email direct.';
      }
      btn.disabled = false;
      btn.textContent = 'Trimite cererea →';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
