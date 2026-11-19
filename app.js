/* Application entry. Restores backend JWT session and initializes Route Guard. */
(async function bootstrap() {
  try {
    const token = getAuthToken();
    if (!token) {
      loginScreen();
      return;
    }
    const res = await api.me();
    store.setAuthenticatedUser(res.user);
    syncStoreSettingsFromServer(res.storeConfig);

    const hashPage = getRouteFromHash();
    const defaultPage = (ACCESS[res.user.role] || ['pos'])[0];
    if (hashPage) {
      if (store.can(hashPage)) {
        page = hashPage;
      } else {
        forbiddenAttempt = hashPage;
        page = 'forbidden';
      }
    } else {
      page = defaultPage;
      window.location.hash = `#/${defaultPage}`;
    }
    shell();
  } catch (error) {
    setAuthToken('');
    store.setAuthenticatedUser(null);
    resetApiCaches();
    loginScreen(error?.status === 401 ? '' : error.message);
  }
})();
