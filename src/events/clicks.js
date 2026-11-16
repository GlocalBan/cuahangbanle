document.addEventListener('click', (event) => {
  if (!event.target.closest('.global-search')) $('#global-results')?.remove();
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  const a = el.dataset;
  try {
    for (const handle of [
      handleNavigationAction,
      handleSalesAction,
      handleCatalogAction,
      handleInventoryAction,
      handleReturnsAction,
      handleSettingsAction,
      handleOrdersAction,
    ])
      if (handle(a)) break;
  } catch (error) {
    notify(error.message, true);
  }
});
