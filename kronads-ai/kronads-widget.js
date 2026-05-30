var KronAds = (function () {
  var API = 'https://delta-air-server-production.up.railway.app/api/kronads-contact';
  var WA  = 'https://wa.me/40723644418?text=Buna%20ziua%2C%20as%20vrea%20sa%20discut%20despre%20automatizarea%20afacerii%20mele%20cu%20KronAds.';
  var WA_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>';

  function init(containerId) {
    var el = document.getElementById(containerId);
    if (!el) return;

    el.innerHTML = [
      '<div class="kw-wrap">',
        '<div class="kw-badge">KronAds MKT LLC · AI Automations</div>',
        '<h2 class="kw-title">Automatizează <span>ce faci manual</span></h2>',
        '<p class="kw-sub">Spune-ne despre fluxurile tale de lucru și îți arătăm în 30 de minute ce poate fi automatizat.</p>',
        '<form class="kw-form" id="kw-form-' + containerId + '">',
          '<div class="kw-cols">',
            '<div class="kw-field"><label class="kw-label">Nume *</label><input class="kw-input" id="kw-name-' + containerId + '" type="text" placeholder="Ion Popescu" required></div>',
            '<div class="kw-field"><label class="kw-label">Companie / Domeniu</label><input class="kw-input" id="kw-company-' + containerId + '" type="text" placeholder="E-commerce, Clinică..."></div>',
          '</div>',
          '<div class="kw-cols">',
            '<div class="kw-field"><label class="kw-label">Email *</label><input class="kw-input" id="kw-email-' + containerId + '" type="email" placeholder="email@firma.ro" required></div>',
            '<div class="kw-field"><label class="kw-label">Telefon</label><input class="kw-input" id="kw-phone-' + containerId + '" type="tel" placeholder="+40 7xx xxx xxx"></div>',
          '</div>',
          '<div class="kw-field"><label class="kw-label">Ce vrei să automatizezi? *</label><textarea class="kw-textarea" id="kw-desc-' + containerId + '" placeholder="Ex: trimit manual facturi după fiecare comandă, procesez rezervări din mai multe surse..." required></textarea></div>',
          '<button class="kw-btn-submit" type="submit" id="kw-btn-' + containerId + '">Trimite cererea →</button>',
          '<div class="kw-msg" id="kw-msg-' + containerId + '"></div>',
        '</form>',
        '<div class="kw-divider"><span>sau contactă-ne direct</span></div>',
        '<a class="kw-btn-wa" href="' + WA + '" target="_blank" rel="noopener">' + WA_SVG + ' WhatsApp — răspundem imediat</a>',
        '<div class="kw-footer">Powered by <a href="https://delta-air.ro/kronads-ai/" target="_blank">KronAds MKT LLC</a></div>',
      '</div>'
    ].join('');

    document.getElementById('kw-form-' + containerId).addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = document.getElementById('kw-btn-' + containerId);
      var msg = document.getElementById('kw-msg-' + containerId);
      btn.disabled = true;
      btn.textContent = 'Se trimite...';
      msg.className = 'kw-msg';
      msg.textContent = '';

      fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:        document.getElementById('kw-name-'    + containerId).value.trim(),
          company:     document.getElementById('kw-company-' + containerId).value.trim(),
          email:       document.getElementById('kw-email-'   + containerId).value.trim(),
          phone:       document.getElementById('kw-phone-'   + containerId).value.trim(),
          description: document.getElementById('kw-desc-'    + containerId).value.trim()
        })
      })
      .then(function (res) {
        if (res.ok) {
          msg.className = 'kw-msg ok';
          msg.textContent = '✅ Mesaj trimis! Te contactăm în maxim 24 de ore.';
          document.getElementById('kw-form-' + containerId).reset();
        } else { throw new Error(); }
      })
      .catch(function () {
        msg.className = 'kw-msg err';
        msg.textContent = '⚠️ Eroare. Încarcă pe WhatsApp sau email direct.';
      })
      .finally(function () {
        btn.disabled = false;
        btn.textContent = 'Trimite cererea →';
      });
    });
  }

  return { init: init };
})();
