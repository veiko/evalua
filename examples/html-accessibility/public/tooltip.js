const info = document.getElementById('info-icon');
const tooltip = document.getElementById('tooltip');

function show() {
  tooltip?.classList.remove('hidden');
}

function hide() {
  tooltip?.classList.add('hidden');
}

info?.addEventListener('mouseover', show);
info?.addEventListener('mouseout', hide);
info?.addEventListener('click', () => {
  if (!tooltip) return;
  if (tooltip.classList.contains('hidden')) {
    show();
  } else {
    hide();
  }
});
