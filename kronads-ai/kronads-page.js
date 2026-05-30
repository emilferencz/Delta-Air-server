var KronAds = window.KronAds || {};

KronAds.initPage = function (containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;

  var iframe = document.createElement('iframe');
  iframe.src = 'https://delta-air.ro/kronads-ai/';
  iframe.setAttribute('frameborder', '0');
  iframe.setAttribute('scrolling', 'no');
  iframe.style.cssText = 'width:100%;border:none;display:block;overflow:hidden;min-height:800px;';
  el.appendChild(iframe);

  window.addEventListener('message', function (e) {
    if (e.data && e.data.kronadsHeight && e.source === iframe.contentWindow) {
      iframe.style.height = (e.data.kronadsHeight + 40) + 'px';
    }
  });
};
