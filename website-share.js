(() => {
  const buttons = Array.from(document.querySelectorAll('#website-share, #footer-share'));
  if (!buttons.length) return;
  buttons.forEach(button => {
  const originalLabel = button.querySelector('span:last-child')?.textContent || 'Share';
  const label = button.querySelector('span:last-child');
  const setLabel = (value) => { if (label) label.textContent = value; };
  const copyFallback = async (url) => {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      return true;
    }
    const field = document.createElement('textarea');
    field.value = url;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    field.remove();
    if (!copied) throw new Error('Copy unavailable');
    return true;
  };
  button.addEventListener('click', async () => {
    const shareData = {
      title: 'ZENURA IGNITE TECHNOLOGIES',
      text: 'Explore websites, mobile apps and custom software by ZENURA IGNITE.',
      url: window.location.href
    };
    button.disabled = true;
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await copyFallback(shareData.url);
        setLabel('Link Copied!');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') {
        try {
          await copyFallback(shareData.url);
          setLabel('Link Copied!');
        } catch {
          setLabel('Unable to Share');
        }
      }
    } finally {
      button.disabled = false;
      if (label && label.textContent !== originalLabel) {
        window.setTimeout(() => setLabel(originalLabel), 2200);
      }
    }
  });
  });
})();