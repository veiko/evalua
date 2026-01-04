const cta = document.getElementById('cta');
const status = document.getElementById('status');

cta?.addEventListener('click', () => {
  if (status) {
    status.textContent = 'Preparing your evaluation...';
  }
});

cta?.addEventListener('keypress', event => {
  if (event.key === 'Enter') {
    cta.click();
  }
});
