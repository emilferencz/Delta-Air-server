/* Delta Air Shuttle — Cookie Consent Manager */
(function () {
  var KEY = 'deltaair_cookies';
  /* TODO: înlocuiește cu ID-urile reale înainte de activarea tracking-ului */
  /* Tag-urile sunt gestionate prin GTM-5N4NP4CN */

  function getPrefs() {
    try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; }
  }

  function savePrefs(prefs) {
    localStorage.setItem(KEY, JSON.stringify({
      analytics: !!prefs.analytics,
      marketing: !!prefs.marketing,
      ts: new Date().toISOString()
    }));
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
    if (!window.gtag) return;
    gtag('consent', 'update', {
      'ad_storage': 'granted',
      'ad_user_data': 'granted',
      'ad_personalization': 'granted'
    });
  }

  function applyPrefs(prefs) {
    if (prefs && prefs.analytics) loadGA();
    if (prefs && prefs.marketing) loadPixel();
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
    document.getElementById('ck-tog-analytics').checked = !!p.analytics;
    document.getElementById('ck-tog-marketing').checked = !!p.marketing;
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
    btn.title = 'Setări cookie-uri';
    btn.textContent = '🍪';
    btn.setAttribute('style',
      'position:fixed !important;' +
      'bottom:80px !important;' +
      'right:16px !important;' +
      'left:auto !important;' +
      'z-index:2147483647 !important;' +
      'width:50px !important;' +
      'height:50px !important;' +
      'border-radius:50% !important;' +
      'background:rgba(10,20,45,.95) !important;' +
      'border:2px solid #c9a84c !important;' +
      'font-size:22px !important;' +
      'cursor:pointer !important;' +
      'display:flex !important;' +
      'align-items:center !important;' +
      'justify-content:center !important;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.45) !important;' +
      'touch-action:manipulation !important;' +
      '-webkit-tap-highlight-color:transparent !important;'
    );
    btn.addEventListener('click', openModal);
    document.body.appendChild(btn);
  }

  function acceptAll() {
    savePrefs({ analytics: true, marketing: true });
    applyPrefs({ analytics: true, marketing: true });
    hideBanner();
    closeModal();
    injectFloat();
  }

  function rejectAll() {
    savePrefs({ analytics: false, marketing: false });
    hideBanner();
    injectFloat();
  }

  function saveCustom() {
    var analytics = document.getElementById('ck-tog-analytics').checked;
    var marketing = document.getElementById('ck-tog-marketing').checked;
    savePrefs({ analytics: analytics, marketing: marketing });
    applyPrefs({ analytics: analytics, marketing: marketing });
    hideBanner();
    closeModal();
    injectFloat();
  }

  function inject() {
    /* ── Modal (prezent întotdeauna, deschis la cerere) ── */
    var modal = document.createElement('div');
    modal.id = 'ck-modal';
    modal.innerHTML =
      '<div class="ck-overlay" id="ck-overlay"></div>' +
      '<div class="ck-box" role="dialog" aria-modal="true" aria-label="Setări cookie-uri">' +
        '<button class="ck-close" id="ck-close" aria-label="Închide">✕</button>' +
        '<h3>⚙ Setări cookie-uri</h3>' +
        '<p class="ck-intro">Alegeți categoriile de cookie-uri pe care le acceptați. Preferințele pot fi modificate oricând.</p>' +
        '<div class="ck-row ck-row-locked">' +
          '<div class="ck-row-info">' +
            '<strong>Esențiale</strong>' +
            '<span>Funcționare site, sesiune, formular rezervare. Nu pot fi dezactivate.</span>' +
          '</div>' +
          '<span class="ck-badge-on">Întotdeauna active</span>' +
        '</div>' +
        '<div class="ck-row">' +
          '<div class="ck-row-info">' +
            '<strong>Analiză — Google Analytics</strong>' +
            '<span>Statistici anonime: pagini vizitate, durată sesiune, sursă trafic.</span>' +
          '</div>' +
          '<label class="ck-toggle" aria-label="Cookie-uri de analiză">' +
            '<input type="checkbox" id="ck-tog-analytics">' +
            '<span class="ck-knob"></span>' +
          '</label>' +
        '</div>' +
        '<div class="ck-row">' +
          '<div class="ck-row-info">' +
            '<strong>Marketing — Meta Pixel</strong>' +
            '<span>Personalizarea reclamelor pe Facebook și Instagram (Meta Platforms).</span>' +
          '</div>' +
          '<label class="ck-toggle" aria-label="Cookie-uri de marketing">' +
            '<input type="checkbox" id="ck-tog-marketing">' +
            '<span class="ck-knob"></span>' +
          '</label>' +
        '</div>' +
        '<div class="ck-modal-actions">' +
          '<button class="ck-btn ck-btn-outline" id="ck-save">Salvează preferințele</button>' +
          '<button class="ck-btn ck-btn-navy" id="ck-accept-modal">✓ Accept toate</button>' +
        '</div>' +
        '<p class="ck-ts-line">Consimțământ înregistrat: <span id="ck-ts">—</span></p>' +
      '</div>';
    document.body.appendChild(modal);

    document.getElementById('ck-overlay').addEventListener('click', closeModal);
    document.getElementById('ck-close').addEventListener('click', closeModal);
    document.getElementById('ck-save').addEventListener('click', saveCustom);
    document.getElementById('ck-accept-modal').addEventListener('click', acceptAll);

    /* ── Banner (doar la prima vizită) ── */
    var prefs = getPrefs();
    if (!prefs) {
      var banner = document.createElement('div');
      banner.id = 'ck-banner';
      banner.setAttribute('role', 'region');
      banner.setAttribute('aria-label', 'Notificare cookie-uri');
      banner.innerHTML =
        '<div class="ck-inner">' +
          '<div class="ck-text">' +
            '<strong>🍪 Folosim cookie-uri</strong>' +
            '<p>Site-ul folosește cookie-uri esențiale și, cu acordul dvs., cookie-uri de analiză și marketing. ' +
            '<a href="/termeni-si-conditii-gdpr#cookies" class="ck-link">Politica de cookie-uri</a></p>' +
          '</div>' +
          '<div class="ck-actions">' +
            '<button class="ck-btn ck-btn-ghost" id="ck-customize">⚙ Personalizează</button>' +
            '<button class="ck-btn ck-btn-ghost" id="ck-reject">Respinge</button>' +
            '<button class="ck-btn ck-btn-gold" id="ck-accept">✓ Accept toate</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(banner);
      /* double rAF — garantează că tranziția CSS e vizibilă */
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          banner.classList.add('ck-visible');
        });
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
})();
