/* Site footer — injected on every page except the admin panel. */
(function () {
  if (document.getElementById('site-footer')) return;
  const year = new Date().getFullYear();
  const f = document.createElement('footer');
  f.id = 'site-footer'; f.className = 'site-footer';
  f.innerHTML = `
    <div class="site-footer-inner">
      <div class="site-footer-brand">
        <div class="brand"><div class="brand-logo">₮</div><span>Nova<span class="brand-accent">Wallet</span></span></div>
        <p>A multi-network USDT wallet with trading, swaps, staking and copy trading.</p>
      </div>
      <div><h5>Product</h5>
        <a href="/networks.html">Supported networks</a><a href="/staking.html">Staking</a><a href="/copy.html">Copy trading</a><a href="/referrals.html">Refer &amp; Earn</a></div>
      <div><h5>Support</h5>
        <a href="/faq.html">Help &amp; FAQ</a><a href="/contact.html">Contact support</a><a href="/status.html">Service status</a></div>
      <div><h5>Legal</h5>
        <a href="/terms.html">Terms of Service</a><a href="/privacy.html">Privacy Policy</a><a href="/risk.html">Risk Disclosure</a></div>
    </div>
    <div class="site-footer-bottom">
      © ${year} NovaWallet. All rights reserved.<br>
      Digital assets are volatile and you can lose some or all of your funds. Past performance does not guarantee future results. Nothing on this platform is financial advice.
    </div>`;
  document.body.appendChild(f);
})();
