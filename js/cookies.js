/* Delta Air Shuttle — Cookie Consent Manager (GDPR/ePrivacy compliant) */
(function () {
  var KEY = 'deltaair_cookies';

  /* Toate toggle-urile ajustabile — default false (inactive) */
  var TOGGLES = [
    /* Preferințe */
    'pref_consent', 'pref_ui', 'pref_lang',
    /* Analiză */
    'ga_traffic', 'ga_audience', 'gtm_analytics',
    /* Marketing */
    'meta_facebook', 'meta_instagram', 'google_ads', 'retargeting'
  ];

  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  function savePrefs(prefs) {
    var obj = { ts: new Date().toISOString() };
    TOGGLES.forEach(function (k) { obj[k] = !!prefs[k]; });
    localStorage.setItem(KEY, JSON.stringify(obj));
  }

  function hasAnalytics(p) {
    return p && (p.ga_traffic || p.ga_audience || p.gtm_analytics);
  }
  function hasMarketing(p) {
    return p && (p.meta_facebook || p.meta_instagram || p.google_ads || p.retargeting);
  }

  function loadGA() {
    if (!window.gtag) return;
    gtag('consent', 'update', {
      'analytics_storage': 'granted',
      'ad_user_data': 'granted',
      'ad_personalization': 'granted'
    });
  }

  function loadPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window,document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    fbq('init', '925885630411031');
    fbq('track', 'PageView');
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({event: 'meta_consent_granted'});
  }

  function applyPrefs(prefs) {
    if (hasAnalytics(prefs)) loadGA();
    if (hasMarketing(prefs)) loadPixel();
  }

  function hideBanner() {
    var b = document.getElementById('ck-banner');
    if (!b) return;
    b.classList.remove('ck-visible');
    setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 450);
  }

  function closeModal() {
    var m = document.getElementById('ck-modal');
    if (m) m.classList.remove('ck-modal-open');
  }

  function openModal() {
    var m = document.getElementById('ck-modal');
    if (!m) return;
    var p = getPrefs() || {};
    TOGGLES.forEach(function (k) {
      var el = document.getElementById('ck-tog-' + k);
      if (el) el.checked = !!p[k];
    });
    var tsEl = document.getElementById('ck-ts');
    if (p.ts) {
      var d = new Date(p.ts);
      tsEl.textContent = d.toLocaleDateString('ro-RO', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } else {
      tsEl.textContent = '—';
    }
    m.classList.add('ck-modal-open');
  }

  function injectFloat() {
    if (document.getElementById('ck-float')) return;
    var btn = document.createElement('button');
    btn.id = 'ck-float';
    btn.title = 'Modifică preferințele cookie-uri';
    btn.setAttribute('aria-label', 'Modifică preferințele cookie-uri');
    btn.textContent = '🍪';
    btn.setAttribute('style',
      'position:fixed !important;bottom:80px !important;left:16px !important;right:auto !important;' +
      'z-index:2147483647 !important;width:50px !important;height:50px !important;' +
      'border-radius:50% !important;background:rgba(10,20,45,.95) !important;' +
      'border:2px solid #c9a84c !important;font-size:22px !important;cursor:pointer !important;' +
      'display:flex !important;align-items:center !important;justify-content:center !important;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.45) !important;touch-action:manipulation !important;' +
      '-webkit-tap-highlight-color:transparent !important;'
    );
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function acceptAll() {
    var all = {};
    TOGGLES.forEach(function (k) { all[k] = true; });
    savePrefs(all);
    applyPrefs(all);
    hideBanner();
    closeModal();
    injectFloat();
  }

  function rejectAll() {
    var none = {};
    TOGGLES.forEach(function (k) { none[k] = false; });
    savePrefs(none);
    hideBanner();
    closeModal();
    injectFloat();
  }

  function saveCustom() {
    var prefs = {};
    TOGGLES.forEach(function (k) {
      var el = document.getElementById('ck-tog-' + k);
      prefs[k] = el ? el.checked : false;
    });
    savePrefs(prefs);
    applyPrefs(prefs);
    hideBanner();
    closeModal();
    injectFloat();
  }

  /* ── Funcție ajutor: rând toggle sub-categorie ── */
  function subrow(id, title, desc) {
    return (
      '<div class="ck-subrow">' +
        '<div class="ck-subrow-info">' +
          '<strong>' + title + '</strong>' +
          '<span>' + desc + '</span>' +
        '</div>' +
        '<label class="ck-toggle" aria-label="' + title + '">' +
          '<input type="checkbox" id="ck-tog-' + id + '">' +
          '<span class="ck-knob"></span>' +
        '</label>' +
      '</div>'
    );
  }

  /* ── Funcție ajutor: rând blocat sub-categorie ── */
  function subrowLocked(title, desc) {
    return (
      '<div class="ck-subrow ck-subrow-locked">' +
        '<div class="ck-subrow-info">' +
          '<strong>' + title + '</strong>' +
          '<span>' + desc + '</span>' +
        '</div>' +
        '<span class="ck-badge-locked">Activ</span>' +
      '</div>'
    );
  }

  function inject() {
    /* ══ MODAL — Stratul 2: Panoul de preferințe granulare ══ */
    var modal = document.createElement('div');
    modal.id = 'ck-modal';
    modal.innerHTML =
      '<div class="ck-overlay" id="ck-overlay"></div>' +
      '<div class="ck-box" role="dialog" aria-modal="true" aria-label="Setări cookie-uri">' +
        '<button class="ck-close" id="ck-close" aria-label="Închide">✕</button>' +
        '<h3>⚙ Setări cookie-uri</h3>' +
        '<p class="ck-intro">Alegeți categoriile și sub-tipurile de cookie-uri pe care le acceptați. Toate opțiunile sunt <strong>inactive implicit</strong>, cu excepția celor strict necesare. Vă puteți modifica oricând preferințele din butonul 🍪.</p>' +

        /* ── Categoria 1: Necesare (blocat) ── */
        '<div class="ck-category">' +
          '<div class="ck-cat-header">' +
            '<div class="ck-cat-info">' +
              '<strong>🔒 Cookie-uri necesare</strong>' +
              '<span>Strict obligatorii pentru funcționarea de bază a site-ului. Nu pot fi dezactivate.</span>' +
            '</div>' +
            '<span class="ck-badge-on">Întotdeauna active</span>' +
          '</div>' +
          subrowLocked('Funcționare site & sesiune', 'Gestionează sesiunea, formularele și securitatea CSRF a site-ului.') +
          subrowLocked('Procesare plăți — Stripe', 'Cookie-uri: _stripe_mid (1 an), _stripe_sid (sesiune). Prevenirea fraudei la plăți online.') +
        '</div>' +

        /* ── Categoria 2: Preferințe (3 toggle-uri) ── */
        '<div class="ck-category ck-cat-border">' +
          '<div class="ck-cat-header">' +
            '<div class="ck-cat-info">' +
              '<strong>⚙ Cookie-uri de preferință</strong>' +
              '<span>Rețin setările și alegerile dvs. pe site pentru o experiență personalizată.</span>' +
            '</div>' +
          '</div>' +
          subrow('pref_consent', 'Preferințe consimțământ cookie-uri', 'Memorează alegerile dvs. privind cookie-urile (localStorage, pe dispozitivul dvs.).') +
          subrow('pref_ui', 'Setări interfață & afișare', 'Preferințe de navigare, mod afișare și personalizare a interfeței.') +
          subrow('pref_lang', 'Limbă și regiune', 'Memorarea preferinței de limbă și format regional selectat.') +
        '</div>' +

        /* ── Categoria 3: Performanță / Analiză (3 toggle-uri) ── */
        '<div class="ck-category ck-cat-border">' +
          '<div class="ck-cat-header">' +
            '<div class="ck-cat-info">' +
              '<strong>📊 Cookie-uri de performanță / analiză</strong>' +
              '<span>Măsoară traficul și comportamentul vizitatorilor. Ajută la îmbunătățirea site-ului.</span>' +
            '</div>' +
          '</div>' +
          subrow('ga_traffic', 'Google Analytics — statistici trafic', 'Cookie-uri: _ga, _ga_* (2 ani / 1 zi). Pagini vizitate, durată sesiune, sursă trafic. Date transferate în SUA prin Clauze Contractuale Standard.') +
          subrow('ga_audience', 'Google Analytics — audiențe & comportament', 'Segmentarea vizitatorilor și rapoarte detaliate de comportament pentru optimizarea site-ului.') +
          subrow('gtm_analytics', 'Google Tag Manager — etichete de măsurare', 'GTM-5N4NP4CN — gestionează și declanșează etichetele de analiză și urmărire.') +
        '</div>' +

        /* ── Categoria 4: Marketing / Publicitate (4 toggle-uri) ── */
        '<div class="ck-category ck-cat-border">' +
          '<div class="ck-cat-header">' +
            '<div class="ck-cat-info">' +
              '<strong>📣 Cookie-uri de marketing / publicitate</strong>' +
              '<span>Folosite pentru livrarea de reclame relevante și măsurarea performanței campaniilor.</span>' +
            '</div>' +
          '</div>' +
          subrow('meta_facebook', 'Meta Pixel — urmărire conversii Facebook', 'Cookie: _fbp (3 luni). Măsoară acțiunile după click pe reclame Facebook. Date transferate în SUA prin Clauze Contractuale Standard.') +
          subrow('meta_instagram', 'Meta Pixel — remarketing Instagram', 'Cookie: _fbc (3 luni). Audiențe personalizate și reclame țintite pe Instagram.') +
          subrow('google_ads', 'Google Ads — urmărire conversii & remarketing', 'Măsoară performanța campaniilor Google Search și Display. Remarketing către vizitatori anteriori.') +
          subrow('retargeting', 'Retargeting multi-canal', 'Audiențe personalizate coordonate pe mai multe platforme publicitare pentru campanii integrate.') +
        '</div>' +

        /* ── Acțiuni (Respinge / Salvează / Accept — egale vizual) ── */
        '<div class="ck-modal-actions">' +
          '<button class="ck-btn ck-btn-modal-reject" id="ck-reject-modal">✕ Respinge toate</button>' +
          '<button class="ck-btn ck-btn-modal-save" id="ck-save">Salvează preferințele</button>' +
          '<button class="ck-btn ck-btn-modal-accept" id="ck-accept-modal">✓ Accept toate</button>' +
        '</div>' +

        '<p class="ck-ts-line">Consimțământ înregistrat: <span id="ck-ts">—</span>' +
        ' &nbsp;·&nbsp; <a href="/termeni-si-conditii-gdpr#cookies" class="ck-link-dark">Politica de cookie-uri</a>' +
        ' &nbsp;·&nbsp; <a href="https://www.dataprotection.ro/" target="_blank" rel="noopener" class="ck-link-dark">ANSPDCP</a></p>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('ck-overlay').addEventListener('click', closeModal);
    document.getElementById('ck-close').addEventListener('click', closeModal);
    document.getElementById('ck-save').addEventListener('click', saveCustom);
    document.getElementById('ck-accept-modal').addEventListener('click', acceptAll);
    document.getElementById('ck-reject-modal').addEventListener('click', rejectAll);

    /* ══ BANNER — Stratul 1: Notificarea de bază ══ */
    var prefs = getPrefs();
    if (!prefs) {
      var banner = document.createElement('div');
      banner.id = 'ck-banner';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-label', 'Notificare module cookie');
      banner.innerHTML =
        '<div class="ck-inner">' +
          '<div class="ck-text">' +
            '<strong>🍪 Folosim module cookie</strong>' +
            '<p>Site-ul utilizează module cookie proprii și de la terți pentru a asigura funcționalitatea, a măsura audiența și a personaliza conținutul. ' +
            'Puteți accepta, refuza sau configura individual fiecare categorie. ' +
            '<a href="/termeni-si-conditii-gdpr#cookies" class="ck-link">Politica de cookie-uri →</a></p>' +
          '</div>' +
          '<div class="ck-actions">' +
            '<button class="ck-btn ck-btn-settings" id="ck-customize">⚙ Personalizează setările</button>' +
            '<button class="ck-btn ck-btn-banner-reject" id="ck-reject">✕ Respinge</button>' +
            '<button class="ck-btn ck-btn-banner-accept" id="ck-accept">✓ Accept</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(banner);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { banner.classList.add('ck-visible'); });
      });
      document.getElementById('ck-customize').addEventListener('click', openModal);
      document.getElementById('ck-reject').addEventListener('click', rejectAll);
      document.getElementById('ck-accept').addEventListener('click', acceptAll);
    } else {
      applyPrefs(prefs);
    }
    injectFloat();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }

  window.addEventListener('load', function () {
    setTimeout(function () {
      if (getPrefs() !== null && !document.getElementById('ck-float')) injectFloat();
    }, 800);
  });
})();
