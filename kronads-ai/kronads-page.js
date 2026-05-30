var KronAds = window.KronAds || {};

KronAds.initPage = function (containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;

  el.style.cssText = 'width:100%;display:block;min-height:4000px;';

  var iframe = document.createElement('iframe');
  iframe.src = 'https://delta-air.ro/kronads-ai/?embed=1';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('scrolling', 'no');
  iframe.style.cssText = 'width:100%;height:4000px;border:none;display:block;';
  el.appendChild(iframe);

  /* Auto-resize prin postMessage — doar crește, nu scade sub 4000px */
  window.addEventListener('message', function (e) {
    if (e.data && e.data.kronadsHeight) {
      var h = Math.max(parseInt(e.data.kronadsHeight) + 60, 4000);
      iframe.style.height = h + 'px';
      el.style.minHeight = h + 'px';
    }
  });
};
