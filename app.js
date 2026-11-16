/* Application entry. Feature scripts and domain modules are loaded in index.html. */
try {
  const uid = sessionStorage.getItem('retailflow-user');
  if (store.data.staff.some((s) => s.id === uid && s.active)) {
    store.userId = uid;
    page = ACCESS[store.user.role][0];
    shell();
  } else loginScreen();
} catch (error) {
  loginScreen();
  notify(error.message, true);
}
