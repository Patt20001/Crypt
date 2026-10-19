let scannerStream = null;

window.openQrScanner = async function () {
  const modal = document.getElementById('qr-modal');
  const video = document.getElementById('qr-video');
  const status = document.getElementById('qr-status');
  modal.classList.add('open');
  status.textContent = 'Requesting camera…';

  try {
    scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scannerStream;
    await video.play();
    status.textContent = 'Point the camera at a QR code';

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const tick = () => {
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return requestAnimationFrame(tick);
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR ? jsQR(data.data, data.width, data.height) : null;
      if (code) {
        closeQrScanner();
        const val = code.data.includes(':') ? code.data.split(':')[1] : code.data;
        const input = document.getElementById('w-addr');
        if (input) { input.value = val; toast('Address scanned', 'success', 1500); }
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  } catch (e) {
    status.textContent = 'Camera unavailable — paste the address manually.';
  }
};

window.closeQrScanner = function () {
  const modal = document.getElementById('qr-modal');
  modal.classList.remove('open');
  if (scannerStream) {
    scannerStream.getTracks().forEach(t => t.stop());
    scannerStream = null;
  }
};